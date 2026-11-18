import { createHash } from "node:crypto";

/** Kalem ve liste koşulları değiştiğinde bekleyen öneri geçersizleşir. */
export function fiyatListesiSurumu(liste: { ad: string; dovizCinsi: string; aktif: boolean; kalemler: { stokId: string; fiyat: { toString(): string } }[] }): string {
  return createHash("sha256").update(JSON.stringify({
    ad: liste.ad, doviz: liste.dovizCinsi, aktif: liste.aktif,
    kalemler: liste.kalemler.map((k) => [k.stokId, k.fiyat.toString()]).sort((a, b) => a[0].localeCompare(b[0])),
  })).digest("hex");
}
