/**
 * Yolcu beraberi eşya (tax-free) faturası (tasarım tablosu §3.5).
 *
 * Kaynak: GİB "e-Fatura Uygulaması Gümrük İşlemleri Kılavuzu" v1.8 §4 ve
 * resmî örnek `docs/e-belge/…/UBL-TR 1.2.1/XSLT/YOLCUBERABER.xml`.
 * Türkiye'de ikamet etmeyen yolcuya KDV hesaplanarak yapılan satıştır; KDV
 * tahsil edilir, yolcu gümrük çıkışından sonra yetkili aracı kurumdan geri
 * alır. e-Fatura yolu yalnız iadeyi aracı kurum üzerinden yapan satıcı içindir.
 *
 * Belge Gümrük Bakanlığı'na gider (ihracat faturasıyla aynı VKN, ayrı posta
 * kutusu); yolcu `BuyerCustomerParty` içinde TAXFREE kimliğiyle, aracı kurum
 * `TaxRepresentativeParty` içinde durur. Gümrük onayı uygulama yanıtıyla aracı
 * kuruma gider, satıcıya dönen bir yanıt yoktur.
 *
 * Kararlar (2026-09-20): işaret sihirbazda konur ve cari adresinden türeyen
 * ihracat kararını ezer; satış genel bir cariye kesilir, yolcu bilgisi
 * faturaya yazılır; aracı kurum firma ayarında varsayılan durur.
 */

import { ulkeKoduCoz } from "./ulke";

export const YOLCU_BERABER_PROFILI = "YOLCUBERABERFATURA";
export const YOLCU_BERABER_FATURA_TIPI = "ISTISNA";
export const YOLCU_BERABER_POSTA_KUTUSU = "urn:mail:yolcuberaberpk@gtb.gov.tr";
export const YOLCU_BERABER_PARTY_TIPI = "TAXFREE";
export const YOLCU_BERABER_ISTISNA_KODU = "501";
export const YOLCU_BERABER_ISTISNA_ACIKLAMASI =
  "Türkiye'de İkamet Etmeyenlere KDV Hesaplanarak Yapılan Satışlar(Yolcu Beraberi Eşya)";
/** Kılavuz: pasaportun veriliş tarihi yazılamıyorsa bu sabit yazılabilir. */
export const PASAPORT_TARIHI_BILINMIYOR = "2005-01-01";

export interface YolcuBilgisi {
  ad?: string | null;
  soyad?: string | null;
  /** Pasaportta yazan ülke, ISO 3166-1 alpha-2. */
  uyruk?: string | null;
  pasaportNo?: string | null;
  /** YYYY-AA-GG; boşsa belgeye `PASAPORT_TARIHI_BILINMIYOR` gider. */
  pasaportTarihi?: string | null;
  /** İkamet adresi: şehir ve ülke (ISO kodu). */
  sehir?: string | null;
  ulke?: string | null;
  /** İsteğe bağlı: KDV iadesinin yatırılacağı hesap. */
  bankaHesapNo?: string | null;
  bankaAdi?: string | null;
}

export interface AraciKurum {
  vkn?: string | null;
  /** Aracı kurumun GİB posta kutusu etiketi (`urn:mail:…`). */
  etiket?: string | null;
  unvan?: string | null;
}

export interface YolcuBeraberiBilgisi {
  yolcu: YolcuBilgisi;
  araciKurum: AraciKurum;
}

export interface YolcuBeraberiEngeli {
  alan: "tip" | "satir" | "ad" | "soyad" | "uyruk" | "pasaportNo" | "pasaportTarihi" | "sehir" | "ulke" | "araciKurumVkn" | "araciKurumEtiket" | "araciKurumUnvan";
  mesaj: string;
}

const bos = (deger: string | null | undefined) => !deger?.trim();

/**
 * Gönderimi engelleyen eksikler. Sihirbaz listeyi olduğu gibi gösterir,
 * gönderim aynı listeyi kaydettikten sonra yeniden üretir.
 */
export function yolcuBeraberiEngelleri(
  bilgi: YolcuBeraberiBilgisi,
  fatura: { tip: string; tarih: string | Date; satirlar: { kdvOrani: number | string; tevkifatKodu?: string | null }[] },
): YolcuBeraberiEngeli[] {
  const engeller: YolcuBeraberiEngeli[] = [];
  const { yolcu, araciKurum } = bilgi;

  if (fatura.tip !== "satis") {
    engeller.push({ alan: "tip", mesaj: "Yolcu beraberi yalnız satış faturasında işaretlenebilir" });
  }
  // KDV hesaplanarak yapılan satıştır; sıfır KDV'li ya da tevkifatlı satır bu
  // belgeye girmez (501 kodu KDV'li alt toplamda durur).
  if (fatura.satirlar.some((s) => Number(s.kdvOrani) === 0)) {
    engeller.push({ alan: "satir", mesaj: "Yolcu beraberi satışta KDV hesaplanır; KDV oranı sıfır olan satır bulunamaz" });
  }
  if (fatura.satirlar.some((s) => Boolean(s.tevkifatKodu))) {
    engeller.push({ alan: "satir", mesaj: "Yolcu beraberi satışta tevkifatlı satır bulunamaz" });
  }

  if (bos(yolcu.ad)) engeller.push({ alan: "ad", mesaj: "Yolcunun adı girilmelidir" });
  if (bos(yolcu.soyad)) engeller.push({ alan: "soyad", mesaj: "Yolcunun soyadı girilmelidir" });
  if (!/^[A-Z]{2}$/.test(yolcu.uyruk ?? "")) {
    engeller.push({ alan: "uyruk", mesaj: "Yolcunun uyruğu (pasaportta yazan ülke) seçilmelidir" });
  }
  if (bos(yolcu.pasaportNo)) engeller.push({ alan: "pasaportNo", mesaj: "Pasaport numarası girilmelidir" });
  if (yolcu.pasaportTarihi) {
    const tarih = yolcu.pasaportTarihi.slice(0, 10);
    const faturaGunu = typeof fatura.tarih === "string" ? fatura.tarih.slice(0, 10) : fatura.tarih.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih) || tarih > faturaGunu) {
      engeller.push({ alan: "pasaportTarihi", mesaj: "Pasaportun veriliş tarihi fatura tarihinden sonra olamaz" });
    }
  }
  if (bos(yolcu.sehir)) engeller.push({ alan: "sehir", mesaj: "Yolcunun ikamet ettiği şehir girilmelidir" });
  const ulke = ulkeKoduCoz(yolcu.ulke);
  if (!ulke) {
    engeller.push({ alan: "ulke", mesaj: "Yolcunun ikamet ettiği ülke seçilmelidir" });
  } else if (ulke === "TR") {
    engeller.push({ alan: "ulke", mesaj: "Yolcu beraberi yalnız Türkiye'de ikamet etmeyen yolcuya yapılır" });
  }

  if (!/^\d{10}$/.test((araciKurum.vkn ?? "").trim())) {
    engeller.push({ alan: "araciKurumVkn", mesaj: "Aracı kurumun 10 haneli VKN'si girilmelidir" });
  }
  if (!/^urn:mail:\S+@\S+$/.test((araciKurum.etiket ?? "").trim())) {
    engeller.push({ alan: "araciKurumEtiket", mesaj: "Aracı kurumun posta kutusu etiketi urn:mail:…@… biçiminde girilmelidir" });
  }
  if (bos(araciKurum.unvan)) engeller.push({ alan: "araciKurumUnvan", mesaj: "Aracı kurumun unvanı girilmelidir" });

  return engeller;
}
