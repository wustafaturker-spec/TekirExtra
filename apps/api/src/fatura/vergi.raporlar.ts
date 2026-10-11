import { Prisma } from "@prisma/client";
import type { Rol } from "@tekirextra/shared";
import { registerRapor, type RaporFiltreDegerleri, type RaporSatiri } from "../core/raporlar/rapor-kayit";
import type { EkVergi } from "./ek-vergi";

/**
 * RPR-09: KDV dışı vergiler raporu (ÖTV, ÖİV, konaklama, BSMV, stopaj…).
 * Kaynak kesin satış ve alış faturalarının satırlarında saklı vergilerdir
 * (`fatura_satirlari.ek_vergiler`; davranış kaydedildiği gündeki Mevzuat
 * kaydından). İade ve proformada bu vergiler taşınmaz (EBLG-126).
 *
 * Dört kova beyan mantığını izler: satışta bedele eklenen vergi tahsil
 * edilir ve beyan edilip ödenir; alışta ödenen vergi maliyete girmiştir
 * (bilgi); alışta kestiğimiz stopaj muhtasarla beyan edilir; satışta
 * müşterinin kestiği stopaj geçici/yıllık vergiden mahsup edilir.
 */

export type VergiKovasi = "tahsil" | "odenen" | "kestigimiz_stopaj" | "kesilen_stopaj";

export const KOVA_ADLARI: Record<VergiKovasi, string> = {
  tahsil: "Tahsil edilen",
  odenen: "Ödenen",
  kestigimiz_stopaj: "Kestiğimiz stopaj",
  kesilen_stopaj: "Bizden kesilen stopaj",
};

export const vergiKovasi = (tip: string, stopaj: boolean): VergiKovasi =>
  tip === "satis" ? (stopaj ? "kesilen_stopaj" : "tahsil") : stopaj ? "kestigimiz_stopaj" : "odenen";

/** Vergi hazırlığı muhasebenin işidir; mali müşavir beyanı hazırlar. */
const ROLLER: readonly Rol[] = ["yonetici", "muhasebe", "mali_musavir"];

const FILTRELER = [
  { alan: "baslangic", ad: "Başlangıç", tip: "tarih" as const, zorunlu: true },
  { alan: "bitis", ad: "Bitiş", tip: "tarih" as const, zorunlu: true },
  {
    alan: "kova",
    ad: "Kova",
    tip: "secim" as const,
    secenekler: (Object.keys(KOVA_ADLARI) as VergiKovasi[]).map((deger) => ({ deger, ad: KOVA_ADLARI[deger] })),
  },
  // Kod listesi Mevzuat'ta değişebildiği için seçim değil serbest kod (ör. 0071).
  { alan: "vergiKodu", ad: "Vergi türü kodu", tip: "metin" as const },
  { alan: "cariId", ad: "Cari", tip: "cari" as const },
];

const D = (deger: string | number | Prisma.Decimal) => new Prisma.Decimal(deger);
const tarihMetni = (t: Date) => t.toISOString().slice(0, 10);

export interface VergiKalemi {
  faturaId: string;
  faturaNo: string;
  tarih: string;
  cariId: string;
  stokId: string;
  cari: string;
  urun: string;
  kova: VergiKovasi;
  kod: string;
  ad: string;
  hesap: "oran" | "birim" | null;
  oran: string | null;
  birimTutar: string | null;
  birim: string;
  dovizCinsi: string;
  kur: Prisma.Decimal;
  matrah: Prisma.Decimal;
  tutar: Prisma.Decimal;
}

