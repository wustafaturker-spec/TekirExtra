import { HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { istanbulAyBaslangici } from "../ai-zaman";

/** Milyon token başına USD fiyatı. */
export interface TokenFiyati { giris: number; cikis: number }

/**
 * AI-28…31: bir kiracıya uygulanan aylık maliyet kuralı. Platform anahtarıyla
 * (kiracı kendi anahtarını girmemiş) yapılan çağrıyı platform öder: fiyat
 * platform ortamından gelir ve platform tavanı da uygulanır. Kiracının kendi
 * anahtarında yalnız kiracının girdiği fiyat ve bütçe geçerlidir.
 */
export interface ButceKurali {
  platformAnahtari: boolean;
  fiyat: TokenFiyati | null;
  kiraciButcesiUsd: number | null;
  platformTavaniUsd: number | null;
  /** Uygulanan sınır: tanımlı olanların küçüğü; hiçbiri yoksa yalnız günlük çağrı sınırı vardır. */
  sinirUsd: number | null;
}

/**
 * AI-30: bütçe ya da günlük sınır nedeniyle yapılmayan çağrı. Zamanlanmış görev
 * bu hatada yeniden denenmez; sınır aynı gün/ay içinde kendiliğinden açılmaz.
 */
export class AiSinirHatasi extends HttpException {
  constructor(mesaj: string, durum = 429) { super(mesaj, durum); }
}

function ortamSayisi(ad: string): number | null {
  const deger = process.env[ad]?.trim();
  if (!deger) return null;
  const sayi = Number(deger);
  return Number.isFinite(sayi) && sayi >= 0 ? sayi : null;
}

/** Platform anahtarının fiyatı; ikisinden biri eksikse bilinmiyor sayılır. */
export function platformFiyati(): TokenFiyati | null {
  const giris = ortamSayisi("AI_GIRIS_TOKEN_MILYON_USD");
  const cikis = ortamSayisi("AI_CIKIS_TOKEN_MILYON_USD");
  return giris === null || cikis === null ? null : { giris, cikis };
}

/** Platform panelinde kiracıya özel tavan girilmemişse geçerli olan tavan. */
export const platformVarsayilanTavani = () => ortamSayisi("AI_PLATFORM_AYLIK_TAVAN_USD");

export function butceKurali(g: {
  platformAnahtari: boolean;
  kiraciFiyati: TokenFiyati | null;
  kiraciButcesiUsd: number | null;
  /** Kiracıya özel tavan; yoksa ortam varsayılanı kullanılır. */
  kiraciyaOzelTavanUsd: number | null;
}): ButceKurali {
  const platformTavaniUsd = g.platformAnahtari ? (g.kiraciyaOzelTavanUsd ?? platformVarsayilanTavani()) : null;
  const tanimli = [g.kiraciButcesiUsd, platformTavaniUsd].filter((x): x is number => x !== null);
  return {
    platformAnahtari: g.platformAnahtari,
    fiyat: g.platformAnahtari ? platformFiyati() : g.kiraciFiyati,
    kiraciButcesiUsd: g.kiraciButcesiUsd,
    platformTavaniUsd,
    sinirUsd: tanimli.length ? Math.min(...tanimli) : null,
  };
}

const usd = (x: number) => x.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Çağrıdan önce: sınır varsa maliyetin ölçülebilmesi şarttır (fiyat yoksa
 * çağrı yapılmaz) ve bu ayın harcaması sınırın altında olmalıdır. Son çağrı
 * sınırı biraz aşabilir; maliyet çağrıdan sonra yazılır.
 */
export function butceDenetle(kural: ButceKurali, buAyUsd: number): void {
  if (kural.sinirUsd === null) return;
  if (!kural.fiyat) {
    throw new AiSinirHatasi(kural.platformAnahtari
      ? "Platform yapay zekâ fiyatları tanımlı olmadığı için aylık tavan ölçülemiyor; çağrı yapılmadı. Platform ekibine bildirin."
      : "Aylık bütçe tanımlı ama token fiyatları girilmemiş; maliyet ölçülemediği için çağrı yapılmadı. Yönetici Ayarlar → Yapay Zeka ekranından fiyatları girebilir.", 503);
  }
  if (buAyUsd < kural.sinirUsd) return;
  const platformSiniri = kural.platformTavaniUsd !== null && kural.platformTavaniUsd === kural.sinirUsd
    && (kural.kiraciButcesiUsd === null || kural.platformTavaniUsd < kural.kiraciButcesiUsd);
  throw new AiSinirHatasi(`Bu ayın yapay zekâ bütçesi doldu (${usd(buAyUsd)} / ${usd(kural.sinirUsd)} USD). ${platformSiniri
    ? "Bu, paketinizin platform tavanıdır; artırmak için destek ekibine başvurun."
    : "Yönetici Ayarlar → Yapay Zeka ekranından bütçeyi değiştirebilir."} Yeni ayda kendiliğinden açılır.`);
}

/** Görsel, metin uzunluğuyla değil sabit bir token karşılığıyla sayılır. */
const GORSEL_TOKEN = 1500;

/** Kaba token tahmini: ~4 karakter = 1 token. */
export function tokenTahmini(icerik: unknown): number {
  if (icerik === undefined || icerik === null) return 0;
  let gorsel = 0;
  const metin = typeof icerik === "string" ? icerik : JSON.stringify(icerik, (anahtar, deger) => {
    if (anahtar === "gorselBase64" && typeof deger === "string" && deger) { gorsel++; return undefined; }
    return deger;
  }) ?? "";
  return Math.ceil(metin.length / 4) + gorsel * GORSEL_TOKEN;
}

/**
 * Çağrının maliyeti. Sağlayıcı token sayılarını döndürdüyse kesindir; eksik
 * olan taraf girdi/çıktı uzunluğundan tahmin edilir ve kayıt "tahmini" olur.
 * Fiyat yoksa maliyet bilinmez (null).
 */
export function maliyetHesapla(
  fiyat: TokenFiyati | null,
  kullanim: { girisToken?: number; cikisToken?: number } | undefined,
  tahmin: { girdi: unknown; cikti: unknown } | null,
): { maliyetUsd: number | null; tahmini: boolean; girisToken: number | null; cikisToken: number | null } {
  const kesinGiris = kullanim?.girisToken ?? null;
  const kesinCikis = kullanim?.cikisToken ?? null;
  if (!fiyat) return { maliyetUsd: null, tahmini: false, girisToken: kesinGiris, cikisToken: kesinCikis };
  if (kesinGiris !== null && kesinCikis !== null) {
    return { maliyetUsd: (kesinGiris * fiyat.giris + kesinCikis * fiyat.cikis) / 1_000_000, tahmini: false, girisToken: kesinGiris, cikisToken: kesinCikis };
  }
  if (!tahmin) return { maliyetUsd: null, tahmini: false, girisToken: kesinGiris, cikisToken: kesinCikis };
  const giris = kesinGiris ?? tokenTahmini(tahmin.girdi);
  const cikis = kesinCikis ?? tokenTahmini(tahmin.cikti);
  return { maliyetUsd: (giris * fiyat.giris + cikis * fiyat.cikis) / 1_000_000, tahmini: true, girisToken: kesinGiris, cikisToken: kesinCikis };
}

/** Bu ayın (İstanbul ayı) toplam maliyeti; bilinmeyen maliyetler sıfır sayılır. */
export async function buAyMaliyeti(tx: Prisma.TransactionClient, tenantId: string, an = new Date()): Promise<number> {
  const toplam = await tx.aiCagriIz.aggregate({ where: { tenantId, createdAt: { gte: istanbulAyBaslangici(an) } }, _sum: { maliyetUsd: true } });
  return toplam._sum.maliyetUsd?.toNumber() ?? 0;
}

const sayi = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d));

