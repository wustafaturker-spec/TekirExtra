/**
 * RPR-29: satış kırılımı — ortak satış satırları (satis-ozeti.ts) bir
 * anahtara göre toplanır. Anahtarı olmayan satır "Atanmamış"tır.
 */
import { Prisma } from "@prisma/client";
import type { SatisSatiri } from "../stok/satis-ozeti";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const ATANMAMIS = "Atanmamış";

export type KirilimSatiri = { grup: string; netSatis: string; pay: number | null; faturaSayisi: number; cariSayisi: number; miktar: string };

export function satisKirilimi(satirlar: Pick<SatisSatiri, "faturaId" | "cariId" | "stokId" | "ciro" | "miktar">[], anahtar: (s: Pick<SatisSatiri, "cariId" | "stokId">) => string | null): KirilimSatiri[] {
  const gruplar = new Map<string, { ciro: Prisma.Decimal; miktar: Prisma.Decimal; faturalar: Set<string>; cariler: Set<string> }>();
  for (const s of satirlar) {
    const g = anahtar(s)?.trim() || ATANMAMIS;
    const k = gruplar.get(g) ?? { ciro: D(0), miktar: D(0), faturalar: new Set<string>(), cariler: new Set<string>() };
    k.ciro = k.ciro.add(s.ciro); k.miktar = k.miktar.add(s.miktar); k.faturalar.add(s.faturaId); k.cariler.add(s.cariId);
    gruplar.set(g, k);
  }
  const toplam = [...gruplar.values()].reduce((t, g) => t.add(g.ciro), D(0));
  return [...gruplar.entries()]
    .sort(([a, x], [b, y]) => (a === ATANMAMIS ? 1 : b === ATANMAMIS ? -1 : y.ciro.comparedTo(x.ciro)))
    .map(([grup, g]) => ({
      grup,
      netSatis: g.ciro.toFixed(2),
      pay: toplam.isZero() ? null : g.ciro.div(toplam).mul(100).toDecimalPlaces(2).toNumber(),
      faturaSayisi: g.faturalar.size,
      cariSayisi: g.cariler.size,
      miktar: g.miktar.toFixed(3),
    }));
}