/** Filtredeki dönemin kesin faturalarındaki vergi kalemleri (vergi başına bir kalem). */
export async function vergiKalemleri(f: RaporFiltreDegerleri, tx: Prisma.TransactionClient): Promise<VergiKalemi[]> {
  const satirlar = await tx.faturaSatir.findMany({
    where: {
      OR: [{ ekVergiTutari: { gt: 0 } }, { stopajTutari: { gt: 0 } }],
      fatura: {
        durum: "kesin",
        tip: { in: ["satis", "alis"] },
        tarih: { gte: new Date(String(f.baslangic)), lte: new Date(`${String(f.bitis)}T23:59:59.999Z`) },
        ...(f.cariId ? { cariId: String(f.cariId) } : {}),
      },
    },
    select: {
      matrah: true,
      birim: true,
      ekVergiler: true,
      stokId: true,
      stok: { select: { kod: true, ad: true } },
      fatura: { select: { id: true, no: true, tarih: true, tip: true, kur: true, dovizCinsi: true, cari: { select: { id: true, unvan: true } } } },
    },
    orderBy: [{ fatura: { tarih: "asc" } }, { fatura: { no: "asc" } }],
  });
  const kodFiltresi = typeof f.vergiKodu === "string" ? f.vergiKodu.trim() : "";
  return satirlar.flatMap((s) => (Array.isArray(s.ekVergiler) ? (s.ekVergiler as unknown as EkVergi[]) : []).map((v): VergiKalemi => ({
    faturaId: s.fatura.id,
    // Kesin ama e-Belge gönderilmemiş fatura numarayı gönderimde alır.
    faturaNo: s.fatura.no ?? "Numarasız",
    tarih: tarihMetni(s.fatura.tarih),
    cariId: s.fatura.cari.id,
    stokId: s.stokId,
    cari: s.fatura.cari.unvan,
    urun: `${s.stok.kod} · ${s.stok.ad}`,
    kova: vergiKovasi(s.fatura.tip, v.stopaj),
    kod: v.kod,
    ad: v.ad,
    hesap: v.hesap ?? null,
    oran: v.oran ?? null,
    birimTutar: v.birimTutar ?? null,
    // EBLG-131: maktu vergi kartın ana birimi başınadır.
    birim: v.anaBirim ?? s.birim,
    dovizCinsi: String(s.fatura.dovizCinsi),
    kur: s.fatura.kur,
    // Oranlı vergide saklı matrah satır matrahıdır; maktu ve belgedeki tutarda satır matrahı gösterilir.
    matrah: D(v.matrah ?? s.matrah),
    tutar: D(v.tutar),
  })))
    .filter((k) => (!f.kova || k.kova === f.kova) && (!kodFiltresi || k.kod === kodFiltresi));
}

const vergiEtiketi = (k: { kod: string; ad: string }) => `${k.kod} · ${k.ad}`;

/** Oran (%25), birim başı tutar (12,50 / lt) ya da belgedeki tutar. */
function oranMetni(k: VergiKalemi): string {
  const sayi = (d: string) => Number(d).toLocaleString("tr-TR", { maximumFractionDigits: 6 });
  if (k.hesap === "birim" && k.birimTutar) return `${sayi(k.birimTutar)} ${k.dovizCinsi === "TRY" ? "TL" : k.dovizCinsi} / ${k.birim}`;
  if (k.oran) return `%${sayi(k.oran)}`;
  return "Belgedeki tutar";
}

