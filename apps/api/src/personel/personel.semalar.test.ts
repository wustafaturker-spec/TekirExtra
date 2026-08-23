import { describe, expect, it } from "vitest";
import { avansOlusturSemasi, avansOdeSemasi, bordroKalemOlusturSemasi, bordroOdeSemasi, personelOlusturSemasi } from "./personel.semalar";

const temelPersonel = {
  ad: "Ayşe",
  soyad: "Yılmaz",
  calismaTipi: "tam_zamanli" as const,
  girisTarihi: "2026-08-01",
  netMaas: 40_000,
  cariOlustur: true,
};

describe("personel şemaları", () => {
  it("geçersiz TCKN'yi reddeder", () => {
    expect(personelOlusturSemasi.safeParse({ ...temelPersonel, tckn: "11111111111" }).success).toBe(false);
  });

  it("engellilik indirimi derecesini yalnızca 1–3 aralığında kabul eder", () => {
    expect(personelOlusturSemasi.safeParse({ ...temelPersonel, engellilikDerecesi: 2 }).success).toBe(true);
    expect(personelOlusturSemasi.safeParse({ ...temelPersonel, engellilikDerecesi: 4 }).success).toBe(false);
  });

  it("SGK teşvik oranını yüzde aralığında doğrular", () => {
    expect(personelOlusturSemasi.safeParse({ ...temelPersonel, sgkTesvikOrani: 5 }).success).toBe(true);
    expect(personelOlusturSemasi.safeParse({ ...temelPersonel, sgkTesvikOrani: 101 }).success).toBe(false);
  });

  it("IBAN'ı boşluklardan arındırıp normalize eder", () => {
    const sonuc = personelOlusturSemasi.parse({
      ...temelPersonel,
      iban: "tr10 0000 0000 0000 0000 0000 00",
    });
    expect(sonuc.iban).toBe("TR100000000000000000000000");
  });

  it("avans talebini ödeme hesabından bağımsız, ödemeyi tek hesapla doğrular", () => {
    const talep = avansOlusturSemasi.safeParse({
      personelId: "01010101-0101-4101-8101-010101010101",
      tutar: 1_000,
      tarih: "2026-08-20",
    });
    expect(talep.success).toBe(true);
    expect(avansOdeSemasi.safeParse({ tarih: "2026-08-20" }).success).toBe(false);
    expect(avansOdeSemasi.safeParse({ tarih: "2026-08-20", bankaHesapId: "01010101-0101-4101-8101-010101010101" }).success).toBe(true);
  });

  it("bordro kaleminde hassas para metni ve güvenli kod ister", () => {
    expect(bordroKalemOlusturSemasi.safeParse({ tip: "kazanc", kod: "performans_primi", aciklama: "Performans primi", tutar: "1250.50" }).success).toBe(true);
    expect(bordroKalemOlusturSemasi.safeParse({ tip: "kesinti", kod: "Geçersiz Kod", aciklama: "Kesinti", tutar: "1.999" }).success).toBe(false);
  });

  it("kısmi ödeme için pozitif tutar ve tek finansal kaynak ister", () => {
    const temel = { tutar: "5000.00", odemeTarihi: "2026-08-20" };
    expect(bordroOdeSemasi.safeParse({ ...temel, kasaId: "01010101-0101-4101-8101-010101010101" }).success).toBe(true);
    expect(bordroOdeSemasi.safeParse(temel).success).toBe(false);
    expect(bordroOdeSemasi.safeParse({ ...temel, tutar: "0" }).success).toBe(false);
  });
});
