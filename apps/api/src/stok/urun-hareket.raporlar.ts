import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { registerRapor } from "../core/raporlar/rapor-kayit";
import { iptalCiftiMi, iptalEdilmisFaturalar, iptalleriGoster } from "../fatura/iptal-cifti";
import { bilinenMarj, maliyetBilinmiyor, satisSatirlari } from "./satis-ozeti";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const tarihAraligi = (baslangic?: unknown, bitis?: unknown) => ({ ...(baslangic ? { gte: new Date(String(baslangic)) } : {}), ...(bitis ? { lte: new Date(String(bitis)) } : {}) });
const TARIH = [{ alan: "baslangic", ad: "Başlangıç", tip: "tarih" as const }, { alan: "bitis", ad: "Bitiş", tip: "tarih" as const }];
const HAREKET_ADI: Record<string, string> = { giris: "Giriş", cikis: "Çıkış", sayim_duzeltme: "Sayım düzeltme", fire: "Fire", zayi: "Zayi", numune: "Numune", promosyon: "Promosyon", acilis: "Açılış", transfer_cikis: "Transfer çıkış", transfer_giris: "Transfer giriş" };

/** RPR-30 (inceleme P2-2): Hareketler dökümü bu satırı aşarsa dönem daraltılmalı (bellek ve dışa aktarım sınırı). */
export const HAREKET_SINIRI = 50_000;

function hareketGrubu(h: { tip: string; kaynakTur: string }) {
  // Sarf, mamul/yan ürün girişi, kalite ve sarf düzeltmeleri hep `uretim_` önekli.
  if (h.kaynakTur.startsWith("uretim_")) return "uretim";
  if (h.tip === "fire" || h.tip === "zayi") return "fire";
  if (h.tip.startsWith("transfer_")) return "transfer";
  if (h.tip === "sayim_duzeltme") return "sayim";
  return ["giris", "acilis"].includes(h.tip) ? "giris" : "cikis";
}

/**
 * RPR-19 (inceleme P2-4): "Kaynak" sütunu ham kimlik (`fatura · 0d9b…`)
 * gösteriyordu. Kimlik belge numarasına çevrilir ve belgeye bağlantı verilir.
 */
const FATURA_KAYNAKLARI: Record<string, string> = { fatura: "Fatura", fatura_iptal: "Fatura iptali", fatura_geri_alma: "Taslağa geri alma" };

async function kaynakBelgeleri(tx: Prisma.TransactionClient, hareketler: { kaynakTur: string; kaynakRef: string | null }[]) {
  const kimlikler = (turler: string[]) => [...new Set(hareketler.filter((h) => turler.includes(h.kaynakTur) && h.kaynakRef && /^[0-9a-f-]{36}$/i.test(h.kaynakRef)).map((h) => h.kaynakRef!))];
  const faturaIdler = kimlikler(Object.keys(FATURA_KAYNAKLARI)), transferIdler = kimlikler(["transfer"]);
  const [faturalar, transferler] = await Promise.all([
    faturaIdler.length ? tx.fatura.findMany({ where: { id: { in: faturaIdler } }, select: { id: true, no: true } }) : [],
    transferIdler.length ? tx.depoTransfer.findMany({ where: { id: { in: transferIdler } }, select: { id: true, no: true } }) : [],
  ]);
  return { faturalar: new Map(faturalar.map((f) => [f.id, f.no])), transferler: new Map(transferler.map((t) => [t.id, t.no])) };
}

export function kaynakEtiketi(h: { kaynakTur: string; kaynakRef: string | null }, b: { faturalar: Map<string, string | null>; transferler: Map<string, string> }): { kaynak: string; kaynakYolu: string | null } {
  const ref = h.kaynakRef ?? "";
  if (FATURA_KAYNAKLARI[h.kaynakTur]) {
    const no = b.faturalar.has(ref) ? (b.faturalar.get(ref) ?? "Numarasız") : null;
    return { kaynak: `${FATURA_KAYNAKLARI[h.kaynakTur]}${no ? ` ${no}` : ""}`, kaynakYolu: no ? `/panel/fatura/yeni?ac=${ref}` : null };
  }
  if (h.kaynakTur === "transfer") return { kaynak: `Transfer${b.transferler.get(ref) ? ` ${b.transferler.get(ref)}` : ""}`, kaynakYolu: "/panel/stok/transferler" };
  if (h.kaynakTur === "sayim") return { kaynak: "Sayım", kaynakYolu: "/panel/stok/sayim" };
  if (h.kaynakTur.startsWith("uretim")) return { kaynak: "Üretim bildirimi", kaynakYolu: "/panel/uretim/emirler" };
  if (h.kaynakTur === "manuel") return { kaynak: "Elle giriş", kaynakYolu: null };
  return { kaynak: h.kaynakTur, kaynakYolu: null };
}

