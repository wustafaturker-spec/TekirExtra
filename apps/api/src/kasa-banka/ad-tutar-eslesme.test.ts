import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { tutarEslesmesiBul, type EslesmeFaturasi } from "./ad-tutar-eslesme";

const D = (x: string | number) => new Prisma.Decimal(x);
const f = (id: string, kalan: string, vade: string | null, dovizCinsi = "TRY"): EslesmeFaturasi => ({ id, no: id.toUpperCase(), tarih: "2026-09-01", vadeTarihi: vade, dovizCinsi, kalan });

describe("ad + tutar eşleşmesi (KSB-45)", () => {
  const faturalar = [f("c", "300.00", "2026-10-20"), f("a", "1000.00", "2026-10-01"), f("b", "500.00", "2026-10-10")];

  it("tek faturanın kalanı tutuyorsa o fatura", () => {
    expect(tutarEslesmesiBul(faturalar, null, D(500), true, "TRY")).toEqual({ tur: "tek_fatura", dagitim: [{ faturaId: "b", tutar: "500.00" }], aciklama: "B kalanı tutarla aynı" });
  });
  it("aynı kalanlı iki fatura belirsizdir", () => {
    expect(tutarEslesmesiBul([...faturalar, f("d", "500.00", "2026-11-01")], null, D(500), true, "TRY")).toBeNull();
  });
  it("en eski vadeden ardışık faturaların toplamı tutuyorsa onlar (birkaç faturayı kapatan ödeme)", () => {
    expect(tutarEslesmesiBul(faturalar, null, D(1500), true, "TRY")).toMatchObject({ tur: "ardisik_faturalar", dagitim: [{ faturaId: "a", tutar: "1000.00" }, { faturaId: "b", tutar: "500.00" }] });
    expect(tutarEslesmesiBul(faturalar, null, D(1800), true, "TRY")?.dagitim.map((x) => x.faturaId)).toEqual(["a", "b", "c"]);
    // Ardışık olmayan toplam (a + c) tahmin edilmez.
    expect(tutarEslesmesiBul(faturalar, null, D(1300), true, "TRY")).toBeNull();
  });
  it("toplam bakiyeyi kapatıyorsa en eski faturalardan dağıtır; artan avans kalır", () => {
    const t = tutarEslesmesiBul(faturalar, D(2000), D(2000), true, "TRY");
    expect(t).toMatchObject({ tur: "bakiye", dagitim: [{ faturaId: "a", tutar: "1000.00" }, { faturaId: "b", tutar: "500.00" }, { faturaId: "c", tutar: "300.00" }] });
    // Çıkışta borcumuz (eksi bakiye) kapanır; yön tutmazsa eşleşme yok.
    expect(tutarEslesmesiBul([], D(-750), D(750), false, "TRY")).toMatchObject({ tur: "bakiye", dagitim: [] });
    expect(tutarEslesmesiBul([], D(750), D(750), false, "TRY")).toBeNull();
  });
  it("kısmi ödeme ve başka dövizdeki fatura eşleşme sayılmaz", () => {
    expect(tutarEslesmesiBul(faturalar, D(1800), D(250), true, "TRY")).toBeNull();
    expect(tutarEslesmesiBul([f("u", "500.00", "2026-10-01", "USD")], D(500), D(500), true, "TRY")).toMatchObject({ tur: "bakiye", dagitim: [] });
    expect(tutarEslesmesiBul([f("u", "500.00", "2026-10-01", "USD")], null, D(500), true, "TRY")).toBeNull();
  });
});
