/**
 * Mevzuat Merkezi (MVZ, karar 2026-10-09).
 *
 * Vergi ve belge mevzuatına bağlı değerler kiracının değil ürünün sorumluluğundadır:
 * merkezi, yürürlük tarihli tablolarda tutulur, yalnız platform ekibi dört göz
 * ilkesiyle değiştirir ve tüm kiracılar için geçerli olur. Bu dosya türlerin
 * tanımını (ekranın alan listesi) ve değer doğrulamasını taşır; platform paneli
 * ve API aynı kuralı kullanır.
 *
 * Her kayıt `(tur, anahtar)` ile tanınır ve bir yürürlük aralığı taşır; belge
 * kendi tarihindeki değeri kullanır (MVZ-02).
 */

export const MEVZUAT_TURLERI = ["tevkifat_kodu", "kdv_orani", "kdv_istisna_kodu", "ozel_matrah_kodu", "ihrac_kayitli_kodu", "kanuni_deger"] as const;
export type MevzuatTuru = (typeof MEVZUAT_TURLERI)[number];

export type MevzuatAlanTipi = "metin" | "sayi" | "oranlar" | "secim";

export interface MevzuatAlan {
  ad: string;
  etiket: string;
  tip: MevzuatAlanTipi;
  zorunlu: boolean;
  secenekler?: readonly (readonly [string, string])[];
  ipucu?: string;
}

export interface MevzuatTurTanimi {
  tur: MevzuatTuru;
  ad: string;
  anahtarEtiketi: string;
  anahtarIpucu: string;
  anahtarDeseni: RegExp;
  /** Anahtar serbest değil, bu listeden seçilir (kanuni değerler). */
  anahtarSecenekleri?: readonly (readonly [string, string])[];
  alanlar: readonly MevzuatAlan[];
}

/** MVZ-13: kiracı ayarından merkeze taşınan kanuni süre ve eşikler. */
export const KANUNI_DEGERLER = [
  ["babs_esigi", "Form BA/BS bildirim eşiği (TL, KDV hariç aylık)"],
  ["earsiv_iptal_gun", "e-Arşiv fatura iptal süresi (gün)"],
  ["irsaliye_fatura_gun", "İrsaliyenin faturalanma süresi (gün)"],
  ["tevkifat_alt_siniri", "KDV tevkifatı alt sınırı (TL, KDV dahil)"],
] as const;

export const MEVZUAT_TUR_TANIMLARI: Record<MevzuatTuru, MevzuatTurTanimi> = {
  tevkifat_kodu: {
    tur: "tevkifat_kodu",
    ad: "KDV tevkifat kodu",
    anahtarEtiketi: "Kod",
    anahtarIpucu: "GİB kodu, üç hane (ör. 601)",
    anahtarDeseni: /^\d{3}$/,
    alanlar: [
      { ad: "ad", etiket: "Ad", tip: "metin", zorunlu: true },
      { ad: "oranlar", etiket: "Oranlar", tip: "oranlar", zorunlu: true, ipucu: "ör. 4/10; birden çok oran virgülle (650)" },
    ],
  },
  kdv_orani: {
    tur: "kdv_orani",
    ad: "KDV oranı",
    anahtarEtiketi: "Oran (%)",
    anahtarIpucu: "ör. 20",
    anahtarDeseni: /^\d{1,2}$/,
    alanlar: [{ ad: "aciklama", etiket: "Açıklama", tip: "metin", zorunlu: false, ipucu: "ör. genel oran, indirimli oran" }],
  },
  kdv_istisna_kodu: {
    tur: "kdv_istisna_kodu",
    ad: "KDV istisna kodu",
    anahtarEtiketi: "Kod",
    anahtarIpucu: "GİB kodu, üç hane (ör. 301)",
    anahtarDeseni: /^\d{3}$/,
    alanlar: [
      { ad: "ad", etiket: "Ad", tip: "metin", zorunlu: true },
      { ad: "istisnaTuru", etiket: "İstisna türü", tip: "secim", zorunlu: true, secenekler: [["kismi", "Kısmi istisna"], ["tam", "Tam istisna"]] },
    ],
  },
  ozel_matrah_kodu: {
    tur: "ozel_matrah_kodu",
    ad: "Özel matrah kodu",
    anahtarEtiketi: "Kod",
    anahtarIpucu: "GİB kodu, üç hane (ör. 812)",
    anahtarDeseni: /^\d{3}$/,
    alanlar: [{ ad: "ad", etiket: "Ad", tip: "metin", zorunlu: true }],
  },
  ihrac_kayitli_kodu: {
    tur: "ihrac_kayitli_kodu",
    ad: "İhraç kayıtlı kodu",
    anahtarEtiketi: "Kod",
    anahtarIpucu: "GİB kodu, üç hane (ör. 701)",
    anahtarDeseni: /^\d{3}$/,
    alanlar: [{ ad: "ad", etiket: "Ad", tip: "metin", zorunlu: true }],
  },
  kanuni_deger: {
    tur: "kanuni_deger",
    ad: "Kanuni süre ve eşik",
    anahtarEtiketi: "Değer",
    anahtarIpucu: "Listeden seçin",
    anahtarDeseni: /^[a-z_]+$/,
    anahtarSecenekleri: KANUNI_DEGERLER,
    alanlar: [{ ad: "deger", etiket: "Değer", tip: "sayi", zorunlu: true }],
  },
};

