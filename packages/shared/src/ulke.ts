/**
 * Ülke kodları (ISO 3166-1 alpha-2) ve Türkçe adları.
 *
 * İki yerde gerekir: ihracat faturasında alıcı adresinin ülke kodu
 * (`cac:Country/cbc:IdentificationCode`) ve satırın menşei ülkesi
 * (`cac:OriginCountry`). Cari adresindeki `ulke` alanı zaten iki harfli kodla
 * tutulur (CARI şeması), stok kartındaki `mensei` ise serbest metindir —
 * "Türkiye" de yazılabilir "TR" de. Metni koda indirgeyen tek yer burasıdır.
 *
 * Liste Türkiye'nin dış ticaret yaptığı ülkeleri kapsar; eksik bir ülke
 * belgeyi düşürmez, kodu doğrudan girildiğinde (iki harf) olduğu gibi yazılır,
 * yalnız Türkçe adı boş kalır.
 */

export const ULKELER: readonly { kod: string; ad: string }[] = [
  { kod: "TR", ad: "Türkiye" },
  { kod: "DE", ad: "Almanya" },
  { kod: "US", ad: "Amerika Birleşik Devletleri" },
  { kod: "AR", ad: "Arjantin" },
  { kod: "AL", ad: "Arnavutluk" },
  { kod: "AU", ad: "Avustralya" },
  { kod: "AT", ad: "Avusturya" },
  { kod: "AZ", ad: "Azerbaycan" },
  { kod: "AE", ad: "Birleşik Arap Emirlikleri" },
  { kod: "GB", ad: "Birleşik Krallık" },
  { kod: "BE", ad: "Belçika" },
  { kod: "BY", ad: "Belarus" },
  { kod: "BA", ad: "Bosna Hersek" },
  { kod: "BR", ad: "Brezilya" },
  { kod: "BG", ad: "Bulgaristan" },
  { kod: "DZ", ad: "Cezayir" },
  { kod: "CN", ad: "Çin" },
  { kod: "DK", ad: "Danimarka" },
  { kod: "ID", ad: "Endonezya" },
  { kod: "AM", ad: "Ermenistan" },
  { kod: "MA", ad: "Fas" },
  { kod: "FI", ad: "Finlandiya" },
  { kod: "FR", ad: "Fransa" },
  { kod: "GE", ad: "Gürcistan" },
  { kod: "ZA", ad: "Güney Afrika" },
  { kod: "KR", ad: "Güney Kore" },
  { kod: "HR", ad: "Hırvatistan" },
  { kod: "IN", ad: "Hindistan" },
  { kod: "NL", ad: "Hollanda" },
  { kod: "IQ", ad: "Irak" },
  { kod: "IR", ad: "İran" },
  { kod: "IE", ad: "İrlanda" },
  { kod: "ES", ad: "İspanya" },
  { kod: "IL", ad: "İsrail" },
  { kod: "SE", ad: "İsveç" },
  { kod: "CH", ad: "İsviçre" },
  { kod: "IT", ad: "İtalya" },
  { kod: "IS", ad: "İzlanda" },
  { kod: "JP", ad: "Japonya" },
  { kod: "ME", ad: "Karadağ" },
  { kod: "QA", ad: "Katar" },
  { kod: "KZ", ad: "Kazakistan" },
  { kod: "KE", ad: "Kenya" },
  { kod: "KG", ad: "Kırgızistan" },
  { kod: "CO", ad: "Kolombiya" },
  { kod: "XK", ad: "Kosova" },
  { kod: "KW", ad: "Kuveyt" },
  { kod: "CY", ad: "Kıbrıs" },
  { kod: "LV", ad: "Letonya" },
  { kod: "LY", ad: "Libya" },
  { kod: "LT", ad: "Litvanya" },
  { kod: "LB", ad: "Lübnan" },
  { kod: "LU", ad: "Lüksemburg" },
  { kod: "HU", ad: "Macaristan" },
  { kod: "MK", ad: "Kuzey Makedonya" },
  { kod: "MY", ad: "Malezya" },
  { kod: "MT", ad: "Malta" },
  { kod: "MX", ad: "Meksika" },
  { kod: "EG", ad: "Mısır" },
  { kod: "MD", ad: "Moldova" },
  { kod: "MN", ad: "Moğolistan" },
  { kod: "NO", ad: "Norveç" },
  { kod: "UZ", ad: "Özbekistan" },
  { kod: "PK", ad: "Pakistan" },
  { kod: "PL", ad: "Polonya" },
  { kod: "PT", ad: "Portekiz" },
  { kod: "RO", ad: "Romanya" },
  { kod: "RU", ad: "Rusya" },
  { kod: "RS", ad: "Sırbistan" },
  { kod: "SG", ad: "Singapur" },
  { kod: "SK", ad: "Slovakya" },
  { kod: "SI", ad: "Slovenya" },
  { kod: "SD", ad: "Sudan" },
  { kod: "SA", ad: "Suudi Arabistan" },
  { kod: "SY", ad: "Suriye" },
  { kod: "CL", ad: "Şili" },
  { kod: "TJ", ad: "Tacikistan" },
  { kod: "TH", ad: "Tayland" },
  { kod: "TW", ad: "Tayvan" },
  { kod: "TN", ad: "Tunus" },
  { kod: "TM", ad: "Türkmenistan" },
  { kod: "UA", ad: "Ukrayna" },
  { kod: "OM", ad: "Umman" },
  { kod: "JO", ad: "Ürdün" },
  { kod: "VN", ad: "Vietnam" },
  { kod: "YE", ad: "Yemen" },
  { kod: "NZ", ad: "Yeni Zelanda" },
  { kod: "GR", ad: "Yunanistan" },
  { kod: "CZ", ad: "Çekya" },
  { kod: "CA", ad: "Kanada" },
  { kod: "NG", ad: "Nijerya" },
  { kod: "ET", ad: "Etiyopya" },
  { kod: "PH", ad: "Filipinler" },
  { kod: "BD", ad: "Bangladeş" },
  { kod: "EE", ad: "Estonya" },
  { kod: "BH", ad: "Bahreyn" },
  { kod: "AF", ad: "Afganistan" },
  { kod: "PE", ad: "Peru" },
  { kod: "HK", ad: "Hong Kong" },
];

