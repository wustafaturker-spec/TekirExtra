/**
 * İhracat faturası kuralları (tasarım belgesi §5).
 *
 * İhracat, kanalı kullanıcının seçtiği bir tür değildir: alıcının adresi
 * Türkiye dışındaysa belge ihracat faturası olur, GİB mükellef sorgusu hiç
 * yapılmaz (§3.1 adım 1). Kural tek yerde durur; sunucu da sihirbaz da aynı
 * listeyi okur.
 */

import { belgeAdresiSec } from "./adres";
import { kapEksigiVarMi, type KalemKapBilgisi } from "./kap-cinsleri";
import { ulkeKoduCoz, yurtDisiMi } from "./ulke";

/**
 * İhracat faturasının **alıcısı** yurt dışındaki müşteri değil, Ticaret
 * Bakanlığı'dır (GİB `IHRACAT.xml` resmî örneği). Mal ı alan yabancı firma
 * belgede ayrı bir tarafta, `cac:BuyerCustomerParty` içinde bildirilir.
 * VKN GİB mükellef listesinde de bu unvanla durur.
 */
export const GUMRUK_BAKANLIGI_VKN = "1460415308";
export const GUMRUK_BAKANLIGI_UNVAN =
  "Gümrük ve Ticaret Bakanlığı Gümrükler Genel Müdürlüğü - Bilgi İşlem Dairesi Başkanlığı";
export const GUMRUK_BAKANLIGI_IL = "Ankara";

/**
 * Belge Bakanlığın ihracat kutusuna gönderilir; gümrük beyannamesiyle eşleşme
 * oradan yürür. Aynı VKN'nin yolcu beraberi için ayrı bir kutusu vardır, o
 * yüzden kutu mükellef listesinden seçilmez, burada açıkça yazılır.
 */
export const IHRACAT_POSTA_KUTUSU = "urn:mail:ihracatpk@gtb.gov.tr";

/**
 * İhracat KDV'den istisnadır ve belge tipi bunu söyler: resmî örnekte
 * `InvoiceTypeCode` `ISTISNA`'dır. Tasarım belgesi "SATIS" diyordu.
 */
export const IHRACAT_FATURA_TIPI = "ISTISNA";

/** Yabancı alıcı `cac:BuyerCustomerParty` içinde bu kimlikle bildirilir. */
export const IHRACAT_ALICI_PARTY_TIPI = "EXPORT";

/** UBL'e `cbc:ProfileID` olarak yazılan senaryo kodu. */
export const IHRACAT_PROFILI = "IHRACAT";

/** Vergi tutarları dövizli faturada da TRY üzerinden gösterilir. */
export const IHRACAT_VERGI_PARA_BIRIMI = "TRY";

/**
 * Teslim şartları (Incoterms 2020). UBL'de `cac:DeliveryTerms/cbc:ID` alanına
 * `schemeID="INCOTERMS"` ile yazılır.
 */
export const TESLIM_SARTLARI: readonly { kod: string; ad: string }[] = [
  { kod: "EXW", ad: "EXW — Ticari işletmede teslim" },
  { kod: "FCA", ad: "FCA — Taşıyıcıya masrafsız teslim" },
  { kod: "FAS", ad: "FAS — Gemi doğrultusunda masrafsız teslim" },
  { kod: "FOB", ad: "FOB — Gemide masrafsız teslim" },
  { kod: "CFR", ad: "CFR — Masraflar ve navlun ödenmiş teslim" },
  { kod: "CIF", ad: "CIF — Masraflar, sigorta ve navlun ödenmiş teslim" },
  { kod: "CPT", ad: "CPT — Taşıma ödenmiş teslim" },
  { kod: "CIP", ad: "CIP — Taşıma ve sigorta ödenmiş teslim" },
  { kod: "DAP", ad: "DAP — Belirlenen yerde teslim" },
  { kod: "DPU", ad: "DPU — Belirlenen yerde boşaltılmış teslim" },
  { kod: "DDP", ad: "DDP — Gümrük vergileri ödenmiş teslim" },
];

/**
 * Taşıma şekilleri (UN/ECE Rec. 19). UBL'de
 * `cac:Delivery/cac:Shipment/cac:ShipmentStage/cbc:TransportModeCode`.
 */
export const TASIMA_SEKILLERI: readonly { kod: string; ad: string }[] = [
  { kod: "1", ad: "Denizyolu" },
  { kod: "2", ad: "Demiryolu" },
  { kod: "3", ad: "Karayolu" },
  { kod: "4", ad: "Havayolu" },
  { kod: "5", ad: "Posta" },
  { kod: "6", ad: "Çok araçlı taşıma" },
  { kod: "7", ad: "Sabit taşıma tesisleri" },
  { kod: "8", ad: "İç su yolu" },
];

