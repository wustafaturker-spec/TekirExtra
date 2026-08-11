import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { PaytrAdapter } from "./paytr.adapter";
describe("PaytrAdapter", () => { afterEach(() => vi.unstubAllGlobals());
  it("collection ödeme linki için imzalı form gönderir", async () => { const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", id: "L1", link: "https://www.paytr.com/link/L1" }) }); vi.stubGlobal("fetch", f); const s = await new PaytrAdapter().linkOlustur({ merchantId: "m", merchantKey: "k", merchantSalt: "s" }, { ad: "Cari tahsilat", tutarKurus: 1250, dovizCinsi: "TRY", eposta: "a@b.com", callbackUrl: "https://api/cb", callbackId: "id" }); expect(s.id).toBe("L1"); const form = new URLSearchParams(f.mock.calls[0][1].body); expect(form.get("currency")).toBe("TL"); expect(form.get("paytr_token")).toBeTruthy(); });
  it("callback HMAC değerini doğrular", () => { const c = { merchantId: "m", merchantKey: "key", merchantSalt: "salt" }; const g: any = { callback_id: "id", merchant_oid: "oid", status: "success", total_amount: "1000", payment_amount: "1000", currency: "TL", payment_type: "card", merchant_id: "m" }; g.hash = createHmac("sha256", c.merchantKey).update("idoidsaltsuccess1000").digest("base64"); expect(new PaytrAdapter().callbackDogrula(c, g)).toBe(true); });
});
