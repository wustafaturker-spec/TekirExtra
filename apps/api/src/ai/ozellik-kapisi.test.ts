import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiOzellikKapaliHatasi, aiOzellikDenetle, aiOzellikDurumu, kapaliOzellikleriAyikla, ONBELLEK_MS, platformOnbelleginiSifirla } from "./ozellik-kapisi";
import { kiraciSaglayicisi } from "./saglayici/kiraci-saglayici";

const TENANT = "11111111-1111-1111-1111-111111111111";

function kur(durdurulan: string[], kapali: string[] | null) {
  const tx = {
    platformAiOzellikDurumu: { findMany: vi.fn(async () => durdurulan.map((ozellik) => ({ ozellik }))) },
    tenantAiAyari: { findUnique: vi.fn(async () => (kapali === null ? null : { kapaliOzellikler: kapali })), update: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { tx, prisma };
}

describe("AI-109 özellik kapısı", () => {
  beforeEach(() => platformOnbelleginiSifirla());
  afterEach(() => vi.useRealTimers());

  it("platform acil durdurması firma ayarından önce gelir; kapalı olmayan özellik açıktır", async () => {
    const { tx } = kur(["ocr"], ["ocr", "asistan"]);
    expect(await aiOzellikDurumu(tx as never, TENANT, "ocr")).toMatchObject({ kapali: true, kaynak: "platform" });
    expect(await aiOzellikDurumu(tx as never, TENANT, "asistan")).toMatchObject({ kapali: true, kaynak: "firma", mesaj: expect.stringContaining("Ayarlar › Yapay zekâ") });
    expect(await aiOzellikDurumu(tx as never, TENANT, "mcp")).toEqual({ kapali: false });
    // Ayar kaydı olmayan firma: her şey açık (platform durdurması hariç).
    expect(await aiOzellikDurumu(kur([], null).tx as never, TENANT, "asistan")).toEqual({ kapali: false });
  });

  it("kapalı özellik 503 ve ayırt edilebilir kodla durur; mesaj bekleyen işlerin korunduğunu söyler", async () => {
    const { prisma } = kur(["asistan_telegram"], []);
    const hata = await aiOzellikDenetle(prisma as never, TENANT, "asistan_telegram").catch((e: unknown) => e);
    expect(hata).toBeInstanceOf(AiOzellikKapaliHatasi);
    expect(hata).toBeInstanceOf(ServiceUnavailableException);
    expect((hata as AiOzellikKapaliHatasi).getStatus()).toBe(503);
    expect((hata as AiOzellikKapaliHatasi).getResponse()).toMatchObject({ kod: "AI_OZELLIK_KAPALI", ozellik: "asistan_telegram", kaynak: "platform" });
    expect((hata as Error).message).toMatch(/Bekleyen onaylarınız ve kuyruktaki işleriniz korunuyor/);
  });

  it("platform listesi süreçte önbellek süresince bir kez okunur; süre dolunca ya da sıfırlanınca yeniden okunur", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T10:00:00Z"));
    const { tx } = kur([], []);
    await aiOzellikDurumu(tx as never, TENANT, "asistan");
    await aiOzellikDurumu(tx as never, TENANT, "ocr");
    expect(tx.platformAiOzellikDurumu.findMany).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + ONBELLEK_MS + 1);
    await aiOzellikDurumu(tx as never, TENANT, "asistan");
    expect(tx.platformAiOzellikDurumu.findMany).toHaveBeenCalledTimes(2);
    platformOnbelleginiSifirla();
    await aiOzellikDurumu(tx as never, TENANT, "asistan");
    expect(tx.platformAiOzellikDurumu.findMany).toHaveBeenCalledTimes(3);
    expect(ONBELLEK_MS).toBeLessThanOrEqual(30_000);
  });

  it("OCR ve e-postadan teklif model çağrısı düzeyinde durur", async () => {
    const { prisma } = kur(["ocr"], ["teklif_otomasyonu"]);
    const ocr = await kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "tarama" });
    await expect(ocr.saglayici.metinUret("x")).rejects.toThrow(/Belge okuma \(OCR\) platform genelinde/);
    const teklif = await kiraciSaglayicisi(prisma as never, TENANT, { ozellik: "teklif" });
    await expect(teklif.saglayici.metinUret("x")).rejects.toThrow(/E-postadan teklif firmanızın/);
  });

  it("firma girdisi yalnız bilinen anahtarları tekil alır", () => {
    expect(kapaliOzellikleriAyikla(["ocr", "ocr", "yok", 3, "mcp"])).toEqual(["ocr", "mcp"]);
    expect(kapaliOzellikleriAyikla("ocr")).toEqual([]);
  });
});
