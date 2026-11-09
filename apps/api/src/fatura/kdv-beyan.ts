/**
 * RPR-13 (2026-10-11, rapor incelemesi P1-3): KDV-1 ön analizi ve KDV dökümü
 * tek hesaptan. Önceden döküm her iki yönde net (tevkifat düşülmüş) KDV'yi,
 * ön analiz tevkifatlı alışta tam KDV'yi alıyordu; tevkifatlı alışı olan
 * dönemde iki ekran farklı indirilecek KDV veriyordu.
 *
 * Beyannamedeki yerleşim:
 * - Hesaplanan: satış (tevkifatlıda satıcı payı) + alıştan iade faturasında
 *   hesapladığımız KDV.
 * - İndirilecek: alışın tam KDV'si (tevkifatlı dahil; kestiğimiz kısmı KDV-2
 *   ile ödediğimiz için indiririz) + satıştan iadede geri verdiğimiz KDV.
 * - KDV-2: alışta kestiğimiz tevkifat; ayrıca beyan edilip ödenir.
 * - Bilgi: alıcının kestiği tevkifat (alıcı beyan eder), ihraç kayıtlı alış
 *   (indirilmez, EBLG-114) ve satış (tahsil edilmez) KDV'si.
 * Özel matrahlı faturanın KDV'si satırlarda değil belgededir; ayrı satırdır.
 * Tutarlar fatura kuruyla TL.
 */
import { Prisma } from "@prisma/client";
import { kdvMatrahinaDahilToplam } from "./ek-vergi";

export type KdvBeyanYonu =
  | "hesaplanan_satis"
  | "hesaplanan_alis_iade"
  | "indirilecek_alis"
  | "indirilecek_satis_iade"
  | "kdv2_tevkifat"
  | "bilgi_alici_tevkifati"
  | "bilgi_ihrac_kayitli_alis"
  | "bilgi_ihrac_kayitli_satis";

export const KDV_BEYAN_YONLERI: Record<KdvBeyanYonu, string> = {
  hesaplanan_satis: "Hesaplanan · satış",
  hesaplanan_alis_iade: "Hesaplanan · alıştan iade",
  indirilecek_alis: "İndirilecek · alış",
  indirilecek_satis_iade: "İndirilecek · satıştan iade",
  kdv2_tevkifat: "KDV-2 · kestiğimiz tevkifat",
  bilgi_alici_tevkifati: "Bilgi · alıcının kestiği tevkifat",
  bilgi_ihrac_kayitli_alis: "Bilgi · ihraç kayıtlı alış (indirilmez)",
  bilgi_ihrac_kayitli_satis: "Bilgi · ihraç kayıtlı satış (tahsil edilmez)",
};

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface KdvBeyanFaturasi {
  tip: string;
  kur: Prisma.Decimal.Value;
  ihracKayitliKodu: string | null;
  ozelMatrahKodu?: string | null;
  ozelMatrahTutari?: Prisma.Decimal.Value | null;
  ozelMatrahOrani?: Prisma.Decimal.Value | null;
  toplamNetKdv: Prisma.Decimal.Value;
  satirlar: { kdvOrani: Prisma.Decimal.Value; matrah: Prisma.Decimal.Value; kdvTutari: Prisma.Decimal.Value; tevkifatTutari: Prisma.Decimal.Value; netKdvTutari: Prisma.Decimal.Value; ekVergiler?: unknown }[];
}

export interface KdvBeyanSatiri { yon: KdvBeyanYonu; kdvOrani: number; matrah: Prisma.Decimal; kdv: Prisma.Decimal }

