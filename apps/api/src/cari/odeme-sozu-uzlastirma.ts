import { Prisma } from "@prisma/client";
import { z } from "zod";

// F02-01: Saf hesap çekirdeği. DB adaptörü, kilitler, yetki ve kalıcı kayıt
// F02-02'de eklenir. Girdi, tek transaction snapshot'ından gelmelidir.
const kimlik = z.string().uuid().transform((v) => v.toLowerCase());
const para = z.string().regex(/^(0|[1-9]\d{0,12})\.\d{2}$/);
const zaman = z.string().datetime({ offset: true });
const gun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Geçersiz takvim günü");
const doviz = z.string().regex(/^[A-Z]{3}$/);
const pozitifPara = para.refine((v) => new Prisma.Decimal(v).gt(0), "Tutar pozitif olmalı");

export const odemeSozuUzlastirmaSorgusu = z.object({
  tenantId: kimlik,
  simdi: zaman,
  faturalar: z.array(z.object({
    id: kimlik, tenantId: kimlik, cariId: kimlik, dovizCinsi: doviz,
    tip: z.enum(["satis", "alis", "satis_iade", "alis_iade"]),
    durum: z.enum(["taslak", "kesin", "iptal"]),
  }).strict()).max(1000),
  sozler: z.array(z.object({
    id: kimlik, tenantId: kimlik, cariId: kimlik, faturaId: kimlik,
    dovizCinsi: doviz, tutar: pozitifPara, verildigiZaman: zaman, sozTarihi: gun,
    kayitDurumu: z.enum(["aktif", "iptal", "revize"]),
  }).strict()).max(1000),
  // Tutar, güncel FaturaKapama.tutar: faturanın dövizinde. İade/çek/kart
  // kapamaları ilk sürümde nakit gerçekleşmesi değildir; yalnız doğrulanmış
  // kasa/banka tahsilatı (POS dahil) adaptörden kabul edilir.
  kapamalar: z.array(z.object({
    id: kimlik, tenantId: kimlik, cariId: kimlik, faturaId: kimlik,
    dovizCinsi: doviz, tutar: pozitifPara, kaynakId: kimlik,
    kaynakTuru: z.enum(["kasa_banka", "kredi_karti", "cek_senet", "iade_fatura"]),
    kaynakYon: z.enum(["tahsilat", "tediye"]),
    islemZamani: zaman, islemZamaniHassasiyeti: z.enum(["gun", "an"]), kaynakKayitZamani: zaman,
  }).strict().refine((k) => k.islemZamaniHassasiyeti !== "gun" || /T00:00:00(?:\.000)?Z$/.test(k.islemZamani), "Gün hassasiyetinde DB tarihini UTC gece yarısı olarak aktarın")).max(5000),
}).strict();

export type OdemeSozuUzlastirmaGirdisi = z.input<typeof odemeSozuUzlastirmaSorgusu>;
export type OdemeSozuDurumu = "aktif" | "kismen_gerceklesti" | "gerceklesti" | "gecikti" | "iptal" | "revize" | "kaynak_gecersiz";
export interface OdemeSozuUzlastirmaSonucu {
  sozId: string;
  durum: OdemeSozuDurumu;
  gerceklesen: string;
  kalan: string;
  kaynaklar: Array<{ kaynakId: string; faturaId: string; tutar: string; kapamaIdleri: string[] }>;
}

const D = (v: string | number) => new Prisma.Decimal(v);
const damga = (v: string) => new Date(v).getTime();
const istanbulGunu = (v: string) => new Date(v).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const anahtar = (v: { faturaId: string; kaynakTuru: string; kaynakId: string }) => JSON.stringify([v.faturaId, v.kaynakTuru, v.kaynakId]);
const ayni = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Olay toplamı tutmaz: her çağrı güncel kapamalardan baştan türetilir.
 * Aynı kaynağın aynı faturadaki elle/otomatik payı bir havuzdur. Havuz
 * sözlerin veriliş zamanı/id sırasıyla paylaşılır; toplam asla havuzu aşmaz.
 * Geri alınmış tutarlar adaptörde düşülmüş güncel kapamalar olmalıdır.
 */
