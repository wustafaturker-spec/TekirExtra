import * as ExcelJS from "exceljs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ornekDegeriMaskele,
  ornekleriTopla,
  tipUyumlulugunuDogrula,
  VeriAktarimiAiService,
} from "./veri-aktarimi-ai.service";
import * as istekBaglami from "../core/istek-baglami";
import * as kiraciSaglayiciModul from "../ai/saglayici/kiraci-saglayici";

async function xlsxUret(basliklar: string[], ...satirlar: (string | number)[][]): Promise<Buffer> {
  const k = new ExcelJS.Workbook();
  const s = k.addWorksheet("Test");
  s.addRow(basliklar);
  for (const r of satirlar) s.addRow(r);
  return Buffer.from(await k.xlsx.writeBuffer());
}

describe("VeriAktarimiAiService - Yardımcı Fonksiyonlar", () => {
  describe("ornekDegeriMaskele (P-13 Gizlilik Kuralı)", () => {
    it("VKN ve TCKN değerlerini son 4 hane hariç maskeler", () => {
      expect(ornekDegeriMaskele("1234567890")).toBe("******7890");
      expect(ornekDegeriMaskele("98765432101")).toBe("******2101");
    });

    it("IBAN değerlerini maskeler", () => {
      const iban = "TR33 0006 1005 1234 5678 9012 34";
      const maskeli = ornekDegeriMaskele(iban);
      expect(maskeli).toContain("TR**");
      expect(maskeli.endsWith("1234")).toBe(true);
    });

    it("E-posta adreslerini maskeler", () => {
      expect(ornekDegeriMaskele("muhasebe@orneksirket.com.tr")).toBe("m***@orneksirket.com.tr");
    });

    it("Telefon numaralarını maskeler", () => {
      expect(ornekDegeriMaskele("05321234567")).toBe("***4567");
      expect(ornekDegeriMaskele("+90 532 999 8877")).toBe("***8877");
    });

    it("Boş ve normal metinleri güvenle ele alır", () => {
      expect(ornekDegeriMaskele("")).toBe("");
      expect(ornekDegeriMaskele("Vida Somun 5mm")).toBe("Vida Somun 5mm");
    });
  });

  describe("ornekleriTopla (P-13 Çeşitli Örnekleme Kuralı)", () => {
    it("ilk 5 satırla sınırlı kalmadan sayfa boyunca dolu satırlardan örnek toplar", async () => {
      const k = new ExcelJS.Workbook();
      const s = k.addWorksheet("Sayfa1");
      s.addRow(["Vergi Numaraları"]);
      for (let i = 1; i <= 30; i++) {
        s.addRow([i % 2 === 0 ? `11111111${i.toString().padStart(2, "0")}` : ""]);
      }

      const ornekler = ornekleriTopla(s, 1, 4);
      expect(ornekler.length).toBeGreaterThan(1);
      expect(ornekler.length).toBeLessThanOrEqual(4);
      // Maskelenmiş olmalı
      for (const o of ornekler) {
        expect(o).toContain("******");
      }
    });
  });

  describe("tipUyumlulugunuDogrula (P-13 Deterministik Doğrulama)", () => {
    it("sayısal alanlara gelen metinleri tespit eder", () => {
      expect(tipUyumlulugunuDogrula("bakiye", ["1250.50", "3000"]).gecerli).toBe(true);
      expect(tipUyumlulugunuDogrula("tutar", ["Ahmet Yılmaz", "İstanbul"]).gecerli).toBe(false);
    });

    it("tarih alanlarına gelen geçersiz formatları tespit eder", () => {
      expect(tipUyumlulugunuDogrula("vade", ["2026-12-31", "15.01.2026"]).gecerli).toBe(true);
      expect(tipUyumlulugunuDogrula("vade", ["Deneme metni", "XYZ"]).gecerli).toBe(false);
    });

    it("vknTckn alanına gelen geçersiz formatları tespit eder", () => {
      expect(tipUyumlulugunuDogrula("vknTckn", ["******1234", "1234567890"]).gecerli).toBe(true);
      expect(tipUyumlulugunuDogrula("vknTckn", ["Kadıköy / İstanbul"]).gecerli).toBe(false);
    });
  });
});

