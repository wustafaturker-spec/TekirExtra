import { describe, expect, it } from "vitest";
import { anahtarEslesir, bankaWebhookSemasi } from "./banka-webhook.semalar";

describe("banka webhook doğrulaması", () => {
  it("erişim anahtarlarını güvenli biçimde karşılaştırır", () => {
    expect(anahtarEslesir("gizli-anahtar", "gizli-anahtar")).toBe(true);
    expect(anahtarEslesir("gizli-anahtar", "yanlis")).toBe(false);
  });
  it("sıfır tutarı ve geçersiz tarihi reddeder", () => {
    expect(bankaWebhookSemasi.safeParse({ hareketler: [{ id: "1", tarih: "2026-08-11", tutar: 125, aciklama: "Tahsilat" }] }).success).toBe(true);
    expect(bankaWebhookSemasi.safeParse({ hareketler: [{ id: "1", tarih: "11.08.2026", tutar: 0, aciklama: "Tahsilat" }] }).success).toBe(false);
  });
});
