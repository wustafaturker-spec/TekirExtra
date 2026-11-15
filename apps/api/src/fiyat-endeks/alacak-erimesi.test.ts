import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { aySonDegeri, enEskiAy, erimeHesapla } from "./alacak-erimesi";

const D = (v: string) => new Prisma.Decimal(v);
const endeks = new Map([["2026-01-01", D("100")], ["2026-06-01", D("125")], ["2026-10-01", D("140")]]);
const t = (s: string) => new Date(`${s}T12:00:00+03:00`);

describe("END-19 alacağın erime maliyeti", () => {
  it("kayıp = tutar × (1 − E(doğuş)/E(bitiş)); açıklanmamış ayda son açıklanan değer", () => {
    // Ocak → Haziran: 1000 × (1 − 100/125) = 200. Ocak → Kasım (Kasım yok → Ekim 140): 1000 × (1 − 100/140) = 285,71.
    expect(erimeHesapla([{ dogus: t("2026-01-15"), bitis: t("2026-06-20"), tutar: "1000" }], endeks)).toMatchObject({ kayip: "200.00", kapsanan: "1000.00", disarida: 0, sonEndeksAyi: "2026-06-01" });
    expect(erimeHesapla([{ dogus: t("2026-01-15"), bitis: t("2026-11-15"), tutar: "1000" }], endeks).kayip).toBe("285.71");
  });
  it("endeksten önce doğan alacak dışarıda kalır ve sayılır; aynı ay kayıpsız", () => {
    expect(erimeHesapla([{ dogus: t("2025-12-01"), bitis: t("2026-06-01"), tutar: "500" }, { dogus: t("2026-06-03"), bitis: t("2026-06-28"), tutar: "300" }], endeks)).toMatchObject({ kayip: "0.00", kapsanan: "300.00", disarida: 1 });
  });
  it("yardımcılar", () => {
    expect(aySonDegeri(endeks, "2026-08-01")?.ay).toBe("2026-06-01");
    expect(aySonDegeri(endeks, "2025-12-01")).toBeNull();
    expect(enEskiAy([{ dogus: t("2026-03-02"), bitis: t("2026-04-01"), tutar: "1" }, { dogus: t("2026-01-31"), bitis: t("2026-04-01"), tutar: "1" }])).toBe("2026-01-01");
  });
});
