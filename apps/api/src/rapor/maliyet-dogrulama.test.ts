import "reflect-metadata";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { hareketKapsamiUygun, maliyetKapatmaGirdisi } from "./maliyet-dogrulama";
import { RaporController } from "./rapor.controller";
import { RollerGuard } from "../auth/roller.guard";
import { Reflector } from "@nestjs/core";
import { baglamlaCalistir } from "../core/istek-baglami";

const D = (v: number | string) => new Prisma.Decimal(v);
const h = (miktar: number, maliyet: number) => ({ miktar: D(miktar), maliyet: D(maliyet) });
describe("kayıtlı maliyet doğrulaması", () => {
  it.each([
    [[], false], [[h(-1, 0)], false], [[h(-1, -10)], false], [[h(-0.5, 10)], false],
    [[h(-0.5, 10), h(-0.5, 0)], false], [[h(-2, 10), h(1, 0)], false],
    [[h(-1, 10)], true], [[h(-1, 0), h(1, 0), h(-1, 10)], true],
  ] as const)("hareket kapsamı %j → %s", (hareketler, beklenen) => {
    expect(hareketKapsamiUygun(D(1), [...hareketler])).toBe(beklenen);
  });
  it("kapatma için kayıt, sürüm, kaynak kanıtı ve not zorunludur", () => {
    const g = { kayitId: "11111111-1111-4111-8111-111111111111", beklenenGuncelleme: "2026-10-15T09:00:00.000Z", kanit: "a".repeat(64), aciklama: "Kaynak incelendi" };
    expect(maliyetKapatmaGirdisi(g)).toEqual(g);
    for (const ek of [{ kanit: "" }, { kayitId: "" }, { aciklama: " " }, { maliyet: "100" }]) expect(() => maliyetKapatmaGirdisi({ ...g, ...ek })).toThrow();
  });
  it.each(["salt_okunur", "mali_musavir", "maliyet_muhasebesi", "satis", "depo"])("%s çözüm kaydı yazamaz", async (rol) => {
    await expect(baglamlaCalistir({ tenantId: "t", userId: "u", rol: rol as never }, async () => new RollerGuard(new Reflector()).canActivate({
      getClass: () => RaporController, getHandler: () => RaporController.prototype.maliyetIncelemesiniKapat,
    } as never))).rejects.toThrow("yetkiniz yok");
  });
});