/** Maliyeti kayıtlı olmayan çıkış 0 değil boş görünür ("bedava" sanılmasın). */
export function maliyetHucreleri(miktar: Prisma.Decimal, maliyet: Prisma.Decimal) {
  if (maliyet.isZero() && miktar.lt(0)) return { birimMaliyet: null, toplamMaliyet: null };
  return { birimMaliyet: maliyet.toFixed(4), toplamMaliyet: miktar.abs().mul(maliyet).toFixed(2) };
}

registerRapor({
  kod: "urun-hareket.hareketler", modul: "urun_hareket", ad: "Hareketler", aciklama: "Tüm giriş, çıkış, fire, transfer ve üretim hareketlerinin tarih sıralı dökümü",
  filtreler: [...TARIH.map((f) => ({ ...f, zorunlu: true })), { alan: "stok", ad: "Ürün", tip: "stok" }, { alan: "depo", ad: "Depo", tip: "depo" }, { alan: "grup", ad: "Hareket Grubu", tip: "secim", secenekler: [{ deger: "giris", ad: "Girişler" }, { deger: "cikis", ad: "Çıkışlar" }, { deger: "fire", ad: "Fire / Zayi" }, { deger: "uretim", ad: "Üretim" }, { deger: "transfer", ad: "Transfer" }, { deger: "sayim", ad: "Sayım" }] }, { alan: "iptaller", ad: "İptalleri de göster", tip: "onay" }],
  kolonlar: [{ alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } }, { alan: "urun", baslik: "Ürün / Varyant", tip: "metin" }, { alan: "depo", baslik: "Depo", tip: "metin" }, { alan: "hareket", baslik: "Hareket", tip: "metin" }, { alan: "kaynak", baslik: "Kaynak", tip: "metin", baglantiAlani: "kaynakYolu" }, { alan: "giris", baslik: "Giriş", tip: "sayi" }, { alan: "cikis", baslik: "Çıkış", tip: "sayi" }, { alan: "birimMaliyet", baslik: "Birim Maliyet", tip: "para" }, { alan: "toplamMaliyet", baslik: "Toplam Maliyet", tip: "para" }, { alan: "aciklama", baslik: "Açıklama", tip: "metin" }],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const kosul = { tarih: tarihAraligi(f.baslangic, f.bitis), ...(f.stok ? { stokId: String(f.stok) } : {}), ...(f.depo ? { depoId: String(f.depo) } : {}) };
    const adet = await tx.stokHareket.count({ where: kosul });
    if (adet > HAREKET_SINIRI) throw new BadRequestException(`Dönemde ${adet.toLocaleString("tr-TR")} hareket var; en çok ${HAREKET_SINIRI.toLocaleString("tr-TR")} hareket dökülür. Dönemi daraltın ya da ürün/depo seçin.`);
    const hareketler = await tx.stokHareket.findMany({ where: kosul, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], include: { stok: { select: { kod: true, ad: true, anaBirim: true } }, varyant: { select: { kod: true, ad: true } }, depo: { select: { kod: true, ad: true } } } });
    // STK-22: iptal edilmiş faturanın hareketleri seçenek işaretlenmedikçe gösterilmez.
    const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
    const belgeler = await kaynakBelgeleri(tx, hareketler);
    return hareketler.filter((h) => (iptalleriGoster(f.iptaller) || !iptalCiftiMi(h, iptaller)) && (!f.grup || hareketGrubu(h) === f.grup)).map((h) => { const m = D(h.miktar); return { tarih: h.tarih.toISOString().slice(0, 10), stokId: h.stokId, kod: h.stok.kod, urun: `${h.stok.ad}${h.varyant ? ` / ${h.varyant.kod} — ${h.varyant.ad}` : ""}`, depo: `${h.depo.kod} — ${h.depo.ad}`, hareket: h.kaynakTur === "uretim_sarf" ? "Üretim sarfı" : h.kaynakTur === "uretim_giris" ? "Üretim girişi" : HAREKET_ADI[h.tip] ?? h.tip, ...kaynakEtiketi(h, belgeler), giris: m.gt(0) ? m.toFixed(3) : "0", cikis: m.lt(0) ? m.abs().toFixed(3) : "0", ...maliyetHucreleri(m, h.maliyet), aciklama: `${h.aciklama ?? ""}${iptalCiftiMi(h, iptaller) ? " (iptal)" : ""}` }; });
  },
});

