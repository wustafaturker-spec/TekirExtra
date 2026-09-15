import { Prisma } from "@prisma/client";
import { registerRapor } from "../core/raporlar/rapor-kayit";
import { iptalCiftiMi, iptalEdilmisFaturalar, iptalleriGoster } from "../fatura/iptal-cifti";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const tarihAraligi = (baslangic?: unknown, bitis?: unknown) => ({ ...(baslangic ? { gte: new Date(String(baslangic)) } : {}), ...(bitis ? { lte: new Date(String(bitis)) } : {}) });
const TARIH = [{ alan: "baslangic", ad: "Başlangıç", tip: "tarih" as const }, { alan: "bitis", ad: "Bitiş", tip: "tarih" as const }];
const HAREKET_ADI: Record<string, string> = { giris: "Giriş", cikis: "Çıkış", sayim_duzeltme: "Sayım düzeltme", fire: "Fire", zayi: "Zayi", numune: "Numune", promosyon: "Promosyon", acilis: "Açılış", transfer_cikis: "Transfer çıkış", transfer_giris: "Transfer giriş" };

function hareketGrubu(h: { tip: string; kaynakTur: string }) {
  if (h.kaynakTur === "uretim_sarf" || h.kaynakTur === "uretim_giris") return "uretim";
  if (h.tip === "fire" || h.tip === "zayi") return "fire";
  if (h.tip.startsWith("transfer_")) return "transfer";
  if (h.tip === "sayim_duzeltme") return "sayim";
  return ["giris", "acilis"].includes(h.tip) ? "giris" : "cikis";
}

registerRapor({
  kod: "urun-hareket.hareketler", modul: "urun_hareket", ad: "Hareketler", aciklama: "Tüm giriş, çıkış, fire, transfer ve üretim hareketlerinin tarih sıralı dökümü",
  filtreler: [...TARIH, { alan: "stok", ad: "Ürün", tip: "stok" }, { alan: "depo", ad: "Depo", tip: "depo" }, { alan: "grup", ad: "Hareket Grubu", tip: "secim", secenekler: [{ deger: "giris", ad: "Girişler" }, { deger: "cikis", ad: "Çıkışlar" }, { deger: "fire", ad: "Fire / Zayi" }, { deger: "uretim", ad: "Üretim" }, { deger: "transfer", ad: "Transfer" }, { deger: "sayim", ad: "Sayım" }] }, { alan: "iptaller", ad: "İptalleri de göster", tip: "onay" }],
  kolonlar: [{ alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "kod", baslik: "Kod", tip: "metin" }, { alan: "urun", baslik: "Ürün / Varyant", tip: "metin" }, { alan: "depo", baslik: "Depo", tip: "metin" }, { alan: "hareket", baslik: "Hareket", tip: "metin" }, { alan: "kaynak", baslik: "Kaynak", tip: "metin" }, { alan: "giris", baslik: "Giriş", tip: "sayi" }, { alan: "cikis", baslik: "Çıkış", tip: "sayi" }, { alan: "birimMaliyet", baslik: "Birim Maliyet", tip: "para" }, { alan: "toplamMaliyet", baslik: "Toplam Maliyet", tip: "para" }, { alan: "aciklama", baslik: "Açıklama", tip: "metin" }],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hareketler = await tx.stokHareket.findMany({ where: { tarih: tarihAraligi(f.baslangic, f.bitis), ...(f.stok ? { stokId: String(f.stok) } : {}), ...(f.depo ? { depoId: String(f.depo) } : {}) }, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], include: { stok: { select: { kod: true, ad: true, anaBirim: true } }, varyant: { select: { kod: true, ad: true } }, depo: { select: { kod: true, ad: true } } } });
    // STK-22: iptal edilmiş faturanın hareketleri seçenek işaretlenmedikçe gösterilmez.
    const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
    return hareketler.filter((h) => (iptalleriGoster(f.iptaller) || !iptalCiftiMi(h, iptaller)) && (!f.grup || hareketGrubu(h) === f.grup)).map((h) => { const m = D(h.miktar); return { tarih: h.tarih.toISOString().slice(0, 10), kod: h.stok.kod, urun: `${h.stok.ad}${h.varyant ? ` / ${h.varyant.kod} — ${h.varyant.ad}` : ""}`, depo: `${h.depo.kod} — ${h.depo.ad}`, hareket: h.kaynakTur === "uretim_sarf" ? "Üretim sarfı" : h.kaynakTur === "uretim_giris" ? "Üretim girişi" : HAREKET_ADI[h.tip] ?? h.tip, kaynak: `${h.kaynakTur}${h.kaynakRef ? ` · ${h.kaynakRef}` : ""}`, giris: m.gt(0) ? m.toFixed(3) : "0", cikis: m.lt(0) ? m.abs().toFixed(3) : "0", birimMaliyet: h.maliyet.toFixed(4), toplamMaliyet: m.abs().mul(h.maliyet).toFixed(2), aciklama: `${h.aciklama ?? ""}${iptalCiftiMi(h, iptaller) ? " (iptal)" : ""}` }; });
  },
});

