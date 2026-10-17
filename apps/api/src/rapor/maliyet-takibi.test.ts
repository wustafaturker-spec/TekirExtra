import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { maliyetTakipGirdisi, maliyetTakipId } from "./maliyet-takibi";
import { RaporController } from "./rapor.controller";
import { RollerGuard } from "../auth/roller.guard";
import { baglamlaCalistir } from "../core/istek-baglami";

describe("maliyet inceleme sözleşmesi", () => {
  it.each([{ aciklama: " " }, { aciklama: "x" }, { aciklama: "x".repeat(2001) }, { aciklama: "Not", maliyet: "100" }])("uygunsuz açılış notunu/maliyet yazımını reddeder: %j", (v) => {
    expect(() => maliyetTakipGirdisi(v)).toThrow();
  });
  it.each(["cozuldu", "yoksayildi", "acik", "yanlis"])("%s ile maliyet doğrulanmış sayılamaz", (durum) => {
    expect(() => maliyetTakipGirdisi({ aciklama: "Kontrol edildi", beklenenGuncelleme: new Date().toISOString(), durum }, true)).toThrow();
  });
  it("geçerli sürüm/not ve UUID ister", () => {
    expect(maliyetTakipGirdisi({ aciklama: "  Kaynak bekleniyor  " })).toEqual({ aciklama: "Kaynak bekleniyor" });
    expect(() => maliyetTakipId("yanlis")).toThrow();
    expect(() => maliyetTakipGirdisi({ aciklama: "Kontrol", durum: "beklemede" }, true)).toThrow();
  });
  it.each(["salt_okunur", "mali_musavir", "maliyet_muhasebesi", "satis", "depo"])("%s takip kaydı yazamaz", async (rol) => {
    for (const handler of [RaporController.prototype.maliyetTakibiBaslat, RaporController.prototype.maliyetTakibiGuncelle]) {
      await expect(baglamlaCalistir({ tenantId: "t", userId: "u", rol: rol as never }, async () => new RollerGuard(new Reflector()).canActivate({
        getClass: () => RaporController, getHandler: () => handler,
      } as never))).rejects.toThrow("yetkiniz yok");
    }
  });
});