/** Fatura satırlarından yön × oran kırılımı (TL). */
export function kdvBeyanSatirlari(faturalar: KdvBeyanFaturasi[]): KdvBeyanSatiri[] {
  const harita = new Map<string, KdvBeyanSatiri>();
  const ekle = (yon: KdvBeyanYonu, oran: Prisma.Decimal.Value, matrah: Prisma.Decimal, kdv: Prisma.Decimal) => {
    if (matrah.isZero() && kdv.isZero()) return;
    const anahtar = `${yon}|${Number(oran)}`;
    const s = harita.get(anahtar) ?? { yon, kdvOrani: Number(oran), matrah: D(0), kdv: D(0) };
    s.matrah = s.matrah.add(matrah);
    s.kdv = s.kdv.add(kdv);
    harita.set(anahtar, s);
  };
  for (const f of faturalar) {
    const kur = D(f.kur || 1);
    let satirNet = D(0);
    for (const s of f.satirlar) {
      // EBLG-128: KDV matrahı, matraha dahil vergilerle (ÖTV…) birlikte.
      const matrah = D(s.matrah).add(kdvMatrahinaDahilToplam(s.ekVergiler)).mul(kur);
      const net = D(s.netKdvTutari).mul(kur);
      const tevkifat = D(s.tevkifatTutari).mul(kur);
      satirNet = satirNet.add(D(s.netKdvTutari));
      if (f.tip === "satis") {
        if (f.ihracKayitliKodu) ekle("bilgi_ihrac_kayitli_satis", s.kdvOrani, matrah, D(s.kdvTutari).mul(kur));
        else ekle("hesaplanan_satis", s.kdvOrani, matrah, net);
        if (!tevkifat.isZero()) ekle("bilgi_alici_tevkifati", s.kdvOrani, D(0), tevkifat);
      } else if (f.tip === "alis_iade") {
        ekle("hesaplanan_alis_iade", s.kdvOrani, matrah, net);
      } else if (f.tip === "satis_iade") {
        ekle("indirilecek_satis_iade", s.kdvOrani, matrah, net);
      } else if (f.tip === "alis") {
        if (f.ihracKayitliKodu) ekle("bilgi_ihrac_kayitli_alis", s.kdvOrani, matrah, D(s.kdvTutari).mul(kur));
        else {
          ekle("indirilecek_alis", s.kdvOrani, matrah, net.add(tevkifat));
          if (!tevkifat.isZero()) ekle("kdv2_tevkifat", s.kdvOrani, D(0), tevkifat);
        }
      }
    }
    // Özel matrah: KDV belgede (toplam net KDV − satırlar); matrah özel matrahtır.
    const ozelKdv = D(f.toplamNetKdv).sub(satirNet);
    if (f.ozelMatrahKodu && !ozelKdv.isZero()) {
      const yon: KdvBeyanYonu | null = f.tip === "satis" ? "hesaplanan_satis" : f.tip === "alis" ? "indirilecek_alis" : null;
      if (yon) ekle(yon, f.ozelMatrahOrani ?? 0, D(f.ozelMatrahTutari ?? 0).mul(kur), ozelKdv.mul(kur));
    }
  }
  const sira = Object.keys(KDV_BEYAN_YONLERI);
  return [...harita.values()].sort((a, b) => sira.indexOf(a.yon) - sira.indexOf(b.yon) || a.kdvOrani - b.kdvOrani);
}

/** Yöne göre toplam KDV (TL, kuruşa yuvarlı). */
export function kdvBeyanToplami(satirlar: KdvBeyanSatiri[], yon: KdvBeyanYonu): number {
  return Math.round(satirlar.filter((s) => s.yon === yon).reduce((t, s) => t.add(s.kdv), D(0)).toNumber() * 100) / 100;
}

/** Kesin faturaları hesap için okur. */
export function kdvBeyanFaturalari(tx: Prisma.TransactionClient, tarih: Prisma.DateTimeFilter) {
  return tx.fatura.findMany({
    where: { durum: "kesin", tip: { in: ["satis", "alis", "satis_iade", "alis_iade"] }, tarih },
    select: {
      tarih: true, tip: true, kur: true, ihracKayitliKodu: true, ozelMatrahKodu: true, ozelMatrahTutari: true, ozelMatrahOrani: true, toplamNetKdv: true,
      satirlar: { select: { kdvOrani: true, matrah: true, kdvTutari: true, tevkifatTutari: true, netKdvTutari: true, ekVergiler: true } },
    },
  });
}
