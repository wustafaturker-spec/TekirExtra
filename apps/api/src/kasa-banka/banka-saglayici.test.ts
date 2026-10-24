import { afterEach, describe, expect, it, vi } from "vitest";
import { BANKA_HTTP, bankaIstegi, trTarihParcalari } from "./banka-saglayici";
import { VomsisAdapter, VomsisSaglayicisi, vomsisTokenOnbelleginiTemizle } from "./vomsis.adapter";

const beklemeler: number[] = [];
BANKA_HTTP.bekle = async (ms) => { beklemeler.push(ms); };
const yanit = (status: number, govde: unknown = {}, basliklar: Record<string, string> = {}) => ({ ok: status < 400, status, statusText: String(status), headers: { get: (a: string) => basliklar[a.toLowerCase()] ?? null }, json: async () => govde });

afterEach(() => { vi.unstubAllGlobals(); vomsisTokenOnbelleginiTemizle(); beklemeler.length = 0; });

describe("bankaIstegi (KSB-30)", () => {
  it("her denemeyi zaman aşımıyla sınırlar", async () => {
    const f = vi.fn().mockResolvedValue(yanit(200));
    vi.stubGlobal("fetch", f);
    await bankaIstegi("Test", "https://x");
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("503 ve 429'u yeniden dener; Retry-After'a uyar", async () => {
    const f = vi.fn().mockResolvedValueOnce(yanit(503)).mockResolvedValueOnce(yanit(429, {}, { "retry-after": "7" })).mockResolvedValue(yanit(200));
    vi.stubGlobal("fetch", f);
    expect((await bankaIstegi("Test", "https://x")).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
    expect(beklemeler).toEqual([1000, 7000]);
  });

  it("4xx'i yeniden denemez; son denemede de geçici hata çağırana döner", async () => {
    const dort = vi.fn().mockResolvedValue(yanit(401));
    vi.stubGlobal("fetch", dort);
    expect((await bankaIstegi("Test", "https://x")).status).toBe(401);
    expect(dort).toHaveBeenCalledTimes(1);
    const bes = vi.fn().mockResolvedValue(yanit(502));
    vi.stubGlobal("fetch", bes);
    expect((await bankaIstegi("Test", "https://x")).status).toBe(502);
    expect(bes).toHaveBeenCalledTimes(3);
  });

  it("asılı kalan istek zaman aşımı hatasına döner (döngü kilitlenmez)", async () => {
    const zaman = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(zaman));
    await expect(bankaIstegi("Vomsis", "https://x")).rejects.toThrow("Vomsis 30 saniyede yanıt vermedi (3 deneme)");
  });

  it("gerçek zaman aşımı: yanıt gelmeyen sunucuda istek kesilir", async () => {
    const eski = BANKA_HTTP.zamanAsimiMs;
    BANKA_HTTP.zamanAsimiMs = 50;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => new Promise((_, red) => init.signal!.addEventListener("abort", () => red(init.signal!.reason))));
    try {
      await expect(bankaIstegi("Test", "https://x")).rejects.toThrow(/yanıt vermedi/);
    } finally {
      BANKA_HTTP.zamanAsimiMs = eski;
    }
  });

  it("Türkiye günü sunucu saat diliminden bağımsızdır", () => {
    expect(trTarihParcalari(new Date("2026-10-31T22:30:00Z"))).toEqual({ gun: 1, ay: 11, yil: 2026 });
  });
});

describe("Vomsis sağlayıcısı (KSB-30)", () => {
  const ayar = { kullaniciAdi: "k", parola: "s" };
  const aralik = { baslangic: new Date("2026-10-30T22:30:00Z"), bitis: new Date("2026-10-31T22:30:00Z"), imlec: "10" };

  it("tarih aralığını Türkiye günüyle gönderir", async () => {
    const f = vi.fn(async (url: string) => yanit(200, url.endsWith("/authenticate") ? { status: "success", token: "jwt" } : { status: "success", transactions: [] }));
    vi.stubGlobal("fetch", f);
    await new VomsisSaglayicisi().hareketler(ayar, "25", aralik);
    const url = new URL(f.mock.calls[1][0]);
    expect(url.searchParams.get("beginDate")).toBe("31-10-2026 00:00:00");
    expect(url.searchParams.get("endDate")).toBe("01-11-2026 00:00:00");
  });

  it("erişim anahtarını önbellekten kullanır; reddedilirse bir kez yeniler", async () => {
    let tokenSayisi = 0;
    let reddet = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/authenticate")) return yanit(200, { status: "success", token: `jwt${++tokenSayisi}` });
      if (reddet && (init.headers as Record<string, string>).Authorization === "Bearer jwt1") return yanit(401, { message: "expired" });
      return yanit(200, { status: "success", accounts: [{ id: 1, status: 1, fec_name: "TL", account_number: "123" }] });
    }));
    const s = new VomsisSaglayicisi();
    await s.hesaplar(ayar);
    await s.hesaplar(ayar);
    expect(tokenSayisi).toBe(1);
    reddet = true;
    expect(await s.hesaplar(ayar)).toEqual([{ id: "1", ad: "123", iban: null, dovizCinsi: "TRY", bankaAdi: null }]);
    expect(tokenSayisi).toBe(2);
  });

  it("imleçten devam ederek sayfaları çeker; boş yanıtta durur", async () => {
    const sayfalar: Record<string, unknown[]> = { "10": [{ id: 11 }, { id: 12 }], "12": [{ id: 13 }], "13": [] };
    const f = vi.fn(async (url: string) => {
      if (url.endsWith("/authenticate")) return yanit(200, { status: "success", token: "jwt" });
      const son = new URL(url).searchParams.get("lastId")!;
      return yanit(200, { status: "success", transactions: (sayfalar[son] ?? []).map((h: any) => ({ ...h, accounting_date: "2026-10-31", amount: "10", type: "alacakli", description: "x" })) });
    });
    vi.stubGlobal("fetch", f);
    const sonuc = await new VomsisSaglayicisi().hareketler(ayar, "25", aralik);
    expect(sonuc.hareketler.map((h) => h.id)).toEqual(["11", "12", "13"]);
    expect(sonuc.imlec).toBe("13");
  });

  it("imleç ilerlemezse (sağlayıcı lastId'yi yok sayarsa) tekrar etmez", async () => {
    const f = vi.fn(async (url: string) => (url.endsWith("/authenticate") ? yanit(200, { status: "success", token: "jwt" }) : yanit(200, { status: "success", transactions: [{ id: 5, accounting_date: "2026-10-31", amount: "1", type: "borclu", description: "x" }] })));
    vi.stubGlobal("fetch", f);
    const sonuc = await new VomsisSaglayicisi().hareketler(ayar, "25", aralik);
    expect(f).toHaveBeenCalledTimes(2);
    expect(sonuc.imlec).toBe("10");
  });

  it("eski sınıf arayüzü korunur", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(yanit(200, { status: "success", token: "jwt" })));
    expect(await new VomsisAdapter().tokenAl({ appKey: "k", appSecret: "s" })).toBe("jwt");
  });
});
