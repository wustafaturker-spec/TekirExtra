import { Prisma } from "@prisma/client";

/**
 * Belgenin TL karşılığı için kullanılacak kuru çözer: TCMB **döviz satış**
 * kuru, çünkü gider yabancı para satın alınarak ödenir. Belge tarihinde kayıt
 * yoksa en yakın önceki gün kullanılır (hafta sonu ve tatiller).
 *
 * Kayıt hiç yoksa `null` döner; çağıran 1 varsayıp döviz tutarını TL sanmak
 * yerine işlemi durdurmalıdır.
 */
export async function kurCoz(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dovizCinsi: string,
  tarih: Date,
): Promise<Prisma.Decimal | null> {
  if (dovizCinsi === "TRY") return new Prisma.Decimal(1);
  const kayit = await tx.dovizKuru.findFirst({
    where: { tenantId, dovizCinsi: dovizCinsi as "USD" | "EUR", tarih: { lte: tarih } },
    orderBy: { tarih: "desc" },
    select: { dovizSatis: true },
  });
  return kayit?.dovizSatis ?? null;
}
