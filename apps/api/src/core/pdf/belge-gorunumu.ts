/**
 * FTR-42: kurumsal belge düzeninin (FTR-37/38) kullanıcının değiştirebildiği
 * yerleri. Renk, yazı ve düzen bütün ticari belgelerde ortaktır; bölümler ve
 * hazır metinler belge türüne (metinler ayrıca dile) göredir. Bozuk ya da
 * bilinmeyen değer varsayılana düşer — basım ayar yüzünden durmaz.
 */
import { z } from "zod";
import { BELGE_DILLERI, type BelgeDili } from "@tekirextra/shared";

export const TICARI_BELGE_TURLERI = ["teklif", "siparis", "proforma", "irsaliye", "makbuz", "fatura"] as const;
export type TicariBelgeTuru = (typeof TICARI_BELGE_TURLERI)[number];

export const YAZI_TIPLERI = ["dejavu", "noto-sans", "noto-serif", "liberation"] as const;
export type YaziTipi = (typeof YAZI_TIPLERI)[number];

export interface BelgeBolumleri {
  /** Banka hesapları (Kasa-Banka'da "belgelerde göster" işaretliler). */
  banka: boolean;
  /** "Yalnız …" satırı. */
  yaziyla: boolean;
  /** İmza alanları. */
  imza: boolean;
  /** Kalem tablosunda kod sütunu. */
  kodSutunu: boolean;
  /** Yüklenmiş kaşe/imza görseli imza alanına basılır. */
  kase: boolean;
}

/** Belge türü + dil başına hazır metinler; boş bırakılan alan sözlükteki varsayılanı kullanır. */
export interface BelgeMetinleri {
  /** Kapanış cümlesi; "" yazılırsa hiç basılmaz. */
  kapanis?: string;
  /** Her belgeye eklenen varsayılan koşullar, satır satır. */
  kosullar?: string;
  /** Sayfanın altındaki küçük not (ör. ticari sicil, KEP adresi). */
  altNot?: string;
  /** İmza alanlarının adları, satır satır; boşsa türün varsayılanları. */
  imzalar?: string;
}

export interface BelgeGorunumu {
  anaRenk: string;
  ikincilRenk: string;
  yaziTipi: YaziTipi;
  yaziBoyutu: "kucuk" | "normal" | "buyuk";
  logoYeri: "sol" | "orta";
  logoBoyutu: "kucuk" | "orta" | "buyuk";
  tabloBaslik: "dolu" | "cizgi" | "sade";
  zebra: boolean;
  kose: "yuvarlak" | "keskin";
  /** Taslak belgede çapraz "TASLAK" filigranı. */
  taslakFiligrani: boolean;
  bolumler: Record<TicariBelgeTuru, BelgeBolumleri>;
  metinler: Partial<Record<TicariBelgeTuru, Partial<Record<BelgeDili, BelgeMetinleri>>>>;
}

const bolum = (banka: boolean, yaziyla: boolean, imza: boolean): BelgeBolumleri =>
  ({ banka, yaziyla, imza, kodSutunu: true, kase: false });

export const VARSAYILAN_GORUNUM: BelgeGorunumu = {
  anaRenk: "#0f766e",
  ikincilRenk: "#1f2937",
  yaziTipi: "dejavu",
  yaziBoyutu: "normal",
  logoYeri: "sol",
  logoBoyutu: "orta",
  tabloBaslik: "dolu",
  zebra: true,
  kose: "yuvarlak",
  taslakFiligrani: true,
  bolumler: {
    teklif: bolum(true, true, true),
    siparis: bolum(false, true, true),
    proforma: bolum(true, true, true),
    irsaliye: bolum(false, false, true),
    makbuz: bolum(false, true, true),
    fatura: bolum(true, true, false),
  },
  metinler: {},
};

const secim = <T extends string>(deger: unknown, izinli: readonly T[], varsayilan: T): T =>
  izinli.includes(deger as T) ? (deger as T) : varsayilan;
const bayrak = (deger: unknown, varsayilan: boolean): boolean =>
  typeof deger === "boolean" ? deger : varsayilan;
const renk = (deger: unknown, varsayilan: string): string =>
  typeof deger === "string" && /^#[0-9a-fA-F]{6}$/.test(deger.trim()) ? deger.trim().toLowerCase() : varsayilan;
const metin = (deger: unknown, sinir: number): string | undefined =>
  typeof deger === "string" ? deger.slice(0, sinir) : undefined;

export const METIN_SINIRI = { kapanis: 600, kosullar: 2000, altNot: 300, imzalar: 300 } as const;