export const teslimSartiGecerliMi = (kod: string | null | undefined): boolean =>
  TESLIM_SARTLARI.some((t) => t.kod === kod);

export const tasimaSekliGecerliMi = (kod: string | null | undefined): boolean =>
  TASIMA_SEKILLERI.some((t) => t.kod === kod);

/** GTİP, gümrük tarife istatistik pozisyonu: tam 12 rakam. */
export function gtipGecerliMi(kod: string | null | undefined): boolean {
  return /^\d{12}$/.test((kod ?? "").replace(/\s/g, ""));
}

/** GTİP'i belgeye yazılacak biçime indirger; geçersizse undefined. */
export function gtipNormalize(kod: string | null | undefined): string | undefined {
  const sade = (kod ?? "").replace(/\s/g, "");
  return /^\d{12}$/.test(sade) ? sade : undefined;
}

/**
 * İhracatta KDV istisna kodu satırın malı mı hizmeti mi olduğundan türer:
 * mal ihracatı `301`, hizmet ihracatı `302`. Tasarım belgesi bu alana `351`
 * yazıyordu; `351` GİB listesinde "KDV - İstisna Olmayan Diğer" demektir ve
 * ihracat faturasına yazıldığında işlem istisna sayılmaz, KDV iadesini
 * riske atar (`gib-kodlari.ts`).
 */
export function ihracatIstisnaKodu(stokTipi: string | null | undefined): string {
  return stokTipi === "hizmet" ? "302" : "301";
}

/** İstisna kodunun belgeye yazılan açıklaması (`cbc:TaxExemptionReason`). */
export function ihracatIstisnaAciklamasi(kod: string): string {
  return kod === "302" ? "11/1-a Hizmet ihracatı" : "11/1-a Mal ihracatı";
}

/** İhracatta kullanılabilecek tam istisna kodları; kullanıcı bunlardan birini seçtiyse korunur. */
const IHRACAT_ISTISNA_KODLARI = new Set(["301", "302", "303", "316", "322"]);

export const ihracatIstisnaKoduMu = (kod: string | null | undefined): boolean =>
  Boolean(kod) && IHRACAT_ISTISNA_KODLARI.has(kod!);

export interface IhracatAdres {
  tip: string;
  ulke: string | null;
}

/**
 * Alıcının ülkesi, belgeye yazılan adresten okunur (`belgeAdresiSec` ile aynı
 * sıra). Adres yoksa ülke bilinmiyor demektir ve belge yurt içi sayılır —
 * ihracat, kayıtlı bir yurt dışı adrese dayanmak zorundadır.
 */
export function aliciUlkeKodu(adresler: readonly IhracatAdres[]): string | undefined {
  return ulkeKoduCoz(belgeAdresiSec(adresler)?.ulke);
}

/** Belge ihracat faturası mı — alıcının ülkesi Türkiye dışında mı? */
export function ihracatFaturasiMi(adresler: readonly IhracatAdres[]): boolean {
  return yurtDisiMi(aliciUlkeKodu(adresler));
}

/**
 * GİB'in e-Arşiv faturasında yurt dışı alıcı için kullanılan ortak VKN'si.
 * Alıcının kimliği değildir: unvan, adres ve ülke karttan yazılır (EBLG-80).
 */
export const YURT_DISI_ALICI_VKN = "2222222222";

/** Kartta görüldüğünde alıcıyı yurt dışı sayduran numaralar (EBLG-80). */
const YURT_DISI_VKNLERI = new Set([YURT_DISI_ALICI_VKN, GUMRUK_BAKANLIGI_VKN]);

/**
 * Alıcı yurt dışı mı (EBLG-80): fatura adresinin ülkesi Türkiye dışıysa ya da
 * kartta yurt dışı alıcı VKN'si (2222222222) veya Ticaret Bakanlığı VKN'si
 * (1460415308) yazılıysa.
 */
export function yurtDisiAliciMi(girdi: { ulkeKodu: string | null | undefined; vknTckn: string | null | undefined }): boolean {
  return yurtDisiMi(girdi.ulkeKodu) || YURT_DISI_VKNLERI.has((girdi.vknTckn ?? "").trim());
}

export type YurtDisiSatisTuru = "ihracat" | "earsiv_istisna";

/**
 * Yurt dışı alıcıya hangi belge kesilir (EBLG-80). İhracat e-Faturası
 * gümrük beyannamesine bağlı **mal** ihracatı içindir ve yalnız e-Fatura
 * kullanan firma düzenleyebilir; hizmet satırı olan fatura ya da e-Fatura
 * kullanmayan firma e-Arşiv, tip ISTISNA keser (301 mal / 302 hizmet).
 */
