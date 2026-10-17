import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { NakitSozu } from "./nakit-sozu-kaynak";

/** Söz yeni alacak değildir; mevcut kalan aynı dövizde iki parçaya ayrılır. */
export function faturaNakitDagilimi(fatura: { id: string; cariId: string; dovizCinsi: string; tip: string }, kalan: string, vade: string, soz?: NakitSozu) {
  const tutar = new Prisma.Decimal(kalan);
  if (!soz) return [{ tutar: tutar.toFixed(2), vade, odemeSozu: undefined }];
  if (fatura.tip !== "satis" || soz.faturaId !== fatura.id || soz.cariId !== fatura.cariId || soz.dovizCinsi !== fatura.dovizCinsi) throw new ConflictException("Nakit planı söz/fatura kapsamı tutarsız");
  const sozKalani = new Prisma.Decimal(soz.kalan);
  if (sozKalani.lt(0)) throw new ConflictException("Nakit planı söz kalanı geçersiz");
  const ayrilan = Prisma.Decimal.min(tutar, sozKalani);
  const parcalar = [];
  if (ayrilan.gt(0)) parcalar.push({ tutar: ayrilan.toFixed(2), vade: soz.tarih, odemeSozu: { id: soz.id, tarih: soz.tarih, faturaVadesi: vade } });
  if (tutar.gt(ayrilan)) parcalar.push({ tutar: tutar.sub(ayrilan).toFixed(2), vade, odemeSozu: undefined });
  return parcalar;
}
