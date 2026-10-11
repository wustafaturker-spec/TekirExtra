import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { GuncelKurlar } from "../cari/doviz-degerleme";
import { cariBakiyeOzeti, type CariHareketGrubu } from "./varlik-ozeti";

const D = (n: number) => new Prisma.Decimal(n);
const g = (cariId: string, dovizCinsi: string, tip: "borc" | "alacak", tutar: number, tutarTry = tutar): CariHareketGrubu =>
  ({ cariId, dovizCinsi, tip, _sum: { tutar: D(tutar), tutarTry: D(tutarTry) } });
const kurlar = (k: Record<string, number>) => new Map(Object.entries(k).map(([d, satis]) => [d, { satis: D(satis) }])) as unknown as GuncelKurlar;

describe("cari bakiye özeti (RPR-15)", () => {
  it("cari başına net bakiye: artı alacak, eksi borç tarafına", () => {
    const o = cariBakiyeOzeti([g("a", "TRY", "borc", 1_000), g("a", "TRY", "alacak", 400), g("b", "TRY", "alacak", 250), g("c", "TRY", "borc", 50), g("c", "TRY", "alacak", 50)], kurlar({}));
    expect(o.alacaklar.toNumber()).toBe(600);
    expect(o.borclar.toNumber()).toBe(250);
  });

  it("dövizli bakiye güncel kurla çevrilir ve cari içinde TL ile netleşir", () => {
    const o = cariBakiyeOzeti([g("a", "USD", "borc", 100, 3_000), g("a", "TRY", "alacak", 1_000)], kurlar({ USD: 40 }));
    expect(o.alacaklar.toNumber()).toBe(3_000);
    expect(o.kurEksik).toEqual([]);
  });

  it("kuru bulunamayan döviz tarihî TL ile değerlenir ve bildirilir", () => {
    const o = cariBakiyeOzeti([g("a", "EUR", "alacak", 10, 350)], kurlar({}));
    expect(o.borclar.toNumber()).toBe(350);
    expect(o.kurEksik).toEqual(["EUR"]);
  });
});
