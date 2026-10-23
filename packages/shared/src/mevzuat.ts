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

export const MEVZUAT_TURLERI = ["tevkifat_kodu", "kdv_orani", "kdv_istisna_kodu", "ozel_matrah_kodu", "ihrac_kayitli_kodu", "kanuni_deger", "bordro_parametreleri", "vergi_turu_kodu"] as const;
export type MevzuatTuru = (typeof MEVZUAT_TURLERI)[number];

export type MevzuatAlanTipi = "metin" | "sayi" | "oranlar" | "secim" | "dilimler";

export interface MevzuatAlan {
  ad: string;
  etiket: string;
  tip: MevzuatAlanTipi;
  zorunlu: boolean;
  secenekler?: readonly (readonly [string, string])[];
  ipucu?: string;
  /** Sayı alanında üst sınır (ör. yüzde alanlarında 100). */
  azami?: number;
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
  /** Çok alanlı türlerde özet ve düzenleyici alan adlarını da gösterir (bordro). */
  etiketli?: boolean;
}

/** MVZ-13: kiracı ayarından merkeze taşınan kanuni süre ve eşikler. */
export const KANUNI_DEGERLER = [
  ["babs_esigi", "Form BA/BS bildirim eşiği (TL, KDV hariç aylık)"],
  ["earsiv_iptal_gun", "e-Arşiv fatura iptal süresi (gün)"],
  ["irsaliye_fatura_gun", "İrsaliyenin faturalanma süresi (gün)"],
  ["tevkifat_alt_siniri", "KDV tevkifatı alt sınırı (TL, KDV dahil; yalnız başladığı yılda geçerli)"],
  ["kidem_tavani", "Kıdem tazminatı tavanı (TL; yalnız başladığı yarıyılda geçerli)"],
  ["dogrudan_gider_siniri", "Doğrudan gider yazılabilecek demirbaş tutarı (VUK 313, TL; yalnız başladığı yılda geçerli)"],
  ["binek_amortisman_siniri", "Binek oto amortisman sınırı, ÖTV/KDV hariç ilk iktisap (GVK 40/5, TL; edinme yılına göre)"],
  ["binek_amortisman_siniri_vergili", "Binek oto amortisman sınırı, vergiler maliyette ya da ikinci el (GVK 40/5, TL; edinme yılına göre)"],
  ["binek_gider_orani", "Binek oto giderlerinin gider yazılabilecek oranı (GVK 40/5, %)"],
  ["binek_kira_siniri", "Kiralık binek otonun aylık kira gider sınırı (GVK 40/5, TL, KDV hariç; yalnız başladığı yılda geçerli)"],
] as const;

/**
 * MVZ-14: bordro mevzuatı tek kayıtta bütün set olarak tutulur (`genel`
 * anahtarı). Gelir vergisi tarifesi yıllık olduğundan bir kayıt yalnız
 * başladığı takvim yılının dönemlerine uygulanır; yeni yıl için yayın
 * yapılmadıysa bordro önceki yılın değerleriyle hesaplanmaz.
 */
export const BORDRO_ANAHTARI = "genel";

const yuzde = (ad: string, etiket: string, ipucu?: string): MevzuatAlan => ({ ad, etiket, tip: "sayi", zorunlu: true, azami: 100, ipucu });
const tutar = (ad: string, etiket: string, ipucu?: string): MevzuatAlan => ({ ad, etiket, tip: "sayi", zorunlu: true, ipucu });

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
  vergi_turu_kodu: {
    tur: "vergi_turu_kodu",
    ad: "KDV dışı vergi türü",
    anahtarEtiketi: "Kod",
    anahtarIpucu: "UBL vergi türü kodu, dört hane (ör. 0071)",
    anahtarDeseni: /^\d{4}$/,
    alanlar: [
      { ad: "ad", etiket: "Ad", tip: "metin", zorunlu: true },
      { ad: "davranis", etiket: "Davranış", tip: "secim", zorunlu: true, secenekler: [["maliyet", "Bedele eklenir (maliyet unsuru)"], ["stopaj", "Stopaj (alıcı keser, ödenecekten düşer)"]] },
      { ad: "kdvMatrahi", etiket: "KDV matrahı", tip: "secim", zorunlu: true, secenekler: [["dahil", "KDV matrahına dahil"], ["haric", "KDV matrahına dahil değil"]] },
    ],
  },
  bordro_parametreleri: {
    tur: "bordro_parametreleri",
    ad: "Bordro parametreleri",
    anahtarEtiketi: "Set",
    anahtarIpucu: "Listeden seçin",
    anahtarDeseni: /^genel$/,
    anahtarSecenekleri: [[BORDRO_ANAHTARI, "Bordro parametreleri (tam set)"]],
    etiketli: true,
    alanlar: [
      tutar("asgariUcretBrut", "Asgari ücret brüt (TL/ay)"),
      tutar("sgkTavan", "SGK tavanı (TL/ay)"),
      yuzde("sgkIsciOrani", "SGK işçi %"),
      yuzde("issizlikIsciOrani", "İşsizlik işçi %"),
      yuzde("sgkIsverenOrani", "SGK işveren %"),
      yuzde("issizlikIsverenOrani", "İşsizlik işveren %"),
      yuzde("sgkTesvikAzamiOrani", "Hazine teşviki azami puan"),
      tutar("yemekGelirVergisiGunlukIstisna", "Yemek GV istisnası (TL/gün)"),
      tutar("yemekSgkGunlukIstisna", "Yemek SGK istisnası (TL/gün)"),
      tutar("engellilikDerece1", "Engellilik indirimi 1. derece (TL/ay)"),
      tutar("engellilikDerece2", "Engellilik indirimi 2. derece (TL/ay)"),
      tutar("engellilikDerece3", "Engellilik indirimi 3. derece (TL/ay)"),
      yuzde("damgaVergisiOrani", "Damga vergisi %", "binde 7,59 → 0,759"),
      { ad: "gelirVergisiDilimleri", etiket: "GV dilimleri", tip: "dilimler", zorunlu: true, ipucu: "üst sınır:oran; son dilim sınırsız — ör. 190000:15; 400000:20; :40" },
    ],
  },
};

