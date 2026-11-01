import { afterEach, describe, expect, it, vi } from "vitest";
import { IyzicoAdapter, iyzicoKesintisi, iyzicoTelefonuDuzenle } from "./iyzico.adapter";
afterEach(() => vi.unstubAllGlobals());
describe("IyzicoAdapter", () => {
  it("telefonu iyzico E.164 biçimine dönüştürür ve geçersiz değeri göndermez", () => {
    expect(iyzicoTelefonuDuzenle("0532 123 45 67")).toBe("+905321234567");
    expect(iyzicoTelefonuDuzenle("5321234567")).toBe("+905321234567");
    expect(iyzicoTelefonuDuzenle("5321234567 / 0212 123 45 67")).toBeUndefined();
  });
  it("Checkout Form baslatma istegini IYZWSv2 ile imzalar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", token: "tok-1", paymentPageUrl: "https://sandbox.example/pay" }) }); vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new IyzicoAdapter().odemeBaslat({ apiKey: "api", secretKey: "secret", baseUrl: "https://sandbox-api.iyzipay.com" }, { price: 100 });
    expect(sonuc).toEqual({ token: "tok-1", odemeSayfasiUrl: "https://sandbox.example/pay" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^IYZWSv2 /);
    expect(fetchMock.mock.calls[0][1].headers["x-iyzi-rnd"]).toBeTruthy();
  });
  it("retrieve yanitini odeme sonucuna normalize eder", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", paymentStatus: "SUCCESS", paymentId: "pay-1", paidPrice: 100, currency: "TRY" }) }));
    await expect(new IyzicoAdapter().odemeSonucu({ apiKey: "api", secretKey: "secret", baseUrl: "https://sandbox-api.iyzipay.com" }, "tok-1")).resolves.toMatchObject({ basarili: true, odemeId: "pay-1", tutar: 100, fiyat: 100, odenen: 100, taksit: 1, dovizCinsi: "TRY" });
  });
  it("KSB-37: kesinti ve kart bilgisini okur; BIN'i 6 haneye keser, kalem payı eksikse işyerine geçeni vermez", () => {
    const k = iyzicoKesintisi({ iyziCommissionRateAmount: 34.9, iyziCommissionFee: 0.25, itemTransactions: [{ merchantPayoutAmount: 600.1 }, { merchantPayoutAmount: 364.75 }], cardAssociation: "MASTER_CARD", cardFamily: "Bonus", cardType: "CREDIT_CARD", binNumber: "55287900", lastFourDigits: "0008", fraudStatus: 0, authCode: "A1", hostReference: "H1", cardNumber: "5528790000000008" });
    expect(k).toEqual({ saglayiciKomisyonu: "34.9", saglayiciUcreti: "0.25", isyerineGecenKalemleri: ["600.1", "364.75"], kartMarkasi: "MASTER_CARD", kartAilesi: "Bonus", kartTuru: "CREDIT_CARD", kartBin: "552879", kartSon4: "0008", fraudDurumu: 0, provizyonKodu: "A1", hostReferansi: "H1" });
    expect(JSON.stringify(k)).not.toContain("5528790000000008");
    expect(iyzicoKesintisi({ itemTransactions: [{ merchantPayoutAmount: 10 }, {}] }).isyerineGecenKalemleri).toBeUndefined();
    expect(iyzicoKesintisi({}).fraudDurumu).toBeUndefined();
  });
  it("KSB-43: kalem işlem numaralarını okur ve /payment/refund'a iade gönderir", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "success", paymentStatus: "SUCCESS", price: 100, paidPrice: 100, itemTransactions: [{ paymentTransactionId: "PTX-1", merchantPayoutAmount: 96 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "success", paymentTransactionId: "PTX-1", price: 40, hostReference: "H9" }) });
    vi.stubGlobal("fetch", f);
    const c = { apiKey: "api", secretKey: "secret", baseUrl: "https://sandbox-api.iyzipay.com" };
    expect((await new IyzicoAdapter().odemeSonucu(c, "tok")).odemeIslemNolari).toEqual(["PTX-1"]);
    await expect(new IyzicoAdapter().iadeEt(c, { odemeIslemNo: "PTX-1", tutar: "40.00", dovizCinsi: "TRY", conversationId: "cv" })).resolves.toEqual({ ref: "H9", tutar: "40" });
    expect(f.mock.calls[1][0]).toBe("https://sandbox-api.iyzipay.com/payment/refund");
    expect(JSON.parse(f.mock.calls[1][1].body)).toMatchObject({ paymentTransactionId: "PTX-1", price: "40.00", currency: "TRY", conversationId: "cv" });
  });
});
