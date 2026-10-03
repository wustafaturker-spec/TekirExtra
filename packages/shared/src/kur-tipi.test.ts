import { describe, expect, it } from "vitest";
import { faturaKurTipi, hareketKurTipi } from "./kur-tipi";

describe("kur tipi kuralı (DVZ-09)", () => {
  it("alacak doğuran faturada alış, borç doğuranda satış kuru", () => {
    expect(faturaKurTipi("satis")).toBe("alis");
    expect(faturaKurTipi("alis_iade")).toBe("alis");
    expect(faturaKurTipi("proforma")).toBe("alis");
    expect(faturaKurTipi("alis")).toBe("satis");
    expect(faturaKurTipi("satis_iade")).toBe("satis");
  });
  it("faturayla ödemesi aynı kur türünü kullanır", () => {
    expect(hareketKurTipi("tahsilat")).toBe(faturaKurTipi("satis"));
    expect(hareketKurTipi("tediye")).toBe(faturaKurTipi("alis"));
    expect(hareketKurTipi("virman_gelis")).toBe("alis");
    expect(hareketKurTipi("virman_gidis")).toBe("satis");
  });
});
