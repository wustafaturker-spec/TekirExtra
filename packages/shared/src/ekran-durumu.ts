/**
 * AI-113: asistana giden liste ekranı durumu. Panel ve API aynı sözleşmeyi kullanır:
 * yalnız tanımlı ekranlar, ekran başına izinli süzgeç alanları ve sınırlı sayıda seçili
 * kayıt kimliği taşınır. Kayıt içeriği (tutar, unvan, VKN, IBAN) taşınmaz; seçili
 * kimlikler ve kimlik süzgeçleri sunucuda kullanıcının rolüyle yeniden okunur.
 */

import { FORM_KODLARI, type FormKodu } from "./arayuz-eylemleri";

/** Süzgeç değeri türü: biçim denetimi buna göre yapılır. */
export type EkranSuzgecTuru =
  /** Serbest metin (arama); en çok 100 karakter, satır sonu yok. */
  | "metin"
  /** YYYY-AA-GG. */
  | "tarih"
  /** Ekranın seçenek kodu (durum, tür, yön…): küçük harf, rakam, `_` ve `-`. */
  | "kod"
  /** Kayıt kimliği (UUID); sunucuda doğrulanmaz, yalnız süzgeç değeridir (kategori gibi). */
  | "kimlik"
  /** Cari kimliği (UUID); sunucuda cari ekranından okunur. */
  | "cari"
  /** Kasa/banka hesabı: `kasa:<uuid>` ya da `banka:<uuid>`; sunucuda hesap ekranından okunur. */
  | "hesap"
  /** Banka hesabı kimliği (UUID); sunucuda banka ekranından okunur. */
  | "banka";

/** Seçili kayıtların türü; sunucu her türü kendi ekran ucundan okur. */
export type EkranSeciliTuru = "fatura" | "belge" | "cari" | "gelen_efatura";

export interface EkranDurumTanimi {
  /** Modele ve rozete giden ekran adı. */
  ad: string;
  suzgecler: Record<string, { ad: string; tur: EkranSuzgecTuru }>;
  /** Seçili satır kimlikleri bu türdür; yoksa ekranda seçim taşınmaz. */
  seciliTur?: EkranSeciliTuru;
}

export const EKRAN_DURUMLARI = {
  faturalar: {
    ad: "Fatura listesi",
    seciliTur: "fatura",
    suzgecler: {
      yon: { ad: "yön (satış/alış)", tur: "kod" },
      durum: { ad: "durum", tur: "kod" },
      ebelge: { ad: "e-Belge durumu", tur: "kod" },
      odeme: { ad: "ödeme durumu", tur: "kod" },
      ihracKayitli: { ad: "ihraç kayıtlı", tur: "kod" },
      arama: { ad: "arama", tur: "metin" },
    },
  },
  belgeler: {
    ad: "Teklif/sipariş/irsaliye listesi",
    seciliTur: "belge",
    suzgecler: {
      tur: { ad: "belge türü", tur: "kod" },
      yon: { ad: "yön", tur: "kod" },
      arama: { ad: "arama", tur: "metin" },
    },
  },
  cariler: {
    ad: "Cari listesi",
    seciliTur: "cari",
    suzgecler: {
      tip: { ad: "cari tipi", tur: "kod" },
      bakiye: { ad: "bakiye durumu", tur: "kod" },
      grup: { ad: "grup", tur: "kimlik" },
      arama: { ad: "arama", tur: "metin" },
    },
  },
  kasa_banka_hareketleri: {
    ad: "Kasa/banka hareketleri",
    suzgecler: {
      tur: { ad: "hareket türü", tur: "kod" },
      hesap: { ad: "hesap", tur: "hesap" },
      baslangic: { ad: "başlangıç", tur: "tarih" },
      bitis: { ad: "bitiş", tur: "tarih" },
      arama: { ad: "arama", tur: "metin" },
    },
  },
  banka_ekstresi: {
    ad: "Banka ekstresi satırları",
    suzgecler: {
      durum: { ad: "eşleşme durumu", tur: "kod" },
      bankaHesabi: { ad: "banka hesabı", tur: "banka" },
      yon: { ad: "yön (tahsilat/tediye)", tur: "kod" },
      baslangic: { ad: "başlangıç", tur: "tarih" },
      bitis: { ad: "bitiş", tur: "tarih" },
      arama: { ad: "arama", tur: "metin" },
    },
  },
  masraflar: {
    ad: "Masraf listesi",
    suzgecler: {
      durum: { ad: "durum", tur: "kod" },
      kategori: { ad: "kategori", tur: "kimlik" },
      arama: { ad: "arama", tur: "metin" },
    },
  },
  gelen_efatura: {
    ad: "Gelen e-Fatura kutusu",
    seciliTur: "gelen_efatura",
    suzgecler: {
      durum: { ad: "durum", tur: "kod" },
      arama: { ad: "arama", tur: "metin" },
    },
  },
  onaylar: { ad: "Onaylar", suzgecler: { kutu: { ad: "kutu", tur: "kod" } } },
  is_kutusu: { ad: "İş kutusu", suzgecler: { kutu: { ad: "kutu", tur: "kod" } } },
} as const satisfies Record<string, EkranDurumTanimi>;

