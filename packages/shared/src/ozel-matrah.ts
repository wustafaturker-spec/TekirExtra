/**
 * Özel matrah faturası (KDV Kanunu 23. madde; tasarım tablosu §3.9).
 *
 * Kaynak: GİB resmî örneği `docs/e-belge/…/UBL-TR 1.2.1/XSLT/OZELMATRAH.xml` ve
 * UBL-TR Kod Listeleri v1.26. Bu faturada verginin matrahı satış bedeli
 * değildir: ikinci el araç/taşınmazda alış ile satış arasındaki fark (812),
 * müzayedede komisyon, bayi işlerinde sıfırdır. Satırlar KDV'siz yazılır,
 * hesaplanan KDV yalnız özel matrah üzerinden doğar (`InvoiceTypeCode`
 * OZELMATRAH; profil normal kalır).
 *
 * Karar (2026-09-20): kod ve matrah **fatura formunda** girilir (e-Arşiv'de de
 * geçerlidir ve toplamları anlatır), matrahı kullanıcı yazar, satırlar %0'dır
 * ve orana faturada ayrı karar verilir.
 *
 * Karar (2026-09-20, saha örneğiyle karşılaştırma): **satıra KDV hariç bedel
 * yazılır**, özel matrahın KDV'si genel toplama ve cari borcuna eklenir —
 * alıcının defterinde net bedel ile KDV ayrışsın diye. Örnek: 92.000'e alınan
 * araç 95.500'e satılır; satır 95.465,35, özel matrah 3.465,35, %1 KDV 34,65,
 * ödenecek 95.500.
 */

import { ozelMatrahKoduBul } from "./gib-kodlari";
import { kdvTutari, yuvarla } from "./para";

export interface OzelMatrahGirdi {
  tip: string;
  ozelMatrahKodu?: string | null;
  /** KDV'nin hesaplanacağı özel matrah; bayi işlerinde sıfır olabilir. */
  ozelMatrahTutari?: string | number | null;
  /** Özel matraha uygulanacak KDV oranı (%). */
  ozelMatrahOrani?: string | number | null;
  satirlar: { kdvOrani: string | number; tevkifatKodu?: string | null }[];
  /** Satırların KDV hariç toplamı; matrah bunu aşamaz. */
  satisBedeli?: string | number | null;
}

/**
 * Özel matrah faturasının kurallarını denetler. Arayüz kaydetmeden önce, şema
 * doğrulaması kaydederken aynı listeyi üretir.
 */
export function ozelMatrahHatalari(girdi: OzelMatrahGirdi): string[] {
  if (!girdi.ozelMatrahKodu) return [];
  const hatalar: string[] = [];

  if (girdi.tip !== "satis") {
    hatalar.push("Özel matrah yalnız satış faturasında seçilebilir");
  }
  if (!ozelMatrahKoduBul(girdi.ozelMatrahKodu)) {
    hatalar.push(`Tanımsız özel matrah kodu: ${girdi.ozelMatrahKodu}`);
  }

  const tutar = yuvarla(Number(girdi.ozelMatrahTutari ?? 0) * 100);
  const oran = Number(girdi.ozelMatrahOrani ?? 0);
  if (tutar < 0) hatalar.push("Özel matrah tutarı eksi olamaz");
  if (tutar > 0 && !(oran > 0)) {
    hatalar.push("Özel matraha uygulanacak KDV oranı girilmelidir");
  }
  const bedel = yuvarla(Number(girdi.satisBedeli ?? 0) * 100);
  if (bedel > 0 && tutar > bedel) {
    hatalar.push("Özel matrah tutarı satış bedelini aşamaz");
  }

  // KDV özel matrah üzerinden hesaplandığı için satırda ayrıca hesaplanırsa
  // vergi iki kez görünür (GİB örneğinde satırlarda vergi bloğu hiç yoktur).
  if (girdi.satirlar.some((s) => Number(s.kdvOrani) !== 0)) {
    hatalar.push("Özel matrah faturasında satırların KDV oranı sıfır olmalıdır; KDV özel matrah üzerinden hesaplanır");
  }
  if (girdi.satirlar.some((s) => Boolean(s.tevkifatKodu))) {
    hatalar.push("Özel matrah faturasında tevkifatlı satır bulunamaz");
  }

  return hatalar;
}

/** Belgeye yazılan KDV: özel matrah × oran, kuruşta yuvarlanır. */
export function ozelMatrahKdvsi(tutar: string | number | null | undefined, oran: string | number | null | undefined): number {
  return kdvTutari(yuvarla(Number(tutar ?? 0) * 100), Number(oran ?? 0)) / 100;
}

/**
 * KDV dahil kâr farkından matrahı çözer (iç yüzde): satıcı "92.000'e aldım,
 * 95.500'e satıyorum" diye düşünür, farkın içindeki KDV ayrılmalıdır.
 * 3.500 ve %1 → 3.465,35.
 */
export function ozelMatrahTabani(kdvDahilFark: string | number | null | undefined, oran: string | number | null | undefined): number {
  const fark = Number(kdvDahilFark ?? 0);
  const yuzde = Number(oran ?? 0);
  if (!(fark > 0)) return 0;
  return yuvarla((fark / (1 + yuzde / 100)) * 100) / 100;
}

/**
 * Belgeye girilen tek özel matrahı satırlara dağıtır: giden belgede satır
 * düzeyindeki "özel matrah nedeni/tutarı" sütunları böyle dolar (karar
 * 2026-09-20). Pay satırın KDV hariç tutarına göredir, kuruş farkı son satıra
 * bırakılır — satır toplamları belge düzeyindeki tutarları birebir tutmalıdır.
 */
export function ozelMatrahSatirPaylari(
  satirMatrahlari: (string | number)[],
  toplamOzelMatrah: string | number | null | undefined,
  oran: string | number | null | undefined,
): { matrah: number; kdv: number }[] {
  const matrahKurus = yuvarla(Number(toplamOzelMatrah ?? 0) * 100);
  const kdvKurus = yuvarla(ozelMatrahKdvsi(toplamOzelMatrah, oran) * 100);
  const tutarlar = satirMatrahlari.map((m) => Number(m) || 0);
  const toplam = tutarlar.reduce((t, m) => t + m, 0);

  let dagitilanMatrah = 0;
  let dagitilanKdv = 0;
  return tutarlar.map((tutar, i) => {
    if (i === tutarlar.length - 1) {
      return { matrah: (matrahKurus - dagitilanMatrah) / 100, kdv: (kdvKurus - dagitilanKdv) / 100 };
    }
    const pay = toplam > 0 ? tutar / toplam : 0;
    const matrah = yuvarla(matrahKurus * pay);
    const kdv = yuvarla(kdvKurus * pay);
    dagitilanMatrah += matrah;
    dagitilanKdv += kdv;
    return { matrah: matrah / 100, kdv: kdv / 100 };
  });
}
