import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiRaporService } from "./ai-rapor.service";
import { Prisma } from "@prisma/client";

describe("AiRaporService - Doğal Dilde Raporlama & AI CFO Asistanı (Faz 4)", () => {
  let service: AiRaporService;
  let mockPrisma: any;
  let mockTx: any;

  const mockTenantId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    mockTx = {
      fatura: {
        findMany: vi.fn(),
      },
      cariHareket: {
        findMany: vi.fn(),
      },
      masraf: {
        findMany: vi.fn(),
      },
      kasa: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      bankaHesap: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      kasaBankaHareket: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockPrisma = {
      tenantIslem: vi.fn((_tenantId, callback) => callback(mockTx)),
    };

    service = new AiRaporService(mockPrisma);
  });

  it("1. Ciro ve Kârlılık: Doğal dil sorusundan ciro ve brüt marj analizi üretmelidir", async () => {
    mockTx.fatura.findMany.mockResolvedValue([
      {
        toplamMatrah: new Prisma.Decimal(100000),
        toplamKdv: new Prisma.Decimal(20000),
        genelToplam: new Prisma.Decimal(120000),
        satirlar: [
          {
            matrah: new Prisma.Decimal(100000),
            miktar: new Prisma.Decimal(100),
            stok: { alisFiyati: new Prisma.Decimal(700) }, // 70.000 maliyet
          },
        ],
      },
    ]);

    const yanit = await service.soruCevapla(mockTenantId, "Bu ayki toplam ciromuz ve kârlılığımız ne kadar?");

    expect(yanit.raporTuru).toBe("CIRO_VE_KARLILIK");
    expect(yanit.metrikler.toplamCiro).toBe(100000);
    expect(yanit.metrikler.brutKar).toBe(30000); // 100.000 - 70.000
    expect(yanit.metrikler.karMarjiYuzde).toBe(30);
    expect(yanit.icgoruler.length).toBeGreaterThan(0);
  });

  it("2. Müşteri Sıralaması: En çok satış yapılan müşterileri cirosuna göre listelemelidir", async () => {
    mockTx.fatura.findMany.mockResolvedValue([
      {
        cariId: "cari-1",
        toplamMatrah: new Prisma.Decimal(60000),
        cari: { unvan: "Yılmaz Holding", kod: "CAR001" },
      },
      {
        cariId: "cari-2",
        toplamMatrah: new Prisma.Decimal(40000),
        cari: { unvan: "Kaya Ltd", kod: "CAR002" },
      },
    ]);

    const yanit = await service.soruCevapla(mockTenantId, "En çok satış yaptığımız müşteriler kimler?");

    expect(yanit.raporTuru).toBe("EN_COK_SATAN_MUSTERILER");
    expect(yanit.tablo?.length).toBe(2);
    expect(yanit.tablo?.[0].unvan).toBe("Yılmaz Holding");
    expect(yanit.tablo?.[0].ciro).toBe(60000);
    expect(yanit.icgoruler.some((i) => i.includes("Yılmaz Holding"))).toBe(true);
  });

  it("3. Risk Raporu: Vadesi geçmiş alacakları ve riskli müşterileri raporlamalıdır", async () => {
    const gecmisTarih = new Date(Date.now() - 15 * 86400000);
    mockTx.cariHareket.findMany.mockResolvedValue([
      {
        cariId: "cari-1",
        tutarTry: new Prisma.Decimal(25000),
        vadeTarihi: gecmisTarih,
        cari: { unvan: "Demir İnşaat", kod: "CAR003", telefon: "05320000000" },
      },
    ]);

    const yanit = await service.soruCevapla(mockTenantId, "Vadesi geçmiş alacaklarımız ne kadar?");

    expect(yanit.raporTuru).toBe("VADESI_GECMIS_ALACAKLAR");
    expect(yanit.metrikler.toplamGecikenTutar).toBe(25000);
    expect(yanit.tablo?.[0].unvan).toBe("Demir İnşaat");
    expect(yanit.tablo?.[0].gecikmeGunu).toBeGreaterThanOrEqual(14);
  });

  it("4. Gider Kırılımı: Masraf kategorilerini paylarına göre gruplamalıdır", async () => {
    mockTx.masraf.findMany.mockResolvedValue([
      { toplam: new Prisma.Decimal(15000), kategori: { ad: "Pazarlama & Reklam" } },
      { toplam: new Prisma.Decimal(5000), kategori: { ad: "Ofis & Kırtasiye" } },
    ]);

    const yanit = await service.soruCevapla(mockTenantId, "En büyük masraf ve harcamalarımız neler?");

    expect(yanit.raporTuru).toBe("MASRAF_KIRILIMI");
    expect(yanit.metrikler.toplamGider).toBe(20000);
    expect(yanit.tablo?.[0].kategori).toBe("Pazarlama & Reklam");
  });

  it("5. AI CFO Yönetici Brifingi: Finansal sağlık skorunu ve stratejik tavsiyeleri üretmelidir", async () => {
    // Ciro mock
    mockTx.fatura.findMany.mockResolvedValue([
      {
        toplamMatrah: new Prisma.Decimal(200000),
        toplamKdv: new Prisma.Decimal(40000),
        genelToplam: new Prisma.Decimal(240000),
        satirlar: [{ matrah: new Prisma.Decimal(200000), miktar: 1, stok: { alisFiyati: new Prisma.Decimal(140000) } }],
      },
    ]);

    // Alacak mock (temiz, gecikme yok)
    mockTx.cariHareket.findMany.mockResolvedValue([]);

    // Nakit mock
    mockTx.kasa.findMany.mockResolvedValue([{ id: "k-1", ad: "Merkez Kasa", dovizCinsi: "TRY" }]);
    mockTx.bankaHesap.findMany.mockResolvedValue([{ id: "b-1", ad: "Ticari", bankaAdi: "Garanti", dovizCinsi: "TRY" }]);
    mockTx.kasaBankaHareket.findMany.mockResolvedValue([
      { tip: "tahsilat", tutarTry: new Prisma.Decimal(85000) },
    ]);

    // Masraf mock
    mockTx.masraf.findMany.mockResolvedValue([
      { toplam: new Prisma.Decimal(12000), kategori: { ad: "Lojistik & Nakliye" } },
    ]);

    const brifing = await service.yoneticiBrifingiUret(mockTenantId);

    expect(brifing.finansalSaglikSkoru).toBeGreaterThanOrEqual(80);
    expect(brifing.saglikDurumu).toBe("Mükemmel");
    expect(brifing.metrikler.aylikCiro).toBe(200000);
    expect(brifing.metrikler.nakitMevcudu).toBe(85000);
    expect(brifing.cfoTavsiyeleri.length).toBeGreaterThan(0);
    expect(brifing.yoneticiNotu).toContain("Sayın Yönetici");
  });
});