export function yurtDisiSatisTuru(girdi: { efaturaAcik: boolean; stokTipleri: readonly (string | null | undefined)[] }): YurtDisiSatisTuru {
  return girdi.efaturaAcik && girdi.stokTipleri.every((tip) => tip !== "hizmet") ? "ihracat" : "earsiv_istisna";
}

/**
 * e-Arşiv istisna yolunun eksikleri: gümrük alanları istenmez, ama alıcının
 * Türkiye dışı ülkesi ve satırların sıfır KDV'si şarttır.
 */
export function yurtDisiEarsivEngelleri(ulkeKodu: string | undefined, satirlar: readonly IhracatSatirGirdi[]): IhracatEngeli[] {
  return ihracatEngelleri(ulkeKodu, {}, satirlar).filter((e) => e.alan === "ulke" || e.alan === "kdv");
}

export interface IhracatSatirGirdi extends KalemKapBilgisi {
  sira: number;
  stokAdi: string;
  stokTipi?: string | null;
  gtipKodu?: string | null;
  mensei?: string | null;
  kdvOrani: number;
}

export interface IhracatBilgisi {
  teslimTarihi?: Date | string | null;
  teslimSarti?: string | null;
  tasimaSekli?: string | null;
}

export interface IhracatEngeli {
  alan: "ulke" | "teslimTarihi" | "gtip" | "kdv" | "teslimSarti" | "tasimaSekli" | "kap";
  mesaj: string;
}

/**
 * Gönderimi engelleyen eksikler (e-İrsaliye'deki `gonderimEngelleri` kalıbı).
 * Sihirbaz listeyi olduğu gibi gösterir, gönderim aynı listeyi yeniden üretir;
 * iki taraf aynı kuralı ayrı yorumlamasın.
 */
export function ihracatEngelleri(
  ulkeKodu: string | undefined,
  bilgi: IhracatBilgisi,
  satirlar: readonly IhracatSatirGirdi[],
): IhracatEngeli[] {
  const engeller: IhracatEngeli[] = [];

  if (!ulkeKodu || ulkeKodu === "TR") {
    engeller.push({ alan: "ulke", mesaj: "Alıcının fatura adresinde Türkiye dışı bir ülke kodu bulunmalıdır" });
  }
  if (!bilgi.teslimTarihi) {
    engeller.push({ alan: "teslimTarihi", mesaj: "Fiili ihracat tarihi girilmelidir" });
  }
  if (bilgi.teslimSarti && !teslimSartiGecerliMi(bilgi.teslimSarti)) {
    engeller.push({ alan: "teslimSarti", mesaj: `Tanımsız teslim şartı: ${bilgi.teslimSarti}` });
  }
  if (bilgi.tasimaSekli && !tasimaSekliGecerliMi(bilgi.tasimaSekli)) {
    engeller.push({ alan: "tasimaSekli", mesaj: `Tanımsız taşıma şekli: ${bilgi.tasimaSekli}` });
  }

  const gtipsiz = satirlar.filter((s) => !gtipGecerliMi(s.gtipKodu));
  if (gtipsiz.length) {
    engeller.push({
      alan: "gtip",
      mesaj: `Şu satırların stok kartında 12 haneli GTİP kodu yok: ${gtipsiz.map((s) => `${s.sira}. ${s.stokAdi}`).join(", ")}`,
    });
  }

  const kdvli = satirlar.filter((s) => Number(s.kdvOrani) !== 0);
  if (kdvli.length) {
    engeller.push({
      alan: "kdv",
      mesaj: `İhracat KDV'den istisnadır; şu satırların KDV oranı sıfırlanmalıdır: ${kdvli.map((s) => `${s.sira}. ${s.stokAdi}`).join(", ")}`,
    });
  }

  const kapsiz = satirlar.filter(kapEksigiVarMi);
  if (kapsiz.length) {
    engeller.push({
      alan: "kap",
      mesaj: `Kap numarası ya da adedi girilen şu satırlarda kap cinsi seçilmelidir: ${kapsiz.map((s) => `${s.sira}. ${s.stokAdi}`).join(", ")}`,
    });
  }

  return engeller;
}

/** Menşei çözülemeyen satırlar; belgeye menşei yazılmaz, sihirbaz uyarır. */
export function menseiUyarilari(satirlar: readonly IhracatSatirGirdi[]): { sira: number; stokAdi: string; mensei: string }[] {
  return satirlar
    .filter((s) => s.mensei?.trim() && !ulkeKoduCoz(s.mensei))
    .map((s) => ({ sira: s.sira, stokAdi: s.stokAdi, mensei: s.mensei!.trim() }));
}
