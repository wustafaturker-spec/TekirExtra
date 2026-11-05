import { describe, expect, it } from "vitest";
import { donemFarki } from "./platform-istatistikleri";
describe("istatistik dönem karşılaştırması", () => {
  it("eksik, devam eden ve sıfır paydalı dönemde yanıltıcı yüzde üretmez", () => {
    expect(donemFarki(null, 0, false)).toContain("ölçüm eksik");
    expect(donemFarki(1, 1, true)).toContain("yüzde karşılaştırması yok");
    expect(donemFarki(4, 0, false)).toBe("Önceki dönemde kayıt yok");
    expect(donemFarki(0, 0, false)).toBe("Önceki dönemle aynı");
  });
  it("tamamlanmış ölçümde işaretli farkı hesaplar", () => {
    expect(donemFarki(3, 2, false)).toContain("+50%");
    expect(donemFarki(1, 2, false)).toContain("-50%");
  });
});
