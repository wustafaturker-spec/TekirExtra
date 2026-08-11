import { afterEach, describe, expect, it, vi } from "vitest";
import { IyzicoAdapter } from "./iyzico.adapter";
afterEach(() => vi.unstubAllGlobals());
describe("IyzicoAdapter", () => {
  it("Checkout Form baslatma istegini IYZWSv2 ile imzalar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", token: "tok-1", paymentPageUrl: "https://sandbox.example/pay" }) }); vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new IyzicoAdapter().odemeBaslat({ apiKey: "api", secretKey: "secret", baseUrl: "https://sandbox-api.iyzipay.com" }, { price: 100 });
    expect(sonuc).toEqual({ token: "tok-1", odemeSayfasiUrl: "https://sandbox.example/pay" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^IYZWSv2 /);
    expect(fetchMock.mock.calls[0][1].headers["x-iyzi-rnd"]).toBeTruthy();
  });
  it("retrieve yanitini odeme sonucuna normalize eder", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", paymentStatus: "SUCCESS", paymentId: "pay-1", paidPrice: 100, currency: "TRY" }) }));
    await expect(new IyzicoAdapter().odemeSonucu({ apiKey: "api", secretKey: "secret", baseUrl: "https://sandbox-api.iyzipay.com" }, "tok-1")).resolves.toEqual({ basarili: true, odemeId: "pay-1", tutar: 100, dovizCinsi: "TRY" });
  });
});
