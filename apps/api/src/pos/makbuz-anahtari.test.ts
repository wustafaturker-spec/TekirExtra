import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anahtarOzeti, makbuzAnahtari, makbuzAnahtariGecerli, makbuzYolu } from "./makbuz-anahtari";
import { gizliYolMaskele } from "../core/observability/exception.filter";

const T = "11111111-1111-4111-8111-111111111111", A = "22222222-2222-4222-8222-222222222222", B = "33333333-3333-4333-8333-333333333333";

describe("SEC-23 makbuz bağlantı anahtarı", () => {
  beforeEach(() => vi.stubEnv("BAGLANTI_SIFRELEME_ANAHTARI", "ab".repeat(32)));
  afterEach(() => vi.unstubAllEnvs());

  it("anahtar saklanmadan türetilir: kalıcıdır, tahsilata ve firmaya özgüdür", () => {
    const k = makbuzAnahtari(T, A);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(makbuzAnahtari(T, A)).toBe(k);
    expect(makbuzAnahtari(T, B)).not.toBe(k);
    expect(makbuzAnahtari(B, A)).not.toBe(k);
    expect(makbuzYolu(T, A)).toBe(`/pos/makbuz/${T}/${A}/${k}`);
    expect(makbuzAnahtariGecerli(T, A, k, null)).toBe(true);
    expect(makbuzAnahtariGecerli(T, B, k, null)).toBe(false);
  });

  it("sunucu sırrı değişirse eski türetilmiş anahtar geçmez (veritabanı tek başına yetmez)", () => {
    const k = makbuzAnahtari(T, A);
    vi.stubEnv("BAGLANTI_SIFRELEME_ANAHTARI", "cd".repeat(32));
    expect(makbuzAnahtariGecerli(T, A, k, null)).toBe(false);
  });

  it("2026-11-15 öncesi bağlantı saklanan özetle doğrulanır; biçimsiz ya da yanlış anahtar reddedilir", () => {
    const eski = "e".repeat(64);
    expect(makbuzAnahtariGecerli(T, A, eski, anahtarOzeti(eski))).toBe(true);
    expect(makbuzAnahtariGecerli(T, A, "f".repeat(64), anahtarOzeti(eski))).toBe(false);
    expect(makbuzAnahtariGecerli(T, A, "kısa", anahtarOzeti(eski))).toBe(false);
    expect(makbuzAnahtariGecerli(T, A, makbuzAnahtari(T, A).toUpperCase(), null)).toBe(false);
  });

  it("günlüğe yazılan yolda anahtar maskelenir; diğer yollar değişmez", () => {
    expect(gizliYolMaskele(`/api/v1${makbuzYolu(T, A)}`)).toBe(`/api/v1/pos/makbuz/${T}/${A}/***`);
    expect(gizliYolMaskele("/api/v1/pos/tahsilatlar")).toBe("/api/v1/pos/tahsilatlar");
  });
});
