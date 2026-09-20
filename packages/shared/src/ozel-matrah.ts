/**
 * Özel matrah faturası (KDV Kanunu 23. madde; tasarım tablosu §3.9).
 *
 * Kaynak: GİB resmî örneği `docs/e-belge/…/UBL-TR 1.2.1/XSLT/OZELMATRAH.xml` ve
 * UBL-TR Kod Listeleri v1.26. Bu faturada verginin matrahı satış bedeli
 * değildir: ikinci el araç/taşınmazda alış ile satış arasındaki fark (812),
 * müzayedede komisyon, bayi işlerinde sıfırdır. Satış bedeli KDV'yi zaten
 * içerir; bu yüzden satırlar KDV'siz yazılır, hesaplanan KDV yalnız **belge
 * düzeyinde**, özel matrah tutarı üzerinden ve koduyla bildirilir
 * (`InvoiceTypeCode` OZELMATRAH; profil normal kalır).
 *
 * Karar (2026-09-20): kod ve matrah **fatura formunda** girilir (e-Arşiv'de de
 * geçerlidir ve toplamları anlatır), matrahı kullanıcı yazar, satırlar %0'dır
 * ve orana faturada ayrı karar verilir.
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
  /** Satış bedeli (KDV dahil); matrah bunu aşamaz. */
  genelToplam?: string | number | null;
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
  const toplam = yuvarla(Number(girdi.genelToplam ?? 0) * 100);
  if (toplam > 0 && tutar > toplam) {
    hatalar.push("Özel matrah tutarı satış bedelini aşamaz");
  }

  // Satış bedeli KDV'yi içerir; satırda ayrıca KDV hesaplanırsa vergi iki kez
  // görünür (GİB örneğinde satırlarda vergi bloğu hiç yoktur).
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
