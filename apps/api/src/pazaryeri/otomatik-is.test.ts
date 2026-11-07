import { describe, expect, it, vi } from "vitest";
import { denemeSonucu, hataTuru, isUygun, sonrakiCalisma, varsayilanAralik } from "./otomatik-is";
import { PazaryeriOtomatikService } from "./pazaryeri-otomatik.service";
import { kilitle } from "../core/redis-kilit";

const t = (dk: number) => new Date(Date.UTC(2026, 10, 7, 12, 0) + dk * 60_000);

describe("pazaryeri otomatik çekim kuralları (PZR-18)", () => {
  it("varsayılan aralıklar kullanıcı kararıyla: sipariş 60 dk, finans günde bir; finans yalnız Amazon/Trendyol", () => {
    expect(varsayilanAralik("siparis")).toBe(60);
    expect(varsayilanAralik("finans")).toBe(1440);
    expect(isUygun("hepsiburada", "siparis")).toBe(true);
    expect(isUygun("hepsiburada", "finans")).toBe(false);
    expect(isUygun("trendyol", "finans")).toBe(true);
  });

  it("hata türü: kimlik reddi, geçici, diğer", () => {
    expect(hataTuru("Trendyol sipariş servisi HTTP 401")).toBe("kimlik");
    expect(hataTuru("Trendyol finans servisi (settlements Sale) HTTP 403")).toBe("kimlik");
    expect(hataTuru("Trendyol finans servisi HTTP 429")).toBe("gecici");
    expect(hataTuru("HTTP 503")).toBe("gecici");
    expect(hataTuru("fetch failed")).toBe("gecici");
    expect(hataTuru("The operation was aborted due to timeout")).toBe("gecici");
    expect(hataTuru("Trendyol satıcı ID ve API secret zorunludur")).toBe("diger");
  });

  it("sonraki çalışma: ilk kez hemen; aralık son denemeden; kapalı/durmuş iş çalışmaz; çarpan en çok bir güne kadar", () => {
    const d = { aralikDk: 60, sonDeneme: null, durduNedeni: null, beklemeCarpani: 1 };
    expect(sonrakiCalisma(d, t(0))).toEqual(t(0));
    expect(sonrakiCalisma({ ...d, sonDeneme: t(0) }, t(10))).toEqual(t(60));
    expect(sonrakiCalisma({ ...d, sonDeneme: t(0), beklemeCarpani: 4 }, t(10))).toEqual(t(240));
    expect(sonrakiCalisma({ ...d, sonDeneme: t(0), beklemeCarpani: 64 }, t(10))).toEqual(t(1440));
    expect(sonrakiCalisma({ ...d, aralikDk: 0 }, t(0))).toBeNull();
    expect(sonrakiCalisma({ ...d, durduNedeni: "kimlik" }, t(0))).toBeNull();
  });

  it("deneme sonucu: başarı sıfırlar; geçici hata çarpanı ikiye katlar (bir günle sınırlı); kimlik reddi durdurur", () => {
    expect(denemeSonucu({ aralikDk: 60, ardisikHata: 4, beklemeCarpani: 8 }, null, t(0))).toEqual({ sonDeneme: t(0), sonBasari: t(0), ardisikHata: 0, sonHata: null, durduNedeni: null, beklemeCarpani: 1 });
    const g = denemeSonucu({ aralikDk: 60, ardisikHata: 0, beklemeCarpani: 1 }, "HTTP 429", t(0));
    expect(g).toMatchObject({ ardisikHata: 1, beklemeCarpani: 2, sonHata: "HTTP 429" });
    expect(g).not.toHaveProperty("durduNedeni");
    expect(denemeSonucu({ aralikDk: 60, ardisikHata: 5, beklemeCarpani: 16 }, "HTTP 503", t(0)).beklemeCarpani).toBe(24);
    expect(denemeSonucu({ aralikDk: 1440, ardisikHata: 0, beklemeCarpani: 1 }, "HTTP 503", t(0)).beklemeCarpani).toBe(1);
    const k = denemeSonucu({ aralikDk: 60, ardisikHata: 2, beklemeCarpani: 1 }, "Trendyol sipariş servisi HTTP 401", t(0));
    expect(k).toMatchObject({ ardisikHata: 3, beklemeCarpani: 1 });
    expect(k.durduNedeni).toContain("kimlik bilgisini reddetti");
    expect(denemeSonucu({ aralikDk: 60, ardisikHata: 0, beklemeCarpani: 2 }, "bozuk yanıt", t(0)).beklemeCarpani).toBe(1);
  });
});

describe("planlayıcı (PZR-18)", () => {
  const servis = (durdu: string[] = []) => new PazaryeriOtomatikService({} as never, {} as never, { otomasyonDurdu: vi.fn(async (id: string) => durdu.includes(id)) } as never);
  const kayit = (is: string, ek: Record<string, unknown> = {}) => ({ is, aralikDk: 60, sonDeneme: null, sonBasari: null, ardisikHata: 0, sonHata: null, durduNedeni: null, beklemeCarpani: 1, ...ek });

  it("kaydı olmayan bağlantı varsayılanla hemen; aralığı dolmamış, kapalı ve durmuş iş atlanır; finans uygun olmayan sağlayıcıda yok", async () => {
    const isler = await servis().vadesiGelenler([
      { id: "b1", tenantId: "t1", saglayici: "trendyol", baglantiOtomatikIsleri: [] },
      { id: "b2", tenantId: "t1", saglayici: "hepsiburada", baglantiOtomatikIsleri: [kayit("siparis", { sonDeneme: t(-30) })] },
      { id: "b3", tenantId: "t2", saglayici: "amazon_tr", baglantiOtomatikIsleri: [kayit("siparis", { aralikDk: 0 }), kayit("finans", { durduNedeni: "x" })] },
      { id: "b4", tenantId: "t2", saglayici: "n11", baglantiOtomatikIsleri: [kayit("siparis", { sonDeneme: t(-61) })] },
    ], t(0));
    expect(isler).toEqual([{ tenantId: "t1", baglantiId: "b1", is: "siparis" }, { tenantId: "t1", baglantiId: "b1", is: "finans" }, { tenantId: "t2", baglantiId: "b4", is: "siparis" }]);
  });

  it("askıdaki firmanın işi planlanmaz", async () => {
    const isler = await servis(["t1"]).vadesiGelenler([{ id: "b1", tenantId: "t1", saglayici: "trendyol", baglantiOtomatikIsleri: [] }], t(0));
    expect(isler).toEqual([]);
  });
});

describe("kilit (PZR-18)", () => {
  it("aynı anahtar bırakılana kadar ikinci kez alınamaz", async () => {
    const birak = await kilitle("tekir:test:kilit", 60);
    expect(birak).toBeTypeOf("function");
    expect(await kilitle("tekir:test:kilit", 60)).toBeNull();
    await birak!();
    const yine = await kilitle("tekir:test:kilit", 60);
    expect(yine).toBeTypeOf("function");
    await yine!();
  });
});
