import { generateSecret, generateSync } from "otplib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { totpDogrula } from "./totp-dogrula";

describe("TOTP doğrulama toleransı", () => {
  afterEach(() => vi.useRealTimers());

  it("pencere sınırında yazılan kod (bir önceki adım) kabul edilir; iki adım önceki ve yanlış kod reddedilir", () => {
    const secret = generateSecret();
    const simdi = 1_793_000_000; // pencere başı (30'un katı)
    vi.useFakeTimers();
    vi.setSystemTime(simdi * 1000 + 500);
    const kod = (saniyeOnce: number) => generateSync({ secret, epoch: simdi - saniyeOnce });
    expect(totpDogrula(secret, kod(0))).toBe(true);
    expect(totpDogrula(secret, kod(1))).toBe(true); // önceki pencerenin son saniyesi
    expect(totpDogrula(secret, kod(61))).toBe(false);
    const gecerliler = new Set([kod(-30), kod(0), kod(30)]);
    const yanlis = ["000000", "111111", "222222"].find((k) => !gecerliler.has(k))!;
    expect(totpDogrula(secret, yanlis)).toBe(false);
  });
});