const AD_ILE = new Map(ULKELER.map((u) => [sadelestir(u.ad), u.kod]));
const KOD_ILE = new Map(ULKELER.map((u) => [u.kod, u.ad]));

function sadelestir(deger: string): string {
  return deger
    .toLocaleLowerCase("tr-TR")
    .replace(/[\s.'-]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

/** Bilinen ülke kodunun Türkçe adı; bilinmiyorsa undefined. */
export function ulkeAdi(kod: string | null | undefined): string | undefined {
  return kod ? KOD_ILE.get(kod.trim().toUpperCase()) : undefined;
}

/**
 * Serbest metni ülke koduna çevirir: "TR", "tr", "Türkiye", "turkiye" hepsi
 * `TR` olur. Çözülemeyen metin `undefined` döner — o zaman ülke UBL'e hiç
 * yazılmaz, uydurulmuş bir kod yazılmasındansa eksik kalması yeğdir.
 */
export function ulkeKoduCoz(deger: string | null | undefined): string | undefined {
  const metin = deger?.trim();
  if (!metin) return undefined;
  const buyuk = metin.toLocaleUpperCase("tr-TR");
  if (/^[A-Z]{2}$/.test(buyuk)) return buyuk;
  return AD_ILE.get(sadelestir(metin));
}

/** Ülke Türkiye dışı mı — ihracat kanalının tek ölçütü (tasarım belgesi §3.1). */
export function yurtDisiMi(ulke: string | null | undefined): boolean {
  const kod = ulkeKoduCoz(ulke);
  return Boolean(kod) && kod !== "TR";
}
