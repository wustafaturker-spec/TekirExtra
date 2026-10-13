import { HttpException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../../core/istek-baglami";
import { kiraciSaglayicisi, ONAY_YOK_MESAJI } from "./kiraci-saglayici";
import { MockAiProvider } from "./mock-ai.provider";

const TENANT = "t";

function kur(ayar: Record<string, unknown> | null, bugunToplam = 0) {
  const tx = {
    tenantAiAyari: { findUnique: vi.fn().mockResolvedValue(ayar), update: vi.fn() },
    aiKullanim: { aggregate: vi.fn().mockResolvedValue({ _sum: { cagri: bugunToplam } }), upsert: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (x: typeof tx) => unknown) => fn(tx)) };
  return { prisma, tx };
}
const olarak = <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: TENANT, userId: "u1", rol: "muhasebe" } }, fn);

describe("kiracı sağlayıcısı: KVKK onayı ve kullanım sınırı (AI-14/15)", () => {
  afterEach(() => vi.unstubAllEnvs());

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

  it("onay varsa çalışır ve her çağrıyı kullanıcı + özellik bazında sayar", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const { prisma, tx } = kur({ saglayici: "mock", yurtDisiOnayAt: new Date(), gunlukCagriSiniri: 10 });
    const { saglayici } = await olarak(() => kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "ozet" }));
    await olarak(() => saglayici.metinUret({ prompt: "x" }));
    expect(tx.aiKullanim.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId: TENANT, userId: "u1", ozellik: "ozet", cagri: 1 }),
      update: { cagri: { increment: 1 } },
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
});