registerRapor({
  kod: "vergi.kdv-disi-ozet",
  modul: "vergi",
  ad: "KDV Dışı Vergiler — Özet",
  aciklama:
    "Kesin satış ve alış faturalarındaki ÖTV, ÖİV, konaklama, stopaj vb.; tahsil edilen, ödenen, kestiğimiz ve bizden kesilen stopaj ayrı. Tutarlar fatura kuruyla TL.",
  roller: ROLLER,
  filtreler: FILTRELER,
  gruplamalar: [
    { deger: "ay", ad: "Vergi türü × ay" },
    { deger: "vergi", ad: "Vergi türü (dönem toplamı)" },
    { deger: "cari", ad: "Cari × vergi türü" },
  ],
  kolonlar: [
    { alan: "grup", baslik: "Dönem / Cari", tip: "metin" },
    { alan: "kova", baslik: "Kova", tip: "metin" },
    { alan: "vergi", baslik: "Vergi türü", tip: "metin" },
    { alan: "faturaSayisi", baslik: "Fatura", tip: "sayi" },
    { alan: "matrah", baslik: "Matrah (TL)", tip: "para" },
    { alan: "tutar", baslik: "Vergi (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const gruplama = girdi.gruplama ?? "ay";
    const kalemler = await vergiKalemleri(girdi.filtreler ?? {}, tx);
    const kovaSirasi = Object.keys(KOVA_ADLARI);
    type Grup = { grup: string; kova: VergiKovasi; vergi: string; faturalar: Set<string>; matrah: Prisma.Decimal; tutar: Prisma.Decimal };
    const ekle = (harita: Map<string, Grup>, grup: string, k: VergiKalemi) => {
      const anahtar = `${grup}|${k.kova}|${k.kod}`;
      const g = harita.get(anahtar) ?? { grup, kova: k.kova, vergi: vergiEtiketi(k), faturalar: new Set<string>(), matrah: D(0), tutar: D(0) };
      g.faturalar.add(k.faturaId);
      g.matrah = g.matrah.add(k.matrah.mul(k.kur));
      g.tutar = g.tutar.add(k.tutar.mul(k.kur));
      harita.set(anahtar, g);
    };
    const gruplar = new Map<string, Grup>();
    const toplamlar = new Map<string, Grup>();
    for (const k of kalemler) {
      ekle(gruplar, gruplama === "cari" ? k.cari : gruplama === "vergi" ? "Dönem" : k.tarih.slice(0, 7), k);
      if (gruplama !== "vergi") ekle(toplamlar, "Dönem toplamı", k);
    }
    const satir = (g: Grup): RaporSatiri => ({
      grup: g.grup,
      kova: KOVA_ADLARI[g.kova],
      vergi: g.vergi,
      faturaSayisi: g.faturalar.size,
      matrah: g.matrah.toFixed(2),
      tutar: g.tutar.toFixed(2),
    });
    const sirala = (a: Grup, b: Grup) =>
      a.grup.localeCompare(b.grup, "tr") || kovaSirasi.indexOf(a.kova) - kovaSirasi.indexOf(b.kova) || a.vergi.localeCompare(b.vergi, "tr");
    // Dönem toplamları en altta: beyan hazırlığında kova × vergi türü toplamı aranır.
    return [...[...gruplar.values()].sort(sirala), ...[...toplamlar.values()].sort(sirala)].map(satir);
  },
});

registerRapor({
  kod: "vergi.kdv-disi-ayrinti",
  modul: "vergi",
  ad: "KDV Dışı Vergiler — Ayrıntı",
  aciklama: "Fatura satırı başına her vergi; tutar belge dövizinde ve TL karşılığıyla. Ekranda fatura numarası faturayı açar.",
  roller: ROLLER,
  filtreler: FILTRELER,
  kolonlar: [
    { alan: "tarih", baslik: "Tarih", tip: "tarih" },
    { alan: "faturaNo", baslik: "Fatura", tip: "metin", baglantiAlani: "faturaYolu" },
    { alan: "cari", baslik: "Cari", tip: "metin", kayit: { tur: "cari", idAlani: "cariId" } },
    { alan: "urun", baslik: "Ürün / hizmet", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "kova", baslik: "Kova", tip: "metin" },
    { alan: "vergi", baslik: "Vergi türü", tip: "metin" },
    { alan: "oran", baslik: "Oran / birim", tip: "metin" },
    { alan: "matrah", baslik: "Matrah", tip: "para", dovizAlani: "dovizCinsi" },
    { alan: "tutar", baslik: "Vergi", tip: "para", dovizAlani: "dovizCinsi" },
    { alan: "tutarTl", baslik: "Vergi (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    return (await vergiKalemleri(girdi.filtreler ?? {}, tx)).map((k) => ({
      tarih: k.tarih,
      faturaNo: k.faturaNo,
      faturaYolu: `/panel/fatura/yeni?ac=${k.faturaId}`,
      cariId: k.cariId,
      cari: k.cari,
      stokId: k.stokId,
      urun: k.urun,
      kova: KOVA_ADLARI[k.kova],
      vergi: vergiEtiketi(k),
      oran: oranMetni(k),
      matrah: k.matrah.toFixed(2),
      tutar: k.tutar.toFixed(2),
      dovizCinsi: k.dovizCinsi,
      tutarTl: k.tutar.mul(k.kur).toFixed(2),
    }));
  },
});
