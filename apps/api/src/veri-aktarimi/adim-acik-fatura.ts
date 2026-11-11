import { Prisma } from "@prisma/client";
import { dovizCoz, sayiCoz, tarihCoz } from "../cari/cari-ice-aktarma";
import { acikFaturaAciklamasi, type SatirSonucu } from "./adim";
import type { SutunTanimi, TabloSatiri } from "./tablo";

type Tx = Prisma.TransactionClient;

/** VAK-06: açık (ödenmemiş) faturalar; her satır açılış türünde bir cari hareketi olur. */
export const ACIK_FATURA_SUTUNLARI = [
  { anahtar: "cari", baslik: "Cari", aciklama: "Cari kodu ya da VKN/TCKN; kart önce Cari kartlar adımında açılmış olmalı", ornek: "MUS-010", esanlamlilar: ["cari kodu", "cari kod", "cari hesap kodu", "musteri kodu", "tedarikci kodu", "vkn", "vergi no", "vkn / tckn"] },
  { anahtar: "yon", baslik: "Yön", aciklama: "Borç (cari bize borçlu; satış faturası) ya da Alacak (biz cariye borçluyuz; alış faturası). Cari kartlar şablonundaki açılış yönüyle aynı", ornek: "Borç", esanlamlilar: ["tur", "fatura turu", "fatura tipi", "islem turu", "borc/alacak", "b/a"] },
  { anahtar: "belgeNo", baslik: "Belge no", aciklama: "Zorunlu; aynı caride aynı belge ikinci kez aktarılmaz", ornek: "ABC2026000000123", esanlamlilar: ["fatura no", "fatura numarasi", "belge numarasi", "evrak no", "fis no"] },
  { anahtar: "belgeTarihi", baslik: "Belge tarihi", aciklama: "Zorunlu (gg.aa.yyyy)", ornek: "15.10.2026", esanlamlilar: ["fatura tarihi", "tarih", "evrak tarihi", "islem tarihi"] },
  { anahtar: "vade", baslik: "Vade", aciklama: "Boşsa belge tarihi; yaşlandırma ve vade hatırlatması buna göre çalışır", ornek: "14.11.2026", esanlamlilar: ["vade tarihi", "son odeme tarihi", "odeme tarihi"] },
  { anahtar: "tutar", baslik: "Kalan tutar", aciklama: "Ödenmemiş kısım, belgenin dövizinde, KDV dahil", ornek: "11800.00", esanlamlilar: ["tutar", "kalan", "bakiye", "acik tutar", "odenmemis tutar", "genel toplam", "toplam"] },
  { anahtar: "doviz", baslik: "Döviz", aciklama: "Boşsa carinin dövizi", ornek: "", esanlamlilar: ["para birimi", "doviz cinsi", "doviz turu"] },
  { anahtar: "kur", baslik: "Kur", aciklama: "Dövizde boşsa geçiş tarihindeki TCMB kuru; 1 olamaz", ornek: "", esanlamlilar: ["doviz kuru"] },
] as const satisfies readonly SutunTanimi[];

export type AcikFaturaAnahtari = (typeof ACIK_FATURA_SUTUNLARI)[number]["anahtar"];

export interface AcikFaturaPlani extends SatirSonucu {
  hareket: { cariId: string; tip: "borc" | "alacak"; tutar: Prisma.Decimal; dovizCinsi: string; kur: Prisma.Decimal; vade: string; aciklama: string } | null;
}

/** Dövizde kur boşsa o günün TCMB kuru (yöne göre alış/satış); yoksa null. */
export type KurBul = (doviz: string, tarih: string, yon: "borc" | "alacak") => Promise<Prisma.Decimal | null>;

