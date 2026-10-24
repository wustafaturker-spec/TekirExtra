import { describe, expect, it } from "vitest";
import { abonelikErisimiHesapla } from "./abonelik-erisim.service";

const simdi = new Date("2026-10-24T12:00:00Z");

describe("abonelik erişim kuralı (platform P0-1)", () => {
  it("kayıt yoksa, aktif ya da deneme aboneliği kısıtlamaz", () => {
    expect(abonelikErisimiHesapla(null, simdi).kisitli).toBe(false);
    for (const durum of ["aktif", "deneme"]) expect(abonelikErisimiHesapla({ durum, donemSonu: new Date("2020-01-01"), iptalTarihi: null }, simdi).kisitli).toBe(false);
  });

  it("askıdaki abonelik salt okunurdur ve nedenini söyler", () => {
    expect(abonelikErisimiHesapla({ durum: "askida", donemSonu: null, iptalTarihi: null }, simdi)).toEqual({ kisitli: true, neden: expect.stringMatching(/askıya alındı.*dışa aktarabilirsiniz/) });
  });

  it("iptal edilen abonelik dönem sonuna kadar açık, sonra salt okunur", () => {
    const iptal = { durum: "iptal", iptalTarihi: new Date("2026-10-01") };
    expect(abonelikErisimiHesapla({ ...iptal, donemSonu: new Date("2026-11-01") }, simdi).kisitli).toBe(false);
    expect(abonelikErisimiHesapla({ ...iptal, donemSonu: new Date("2026-10-20") }, simdi)).toEqual({ kisitli: true, neden: expect.stringMatching(/20\.10\.2026 tarihinde sona erdi/) });
  });

  it("dönem sonu bilinmeyen eski kayıtta iptal tarihinden bir ay sonrası esas alınır", () => {
    expect(abonelikErisimiHesapla({ durum: "iptal", donemSonu: null, iptalTarihi: new Date("2026-10-01") }, simdi).kisitli).toBe(false);
    expect(abonelikErisimiHesapla({ durum: "iptal", donemSonu: null, iptalTarihi: new Date("2026-09-01") }, simdi).kisitli).toBe(true);
  });
});
