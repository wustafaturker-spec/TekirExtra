import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { gunlukHareketNetleri, gunSonuBakiyesi, mutabakatHesapla, type MutabakatSatiri } from "./ekstre-mutabakat";

const D = (d: string) => new Prisma.Decimal(d);
const satir = (tarih: string, tutar: string, bakiye: string | null, durum: MutabakatSatiri["durum"] = "eslesti"): MutabakatSatiri =>
  ({ tarih: new Date(tarih), tutar: D(tutar), bakiye: bakiye === null ? null : D(bakiye), durum });

describe("banka bakiyesi mutabakatı (KSB-06)", () => {
  it("gün sonu bakiyesini satır sırasından bağımsız bulur", () => {
    // Gün başı 1.000; +500, -200 → gün sonu 1.300. Dosya azalan sırada.
    const azalan = [satir("2026-10-01", "-200", "1300"), satir("2026-10-01", "500", "1500")];
    expect(gunSonuBakiyesi(azalan)?.toFixed(2)).toBe("1300.00");
    expect(gunSonuBakiyesi([...azalan].reverse())?.toFixed(2)).toBe("1300.00");
  });

  it("farkın başladığı günü ve bekleyen satırlarla açıklanan kısmı verir", () => {
    const satirlar = [
      satir("2026-10-01", "1000", "1000"),
      satir("2026-10-02", "-12.50", "987.50", "beklemede"),
      satir("2026-10-03", "300", "1287.50"),
    ];
    const hareketler = [
      { tarih: new Date("2026-10-01"), tip: "tahsilat", tutar: D("1000") },
      { tarih: new Date("2026-10-03"), tip: "tahsilat", tutar: D("300") },
    ];

    const sonuc = mutabakatHesapla(satirlar, hareketler);

    expect(sonuc.son).toMatchObject({ tarih: "2026-10-03", banka: "1287.50", sistem: "1300.00", fark: "-12.50", bekleyen: "-12.50" });
    expect(sonuc.farkBaslangici).toBe("2026-10-02");
    expect(sonuc.aciklanmayanFark).toBe("0.00");
  });

  it("ilk günden beri sabit farkı açılış bakiyesi eksikliği olarak işaretler", () => {
    const sonuc = mutabakatHesapla([satir("2026-10-01", "100", "5100"), satir("2026-10-02", "50", "5150")], [
      { tarih: new Date("2026-10-01"), tip: "tahsilat", tutar: D("100") },
      { tarih: new Date("2026-10-02"), tip: "tahsilat", tutar: D("50") },
    ]);
    expect(sonuc.acilisBakiyesiEksikOlabilir).toBe(true);
    expect(sonuc.son?.fark).toBe("5000.00");
  });

  it("bekleyen satırlar değişse de sabit kalan açıklanamayan farkı açılış eksikliği sayar", () => {
    const sonuc = mutabakatHesapla([satir("2026-10-01", "100", "5100", "beklemede"), satir("2026-10-02", "50", "5150")], [
      { tarih: new Date("2026-10-02"), tip: "tahsilat", tutar: D("50") },
    ]);
    expect(sonuc.acilisBakiyesiEksikOlabilir).toBe(true);
    expect(sonuc.aciklanmayanFark).toBe("5000.00");
  });
});

describe("gün başına net hareket (V-2)", () => {
  it("gün toplamı satır satır hesapla aynı sonucu verir; işaret tipe çevrilir", async () => {
    const t = (g: string) => new Date(`${g}T00:00:00Z`);
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ tarih: t("2026-11-01"), net: "150.00" }, { tarih: t("2026-11-02"), net: "-70.00" }]) };
    const netler = await gunlukHareketNetleri(tx as never, "t1", "h1");
    expect(netler.map((n) => [n.tip, n.tutar.toFixed(2)])).toEqual([["tahsilat", "150.00"], ["tediye", "70.00"]]);
    const satirlar = [
      { tarih: t("2026-11-01"), tutar: D("150.00"), bakiye: D("150.00"), durum: "eslesti" as const },
      { tarih: t("2026-11-02"), tutar: D("-70.00"), bakiye: D("80.00"), durum: "eslesti" as const },
    ];
    const tekTek = [
      { tarih: t("2026-11-01"), tip: "tahsilat", tutar: D("200.00") }, { tarih: t("2026-11-01"), tip: "virman_gidis", tutar: D("50.00") },
      { tarih: t("2026-11-02"), tip: "tediye", tutar: D("100.00") }, { tarih: t("2026-11-02"), tip: "virman_gelis", tutar: D("30.00") },
    ];
    expect(mutabakatHesapla(satirlar, netler)).toEqual(mutabakatHesapla(satirlar, tekTek));
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["t1", "h1"]);
  });
});
