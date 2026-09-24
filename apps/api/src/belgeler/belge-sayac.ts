import type { BelgeTur, BelgeYon, Prisma } from "@prisma/client";

/**
 * Belge sayacını bir ilerletir ve yeni sırayı döndürür. Sayaç tür, yön, seri
 * ve yıl başınadır: satış irsaliyesinin giden e-İrsaliye serisi (seri boş),
 * kâğıt irsaliye (EBLG-83) ve alış irsaliyesi (FTR-27) birbirinin sırasını
 * tüketmez.
 */
export async function belgeSirasiAl(
  tx: Prisma.TransactionClient,
  anahtar: { tenantId: string; tur: BelgeTur; yon: BelgeYon; seri?: string; yil: number },
): Promise<number> {
  const kayit = { ...anahtar, seri: anahtar.seri ?? "" };
  const sayac = await tx.belgeSayac.upsert({
    where: { tenantId_tur_yon_seri_yil: kayit },
    create: { ...kayit, sonSira: 1 },
    update: { sonSira: { increment: 1 } },
  });
  return sayac.sonSira;
}

/** GİB e-İrsaliye numarası 16 karakterdir: 3 harf önek + 4 hane yıl + 9 hane sıra. */
export function eirsaliyeNumarasi(onek: string, yil: number, sira: number): string {
  return `${onek}${yil}${String(sira).padStart(9, "0")}`;
}