/** Kayıtlı (ya da eksik/bozuk) ayardan her alanı dolu bir görünüm üretir. */
export function gorunumNormalize(ham: unknown): BelgeGorunumu {
  const g = (ham && typeof ham === "object" ? ham : {}) as Record<string, unknown>;
  const v = VARSAYILAN_GORUNUM;
  const hamBolumler = (g.bolumler && typeof g.bolumler === "object" ? g.bolumler : {}) as Record<string, Record<string, unknown> | undefined>;
  const hamMetinler = (g.metinler && typeof g.metinler === "object" ? g.metinler : {}) as Record<string, Record<string, Record<string, unknown> | undefined> | undefined>;

  const bolumler = Object.fromEntries(TICARI_BELGE_TURLERI.map((tur) => {
    const h = hamBolumler[tur] ?? {};
    const d = v.bolumler[tur];
    return [tur, {
      banka: bayrak(h.banka, d.banka), yaziyla: bayrak(h.yaziyla, d.yaziyla), imza: bayrak(h.imza, d.imza),
      kodSutunu: bayrak(h.kodSutunu, d.kodSutunu), kase: bayrak(h.kase, d.kase),
    }];
  })) as Record<TicariBelgeTuru, BelgeBolumleri>;

  const metinler: BelgeGorunumu["metinler"] = {};
  for (const tur of TICARI_BELGE_TURLERI) {
    for (const dil of BELGE_DILLERI) {
      const h = hamMetinler[tur]?.[dil];
      if (!h || typeof h !== "object") continue;
      const m: BelgeMetinleri = {};
      for (const alan of Object.keys(METIN_SINIRI) as (keyof BelgeMetinleri)[]) {
        const deger = metin(h[alan], METIN_SINIRI[alan]);
        if (deger !== undefined) m[alan] = deger;
      }
      if (Object.keys(m).length) (metinler[tur] ??= {})[dil] = m;
    }
  }

  return {
    anaRenk: renk(g.anaRenk, v.anaRenk),
    ikincilRenk: renk(g.ikincilRenk, v.ikincilRenk),
    yaziTipi: secim(g.yaziTipi, YAZI_TIPLERI, v.yaziTipi),
    yaziBoyutu: secim(g.yaziBoyutu, ["kucuk", "normal", "buyuk"] as const, v.yaziBoyutu),
    logoYeri: secim(g.logoYeri, ["sol", "orta"] as const, v.logoYeri),
    logoBoyutu: secim(g.logoBoyutu, ["kucuk", "orta", "buyuk"] as const, v.logoBoyutu),
    tabloBaslik: secim(g.tabloBaslik, ["dolu", "cizgi", "sade"] as const, v.tabloBaslik),
    zebra: bayrak(g.zebra, v.zebra),
    kose: secim(g.kose, ["yuvarlak", "keskin"] as const, v.kose),
    taslakFiligrani: bayrak(g.taslakFiligrani, v.taslakFiligrani),
    bolumler,
    metinler,
  };
}

/**
 * Yazı tipi yığını. Arapça belgede Arapça yazı tipi önce gelir; Latin
 * yazı tiplerinde olmayan Arapça/Kiril glifleri yedeklerden bulunur.
 */
export function yaziTipiYigini(tip: YaziTipi, dil: BelgeDili): string {
  const ana = {
    dejavu: '"DejaVu Sans"',
    "noto-sans": '"Noto Sans"',
    "noto-serif": '"Noto Serif"',
    liberation: '"Liberation Sans"',
  }[tip];
  const arapca = tip === "noto-serif" ? '"Noto Naskh Arabic"' : '"Noto Sans Arabic"';
  const govde = tip === "noto-serif" ? "serif" : "sans-serif";
  return dil === "ar"
    ? `${arapca}, ${ana}, "DejaVu Sans", ${govde}`
    : `${ana}, "DejaVu Sans", ${arapca}, ${govde}`;
}

export const BELGE_GORUNUMU_MODULU = "belgeGorunumu";

const renkAlani = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Renk #rrggbb biçiminde olmalıdır");
const bolumSemasi = z.object({
  banka: z.boolean(), yaziyla: z.boolean(), imza: z.boolean(), kodSutunu: z.boolean(), kase: z.boolean(),
}).partial();
const metinSemasi = z.object({
  kapanis: z.string().max(METIN_SINIRI.kapanis),
  kosullar: z.string().max(METIN_SINIRI.kosullar),
  altNot: z.string().max(METIN_SINIRI.altNot),
  imzalar: z.string().max(METIN_SINIRI.imzalar),
}).partial();
const turAnahtari = z.enum(TICARI_BELGE_TURLERI);

/** Kayıt şeması: her alan isteğe bağlı, eksikler okunurken varsayılana düşer. */
export const belgeGorunumuSemasi = z.object({
  anaRenk: renkAlani,
  ikincilRenk: renkAlani,
  yaziTipi: z.enum(YAZI_TIPLERI),
  yaziBoyutu: z.enum(["kucuk", "normal", "buyuk"]),
  logoYeri: z.enum(["sol", "orta"]),
  logoBoyutu: z.enum(["kucuk", "orta", "buyuk"]),
  tabloBaslik: z.enum(["dolu", "cizgi", "sade"]),
  zebra: z.boolean(),
  kose: z.enum(["yuvarlak", "keskin"]),
  taslakFiligrani: z.boolean(),
  bolumler: z.partialRecord(turAnahtari, bolumSemasi),
  metinler: z.partialRecord(turAnahtari, z.partialRecord(z.enum(BELGE_DILLERI), metinSemasi)),
}).partial();
