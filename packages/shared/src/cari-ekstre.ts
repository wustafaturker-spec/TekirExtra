/**
 * CARI-24/25/26: cari hesap ekstresi. Üç tür vardır: standart (belge no,
 * hareket türü, ödeme şekli ile), ayrıntılı (faturaların kalemleri ve kuru
 * da görünür) ve döviz ekstresi (her döviz kendi bölümünde ya da tüm
 * hareketler seçilen dövize çevrilmiş). Ekran, PDF ve Excel aynı kuralı
 * kullanır.
 */

export const EKSTRE_TURLERI = ["standart", "ayrintili", "doviz"] as const;
export type EkstreTuru = (typeof EKSTRE_TURLERI)[number];

export const EKSTRE_TURU_ADLARI: Record<EkstreTuru, string> = {
  standart: "Standart ekstre",
  ayrintili: "Ayrıntılı ekstre",
  doviz: "Döviz ekstresi",
};

const FATURA_TIPI_ADLARI: Record<string, string> = {
  satis: "Satış",
  alis: "Alış",
  satis_iade: "Satış iadesi",
  alis_iade: "Alış iadesi",
  proforma: "Proforma",
};

/**
 * Ekstrede "Hareket" sütunu. Faturada tip belirleyicidir; para hareketinde
 * yön: carinin alacağı tahsilat, borcu ödemedir.
 */
export function hareketTuruEtiketi(h: { kaynakTur: string; tip: "borc" | "alacak" | string; faturaTipi?: string | null }): string {
  switch (h.kaynakTur) {
    case "fatura":
    case "ebelge":
      return (h.faturaTipi && FATURA_TIPI_ADLARI[h.faturaTipi]) || "Fatura";
    case "fatura_iptal":
      return "Fatura iptali";
    case "fatura_geri_alma":
      return "Fatura geri alma";
    case "kasa_banka":
    case "pos_tahsilat":
    case "banka_ekstre_satiri":
      return h.tip === "alacak" ? "Tahsilat" : "Ödeme";
    case "kredi_karti":
    case "kredi_karti_hareketi":
      return "Kredi kartı";
    case "cek_senet":
      return h.tip === "alacak" ? "Çek/senet alındı" : "Çek/senet verildi";
    case "cek_senet_ciro":
      return "Çek/senet ciro";
    case "cek_senet_ters":
      return "Çek/senet iadesi";
    case "masraf":
      return "Masraf";
    case "duzeltme":
      return "Düzeltme";
    case "mali_donem":
      return "Açılış";
    case "acilis":
      return "Açılış bakiyesi";
    case "manuel":
      return "Elle düzeltme";
    case "pazaryeri_kesinti":
      return "Pazaryeri kesintisi";
    case "pazaryeri_stopaj":
      return "Pazaryeri stopajı";
    default:
      if (h.kaynakTur.startsWith("bordro")) return "Bordro";
      if (h.kaynakTur.startsWith("personel")) return "Personel";
      return "Diğer";
  }
}

/**
 * Ekstrede gösterilecek açıklama. Fatura hareketinin sistemce yazılan
 * açıklaması ("… nolu fatura hareketi") belge no sütununu tekrarladığı için
 * boş bırakılır; kullanıcının yazdığı açıklama olduğu gibi kalır.
 */
export function ekstreAciklamasi(aciklama: string | null | undefined, kaynakTur: string): string {
  const metin = (aciklama ?? "").trim();
  if (kaynakTur === "fatura" && /^(\S+ nolu fatura hareketi|Fatura hareketi)$/.test(metin)) return "";
  return metin;
}

/** Bakiye yönü: pozitif bakiye carinin borcu (B), negatif alacağı (A). */
export function bakiyeYonu(bakiye: number | string): "B" | "A" | "" {
  const n = Number(bakiye);
  if (Math.abs(n) < 0.005) return "";
  return n > 0 ? "B" : "A";
}

function para(n: number): string {
  return Math.abs(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Mutabakat metni (isteğe bağlı). Bakiyenin yönü carinin gözünden yazılır:
 * pozitif bakiye "firmamıza borçlu", negatif "firmamızdan alacaklı".
 */
export function mutabakatMetni(bitisTarihi: string, bakiyeler: { dovizCinsi: string; bakiye: number | string }[]): string {
  const [y, a, g] = bitisTarihi.slice(0, 10).split("-");
  const dolu = bakiyeler.filter((b) => bakiyeYonu(b.bakiye));
  const tutar = dolu.length
    ? dolu.map((b) => `${para(Number(b.bakiye))} ${b.dovizCinsi} ${Number(b.bakiye) > 0 ? "borç" : "alacak"}`).join(", ")
    : "bakiyesiz (0,00)";
  return `${g}.${a}.${y} tarihi itibarıyla kayıtlarımızda hesabınız ${tutar} olarak görünmektedir. `
    + "Bakiyeye mutabık iseniz ekstreyi imzalayıp kaşeleyerek, mutabık değilseniz hesap dökümünüzle birlikte "
    + "15 gün içinde tarafımıza bildirmenizi rica ederiz. Bu süre içinde bildirim yapılmaması halinde bakiyeye mutabık sayılacaktır.";
}
