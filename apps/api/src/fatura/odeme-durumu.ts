/**
 * KSB-07: faturanın ödeme durumunun tek kaynağı.
 *
 * KSB-16: kalan yalnız **kapama kayıtlarından** (fatura dövizinde) hesaplanır:
 * bu faturayı kapatanlar + (iade faturasıysa) onun başka faturaları kapattığı
 * tutarlar. Kasa/banka, POS, kredi kartı, çek ve iade faturası kapamaları
 * birlikte sayılır; elle ya da vadeye göre otomatik olması fark etmez.
 */
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

/** Ödeme durumunu hesaplamak için faturadan okunması gereken ilişkiler. */
export const FATURA_ODEME_SECIMI = {
  kapamalar: { select: { tutar: true } },
  iadeKapamalari: { select: { tutar: true } },
} as const;

export type OdemeDurumuKodu = "beklemede" | "odenmedi" | "kismi" | "odendi";

export interface FaturaOdemeKaynagi {
  durum: string;
  genelToplam: Prisma.Decimal;
  kapamalar: Array<{ tutar: Prisma.Decimal }>;
  iadeKapamalari: Array<{ tutar: Prisma.Decimal }>;
}

export interface FaturaOdemeDurumu {
  /** Fatura dövizinde mahsup edilmiş toplam. */
  odenen: Prisma.Decimal;
  /** Fatura dövizinde kalan; eksiye düşmez. */
  kalan: Prisma.Decimal;
  durum: OdemeDurumuKodu;
}

export function faturaOdemeDurumu(fatura: FaturaOdemeKaynagi): FaturaOdemeDurumu {
  const odenen = [...fatura.kapamalar, ...fatura.iadeKapamalari].reduce((toplam, k) => toplam.add(k.tutar), D(0));
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
 * elle kapamalardan sonra kalanını döner. Aynı faturaya eşzamanlı iki ödeme ikisi birden
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
      // KSB-16: elle bağlama yalnız elle kapamalarla yarışır; otomatik
      // kapamalar bağlamadan sonra cari denkleştirilirken yeniden dağılır.
      kapamalar: { where: { otomatik: false }, select: { tutar: true } },
      iadeKapamalari: { where: { otomatik: false }, select: { tutar: true } },
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
  if (!karsilik.gt(0) || !mahsup.gt(0)) return "0.00";
  return hareket.tutarTry.mul(mahsup).div(karsilik).sub(mahsup.mul(faturaKuru)).toFixed(2);
}
