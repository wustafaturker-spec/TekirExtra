import { describe, it, expect, beforeEach, vi } from "vitest";
import { MaliMusavirService } from "./mali-musavir.service";
import { XMLParser } from "fast-xml-parser";

describe("MaliMusavirService", () => {
  let service: MaliMusavirService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)),
      fatura: {
        findMany: vi.fn().mockResolvedValue([
          {
            no: "FTR2026000000001",
            tarih: new Date("2026-08-01"),
            tip: "satis",
            toplamMatrah: 1000,
            toplamKdv: 200,
            genelToplam: 1200,
            durum: "kesin",
            cari: { unvan: "Test & <Müşteri>", vknTckn: "11111111111" },
            satirlar: [{ toplamTutar: 1200, kdvOrani: 20 }]
          }
        ]),
      },
      kasaBankaHareket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "12345678-1234-4123-8123-123456789012", tarih: new Date("2026-08-02"), tip: "tahsilat", tutar: 1250,
          cari: { unvan: "=HYPERLINK(\"https://example.test\")", vknTckn: "11111111111" },
          aciklama: "Satır 1; \"özel\"\nSatır 2",
        }]),
      }
    };

    service = new MaliMusavirService(mockPrisma);
  });

  it("Luca XML aktarımını doğru şablon ile üretmelidir", async () => {
    const xml = await service.lucaFaturaXmlAktar("tenant-1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(xml).toContain('<LucaAktarim formatSurumu="tekirextra-luca-1">');
    expect(xml).toContain("<No>FTR2026000000001</No>");
    expect(xml).toContain("<Faturalar>");
    expect(xml).toContain("<CariUnvan>Test &amp; &lt;Müşteri&gt;</CariUnvan>");
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    expect(parsed.LucaAktarim["@_formatSurumu"]).toBe("tekirextra-luca-1");
    expect(parsed.LucaAktarim.Faturalar.Fatura.CariUnvan).toBe("Test & <Müşteri>");
    expect(parsed.LucaAktarim.Faturalar.Fatura.Kalemler.Kalem.Tutar).toBe(1200);
  });

  it("Zirve CSV özel karakterleri kaçırır ve formül enjeksiyonunu engeller", async () => {
    const csv = await service.zirveCsvAktar("tenant-1");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"Satır 1; ""özel""\nSatır 2"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("KDV Özet Raporunu doğru hesaplamalıdır", async () => {
    const ozet = await service.kdvOzetRaporu("tenant-1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(ozet.hesaplananKdv).toBe(200);
    expect(ozet.indirilecekKdv).toBe(0);
    expect(ozet.odenecekKdv).toBe(200);
  });

  it("ihraç kayıtlı alışın KDV'sini indirilecek KDV'ye katmaz (EBLG-114)", async () => {
    mockPrisma.fatura.findMany.mockResolvedValueOnce([
      { tip: "satis", toplamKdv: 200, ihracKayitliKodu: null },
      { tip: "alis", toplamKdv: 50, ihracKayitliKodu: null },
      { tip: "alis", toplamKdv: 80, ihracKayitliKodu: "701" },
    ]);
    const ozet = await service.kdvOzetRaporu("tenant-1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(ozet.indirilecekKdv).toBe(50);
    expect(ozet.ihracKayitliAlisKdv).toBe(80);
    expect(ozet.odenecekKdv).toBe(150);
  });
});
