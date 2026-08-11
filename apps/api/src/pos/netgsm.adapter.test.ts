import { afterEach, describe, expect, it, vi } from "vitest";
import { NetgsmAdapter, netgsmTelefonuDuzenle } from "./netgsm.adapter";

describe("NetgsmAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Türkiye cep telefonu numarasını Netgsm biçimine dönüştürür", () => {
    expect(netgsmTelefonuDuzenle("+90 (532) 123 45 67")).toBe("5321234567");
    expect(netgsmTelefonuDuzenle("0532 123 45 67")).toBe("5321234567");
    expect(() => netgsmTelefonuDuzenle("0212 123 45 67")).toThrow("Türkiye cep telefonu");
  });

  it("Basic kimlik doğrulama ile SMS gönderir ve görev kimliğini döndürür", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, statusText: "OK", json: async () => ({ code: "00", jobid: "12345", description: "success" }) });
    vi.stubGlobal("fetch", fetchMock);
    const sonuc = await new NetgsmAdapter().smsGonder({ kullaniciAdi: "8500000000", parola: "sifre", gondericiAdi: "TEKIR" }, "+90 532 123 45 67", "Ödeme bağlantınız");
    expect(sonuc).toEqual({ gorevId: "12345" });
    const [, istek] = fetchMock.mock.calls[0];
    expect(istek.headers.Authorization).toBe(`Basic ${Buffer.from("8500000000:sifre").toString("base64")}`);
    expect(JSON.parse(istek.body)).toEqual({ msgheader: "TEKIR", encoding: "TR", messages: [{ msg: "Ödeme bağlantınız", no: "5321234567" }] });
  });

  it("Netgsm hata kodunu açıklamayla birlikte yükseltir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, statusText: "OK", json: async () => ({ code: "30", description: "invalid credentials" }) }));
    await expect(new NetgsmAdapter().smsGonder({ kullaniciAdi: "u", parola: "p", gondericiAdi: "TEKIR" }, "5321234567", "Mesaj")).rejects.toThrow("(30)");
  });
});
