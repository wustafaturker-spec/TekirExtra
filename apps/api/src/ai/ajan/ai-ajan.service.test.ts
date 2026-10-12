import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiAjanService } from "./ai-ajan.service";
import { Prisma } from "@prisma/client";

describe("AiAjanService - Dış Kanallar & AI Ajan Entegrasyonu (Faz 3)", () => {
  let service: AiAjanService;
  let mockPrisma: any;

  const mockTenantId = "11111111-1111-1111-1111-111111111111";
  const mockUserId = "22222222-2222-2222-2222-222222222222";
  const mockOturumId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
      },
      ajanOturumu: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      ajanMesajGecmisi: {
        create: vi.fn().mockResolvedValue({ id: "mesaj-1" }),
      },
      tenantIslem: vi.fn((_tenantId, callback) => callback(mockTx)),
    };

    service = new AiAjanService(mockPrisma);
  });

  const mockTx = {
    cariHesap: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    cariHareket: {
      findMany: vi.fn(),
    },
    stokKart: {
      findMany: vi.fn(),
    },
    belge: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    belgeSayac: {
      upsert: vi.fn().mockResolvedValue({ sonSira: 1 }),
      findUnique: vi.fn().mockResolvedValue({ id: "s-1" }),
      update: vi.fn().mockResolvedValue({ sonSira: 1 }),
    },
    crmGorev: {
      create: vi.fn().mockResolvedValue({ id: "gorev-1", baslik: "Toplantı" }),
    },
  };

  it("1. Güvenlik: Kullanıcının PIN kodu varsa ilk etkileşimde PIN doğrulaması istemelidir", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: mockUserId,
      tenantId: mockTenantId,
      adSoyad: "Ahmet Satış",
      pinKodu: "1453",
    });

    mockPrisma.ajanOturumu.findUnique.mockResolvedValue({
      id: mockOturumId,
      tenantId: mockTenantId,
      userId: mockUserId,
      pinDogrulandi: false,
      sonEtkilesim: new Date(),
    });

    const sonuc = await service.mesajiIsle({
      kanal: "WHATSAPP",
      kanalKimlik: "+905321112233",
      mesaj: "Merhaba",
    });

    expect(sonuc.pinGerekiyor).toBe(true);
    expect(sonuc.cevap).toContain("lütfen 4 haneli PIN kodunuzu giriniz");
  });

  it("2. Güvenlik: Doğru PIN kodu girildiğinde oturum açılmalı ve teyit mesajı dönmelidir", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: mockUserId,
      tenantId: mockTenantId,
      adSoyad: "Ahmet Satış",
      pinKodu: "1453",
    });

    mockPrisma.ajanOturumu.findUnique.mockResolvedValue({
      id: mockOturumId,
      tenantId: mockTenantId,
      userId: mockUserId,
      pinDogrulandi: false,
      sonEtkilesim: new Date(),
    });

    const sonuc = await service.mesajiIsle({
      kanal: "WHATSAPP",
      kanalKimlik: "+905321112233",
      mesaj: "1453",
    });

    expect(sonuc.pinGerekiyor).toBe(false);
    expect(sonuc.cevap).toContain("PIN kodunuz doğrulandı");
    expect(mockPrisma.ajanOturumu.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockOturumId },
        data: expect.objectContaining({ pinDogrulandi: true }),
      }),
    );
  });

  it("3. Bakiye Sorgulama: Cari borç/alacak bakiyesini başarıyla hesaplayıp özetlemelidir", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: mockUserId,
      tenantId: mockTenantId,
      adSoyad: "Mustafa Yönetici",
      pinKodu: null,
    });

    mockPrisma.ajanOturumu.findUnique.mockResolvedValue({
      id: mockOturumId,
      tenantId: mockTenantId,
      userId: mockUserId,
      pinDogrulandi: true,
      sonEtkilesim: new Date(),
    });

    mockTx.cariHesap.findMany.mockResolvedValue([
      {
        id: "cari-1",
        kod: "CAR001",
        unvan: "Yılmaz Ticaret Ltd.",
        eposta: "yilmaz@ticaret.com",
        telefon: "05320000000",
      },
    ]);

    mockTx.cariHareket.findMany.mockResolvedValue([
      { tip: "borc", tutarTry: new Prisma.Decimal(15000) },
      { tip: "alacak", tutarTry: new Prisma.Decimal(5000) },
    ]);

    const sonuc = await service.mesajiIsle({
      kanal: "WHATSAPP",
      kanalKimlik: "+905321112233",
      mesaj: "Yılmaz Ticaret bakiye sorgula",
    });

    expect(sonuc.eylem).toBe("bakiye_sorgula");
    expect(sonuc.cevap).toContain("Yılmaz Ticaret Ltd.");
    expect(sonuc.cevap).toContain("10.000,00 TL");
    expect(sonuc.cevap).toContain("Borçlu");
  });

  it("4. Stok Sorgulama: Ürünün depodaki mevcudunu ve liste fiyatını dönmelidir", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: mockUserId,
      tenantId: mockTenantId,
      adSoyad: "Mustafa",
      pinKodu: null,
    });

    mockPrisma.ajanOturumu.findUnique.mockResolvedValue({
      id: mockOturumId,
      tenantId: mockTenantId,
      userId: mockUserId,
      pinDogrulandi: true,
      sonEtkilesim: new Date(),
    });

    mockTx.stokKart.findMany.mockResolvedValue([
      {
        id: "stok-1",
        kod: "STK-A4",
        ad: "A4 Fotokopi Kağıdı 80g",
        anaBirim: "koli",
        satisFiyati: new Prisma.Decimal(125.0),
        mevcutMiktar: new Prisma.Decimal(450),
      },
    ]);

    const sonuc = await service.mesajiIsle({
      kanal: "WHATSAPP",
      kanalKimlik: "+905321112233",
      mesaj: "A4 Kağıt stoğu ne kadar?",
    });

    expect(sonuc.eylem).toBe("stok_sorgula");
    expect(sonuc.cevap).toContain("450 koli");
    expect(sonuc.cevap).toContain("125.00 TL");
  });

  it("5. Teklif Taslağı Hazırlama: Doğal dilden taslak teklif oluşturmalı ve onay talimatı vermelidir", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: mockUserId,
      tenantId: mockTenantId,
      adSoyad: "Mustafa",
      pinKodu: null,
    });

    mockPrisma.ajanOturumu.findUnique.mockResolvedValue({
      id: mockOturumId,
      tenantId: mockTenantId,
      userId: mockUserId,
      pinDogrulandi: true,
      sonEtkilesim: new Date(),
    });

    mockTx.cariHesap.findMany.mockResolvedValue([
      {
        id: "cari-1",
        kod: "CAR001",
        unvan: "Yılmaz Ticaret Ltd.",
        grup: { ad: "Bayi" },
      },
    ]);

    mockTx.stokKart.findMany.mockResolvedValue([
      {
        id: "stok-1",
        kod: "STK-A4",
        ad: "A4 Kağıt",
        anaBirim: "koli",
        satisFiyati: new Prisma.Decimal(100.0),
        alisFiyati: new Prisma.Decimal(70.0),
      },
    ]);

    mockTx.belge.create.mockResolvedValue({
      id: "teklif-1",
      no: "TKF-2026-0001",
    });

    const sonuc = await service.mesajiIsle({
      kanal: "WHATSAPP",
      kanalKimlik: "+905321112233",
      mesaj: "Yılmaz Ticarete 50 koli A4 Kağıt için 30 gün vadeli teklif açalım, birim fiyat 120 TL olsun",
    });

    expect(sonuc.eylem).toBe("teklif_taslagi");
    expect(sonuc.cevap).toContain("TKF-2026-0001");
    expect(sonuc.cevap).toContain("TASLAK olarak hazırlandı");
    expect(sonuc.cevap).toContain("ONAYLA");
    expect(mockTx.belge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tur: "teklif",
          durum: "taslak",
          cariId: "cari-1",
          odemeVadeGun: 30,
        }),
      }),
    );
  });

  it("6. Teklif Onaylama: 'ONAYLA' komutu ile bekleyen teklifi onaylandı durumuna geçirmelidir", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: mockUserId,
      tenantId: mockTenantId,
      adSoyad: "Mustafa",
      pinKodu: null,
    });

    mockPrisma.ajanOturumu.findUnique.mockResolvedValue({
      id: mockOturumId,
      tenantId: mockTenantId,
      userId: mockUserId,
      pinDogrulandi: true,
      sonEtkilesim: new Date(),
    });

    mockTx.belge.findFirst.mockResolvedValue({
      id: "teklif-1",
      no: "TKF-2026-0001",
      genelToplam: new Prisma.Decimal(7200),
      cari: { unvan: "Yılmaz Ticaret Ltd." },
    });

    mockTx.belge.update.mockResolvedValue({
      id: "teklif-1",
      no: "TKF-2026-0001",
      durum: "onaylandi",
    });

    const sonuc = await service.mesajiIsle({
      kanal: "WHATSAPP",
      kanalKimlik: "+905321112233",
      mesaj: "ONAYLA",
    });

    expect(sonuc.eylem).toBe("teklif_onayla");
    expect(sonuc.cevap).toContain("TKF-2026-0001");
    expect(sonuc.cevap).toContain("ONAYLANDI");
    expect(mockTx.belge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "teklif-1" },
        data: { durum: "onaylandi" },
      }),
    );
  });

  it("7. Belge Dağıtımı: Onaylanan teklif e-posta veya WhatsApp ile iletilmelidir", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: mockUserId,
      tenantId: mockTenantId,
      adSoyad: "Mustafa",
      pinKodu: null,
    });

    mockPrisma.ajanOturumu.findUnique.mockResolvedValue({
      id: mockOturumId,
      tenantId: mockTenantId,
      userId: mockUserId,
      pinDogrulandi: true,
      sonEtkilesim: new Date(),
    });

    mockTx.belge.findFirst.mockResolvedValue({
      id: "teklif-1",
      no: "TKF-2026-0001",
      cari: {
        unvan: "Yılmaz Ticaret Ltd.",
        eposta: "ahmet@yilmaz.com",
        kisiler: [],
      },
    });

    const sonuc = await service.mesajiIsle({
      kanal: "WHATSAPP",
      kanalKimlik: "+905321112233",
      mesaj: "TKF-2026-0001 nolu teklifi e-posta ile müşteriye gönder",
    });

    expect(sonuc.eylem).toBe("belge_gonder");
    expect(sonuc.cevap).toContain("TKF-2026-0001");
    expect(sonuc.cevap).toContain("ahmet@yilmaz.com");
  });
});
