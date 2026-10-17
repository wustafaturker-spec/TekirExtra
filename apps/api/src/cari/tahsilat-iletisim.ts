import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export const ITIRAZ_ILETISIM_ENGELI = "Carinin açık tahsilat itirazı var; itiraz sonuçlanmadan hatırlatma veya ihtar gönderilemez";
export async function itirazliCariler(tx: Prisma.TransactionClient, tenantId: string, cariIdler: string[]) {
  if (!cariIdler.length) return new Set<string>();
  const takipler = await tx.tahsilatTakibi.findMany({ where: { tenantId, cariId: { in: cariIdler }, neden: "itiraz", durum: { in: ["acik", "beklemede"] } }, select: { cariId: true } });
  return new Set(takipler.map((t) => t.cariId));
}
export async function tahsilatIletisiminiDogrula(tx: Prisma.TransactionClient, tenantId: string, cariId: string) {
  if ((await itirazliCariler(tx, tenantId, [cariId])).has(cariId)) throw new ConflictException(ITIRAZ_ILETISIM_ENGELI);
}
