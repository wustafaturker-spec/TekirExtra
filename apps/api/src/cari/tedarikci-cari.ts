import { Prisma } from "@prisma/client";

const UYGUN_TIPLER = { tedarikci: ["tedarikci", "her_ikisi"], musteri: ["musteri", "her_ikisi"] } as const;
const TIP_ADI: Record<string, string> = { tedarikci: "tedarikçi", musteri: "müşteri", her_ikisi: "her ikisi" };

/**
 * Aynı VKN'li birden çok cari olabilir (ör. müşteri ve tedarikçi kartı ayrı
 * açılmış). Belgenin yönüne uygun tipteki seçilir; uygun yoksa ilk kart döner
 * ve `uyari` neden işlenemeyeceğini söyler.
 */
export async function gonderenCariSec(tx: Prisma.TransactionClient, tenantId: string, vkn: string, tip: "tedarikci" | "musteri" = "tedarikci") {
  const adaylar = await tx.cariHesap.findMany({
    where: { tenantId, vknTckn: vkn },
    select: { id: true, kod: true, unvan: true, tip: true, karaListe: true },
    orderBy: { createdAt: "asc" },
  });
  const uygun = adaylar.find((c) => (UYGUN_TIPLER[tip] as readonly string[]).includes(c.tip));
  const cari = uygun ?? adaylar[0] ?? null;
  const uyari = cari && !uygun
    ? `VKN ${vkn} ile kayıtlı cari ${cari.kod} ${TIP_ADI[cari.tip] ?? cari.tip} tipinde; ${tip === "tedarikci" ? "alış faturası için tedarikçi" : "iade faturası için müşteri"} ya da her ikisi olmalı. Cari kartında tipini değiştirip yeniden deneyin.`
    : null;
  return { cari, uyari };
}

/**
 * Gelen belgenin göndereni için cari: VKN'siyle bulunur, yoksa tedarikçi
 * carisi açılır. Gelen e-Fatura ve gelen e-İrsaliye (SAT-12) aynı kuralı kullanır.
 * EBLG-119: müşterinin bize kestiği iade faturasında gönderen müşteridir;
 * kart yoksa müşteri carisi açılır.
 */
export async function tedarikciCariBulVeyaOlustur(tx: Prisma.TransactionClient, tenantId: string, vkn: string, unvan: string, tip: "tedarikci" | "musteri" = "tedarikci"): Promise<string> {
  const { cari: mevcut } = await gonderenCariSec(tx, tenantId, vkn, tip);
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
