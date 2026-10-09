import { describe, expect, it, vi } from "vitest";
import { kodTablosuKur, tevkifatTablosuKur } from "@tekirextra/shared";
import { firmaTevkifatTablosu, mevzuatKurallariniUygula, tevkifatKurallariniUygula } from "./tevkifat-tablosu";

describe("firma tevkifat tablosu (MVZ-09/12)", () => {
  it("belge tarihindeki merkezi kayıtları okur, firmanın gizlediklerini işaretler", async () => {
    const mevzuat = { yururluktekiler: vi.fn().mockResolvedValue([{ anahtar: "601", deger: { ad: "YAPIM", oranlar: ["3/10"] } }, { anahtar: "604", deger: { ad: "YEMEK", oranlar: ["5/10"] } }]) };
    const ayarlar = { getir: vi.fn().mockResolvedValue({ gizli: ["604"] }) };
    const tablo = await firmaTevkifatTablosu({ mevzuat: mevzuat as never, ayarlar: ayarlar as never }, "2023-05-01");
    expect(mevzuat.yururluktekiler).toHaveBeenCalledWith("tevkifat_kodu", "2023-05-01");
    expect(tablo).toEqual([{ kod: "601", ad: "YAPIM", oranlar: ["3/10"] }, { kod: "604", ad: "YEMEK", oranlar: ["5/10"], pasif: true }]);
    // Gelen belge: gizliler sayılmaz.
    expect((await firmaTevkifatTablosu({ mevzuat: mevzuat as never, ayarlar: ayarlar as never }, "2023-05-01", { gizlilerDahil: false })).some((k) => k.pasif)).toBe(false);
  });

  it("FTR-35 biçimli eski ayarın yalnız pasif işaretlerini gizli sayar (MVZ-15)", async () => {
    const ayarlar = { getir: vi.fn().mockResolvedValue({ gizli: undefined, degisiklikler: [{ kod: "601", oranlar: ["9/10"] }, { kod: "612", pasif: true }] }) };
    const tablo = await firmaTevkifatTablosu({ ayarlar: ayarlar as never }, "2026-10-09");
    expect(tablo.find((k) => k.kod === "601")?.oranlar).toEqual(["4/10"]);
    expect(tablo.find((k) => k.kod === "612")?.pasif).toBe(true);
  });

  it("kod ve oran kuralını belge tarihindeki tabloyla uygular", () => {
    const tablo = tevkifatTablosuKur([{ anahtar: "604", deger: { ad: "YEMEK", oranlar: ["5/10"] } }, { anahtar: "650", deger: { ad: "DİĞER", oranlar: ["2/10", "5/10"] } }], ["604"]);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "699" }], tablo)[0]).toMatch(/1\. satır: Tanımsız/);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "650" }], tablo)[0]).toMatch(/oranı seçilmelidir/);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "604" }], tablo)[0]).toMatch(/gizlenmiş/);
    expect(tevkifatKurallariniUygula([{ kdvOrani: "20", tevkifatKodu: "604" }], tablo, true)).toEqual([]);
  });
});

describe("belge tarihindeki KDV kod tablosu (MVZ-11)", () => {
  const kod = kodTablosuKur({
    kdvOrani: [{ anahtar: "1", deger: {} }, { anahtar: "8", deger: {} }, { anahtar: "18", deger: {} }],
    istisna: [{ anahtar: "301", deger: { ad: "Mal ihracatı", istisnaTuru: "tam" } }, { anahtar: "351", deger: { ad: "İstisna olmayan", istisnaTuru: "tam" } }],
    ozelMatrah: [{ anahtar: "812", deger: { ad: "İkinci el" } }],
    ihracKayitli: [{ anahtar: "701", deger: { ad: "11/1-c" } }],
  });
  const tevkifat = tevkifatTablosuKur([{ anahtar: "603", deger: { ad: "BAKIM", oranlar: ["7/10"] } }]);

  it("2023 öncesi tablo: %18 geçer, %20 reddedilir", () => {
    expect(mevzuatKurallariniUygula({ satirlar: [{ kdvOrani: "18" }] }, { tevkifat, kod })).toEqual([]);
    expect(mevzuatKurallariniUygula({ satirlar: [{ kdvOrani: "20" }] }, { tevkifat, kod })[0]).toMatch(/1\. satır: KDV oranı %20 belge tarihinde geçerli değil; geçerli oranlar: %1, %8, %18/);
  });

  it("istisna, özel matrah ve ihraç kayıtlı kodunu belge tarihindeki listede arar", () => {
    expect(mevzuatKurallariniUygula({ satirlar: [{ kdvOrani: "18" }, { kdvOrani: "18", gibIstisnaKodu: "999" }] }, { tevkifat, kod }).join()).toMatch(/2\. satır: Tanımsız GİB istisna kodu: 999/);
    expect(mevzuatKurallariniUygula({ ozelMatrahKodu: "806", satirlar: [{ kdvOrani: "18" }] }, { tevkifat, kod })[0]).toMatch(/Özel matrah kodu 806/);
    expect(mevzuatKurallariniUygula({ ihracKayitliKodu: "702", satirlar: [{ kdvOrani: "18" }] }, { tevkifat, kod })[0]).toMatch(/İhraç kayıtlı kodu 702/);
    expect(mevzuatKurallariniUygula({ ozelMatrahKodu: "812", ihracKayitliKodu: "701", satirlar: [{ kdvOrani: "18", tevkifatKodu: "603" }] }, { tevkifat, kod })).toEqual([]);
  });
});
