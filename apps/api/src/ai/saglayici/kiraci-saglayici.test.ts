import { HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { kiraciSaglayicisi, ONAY_YOK_MESAJI } from "./kiraci-saglayici";
import { MockAiProvider } from "./mock-ai.provider";
import { AiProviderFactory } from "./ai-provider.factory";
import { AI_AKTARIM_POLITIKA_SURUMU } from "../ayarlar/ai-aktarim-politikasi";
import { AiBosYanitHatasi } from './ai-bos-yanit';

const TENANT = "t";

function kur(ayar: Record<string, unknown> | null, bugunToplam = 0) {
  const tx = {
    $executeRaw: vi.fn(),
    aiCagriIz: { create: vi.fn().mockResolvedValue({ id: "iz-1" }) },
    tenantAiAyari: { findUnique: vi.fn().mockResolvedValue(ayar), update: vi.fn() },
    aiKullanim: { aggregate: vi.fn().mockResolvedValue({ _sum: { cagri: bugunToplam } }), upsert: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (x: typeof tx) => unknown) => fn(tx)) };
  return { prisma, tx };
}
const olarak = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: TENANT, userId: "u1", rol: "muhasebe" } }, fn);

describe("kiracı sağlayıcısı: KVKK onayı ve kullanım sınırı (AI-14/15)", () => {
  it('boş yanıt başarısız ve güvenli neden koduyla kaydedilir; sayaç/maliyet kuralları korunur', async () => {
    const p = new MockAiProvider();
    vi.spyOn(p, 'aracliSohbet').mockRejectedValue(new AiBosYanitHatasi('gemini', { bitisKodu: 'MALFORMED_FUNCTION_CALL', engellemeKodu: null, adaySayisi: 1, parcaSayisi: 0 }));
    vi.spyOn(AiProviderFactory, 'uret').mockReturnValue(p);
    const { prisma, tx } = kur({ saglayici: 'mock' });
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, TENANT, { ozellik: 'asistan' }));
    await expect(olarak(() => saglayici.aracliSohbet({ sistemRol: 'test', mesajlar: [], araclar: [] }))).rejects.toBeInstanceOf(AiBosYanitHatasi);
    expect(tx.aiCagriIz.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ basarili: false, hataSinifi: 'AI_BOS_YANIT_MALFORMED_FUNCTION_CALL', maliyetUsd: null }) }));
    expect(tx.aiKullanim.upsert).toHaveBeenCalledTimes(1);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("dış sağlayıcı onaysız kullanılmaz (kiracı anahtarı ya da platform anahtarı)", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("BAGLANTI_SIFRELEME_ANAHTARI", "a".repeat(64));
    vi.stubEnv("GEMINI_API_KEY", "platform");
    const fetchSahte = vi.fn();
    vi.stubGlobal("fetch", fetchSahte);
    for (const ayar of [null, { saglayici: "openai", apiKey: "sk-x", yurtDisiOnayAt: null }]) {
      const { prisma } = kur(ayar);
      const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "asistan" }));
      expect(saglayici.saglayiciAdi).toBe("tanimsiz");
      await expect(saglayici.metinUret({ prompt: "x" })).rejects.toThrow(ONAY_YOK_MESAJI);
    }
    expect(fetchSahte).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("onay yalnız aynı sağlayıcı, model ve politika sürümü için geçerlidir", async () => {
    const dis = new MockAiProvider();
    Object.defineProperty(dis, "saglayiciAdi", { value: "openai" });
    Object.defineProperty(dis, "modelAdi", { value: "gpt-test" });
    vi.spyOn(AiProviderFactory, "uret").mockReturnValue(dis);
    const temelAyar = {
      saglayici: "openai", modelAdi: "gpt-test", yurtDisiOnayAt: new Date(),
      yurtDisiOnaySaglayici: "openai", yurtDisiOnayModel: "gpt-test", yurtDisiOnayPolitika: AI_AKTARIM_POLITIKA_SURUMU,
    };
    const gecerli = kur(temelAyar);
    const izinli = await olarak(() => kiraciSaglayicisi(gecerli.prisma as never, TENANT, { ozellik: "asistan" }));
    expect(izinli.saglayici.saglayiciAdi).toBe("openai");

    const eskiPolitika = kur({ ...temelAyar, yurtDisiOnayPolitika: "onceki-surum" });
    const engelli = await olarak(() => kiraciSaglayicisi(eskiPolitika.prisma as never, TENANT, { ozellik: "asistan" }));
    expect(engelli.saglayici.saglayiciAdi).toBe("tanimsiz");
    await expect(engelli.saglayici.metinUret({ prompt: "x" })).rejects.toThrow(ONAY_YOK_MESAJI);
  });

  it("Ollama'da basit ve karmaşık işleri ayrı modellere yönlendirir; harici onaylı modeli değiştirmez", async () => {
    const uretimler: unknown[] = [];
    vi.spyOn(AiProviderFactory, "uret").mockImplementation((config) => {
      uretimler.push(config);
      const provider = new MockAiProvider();
      const secim = typeof config === "object" && config ? config : {};
      Object.defineProperty(provider, "saglayiciAdi", { value: secim.saglayici ?? "ollama" });
      Object.defineProperty(provider, "modelAdi", { value: secim.modelAdi ?? null });
      return provider;
    });
    const yerelAyar = {
      saglayici: "ollama", modelAdi: "varsayilan:7b", ekonomikModelAdi: "hizli:3b", gucluModelAdi: "derin:14b",
    };
    const basit = kur(yerelAyar);
    await olarak(() => kiraciSaglayicisi(basit.prisma as never, TENANT, { ozellik: "ozet" }));
    const karmasik = kur(yerelAyar);
    await olarak(() => kiraciSaglayicisi(karmasik.prisma as never, TENANT, { ozellik: "asistan" }));
    expect((uretimler[0] as { modelAdi: string }).modelAdi).toBe("hizli:3b");
    expect((uretimler[1] as { modelAdi: string }).modelAdi).toBe("derin:14b");

    uretimler.length = 0;
    const disAyar = {
      saglayici: "openai", modelAdi: "gpt-onayli", ekonomikModelAdi: "gpt-ucuz", gucluModelAdi: "gpt-guclu",
      yurtDisiOnayAt: new Date(), yurtDisiOnaySaglayici: "openai", yurtDisiOnayModel: "gpt-onayli", yurtDisiOnayPolitika: AI_AKTARIM_POLITIKA_SURUMU,
    };
    const dis = kur(disAyar);
    await olarak(() => kiraciSaglayicisi(dis.prisma as never, TENANT, { ozellik: "asistan" }));
    expect((uretimler[0] as { modelAdi: string }).modelAdi).toBe("gpt-onayli");
  });

  it("onay varsa çalışır ve her çağrıyı kullanıcı + özellik bazında sayar", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { prisma, tx } = kur({ saglayici: "mock", yurtDisiOnayAt: new Date(), gunlukCagriSiniri: 10 });
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "ozet" }));
    await olarak(() => saglayici.metinUret({ prompt: "x" }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.aiKullanim.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId: TENANT, userId: "u1", ozellik: "ozet", cagri: 1 }),
      update: { cagri: { increment: 1 } },
    }));
    expect(tx.aiCagriIz.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ozellik: "ozet", saglayici: "mock", basarili: true, islem: "metin" }) }));
  });

  it("yönetici fiyatlarıyla token maliyetini içerik olmadan telemetriye yazar", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { prisma, tx } = kur({
      saglayici: "mock", yurtDisiOnayAt: new Date(),
      girisTokenMilyonUsd: new Prisma.Decimal(2), cikisTokenMilyonUsd: new Prisma.Decimal(8),
    });
    class TokenliMock extends MockAiProvider {
      sonKullanim?: { girisToken?: number; cikisToken?: number };
      override async metinUret(girdi: Parameters<MockAiProvider["metinUret"]>[0]) {
        this.sonKullanim = { girisToken: 2_000, cikisToken: 500 };
        return super.metinUret(girdi);
      }
    }
    vi.spyOn(AiProviderFactory, "uret").mockReturnValue(new TokenliMock());
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "ozet", varsayilan: () => new TokenliMock() }));
    await olarak(() => saglayici.metinUret({ prompt: "x" }));
    expect(tx.aiCagriIz.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ girisToken: 2_000, cikisToken: 500, maliyetUsd: 0.008 }),
    }));
  });

  it("günlük sınıra ulaşılınca 429 ile reddeder, sağlayıcıyı çağırmaz", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { prisma, tx } = kur({ saglayici: "mock", gunlukCagriSiniri: 5 }, 5);
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "asistan" }));
    const metinUret = vi.spyOn(MockAiProvider.prototype, "metinUret");
    const hata = await olarak(() => saglayici.metinUret({ prompt: "x" })).catch((e) => e);
    expect(hata).toBeInstanceOf(HttpException);
    expect(hata.getStatus()).toBe(429);
    expect(metinUret).not.toHaveBeenCalled();
    expect(tx.aiKullanim.upsert).not.toHaveBeenCalled();
  });

  it("tenant yayılım anahtarı kapalıysa sağlayıcıya çağrı yapmaz", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { prisma, tx } = kur({ saglayici: "mock", ozelliklerEtkin: false });
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "asistan" }));
    expect(saglayici.saglayiciAdi).toBe("tanimsiz");
    await expect(saglayici.metinUret({ prompt: "x" })).rejects.toThrow(/firma için.*kapatıldı/i);
    expect(tx.aiKullanim.upsert).not.toHaveBeenCalled();
    expect(tx.aiCagriIz.create).not.toHaveBeenCalled();
  });
});
