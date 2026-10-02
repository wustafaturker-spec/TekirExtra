/**
 * KSB-07: faturanın ödeme durumunun tek kaynağı.
 *
 * Kalan tutar yalnız ödemelerin **fatura dövizindeki mahsubundan** hesaplanır
 * (`faturaMahsubu`). Ödemenin hesap dövizi, kuru ya da TL karşılığı burada
 * kullanılmaz; böylece farklı kurla yapılan ödeme kalanı bozmaz. Kasa/banka,
 * POS ve kredi kartı ödemeleri birlikte sayılır.
 */
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

/** Ödeme durumunu hesaplamak için faturadan okunması gereken ilişkiler. */
export const FATURA_ODEME_SECIMI = {
  kasaBankaHarekets: { select: { faturaMahsubu: true } },
  krediKartiHareketleri: { select: { faturaMahsubu: true } },
} as const;

export type OdemeDurumuKodu = "beklemede" | "odenmedi" | "kismi" | "odendi";

export interface FaturaOdemeKaynagi {
  durum: string;
  genelToplam: Prisma.Decimal;
  kasaBankaHarekets: Array<{ faturaMahsubu: Prisma.Decimal | null }>;
  krediKartiHareketleri: Array<{ faturaMahsubu: Prisma.Decimal | null }>;
}

export interface FaturaOdemeDurumu {
  /** Fatura dövizinde mahsup edilmiş toplam. */
  odenen: Prisma.Decimal;
  /** Fatura dövizinde kalan; eksiye düşmez. */
  kalan: Prisma.Decimal;
  durum: OdemeDurumuKodu;
}

export function faturaOdemeDurumu(fatura: FaturaOdemeKaynagi): FaturaOdemeDurumu {
  const odenen = [...fatura.kasaBankaHarekets, ...fatura.krediKartiHareketleri]
    .reduce((toplam, odeme) => toplam.add(odeme.faturaMahsubu ?? 0), D(0));
  const kalan = Prisma.Decimal.max(D(fatura.genelToplam).sub(odenen), 0);
  const durum: OdemeDurumuKodu = fatura.durum !== "kesin"
    ? "beklemede"
    : kalan.isZero() ? "odendi" : odenen.greaterThan(0) ? "kismi" : "odenmedi";
  return { odenen, kalan, durum };
}

/** API yanıtındaki `odemeOzeti` alanının ortak biçimi. */
export function odemeOzetiGorunumu(durum: FaturaOdemeDurumu) {
  return { durum: durum.durum, odenen: durum.odenen.toFixed(2), kalan: durum.kalan.toFixed(2) };
}

/** Ödeme alınabilecek fatura tipinin beklediği hareket yönü. */
export function beklenenOdemeTipi(faturaTipi: string): "tahsilat" | "tediye" | null {
  if (["satis", "alis_iade"].includes(faturaTipi)) return "tahsilat";
  if (["alis", "satis_iade"].includes(faturaTipi)) return "tediye";
  return null;
}

/**
 * Faturaya yeni ödeme bağlanmadan önce faturayı satır düzeyinde kilitler ve
 * güncel kalanını döner. Aynı faturaya eşzamanlı iki ödeme ikisi birden
 * "tam kalan" kadar mahsup edemez; ikinci işlem birincinin bitmesini bekler.
 */
export async function faturaKilitleVeKalaniGetir(tx: Prisma.TransactionClient, faturaId: string) {
  await tx.$queryRaw`SELECT id FROM faturalar WHERE id = ${faturaId}::uuid FOR UPDATE`;
  const fatura = await tx.fatura.findUnique({
    where: { id: faturaId },
    select: {
      id: true,
      no: true,
      tip: true,
      durum: true,
      cariId: true,
      dovizCinsi: true,
      kur: true,
      genelToplam: true,
      ...FATURA_ODEME_SECIMI,
    },
  });
  if (!fatura) throw new BadRequestException("Fatura bulunamadı");
  const { odenen, kalan, durum: odemeDurumu } = faturaOdemeDurumu(fatura);
  return { ...fatura, odenen, kalan, odemeDurumu };
}

/**
 * Ödemenin faturaya düşen kısmı: karşılık kalanı aşarsa kalan kadar mahsup
 * edilir, artanı carinin avansı olarak bakiyede kalır.
 */
export function mahsupAyir(karsilik: Prisma.Decimal, kalan: Prisma.Decimal) {
  const mahsup = Prisma.Decimal.min(karsilik, kalan);
  return { mahsup, avans: karsilik.sub(mahsup) };
}

/**
 * Bilgi amaçlı kur farkı (TL): mahsup edilen kısmın ödeme günündeki TL değeri
 * ile fatura kurundaki TL değeri arasındaki fark. TL faturada her zaman 0.
 * Tahsilatta artı kur farkı geliri, tediyede artı kur farkı gideri demektir.
 */
export function kurFarkiTry(
  hareket: { tutarTry: Prisma.Decimal; faturaKarsiligi: Prisma.Decimal | null; faturaMahsubu: Prisma.Decimal | null },
  faturaKuru: Prisma.Decimal,
): string {
  const karsilik = hareket.faturaKarsiligi ?? D(0);
  const mahsup = hareket.faturaMahsubu ?? D(0);
  if (!karsilik.isPositive() || !mahsup.isPositive()) return "0.00";
  return hareket.tutarTry.mul(mahsup).div(karsilik).sub(mahsup.mul(faturaKuru)).toFixed(2);
}
