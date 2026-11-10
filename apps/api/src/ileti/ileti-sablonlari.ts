import { BadRequestException } from "@nestjs/common";

/**
 * ILT-09: ileti şablonu kataloğu; varsayılan metinler buradadır, veritabanından bağımsızdır.
 * Vade hatırlatma e-postasının kendi şablon ekranı (kademeler ve fatura tablosu), mutabakatın
 * yanıt düğmeli gövdesi ve teklif takibinin kullanıcıya yazdırılan metni bu kataloğa girmez.
 */
export type SablonKategori = "belge" | "cari" | "sistem";
export type SablonDegerleri = Record<string, string | number | null | undefined>;
export interface SablonIstegi { tur: string; degiskenler: SablonDegerleri }
export interface SablonTanimi {
  tur: string; ad: string; kanal: "eposta" | "sms"; kategori: SablonKategori;
  /** ad → önizlemede kullanılan örnek değer */
  degiskenler: Record<string, string>;
  /** Şablondan çıkarılamayan değişkenler. */
  zorunlu?: string[];
  konu?: string; metin: string;
}
export interface SablonSonucu { konu: string; metin: string; ozel: boolean }

const CARI = { cari: "ÖRNEK TİCARET A.Ş." }, FIRMA = { firma: "Firma Unvanı Ltd. Şti." };
const BAGLANTI = { baglanti: "https://tekirextra.com/ornek-baglanti" };
const KIMLIK = { ad_soyad: "Ayşe Yılmaz" };

