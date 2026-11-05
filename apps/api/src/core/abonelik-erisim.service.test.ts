import { describe, expect, it, vi } from "vitest";
import { AbonelikErisimService, abonelikErisimiHesapla } from "./abonelik-erisim.service";

const simdi = new Date("2026-10-24T12:00:00Z");

describe("abonelik erişim kuralı (platform P0-1)", () => {
  it("otomasyon tüm gerekli modülleri denetler; kapsam okuma hatasında durur", async () => {
    const servis = new AbonelikErisimService({} as never);
    const moduller = vi.spyOn(servis, "modulleriGetir").mockResolvedValue(["cari"]);
    vi.spyOn(servis, "getir").mockResolvedValue({ kisitli: false, neden: null });
    expect(await servis.otomasyonDurdu("firma", "cari")).toBe(false);
    expect(await servis.otomasyonDurdu("firma", ["cari", "satis"])).toBe(true);
    moduller.mockResolvedValue(null);
    expect(await servis.otomasyonDurdu("firma", "satis")).toBe(false);
    moduller.mockRejectedValue(new Error("bağlantı"));
    expect(await servis.otomasyonDurdu("firma", "cari")).toBe(true);
  });
  it("kayıt yoksa, aktif ya da deneme aboneliği kısıtlamaz", () => {
    expect(abonelikErisimiHesapla(null, simdi).kisitli).toBe(false);
    for (const durum of ["aktif"]) expect(abonelikErisimiHesapla({ durum, donemSonu: new Date("2020-01-01"), iptalTarihi: null }, simdi).kisitli).toBe(false);
  });

  it("deneme tam bitiş anında kısıtlanır; tarihi bilinmeyen kayıt korunur", () => {
    for (const donemSonu of [null, new Date(simdi.getTime() + 1)]) expect(abonelikErisimiHesapla({ durum: "deneme", donemSonu, iptalTarihi: null }, simdi).kisitli).toBe(false);
    for (const donemSonu of [simdi, new Date("2020-01-01")]) expect(abonelikErisimiHesapla({ durum: "deneme", donemSonu, iptalTarihi: null }, simdi)).toEqual({ kisitli: true, neden: expect.stringContaining("Deneme süreniz sona erdi") });
  });

  it("önbellek denemenin bitişinden sonra açık erişim taşımaz", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(simdi);
      const findUnique = vi.fn().mockResolvedValue({ durum: "deneme", donemSonu: new Date(simdi.getTime() + 1000), iptalTarihi: null });
      const servis = new AbonelikErisimService({ tenantIslem: async (_: string, fn: Function) => fn({ tenantAbonelik: { findUnique } }) } as never);
      expect((await servis.getir("firma")).kisitli).toBe(false);
      vi.advanceTimersByTime(1000);
      expect((await servis.getir("firma")).kisitli).toBe(true);
      expect(findUnique).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
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
