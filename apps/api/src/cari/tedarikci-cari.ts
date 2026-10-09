import { Prisma } from "@prisma/client";

/**
 * Gelen belgenin göndereni için cari: VKN'siyle bulunur, yoksa tedarikçi
 * carisi açılır. Gelen e-Fatura ve gelen e-İrsaliye (SAT-12) aynı kuralı kullanır.
 * EBLG-119: müşterinin bize kestiği iade faturasında gönderen müşteridir;
 * kart yoksa müşteri carisi açılır.
 */
export async function tedarikciCariBulVeyaOlustur(tx: Prisma.TransactionClient, tenantId: string, vkn: string, unvan: string, tip: "tedarikci" | "musteri" = "tedarikci"): Promise<string> {
  const mevcut = await tx.cariHesap.findFirst({ where: { tenantId, vknTckn: vkn }, select: { id: true } });
  if (mevcut) return mevcut.id;

  // Kod çakışabilir (aynı VKN'li kayıt silinip yeniden açılmışsa vb.)
  const onek = tip === "musteri" ? "MUS" : "TED";
  let kod = `${onek}-${vkn}`;
  let sayac = 1;
  while (await tx.cariHesap.findUnique({ where: { tenantId_kod: { tenantId, kod } }, select: { id: true } })) {
    kod = `${onek}-${vkn}-${++sayac}`;
  }
  const yeni = await tx.cariHesap.create({ data: { tenantId, kod, unvan, vknTckn: vkn, tip } });
  return yeni.id;
}
