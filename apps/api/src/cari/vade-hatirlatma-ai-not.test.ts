import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";

const metinUret = vi.fn();
vi.mock("../ai/saglayici/kiraci-saglayici", () => ({
  kiraciSaglayicisi: vi.fn(async () => ({ saglayici: { saglayiciAdi: "gemini", metinUret }, ozelTalimatlar: null })),
}));

const { VadeHatirlatmaService } = await import("./vade-hatirlatma.service");

describe("hatırlatma notu taslağı (AI-20)", () => {
  function kur() {
    const tx = { tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "TEKİR" }) } };
    const s = new VadeHatirlatmaService({ tenantIslem: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) } as never, {} as never, {} as never);
    return { s, olarak: <T>(fn: () => Promise<T>) => istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: "muhasebe" } }, fn) };
  }

  it("çok cari seçiliyse alıcıya özel bilgi istemez; ihtarda tonu değişir; biçim işaretleri temizlenir", async () => {
    metinUret.mockResolvedValueOnce("**Değerli** müşterimiz,  ödemenizi rica ederiz.");
    const { s, olarak } = kur();
    const y = await olarak(() => s.yapayZekaNotu({ cariIdler: ["a", "b"], kademe: "ihtar" }));
    expect(y.not).toBe("Değerli müşterimiz, ödemenizi rica ederiz.");
    const istek = metinUret.mock.calls[0][0];
    expect(istek.prompt).toContain("alıcıya özel bilgi kullanma");
    expect(istek.prompt).toContain("ihtar");
    expect(istek.sistemRol).toContain("tutar, tarih ya da fatura numarası yazma");
  });

  it("boş yanıtta hata verir", async () => {
    metinUret.mockResolvedValueOnce("  ");
    const { s, olarak } = kur();
    await expect(olarak(() => s.yapayZekaNotu({ cariIdler: ["a", "b"], kademe: "hatirlatma" }))).rejects.toThrow(/üretilemedi/);
  });
});