/**
 * RPR-13 (inceleme P1-6): ciro, ana birimde miktar ve maliyet ortak satış
 * kaynağından (`satis-ozeti.ts`, satış anındaki hareket maliyeti). Önceden
 * kartın bugünkü ortalama maliyeti × satır miktarı (ek birim çevrilmeden)
 * kullanılıyordu. Ürün ve alıcı süzgeci satırlara uygulanır.
 */
async function satisVerisi(tx: Prisma.TransactionClient, f: Record<string, unknown>) {
  return (await satisSatirlari(tx, tarihAraligi(f.baslangic, f.bitis)))
    .filter((s) => (!f.stok || s.stokId === String(f.stok)) && (!f.cari || s.cariId === String(f.cari)));
}

registerRapor({
  kod: "urun-hareket.urun-satislari", modul: "urun_hareket", ad: "Ürün Satışları", aciklama: "Kesin satış faturalarına göre ürün miktarı (ana birim), net satış, satış anındaki maliyet ve kârlılık; maliyeti bilinmeyen ciro ayrı",
  filtreler: [...TARIH, { alan: "stok", ad: "Ürün", tip: "stok" }, { alan: "cari", ad: "Alıcı", tip: "cari" }],
  // RPR-26
  grafik: { tur: "yatay", kategori: "urun", seriler: ["netSatis"], enCok: 10 },
  kolonlar: [{ alan: "kod", baslik: "Kod", tip: "metin" }, { alan: "urun", baslik: "Ürün", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } }, { alan: "satisMiktari", baslik: "Satış", tip: "sayi" }, { alan: "iadeMiktari", baslik: "İade", tip: "sayi" }, { alan: "netMiktar", baslik: "Net Miktar", tip: "sayi" }, { alan: "aliciSayisi", baslik: "Alıcı", tip: "sayi" }, { alan: "netSatis", baslik: "Net Satış", tip: "para", toplam: true }, { alan: "maliyet", baslik: "Maliyet", tip: "para", toplam: true }, { alan: "kar", baslik: "Kâr", tip: "para", toplam: true }, { alan: "karOrani", baslik: "Kâr Oranı", tip: "yuzde" }, { alan: "maliyetsizCiro", baslik: "Maliyeti Bilinmeyen Ciro", tip: "para", toplam: true }],
  async calistir(girdi, { tx }) {
    const gruplar = new Map<string, { stokId: string; kod: string; urun: string; satis: Prisma.Decimal; iade: Prisma.Decimal; net: Prisma.Decimal; maliyet: Prisma.Decimal; maliyetsiz: Prisma.Decimal; alicilar: Set<string> }>();
    for (const s of await satisVerisi(tx, girdi.filtreler ?? {})) {
      const g = gruplar.get(s.stokId) ?? { stokId: s.stokId, kod: s.kod, urun: s.ad, satis: D(0), iade: D(0), net: D(0), maliyet: D(0), maliyetsiz: D(0), alicilar: new Set<string>() };
      if (s.tip === "satis") g.satis = g.satis.add(s.miktar); else g.iade = g.iade.add(s.miktar.abs());
      g.net = g.net.add(s.ciro);
      g.maliyet = g.maliyet.add(s.maliyet);
      if (maliyetBilinmiyor(s)) g.maliyetsiz = g.maliyetsiz.add(s.ciro);
      g.alicilar.add(s.cariId);
      gruplar.set(s.stokId, g);
    }
    return [...gruplar.values()].map((g) => ({ stokId: g.stokId, kod: g.kod, urun: g.urun, satisMiktari: g.satis.toFixed(3), iadeMiktari: g.iade.toFixed(3), netMiktar: g.satis.sub(g.iade).toFixed(3), aliciSayisi: g.alicilar.size, netSatis: g.net.toFixed(2), maliyet: g.maliyet.toFixed(2), kar: g.net.sub(g.maliyet).toFixed(2), karOrani: bilinenMarj(g.net, g.maliyet, g.maliyetsiz), maliyetsizCiro: g.maliyetsiz.toFixed(2) }));
  },
});

