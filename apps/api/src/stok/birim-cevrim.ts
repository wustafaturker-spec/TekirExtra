import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Belge satırı kartın ana birimiyle ya da ek birimiyle (STK-10) girilir.
 * Stok, rezerv ve maliyet hep ana birimle tutulduğu için satır miktarı
 * `katsayı` ile çevrilir: 1 koli = 12 adet ise 3 koli → 36 adet.
 */
export async function birimKatsayisiBul(
  tx: Prisma.TransactionClient,
  stokId: string,
  birim: string,
): Promise<Prisma.Decimal> {
  const kart = await tx.stokKart.findUnique({
    where: { id: stokId },
    select: { anaBirim: true, ad: true },
  });
  if (!kart) throw new NotFoundException("Stok kartı bulunamadı");
  if (kart.anaBirim === birim) return new Prisma.Decimal(1);
  const ek = await tx.stokBirim.findFirst({ where: { stokId, ad: birim } });
  if (!ek) {
    throw new BadRequestException(
      `'${kart.ad}' ürününde '${birim}' birimi tanımlı değil; kartın ana birimi '${kart.anaBirim}'`,
    );
  }
  return new Prisma.Decimal(ek.katsayi);
}

/** Satır miktarının ana birim karşılığı. */
export async function anaBirimMiktari(
  tx: Prisma.TransactionClient,
  satir: { stokId: string; birim: string; miktar: Prisma.Decimal },
): Promise<Prisma.Decimal> {
  return satir.miktar.mul(await birimKatsayisiBul(tx, satir.stokId, satir.birim));
}

/**
 * Kaydedilen satırların birimi kartta tanımlı olmalı; yoksa belge kaydedilir
 * ama kesinleşirken stoğa çevrilemezdi.
 */
export async function satirBirimleriniDogrula(
  tx: Prisma.TransactionClient,
  satirlar: { stokId: string; birim?: string | null }[],
): Promise<void> {
  const kartlar = await tx.stokKart.findMany({
    where: { id: { in: [...new Set(satirlar.map((s) => s.stokId))] } },
    select: { id: true, ad: true, anaBirim: true, birimler: { select: { ad: true } } },
  });
  for (const [i, s] of satirlar.entries()) {
    const kart = kartlar.find((k) => k.id === s.stokId);
    if (!kart || !s.birim) continue;
    if (s.birim !== kart.anaBirim && !kart.birimler.some((b) => b.ad === s.birim)) {
      throw new BadRequestException(
        `Satır ${i + 1}: '${kart.ad}' ürününde '${s.birim}' birimi tanımlı değil; kartın ana birimi '${kart.anaBirim}'`,
      );
    }
  }
}
