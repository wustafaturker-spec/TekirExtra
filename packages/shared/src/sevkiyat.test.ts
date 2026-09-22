import { describe, expect, it } from "vitest";
import { irsaliyeYerineIbaresi, sevkiyatEksikleri, sevkiyatSorulurMu, sevkiyatYontemiMi } from "./sevkiyat";

const mal = { tip: "satis", satirlar: [{ stok: { tip: "urun" } }] };

describe("sevkiyatSorulurMu (EBLG-76)", () => {
  it("mal içeren satış faturasında sorar", () => {
    expect(sevkiyatSorulurMu(mal)).toBe(true);
  });

  it("yalnız hizmet satırı varsa sormaz", () => {
    expect(sevkiyatSorulurMu({ tip: "satis", satirlar: [{ stok: { tip: "hizmet" } }] })).toBe(false);
  });

  it("alış faturasında sormaz", () => {
    expect(sevkiyatSorulurMu({ ...mal, tip: "alis" })).toBe(false);
  });
});

describe("sevkiyatEksikleri (EBLG-76)", () => {
  const temel = { sorulur: true, mukellef: true as boolean | null, yontem: null as string | null, irsaliyeSayisi: 0, fiiliSevkZamani: null as Date | string | null };

  it("firma e-İrsaliye mükellefi değilse hiç çalışmaz", () => {
    expect(sevkiyatEksikleri({ ...temel, mukellef: false })).toEqual([]);
  });

  it("sevkiyat sorulmayan faturada çalışmaz", () => {
    expect(sevkiyatEksikleri({ ...temel, sorulur: false })).toEqual([]);
  });

  it("mükellefiyet bilinmiyorsa gönderimi durdurur", () => {
    expect(sevkiyatEksikleri({ ...temel, mukellef: null })[0]).toContain("mükellefiyeti bilinmiyor");
  });

  it("yol seçilmeden gönderim durur", () => {
    expect(sevkiyatEksikleri(temel)).toHaveLength(1);
  });

  it("irsaliye yolunda en az bir irsaliye ister", () => {
    expect(sevkiyatEksikleri({ ...temel, yontem: "irsaliye" })).toHaveLength(1);
    expect(sevkiyatEksikleri({ ...temel, yontem: "irsaliye", irsaliyeSayisi: 1 })).toEqual([]);
  });

  it("fatura önce düzenleniyorsa başka bir şey istemez", () => {
    expect(sevkiyatEksikleri({ ...temel, yontem: "fatura_once" })).toEqual([]);
  });

  it("irsaliye yerine geçen faturada fiili sevk anı zorunludur", () => {
    expect(sevkiyatEksikleri({ ...temel, yontem: "irsaliye_yerine" })[0]).toContain("fiili sevk");
    expect(sevkiyatEksikleri({ ...temel, yontem: "irsaliye_yerine", fiiliSevkZamani: new Date() })).toEqual([]);
  });

  it("tanımsız yolu kabul etmez", () => {
    expect(sevkiyatYontemiMi("kargo")).toBe(false);
    expect(sevkiyatEksikleri({ ...temel, yontem: "kargo" })).toHaveLength(1);
  });
});

describe("irsaliyeYerineIbaresi (EBLG-76)", () => {
  it("e-Faturada belgenin adını söyler", () => {
    expect(irsaliyeYerineIbaresi("efatura")).toBe(
      "Mal e-Fatura beraberinde sevk edildiğinden ayrıca e-İrsaliye düzenlenmemiştir. Bu fatura irsaliye yerine geçer.",
    );
  });

  it("e-Arşiv'e düşen belgede e-Arşiv faturası der", () => {
    expect(irsaliyeYerineIbaresi("earsiv")).toContain("Mal e-Arşiv faturası beraberinde");
  });
});
