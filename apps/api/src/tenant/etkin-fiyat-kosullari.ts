import type { Prisma } from "@prisma/client";

/** Katalog fotoğrafını değiştirmeden, onaylı ve süresi geçerli özel fiyatı okur. */
export async function etkinFiyatKosullariniBagla<T extends { paketKosullari: unknown }>(tx: Prisma.TransactionClient, tenantId: string, abonelik: T | null): Promise<T | null> {
  if (!abonelik) return null;
  const [r] = await tx.$queryRaw<{ kosullar: Prisma.JsonValue | null }[]>`SELECT abonelik_etkin_fiyat_kosullari(${tenantId}::uuid) AS kosullar`;
  return { ...abonelik, paketKosullari: r.kosullar };
}