export const SABLONLAR: readonly SablonTanimi[] = [
  { tur: "fatura_eposta", ad: "Fatura e-postası", kanal: "eposta", kategori: "belge", degiskenler: { ...CARI, belge_no: "SNC2026000000123", belge_adi: "e-Faturanız" },
    konu: "Fatura {{belge_no}}", metin: "Sayın {{cari}},\n\n{{belge_no}} numaralı {{belge_adi}} ekte yer almaktadır.\n\nİyi çalışmalar dileriz." },
  { tur: "belge_eposta", ad: "Teklif, sipariş ve irsaliye e-postası", kanal: "eposta", kategori: "belge", degiskenler: { ...CARI, belge_no: "TKL2026000012", belge_turu: "Satış Teklifi", belge_turu_kucuk: "satış teklifi", gecerlilik_cumlesi: " Teklifimiz 30.11.2026 tarihine kadar geçerlidir." },
    konu: "{{belge_turu}} {{belge_no}}", metin: "Sayın {{cari}},\n\n{{belge_no}} numaralı {{belge_turu_kucuk}} ekte yer almaktadır.{{gecerlilik_cumlesi}}\n\nİyi çalışmalar dileriz." },
  { tur: "bordro_pusula_eposta", ad: "Ücret pusulası e-postası", kanal: "eposta", kategori: "belge", degiskenler: { personel: "Ayşe Yılmaz", donem: "Ekim 2026", ...FIRMA },
    konu: "{{donem}} ücret hesap pusulası", metin: "Sayın {{personel}},\n\n{{donem}} dönemine ait ücret hesap pusulanız ektedir.\n\nSaygılarımızla\n{{firma}}" },
  { tur: "ekstre_eposta", ad: "Cari ekstre e-postası", kanal: "eposta", kategori: "cari", degiskenler: { ...CARI, donem: "2026-10-01 - 2026-10-31" },
    konu: "{{cari}} cari hesap ekstresi", metin: "Sayın Yetkili,\n\n{{donem}} cari hesap ekstreniz PDF ve Excel formatında ekte sunulmuştur.\n\nSaygılarımızla" },
  { tur: "babs_mutabakat_eposta", ad: "Form BA/BS mutabakatı e-postası", kanal: "eposta", kategori: "cari", degiskenler: { ...CARI, donem: "Ekim 2026" },
    konu: "{{donem}} Form BA/BS mutabakatı — {{cari}}", metin: "Sayın Yetkili,\n\n{{donem}} dönemine ait Form BA/BS mutabakat mektubumuz ekte sunulmuştur. Kayıtlarınızla uyumluysa imzalayıp iletmenizi, fark varsa belge listesini bildirmenizi rica ederiz.\n\nSaygılarımızla" },
  { tur: "mahsup_eposta", ad: "Alış–satış mahsup bildirimi", kanal: "eposta", kategori: "cari", degiskenler: { ...CARI, tarih: "2026-11-10", tutar: "1.500,00 TRY" },
    konu: "Alış–satış mahsup bildirimi — {{cari}}", metin: "Sayın Yetkili,\n\n{{tarih}} tarihinde karşılıklı faturalarımız {{tutar}} tutarında mahsup edilmiştir. Ayrıntılar ekteki bildirimdedir.\n\nSaygılarımızla" },
  { tur: "odeme_sozu_eposta", ad: "Ödeme sözü hatırlatması", kanal: "eposta", kategori: "cari", degiskenler: { ...CARI, ...FIRMA, tarih: "10.11.2026", fatura_no: "SNC2026000000123", soz_tutari: "1500.00 TRY", kalan_tutar: "1000.00 TRY" }, zorunlu: ["firma"],
    konu: "Ödeme sözü hatırlatması — {{tarih}}", metin: "Sayın {{cari}},\n\n{{firma}} ile paylaştığınız ödeme sözünün tarihi bugün ({{tarih}}).\n\nFatura: {{fatura_no}}\nSöz tutarı: {{soz_tutari}}\nHatırlatılan kalan tutar: {{kalan_tutar}}\n\nÖdemenizi bugün gerçekleştirmenizi rica ederiz. Ödemenizi yaptıysanız bu hatırlatmayı dikkate almayabilir, ödeme bilginizi bizimle paylaşabilirsiniz.\n\nTeşekkür ederiz.\n{{firma}}" },
  { tur: "odeme_baglantisi_eposta", ad: "Ödeme bağlantısı e-postası", kanal: "eposta", kategori: "cari", degiskenler: { ...CARI, ...BAGLANTI, odeme_turu: "fatura" }, zorunlu: ["baglanti"],
    konu: "TekirExtra — {{odeme_turu}} ödeme bağlantısı", metin: "Merhaba {{cari}},\n\nGüvenli kart ödeme bağlantınız:\n{{baglanti}}\n\nKart bilgileriniz TekirExtra tarafından görüntülenmez veya saklanmaz." },
  { tur: "vade_sms", ad: "Vade hatırlatma SMS'i", kanal: "sms", kategori: "cari", degiskenler: { cari: "ÖRNEK TİCARET", firma: "Firma Unvanı", toplam: "1.500,00 TL" }, zorunlu: ["firma"],
    metin: "Sayın {{cari}}, {{firma}} firmasına vadesi geçmiş {{toplam}} borcunuz bulunmaktadır. Ödediyseniz dikkate almayınız." },
  { tur: "vade_ihtar_sms", ad: "Ödeme ihtarı SMS'i", kanal: "sms", kategori: "cari", degiskenler: { cari: "ÖRNEK TİCARET", firma: "Firma Unvanı", toplam: "1.500,00 TL" }, zorunlu: ["firma"],
    metin: "Sayın {{cari}}, {{firma}} firmasına vadesi geçmiş {{toplam}} borcunuz için ödeme ihtarıdır. Ödediyseniz dikkate almayınız." },
  { tur: "odeme_sozu_sms", ad: "Ödeme sözü SMS'i", kanal: "sms", kategori: "cari", degiskenler: { cari: "ÖRNEK TİCARET", firma: "Firma Unvanı", tutar: "1500.00 TRY" }, zorunlu: ["firma"],
    metin: "Sayın {{cari}}, {{firma}} firmasına verdiğiniz {{tutar}} ödeme sözünün tarihi bugündür. Ödediyseniz dikkate almayınız." },
  { tur: "odeme_baglantisi_sms", ad: "Ödeme bağlantısı SMS'i", kanal: "sms", kategori: "cari", degiskenler: { cari: "ÖRNEK TİCARET", ...BAGLANTI, odeme_turu: "fatura" }, zorunlu: ["baglanti"],
    metin: "Sayın {{cari}}, {{odeme_turu}} ödeme bağlantınız: {{baglanti}}" },
  { tur: "dogrulama", ad: "Kayıt e-posta doğrulaması", kanal: "eposta", kategori: "sistem", degiskenler: { ...KIMLIK, ...BAGLANTI }, zorunlu: ["baglanti"],
    konu: "TekirExtra — e-posta adresinizi doğrulayın", metin: "Merhaba {{ad_soyad}},\n\nTekirExtra kaydınızı tamamlamak için e-posta adresinizi doğrulayın:\n{{baglanti}}\n\nBu link 24 saat geçerlidir." },
  { tur: "kullanici_davet", ad: "Kullanıcı daveti", kanal: "eposta", kategori: "sistem", degiskenler: { ...KIMLIK, ...FIRMA, ...BAGLANTI, gun: "7", eposta: "ayse@ornek.com" }, zorunlu: ["baglanti"],
    konu: "{{firma}} sizi TekirExtra'ya davet etti", metin: "Merhaba {{ad_soyad}},\n\n{{firma}} sizin için bir TekirExtra hesabı açtı. Parolanızı belirleyip giriş yapmak için:\n{{baglanti}}\n\nBağlantı {{gun}} gün geçerlidir ve bir kez kullanılabilir. Giriş adınız: {{eposta}}" },
  { tur: "parola_sifirlama", ad: "Parola sıfırlama", kanal: "eposta", kategori: "sistem", degiskenler: { ...KIMLIK, ...BAGLANTI, dakika: "30" }, zorunlu: ["baglanti"],
    konu: "TekirExtra — parola sıfırlama", metin: "Merhaba {{ad_soyad}},\n\nTekirExtra hesabınız için parola sıfırlama istendi. Yeni parola belirlemek için:\n{{baglanti}}\n\nBağlantı {{dakika}} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez." },
  { tur: "eposta_degisimi_dogrulama", ad: "Giriş e-postası değişikliği: doğrulama", kanal: "eposta", kategori: "sistem", degiskenler: { ...KIMLIK, ...BAGLANTI, saat: "24" }, zorunlu: ["baglanti"],
    konu: "TekirExtra — yeni e-posta adresinizi doğrulayın", metin: "Merhaba {{ad_soyad}},\n\nTekirExtra hesabınızın giriş e-postası bu adresle değiştirilmek isteniyor. Onaylamak için:\n{{baglanti}}\n\nBağlantı {{saat}} saat geçerlidir ve bir kez kullanılabilir. Onaylayana kadar eski adresinizle giriş yapmaya devam edersiniz." },
  { tur: "eposta_degisimi_bilgi", ad: "Giriş e-postası değişikliği: eski adrese bilgi", kanal: "eposta", kategori: "sistem", degiskenler: { ...KIMLIK, yeni_eposta: "yeni@ornek.com" },
    konu: "TekirExtra — giriş e-postanız değiştiriliyor", metin: "Merhaba {{ad_soyad}},\n\nTekirExtra hesabınızın giriş e-postasının {{yeni_eposta}} olarak değiştirilmesi istendi. Yeni adresteki bağlantı onaylanınca bu adresle giriş yapılamaz.\n\nBu isteği siz ya da firma yöneticiniz yapmadıysanız hemen yöneticinize haber verin." },
];

