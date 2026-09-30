import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Belge satırlarının varyant seçimi: aktif varyantı olan ürün varyantsız
 * satırlanamaz (hangi renk/beden satıldığı stokta ve belgede belli olmalı),
 * seçilen varyant da o ürüne ait ve aktif olmalı. Kullanıcının girdiği satırlar
 * için çağrılır; belgeden belgeye aktarım kaynağın varyantını taşır.
 */
export async function satirVaryantlariniDogrula(tx: Prisma.TransactionClient, satirlar: { stokId: string; varyantId?: string | null }[]) {
  const stokIdler = [...new Set(satirlar.map((s) => s.stokId))];
  if (!stokIdler.length) return;
  const varyantlar = await tx.stokVaryant.findMany({ where: { stokId: { in: stokIdler }, aktif: true }, select: { id: true, stokId: true } });
  const varyantliStoklar = new Set(varyantlar.map((v) => v.stokId));
  const eksik: number[] = [];
  const yanlis: number[] = [];
  satirlar.forEach((s, i) => {
    if (s.varyantId) { if (!varyantlar.some((v) => v.id === s.varyantId && v.stokId === s.stokId)) yanlis.push(i + 1); }
    else if (varyantliStoklar.has(s.stokId)) eksik.push(i + 1);
  });
  if (yanlis.length) throw new BadRequestException(`${yanlis.join(", ")}. satırdaki varyant bu ürüne ait değil ya da pasif`);
  if (eksik.length) throw new BadRequestException(`${eksik.join(", ")}. satırda varyant seçilmedi; bu ürünün varyantları var`);
}
