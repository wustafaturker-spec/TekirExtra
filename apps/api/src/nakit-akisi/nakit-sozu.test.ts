import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { faturaNakitDagilimi } from "./nakit-sozu";
import { nakitTahmini, senaryoTarihi, type NakitKalemi } from "./nakit-akisi.hesap";

const f = { id: "f", cariId: "c", dovizCinsi: "TRY", tip: "satis" };
const soz = { id: "s", faturaId: "f", cariId: "c", dovizCinsi: "TRY", tarih: "2026-10-20", kalan: "600.00" };
const vade = "2026-10-16";

describe("F02 nakit planında tek alacak", () => {
  it("1.600 kalan faturayı 600 söz payı ve 1.000 vade payına ayırır", () => {
    const paylar = faturaNakitDagilimi(f, "1600.00", vade, soz);
    expect(paylar).toMatchObject([{ tutar: "600.00", vade: soz.tarih, odemeSozu: { id: "s", faturaVadesi: vade } }, { tutar: "1000.00", vade }]);
    expect(paylar.reduce((t, p) => t.add(p.tutar), new Prisma.Decimal(0)).toFixed(2)).toBe("1600.00");
  });
  it("söz kalanı fatura kalanını aşarsa yeni alacak üretmez", () => {
    expect(faturaNakitDagilimi(f, "200.00", vade, soz)).toMatchObject([{ tutar: "200.00", vade: soz.tarih }]);
  });
  it("söz gerçekleşmişse kalan faturayı eski vadesinde bırakır", () => {
    expect(faturaNakitDagilimi(f, "1000.00", vade, { ...soz, kalan: "0.00" })).toEqual([{ tutar: "1000.00", vade, odemeSozu: undefined }]);
  });
  it("söz yokken mevcut alacağı ve kuruşu korur", () => {
    expect(faturaNakitDagilimi(f, "1000.01", vade)).toEqual([{ tutar: "1000.01", vade, odemeSozu: undefined }]);
    const paylar = faturaNakitDagilimi(f, "1000.01", vade, { ...soz, kalan: "600.02" });
    expect(paylar.map((p) => p.tutar)).toEqual(["600.02", "399.99"]);
  });
  it.each([{ cariId: "baska" }, { dovizCinsi: "USD" }, { faturaId: "baska" }, { kalan: "-1.00" }])("hatalı kaynakla tahmin üretmez: %j", (fark) => {
    expect(() => faturaNakitDagilimi(f, "1000.00", vade, { ...soz, ...fark })).toThrow();
  });
  it("alış veya iade faturasına söz taşımaz", () => {
    expect(() => faturaNakitDagilimi({ ...f, tip: "alis" }, "1000.00", vade, soz)).toThrow();
  });
  const kalem: NakitKalemi = { kaynak: "fatura", kaynakId: "f", yon: "giris", vade: soz.tarih, odemeSozu: { id: "s", tarih: soz.tarih, faturaVadesi: "2026-01-01" }, kurus: 60000, dovizCinsi: "TRY", dovizTutar: 600, aciklama: "Söz payı", cariId: "c", cariUnvan: "Cari", tahmin: false, tahsilat: true, baglanti: null };
  it("yeni söz tarihi kötümserde 90 günlük eski fatura riskini gizlemez", () => {
    expect(senaryoTarihi(kalem, "kotumser", undefined, vade).tarih).toBeNull();
    expect(senaryoTarihi(kalem, "baz", { gecikmeGun: 2, karaListe: false }, vade).tarih).toBe("2026-10-22");
  });
  it("ufuk dışı söz payını bugünün tahsilatı saymaz", () => {
    const sonuc = nakitTahmini({ bugun: vade, ufukGun: 7, baslangicKurus: 0, kalemler: [{ ...kalem, vade: "2026-11-01" }], profiller: new Map() });
    expect(sonuc.senaryolar.iyimser.toplamGiris).toBe(0);
  });
  it("kara liste söz verilse de kötümser tahsilata alınmaz", () => {
    expect(senaryoTarihi(kalem, "kotumser", { gecikmeGun: 0, karaListe: true }, vade).tarih).toBeNull();
  });
});