export async function acikFaturaPlanla(tx: Tx, satirlar: TabloSatiri<AcikFaturaAnahtari>[], gecisTarihi: string, kurBul: KurBul): Promise<AcikFaturaPlani[]> {
  const anahtarlar = [...new Set(satirlar.map((s) => s.hucreler.cari?.trim()).filter((k): k is string => Boolean(k)))];
  const vknler = anahtarlar.map((a) => a.replace(/\s/g, "")).filter((a) => /^\d{10,11}$/.test(a));
  const cariler = anahtarlar.length
    ? await tx.cariHesap.findMany({ where: { OR: [{ kod: { in: anahtarlar } }, ...(vknler.length ? [{ vknTckn: { in: vknler } }] : [])] }, select: { id: true, kod: true, unvan: true, vknTckn: true, dovizCinsi: true } })
    : [];
  const kodla = new Map(cariler.map((c) => [c.kod, c]));
  const vknla = new Map<string, typeof cariler>();
  for (const c of cariler) if (c.vknTckn) vknla.set(c.vknTckn, [...(vknla.get(c.vknTckn) ?? []), c]);
  const cariIdler = cariler.map((c) => c.id);
  const acilislar = cariIdler.length ? await tx.cariHareket.findMany({ where: { cariId: { in: cariIdler }, kaynakTur: "acilis" }, select: { cariId: true, aciklama: true } }) : [];
  const toplamAcilisli = new Set(acilislar.filter((a) => !a.aciklama?.startsWith("Açık fatura ")).map((a) => a.cariId));
  // Açıklama "Açık fatura <no> (<tarih>)" biçimindedir; belge no buradan okunur.
  const mevcutBelgeler = new Set(acilislar.flatMap((a) => {
    const m = /^Açık fatura (.+) \(\d{4}-\d{2}-\d{2}\)$/.exec(a.aciklama ?? "");
    return m ? [`${a.cariId}|${acikFaturaAciklamasi(m[1])}`] : [];
  }));
  const gorulen = new Map<string, number>();
  const plan: AcikFaturaPlani[] = [];
  for (const ham of satirlar) {
    const h = ham.hucreler;
    const hatalar: string[] = [];
    const uyarilar: string[] = [];
    let cari: (typeof cariler)[number] | undefined;
    const anahtar = h.cari?.trim();
    if (!anahtar) hatalar.push("Cari zorunludur");
    else {
      cari = kodla.get(anahtar);
      if (!cari) {
        const adaylar = vknla.get(anahtar.replace(/\s/g, "")) ?? [];
        if (adaylar.length > 1) hatalar.push(`VKN ${adaylar.length} kartta kayıtlı (${adaylar.map((c) => c.kod).join(", ")}); cari kodunu yazın`);
        else cari = adaylar[0];
      }
      if (!cari && !hatalar.length) hatalar.push(`Cari bulunamadı: ${anahtar} (önce Cari kartlar adımını uygulayın)`);
    }
    if (cari && toplamAcilisli.has(cari.id)) hatalar.push("Carinin toplam açılış bakiyesi var; açık faturalar ayrıca girilmez (ya toplam ya belge bazında)");
    let yon: "borc" | "alacak" | undefined;
    if (!h.yon) hatalar.push("Yön zorunludur (Borç ya da Alacak)");
    else {
      const y = h.yon.toLocaleLowerCase("tr-TR").trim();
      // Cari kartlar şablonuyla aynı: Borç = cari bize borçlu (satış), Alacak = biz cariye borçluyuz (alış).
      if (y.startsWith("borç") || y.startsWith("borc") || y.startsWith("satış") || y.startsWith("satis") || y === "b") yon = "borc";
      else if (y.startsWith("alacak") || y.startsWith("alış") || y.startsWith("alis") || y === "a") yon = "alacak";
      else hatalar.push(`Yön "${h.yon}" tanınmadı (Borç ya da Alacak)`);
    }
    const belgeNo = h.belgeNo?.trim() ?? "";
    if (!belgeNo) hatalar.push("Belge no zorunludur");
    else if (belgeNo.length > 60) hatalar.push("Belge no en fazla 60 karakter olabilir");
    const aciklama = acikFaturaAciklamasi(belgeNo);
    if (cari && belgeNo) {
      const k = `${cari.id}|${aciklama}`;
      if (mevcutBelgeler.has(k)) hatalar.push("Bu belge bu cariye daha önce aktarılmış");
      else if (gorulen.has(k)) hatalar.push(`Aynı cari ve belge dosyada ${gorulen.get(k)}. satırda da var`);
      else gorulen.set(k, ham.satir);
    }
    let belgeTarihi: string | undefined;
    if (!h.belgeTarihi) hatalar.push("Belge tarihi zorunludur");
    else { const t = tarihCoz(h.belgeTarihi, "Belge tarihi"); if ("hata" in t) hatalar.push(t.hata); else belgeTarihi = t.deger; }
    if (belgeTarihi && belgeTarihi > gecisTarihi) hatalar.push(`Belge tarihi geçiş tarihinden (${gecisTarihi}) sonra; bu fatura TekirExtra'da kesilmeli`);
    let vade = belgeTarihi;
    if (h.vade) { const t = tarihCoz(h.vade, "Vade"); if ("hata" in t) hatalar.push(t.hata); else vade = t.deger; }
    if (vade && belgeTarihi && vade < belgeTarihi) hatalar.push("Vade belge tarihinden önce olamaz");
    let tutar: number | undefined;
    if (!h.tutar) hatalar.push("Kalan tutar zorunludur");
    else { const t = sayiCoz(h.tutar, "Kalan tutar", 0); if ("hata" in t) hatalar.push(t.hata); else if (t.deger === 0) hatalar.push("Kalan tutar sıfır; kapanmış fatura aktarılmaz"); else tutar = t.deger; }
    let doviz = cari?.dovizCinsi ?? "TRY";
    if (h.doviz) { const d = dovizCoz(h.doviz, "Döviz"); if ("hata" in d) hatalar.push(d.hata); else doviz = d.deger as typeof doviz; }
    let kur: Prisma.Decimal | undefined;
    if (doviz === "TRY") kur = new Prisma.Decimal(1);
    else if (h.kur) { const k = sayiCoz(h.kur, "Kur", 0); if ("hata" in k) hatalar.push(k.hata); else if (k.deger === 0 || k.deger === 1) hatalar.push("Dövizli faturada kur 0 ya da 1 olamaz"); else kur = new Prisma.Decimal(k.deger); }
    else if (yon) { const k = await kurBul(doviz, gecisTarihi, yon); if (k) kur = k; else hatalar.push(`${doviz} için ${gecisTarihi} tarihinde TCMB kuru bulunamadı; Kur sütununu doldurun`); }
    plan.push({
      satir: ham.satir,
      durum: (!hatalar.length && cari && yon && tutar !== undefined && kur && vade) ? "yeni" : "hatali",
      etiket: belgeNo,
      aciklama: cari ? `${cari.unvan} · ${h.tutar ?? ""} ${doviz}` : "",
      hatalar, uyarilar,
      hareket: (!hatalar.length && cari && yon && tutar !== undefined && kur && vade) ? { cariId: cari.id, tip: yon, tutar: new Prisma.Decimal(tutar), dovizCinsi: doviz, kur, vade, aciklama: `${aciklama} (${belgeTarihi})` } : null,
    });
  }
  return plan;
}
