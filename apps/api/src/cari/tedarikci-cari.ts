import { Prisma } from "@prisma/client";

/**
 * Gelen belgenin göndereni için cari: VKN'siyle bulunur, yoksa tedarikçi
 * carisi açılır. Gelen e-Fatura ve gelen e-İrsaliye (SAT-12) aynı kuralı kullanır.
 */
export async function tedarikciCariBulVeyaOlustur(tx: Prisma.TransactionClient, tenantId: string, vkn: string, unvan: string): Promise<string> {
  const mevcut = await tx.cariHesap.findFirst({ where: { tenantId, vknTckn: vkn }, select: { id: true } });
  if (mevcut) return mevcut.id;

  // Kod çakışabilir (aynı VKN'li kayıt silinip yeniden açılmışsa vb.)
  let kod = `TED-${vkn}`;
  let sayac = 1;
  while (await tx.cariHesap.findUnique({ where: { tenantId_kod: { tenantId, kod } }, select: { id: true } })) {
    kod = `TED-${vkn}-${++sayac}`;
  }
  const yeni = await tx.cariHesap.create({ data: { tenantId, kod, unvan, vknTckn: vkn, tip: "tedarikci" } });
  return yeni.id;
}
