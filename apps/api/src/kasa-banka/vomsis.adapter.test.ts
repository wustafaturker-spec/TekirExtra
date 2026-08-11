import { afterEach, describe, expect, it, vi } from "vitest";
import { VomsisAdapter } from "./vomsis.adapter";
describe("VomsisAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("App Key ve Secret ile token alır", async () => { const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", token: "jwt" }) }); vi.stubGlobal("fetch", f); expect(await new VomsisAdapter().tokenAl({ appKey: "key", appSecret: "secret" })).toBe("jwt"); expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ app_key: "key", app_secret: "secret" }); });
  it("lastId ile hesap hareketlerini artımlı çeker", async () => { const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", transactions: [{ id: 12 }] }) }); vi.stubGlobal("fetch", f); const sonuc = await new VomsisAdapter().hareketleriCek({ appKey: "k", appSecret: "s" }, "jwt", "25", new Date("2026-08-01"), new Date("2026-08-11"), "10"); expect(sonuc[0].id).toBe(12); expect(f.mock.calls[0][0]).toContain("accounts/25/transactions"); expect(f.mock.calls[0][0]).toContain("lastId=10"); expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt"); });
  it("yalnız aktif Vomsis hesaplarını listeler", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", accounts: [{ id: 1, status: 1 }, { id: 2, status: 0 }] }) })); expect((await new VomsisAdapter().hesaplariCek({ appKey: "k", appSecret: "s" }, "jwt")).map((h) => h.id)).toEqual([1]); });
});
