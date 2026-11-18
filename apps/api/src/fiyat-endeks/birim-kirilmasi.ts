import { Prisma } from "@prisma/client";

/** Kırılma ayı karışık birim içerebilir; iki taraftaki aylar birlikte oranlanmaz. */
export function ayniBirimDonemi(a: string, b: string, kirilmalar: readonly string[]): boolean {
  const bas = a < b ? a : b, son = a < b ? b : a;
  return !kirilmalar.some((ay) => ay >= bas && ay <= son);
}

export interface BirimKirilmasi {
  stokId: string; ay: string; degistiAt: Date; birim: string;
  eskiBirim: string | null; yeniBirim: string | null; eskiKatsayi: string | null; yeniKatsayi: string | null;
}

export async function birimKirilmalariniOku(tx: Prisma.TransactionClient, stokIdler: string[], bas: string, son: string): Promise<BirimKirilmasi[]> {
  if (!stokIdler.length) return [];
  return tx.$queryRaw<BirimKirilmasi[]>`SELECT stok_id::text AS "stokId",
    to_char(date_trunc('month', degisti_at + interval '3 hours'), 'YYYY-MM-01') AS ay,
    degisti_at AS "degistiAt", birim, eski_birim AS "eskiBirim", yeni_birim AS "yeniBirim",
    eski_katsayi::text AS "eskiKatsayi", yeni_katsayi::text AS "yeniKatsayi"
    FROM stok_birim_gecmisi WHERE stok_id = ANY(${stokIdler}::uuid[])
      AND degisti_at >= ${bas}::timestamp - interval '3 hours'
      AND degisti_at < ${son}::timestamp + interval '1 month' - interval '3 hours'
    ORDER BY degisti_at, id`;
}
