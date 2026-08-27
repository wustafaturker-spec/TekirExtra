import { describe, expect, it } from "vitest";
import { ROLLER_ANAHTAR } from "../auth/roller.decorator";
import { GelirlerController } from "../gelirler/gelirler.controller";
import { ProjelerController } from "./projeler.controller";

const sinifRolleri = (controller: object) => Reflect.getMetadata(ROLLER_ANAHTAR, controller);
const metotRolleri = (controller: object, metot: string) =>
  Reflect.getMetadata(ROLLER_ANAHTAR, (controller as any).prototype[metot]);

describe("Gelir ve proje görevler ayrılığı", () => {
  it("gelir okumayı finans rollerine, yazmayı muhasebe rollerine sınırlar", () => {
    expect(sinifRolleri(GelirlerController)).toEqual(["yonetici", "muhasebe", "salt_okunur"]);
    expect(metotRolleri(GelirlerController, "olustur")).toEqual(["yonetici", "muhasebe"]);
    expect(metotRolleri(GelirlerController, "sil")).toEqual(["yonetici", "muhasebe"]);
  });

  it("proje silme ve analitik kırılım yazmayı muhasebe rollerine sınırlar", () => {
    expect(sinifRolleri(ProjelerController)).toEqual(["yonetici", "muhasebe", "satis", "salt_okunur"]);
    expect(metotRolleri(ProjelerController, "sil")).toEqual(["yonetici", "muhasebe"]);
    expect(metotRolleri(ProjelerController, "altKirilimEkle")).toEqual(["yonetici", "muhasebe"]);
  });
});