async function satisVerisi(tx: Prisma.TransactionClient, f: Record<string, unknown>) {
  return tx.faturaSatir.findMany({ where: { ...(f.stok ? { stokId: String(f.stok) } : {}), fatura: { durum: "kesin", tip: { in: ["satis", "satis_iade"] }, tarih: tarihAraligi(f.baslangic, f.bitis), ...(f.cari ? { cariId: String(f.cari) } : {}) } }, include: { stok: { select: { kod: true, ad: true, ortalamaMaliyet: true } }, fatura: { select: { id: true, tip: true, tarih: true, kur: true, cari: { select: { id: true, kod: true, unvan: true } } } } } });
}

registerRapor({
  kod: "urun-hareket.urun-satislari", modul: "urun_hareket", ad: "Ürün Satışları", aciklama: "Kesin satış faturalarına göre ürün miktarı, net satış, maliyet ve kârlılık",
  filtreler: [...TARIH, { alan: "stok", ad: "Ürün", tip: "stok" }, { alan: "cari", ad: "Alıcı", tip: "cari" }],
  kolonlar: [{ alan: "kod", baslik: "Kod", tip: "metin" }, { alan: "urun", baslik: "Ürün", tip: "metin" }, { alan: "satisMiktari", baslik: "Satış", tip: "sayi" }, { alan: "iadeMiktari", baslik: "İade", tip: "sayi" }, { alan: "netMiktar", baslik: "Net Miktar", tip: "sayi" }, { alan: "aliciSayisi", baslik: "Alıcı", tip: "sayi" }, { alan: "netSatis", baslik: "Net Satış", tip: "para" }, { alan: "maliyet", baslik: "Maliyet", tip: "para" }, { alan: "kar", baslik: "Kâr", tip: "para" }, { alan: "karOrani", baslik: "Kâr Oranı", tip: "yuzde" }],
  async calistir(girdi, { tx }) {
    const satirlar = await satisVerisi(tx, girdi.filtreler ?? {}); const gruplar = new Map<string, { kod: string; urun: string; satis: Prisma.Decimal; iade: Prisma.Decimal; net: Prisma.Decimal; maliyet: Prisma.Decimal; alicilar: Set<string> }>();
    for (const s of satirlar) { const yon = s.fatura.tip === "satis" ? D(1) : D(-1); const g = gruplar.get(s.stokId) ?? { kod: s.stok.kod, urun: s.stok.ad, satis: D(0), iade: D(0), net: D(0), maliyet: D(0), alicilar: new Set<string>() }; const tutar = s.matrah.mul(s.fatura.kur).mul(yon); if (yon.gt(0)) g.satis = g.satis.add(s.miktar); else g.iade = g.iade.add(s.miktar); g.net = g.net.add(tutar); g.maliyet = g.maliyet.add(s.miktar.mul(s.stok.ortalamaMaliyet).mul(yon)); g.alicilar.add(s.fatura.cari.id); gruplar.set(s.stokId, g); }
    return [...gruplar.values()].map((g) => { const kar = g.net.sub(g.maliyet); return { kod: g.kod, urun: g.urun, satisMiktari: g.satis.toFixed(3), iadeMiktari: g.iade.toFixed(3), netMiktar: g.satis.sub(g.iade).toFixed(3), aliciSayisi: g.alicilar.size, netSatis: g.net.toFixed(2), maliyet: g.maliyet.toFixed(2), kar: kar.toFixed(2), karOrani: g.net.eq(0) ? 0 : Number(kar.div(g.net).mul(100).toFixed(2)) }; });
  },
});

