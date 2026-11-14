import { Prisma } from "@prisma/client";

const UYGUN_TIPLER = { tedarikci: ["tedarikci", "her_ikisi"], musteri: ["musteri", "her_ikisi"] } as const;
const TIP_ADI: Record<string, string> = { tedarikci: "tedarikçi", musteri: "müşteri", her_ikisi: "her ikisi" };

/**
 * Aynı VKN'li birden çok cari olabilir (ör. müşteri ve tedarikçi kartı ayrı
 * açılmış). Belgenin yönüne uygun tipteki seçilir; uygun yoksa ilk kart döner
 * ve `uyari` neden işlenemeyeceğini söyler. Birleştirilmiş (mükerrer) kartlar aday değildir.
 * Uygun tipte birden çok kart varsa en eski seçilir ve `cokluUyari` bunu söyler (seçim
 * rastgele olmasın, kullanıcı yanlış carinin farkına varsın).
 */
export async function gonderenCariSec(tx: Prisma.TransactionClient, tenantId: string, vkn: string, tip: "tedarikci" | "musteri" = "tedarikci") {
  const adaylar = await tx.cariHesap.findMany({
    where: { tenantId, vknTckn: vkn, birlestigiCariId: null },
    select: { id: true, kod: true, unvan: true, tip: true, karaListe: true },
    orderBy: [{ createdAt: "asc" }, { kod: "asc" }],
  });
  const uygunlar = adaylar.filter((c) => (UYGUN_TIPLER[tip] as readonly string[]).includes(c.tip));
  const uygun = uygunlar[0];
  const cari = uygun ?? adaylar[0] ?? null;
  const uyari = cari && !uygun
    ? `VKN ${vkn} ile kayıtlı cari ${cari.kod} ${TIP_ADI[cari.tip] ?? cari.tip} tipinde; ${tip === "tedarikci" ? "alış faturası için tedarikçi" : "iade faturası için müşteri"} ya da her ikisi olmalı. Cari kartında tipini değiştirip yeniden deneyin.`
    : null;
  const ayniVkn = uygunlar.length > 1 ? uygunlar : adaylar.length > 1 && !uygun ? adaylar : [];
  return { cari, uyari, cokluUyari: ayniVknUyarisi(vkn, ayniVkn, cari) };
}

/** Aynı VKN birden çok caride kayıtlıysa uyarı metni; seçilen kartı adıyla söyler. */
export function ayniVknUyarisi(vkn: string, kartlar: Array<{ kod: string; unvan: string }>, secilen: { kod: string } | null): string | null {
  if (kartlar.length < 2) return null;
  const liste = kartlar.slice(0, 4).map((c) => `${c.kod} (${c.unvan})`).join(", ") + (kartlar.length > 4 ? ` ve ${kartlar.length - 4} kart daha` : "");
  return `VKN ${vkn} birden çok caride kayıtlı: ${liste}. Belge en eski kart ${secilen?.kod ?? kartlar[0].kod} carisine işlenir; yanlışsa Cari › Mükerrer Kartlar ekranından birleştirin ya da yanlış kartın VKN'sini düzeltin.`;
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
