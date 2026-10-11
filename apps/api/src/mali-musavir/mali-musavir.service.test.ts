import { describe, it, expect, beforeEach, vi } from "vitest";
import { MaliMusavirService } from "./mali-musavir.service";
import { XMLParser } from "fast-xml-parser";

/** KDV beyan hesabı satırlardan çalışır (RPR-13); tek satırlı sahte fatura. */
const ft = (tip: string, kdv: number, net: number, tevkifat: number, kur: number, ihracKayitliKodu: string | null) => ({
  tip, kur, ihracKayitliKodu, toplamNetKdv: net, satirlar: [{ kdvOrani: 20, matrah: kdv * 5, kdvTutari: kdv, tevkifatTutari: tevkifat, netKdvTutari: net }],
});

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
            toplamNetKdv: 200,
            toplamTevkifat: 0,
            kur: 1,
            genelToplam: 1200,
            durum: "kesin",
            cari: { unvan: "Test & <Müşteri>", vknTckn: "11111111111" },
            satirlar: [{ toplamTutar: 1200, kdvOrani: 20, matrah: 1000, kdvTutari: 200, tevkifatTutari: 0, netKdvTutari: 200 }]
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
      ft("satis", 200, 200, 0, 1, null),
      ft("alis", 50, 50, 0, 1, null),
      ft("alis", 80, 0, 0, 1, "701"),
    ]);
    const ozet = await service.kdvOzetRaporu("tenant-1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(ozet.indirilecekKdv).toBe(50);
    expect(ozet.ihracKayitliAlisKdv).toBe(80);
    expect(ozet.odenecekKdv).toBe(150);
  });

  it("iadeleri beyannamedeki yerine koyar, tevkifatı ayırır ve dövizliyi kurla çevirir (RPR-02)", async () => {
    mockPrisma.fatura.findMany.mockResolvedValueOnce([
      // Satış 1.000 + KDV 200, 5/10 tevkifat: satıcı 100 beyan eder, 100'ü alıcı KDV-2 ile
      ft("satis", 200, 100, 100, 1, null),
      // Dövizli satış: 10 EUR KDV × 40 = 400
      ft("satis", 10, 10, 0, 40, null),
      // İhraç kayıtlı satış: KDV hesaplanır, tahsil edilmez (net 0) → ödenecek tutara girmez
      ft("satis", 60, 0, 0, 1, "701"),
      // Tevkifatlı alış: KDV 300, 90'ını biz kestik → indirilecek 300, KDV-2 90
      ft("alis", 300, 210, 90, 1, null),
      ft("alis_iade", 20, 20, 0, 1, null),
      ft("satis_iade", 30, 30, 0, 1, null),
    ]);
    const ozet = await service.kdvOzetRaporu("tenant-1", new Date("2026-08-01"), new Date("2026-08-31"));
    const sorgu = mockPrisma.fatura.findMany.mock.calls.at(-1)[0];
    expect(sorgu.where.tip).toEqual({ in: ["satis", "alis", "satis_iade", "alis_iade"] });
    expect(ozet).toMatchObject({
      satisKdv: 500, alistanIadeKdv: 20, hesaplananKdv: 520,
      alisKdv: 300, satistanIadeKdv: 30, indirilecekKdv: 330,
      aliciTevkifati: 100, kestigimizTevkifat: 90, ihracKayitliSatisKdv: 60,
      odenecekKdv: 190, devredenKdv: 0,
    });
  });
});