export interface GelirVergisiDilimi {
  ustSinir: number | null;
  oran: number;
}

/** "190000:15; 400000:20; :40" → dilim listesi (düzenleyici metni). Çözülemeyen parça NaN olur, doğrulama yakalar. */
export function dilimleriCoz(metin: string): GelirVergisiDilimi[] {
  return metin.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const [ust = "", oran = ""] = p.split(":").map((x) => x.trim());
    const sayi = (x: string) => Number(x.includes(",") ? x.replace(/\./g, "").replace(",", ".") : x);
    return { ustSinir: ust === "" ? null : sayi(ust), oran: sayi(oran) };
  });
}

export function dilimMetni(dilimler: unknown): string {
  return Array.isArray(dilimler) ? (dilimler as GelirVergisiDilimi[]).map((d) => `${d.ustSinir ?? ""}:${d.oran}`).join("; ") : "";
}

function dilimHatalari(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || v.length > 10) return ["GV dilimleri 1–10 dilimlik liste olmalıdır"];
  const hatalar: string[] = [];
  const liste = v as GelirVergisiDilimi[];
  liste.forEach((d, i) => {
    const son = i === liste.length - 1;
    if (!d || typeof d !== "object" || typeof d.oran !== "number" || !Number.isFinite(d.oran) || d.oran < 0 || d.oran > 100) hatalar.push(`GV ${i + 1}. dilim oranı 0–100 arasında olmalıdır`);
    if (son ? d?.ustSinir !== null : typeof d?.ustSinir !== "number" || !Number.isFinite(d.ustSinir) || d.ustSinir <= 0) hatalar.push(son ? "Son GV dilimi üst sınırsız olmalıdır (ör. :40)" : `GV ${i + 1}. dilim üst sınırı pozitif sayı olmalıdır`);
    if (i > 0 && !son && typeof d?.ustSinir === "number" && typeof liste[i - 1]?.ustSinir === "number" && d.ustSinir <= liste[i - 1]!.ustSinir!) hatalar.push("GV dilimleri artan sırada olmalıdır");
  });
  return hatalar;
}

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
    else if (alan.tip === "sayi" && alan.azami !== undefined && (v as number) > alan.azami) hatalar.push(`${alan.etiket} en çok ${alan.azami} olabilir`);
    if (alan.tip === "dilimler") hatalar.push(...dilimHatalari(v));
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
  if (tur === "bordro_parametreleri" && typeof nesne.sgkTavan === "number" && typeof nesne.asgariUcretBrut === "number" && nesne.sgkTavan < nesne.asgariUcretBrut) {
    hatalar.push("SGK tavanı asgari ücretten düşük olamaz");
  }
  return hatalar;
}

/** Değeri ekranda tek satırda anlatır (değişiklik listesi, kiracı görünümü). */
export function mevzuatDegerOzeti(tur: string, deger: unknown): string {
  if (!mevzuatTuruMu(tur) || !deger || typeof deger !== "object") return "";
  const nesne = deger as Record<string, unknown>;
  const tanim = MEVZUAT_TUR_TANIMLARI[tur];
  return tanim.alanlar
    .filter((a) => nesne[a.ad] !== undefined && nesne[a.ad] !== null && nesne[a.ad] !== "")
    .map((a) => {
      const v = nesne[a.ad];
      const metin = a.tip === "secim" ? a.secenekler?.find(([k]) => k === v)?.[1] ?? String(v)
        : a.tip === "dilimler" && Array.isArray(v) ? (v as GelirVergisiDilimi[]).map((d) => d.ustSinir === null ? `üstü %${d.oran}` : `${d.ustSinir.toLocaleString("tr-TR")}'e kadar %${d.oran}`).join(", ")
        : Array.isArray(v) ? v.join(", ")
        : typeof v === "number" ? v.toLocaleString("tr-TR")
        : String(v);
      return tanim.etiketli ? `${a.etiket}: ${metin}` : metin;
    })
    .join(" · ");
}

/** "YYYY-MM-DD" bir gün önce (yürürlük bitişi = yeni kaydın başlangıcından önceki gün). */
export function oncekiGun(tarih: string): string {
  const d = new Date(`${tarih}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
