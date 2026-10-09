import { describe, expect, it } from "vitest";
import { yayinPlani, yururluktedir, type PlanKaydi } from "./yayin-plani";

const k601: PlanKaydi = { id: "k1", tur: "tevkifat_kodu", anahtar: "601", yururlukBaslangic: "2017-01-01", yururlukBitis: null };
const deger = { ad: "YAPIM İŞLERİ", oranlar: ["4/10"] };

describe("yayın planı (MVZ-02/05)", () => {
  it("değiştirmede açık kayıt bir gün önce kapanır, yeni kayıt yürürlükten başlar", () => {
    const plan = yayinPlani([k601], [{ tur: "tevkifat_kodu", anahtar: "601", islem: "degistir", deger }], "2024-03-01");
    expect(plan.hatalar).toEqual([]);
    expect(plan.kapat).toEqual([{ id: "k1", yururlukBitis: "2024-02-29" }]);
    expect(plan.ekle).toEqual([{ tur: "tevkifat_kodu", anahtar: "601", deger, yururlukBaslangic: "2024-03-01" }]);
  });

  it("eklemede açık kayıt olmamalı; kaldırmada yalnız kapatılır", () => {
    expect(yayinPlani([k601], [{ tur: "tevkifat_kodu", anahtar: "601", islem: "ekle", deger }], "2026-11-01").hatalar[0]).toMatch(/zaten yürürlükte/);
    const ekle = yayinPlani([], [{ tur: "tevkifat_kodu", anahtar: "628", islem: "ekle", deger: { ad: "YENİ", oranlar: ["3/10"] } }], "2026-11-01");
    expect(ekle.hatalar).toEqual([]);
    expect(ekle.ekle).toHaveLength(1);
    const kaldir = yayinPlani([k601], [{ tur: "tevkifat_kodu", anahtar: "601", islem: "kaldir", deger: null }], "2026-11-01");
    expect(kaldir).toMatchObject({ hatalar: [], ekle: [], kapat: [{ id: "k1", yururlukBitis: "2026-10-31" }] });
    expect(yayinPlani([], [{ tur: "tevkifat_kodu", anahtar: "601", islem: "degistir", deger }], "2026-11-01").hatalar[0]).toMatch(/"ekle" kullanın/);
  });

  it("yürürlük son başlangıçtan sonra olmalı (geçmişe ekleme yok)", () => {
    const kapali: PlanKaydi = { id: "k0", tur: "tevkifat_kodu", anahtar: "628", yururlukBaslangic: "2026-01-01", yururlukBitis: "2026-05-31" };
    expect(yayinPlani([k601], [{ tur: "tevkifat_kodu", anahtar: "601", islem: "degistir", deger }], "2017-01-01").hatalar[0]).toMatch(/sonra olmalıdır/);
    expect(yayinPlani([kapali], [{ tur: "tevkifat_kodu", anahtar: "628", islem: "ekle", deger: { ad: "X", oranlar: ["3/10"] } }], "2025-12-01").hatalar[0]).toMatch(/sonra olmalıdır/);
    expect(yayinPlani([kapali], [{ tur: "tevkifat_kodu", anahtar: "628", islem: "ekle", deger: { ad: "X", oranlar: ["3/10"] } }], "2026-07-01").hatalar).toEqual([]);
  });

  it("değer, tekrar ve boş liste denetlenir", () => {
    expect(yayinPlani([k601], [{ tur: "tevkifat_kodu", anahtar: "601", islem: "degistir", deger: { ad: "X", oranlar: ["11/10"] } }], "2026-11-01").hatalar[0]).toMatch(/geçersiz: 11\/10/);
    const iki = yayinPlani([k601], [
      { tur: "tevkifat_kodu", anahtar: "601", islem: "degistir", deger },
      { tur: "tevkifat_kodu", anahtar: "601", islem: "kaldir", deger: null },
    ], "2026-11-01");
    expect(iki.hatalar[0]).toMatch(/birden çok/);
    expect(yayinPlani([], [], "2026-11-01").hatalar[0]).toMatch(/en az bir satır/);
  });

  it("yürürlük aralığı uçları dahildir", () => {
    const k = { yururlukBaslangic: "2024-03-01", yururlukBitis: "2024-12-31" };
    expect(yururluktedir(k, "2024-03-01")).toBe(true);
    expect(yururluktedir(k, "2024-12-31")).toBe(true);
    expect(yururluktedir(k, "2025-01-01")).toBe(false);
    expect(yururluktedir({ ...k, yururlukBitis: null }, "2030-01-01")).toBe(true);
  });
});
