import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { KasaBankaService } from "./kasa-banka.service";

// Mock the istek baglami (aktifBaglam)
vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({
    tenantId: "t1-uuid",
    rol: "muhasebe",
  }),
}));

describe("KasaBankaService (KSB-01..07)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = {
    tenantIslem: mockTenantIslem,
  } as any;

  const service = new KasaBankaService(mockPrisma);

  it("kasaOlustur yeni bir kasa kaydı oluşturur (KSB-01)", async () => {
    const mockTx = {
      kasa: {
        create: vi.fn().mockResolvedValue({ id: "k1", ad: "Merkez Kasa", dovizCinsi: "TRY" }),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const girdi = { ad: "Merkez Kasa", dovizCinsi: "TRY" as const };
    const sonuc = await service.kasaOlustur(girdi);

    expect(mockTx.kasa.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1-uuid",
        ad: "Merkez Kasa",
        dovizCinsi: "TRY",
      },
    });
    expect(sonuc.id).toBe("k1");
  });

  it("virmanEkle iki ayrı kasa/banka hareketi ve karsiHareketId bağı oluşturur (KSB-03)", async () => {
    const mockTx = {
      kasa: {
        findUnique: vi.fn().mockResolvedValue({ dovizCinsi: "TRY" }),
      },
      kasaBankaHareket: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "gidis-id" }) // 1. çağrı (gidis)
          .mockResolvedValueOnce({ id: "gelis-id" }), // 2. çağrı (gelis)
        update: vi.fn().mockResolvedValue({}),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const girdi = {
      kaynakKasaId: "kasa-source",
      hedefKasaId: "kasa-target",
      tutar: "150.00",
      tarih: "2026-07-12",
      aciklama: "Transfer",
    };

    const sonuc = await service.virmanEkle(girdi);

    expect(mockTx.kasaBankaHareket.create).toHaveBeenCalledTimes(2);
    expect(mockTx.kasaBankaHareket.update).toHaveBeenCalledWith({
      where: { id: "gidis-id" },
      data: { karsiHareketId: "gelis-id" },
    });
    expect(sonuc.gidis.id).toBe("gidis-id");
    expect(sonuc.gelis.id).toBe("gelis-id");
  });

  it("hareketEkle tahsilat durumunda cariye ALACAK yazar (KSB-02/07)", async () => {
    const mockTx = {
      kasaBankaHareket: {
        create: vi.fn().mockResolvedValue({ id: "h1" }),
      },
      cariHareket: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const girdi = {
      kasaId: "kasa-1",
      tip: "tahsilat" as const,
      tutar: "500.00",
      dovizCinsi: "TRY" as const,
      kur: "1.00",
      tarih: "2026-07-12",
      cariId: "cari-1",
      faturaId: "fatura-1",
    };

    await service.hareketEkle(girdi);

    expect(mockTx.kasaBankaHareket.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1-uuid",
        kasaId: "kasa-1",
        bankaHesapId: undefined,
        tip: "tahsilat",
        tutar: new Prisma.Decimal("500.00"),
        dovizCinsi: "TRY",
        kur: new Prisma.Decimal("1.00"),
        tutarTry: new Prisma.Decimal("500.00"),
        tarih: new Date("2026-07-12"),
        aciklama: undefined,
        cariId: "cari-1",
        faturaId: "fatura-1",
        kaynakTur: "fatura_kapama",
        kaynakRef: "fatura-1",
      },
    });

    expect(mockTx.cariHareket.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1-uuid",
        cariId: "cari-1",
        tip: "alacak", // Tahsilat cariyi alacaklandırır!
        tutar: new Prisma.Decimal("500.00"),
        dovizCinsi: "TRY",
        kur: new Prisma.Decimal("1.00"),
        tutarTry: new Prisma.Decimal("500.00"),
        tarih: new Date("2026-07-12"),
        aciklama: "TAHSILAT kasa/banka fişi",
        kaynakTur: "kasa_banka",
        kaynakRef: "h1",
      },
    });
  });

  it("POS brut alacagini net banka virmani ve komisyon gideriyle kapatir (ENT-04)", async () => {
    const create = vi.fn().mockResolvedValueOnce({ id: "gidis" }).mockResolvedValueOnce({ id: "gelis" }).mockResolvedValueOnce({ id: "komisyon" });
    const tx = {
      posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "pos-1", ad: "iyzico POS", aktif: true, dovizCinsi: "TRY", varsayilanBankaHesapId: "banka-1" }) },
      bankaHesap: { findUnique: vi.fn().mockResolvedValue({ id: "banka-1", aktif: true, dovizCinsi: "TRY" }) },
      kasaBankaHareket: { groupBy: vi.fn().mockResolvedValue([{ tip: "tahsilat", _sum: { tutar: new Prisma.Decimal(100) } }]), create, update: vi.fn().mockResolvedValue({}) },
    };
    mockTenantIslem.mockImplementation((_tenantId, cb) => cb(tx));
    const sonuc = await service.posBankayaAktar({ posHesapId: "11111111-1111-4111-8111-111111111111", brutTutar: "100.00", komisyonTutar: "4.00", tarih: "2026-08-11" });
    expect(sonuc).toEqual(expect.objectContaining({ brutTutar: "100.00", netTutar: "96.00", komisyonTutar: "4.00" }));
    expect(create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ posHesapId: "pos-1", tip: "virman_gidis", tutar: new Prisma.Decimal(96) }) });
    expect(create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ bankaHesapId: "banka-1", tip: "virman_gelis", tutar: new Prisma.Decimal(96), karsiHareketId: "gidis" }) });
    expect(create).toHaveBeenNthCalledWith(3, { data: expect.objectContaining({ posHesapId: "pos-1", tip: "tediye", tutar: new Prisma.Decimal(4), kaynakTur: "pos_mutabakat" }) });
  });
});
