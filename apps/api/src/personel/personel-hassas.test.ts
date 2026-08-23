import { beforeEach, describe, expect, it } from "vitest";
import { hassasCoz, hassasSifrele, ibanMaskele, tcknMaskele } from "./personel-hassas";
describe("personel hassas veri zarfı", () => {
  beforeEach(() => { process.env.BAGLANTI_SIFRELEME_ANAHTARI = "ab".repeat(32); });
  it("sürümlü zarfı şifreler ve çözer", () => { const v = hassasSifrele("10000000146")!; expect(v).toMatch(/^enc:v1:/); expect(hassasCoz(v)).toBe("10000000146"); });
  it("eski düz metni geçiş süresince okuyabilir", () => expect(hassasCoz("10000000146")).toBe("10000000146"));
  it("değerleri güvenli maskeler", () => { expect(tcknMaskele("10000000146")).toBe("*******0146"); expect(ibanMaskele("TR100000000000000000000000")).toBe("TR10 •••• •••• 0000"); });
});
