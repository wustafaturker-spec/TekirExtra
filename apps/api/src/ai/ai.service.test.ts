import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiService } from "./ai.service";
import { istekBaglami } from "../core/istek-baglami";
import { MockAiProvider } from "./saglayici/mock-ai.provider";
import { fisFaturaDogrula } from "./ai.dogrulama";
import { vknGecerliMi, tcknGecerliMi } from "@tekirextra/shared";
import { OCR_AZAMI_GORSEL_PIKSEL, ocrDosyasiniDogrula, cariIletisimCikarimSemasi } from "./ai.semalar";

describe("Ai Doğrulama ve Algoritma Motoru (Hata Toleransı Testleri)", () => {
  it("OCR dosyasında boyut, MIME beyanı ve gerçek dosya imzasını denetler", () => {
    const pngBaslik = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngBaslik);
    pngBaslik.writeUInt32BE(1, 16);
    pngBaslik.writeUInt32BE(1, 20);
    const png = `data:image/png;base64,${pngBaslik.toString("base64")}`;
    expect(() => ocrDosyasiniDogrula({ gorselBase64: png, mimeType: "image/png", belgeTipi: "fis_fatura" })).not.toThrow();
    expect(() => ocrDosyasiniDogrula({ gorselBase64: png, mimeType: "image/jpeg", belgeTipi: "fis_fatura" })).toThrow(/türü/);
    expect(() => ocrDosyasiniDogrula({ gorselBase64: "data:image/png;base64,SGVsbG8=", mimeType: "image/png", belgeTipi: "fis_fatura" })).toThrow(/gerçek türü/);

    pngBaslik.writeUInt32BE(OCR_AZAMI_GORSEL_PIKSEL + 1, 16);
    expect(() => ocrDosyasiniDogrula({ gorselBase64: `data:image/png;base64,${pngBaslik.toString("base64")}`, mimeType: "image/png", belgeTipi: "fis_fatura" })).toThrow(/40 megapiksel/);
  });

  it("geçerli ve geçersiz VKN'leri doğru ayırt eder", () => {
    // 10 haneli standart VKN kontrolü
    expect(vknGecerliMi("1234567890")).toBe(true);
    expect(vknGecerliMi("1111111114")).toBe(true);
    expect(vknGecerliMi("1234567891")).toBe(false);
    expect(vknGecerliMi("123")).toBe(false);
  });

  it("geçerli ve geçersiz TCKN'leri doğru ayırt eder", () => {
    // 11 haneli standart TCKN algoritma kontrolü
    expect(tcknGecerliMi("10000000146")).toBe(true);
    expect(tcknGecerliMi("11111111111")).toBe(false);
    expect(tcknGecerliMi("01234567890")).toBe(false); // 0 ile başlayamaz
  });

  it("matematiksel sağlama hatasını yakalar (KDV + Matrah != Genel Toplam)", () => {
    const hataliFis = {
      belgeTuru: "FIS" as const,
      belgeNo: "123",
      tarih: "2026-10-10",
      saticiUnvan: "Test Petrol",
      saticiVknTckn: "6220084503",
      saticiVergiDairesi: "Kadıköy",
      saticiAdres: null,
      saticiTelefon: null,
      saticiEposta: null,
      saticiIban: null,
      paraBirimi: "TRY",
      toplamMatrah: 100.0,
      toplamKdv: 20.0,
      genelToplam: 150.0, // Hata: 100 + 20 != 150
      kdvKirilimi: [],
      kalemler: [],
      guvenSkoru: 0.9,
    };

    const sonuc = fisFaturaDogrula(hataliFis);
    expect(sonuc.uyarilar.some((u) => u.includes("Matematiksel uyumsuzluk"))).toBe(true);
  });
});

