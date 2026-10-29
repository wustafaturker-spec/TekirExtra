import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { merchantOid, merchantOidCoz, PaytrDirektAdapter, paytrBildirimDogrula, paytrFormAlanlari, type PaytrOdemeGirdisi } from "./paytr-direkt";

const c = { merchantId: "123456", merchantKey: "anahtar", merchantSalt: "tuz", testModu: true };
const h = (m: string) => createHmac("sha256", c.merchantKey).update(m).digest("base64");
const g: PaytrOdemeGirdisi = {
  merchantOid: merchantOid("3f1c2a4e-1b2c-4d5e-8f90-1234567890ab", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
  userIp: "203.0.113.9", eposta: "f@ornek.invalid", tutar: "478.80", urunAdi: "TekirExtra Başlangıç abonelik (1 ay)",
  adSoyad: "Kabul Kişi", adres: "Ankara", telefon: "5551112233", okUrl: "https://api/ok", failUrl: "https://api/fail",
};

describe("PayTR Direkt API (PLT-13/14)", () => {
  it("merchant_oid 64 harf-rakam; firma ve girişim kimliğine geri çözülür", () => {
    expect(g.merchantOid).toMatch(/^[0-9a-f]{64}$/);
    expect(merchantOidCoz(g.merchantOid)).toEqual({ tenantId: "3f1c2a4e-1b2c-4d5e-8f90-1234567890ab", denemeId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
    expect(merchantOidCoz("kisa")).toBeNull();
  });

  it("form imzası belgedeki sırayla kurulur; kart kaydında store_card ve mevcut utoken gider", () => {
    const f = paytrFormAlanlari(c, g, { kaydet: true, utoken: "U1" });
    expect(f.paytr_token).toBe(h(`123456203.0.113.9${g.merchantOid}f@ornek.invalid478.80card0TL10tuz`));
    expect(f).toMatchObject({ non_3d: "0", test_mode: "1", store_card: "1", utoken: "U1", payment_amount: "478.80" });
    expect(JSON.parse(f.user_basket)).toEqual([[g.urunAdi, "478.80", 1]]);
    expect(paytrFormAlanlari(c, g, { kaydet: false })).not.toHaveProperty("store_card");
  });

  it("bildirim imzası merchant_oid + salt + status + total_amount ile doğrulanır", () => {
    const b = { merchant_oid: g.merchantOid, status: "success", total_amount: "47880", hash: h(`${g.merchantOid}tuzsuccess47880`) };
    expect(paytrBildirimDogrula(c, b)).toBe(true);
    expect(paytrBildirimDogrula(c, { ...b, total_amount: "100" })).toBe(false);
    expect(paytrBildirimDogrula(c, { ...b, hash: "" })).toBe(false);
  });

  it("tekrarlayan ödeme non-3D ve recurring_payment ile gider; yanıt durumları eşlenir", async () => {
    const yanitlar = [{ status: "success" }, { status: "wait_callback" }, { status: "failed", msg: "Kart kapalı" }];
    const fetcher = vi.fn(async (_u: string, i: any) => ({ json: async () => yanitlar.shift(), status: 200, istek: i }) as any);
    const a = new PaytrDirektAdapter(fetcher as any);
    expect(await a.tekrarlayanOdeme(c, g, { utoken: "U", ctoken: "C" })).toEqual({ durum: "odendi" });
    const gonderilen = new URLSearchParams(String(fetcher.mock.calls[0][1].body));
    expect(Object.fromEntries(gonderilen)).toMatchObject({ non_3d: "1", recurring_payment: "1", utoken: "U", ctoken: "C" });
    expect(gonderilen.get("paytr_token")).toBe(h(`123456203.0.113.9${g.merchantOid}f@ornek.invalid478.80card0TL11tuz`));
    expect(fetcher.mock.calls[0][0]).toBe("https://www.paytr.com/odeme");
    expect(await a.tekrarlayanOdeme(c, g, { utoken: "U", ctoken: "C" })).toEqual({ durum: "bekliyor" });
    expect(await a.tekrarlayanOdeme(c, g, { utoken: "U", ctoken: "C" })).toEqual({ durum: "basarisiz", hata: "Kart kapalı" });
  });

  it("kart listesi ve silme belgedeki imzalarla çağrılır", async () => {
    const fetcher = vi.fn(async (u: string) => ({ json: async () => (u.endsWith("/list") ? [{ ctoken: "C1", last_4: "1234" }] : { status: "success" }) }) as any);
    const a = new PaytrDirektAdapter(fetcher as any);
    expect(await a.kartListesi(c, "U")).toEqual([{ ctoken: "C1", last_4: "1234" }]);
    expect(new URLSearchParams(String(fetcher.mock.calls[0][1].body)).get("paytr_token")).toBe(h("Utuz"));
    await a.kartSil(c, "U", "C1");
    expect(fetcher.mock.calls[1][0]).toBe("https://www.paytr.com/odeme/capi/delete");
    expect(new URLSearchParams(String(fetcher.mock.calls[1][1].body)).get("paytr_token")).toBe(h("C1Utuz"));
  });
});
