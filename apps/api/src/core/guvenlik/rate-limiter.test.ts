import { describe, expect, it } from "vitest";
import { DagitikRateLimiter } from "./rate-limiter";

describe("DagitikRateLimiter", () => {
  it("pencere içinde limiti uygular ve yeni pencerede sıfırlar", async () => {
    const limiter = await DagitikRateLimiter.olustur(2, 1_000);
    expect(await limiter.tuket("ip", 10_000)).toMatchObject({ izinli: true, kalan: 1, kaynak: "bellek" });
    expect(await limiter.tuket("ip", 10_100)).toMatchObject({ izinli: true, kalan: 0 });
    expect(await limiter.tuket("ip", 10_200)).toMatchObject({ izinli: false, kalan: 0, sifirlamaMs: 11_000 });
    expect(await limiter.tuket("ip", 11_000)).toMatchObject({ izinli: true, kalan: 1 });
  });
});