registerRapor({
  kod: "urun-hareket.alici-urun", modul: "urun_hareket", ad: "Alıcı Bazlı Satışlar", aciklama: "Hangi alıcının hangi ürünü ne kadar (ana birim) ve hangi ortalama fiyatla aldığını gösterir; kâr satış anındaki maliyetle",
  filtreler: [...TARIH, { alan: "cari", ad: "Alıcı", tip: "cari" }, { alan: "stok", ad: "Ürün", tip: "stok" }],
  kolonlar: [{ alan: "cariKod", baslik: "Cari Kod", tip: "metin" }, { alan: "alici", baslik: "Alıcı", tip: "metin", kayit: { tur: "cari", idAlani: "cariId" } }, { alan: "urunKod", baslik: "Ürün Kod", tip: "metin" }, { alan: "urun", baslik: "Ürün", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } }, { alan: "sonAlis", baslik: "Son Alış", tip: "tarih" }, { alan: "faturaSayisi", baslik: "Fatura", tip: "sayi", toplam: true }, { alan: "netMiktar", baslik: "Net Miktar", tip: "sayi" }, { alan: "ortalamaFiyat", baslik: "Ort. Fiyat", tip: "para" }, { alan: "netSatis", baslik: "Net Satış", tip: "para", toplam: true }, { alan: "kar", baslik: "Kâr", tip: "para", toplam: true }, { alan: "maliyetsizCiro", baslik: "Maliyeti Bilinmeyen Ciro", tip: "para", toplam: true }],
  async calistir(girdi, { tx }) {
    const gruplar = new Map<string, { cariId: string; stokId: string; cariKod: string; alici: string; urunKod: string; urun: string; son: Date; faturalar: Set<string>; miktar: Prisma.Decimal; satis: Prisma.Decimal; maliyet: Prisma.Decimal; maliyetsiz: Prisma.Decimal }>();
    for (const s of await satisVerisi(tx, girdi.filtreler ?? {})) {
      const anahtar = `${s.cariId}:${s.stokId}`;
      const g = gruplar.get(anahtar) ?? { cariId: s.cariId, stokId: s.stokId, cariKod: s.cariKod, alici: s.cariUnvan, urunKod: s.kod, urun: s.ad, son: s.tarih, faturalar: new Set<string>(), miktar: D(0), satis: D(0), maliyet: D(0), maliyetsiz: D(0) };
      if (s.tarih > g.son) g.son = s.tarih;
      g.faturalar.add(s.faturaId);
      g.miktar = g.miktar.add(s.miktar);
      g.satis = g.satis.add(s.ciro);
      g.maliyet = g.maliyet.add(s.maliyet);
      if (maliyetBilinmiyor(s)) g.maliyetsiz = g.maliyetsiz.add(s.ciro);
      gruplar.set(anahtar, g);
    }
    return [...gruplar.values()].map((g) => ({ cariId: g.cariId, stokId: g.stokId, cariKod: g.cariKod, alici: g.alici, urunKod: g.urunKod, urun: g.urun, sonAlis: g.son.toISOString().slice(0, 10), faturaSayisi: g.faturalar.size, netMiktar: g.miktar.toFixed(3), ortalamaFiyat: g.miktar.eq(0) ? "0" : g.satis.div(g.miktar).toFixed(2), netSatis: g.satis.toFixed(2), kar: g.satis.sub(g.maliyet).toFixed(2), maliyetsizCiro: g.maliyetsiz.toFixed(2) }));
  },
});
