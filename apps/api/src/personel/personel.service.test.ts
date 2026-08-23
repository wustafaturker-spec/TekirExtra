import { describe, it, expect, beforeEach, vi } from "vitest";
import { PersonelService } from "./personel.service";

describe("PersonelService", () => {
  let service: PersonelService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)),
      personel: {
        findMany: vi.fn().mockResolvedValue([
          { id: "p-1", ad: "Ahmet", soyad: "Yılmaz", netMaas: 30000 }
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

  it("tahakkuk listesinde dönem ve aktif durum filtresini uygular", async () => {
    await service.bordroTopluTahakkuk("tenant-1", "user-1", { donemYil: 2026, donemAy: 8 });
    expect(mockPrisma.personel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ aktif: true, durum: "aktif" }),
    }));
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
      tenantId: "tenant-1", cariId: "cari-1", tip: "alacak", tutar: 30000,
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
