/**
 * AI-114: asistanın tarayıcıda çalıştırdığı arayüz eylemleri. Model aracı çağırır, sunucu
 * bu sözleşmeyle doğrular, eylem yanıtla tarayıcıya gider ve orada uygulanır. Eylemler
 * kayıt oluşturmaz, kaydetmez, onay gerektirmez; kullanıcı her birini geri alabilir.
 */

export const ARAYUZ_EYLEM_TURLERI = ["sayfaya_git", "suzgec_uygula", "sekme_ac", "kayit_vurgula", "formu_doldur"] as const;
export type ArayuzEylemTuru = (typeof ARAYUZ_EYLEM_TURLERI)[number];

/** Form alanı türü; `para` alanı yalnız kullanıcının mesajında ya da araç çıktısında geçen tutarla doldurulur. */
export type FormAlanTuru = "metin" | "tarih" | "para" | "oran" | "sayi" | "cari" | "stok";

export interface FormTanimi {
  ad: string;
  alanlar: Record<string, { ad: string; tur: FormAlanTuru }>;
  /** Kalem satırları doldurulabilir mi (stok, miktar, birim fiyat, KDV, iskonto). */
  satirlar?: boolean;
}

export const FORM_TANIMLARI = {
  fatura: {
    ad: "Fatura formu",
    satirlar: true,
    alanlar: {
      cariId: { ad: "cari", tur: "cari" },
      tarih: { ad: "tarih", tur: "tarih" },
      vadeTarihi: { ad: "vade tarihi", tur: "tarih" },
      aciklama: { ad: "açıklama", tur: "metin" },
      notlar: { ad: "notlar", tur: "metin" },
    },
  },
  belge: {
    ad: "Teklif/sipariş/irsaliye formu",
    satirlar: true,
    alanlar: {
      cariId: { ad: "cari", tur: "cari" },
      tarih: { ad: "tarih", tur: "tarih" },
      aciklama: { ad: "açıklama", tur: "metin" },
    },
  },
  masraf: {
    ad: "Masraf formu",
    alanlar: {
      belgeNo: { ad: "belge no", tur: "metin" },
      tarih: { ad: "tarih", tur: "tarih" },
      saticiUnvan: { ad: "satıcı unvanı", tur: "metin" },
      aciklama: { ad: "açıklama", tur: "metin" },
      toplam: { ad: "toplam tutar (KDV dahil)", tur: "para" },
      kdvOrani: { ad: "KDV oranı", tur: "oran" },
    },
  },
} as const satisfies Record<string, FormTanimi>;

export type FormKodu = keyof typeof FORM_TANIMLARI;
export const FORM_KODLARI = Object.keys(FORM_TANIMLARI) as FormKodu[];

export const SATIR_ALANLARI: Record<string, { ad: string; tur: FormAlanTuru }> = {
  stokId: { ad: "ürün", tur: "stok" },
  miktar: { ad: "miktar", tur: "sayi" },
  birimFiyat: { ad: "birim fiyat", tur: "para" },
  kdvOrani: { ad: "KDV oranı", tur: "oran" },
  iskontoOrani: { ad: "iskonto oranı", tur: "oran" },
};
export const FORM_SATIR_SINIRI = 50;

export interface FormSatiri { stokId: string; miktar: number; birimFiyat?: number; kdvOrani?: number; iskontoOrani?: number }

/** Tarayıcıya giden, doğrulanmış eylem. */
export type ArayuzEylemi =
  | { tur: "sayfaya_git"; yol: string }
  | { tur: "suzgec_uygula"; ekran: string; suzgecler: Record<string, string> }
  | { tur: "sekme_ac"; ekran: string; sekme: string }
  | { tur: "kayit_vurgula"; ekran: string; idler: string[] }
  | { tur: "formu_doldur"; form: FormKodu; alanlar: Record<string, string | number>; satirlar?: FormSatiri[] };

/** Tarayıcının bildirdiği eylem sonucu (sonraki mesajla gelir). */
export const ARAYUZ_SONUCLARI = ["basarili", "ekran_bulunamadi", "alan_yok", "geri_alindi", "hata"] as const;
export type ArayuzSonucu = (typeof ARAYUZ_SONUCLARI)[number];
export interface ArayuzEylemSonucu { tur: ArayuzEylemTuru; sonuc: ArayuzSonucu }

/** İstemcinin bildirdiği sonuçları sözleşmeye indirger (en çok 5). */
export function arayuzSonuclariniAyristir(girdi: unknown): ArayuzEylemSonucu[] {
  if (!Array.isArray(girdi)) return [];
  return girdi
    .filter((x): x is { tur: unknown; sonuc: unknown } => !!x && typeof x === "object")
    .filter((x) => (ARAYUZ_EYLEM_TURLERI as readonly unknown[]).includes(x.tur) && (ARAYUZ_SONUCLARI as readonly unknown[]).includes(x.sonuc))
    .slice(0, 5)
    .map((x) => ({ tur: x.tur as ArayuzEylemTuru, sonuc: x.sonuc as ArayuzSonucu }));
}

const KIMLIK = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KIMLIK_RE = new RegExp(`^${KIMLIK}$`, "i");

/**
 * Kimlik taşıyan panel yolları ve kimliğin türü. Sunucu bu kimliği kullanıcının rolüyle
 * okur; okuyamazsa yönlendirme yapılmaz.
 */