registerRapor({
  kod: "urun-hareket.alici-urun", modul: "urun_hareket", ad: "Alıcı Bazlı Satışlar", aciklama: "Hangi alıcının hangi ürünü ne kadar ve hangi ortalama fiyatla aldığını gösterir",
  filtreler: [...TARIH, { alan: "cari", ad: "Alıcı", tip: "cari" }, { alan: "stok", ad: "Ürün", tip: "stok" }],
  kolonlar: [{ alan: "cariKod", baslik: "Cari Kod", tip: "metin" }, { alan: "alici", baslik: "Alıcı", tip: "metin" }, { alan: "urunKod", baslik: "Ürün Kod", tip: "metin" }, { alan: "urun", baslik: "Ürün", tip: "metin" }, { alan: "sonAlis", baslik: "Son Alış", tip: "tarih" }, { alan: "faturaSayisi", baslik: "Fatura", tip: "sayi" }, { alan: "netMiktar", baslik: "Net Miktar", tip: "sayi" }, { alan: "ortalamaFiyat", baslik: "Ort. Fiyat", tip: "para" }, { alan: "netSatis", baslik: "Net Satış", tip: "para" }, { alan: "kar", baslik: "Kâr", tip: "para" }],
  async calistir(girdi, { tx }) {
    const satirlar = await satisVerisi(tx, girdi.filtreler ?? {}); const gruplar = new Map<string, { cariKod: string; alici: string; urunKod: string; urun: string; son: Date; faturalar: Set<string>; miktar: Prisma.Decimal; satis: Prisma.Decimal; maliyet: Prisma.Decimal }>();
    for (const s of satirlar) { const anahtar = `${s.fatura.cari.id}:${s.stokId}`; const yon = s.fatura.tip === "satis" ? D(1) : D(-1); const g = gruplar.get(anahtar) ?? { cariKod: s.fatura.cari.kod, alici: s.fatura.cari.unvan, urunKod: s.stok.kod, urun: s.stok.ad, son: s.fatura.tarih, faturalar: new Set<string>(), miktar: D(0), satis: D(0), maliyet: D(0) }; if (s.fatura.tarih > g.son) g.son = s.fatura.tarih; g.faturalar.add(s.fatura.id); g.miktar = g.miktar.add(s.miktar.mul(yon)); g.satis = g.satis.add(s.matrah.mul(s.fatura.kur).mul(yon)); g.maliyet = g.maliyet.add(s.miktar.mul(s.stok.ortalamaMaliyet).mul(yon)); gruplar.set(anahtar, g); }
    return [...gruplar.values()].map((g) => ({ cariKod: g.cariKod, alici: g.alici, urunKod: g.urunKod, urun: g.urun, sonAlis: g.son.toISOString().slice(0, 10), faturaSayisi: g.faturalar.size, netMiktar: g.miktar.toFixed(3), ortalamaFiyat: g.miktar.eq(0) ? "0" : g.satis.div(g.miktar).toFixed(2), netSatis: g.satis.toFixed(2), kar: g.satis.sub(g.maliyet).toFixed(2) }));
  },
});
