import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { B2bService } from "./b2b.service";

const cariId = "11111111-1111-4111-8111-111111111111";
const baskaCariId = "33333333-3333-4333-8333-333333333333";
const stokId = "22222222-2222-4222-8222-222222222222";
const anahtar = "44444444-4444-4444-8444-444444444444";

describe("B2bService", () => {
  let service: B2bService;
  let db: any;

  beforeEach(() => {
    db = {
      tenantIslem: vi.fn((_tenantId, cb) => cb(db)),
      user: { findFirst: vi.fn().mockResolvedValue({ bayiCariId: cariId }) },
      cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: cariId, aktif: true, varsayilanIskonto: 10, fiyatListesi: { id: "liste-1", aktif: true, kalemler: [{ stokId, fiyat: 800 }] } }) },
      stokKart: { findMany: vi.fn().mockResolvedValue([{ id: stokId, kod: "URUN01", ad: "Laptop", satisFiyati: 1000, anaBirim: "adet", kdvOrani: 10 }]) },
      cariHareket: { findMany: vi.fn().mockResolvedValue([]) },
      belgeSayac: { upsert: vi.fn().mockResolvedValue({ sonSira: 1 }) },
      belge: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "belge-1", ...data })),
      },
    };
    service = new B2bService(db, { tarihDogrula: vi.fn() } as any);
  });

  it("bayi kataloğunda aktif fiyat listesi ile cari iskontosunu birlikte uygular", async () => {
    const katalog = await service.bayiKatalogGetir("tenant-1", "user-1", "b2b_bayi");
    expect(katalog[0].bayiBirimFiyati.toString()).toBe("720");
  });

  it("B2B kullanıcısının başka cariye erişmesini reddeder", async () => {
    await expect(service.bayiEkstreGetir("tenant-1", "user-1", "b2b_bayi", baskaCariId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.cariHareket.findMany).not.toHaveBeenCalled();
  });

  it("siparişi liste fiyatı, iskonto ve kalemin gerçek KDV oranıyla hesaplar", async () => {
    await service.siparisOlustur("tenant-1", "user-1", "b2b_bayi", { idempotencyAnahtari: anahtar, kalemler: [{ stokId, miktar: 2 }] });
    const data = db.belge.create.mock.calls[0][0].data;
    expect(data.toplamBrut.toString()).toBe("1600");
    expect(data.toplamSatirIskontosu.toString()).toBe("160");
    expect(data.toplamKdv.toString()).toBe("144");
    expect(data.genelToplam.toString()).toBe("1584");
    expect(data.satirlar.create[0].fiyatListesiId).toBe("liste-1");
  });

  it("eksik veya pasif tek bir ürün varsa siparişin tamamını reddeder", async () => {
    db.stokKart.findMany.mockResolvedValue([]);
    await expect(service.siparisOlustur("tenant-1", "user-1", "b2b_bayi", { idempotencyAnahtari: anahtar, kalemler: [{ stokId, miktar: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.belge.create).not.toHaveBeenCalled();
  });

  it("aynı idempotency anahtarında mevcut siparişi döndürür", async () => {
    db.belge.findUnique.mockResolvedValue({ id: "mevcut", satirlar: [] });
    const sonuc = await service.siparisOlustur("tenant-1", "user-1", "b2b_bayi", { idempotencyAnahtari: anahtar, kalemler: [{ stokId, miktar: 1 }] });
    expect(sonuc.id).toBe("mevcut");
    expect(db.belge.create).not.toHaveBeenCalled();
  });
});