export type EkranDurumKodu = keyof typeof EKRAN_DURUMLARI;

export interface EkranDurumu {
  ekran: EkranDurumKodu;
  /** Açık sekme kodu. */
  sekme?: string;
  /** Yalnız ekranın izinli süzgeç alanları; boş değerler gönderilmez. */
  suzgecler?: Record<string, string>;
  /** Seçili satır kimlikleri (ekranın `seciliTur`'ü). */
  secili?: string[];
  /** Görünen sayfa (1'den başlar). */
  sayfa?: number;
  /** AI-114: ekranda açık ve düzenlenebilir form (asistan alanlarını doldurabilir). */
  form?: FormKodu;
}

export const EKRAN_SECILI_SINIRI = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KOD = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const HESAP = /^(kasa|banka):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Süzgeç değeri biçime uyuyorsa temizlenmiş hâli, uymuyorsa null. */
export function ekranSuzgecDegeri(tur: EkranSuzgecTuru, deger: unknown): string | null {
  if (typeof deger !== "string") return null;
  const d = deger.trim();
  if (!d) return null;
  switch (tur) {
    case "metin": return d.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 100);
    case "tarih": return TARIH.test(d) ? d : null;
    case "kod": return KOD.test(d) ? d : null;
    case "kimlik": case "cari": case "banka": return UUID.test(d) ? d.toLowerCase() : null;
    case "hesap": return HESAP.test(d) ? d.toLowerCase() : null;
  }
}

/**
 * İstemciden gelen durumu sözleşmeye indirger: tanımsız ekran null, tanımsız süzgeç alanı,
 * biçime uymayan değer ve fazladan seçili kimlik sessizce düşer.
 */
export function ekranDurumunuAyristir(girdi: unknown): EkranDurumu | null {
  if (!girdi || typeof girdi !== "object" || Array.isArray(girdi)) return null;
  const g = girdi as Record<string, unknown>;
  if (typeof g.ekran !== "string" || !Object.prototype.hasOwnProperty.call(EKRAN_DURUMLARI, g.ekran)) return null;
  const ekran = g.ekran as EkranDurumKodu;
  const tanim: EkranDurumTanimi = EKRAN_DURUMLARI[ekran];
  const suzgecler: Record<string, string> = {};
  if (g.suzgecler && typeof g.suzgecler === "object" && !Array.isArray(g.suzgecler)) {
    for (const [alan, deger] of Object.entries(g.suzgecler as Record<string, unknown>)) {
      const t = Object.prototype.hasOwnProperty.call(tanim.suzgecler, alan) ? tanim.suzgecler[alan] : undefined;
      const temiz = t ? ekranSuzgecDegeri(t.tur, deger) : null;
      if (temiz !== null) suzgecler[alan] = temiz;
    }
  }
  const secili = tanim.seciliTur && Array.isArray(g.secili)
    ? [...new Set(g.secili.filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))].slice(0, EKRAN_SECILI_SINIRI)
    : [];
  const sekme = typeof g.sekme === "string" && KOD.test(g.sekme) ? g.sekme : undefined;
  const form = typeof g.form === "string" && (FORM_KODLARI as string[]).includes(g.form) ? (g.form as FormKodu) : undefined;
  const sayfa = typeof g.sayfa === "number" && Number.isInteger(g.sayfa) && g.sayfa > 0 && g.sayfa < 100000 ? g.sayfa : undefined;
  return {
    ekran,
    ...(sekme ? { sekme } : {}),
    ...(Object.keys(suzgecler).length ? { suzgecler } : {}),
    ...(secili.length ? { secili } : {}),
    ...(sayfa ? { sayfa } : {}),
    ...(form ? { form } : {}),
  };
}
