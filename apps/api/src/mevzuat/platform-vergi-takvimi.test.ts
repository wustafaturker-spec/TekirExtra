import * as ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { excelSatirlariniDenetle, excelTarihi, excelYukumlulugu, PlatformVergiTakvimiService } from "./platform-vergi-takvimi.service";

const servis = (kayitlar: unknown[] = []) => {
  const mevzuat = { olustur: vi.fn(async () => ({ id: "d1", no: 7 })), satirlariYaz: vi.fn(async () => undefined) };
  const s = new PlatformVergiTakvimiService({ db: { mevzuatKayit: { findMany: async () => kayitlar } } } as never, mevzuat as never);
  return { s, mevzuat };
};
const kayit = (anahtar: string, sonTarih: string, bas = "2026-01-01", bitis: Date | null = null) => ({ anahtar, deger: { sonTarih }, yururlukBaslangic: new Date(`${bas}T00:00:00Z`), yururlukBitis: bitis });

describe("Excel okuma", () => {
  it("tarih biçimleri", () => {
    expect(excelTarihi(new Date("2026-11-30T00:00:00Z"))).toBe("2026-11-30");
    expect(excelTarihi("30.11.2026")).toBe("2026-11-30");
    expect(excelTarihi("2026-11-30")).toBe("2026-11-30");
    expect(excelTarihi("31.02.2026")).toBeNull();
    expect(excelTarihi(45000)).toBeNull();
  });
  it("yükümlülük adı ya da kodu", () => {
    expect(excelYukumlulugu("KDV-1")).toBe("kdv1");
    expect(excelYukumlulugu("sgk primi")).toBe("sgk");
    expect(excelYukumlulugu("ÖTV")).toBeNull();
  });
  it("hataları satır numarasıyla verir, boş tarih atlanır", () => {
    const { satirlar, hatalar } = excelSatirlariniDenetle([
      { satirNo: 2, yil: 2026, ay: 10, yukumluluk: "KDV-1", sonTarih: "2026-11-30" },
      { satirNo: 3, yil: 2026, ay: 11, yukumluluk: "KDV-1", sonTarih: null },
      { satirNo: 4, yil: 2026, ay: 10, yukumluluk: "KDV-1", sonTarih: "2026-11-28" },
      { satirNo: 5, yil: 2026, ay: 10, yukumluluk: "ÖTV", sonTarih: "2026-11-28" },
      { satirNo: 6, yil: 2026, ay: 10, yukumluluk: "SGK primi", sonTarih: "2026-10-15" },
      { satirNo: 7, yil: 2025, ay: 10, yukumluluk: "KDV-2", sonTarih: "2025-11-25" },
      { satirNo: 8, yil: 2026, ay: 4, yukumluluk: "Muhtasar (üç aylık)", sonTarih: "2026-06-26" },
    ], 2026, new Map());
    expect(satirlar).toHaveLength(1);
    expect(hatalar.map((h) => h.satirNo)).toEqual([4, 5, 6, 7, 8]);
    expect(hatalar[0]?.mesaj).toContain("2. satırda");
  });
  it("yeni, değişen, aynı ve hafta sonu uyarısı", () => {
    const mevcut = new Map([["kdv1:2026-10", "2026-11-30"], ["kdv2:2026-10", "2026-11-25"]]);
    const { satirlar } = excelSatirlariniDenetle([
      { satirNo: 2, yil: 2026, ay: 10, yukumluluk: "KDV-1", sonTarih: "2026-11-30" },
      { satirNo: 3, yil: 2026, ay: 10, yukumluluk: "KDV-2", sonTarih: "2026-11-28" },
      { satirNo: 4, yil: 2026, ay: 10, yukumluluk: "Muhtasar", sonTarih: "2026-11-26" },
    ], 2026, mevcut);
    expect(satirlar.map((s) => s.durum)).toEqual(["ayni", "degisen", "yeni"]);
    expect(satirlar[1]?.uyari).toContain("Hafta sonu");
  });
});

describe("şablon ve taslak", () => {
  it("indirilen şablon doldurulup geri yüklenebilir", async () => {
    const { s } = servis();
    const kitap = new ExcelJS.Workbook();
    await kitap.xlsx.load(await s.sablon(2026) as never);
    const sayfa = kitap.worksheets[0]!;
    expect(sayfa.actualRowCount).toBe(1 + 12 * 4 + 4);
    sayfa.getRow(2).getCell(4).value = new Date("2026-02-28T00:00:00Z");
    const sonuc = await s.onizle(Buffer.from(await kitap.xlsx.writeBuffer()), 2026, "a.xlsx");
    expect(sonuc.hatalar).toEqual([]);
    expect(sonuc.satirlar).toEqual([expect.objectContaining({ yukumluluk: "kdv1", ay: 1, sonTarih: "2026-02-28", durum: "yeni" })]);
  });
  it("başlıksız dosyayı reddeder", async () => {
    const { s } = servis();
    const kitap = new ExcelJS.Workbook();
    kitap.addWorksheet("x").addRow(["A", "B"]);
    await expect(s.onizle(Buffer.from(await kitap.xlsx.writeBuffer()), 2026, "a.xlsx")).rejects.toThrow("başlıkları");
  });
  it("yalnız farklı tarihleri taslağa yazar: ilk yayın ekle, sonraki değiştir", async () => {
    const { s, mevzuat } = servis([kayit("kdv1:2026-10", "2026-11-30"), kayit("kdv2:2026-10", "2026-11-25")]);
    const r = await s.taslakOlustur({ yil: 2026, dayanak: "GİB takvimi", satirlar: [
      { yukumluluk: "kdv1", ay: 10, sonTarih: "2026-11-30" },
      { yukumluluk: "kdv2", ay: 10, sonTarih: "2026-11-27" },
      { yukumluluk: "sgk", ay: 10, sonTarih: "2026-11-30" },
    ] });
    expect(r.satirSayisi).toBe(2);
    expect(mevzuat.satirlariYaz).toHaveBeenCalledWith("d1", [
      { tur: "vergi_takvimi", anahtar: "kdv2:2026-10", islem: "degistir", deger: { sonTarih: "2026-11-27" } },
      { tur: "vergi_takvimi", anahtar: "sgk:2026-10", islem: "ekle", deger: { sonTarih: "2026-11-30" } },
    ], 1);
  });
  it("hiç fark yoksa ya da tarih hatalıysa taslak açmaz", async () => {
    const { s, mevzuat } = servis([kayit("kdv1:2026-10", "2026-11-30")]);
    await expect(s.taslakOlustur({ yil: 2026, dayanak: "dayanak", satirlar: [{ yukumluluk: "kdv1", ay: 10, sonTarih: "2026-11-30" }] })).rejects.toThrow("farklı tarih yok");
    await expect(s.taslakOlustur({ yil: 2026, dayanak: "dayanak", satirlar: [{ yukumluluk: "kdv1", ay: 10, sonTarih: "2026-10-01" }] })).rejects.toThrow("dönem bittikten");
    expect(mevzuat.olustur).not.toHaveBeenCalled();
  });
  it("aynı gün ikinci düzeltme ertesi güne yürürlük alır", async () => {
    const yarin = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const { s } = servis([kayit("kdv1:2026-10", "2026-11-30", yarin)]);
    const r = await s.taslakOlustur({ yil: 2026, dayanak: "dayanak", satirlar: [{ yukumluluk: "kdv1", ay: 10, sonTarih: "2026-12-07" }] });
    expect(r.yururluk > yarin).toBe(true);
  });
});
