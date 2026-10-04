import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { PersonelErisimGuard } from "./personel-erisim.guard";

const calistir = (rol: string, acik: boolean) => {
  const guard = new PersonelErisimGuard({ getir: vi.fn(async () => ({ maasMuhasebeyeAcik: acik })) } as never);
  return istekBaglami.run({ deger: { tenantId: "t1", userId: "u1", rol: rol as never } }, () => guard.canActivate());
};

describe("İK erişimi (PRS-17)", () => {
  it("anahtar kapalıyken muhasebe reddedilir; İK ve yönetici geçer", async () => {
    await expect(calistir("muhasebe", false)).rejects.toThrow("muhasebe rolüne kapalı");
    await expect(calistir("ik", false)).resolves.toBe(true);
    await expect(calistir("yonetici", false)).resolves.toBe(true);
  });
  it("varsayılan (açık) muhasebe geçer", async () => {
    await expect(calistir("muhasebe", true)).resolves.toBe(true);
  });
});