const TANIMLAR = new Map(SABLONLAR.map((s) => [s.tur, s]));
export function sablonTanimi(tur: string): SablonTanimi {
  const t = TANIMLAR.get(tur);
  if (!t) throw new BadRequestException("Bilinmeyen ileti şablonu");
  return t;
}

const YER_TUTUCU = /\{\{\s*([a-z_]+)\s*\}\}/g;
const yerTutucular = (m: string) => [...m.matchAll(YER_TUTUCU)].map((e) => e[1]);

/** Tek geçişte doldurur; değerin içindeki `{{...}}` yeniden işlenmez. Eksik değişken gönderimi durdurur (ILT-09). */
function doldur(metin: string, degerler: SablonDegerleri): string {
  return metin.replace(YER_TUTUCU, (_, ad: string) => {
    const deger = degerler[ad];
    if (deger === undefined || deger === null) throw new BadRequestException(`İleti şablonunda '${ad}' değeri eksik; ileti gönderilmedi`);
    return String(deger);
  });
}

export function sablonDoldur(tanim: SablonTanimi, ozel: { konu: string | null; metin: string } | null | undefined, degerler: SablonDegerleri): SablonSonucu {
  return { konu: doldur(ozel?.konu ?? tanim.konu ?? "", degerler), metin: doldur(ozel?.metin ?? tanim.metin, degerler), ozel: Boolean(ozel) };
}
export const varsayilanSablon = (s: SablonIstegi): SablonSonucu => sablonDoldur(sablonTanimi(s.tur), null, s.degiskenler);

/** Kayıttan önce: bilinmeyen ya da bozuk yer tutucu, eksik zorunlu değişken ve boş alan reddedilir. */
export function sablonDogrula(t: SablonTanimi, g: { konu?: string | null; metin: string }): { konu: string | null; metin: string } {
  const konu = t.kanal === "eposta" ? (g.konu ?? "").trim() : null, metin = g.metin.trim();
  if (t.kanal === "eposta" && !konu) throw new BadRequestException("Konu boş olamaz");
  if ((konu?.length ?? 0) > 200) throw new BadRequestException("Konu en çok 200 karakter olabilir");
  if (!metin) throw new BadRequestException("Metin boş olamaz");
  if (metin.length > (t.kanal === "sms" ? 1_000 : 10_000)) throw new BadRequestException("Metin çok uzun");
  const tum = `${konu ?? ""}\n${metin}`;
  const bilinmeyen = [...new Set(yerTutucular(tum))].filter((a) => !(a in t.degiskenler));
  if (bilinmeyen.length) throw new BadRequestException(`Bilinmeyen değişken: ${bilinmeyen.join(", ")}`);
  if (/\{\{|\}\}/.test(tum.replace(YER_TUTUCU, ""))) throw new BadRequestException("Değişkenler {{ad}} biçiminde yazılmalıdır");
  const kullanilan = new Set(yerTutucular(tum));
  const eksik = (t.zorunlu ?? []).filter((a) => !kullanilan.has(a));
  if (eksik.length) throw new BadRequestException(`Şablonda şu değişken bulunmalıdır: ${eksik.join(", ")}`);
  return { konu, metin };
}
