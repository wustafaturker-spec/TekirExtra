import { HttpException } from "@nestjs/common";
import { kapiAcikTx } from "../ozellik-kapisi.test-veri";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";
import { istekBaglami } from "../../core/istek-baglami";
import { AiBosYanitHatasi } from "./ai-bos-yanit";
import { AiSinirHatasi } from "./ai-butce";
import { AiProviderFactory } from "./ai-provider.factory";
import { AiIptalHatasi, iptalSinyaliyle, saglayiciIstegi, SaglayiciHatasi, zamanAsimiyla } from "./aracli-ortak";
import { denemeKarari, onarimTalimati, type DenemeDurumu } from "./dayaniklilik";
import { kiraciSaglayicisi } from "./kiraci-saglayici";
import { MockAiProvider } from "./mock-ai.provider";

const d = (o: Partial<DenemeDurumu> = {}): DenemeDurumu => ({ ayniModelTekrar: 0, yedegeGecildi: false, bosTekrarYapildi: false, onarimYapildi: false, yedekVar: false, yapilandirilmis: false, ozelZamanAsimi: false, kalanMs: 100_000, ...o });
const h503 = () => new SaglayiciHatasi("x", "http", 503);

describe("AI-102 deneme kararı", () => {
  it("geçici HTTP hatasında aynı model 2 kez, sonra yedek; kalıcı hatada hiç", () => {
    expect(denemeKarari(h503(), d())).toEqual({ neden: "yeniden_deneme", beklemeMs: 1000 });
    expect(denemeKarari(h503(), d({ ayniModelTekrar: 1 }))).toEqual({ neden: "yeniden_deneme", beklemeMs: 3000 });
    expect(denemeKarari(h503(), d({ ayniModelTekrar: 2 }))).toBeNull();
    expect(denemeKarari(h503(), d({ ayniModelTekrar: 2, yedekVar: true }))).toEqual({ neden: "yedek_model", beklemeMs: 0 });
    expect(denemeKarari(h503(), d({ ayniModelTekrar: 2, yedekVar: true, yedegeGecildi: true }))).toBeNull();
    expect(denemeKarari(new SaglayiciHatasi("x", "http", 429), d())?.neden).toBe("yeniden_deneme");
    for (const kalici of [400, 401, 403, 404]) expect(denemeKarari(new SaglayiciHatasi("x", "http", kalici), d({ yedekVar: true }))).toBeNull();
    expect(denemeKarari(new SaglayiciHatasi("x", "yonlendirme", 302), d({ yedekVar: true }))).toBeNull();
    expect(denemeKarari(new HttpException("dns", 503), d({ yedekVar: true }))).toBeNull();
  });

  it("zaman aşımında yedek varsa doğrudan yedek, yoksa tek tekrar; çağıranın özel süresi varsa hiçbiri", () => {
    const za = () => new SaglayiciHatasi("x", "zaman_asimi");
    expect(denemeKarari(za(), d({ yedekVar: true }))?.neden).toBe("yedek_model");
    expect(denemeKarari(za(), d())?.neden).toBe("yeniden_deneme");
    expect(denemeKarari(za(), d({ ayniModelTekrar: 1 }))).toBeNull();
    expect(denemeKarari(za(), d({ ozelZamanAsimi: true, yedekVar: true }))).toBeNull();
  });

  it("toplam süre azaldıysa ve sınır/bütçe hatasında denenmez", () => {
    expect(denemeKarari(h503(), d({ kalanMs: 19_000 }))).toBeNull();
    expect(denemeKarari(new AiSinirHatasi("sınır", 429), d({ yedekVar: true }))).toBeNull();
  });

  it("boş yanıt bir kez, engellenmiş boş yanıt hiç; şema hatası yalnız yapılandırılmışta bir kez onarılır", () => {
    const bos = new AiBosYanitHatasi("openai");
    expect(denemeKarari(bos, d())?.neden).toBe("bos_yanit");
    expect(denemeKarari(bos, d({ bosTekrarYapildi: true }))).toBeNull();
    expect(denemeKarari(new AiBosYanitHatasi("gemini", { bitisKodu: "SAFETY", engellemeKodu: null, adaySayisi: 1, parcaSayisi: 0 }), d())).toBeNull();
    const zod = new ZodError([{ code: "invalid_type", expected: "string", received: "number", path: ["satirlar", 0, "ad"], message: "x" }]);
    expect(denemeKarari(zod, d({ yapilandirilmis: true }))?.neden).toBe("sema_onarimi");
    expect(denemeKarari(new SyntaxError("json"), d({ yapilandirilmis: true }))?.neden).toBe("sema_onarimi");
    expect(denemeKarari(zod, d({ yapilandirilmis: true, onarimYapildi: true }))).toBeNull();
    expect(denemeKarari(zod, d())).toBeNull();
    expect(onarimTalimati(zod)).toContain("satirlar.0.ad");
  });
});