export function odemeSozleriniUzlastir(girdi: OdemeSozuUzlastirmaGirdisi): OdemeSozuUzlastirmaSonucu[] {
  const g = odemeSozuUzlastirmaSorgusu.parse(girdi);
  const simdi = damga(g.simdi);
  const bugun = istanbulGunu(g.simdi);
  const faturalar = new Map<string, typeof g.faturalar[number]>();
  for (const f of g.faturalar) {
    if (f.tenantId !== g.tenantId || faturalar.has(f.id)) throw new Error("Fatura kapsamı veya kimliği geçersiz");
    faturalar.set(f.id, f);
  }
  const sozKimlikleri = new Set<string>();
  for (const s of g.sozler) {
    const f = faturalar.get(s.faturaId);
    if (sozKimlikleri.has(s.id) || s.tenantId !== g.tenantId || !f || f.cariId !== s.cariId || f.dovizCinsi !== s.dovizCinsi || f.tip !== "satis") {
      throw new Error("Sözün şirket, cari, döviz, satış faturası veya kimlik kapsamı geçersiz");
    }
    if (damga(s.verildigiZaman) > simdi || s.sozTarihi < istanbulGunu(s.verildigiZaman)) throw new Error("Söz zamanı geçersiz");
    sozKimlikleri.add(s.id);
  }

  type Havuz = {
    kaynakId: string; faturaId: string; kalan: Prisma.Decimal;
    islemZamani: string; islemZamaniHassasiyeti: "gun" | "an"; kaynakKayitZamani: string; kapamaIdleri: string[];
  };
  const havuzlar = new Map<string, Havuz>();
  const gorulen = new Map<string, typeof g.kapamalar[number]>();
  const kaynakBilgisi = new Map<string, string>();
  for (const k of g.kapamalar) {
    const f = faturalar.get(k.faturaId);
    if (k.tenantId !== g.tenantId || !f || f.cariId !== k.cariId || f.dovizCinsi !== k.dovizCinsi) continue;
    const onceki = gorulen.get(k.id);
    if (onceki) {
      if (!ayni(onceki, k)) throw new Error("Aynı kapama için çelişkili kaynak");
      continue;
    }
    gorulen.set(k.id, k);
    if (k.kaynakTuru !== "kasa_banka" || k.kaynakYon !== "tahsilat") continue;
    // Kaynak birden fazla faturaya dağılabilir; kimlik/zaman bilgisi aynı olmalı.
    const bilgi = JSON.stringify([k.cariId, k.dovizCinsi, damga(k.islemZamani), k.islemZamaniHassasiyeti, damga(k.kaynakKayitZamani)]);
    const eskiBilgi = kaynakBilgisi.get(k.kaynakId);
    if (eskiBilgi && eskiBilgi !== bilgi) throw new Error("Aynı ödeme için çelişkili kaynak bilgisi");
    kaynakBilgisi.set(k.kaynakId, bilgi);
    const gelecekte = k.islemZamaniHassasiyeti === "gun" ? k.islemZamani.slice(0, 10) > bugun : damga(k.islemZamani) > simdi;
    if (gelecekte || damga(k.kaynakKayitZamani) > simdi) continue;
    const key = anahtar(k);
    const h = havuzlar.get(key) ?? { kaynakId: k.kaynakId, faturaId: k.faturaId, kalan: D(0), islemZamani: k.islemZamani, islemZamaniHassasiyeti: k.islemZamaniHassasiyeti, kaynakKayitZamani: k.kaynakKayitZamani, kapamaIdleri: [] };
    h.kalan = h.kalan.add(k.tutar);
    h.kapamaIdleri.push(k.id);
    havuzlar.set(key, h);
  }
  const faturaHavuzlari = new Map<string, Havuz[]>();
  for (const h of havuzlar.values()) {
    h.kapamaIdleri.sort();
    const liste = faturaHavuzlari.get(h.faturaId) ?? [];
    liste.push(h);
    faturaHavuzlari.set(h.faturaId, liste);
  }
  for (const liste of faturaHavuzlari.values()) liste.sort((a, b) => damga(a.islemZamani) - damga(b.islemZamani) || a.kaynakId.localeCompare(b.kaynakId));

  return [...g.sozler].sort((a, b) => damga(a.verildigiZaman) - damga(b.verildigiZaman) || a.id.localeCompare(b.id)).map((s) => {
    const kaynaklar: OdemeSozuUzlastirmaSonucu["kaynaklar"] = [];
    let kalan = D(s.tutar);
    const verilisGunu = istanbulGunu(s.verildigiZaman);
    const verilisZamani = damga(s.verildigiZaman);
    const sabitDurum = s.kayitDurumu !== "aktif" ? s.kayitDurumu : faturalar.get(s.faturaId)!.durum !== "kesin" ? "kaynak_gecersiz" : null;
    if (!sabitDurum) {
      for (const h of faturaHavuzlari.get(s.faturaId) ?? []) {
        // Eşit damgada sıralama kanıtlanamaz: eski ödeme sayma riskine karşı dışla.
        // KasaBankaHareket.tarih @db.Date: aynı günün sırası bilinmez.
        // Adaptör createdAt'ı gerçek ödeme saati gibi kullanamaz.
        const yeniIslem = h.islemZamaniHassasiyeti === "an"
          ? damga(h.islemZamani) > verilisZamani
          : h.islemZamani.slice(0, 10) > verilisGunu;
        if (!yeniIslem || damga(h.kaynakKayitZamani) <= verilisZamani || !h.kalan.gt(0)) continue;
        const pay = Prisma.Decimal.min(kalan, h.kalan);
        if (!pay.gt(0)) break;
        kalan = kalan.sub(pay);
        h.kalan = h.kalan.sub(pay);
        kaynaklar.push({ kaynakId: h.kaynakId, faturaId: h.faturaId, tutar: pay.toFixed(2), kapamaIdleri: [...h.kapamaIdleri] });
      }
    }
    const gerceklesen = D(s.tutar).sub(kalan);
    const durum: OdemeSozuDurumu = sabitDurum ?? (kalan.isZero() ? "gerceklesti" : s.sozTarihi < bugun ? "gecikti" : gerceklesen.gt(0) ? "kismen_gerceklesti" : "aktif");
    return { sozId: s.id, durum, gerceklesen: gerceklesen.toFixed(2), kalan: kalan.toFixed(2), kaynaklar };
  });
}
