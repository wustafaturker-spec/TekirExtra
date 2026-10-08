/**
 * STK-24 (stok incelemesi P0-1): kayıtlı bakiyelerin hareket toplamıyla
 * karşılaştırılması. Anahtar → miktar haritaları birleşimi üzerinden
 * çalışır; bakiye satırı olmayan ama hareketi olan (ya da tersi) kayıt da
 * fark sayılır.
 */
import { Prisma } from "@prisma/client";

export type TutarlilikTuru = "kart" | "depo" | "varyant" | "varyant_depo";
export interface MiktarFarki { anahtar: string; kayitli: Prisma.Decimal; hareket: Prisma.Decimal; fark: Prisma.Decimal }

const SIFIR = new Prisma.Decimal(0);

/** Kayıtlı ve hareket toplamı farklı anahtarlar; fark = hareket − kayıtlı. */
export function miktarFarklari(kayitli: Map<string, Prisma.Decimal>, hareket: Map<string, Prisma.Decimal>): MiktarFarki[] {
  const anahtarlar = new Set([...kayitli.keys(), ...hareket.keys()]);
  const farklar: MiktarFarki[] = [];
  for (const anahtar of anahtarlar) {
    const k = kayitli.get(anahtar) ?? SIFIR, h = hareket.get(anahtar) ?? SIFIR;
    if (!k.eq(h)) farklar.push({ anahtar, kayitli: k, hareket: h, fark: h.sub(k) });
  }
  return farklar.sort((a, b) => a.anahtar.localeCompare(b.anahtar));
}

export const ciftAnahtar = (a: string, b: string) => `${a}|${b}`;
