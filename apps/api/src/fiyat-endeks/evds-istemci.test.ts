import { describe, expect, it, vi } from "vitest";
import { aylikDonem, EVDS_TABAN_ADRESI, evdsAylikDegerler, EvdsHatasi, evdsYanitiniAyristir } from "./evds-istemci";
import { ayAraligi } from "./fiyat-endeks-hesap";
import { rolErisimi, fiyatEndeksAyariSemasi, FIYAT_ENDEKS_VARSAYILAN } from "./fiyat-endeks-erisim";

/** 2026-11-14'te EVDS'den alınan gerçek yanıtın kısaltılmış biçimi. */
const ORNEK = {
  totalCount: 3,
  items: [
    { Tarih: "2026-9", TP_TUFE1YI_T1: "5901.26000000", TP_TUKFIY2025_GENEL: null, UNIXTIME: { $numberLong: "1788210000" } },
    { Tarih: "2026-10", TP_TUFE1YI_T1: "5998.51000000", TP_TUKFIY2025_GENEL: "131.20000000", UNIXTIME: { $numberLong: "1790802000" } },
    { Tarih: "2026-11", TP_TUFE1YI_T1: null, TP_TUKFIY2025_GENEL: null },
  ],
};

describe("EVDS yanıtı", () => {
  it("aylık tarihi ayın ilk gününe çevirir", () => {
    expect(aylikDonem("2026-1")).toBe("2026-01-01");
    expect(aylikDonem("2026-10")).toBe("2026-10-01");
    expect(aylikDonem("13-11-2026")).toBeNull();
    expect(aylikDonem("2026-13")).toBeNull();
  });

  it("seri bazında ayrıştırır; boş değeri atlar, uydurmaz", () => {
    const r = evdsYanitiniAyristir(ORNEK, ["TP.TUFE1YI.T1", "TP.TUKFIY2025.GENEL"]);
    expect(r.get("TP.TUFE1YI.T1")).toEqual([{ donem: "2026-09-01", deger: "5901.26000000" }, { donem: "2026-10-01", deger: "5998.51000000" }]);
    expect(r.get("TP.TUKFIY2025.GENEL")).toEqual([{ donem: "2026-10-01", deger: "131.20000000" }]);
  });

  it("liste olmayan yanıtta hata verir", () => {
    expect(() => evdsYanitiniAyristir({ status: "400" }, ["TP.X"])).toThrow(EvdsHatasi);
  });

  it("anahtarı başlıkta gönderir, adreste göndermez", async () => {
    const istek = vi.fn(async () => new Response(JSON.stringify(ORNEK), { headers: { "content-type": "application/json;charset=UTF-8" } }));
    await evdsAylikDegerler("gizli-anahtar", ["TP.TUFE1YI.T1"], new Date("2026-01-01T00:00:00Z"), new Date("2026-11-14T00:00:00Z"), istek as unknown as typeof fetch);
    const [adres, secenek] = istek.mock.calls[0] as unknown as [string, RequestInit];
    expect(adres.startsWith(`${EVDS_TABAN_ADRESI}/series=TP.TUFE1YI.T1&startDate=01-01-2026&endDate=14-11-2026`)).toBe(true);
    expect(adres).not.toContain("gizli-anahtar");
    expect((secenek.headers as Record<string, string>).key).toBe("gizli-anahtar");
  });

  it("HTML yanıtı (eski adres davranışı) açık hatayla reddedilir", async () => {
    const istek = vi.fn(async () => new Response("<!DOCTYPE html>", { headers: { "content-type": "text/html; charset=utf-8" } }));
    await expect(evdsAylikDegerler("k", ["TP.X"], new Date(), new Date(), istek as unknown as typeof fetch)).rejects.toThrow(/JSON yerine/);
  });

  it("anahtar yoksa ağa gitmez", async () => {
    const istek = vi.fn();
    await expect(evdsAylikDegerler("", ["TP.X"], new Date(), new Date(), istek as unknown as typeof fetch)).rejects.toThrow(EvdsHatasi);
    expect(istek).not.toHaveBeenCalled();
  });
});

describe("END-23 rol erişimi", () => {
  it("yönetici her zaman iki tarafa erişir", () => {
    expect(rolErisimi({ satisRolleri: [], alisRolleri: [] }, "yonetici")).toEqual({ satis: true, alis: true });
  });
  it("varsayılan: muhasebe açık, satış kapalı", () => {
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "muhasebe")).toEqual({ satis: true, alis: true });
    expect(rolErisimi(FIYAT_ENDEKS_VARSAYILAN, "satis")).toEqual({ satis: false, alis: false });
  });
  it("yönetici satış rolüne yalnız satış tarafını açabilir", () => {
    expect(rolErisimi({ satisRolleri: ["satis"], alisRolleri: ["muhasebe"] }, "satis")).toEqual({ satis: true, alis: false });
  });
  it("dış roller ve tekrar eden rol seçilemez", () => {
    expect(fiyatEndeksAyariSemasi.safeParse({ satisRolleri: ["b2b_bayi"], alisRolleri: [] }).success).toBe(false);
    expect(fiyatEndeksAyariSemasi.safeParse({ satisRolleri: ["satis", "satis"], alisRolleri: [] }).success).toBe(false);
  });
});

it("ay aralığı 60 ayı doğru sayar", () => {
  expect(ayAraligi("2021-12-01", "2026-11-01")).toHaveLength(60);
});
