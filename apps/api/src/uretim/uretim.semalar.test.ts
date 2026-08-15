import { describe, expect, it } from "vitest";
import { uretimTamamlaSemasi } from "./uretim.semalar";

describe("uretimTamamlaSemasi", () => {
  it("çoklu ve benzersiz seri numaralarını kabul eder", () => {
    const sonuc = uretimTamamlaSemasi.safeParse({ seriNumaralari: ["SR-001", "SR-002"] });
    expect(sonuc.success).toBe(true);
  });

  it("yinelenen seri numaralarını reddeder", () => {
    const sonuc = uretimTamamlaSemasi.safeParse({ seriNumaralari: ["SR-001", "SR-001"] });
    expect(sonuc.success).toBe(false);
  });

  it("eski tek seri alanıyla çoklu alan arasındaki tekrarı reddeder", () => {
    const sonuc = uretimTamamlaSemasi.safeParse({ seriNo: "SR-001", seriNumaralari: ["SR-001"] });
    expect(sonuc.success).toBe(false);
  });
});
