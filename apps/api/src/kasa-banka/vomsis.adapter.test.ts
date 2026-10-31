import { afterEach, describe, expect, it, vi } from "vitest";
import { VomsisAdapter, VomsisSaglayicisi } from "./vomsis.adapter";
describe("VomsisAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("App Key ve Secret ile token alır", async () => { const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", token: "jwt" }) }); vi.stubGlobal("fetch", f); expect(await new VomsisAdapter().tokenAl({ appKey: "key", appSecret: "secret" })).toBe("jwt"); expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ app_key: "key", app_secret: "secret" }); });
  it("lastId ile hesap hareketlerini artımlı çeker", async () => { const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", transactions: [{ id: 12 }] }) }); vi.stubGlobal("fetch", f); const sonuc = await new VomsisAdapter().hareketleriCek({ appKey: "k", appSecret: "s" }, "jwt", "25", new Date("2026-08-01"), new Date("2026-08-11"), "10"); expect(sonuc[0].id).toBe(12); expect(f.mock.calls[0][0]).toContain("accounts/25/transactions"); expect(f.mock.calls[0][0]).toContain("lastId=10"); expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt"); });
  it("yalnız aktif Vomsis hesaplarını listeler", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success", accounts: [{ id: 1, status: 1 }, { id: 2, status: 0 }] }) })); expect((await new VomsisAdapter().hesaplariCek({ appKey: "k", appSecret: "s" }, "jwt")).map((h) => h.id)).toEqual([1]); });
});

describe("VomsisSaglayicisi — 7 günlük aralık sınırı", () => {
  const GUN = 86_400_000;
  /** "dd-mm-yyyy 00:00:00" → gün sayısı (karşılaştırma için). */
  const gun = (s: string) => { const [g, a, y] = s.slice(0, 10).split("-").map(Number); return Date.UTC(y, a - 1, g) / GUN; };
  function sahte(hareketler: (bas: string, son: string, lastId: string | null) => object[]) {
    const sorgular: { bas: string; son: string; lastId: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/login") || url.includes("/auth")) return { ok: true, status: 200, json: async () => ({ status: "success", token: "jwt" }) };
      const q = new URL(url).searchParams;
      const s = { bas: q.get("beginDate")!, son: q.get("endDate")!, lastId: q.get("lastId") };
      sorgular.push(s);
      // Vomsis'in kuralı: 7 günden uzun aralık reddedilir.
      if (gun(s.son) - gun(s.bas) > 7) return { ok: true, status: 200, json: async () => ({ status: "error", message: "İki tarih arası 7 gün olmalıdır." }) };
      return { ok: true, status: 200, json: async () => ({ status: "success", transactions: hareketler(s.bas, s.son, s.lastId) }) };
    }));
    return sorgular;
  }
  const hareket = (id: number, tarih: string) => ({ id, accounting_date: tarih, system_date: tarih, amount: "10", type: "alacakli", description: `H${id}` });
  const ayar = { kullaniciAdi: `k-${Math.random()}`, parola: "s" };

  it("ilk çekim (son 7 gün + yarın, 8 gün) Vomsis'e 7 günü aşmayan pencerelerle gider ve aralığın tamamını kapsar", async () => {
    const simdi = new Date("2026-10-31T18:42:00Z");
    const aralik = { baslangic: new Date(simdi.getTime() - 7 * GUN), bitis: new Date(simdi.getTime() + GUN) };
    const sorgular = sahte(() => []);
    await new VomsisSaglayicisi().hareketler(ayar, "25", aralik);
    expect(sorgular.length).toBeGreaterThan(1);
    for (const s of sorgular) expect(gun(s.son) - gun(s.bas)).toBeLessThanOrEqual(7);
    expect(sorgular[0].bas).toBe("24-10-2026 00:00:00");
    expect(sorgular.at(-1)!.son).toBe("01-11-2026 00:00:00");
    for (let i = 1; i < sorgular.length; i++) expect(sorgular[i].bas).toBe(sorgular[i - 1].son);
  });

  it("uzun kesinti sonrası (40 gün) da çalışır; sınırda iki kez gelen hareket tekilleşir, imleç en büyük kimliktir", async () => {
    const aralik = { baslangic: new Date("2026-09-20T12:00:00Z"), bitis: new Date("2026-10-31T12:00:00Z"), imlec: "100" };
    let pencere = 0;
    // Her pencere 150'yi (sınırdaki hareket gibi) ve kendine özgü bir hareketi döndürür; imleç ilerleyince boş.
    const sorgular = sahte((_bas, _son, lastId) => (lastId === "100" ? [hareket(150, "2026-09-25"), hareket(300 + pencere++, "2026-10-01")] : []));
    const { hareketler, imlec } = await new VomsisSaglayicisi().hareketler(ayar, "25", aralik);
    for (const s of sorgular) expect(gun(s.son) - gun(s.bas)).toBeLessThanOrEqual(7);
    const pencereler = sorgular.filter((s) => s.lastId === "100");
    expect(pencereler.length).toBe(Math.ceil(41 / 6));
    expect(hareketler.filter((h) => h.id === "150")).toHaveLength(1);
    expect(hareketler).toHaveLength(1 + pencereler.length);
    expect(imlec).toBe(String(300 + pencereler.length - 1));
  });

  it("yeni hareket yoksa imleç korunur", async () => {
    sahte(() => []);
    const { hareketler, imlec } = await new VomsisSaglayicisi().hareketler(ayar, "25", { baslangic: new Date("2026-10-30T00:00:00Z"), bitis: new Date("2026-11-01T00:00:00Z"), imlec: "77" });
    expect(hareketler).toEqual([]);
    expect(imlec).toBe("77");
  });
});
