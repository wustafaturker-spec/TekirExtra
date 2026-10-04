import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { eksikGunKodu, puantajOku, puantajSablonu } from "./puantaj-excel";
import { PersonelService } from "./personel.service";

describe("puantaj Excel (PRS-16)", () => {
  it("şablon yazılıp okunduğunda değerler korunur; neden Türkçe adla da yazılabilir", async () => {
    const buf = await puantajSablonu(2026, 10, [{ personelNo: "PRS-000005", adSoyad: "Deneme Kıdem", istihdamGunu: 30, primGunu: 18, eksikGunNedeni: "Ücretsiz izin", fazlaMesaiBrut: 1500.5, primIkramiyeBrut: 0, nakitYemekYardimi: 3000, fiiliCalismaGunu: 18, sahisSigortaPrimi: 0, hayatSigortaPrimi: 0, sendikaAidati: 0, aciklama: "not" }]);
    const satirlar = await puantajOku(buf);
    expect(satirlar).toEqual([{ satir: 2, personelNo: "PRS-000005", primGunu: 18, eksikGunNedeni: "ucretsiz_izin", fazlaMesaiBrut: 1500.5, primIkramiyeBrut: 0, nakitYemekYardimi: 3000, fiiliCalismaGunu: 18, sahisSigortaPrimi: 0, hayatSigortaPrimi: 0, sendikaAidati: 0, aciklama: "not" }]);
    expect(eksikGunKodu("istirahat")).toBe("istirahat");
    expect(eksikGunKodu("")).toBeNull();
  });

  it("toplu onay her bordroyu tekil kurallardan geçirir; hata ötekini durdurmaz", async () => {
    const tx = { personelBordro: { findMany: vi.fn(async () => [
      { id: "b1", kalanTutar: new Prisma.Decimal(100), personel: { personelNo: "P1", ad: "A", soyad: "B" } },
      { id: "b2", kalanTutar: new Prisma.Decimal(100), personel: { personelNo: "P2", ad: "C", soyad: "D" } },
    ]) } };
    const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);
    const onayla = vi.spyOn(s, "bordroOnayla").mockImplementation(async (_t, id) => { if (id === "b2") throw new Error("Bordroyu hazırlayan kullanıcı aynı bordroyu onaylayamaz"); return {} as never; });
    const sonuc = await s.bordroToplu("t1", "u1", { islem: "onayla", bordroIdler: ["b1", "b2", "b3"] });
    expect(onayla).toHaveBeenCalledTimes(2);
    expect(sonuc.islenen).toBe(1);
    expect(sonuc.atlananlar.map((a) => [a.bordroId, a.mesaj])).toEqual([["b2", "Bordroyu hazırlayan kullanıcı aynı bordroyu onaylayamaz"], ["b3", "Bordro bulunamadı"]]);
  });
});