function kur(ayar: Record<string, unknown>, buAyUsd = 0) {
  const tx = {
    ...kapiAcikTx(),
    $executeRaw: vi.fn(),
    aiCagriIz: { create: vi.fn().mockResolvedValue({}), aggregate: vi.fn().mockResolvedValue({ _sum: { maliyetUsd: new Prisma.Decimal(buAyUsd) } }) },
    platformAiTavani: { findUnique: vi.fn().mockResolvedValue(null) },
    tenantAiAyari: { findUnique: vi.fn().mockResolvedValue(ayar), update: vi.fn() },
    aiKullanim: { aggregate: vi.fn().mockResolvedValue({ _sum: { cagri: 0 } }), upsert: vi.fn() },
  };
  return { prisma: { tenantIslem: vi.fn((_t: string, fn: (x: typeof tx) => unknown) => fn(tx)) }, tx };
}
const olarak = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "t", userId: "u1", rol: "muhasebe" } }, fn);

/** Model adına göre davranan sahte sağlayıcılar. */
function saglayicilar(davranis: Record<string, Array<() => unknown>>) {
  const cagrilar: { model: string; prompt?: string }[] = [];
  vi.spyOn(AiProviderFactory, "uret").mockImplementation((config) => {
    const model = (config as { modelAdi: string }).modelAdi;
    const p = new MockAiProvider();
    Object.defineProperty(p, "saglayiciAdi", { value: "ollama" });
    Object.defineProperty(p, "modelAdi", { value: model });
    const sira = davranis[model] ?? [];
    const calis = async (prompt?: string) => { cagrilar.push({ model, prompt }); const f = sira.shift(); return f ? f() : "tamam"; };
    vi.spyOn(p, "metinUret").mockImplementation(async (g) => calis(g.prompt) as Promise<string>);
    vi.spyOn(p, "yapilandirilmisUretim").mockImplementation(async (g) => calis(g.prompt) as never);
    return p;
  });
  return cagrilar;
}
const firlat = (h: unknown) => () => { throw h; };
const AYAR = { saglayici: "ollama", modelAdi: "ana", ekonomikModelAdi: "ucuz" };

