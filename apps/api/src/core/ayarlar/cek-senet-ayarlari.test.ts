import "../../ayar-tanimlari";
import { describe, expect, it } from "vitest";
import { ayarTanimiAl } from "./ayar-kayit";
describe("çek/senet hatırlatma ayarları", () => {
  const tanim = ayarTanimiAl("kasaBanka")!;
  it("eski ayar kayıtlarına 7 gün ve açık vade günü varsayılanı sağlar", () => {
    expect(tanim.sema.parse({ varsayilanKasaId: null, varsayilanBankaHesapId: null })).toMatchObject({ cekSenetHatirlatmaGun: 7, cekSenetVadeGunuHatirlat: true });
  });
  it.each([-1, 91, 1.5, "3"])("geçersiz gün değerini reddeder: %s", (gun) => {
    expect(tanim.sema.safeParse({ cekSenetHatirlatmaGun: gun }).success).toBe(false);
  });
  it.each([0, 1, 3, 7, 90])("%s gün seçimini kabul eder", (gun) => {
    expect(tanim.sema.parse({ cekSenetHatirlatmaGun: gun, cekSenetVadeGunuHatirlat: false })).toMatchObject({ cekSenetHatirlatmaGun: gun, cekSenetVadeGunuHatirlat: false });
  });
});