export function mevzuatTuruMu(tur: string): tur is MevzuatTuru {
  return (MEVZUAT_TURLERI as readonly string[]).includes(tur);
}

const ORAN_DESENI = /^(\d{1,2})\/(\d{1,2})$/;

/** Bir kaydın anahtarını ve değerini türüne göre denetler (panel ve API aynı liste). */
export function mevzuatDegerHatalari(tur: string, anahtar: string, deger: unknown): string[] {
  if (!mevzuatTuruMu(tur)) return [`Tanımsız mevzuat türü: ${tur}`];
  const tanim = MEVZUAT_TUR_TANIMLARI[tur];
  const hatalar: string[] = [];
  if (!tanim.anahtarDeseni.test(anahtar)) hatalar.push(`${tanim.anahtarEtiketi} geçersiz: ${anahtar || "(boş)"} — ${tanim.anahtarIpucu}`);
  if (tanim.anahtarSecenekleri && !tanim.anahtarSecenekleri.some(([k]) => k === anahtar)) hatalar.push(`Tanımsız kanuni değer: ${anahtar}`);
  if (tur === "kdv_orani" && Number(anahtar) > 100) hatalar.push("KDV oranı %100'ü aşamaz");

  const nesne = (deger && typeof deger === "object" && !Array.isArray(deger) ? deger : {}) as Record<string, unknown>;
  const bilinen = new Set(tanim.alanlar.map((a) => a.ad));
  for (const ad of Object.keys(nesne)) if (!bilinen.has(ad)) hatalar.push(`Bilinmeyen alan: ${ad}`);
  for (const alan of tanim.alanlar) {
    const v = nesne[alan.ad];
    const bos = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (bos) { if (alan.zorunlu) hatalar.push(`${alan.etiket} zorunludur`); continue; }
    if (alan.tip === "metin" && (typeof v !== "string" || v.trim().length > 500)) hatalar.push(`${alan.etiket} en çok 500 karakterlik metin olmalıdır`);
    if (alan.tip === "sayi" && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) hatalar.push(`${alan.etiket} sıfır ya da pozitif sayı olmalıdır`);
    if (alan.tip === "secim" && !alan.secenekler?.some(([k]) => k === v)) hatalar.push(`${alan.etiket} geçersiz: ${String(v)}`);
    if (alan.tip === "oranlar") {
      const liste = Array.isArray(v) ? v : [];
      if (!Array.isArray(v) || liste.some((o) => typeof o !== "string")) { hatalar.push(`${alan.etiket} metin listesi olmalıdır`); continue; }
      for (const o of liste as string[]) {
        const e = o.match(ORAN_DESENI);
        if (!e || Number(e[1]) < 1 || Number(e[1]) > Number(e[2])) hatalar.push(`${alan.etiket} geçersiz: ${o} (ör. 4/10)`);
      }
      if (new Set(liste).size !== liste.length) hatalar.push(`${alan.etiket} içinde aynı oran birden çok kez var`);
    }
  }
  return hatalar;
}

/** Değeri ekranda tek satırda anlatır (değişiklik listesi, kiracı görünümü). */
export function mevzuatDegerOzeti(tur: string, deger: unknown): string {
  if (!mevzuatTuruMu(tur) || !deger || typeof deger !== "object") return "";
  const nesne = deger as Record<string, unknown>;
  return MEVZUAT_TUR_TANIMLARI[tur].alanlar
    .filter((a) => nesne[a.ad] !== undefined && nesne[a.ad] !== null && nesne[a.ad] !== "")
    .map((a) => {
      const v = nesne[a.ad];
      if (a.tip === "secim") return a.secenekler?.find(([k]) => k === v)?.[1] ?? String(v);
      if (Array.isArray(v)) return v.join(", ");
      if (typeof v === "number") return v.toLocaleString("tr-TR");
      return String(v);
    })
    .join(" · ");
}

/** "YYYY-MM-DD" bir gün önce (yürürlük bitişi = yeni kaydın başlangıcından önceki gün). */
export function oncekiGun(tarih: string): string {
  const d = new Date(`${tarih}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
