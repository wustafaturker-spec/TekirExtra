/**
 * AI-05: modelin araç çalıştırmadan işlem yapmış gibi konuşmasını yakalar.
 * Canlı denemede (Gemini 2.5 Flash) model hiçbir araç çağırmadan "teklif
 * taslağı oluşturuldu" deyip uydurma bir kayıt bağlantısı verdi; sistem
 * talimatı tek başına yetmiyor. Denetim yalnız bu turdaki gerçek araç
 * sonuçlarına dayanır.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Canlıda görülen: gerçek talep kimliğiyle uydurma "/panel/onay?id=…" yolu.
const PANEL_YOLU = /\/panel\/[^\s)\]"'`,*]+/g;
// Canlıda görülen: "Teklifin iptali için onayınız gerekiyor. Onayladığınızda teklif iptal edilecek." (talep yok)
// Yalnız olmuş gibi söylenen iddialar; "onayınıza sunabilirim" gibi teklif cümleleri değil.
const ONAY_IDDIASI = /onay(ınıza|a) sunul(du|muş|muştur)|onayınızı bekl|onayınız gerek|onayladığınızda|onay talebi (açıldı|oluşturuldu)|düğmeyle onaylayabilirsiniz/iu;
// AI-74: "onayınızı bekleyen talepler" bir iş durumudur (satın alma, ödeme talimatı);
// araç sonucunda onay bekleyen kayıt varsa bu söz uydurma onay talebi sayılmaz.
const ONAY_BEKLEYEN_KAYIT = /onay_bekliyor|"onaybekleyen|"onaydabekleyen/i;
const ONAY_BEKLEME = /onayınızı bekl/iu;
const GELECEK_ISLEM = /(?<!\p{L})(oluşturulacak|gönderilecek|iptal edilecek|kesinleştirilecek|kaydedilecek|güncellenecek|onaylanacak)(?!\p{L})/iu;
const ISLEM_IDDIASI = /(?<!\p{L})(oluşturuldu|oluşturdum|hazırlandı|hazırladım|kaydedildi|kaydettim|gönderildi|gönderdim|onaylandı|onayladım|kesinleştirildi|kesinleştirdim|iptal edildi|iptal ettim|güncellendi|güncelledim|açıldı|açtım)(?!\p{L})/iu;

export interface TurOzeti {
  /** Bu turda çalışan araçların sonuç metinleri. */
  aracCiktilari: string[];
  /** Bu turda açılan onay talebi sayısı. */
  talepSayisi: number;
  /** Kullanıcının mesajı ve önceki konuşma metni (kimliklerin geçebileceği diğer kaynaklar). */
  baglamMetni: string;
}

/** Yanıt bu turun gerçekleriyle çelişiyorsa nedeni; değilse null. */
export function uydurmaNedeni(cevap: string, tur: TurOzeti): string | null {
  const kaynak = `${tur.aracCiktilari.join(" ")} ${tur.baglamMetni}`.toLowerCase();
  const yabanciKimlik = (cevap.match(UUID) ?? []).find((k) => !kaynak.includes(k.toLowerCase()));
  if (yabanciKimlik) return `yanıttaki ${yabanciKimlik} kimliği hiçbir araç sonucunda yok`;
  const yabanciYol = (cevap.match(PANEL_YOLU) ?? []).map((y) => y.replace(/[.:;]+$/, "")).find((y) => !kaynak.includes(y.toLowerCase()));
  if (yabanciYol) return `yanıttaki ${yabanciYol} adresi hiçbir araç sonucunda yok`;
  const onayIddiasi = ONAY_IDDIASI.test(cevap) && !(ONAY_BEKLEME.test(cevap) && ONAY_BEKLEYEN_KAYIT.test(kaynak) && !ONAY_IDDIASI.test(cevap.replace(new RegExp(ONAY_BEKLEME.source, "giu"), "")));
  if (tur.talepSayisi === 0 && (onayIddiasi || GELECEK_ISLEM.test(cevap))) {
    return "onay talebi açılmadığı hâlde işlemin onaya sunulduğu ya da yapılacağı söylendi";
  }
  if (tur.aracCiktilari.length === 0 && ISLEM_IDDIASI.test(cevap)) return "hiçbir araç çalışmadığı hâlde işlem yapıldığı söylendi";
  return null;
}

export const DUZELTME_ISTEMI = (neden: string) =>
  `[Sistem denetimi] Önceki yanıtın reddedildi: ${neden}. Bu turda yapılan işlemler yalnız araç sonuçlarında görünenlerdir. ` +
  "İşlem gerekiyorsa ilgili aracı şimdi çağır; çağırmayacaksan işlemin yapılmadığını açıkça söyle. Kayıt kimliği ya da bağlantı uydurma. " +
  "Bu denetimden ve önceki yanıtından kullanıcıya söz etme, özür dileme; yalnız doğru yanıtı ver.";

export const GUVENLI_YANIT =
  "Asistanın yanıtı doğrulanamadı: yapılmamış bir işlemden söz ediyordu, bu yüzden gösterilmedi. Hiçbir kayıt oluşturulmadı ya da değiştirilmedi. Lütfen talimatı yeniden yazın.";

/**
 * AI-110 bulgusu: model, harici içerikteki (gelen e-posta, e-Belge, OCR) oltalama bağlantısını
 * uyarı amacıyla da olsa yanıta taşıyabiliyor; bağlantı tıklanabilir kalır. Harici içerikte
 * geçen bağlantıların alan adları yanıtta (şemalı ya da şemasız) gizlenir; kullanıcının kendi
 * mesajında yazdığı adres gizlenmez.
 */
export const HARICI_BAGLANTI_GIZLENDI = "[harici bağlantı gizlendi]";
const BAGLANTI = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[^\s)\]"'<>]*/gi;

export function hariciAlanAdlari(icerik: string): string[] {
  return [...new Set([...icerik.matchAll(BAGLANTI)].map((m) => m[1].toLowerCase()))];
}

export function hariciBaglantilariGizle(cevap: string, alanAdlari: Iterable<string>, kullaniciMetni: string): string {
  const kullanici = kullaniciMetni.toLowerCase();
  const gizlenecek = [...new Set(alanAdlari)].filter((a) => !kullanici.includes(a));
  if (!gizlenecek.length) return cevap;
  const kacis = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const desen = new RegExp(`(?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)*(?:${gizlenecek.map(kacis).join("|")})(?::\\d+)?(?:[/?#][^\\s)\\]"'<>]*)?`, "gi");
  return cevap.replace(desen, HARICI_BAGLANTI_GIZLENDI);
}
