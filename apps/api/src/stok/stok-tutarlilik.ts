/**
 * STK-24 (stok incelemesi P0-1): kayıtlı bakiyelerin hareket toplamıyla
 * karşılaştırılması. Anahtar → miktar haritaları birleşimi üzerinden
 * çalışır; bakiye satırı olmayan ama hareketi olan (ya da tersi) kayıt da
 * fark sayılır.
 */
import { Prisma } from "@prisma/client";

export type TutarlilikTuru = "kart" | "depo" | "varyant" | "varyant_depo" | "parti";
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

const TUR_ADI: Record<TutarlilikTuru, string> = { kart: "kart toplamı", depo: "depo bakiyesi", varyant: "varyant toplamı", varyant_depo: "varyant depo bakiyesi", parti: "lot/seri bakiyesi" };

/** STK-39: farkları kart başına toplar (Düzeltme Merkezi'nde kart başına tek kayıt). */
export function kartBazinda<T extends { stokId: string }>(farklar: T[]): { stokId: string; satirlar: T[] }[] {
  const gruplar = new Map<string, T[]>();
  for (const f of farklar) gruplar.set(f.stokId, [...(gruplar.get(f.stokId) ?? []), f]);
  return [...gruplar].map(([stokId, satirlar]) => ({ stokId, satirlar }));
}

/** "kart toplamı (+2), 2 depo bakiyesi" biçiminde kısa özet; kart farkı işaretli yazılır. */
export function tutarlilikOzeti(satirlar: { tur: TutarlilikTuru; fark: string }[]): string {
  const sayac = new Map<TutarlilikTuru, number>();
  for (const s of satirlar) sayac.set(s.tur, (sayac.get(s.tur) ?? 0) + 1);
  return [...sayac].map(([tur, adet]) => {
    if (tur === "kart") { const f = Number(satirlar.find((s) => s.tur === "kart")!.fark); return `${TUR_ADI.kart} (${f > 0 ? "+" : ""}${f.toLocaleString("tr-TR")})`; }
    return adet > 1 ? `${adet} ${TUR_ADI[tur]}` : TUR_ADI[tur];
  }).join(", ");
}