describe("VeriAktarimiAiService - kolonOnerisiUret", () => {
  let servis: VeriAktarimiAiService;
  const mockPrisma = {} as never;

  beforeEach(() => {
    vi.spyOn(istekBaglami, "aktifBaglam").mockReturnValue({
      tenantId: "test-tenant-uuid",
      userId: "test-user-uuid",
      rol: "yonetici",
    });
    servis = new VeriAktarimiAiService(mockPrisma);
  });

  it("dosyadaki bütün kolonlar zaten tanınıyorsa AI modelini HİÇ çağırmaz (0 maliyet)", async () => {
    const mockSaglayici = { yapilandirilmisUretim: vi.fn() };
    const kiraciCasusu = vi.spyOn(kiraciSaglayiciModul, "kiraciSaglayicisi").mockResolvedValue({
      saglayici: mockSaglayici,
      ayar: null,
    } as never);

    // CARI_SUTUNLARI: Kod, Cari Adı, VKN/TCKN vb. hepsi tanınan başlıklardır
    const dosya = await xlsxUret(
      ["Cari Kodu", "Cari Ünvanı", "Vergi Kimlik No"],
      ["C-001", "Acme A.Ş.", "1234567890"],
    );

    const sonuc = await servis.kolonOnerisiUret("cari", dosya);

    expect(sonuc.taninmayanSayisi).toBe(0);
    expect(sonuc.oneriler).toHaveLength(0);
    expect(mockSaglayici.yapilandirilmisUretim).not.toHaveBeenCalled();
    kiraciCasusu.mockRestore();
  });

  it("tanınmayan kolonlar için AI modelini çağırır, deterministik doğrulama ve çakışma çözümünü uygular", async () => {
    const mockSaglayici = {
      yapilandirilmisUretim: vi.fn().mockResolvedValue({
        oneriler: [
          {
            baslik: "Vergi Dairesi ve No",
            anahtar: "vknTckn",
            guven: 95,
            gerekce: "Örnek veriler vergi numarası formatında",
          },
          {
            baslik: "Bağlı Olduğu Vergi Dairesi",
            anahtar: "vergiDairesi",
            guven: 90,
            gerekce: "Vergi dairesi adı içeriyor",
          },
          {
            baslik: "Özel Kod 1",
            anahtar: "kod",
            guven: 40,
            gerekce: "Alternatif kod alanı",
          },
        ],
      }),
    };

    const kiraciCasusu = vi.spyOn(kiraciSaglayiciModul, "kiraciSaglayicisi").mockResolvedValue({
      saglayici: mockSaglayici,
      ayar: null,
    } as never);

    // "Cari Kodu" zaten kod ile eşlenir; "Vergi Dairesi ve No", "Bağlı Olduğu Vergi Dairesi", "Özel Kod 1" tanınmayanlardır
    const dosya = await xlsxUret(
      ["Cari Kodu", "Vergi Dairesi ve No", "Bağlı Olduğu Vergi Dairesi", "Özel Kod 1"],
      ["C-01", "1234567890", "Kadıköy V.D.", "OZ-01"],
      ["C-02", "9876543210", "Beşiktaş V.D.", "OZ-02"],
    );

    const sonuc = await servis.kolonOnerisiUret("cari", dosya);

    expect(sonuc.taninmayanSayisi).toBe(3);
    expect(sonuc.oneriler).toHaveLength(3);

    const vknOnerisi = sonuc.oneriler.find((o) => o.baslik === "Vergi Dairesi ve No");
    expect(vknOnerisi).toBeDefined();
    expect(vknOnerisi?.anahtar).toBe("vknTckn");
    expect(vknOnerisi?.guven).toBe(95);

    const vdOnerisi = sonuc.oneriler.find((o) => o.baslik === "Bağlı Olduğu Vergi Dairesi");
    expect(vdOnerisi).toBeDefined();
    expect(vdOnerisi?.anahtar).toBe("vergiDairesi");
    expect(vdOnerisi?.guven).toBe(90);

    kiraciCasusu.mockRestore();
  });

  it("aynı alana iki farklı sütun önerilirse daha yüksek güvenli olan seçilir, diğeri boşa çıkar", async () => {
    const mockSaglayici = {
      yapilandirilmisUretim: vi.fn().mockResolvedValue({
        oneriler: [
          {
            baslik: "Müşteri Adı",
            anahtar: "unvan",
            guven: 92,
            gerekce: "Müşteri unvanı",
          },
          {
            baslik: "Firma Ticari Unvanı",
            anahtar: "unvan",
            guven: 98,
            gerekce: "Tam ticari unvan",
          },
        ],
      }),
    };

    const kiraciCasusu = vi.spyOn(kiraciSaglayiciModul, "kiraciSaglayicisi").mockResolvedValue({
      saglayici: mockSaglayici,
      ayar: null,
    } as never);

    const dosya = await xlsxUret(
      ["Cari Kodu", "Müşteri Adı", "Firma Ticari Unvanı"],
      ["C-01", "Ali Ticaret", "Ali Ticaret Ltd. Şti."],
    );

    const sonuc = await servis.kolonOnerisiUret("cari", dosya);

    const musteriAdi = sonuc.oneriler.find((o) => o.baslik === "Müşteri Adı");
    const firmaUnvani = sonuc.oneriler.find((o) => o.baslik === "Firma Ticari Unvanı");

    // 98 güvenli olan unvan'a sahip olmalı, 92 güvenli olan boşa çıkmalı
    expect(firmaUnvani?.anahtar).toBe("unvan");
    expect(firmaUnvani?.guven).toBe(98);
    expect(musteriAdi?.anahtar).toBeNull();

    kiraciCasusu.mockRestore();
  });
});