describe("AI-102 sağlayıcı sarmalayıcısında dayanıklılık", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  async function calistir<T>(is: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const p = olarak(is);
    p.catch(() => undefined);
    await vi.runAllTimersAsync();
    return p;
  }

  it("503 sonra başarı: aynı modelle yeniden dener, her deneme sayılır ve ayrı iz yazılır", async () => {
    const cagrilar = saglayicilar({ ucuz: [firlat(h503()), () => "ok"] });
    const { prisma, tx } = kur(AYAR);
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, "t", { ozellik: "ozet" }));
    expect(await calistir(() => saglayici.metinUret({ prompt: "x" }))).toBe("ok");
    expect(cagrilar.map((c) => c.model)).toEqual(["ucuz", "ucuz"]);
    expect(tx.aiKullanim.upsert).toHaveBeenCalledTimes(2);
    const izler = tx.aiCagriIz.create.mock.calls.map((c) => c[0].data);
    expect(izler.map((i) => [i.basarili, i.hataSinifi, i.deneme, i.denemeNedeni])).toEqual([[false, "SAGLAYICI_HTTP_503", 1, null], [true, null, 2, "yeniden_deneme"]]);
  });

  it("üç 503'ten sonra yedek modele geçer ve yedekle devam eder", async () => {
    const cagrilar = saglayicilar({ ucuz: [firlat(h503()), firlat(h503()), firlat(h503())], ana: [() => "yedekten", () => "yine yedek"] });
    const { prisma, tx } = kur(AYAR);
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, "t", { ozellik: "ozet" }));
    expect(await calistir(() => saglayici.metinUret({ prompt: "x" }))).toBe("yedekten");
    expect(saglayici.modelAdi).toBe("ana");
    expect(await calistir(() => saglayici.metinUret({ prompt: "y" }))).toBe("yine yedek");
    expect(cagrilar.map((c) => c.model)).toEqual(["ucuz", "ucuz", "ucuz", "ana", "ana"]);
    expect(tx.aiCagriIz.create.mock.calls[3][0].data).toMatchObject({ model: "ana", deneme: 4, denemeNedeni: "yedek_model", basarili: true });
  });

  it("dış sağlayıcıda yedek model onay kapsamında değilse geçilmez; hata kullanıcıya döner", async () => {
    const cagrilar: string[] = [];
    vi.spyOn(AiProviderFactory, "uret").mockImplementation((config) => {
      const model = (config as { modelAdi: string }).modelAdi;
      const p = new MockAiProvider();
      Object.defineProperty(p, "saglayiciAdi", { value: "openai" });
      Object.defineProperty(p, "modelAdi", { value: model });
      vi.spyOn(p, "metinUret").mockImplementation(async () => { cagrilar.push(model); throw h503(); });
      return p;
    });
    const { prisma } = kur({ saglayici: "openai", apiKey: "sk", modelAdi: "ana", ekonomikModelAdi: "ucuz", yurtDisiOnayAt: new Date(), yurtDisiOnaySaglayici: "openai", yurtDisiOnayModel: "ucuz", yurtDisiOnayPolitika: (await import("../ayarlar/ai-aktarim-politikasi")).AI_AKTARIM_POLITIKA_SURUMU });
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, "t", { ozellik: "ozet" }));
    await expect(calistir(() => saglayici.metinUret({ prompt: "x" }))).rejects.toBeInstanceOf(SaglayiciHatasi);
    expect(cagrilar).toEqual(["ucuz", "ucuz", "ucuz"]);
  });

  it("boş yanıtı bir kez tekrarlar; şemaya uymayan yanıtta alan yolunu bildirip bir kez onarır", async () => {
    const cagrilar = saglayicilar({
      ucuz: [firlat(new AiBosYanitHatasi("ollama")), () => "dolu"],
      ana: [firlat(new ZodError([{ code: "invalid_type", expected: "string", received: "number", path: ["ad"], message: "x" }])), () => ({ ad: "A" })],
    });
    const { prisma } = kur(AYAR);
    const ozet = await olarak(() => kiraciSaglayicisi(prisma as never, "t", { ozellik: "ozet" }));
    expect(await calistir(() => ozet.saglayici.metinUret({ prompt: "x" }))).toBe("dolu");
    const teklif = await olarak(() => kiraciSaglayicisi(kur(AYAR).prisma as never, "t", { ozellik: "teklif", anaModel: true }));
    expect(await calistir(() => teklif.saglayici.yapilandirilmisUretim({ prompt: "istek" }, z.object({ ad: z.string() })))).toEqual({ ad: "A" });
    const onarim = cagrilar.filter((c) => c.model === "ana");
    expect(onarim[0].prompt).toBe("istek");
    expect(onarim[1].prompt).toMatch(/^istek\n\nÖNEMLİ: .*sorunlu alanlar: ad/);
  });

  it("bütçe sınırına gelince yeniden deneme durur; görsel girdide ve özel süreli çağrıda model değişmez", async () => {
    const cagrilar = saglayicilar({ ucuz: [firlat(h503()), firlat(h503()), firlat(h503())], ana: [() => "yedek"] });
    const { prisma, tx } = kur(AYAR);
    tx.aiKullanim.aggregate.mockResolvedValueOnce({ _sum: { cagri: 0 } }).mockRejectedValueOnce(new AiSinirHatasi("Günlük sınır", 429));
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, "t", { ozellik: "ozet" }));
    await expect(calistir(() => saglayici.metinUret({ prompt: "x" }))).rejects.toBeInstanceOf(AiSinirHatasi);
    expect(cagrilar).toHaveLength(1);

    const c2 = saglayicilar({ ucuz: [firlat(h503()), firlat(h503()), firlat(h503())] });
    const g = await olarak(() => kiraciSaglayicisi(kur(AYAR).prisma as never, "t", { ozellik: "ozet" }));
    await expect(calistir(() => g.saglayici.metinUret({ prompt: "x", gorselBase64: "AA==", mimeType: "image/png" }))).rejects.toBeInstanceOf(SaglayiciHatasi);
    expect(c2.map((c) => c.model)).toEqual(["ucuz", "ucuz", "ucuz"]);

    const c3 = saglayicilar({ ucuz: [firlat(new SaglayiciHatasi("x", "zaman_asimi"))] });
    const o = await olarak(() => kiraciSaglayicisi(kur(AYAR).prisma as never, "t", { ozellik: "ozet" }));
    await expect(calistir(() => zamanAsimiyla(5_000, () => o.saglayici.metinUret({ prompt: "x" })))).rejects.toBeInstanceOf(SaglayiciHatasi);
    expect(c3).toHaveLength(1);
  });
});