/** Kiracının kuralını veritabanındaki ayar ve platform tavanından kurar. */
export async function kiraciButceKurali(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ayar: { girisTokenMilyonUsd?: Prisma.Decimal | null; cikisTokenMilyonUsd?: Prisma.Decimal | null; aylikMaliyetButcesiUsd?: Prisma.Decimal | null } | null,
  platformAnahtari: boolean,
): Promise<ButceKurali> {
  const tavan = platformAnahtari ? await tx.platformAiTavani.findUnique({ where: { tenantId }, select: { aylikTavanUsd: true } }) : null;
  const giris = sayi(ayar?.girisTokenMilyonUsd);
  const cikis = sayi(ayar?.cikisTokenMilyonUsd);
  return butceKurali({
    platformAnahtari,
    kiraciFiyati: giris === null || cikis === null ? null : { giris, cikis },
    kiraciButcesiUsd: sayi(ayar?.aylikMaliyetButcesiUsd),
    kiraciyaOzelTavanUsd: sayi(tavan?.aylikTavanUsd),
  });
}

/** AI-31: kiracı kendi anahtarını girmemişse dış sağlayıcı çağrısını platform öder. */
export function platformAnahtariMi(ayar: { saglayici?: string | null; apiKey?: string | null } | null): boolean {
  const tur = (ayar?.saglayici && ayar.saglayici !== "varsayilan" ? ayar.saglayici : process.env.AI_PROVIDER)?.toLowerCase() ?? "";
  return !ayar?.apiKey?.trim() && ["gemini", "openai", "anthropic"].includes(tur);
}
