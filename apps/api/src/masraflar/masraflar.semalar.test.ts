import { describe, expect, it } from "vitest";
import { kategoriOlusturSemasi, kiraDonemOlusturSemasi, kiraSozlesmeOlusturSemasi, masrafOdemeSemasi, masrafOlusturSemasi } from "./masraflar.semalar";

const temel = {
  kategoriId: "550e8400-e29b-41d4-a716-446655440000",
  belgeTuru: "fis",
  tarih: "2026-08-12",
  matrah: 100,
  kdvOrani: 20,
  kdvTutari: 20,
  toplam: 120,
  dovizCinsi: "TRY",
} as const;

describe("masraf şemaları", () => {
  it("cari olmadan satıcı adıyla masraf kabul eder", () => {
    const sonuc = masrafOlusturSemasi.safeParse({ ...temel, cariId: null, saticiUnvan: "Örnek Market" });
    expect(sonuc.success).toBe(true);
  });

  it("cari seçilmişse satıcı adını zorunlu tutmaz", () => {
    const sonuc = masrafOlusturSemasi.safeParse({ ...temel, cariId: "550e8400-e29b-41d4-a716-446655440001" });
    expect(sonuc.success).toBe(true);
  });

  it("cari ve satıcı adı birlikte yoksa reddeder", () => {
    expect(masrafOlusturSemasi.safeParse(temel).success).toBe(false);
  });

  it("matrah ve KDV ile uyuşmayan toplamı reddeder", () => {
    expect(masrafOlusturSemasi.safeParse({ ...temel, saticiUnvan: "Market", toplam: 125 }).success).toBe(false);
  });

  it("ödemede tam olarak bir finans hesabı ister", () => {
    expect(masrafOdemeSemasi.safeParse({ kasaId: "550e8400-e29b-41d4-a716-446655440001", odemeTarihi: "2026-08-12", tutar: 500 }).success).toBe(true);
    expect(masrafOdemeSemasi.safeParse({ krediKartiId: "550e8400-e29b-41d4-a716-446655440001", odemeTarihi: "2026-08-12", tutar: 500, taksitSayisi: 3, ilkTaksitTarihi: "2026-09-01" }).success).toBe(true);
    expect(masrafOdemeSemasi.safeParse({ odemeTarihi: "2026-08-12", tutar: 500 }).success).toBe(false);
    expect(masrafOdemeSemasi.safeParse({ kasaId: "550e8400-e29b-41d4-a716-446655440001", krediKartiId: "550e8400-e29b-41d4-a716-446655440002", odemeTarihi: "2026-08-12", tutar: 500 }).success).toBe(false);
    expect(masrafOdemeSemasi.safeParse({ kasaId: "550e8400-e29b-41d4-a716-446655440001", odemeTarihi: "2026-08-12", tutar: 0 }).success).toBe(false);
  });

  it("cari olmadan kiraya veren adıyla sözleşme kabul eder", () => {
    expect(kiraSozlesmeOlusturSemasi.safeParse({ kategoriId: temel.kategoriId, baslik: "Merkez ofis", kirayaVeren: "Ev Sahibi", baslangicTarihi: "2026-01-01", odemeGunu: 5, matrah: 10000, kdvOrani: 0, stopajOrani: 20, dovizCinsi: "TRY" }).success).toBe(true);
  });

  it("kira dönemini YYYY-AA biçiminde doğrular", () => {
    expect(kiraDonemOlusturSemasi.safeParse({ donem: "2026-08" }).success).toBe(true);
    expect(kiraDonemOlusturSemasi.safeParse({ donem: "08/2026" }).success).toBe(false);
  });

  it("alt kategoriyi üst kategori kimliğiyle kabul eder", () => {
    expect(kategoriOlusturSemasi.safeParse({ ad: "Yakıt", ustId: "550e8400-e29b-41d4-a716-446655440000" }).success).toBe(true);
  });
});