export const KAYIT_YOLLARI: Array<{ desen: RegExp; tur: string }> = [
  { desen: new RegExp(`^/panel/cari/(${KIMLIK})$`, "i"), tur: "cari" },
  { desen: new RegExp(`^/panel/stok/(${KIMLIK})$`, "i"), tur: "stok" },
  { desen: new RegExp(`^/panel/personel/(${KIMLIK})$`, "i"), tur: "personel" },
  { desen: new RegExp(`^/panel/uretim/emirler/(${KIMLIK})$`, "i"), tur: "uretim_emri" },
  { desen: new RegExp(`^/panel/crm/(${KIMLIK})$`, "i"), tur: "crm_firsati" },
];

/** Sorgu parametresi → izin ve (kimlikse) türü. */
export const YOL_PARAMETRELERI: Record<string, { tur: "kod" | "kimlik" | "tarih" | "hesap"; kayit?: string }> = {
  tur: { tur: "kod" }, yon: { tur: "kod" }, durum: { tur: "kod" }, odeme: { tur: "kod" }, ebelge: { tur: "kod" }, rapor: { tur: "kod" },
  baslangic: { tur: "tarih" }, bitis: { tur: "tarih" },
  faturaId: { tur: "kimlik", kayit: "fatura" },
  odak: { tur: "kimlik", kayit: "belge" },
  ac: { tur: "kimlik", kayit: "gelen_efatura" },
  talep: { tur: "kimlik", kayit: "satin_alma_talebi" },
  hesap: { tur: "hesap", kayit: "kasa_banka_hesabi" },
  bankaHesapId: { tur: "kimlik" },
};

export interface CozulmusYol { yol: string; kayitlar: Array<{ tur: string; id: string }> }

/**
 * Yönlendirme yolunu doğrular: yalnız `/panel` altı, en çok 4 bölüm, küçük harf/rakam/tire;
 * kimlik yalnız `KAYIT_YOLLARI` desenlerinde; sorgu yalnız `YOL_PARAMETRELERI`. Uymayan null.
 */
export function panelYolunuCoz(girdi: unknown): CozulmusYol | null {
  if (typeof girdi !== "string" || girdi.length > 200) return null;
  const [yolKismi, sorgu = "", ...fazla] = girdi.trim().split("?");
  if (fazla.length || !yolKismi || /#|\.\.|\/\/|\\/.test(girdi)) return null;
  const yol = yolKismi.replace(/\/+$/, "") || "/panel";
  const kayitlar: Array<{ tur: string; id: string }> = [];
  const kayitYolu = KAYIT_YOLLARI.map((k) => ({ k, m: k.desen.exec(yol) })).find((x) => x.m);
  if (kayitYolu) kayitlar.push({ tur: kayitYolu.k.tur, id: kayitYolu.m![1]!.toLowerCase() });
  else if (!/^\/panel(\/[a-z0-9-]{1,40}){0,4}$/.test(yol)) return null;
  // Paylaşılan pakette DOM/Node türleri yok; sorgu elle ayrıştırılır.
  const ciftler: Array<[string, string]> = [];
  for (const parca of sorgu.split("&").filter(Boolean)) {
    const [hamAd = "", hamDeger = ""] = parca.split("=");
    let ad: string, deger: string;
    try { ad = decodeURIComponent(hamAd); deger = decodeURIComponent(hamDeger.replace(/\+/g, " ")); } catch { return null; }
    ciftler.push([ad, deger]);
  }
  const temiz: Array<[string, string]> = [];
  for (const [ad, deger] of ciftler) {
    const p = YOL_PARAMETRELERI[ad];
    if (!p) return null;
    const ok = p.tur === "kod" ? /^[a-z0-9][a-z0-9_.-]{0,59}$/.test(deger)
      : p.tur === "tarih" ? /^\d{4}-\d{2}-\d{2}$/.test(deger)
      : p.tur === "hesap" ? new RegExp(`^(kasa|banka):${KIMLIK}$`, "i").test(deger)
      : KIMLIK_RE.test(deger);
    if (!ok) return null;
    if (p.kayit) kayitlar.push({ tur: p.kayit, id: deger.toLowerCase() });
    if (temiz.some(([a]) => a === ad)) return null;
    temiz.push([ad, p.tur === "kod" || p.tur === "tarih" ? deger : deger.toLowerCase()]);
  }
  const q = temiz.map(([a, d]) => `${encodeURIComponent(a)}=${encodeURIComponent(d)}`).join("&");
  return { yol: q ? `${yol}?${q}` : yol, kayitlar };
}

/** Metindeki sayıları (Türkçe 1.250,50 / İngilizce 1,250.50 / 1250 / 1250.5) çözer. */
export function metindekiSayilar(metin: string): number[] {
  const sonuc: number[] = [];
  for (const m of metin.matchAll(/-?\d[\d.,]*/g)) {
    const ham = m[0].replace(/[.,]$/, "");
    const adaylar = new Set<number>();
    const tr = ham.replace(/\./g, "").replace(",", ".");
    const en = ham.replace(/,/g, "");
    for (const a of [tr, en]) { const n = Number(a); if (Number.isFinite(n)) adaylar.add(n); }
    sonuc.push(...adaylar);
  }
  return sonuc;
}

/** AI-111/AI-114: tutar kaynak metinde (kullanıcı mesajı + araç çıktıları) geçiyor mu. */
export function tutarKaynaktaVar(tutar: number, kaynakMetni: string): boolean {
  if (!Number.isFinite(tutar)) return false;
  return metindekiSayilar(kaynakMetni).some((n) => Math.abs(n - tutar) < 0.005);
}
