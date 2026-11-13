import { describe, expect, it } from "vitest";
import { kirilimToplami, oranKirilimi } from "./fis-kirilim";

describe("oranKirilimi (AI-13)", () => {
  it("aynı oran birleşir, sıfır matrah atılır, orana göre sıralanır", () => {
    const k = oranKirilimi([
      { oran: 20, matrah: 500, kdvTutari: 100 },
      { oran: 10, matrah: 300, kdvTutari: 30 },
      { oran: 20, matrah: 200.105, kdvTutari: 40.02 },
      { oran: 1, matrah: 0, kdvTutari: 0 },
    ]);
    expect(k).toEqual([{ oran: 10, matrah: 300, kdvTutari: 30 }, { oran: 20, matrah: 700.11, kdvTutari: 140.02 }]);
    expect(kirilimToplami(k)).toBe(1170.13);
  });

  it("boş ya da eksik kırılım boş döner", () => {
    expect(oranKirilimi(undefined)).toEqual([]);
    expect(oranKirilimi([{ oran: Number.NaN, matrah: 10, kdvTutari: 1 }])).toEqual([]);
  });
});
