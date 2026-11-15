import { describe, expect, it } from "vitest";
import { anahtarOzeti, makbuzAnahtari, makbuzAnahtariGecerli, makbuzSirlariniOku, makbuzYolu } from "./makbuz-anahtari";
import { gizliYolMaskele } from "../core/observability/exception.filter";
import { createHmac } from "node:crypto";

const T = "11111111-1111-4111-8111-111111111111", A = "22222222-2222-4222-8222-222222222222", B = "33333333-3333-4333-8333-333333333333";
const S1 = "ab".repeat(32), S2 = "cd".repeat(32), SIFRELEME = "ef".repeat(32);
const halka = (deger: string) => makbuzSirlariniOku({ MAKBUZ_ANAHTAR_SIRLARI: deger });

describe("SEC-23 makbuz bağlantı anahtarı (sürümlü sır)", () => {
  it("anahtar saklanmadan en yeni sürümle türetilir; kalıcı, tahsilata ve firmaya özgüdür", () => {
    const h = halka(`v2:${S2},v1:${S1}`);
    const k = makbuzAnahtari(T, A, h);
    expect(k).toMatch(/^v2\.[0-9a-f]{64}$/);
    expect(makbuzAnahtari(T, A, h)).toBe(k);
    expect(makbuzAnahtari(T, B, h)).not.toBe(k);
    expect(makbuzAnahtari(B, A, h)).not.toBe(k);
    expect(makbuzAnahtariGecerli(T, A, k, null, h)).toBe(true);
    expect(makbuzAnahtariGecerli(T, B, k, null, h)).toBe(false);
  });

  it("sır yenilenince eski sürüm listede kaldıkça eski bağlantı çalışır; listeden çıkınca çalışmaz", () => {
    const eskiBaglanti = makbuzAnahtari(T, A, halka(`v1:${S1}`));
    expect(makbuzAnahtariGecerli(T, A, eskiBaglanti, null, halka(`v2:${S2},v1:${S1}`))).toBe(true);
    expect(makbuzAnahtariGecerli(T, A, eskiBaglanti, null, halka(`v2:${S2}`))).toBe(false);
    // Aynı sürüm adı farklı sırla taklit edilemez.
    expect(makbuzAnahtariGecerli(T, A, eskiBaglanti, null, halka(`v1:${S2}`))).toBe(false);
  });

  it("şifreleme anahtarının değişmesi makbuz bağlantılarını etkilemez", () => {
    const h = halka(`v1:${S1}`);
    const k = makbuzAnahtari(T, A, h);
    const yeniOrtam = makbuzSirlariniOku({ MAKBUZ_ANAHTAR_SIRLARI: `v1:${S1}`, BAGLANTI_SIFRELEME_ANAHTARI: SIFRELEME });
    expect(makbuzAnahtariGecerli(T, A, k, null, yeniOrtam)).toBe(true);
  });

  it("geçiş: 2026-11-15'in öneksiz anahtarı v1 sırrıyla, daha eski rastgele anahtar özetle doğrulanır", () => {
    // 2026-11-15 sürümü: HMAC(şifreleme anahtarı, "pos-makbuz-v1:firma:tahsilat"), öneksiz.
    const oneksiz = createHmac("sha256", Buffer.from(S1, "hex")).update(`pos-makbuz-v1:${T}:${A}`).digest("hex");
    expect(makbuzAnahtariGecerli(T, A, oneksiz, null, halka(`v2:${S2},v1:${S1}`))).toBe(true);
    // Ayrı sır tanımsız geliştirme ortamında da aynı (v1 = şifreleme anahtarı).
    expect(makbuzAnahtariGecerli(T, A, oneksiz, null, makbuzSirlariniOku({ BAGLANTI_SIFRELEME_ANAHTARI: S1 }))).toBe(true);
    const eski = "e".repeat(64);
    expect(makbuzAnahtariGecerli(T, A, eski, anahtarOzeti(eski), halka(`v1:${S1}`))).toBe(true);
    expect(makbuzAnahtariGecerli(T, A, "f".repeat(64), anahtarOzeti(eski), halka(`v1:${S1}`))).toBe(false);
    expect(makbuzAnahtariGecerli(T, A, "v9." + "a".repeat(64), null, halka(`v1:${S1}`))).toBe(false);
    expect(makbuzAnahtariGecerli(T, A, "kısa", null, halka(`v1:${S1}`))).toBe(false);
  });

  it("biçimsiz sır listesi reddedilir ve hata metninde sır görünmez", () => {
    for (const kotu of ["v1", `v1:${S1}:x`, `1:${S1}`, `v1:${"0".repeat(64)}`, `v1:${S1},v1:${S2}`]) {
      let mesaj = "";
      try { halka(kotu); } catch (h) { mesaj = (h as Error).message; }
      expect(mesaj).toMatch(/MAKBUZ_ANAHTAR_SIRLARI/);
      expect(mesaj).not.toContain(S1);
    }
  });

  it("günlüğe yazılan yolda anahtar maskelenir", () => {
    process.env.MAKBUZ_ANAHTAR_SIRLARI = `v1:${S1}`;
    expect(gizliYolMaskele(`/api/v1${makbuzYolu(T, A)}`)).toBe(`/api/v1/pos/makbuz/${T}/${A}/***`);
    expect(gizliYolMaskele("/api/v1/pos/tahsilatlar")).toBe("/api/v1/pos/tahsilatlar");
    delete process.env.MAKBUZ_ANAHTAR_SIRLARI;
  });
});