describe("AiService Entegrasyonu", () => {
  let service: AiService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) =>
        cb({
          $executeRaw: vi.fn().mockResolvedValue(1),
          aiCagriIz: { create: vi.fn().mockResolvedValue({ id: "ai-iz-1" }) },
          tenantAiAyari: { findUnique: vi.fn().mockResolvedValue(null) },
          platformAiOzellikDurumu: { findMany: vi.fn().mockResolvedValue([]) },
          aiKullanim: { aggregate: vi.fn().mockResolvedValue({ _sum: { cagri: 0 } }), upsert: vi.fn() },
          aiOcrDenetim: { create: vi.fn().mockResolvedValue({ id: "ocr-iz-1" }), update: vi.fn().mockResolvedValue({}) },
          cariHesap: {
            findFirst: vi.fn().mockResolvedValue({
              id: "cari-123",
              unvan: "MİGROS TİCARET A.Ş.",
              kod: "C-001",
            }),
          },
        }),
      ),
    };
    service = new AiService(mockPrisma);
    service.setProvider(new MockAiProvider());
  });

  it("fiş görselinden doğru alanları çıkarır, carisi varsa otomatik eşleştirir", async () => {
    const sonuc = await istekBaglami.run({ deger: { tenantId: "tenant-1", userId: "u1", rol: "muhasebe" } }, () => service.fisFaturaOcrTara("tenant-1", {
      gorselBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      mimeType: "image/png",
      belgeTipi: "fis_fatura",
    }));

    expect(sonuc.dogrulama.gecerli).toBe(true);
    expect(sonuc.dogrulama.veri.saticiUnvan).toBe("MİGROS TİCARET A.Ş.");
    expect(sonuc.dogrulama.veri.genelToplam).toBe(120.0);
    expect(sonuc.eslesenCari).toEqual({
      id: "cari-123",
      unvan: "MİGROS TİCARET A.Ş.",
      kod: "C-001",
    });
    expect(sonuc.onerilenMasrafKategorisi).toBe("Ofis & Kırtasiye");
  });

  it("iletişim / kartvizit metninden cari hesap ve yetkili kişi bilgilerini eksiksiz çıkarır", async () => {
    const sonuc = await istekBaglami.run({ deger: { tenantId: "tenant-1", userId: "u1", rol: "muhasebe" } }, () => service.cariBilgisiCikar("tenant-1", {
      hamMetin: "Kaya Metal Ltd. Şti. Ahmet Kaya 05321112233 muhasebe@kayametal.com.tr",
      belgeTipi: "cari_bilgisi",
    }));

    expect(sonuc.dogrulama.gecerli).toBe(true);
    expect(sonuc.dogrulama.veri.unvan).toContain("KAYA");
    expect(sonuc.dogrulama.veri.yetkiliKisi?.adSoyad).toBe("Ahmet Kaya");
    expect(sonuc.dogrulama.veri.iban).toBeTruthy();
  });

  it("cariIletisimCikarimSemasi gerçek model çıktılarını (sarmalanmış, snake_case, boş e-posta, tüzel) hatasız normalize eder", () => {
    const ham = {
      cari: {
        firma_unvani: "Örnek Tekstil San. Tic. Ltd. Şti.",
        kisiTipi: "tüzel",
        vergi_no: "1234567890",
        vergi_dairesi: "Nilüfer VD",
        e_posta: "", // boş e-posta hata vermemeli
        iban: "TR120006200000012345678901",
        iban_listesi: "TR120006200000012345678901", // dizi yerine string
        yetkili_kisi: "Mehmet Demir", // nesne yerine düz metin
      },
    };
    const parsed = cariIletisimCikarimSemasi.parse(ham);
    expect(parsed.unvan).toBe("Örnek Tekstil San. Tic. Ltd. Şti.");
    expect(parsed.kisiTipi).toBe("tuzel");
    expect(parsed.vknTckn).toBe("1234567890");
    expect(parsed.vergiDairesi).toBe("Nilüfer VD");
    expect(parsed.eposta).toBeNull();
    expect(parsed.ibanListesi).toEqual(["TR120006200000012345678901"]);
    expect(parsed.yetkiliKisi?.adSoyad).toBe("Mehmet Demir");
  });
});
