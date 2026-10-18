import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { guvenliDonus, oturumIsaretiGecerli } from "./oturum-isareti";

const SIR = "s".repeat(40);
/** API'nin ürettiği biçim (apps/api/src/auth/oturum-isareti.ts) — iki taraf aynı imzayı kabul etmeli. */
const apiUret = (bitis: number, sir = SIR) => `v1.${bitis}.${createHmac("sha256", sir).update(`v1.${bitis}`).digest("base64url")}`;

describe("oturum işareti doğrulaması (web)", () => {
  it("API'nin ürettiği işareti süresi içinde kabul eder", async () => {
    expect(await oturumIsaretiGecerli(apiUret(2_000_000_000), SIR, 1_900_000_000)).toBe(true);
  });

  it("süresi dolmuş, başka sırla imzalı ya da bozuk işareti reddeder", async () => {
    expect(await oturumIsaretiGecerli(apiUret(1_900_000_000), SIR, 1_900_000_001)).toBe(false);
    expect(await oturumIsaretiGecerli(apiUret(2_000_000_000, "b".repeat(40)), SIR, 1_900_000_000)).toBe(false);
    const imza = apiUret(2_000_000_000).split(".")[2];
    expect(await oturumIsaretiGecerli(`v1.2100000000.${imza}`, SIR, 1_900_000_000)).toBe(false);
    for (const bozuk of [undefined, "", "v1.x.y", "abc"]) expect(await oturumIsaretiGecerli(bozuk, SIR, 1_900_000_000)).toBe(false);
  });

  it("dönüş adresi yalnız panel içi göreli yol olabilir", () => {
    expect(guvenliDonus("/panel/belgeler?odak=1")).toBe("/panel/belgeler?odak=1");
    for (const kotu of [null, "", "/", "https://kotu.example/panel", "//kotu.example/panel", "/giris", "/panel\\..\\x", "/panel\r\nSet-Cookie:x"]) expect(guvenliDonus(kotu)).toBe("/panel");
  });
});
