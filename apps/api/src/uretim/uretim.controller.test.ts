import { describe, expect, it } from "vitest";
import { ROLLER_ANAHTAR } from "../auth/roller.decorator";
import { UretimController } from "./uretim.controller";

const roller = (metot: keyof UretimController) => Reflect.getMetadata(ROLLER_ANAHTAR, UretimController.prototype[metot]);

describe("UretimController görevler ayrılığı", () => {
  it("kalite kararını yalnız kalite rolüne verir", () => {
    expect(roller("kaliteKarari")).toEqual(["kalite"]);
  });

  it("operasyon ve üretim bildirimlerini operatör rolüne verir", () => {
    expect(roller("operasyonBaslat")).toEqual(["uretim_operatoru"]);
    expect(roller("operasyonTamamla")).toEqual(["uretim_operatoru"]);
    expect(roller("bildir")).toEqual(["uretim_operatoru"]);
    expect(roller("yenidenIslemeTamamla")).toEqual(["uretim_operatoru"]);
    expect(roller("sarfDuzelt")).toEqual(["uretim_operatoru", "depo"]);
  });

  it("malzeme rezervasyonunu depo, reçete ve emri planlama rolüne verir", () => {
    expect(roller("rezerveEt")).toEqual(["depo"]);
    expect(roller("receteKaydet")).toEqual(["uretim_planlama"]);
    expect(roller("emirOlustur")).toEqual(["uretim_planlama"]);
  });
});
