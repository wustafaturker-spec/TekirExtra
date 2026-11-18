import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../../core/istek-baglami";
import { HazirlikService } from "./hazirlik.service";

describe("HazirlikService", () => {
  let service: HazirlikService;
  let mockPrisma: any;
  let mockHafiza: any;

  const tenantId = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";
  const baskaUserId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    mockHafiza = { yaz: vi.fn().mockResolvedValue({}) };
    mockPrisma = {
      tenantIslem: vi.fn((_tid: string, islem: (tx: any) => Promise<any>) => islem(mockPrisma.tx)),
      tx: {
        fatura: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
        faturaSatir: {
          update: vi.fn().mockResolvedValue({}),
        },
        stokKart: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        bankaEkstreSatir: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue({}),
          count: vi.fn().mockResolvedValue(0),
        },
        cariHesap: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue({ id: "cari-1", unvan: "Tedarikçi AŞ" }),
        },
        crmEtkilesim: {
          create: vi.fn().mockResolvedValue({ id: "crm-1" }),
        },
        belge: {
          create: vi.fn().mockResolvedValue({ id: "belge-1" }),
        },
        aiOnayTalebi: {
          count: vi.fn().mockResolvedValue(0),
        },
        aiHazirlik: {
          findUnique: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
          upsert: vi.fn().mockResolvedValue({ id: "haz-1" }),
          update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          groupBy: vi.fn().mockResolvedValue([]),
        },
      },
    };

    service = new HazirlikService(mockPrisma as any, mockHafiza as any);
  });

  describe("listele", () => {
    it("yonetici olmayan kullanıcı firma genelini listeleyemez", async () => {
      await expect(
        baglamlaCalistir({ tenantId, userId, rol: "satis" }, () =>
          service.listele("firma"),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("kullanıcı kendi hazırlıklarını listeleyebilir", async () => {
      mockPrisma.tx.aiHazirlik.findMany.mockResolvedValue([
        {
          id: "h-1",
          tur: "fatura_stok_esleme",
          durum: "hazir",
          baslik: "Örnek",
          ozet: "Özet",
          oneri: {},
          kanit: null,
          alternatifler: null,
          hedefOzeti: "hash123",
          gecerlilikBitisAt: new Date(Date.now() + 86400000),
          olusturanUser: { adSoyad: "Ali Veli" },
          onaylayanUser: null,
          kararAt: null,
          kararNotu: null,
          olusanKayitTur: null,
          olusanKayitId: null,
          createdAt: new Date(),
        },
      ]);

      const sonuc = await baglamlaCalistir({ tenantId, userId, rol: "satis" }, () =>
        service.listele("bana"),
      );

      expect(sonuc.length).toBe(1);
      expect(sonuc[0].id).toBe("h-1");
      expect(sonuc[0].turBasligi).toBe("Gelen Fatura Stok Eşleştirmesi");
    });
  });

  describe("onayla", () => {
    it("hazırlık bulunamazsa NotFoundException fırlatır", async () => {
      mockPrisma.tx.aiHazirlik.findUnique.mockResolvedValue(null);

      await expect(
        baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, () =>
          service.onayla("yok-id"),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("başka kullanıcının hazırlığını yönetici olmayan onaylayamaz", async () => {
      mockPrisma.tx.aiHazirlik.findUnique.mockResolvedValue({
        id: "h-1",
        tenantId,
        olusturanUserId: baskaUserId,
        durum: "hazir",
        gecerlilikBitisAt: new Date(Date.now() + 86400000),
      });

      await expect(
        baglamlaCalistir({ tenantId, userId, rol: "satis" }, () =>
          service.onayla("h-1"),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("süresi dolmuş hazırlık onaylanamaz", async () => {
      mockPrisma.tx.aiHazirlik.findUnique.mockResolvedValue({
        id: "h-1",
        tenantId,
        olusturanUserId: userId,
        durum: "hazir",
        gecerlilikBitisAt: new Date(Date.now() - 3600000), // süresi geçmiş
      });

      await expect(
        baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, () =>
          service.onayla("h-1"),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("kaynak kayıt değiştiyse hedef_degisti olarak işaretlenir ve ConflictException fırlatır", async () => {
      mockPrisma.tx.aiHazirlik.findUnique.mockResolvedValue({
        id: "h-1",
        tenantId,
        olusturanUserId: userId,
        durum: "hazir",
        tur: "fatura_stok_esleme",
        kaynakTur: "fatura",
        kaynakId: "fatura-1",
        hedefOzeti: "eski_hash_12345",
        gecerlilikBitisAt: new Date(Date.now() + 86400000),
      });

      mockPrisma.tx.fatura.findUnique.mockResolvedValue({
        id: "fatura-1",
        durum: "onaylandi", // taslaktı, onaylandı!
        genelToplam: { toString: () => "5000" },
      });

      await expect(
        baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, () =>
          service.onayla("h-1"),
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.tx.aiHazirlik.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "h-1" },
          data: { durum: "hedef_degisti" },
        }),
      );
    });

    it("geçerli fatura_stok_esleme onaylandığında stok kartını günceller ve hafızaya yazar", async () => {
      mockPrisma.tx.aiHazirlik.findUnique.mockResolvedValue({
        id: "h-1",
        tenantId,
        olusturanUserId: userId,
        durum: "hazir",
        tur: "fatura_stok_esleme",
        kaynakTur: null,
        kaynakId: null,
        hedefOzeti: null,
        oneri: { satirId: "satir-1", stokId: "stok-1", stokAd: "Cıvata M8" },
        gecerlilikBitisAt: new Date(Date.now() + 86400000),
      });

      const sonuc = await baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, () =>
        service.onayla("h-1"),
      );

      expect(sonuc.durum).toBe("onaylandi");
      expect(sonuc.olusanKayitTur).toBe("fatura_satir");
      expect(mockPrisma.tx.faturaSatir.update).toHaveBeenCalledWith({
        where: { id: "satir-1" },
        data: { stokId: "stok-1" },
      });
      expect(mockHafiza.yaz).toHaveBeenCalledWith(
        expect.objectContaining({ stokId: "stok-1", anahtar: "Cıvata M8", tur: "urun_eslesme" }),
      );
    });
  });

  describe("reddet", () => {
    it("hazırlığı reddeder ve karar notunu kaydeder", async () => {
      mockPrisma.tx.aiHazirlik.findUnique.mockResolvedValue({
        id: "h-1",
        tenantId,
        olusturanUserId: userId,
        durum: "hazir",
      });

      const sonuc = await baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, () =>
        service.reddet("h-1", "Hatalı öneri"),
      );

      expect(sonuc.durum).toBe("reddedildi");
      expect(mockPrisma.tx.aiHazirlik.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "h-1" },
          data: expect.objectContaining({
            durum: "reddedildi",
            kararNotu: "Hatalı öneri",
          }),
        }),
      );
    });
  });

  describe("topluOnayla & topluReddet", () => {
    it("toplu onay başarılı ve hatalı olanları ayırır", async () => {
      mockPrisma.tx.aiHazirlik.findUnique
        .mockResolvedValueOnce({
          id: "h-1",
          tenantId,
          olusturanUserId: userId,
          durum: "hazir",
          tur: "ay_sonu_kapanis",
          oneri: { donem: "2026-11" },
          gecerlilikBitisAt: new Date(Date.now() + 86400000),
        })
        .mockResolvedValueOnce(null); // h-2 bulunamadı

      const sonuc = await baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, () =>
        service.topluOnayla(["h-1", "h-2"]),
      );

      expect(sonuc.basarili).toEqual(["h-1"]);
      expect(sonuc.basarisiz.length).toBe(1);
      expect(sonuc.basarisiz[0].id).toBe("h-2");
    });
  });

  describe("sabahBrifingiOzeti", () => {
    it("bekleyen hazırlıkları brifing metnine dönüştürür", async () => {
      mockPrisma.tx.aiHazirlik.groupBy.mockResolvedValue([
        { tur: "fatura_stok_esleme", _count: { id: 3 } },
        { tur: "kritik_stok_talep", _count: { id: 1 } },
      ]);

      const sonuc = await baglamlaCalistir({ tenantId, userId, rol: "yonetici" }, () =>
        service.sabahBrifingiOzeti(tenantId),
      );

      expect(sonuc.toplam).toBe(4);
      expect(sonuc.dagilim.fatura_stok_esleme).toBe(3);
      expect(sonuc.metin).toContain("4 hazırlık var");
      expect(sonuc.metin).toContain("Stok Eşleme");
    });
  });
});
