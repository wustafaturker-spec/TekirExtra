import { describe, expect, it } from "vitest";
import { isGunuSayisi } from "./izin.service";
import { izinTalepOlusturSemasi } from "./izin.semalar";

describe("İzin yönetimi", () => {
  it("hafta sonlarını iş günü hesabına katmaz", () => {
    expect(isGunuSayisi(new Date("2026-08-20"), new Date("2026-08-24"))).toBe(3);
  });

  it("yalnız hafta sonundan oluşan aralıkta sıfır iş günü döndürür", () => {
    expect(isGunuSayisi(new Date("2026-08-22"), new Date("2026-08-23"))).toBe(0);
  });

  it("resmî tatil ve yarım günü çalışma süresinden düşer", () => {
    expect(isGunuSayisi(new Date("2026-08-24"), new Date("2026-08-26"), [
      { tarih: new Date("2026-08-24"), yarimGun: false }, { tarih: new Date("2026-08-25"), yarimGun: true },
    ])).toBe(1.5);
  });

  it("bitiş tarihi başlangıçtan önce olan talebi reddeder", () => {
    const sonuc = izinTalepOlusturSemasi.safeParse({
      personelId: "01010101-0101-4101-8101-010101010101",
      izinTuruId: "02020202-0202-4202-8202-020202020202",
      baslangicTarihi: "2026-08-20",
      bitisTarihi: "2026-08-19",
    });
    expect(sonuc.success).toBe(false);
  });
});
