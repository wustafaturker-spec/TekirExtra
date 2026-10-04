import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { PersonelService } from "./personel.service";

describe("PersonelService", () => {
  let service: PersonelService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)),
      personel: {
        findMany: vi.fn().mockResolvedValue([
          { id: "p-1", ad: "Ahmet", soyad: "Yılmaz", netMaas: 30000, ucretler: [{ yururlukTarihi: new Date("2020-01-01T00:00:00Z"), tip: "net", tutar: 30000 }], istihdamDonemleri: [{ baslangicTarihi: new Date("2025-01-01"), bitisTarihi: null }] }
        ]),
        findFirst: vi.fn().mockResolvedValue({ id: "p-1", ad: "Ahmet", soyad: "Yılmaz", netMaas: 30000 }),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "p-1", ...data })),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "p-1", ...data })),
      },
      personelSayac: {
        upsert: vi.fn().mockResolvedValue({ tenantId: "tenant-1", sonSira: 1 }),
      },
      cariHesap: {
        create: vi.fn().mockResolvedValue({ id: "cari-1", kod: "PRS-000001" }),
      },
      cariHareket: {
        create: vi.fn().mockResolvedValue({ id: "cari-hareket-1" }),
      },
      personelBordro: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({
          id: "bordro-1", durum: "onay_bekliyor", olusturanUserId: "hazirlayan",
          personel: { id: "p-1" }, kalemler: [],
        }),
        create: vi.fn().mockResolvedValue({ id: "bordro-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: "bordro-1" }),
      },
      personelDonemCalisma: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      bordroMevzuatSeti: { findFirst: vi.fn().mockResolvedValue(null) },
      personelIzinTalebi: { findMany: vi.fn().mockResolvedValue([]) },
      personelBordroKalemi: {
        create: vi.fn().mockResolvedValue({ id: "kalem-1" }),
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    service = new PersonelService(mockPrisma);
  });

  it("personel listesini getirmelidir", async () => {
    const sonuct = await service.listele("tenant-1");
    expect(sonuct).toHaveLength(1);
    expect(sonuct[0].ad).toBe("Ahmet");
  });

  it("yeni personel eklerken otomatik personel cari hesabı da oluşturmalıdır", async () => {
    const yeni = await service.olustur("tenant-1", {
      ad: "Mehmet",
      soyad: "Demir",
      netMaas: 25000,
      girisTarihi: new Date("2026-01-01"),
      calismaTipi: "tam_zamanli",
      cariOlustur: true,
    });

    expect(mockPrisma.cariHesap.create).toHaveBeenCalled();
    expect(mockPrisma.personel.create).toHaveBeenCalled();
    expect(yeni.ad).toBe("Mehmet");
    expect(yeni.personelNo).toBe("PRS-000001");
  });

  it("tahakkuk kapsamını dönemle kesişen istihdamdan alır, yalnız taslağı dışarıda bırakır (PRS-02)", async () => {
    await service.bordroTopluTahakkuk("tenant-1", "user-1", { donemYil: 2026, donemAy: 8 });
    expect(mockPrisma.personel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        durum: { not: "taslak" },
        istihdamDonemleri: { some: { baslangicTarihi: { lte: new Date("2026-08-31T00:00:00Z") }, OR: [{ bitisTarihi: null }, { bitisTarihi: { gte: new Date("2026-08-01T00:00:00Z") } }] } },
      }),
    }));
  });

  it("ay içinde işe girene istihdam günü kadar prim günü ve ücret tahakkuk eder (PRS-02)", async () => {
    mockPrisma.personel.findMany.mockResolvedValue([{ id: "p-1", ad: "Ahmet", soyad: "Yılmaz", netMaas: 30000, brutMaas: null, ucretler: [{ yururlukTarihi: new Date("2020-01-01T00:00:00Z"), tip: "net", tutar: 30000 }], istihdamDonemleri: [{ baslangicTarihi: new Date("2026-09-20T00:00:00Z"), bitisTarihi: null }] }]);
    await service.bordroTopluTahakkuk("tenant-1", "user-1", { donemYil: 2026, donemAy: 9 });
    expect(mockPrisma.personelBordro.create).toHaveBeenCalledWith({ data: expect.objectContaining({ primGunu: 11, netMaas: expect.objectContaining({}) }) });
    const veri = mockPrisma.personelBordro.create.mock.calls[0][0].data;
    expect(veri.netMaas.toFixed(2)).toBe("11000.00");
  });

  it("işten çıkış ayında çıkış günü dahil tahakkuk eder (PRS-02)", async () => {
    mockPrisma.personel.findMany.mockResolvedValue([{ id: "p-1", ad: "Ahmet", soyad: "Yılmaz", netMaas: 30000, brutMaas: null, durum: "isten_ayrildi", ucretler: [{ yururlukTarihi: new Date("2020-01-01T00:00:00Z"), tip: "net", tutar: 30000 }], istihdamDonemleri: [{ baslangicTarihi: new Date("2025-01-01T00:00:00Z"), bitisTarihi: new Date("2026-10-15T00:00:00Z") }] }]);
    await service.bordroTopluTahakkuk("tenant-1", "user-1", { donemYil: 2026, donemAy: 10 });
    expect(mockPrisma.personelBordro.create.mock.calls[0][0].data.primGunu).toBe(15);
  });

  it("puantaj yoksa onaylı ücretsiz izin prim gününden düşer ve eksik gün nedeni yazılır (PRS-09)", async () => {
    mockPrisma.personelIzinTalebi.findMany.mockResolvedValue([{ personelId: "p-1", baslangicTarihi: new Date("2026-10-20T00:00:00Z"), bitisTarihi: new Date("2026-10-31T00:00:00Z"), izinTuru: { kod: "ucretsiz" } }]);
    await service.bordroTopluTahakkuk("tenant-1", "user-1", { donemYil: 2026, donemAy: 10 });
    const veri = mockPrisma.personelBordro.create.mock.calls[0][0].data;
    expect(veri.primGunu).toBe(18);
    expect(veri.eksikGunNedeni).toBe("ucretsiz_izin");
    expect(veri.netMaas.toFixed(2)).toBe("18000.00");
  });

  it("puantajda prim günü istihdam gününe göre denetlenir (PRS-02)", async () => {
    mockPrisma.personel.findFirst.mockResolvedValue({ id: "p-1", istihdamDonemleri: [{ baslangicTarihi: new Date("2026-09-20T00:00:00Z"), bitisTarihi: null }] });
    mockPrisma.personelDonemCalisma = { upsert: vi.fn().mockResolvedValue({}) };
    const temel = { personelId: "01010101-0101-4101-8101-010101010101", yil: 2026, ay: 9 };
    await expect(service.donemCalismaKaydet("tenant-1", { ...temel, primGunu: 12 } as never)).rejects.toThrow("istihdam gününü (11) aşamaz");
    await expect(service.donemCalismaKaydet("tenant-1", { ...temel, primGunu: 9 } as never)).rejects.toThrow("eksik gün nedeni zorunludur");
    await expect(service.donemCalismaKaydet("tenant-1", { ...temel, primGunu: 11 } as never)).resolves.toBeDefined();
  });

  it("işten çıkış tarihinin giriş tarihinden önce olmasını reddeder", async () => {
    mockPrisma.personel.findFirst.mockResolvedValue({
      id: "p-1",
      durum: "aktif",
      girisTarihi: new Date("2026-08-10"),
    });
    await expect(service.istenCikar("tenant-1", "p-1", {
      cikisTarihi: new Date("2026-08-01"),
      ayrilisNedeni: "İstifa",
    })).rejects.toThrow("Çıkış tarihi işe giriş tarihinden önce olamaz");
  });

  it("bordroyu hazırlayan kullanıcının aynı bordroyu onaylamasını engeller", async () => {
    await expect(service.bordroOnayla("tenant-1", "bordro-1", "hazirlayan"))
      .rejects.toThrow("Bordroyu hazırlayan kullanıcı aynı bordroyu onaylayamaz");
    expect(mockPrisma.personelBordro.updateMany).not.toHaveBeenCalled();
  });

  it("bordro onayında personel carisine maaş tahakkuku işler", async () => {
    mockPrisma.personelBordro.findFirst.mockResolvedValue({
      id: "bordro-1", durum: "onay_bekliyor", olusturanUserId: "hazirlayan",
      donemYil: 2026, donemAy: 8, odenecekTutar: 30000,
      personel: { id: "p-1", cariId: "cari-1" }, kalemler: [], odemeler: [],
    });

    await service.bordroOnayla("tenant-1", "bordro-1", "onaylayan");

    expect(mockPrisma.cariHareket.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: "tenant-1", cariId: "cari-1", tip: "alacak", tutar: new Prisma.Decimal(30000),
      kaynakTur: "bordro_tahakkuk", kaynakRef: "bordro-1",
    }) });
  });

  it("hesaplanan bordroyu koşullu güncellemeyle onaya gönderir", async () => {
    await service.bordroOnayaGonder("tenant-1", "bordro-1");
    expect(mockPrisma.personelBordro.updateMany).toHaveBeenCalledWith({
      where: { id: "bordro-1", tenantId: "tenant-1", durum: "hesaplandi" },
      data: { durum: "onay_bekliyor" },
    });
  });

  it("temel ücret gibi otomatik bordro kalemlerinin silinmesini engeller", async () => {
    await expect(service.bordroKalemSil("tenant-1", "bordro-1", "temel-kalem"))
      .rejects.toThrow("Temel veya bulunamayan bordro kalemi silinemez");
  });
});
