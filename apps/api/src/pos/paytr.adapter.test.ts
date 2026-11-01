import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { PaytrAdapter } from "./paytr.adapter";
describe("PaytrAdapter", () => { afterEach(() => vi.unstubAllGlobals());
  it("collection ödeme linki için imzalı form gönderir", async () => { const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", id: "L1", link: "https://www.paytr.com/link/L1" }) }); vi.stubGlobal("fetch", f); const s = await new PaytrAdapter().linkOlustur({ merchantId: "m", merchantKey: "k", merchantSalt: "s" }, { ad: "Cari tahsilat", tutarKurus: 1250, dovizCinsi: "TRY", eposta: "a@b.com", callbackUrl: "https://api/cb", callbackId: "id" }); expect(s.id).toBe("L1"); const form = new URLSearchParams(f.mock.calls[0][1].body); expect(form.get("currency")).toBe("TL"); expect(form.get("paytr_token")).toBeTruthy(); expect(form.get("max_installment")).toBe("1"); });
  it("KSB-35: taksit üst sınırını gönderir, dövizde tek çekime düşer", async () => { const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", id: "L1", link: "https://www.paytr.com/link/L1" }) }); vi.stubGlobal("fetch", f); const g = { ad: "Cari tahsilat", tutarKurus: 1250, eposta: "a@b.com", callbackUrl: "https://api/cb", callbackId: "id" }; const c = { merchantId: "m", merchantKey: "k", merchantSalt: "s" }; await new PaytrAdapter().linkOlustur(c, { ...g, dovizCinsi: "TRY", azamiTaksit: 6 }); await new PaytrAdapter().linkOlustur(c, { ...g, dovizCinsi: "USD", azamiTaksit: 6 }); expect(new URLSearchParams(f.mock.calls[0][1].body).get("max_installment")).toBe("6"); expect(new URLSearchParams(f.mock.calls[1][1].body).get("max_installment")).toBe("1"); });
  it("callback HMAC değerini doğrular", () => { const c = { merchantId: "m", merchantKey: "key", merchantSalt: "salt" }; const g: any = { callback_id: "id", merchant_oid: "oid", status: "success", total_amount: "1000", payment_amount: "1000", currency: "TL", payment_type: "card", merchant_id: "m" }; g.hash = createHmac("sha256", c.merchantKey).update("idoidsaltsuccess1000").digest("base64"); expect(new PaytrAdapter().callbackDogrula(c, g)).toBe(true); });
  it("KSB-43: iade isteğini imzalar, reddi PayTR iletisiyle bildirir", async () => {
    const { createHmac } = await import("node:crypto");
    const c = { merchantId: "m", merchantKey: "k", merchantSalt: "s" };
    const f = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: "success", reference_no: "R1" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "error", err_no: "006", err_msg: "Tutar fazla" }) });
    vi.stubGlobal("fetch", f);
    await expect(new PaytrAdapter().iadeEt(c, { merchantOid: "OID1", tutar: "10.25", referans: "R1" })).resolves.toEqual({ ref: "R1" });
    const form = new URLSearchParams(f.mock.calls[0][1].body);
    expect(f.mock.calls[0][0]).toBe("https://www.paytr.com/odeme/iade");
    expect(form.get("paytr_token")).toBe(createHmac("sha256", "k").update("mOID110.25s").digest("base64"));
    await expect(new PaytrAdapter().iadeEt(c, { merchantOid: "OID1", tutar: "10.25", referans: "R2" })).rejects.toThrow(/Tutar fazla \(006\)/);
  });
});
