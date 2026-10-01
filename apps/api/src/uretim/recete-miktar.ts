import { Prisma } from "@prisma/client";
import { olcuKatsayisi } from "@tekirextra/shared";
import { birimKatsayisiBul } from "../stok/birim-cevrim";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

/**
 * Reçete satırı girilen birimin ana birim karşılığı: kg kartına mg/g, litre
 * kartına ml ek birim tanımlamadan girilir; diğerleri kartın ek birimi olmalı
 * (yoksa `birimKatsayisiBul` reddeder).
 */
export async function receteBirimKatsayisi(
  tx: Prisma.TransactionClient,
  kart: { id: string; anaBirim: string },
  birim: string | null | undefined,
): Promise<Prisma.Decimal> {
  if (!birim || birim === kart.anaBirim) return D(1);
  const olcu = olcuKatsayisi(kart.anaBirim, birim);
  return olcu ? D(olcu) : birimKatsayisiBul(tx, kart.id, birim);
}

/** Stok, sarf ve rezerv ana birimde 3 basamakla tutulur. */
export const STOK_BASAMAGI = 3;

/** Emirdeki malzeme ihtiyacı: reçete miktarı × (emir / reçete çıktısı) × (1 + fire%). */
export function emirMalzemeMiktari(receteMiktari: Prisma.Decimal, oran: Prisma.Decimal, fireOrani: Prisma.Decimal): { ham: Prisma.Decimal; miktar: Prisma.Decimal } {
  const ham = receteMiktari.mul(oran).mul(D(1).add(fireOrani.div(100)));
  return { ham, miktar: ham.toDecimalPlaces(STOK_BASAMAGI) };
}

/** API çıktısında üstel yazım ("1e-8") olmasın; sondaki sıfırlar atılır. */
export const duzMiktar = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toFixed().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""));
