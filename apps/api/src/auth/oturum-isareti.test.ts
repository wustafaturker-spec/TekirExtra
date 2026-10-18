import { afterEach, describe, expect, it, vi } from "vitest";
import { oturumIsaretiGecerli, oturumIsaretiSirri, oturumIsaretiUret } from "./oturum-isareti";

const SIR = "s".repeat(40);

describe("oturum işareti (rota koruması)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ürettiği işaret süresi içinde geçerli, sonra değil", () => {
    const simdi = 1_800_000_000;
    const isaret = oturumIsaretiUret(SIR, simdi);
    expect(isaret).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(oturumIsaretiGecerli(isaret, SIR, simdi + 60)).toBe(true);
    expect(oturumIsaretiGecerli(isaret, SIR, simdi + 31 * 24 * 3600)).toBe(false);
  });

  it("başka sırla, değiştirilmiş bitişle ya da bozuk biçimle geçmez", () => {
    const isaret = oturumIsaretiUret(SIR, 1_800_000_000);
    expect(oturumIsaretiGecerli(isaret, "b".repeat(40), 1_800_000_001)).toBe(false);
    const [, , imza] = isaret.split(".");
    expect(oturumIsaretiGecerli(`v1.9999999999.${imza}`, SIR, 1_800_000_001)).toBe(false);
    for (const bozuk of [undefined, "", "v1.1.x", "v2.1900000000." + imza, isaret + "a"]) expect(oturumIsaretiGecerli(bozuk, SIR, 1_800_000_001)).toBe(false);
  });

  it("sır tanımsız ya da 32 karakterden kısaysa işaret üretilmez", () => {
    vi.stubEnv("OTURUM_ISARETI_SECRET", "");
    expect(oturumIsaretiSirri()).toBeNull();
    vi.stubEnv("OTURUM_ISARETI_SECRET", "kisa");
    expect(oturumIsaretiSirri()).toBeNull();
    vi.stubEnv("OTURUM_ISARETI_SECRET", SIR);
    expect(oturumIsaretiSirri()).toBe(SIR);
  });
});