describe("AI-99 iptalin sağlayıcıya taşınması", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("sağlayıcı isteği kullanıcı sinyaliyle kesilir; önceden durdurulmuşsa hiç gitmez", async () => {
    const fetchSahte = vi.fn((_u: string, init: RequestInit) => new Promise((_, ret) => init.signal!.addEventListener("abort", () => ret(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })));
    vi.stubGlobal("fetch", fetchSahte);
    const durdur = new AbortController();
    const istek = iptalSinyaliyle(durdur.signal, () => saglayiciIstegi("Test", "https://ai.example.com", {}, {}));
    setTimeout(() => durdur.abort(), 5);
    await expect(istek).rejects.toBeInstanceOf(AiIptalHatasi);
    expect(fetchSahte).toHaveBeenCalledTimes(1);
    await expect(iptalSinyaliyle(durdur.signal, () => saglayiciIstegi("Test", "https://ai.example.com", {}, {}))).rejects.toBeInstanceOf(AiIptalHatasi);
    expect(fetchSahte).toHaveBeenCalledTimes(1);
  });

  it("iptal yeniden denenmez, 'IPTAL' sınıfıyla izlenir; bekleme sırasında durdurma yeni denemeyi önler", async () => {
    expect(denemeKarari(new AiIptalHatasi(), d({ yedekVar: true }))).toBeNull();
    const cagrilar = saglayicilar({ ucuz: [firlat(new AiIptalHatasi())] });
    const { prisma, tx } = kur(AYAR);
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, "t", { ozellik: "ozet" }));
    await expect(olarak(() => saglayici.metinUret({ prompt: "x" }))).rejects.toBeInstanceOf(AiIptalHatasi);
    expect(cagrilar).toHaveLength(1);
    expect(tx.aiCagriIz.create.mock.calls[0][0].data).toMatchObject({ basarili: false, hataSinifi: "IPTAL" });

    const durdur = new AbortController();
    const c2 = saglayicilar({ ucuz: [() => { setTimeout(() => durdur.abort(), 5); throw h503(); }, () => "olmamalı"] });
    const k2 = kur(AYAR);
    const s2 = await olarak(() => kiraciSaglayicisi(k2.prisma as never, "t", { ozellik: "ozet" }));
    await expect(olarak(() => iptalSinyaliyle(durdur.signal, () => s2.saglayici.metinUret({ prompt: "x" })))).rejects.toBeInstanceOf(AiIptalHatasi);
    expect(c2).toHaveLength(1);
    expect(k2.tx.aiKullanim.upsert).toHaveBeenCalledTimes(1);
  });
});
