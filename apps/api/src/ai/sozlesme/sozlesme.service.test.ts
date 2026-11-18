import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SozlesmeService } from "./sozlesme.service";

describe("SozlesmeService", () => {
  let service: SozlesmeService;
  let mockPrisma: any;
  let mockDepo: any;

  const tenantId = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";
  const belgeId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    mockDepo = {
      yukle: vi.fn().mockResolvedValue(undefined),
      indir: vi.fn().mockResolvedValue(Buffer.from("örnek içerik")),
      sil: vi.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      tenantIslem: vi.fn((_tId: string, cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
      sozlesmeBelge: {
        create: vi.fn().mockImplementation(({ data }: any) => ({
          id: belgeId,
          ...data,
          cari: null,
          _count: { parcalar: data.parcalar?.create?.length ?? 0 },
        })),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation(({ data }: any) => ({ id: belgeId, ...data })),
        delete: vi.fn().mockResolvedValue({ id: belgeId }),
      },
      sozlesmeBelgeParca: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    service = new SozlesmeService(mockPrisma, mockDepo);
  });

  describe("yukle", () => {
    it("boş dosya verildiğinde BadRequestException fırlatır", async () => {
      await expect(
        service.yukle(
          tenantId,
          userId,
          { buffer: Buffer.from(""), dosyaAdi: "sozlesme.txt", mimeTip: "text/plain" },
          { baslik: "Test Sözleşmesi" },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("yeterli metin katmanı olmayan dosyada BadRequestException fırlatır", async () => {
      await expect(
        service.yukle(
          tenantId,
          userId,
          { buffer: Buffer.from("kısa metin"), dosyaAdi: "sozlesme.txt", mimeTip: "text/plain" },
          { baslik: "Test Sözleşmesi" },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("geçerli metin dosyasını parçalar, depoya yükler ve veritabanına kaydeder", async () => {
      const metin = `
[Sayfa 1]
YAZILIM LİSANS VE BAKIM SÖZLEŞMESİ
Madde 1: Taraflar
TekirExtra A.Ş. ile Müşteri arasında akdedilmiştir.

[Sayfa 2]
Madde 2: Lisans Bedeli ve Ödeme Koşulları
Yıllık lisans bedeli 120.000 TL olup fatura tarihinden itibaren 30 gün içinde ödenir.
Gecikme faizi aylık %3 olarak uygulanacaktır.
      `;

      const buffer = Buffer.from(metin);
      const sonuc = await service.yukle(
        tenantId,
        userId,
        { buffer, dosyaAdi: "lisans_sozlesmesi.txt", mimeTip: "text/plain" },
        { baslik: "Yazılım Lisans Sözleşmesi 2026", tur: "sozlesme" },
      );

      expect(sonuc.id).toBe(belgeId);
      expect(mockDepo.yukle).toHaveBeenCalled();
      expect(mockPrisma.sozlesmeBelge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            baslik: "Yazılım Lisans Sözleşmesi 2026",
            tur: "sozlesme",
          }),
        }),
      );
    });
  });

  describe("listele", () => {
    it("yetkili roller kısıtını dikkate alarak belgeleri süzgeçten geçirir", async () => {
      mockPrisma.sozlesmeBelge.findMany.mockResolvedValue([
        { id: "b1", baslik: "Genel Sözleşme", yetkiliRoller: null },
        { id: "b2", baslik: "Finans Sözleşmesi", yetkiliRoller: ["muhasebe", "yonetici"] },
        { id: "b3", baslik: "Gizli Yönetim Sözleşmesi", yetkiliRoller: ["yonetici"] },
      ]);

      // Yönetici hepsini görür
      const yoneticiListesi = await service.listele(tenantId, "yonetici");
      expect(yoneticiListesi).toHaveLength(3);

      // Muhasebe b3'ü göremez
      const muhasebeListesi = await service.listele(tenantId, "muhasebe");
      expect(muhasebeListesi).toHaveLength(2);
      expect(muhasebeListesi.map((b) => b.id)).toEqual(["b1", "b2"]);

      // Satış yalnızca b1'i görür
      const satisListesi = await service.listele(tenantId, "satis");
      expect(satisListesi).toHaveLength(1);
      expect(satisListesi[0].id).toBe("b1");
    });
  });

  describe("detay", () => {
    it("belge bulunamazsa NotFoundException fırlatır", async () => {
      mockPrisma.sozlesmeBelge.findUnique.mockResolvedValue(null);
      await expect(service.detay(tenantId, "olmayan-id", "yonetici")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("yetkisiz rol erişmeye çalışırsa ForbiddenException fırlatır", async () => {
      mockPrisma.sozlesmeBelge.findUnique.mockResolvedValue({
        id: belgeId,
        tenantId,
        baslik: "Yönetici Özel Sözleşmesi",
        yetkiliRoller: ["yonetici"],
      });

      await expect(service.detay(tenantId, belgeId, "satis")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("sor (RAG)", () => {
    it("eşleşen parça bulunamadığında güvenli olgu reddi yanıtı döner", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const sonuc = await service.sor(
        tenantId,
        userId,
        "yonetici",
        "Bu sözleşmede uçağa biniş kuralları nedir?",
      );

      expect(sonuc.guvenSkoru).toBe("yok");
      expect(sonuc.cevap).toContain("hüküm veya bilgi bulunmamaktadır");
      expect(sonuc.kaynaklar).toEqual([]);
    });
  });

  describe("sil", () => {
    it("yönetici olmayan ve belgeyi yüklemeyen kullanıcı silemez", async () => {
      mockPrisma.sozlesmeBelge.findUnique.mockResolvedValue({
        id: belgeId,
        tenantId,
        yukleyenUserId: "baska-kullanici-id",
        depoAnahtari: "key-1",
      });

      await expect(
        service.sil(tenantId, belgeId, "muhasebe", userId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("yönetici belgeyi ve depodaki dosyasını siler", async () => {
      mockPrisma.sozlesmeBelge.findUnique.mockResolvedValue({
        id: belgeId,
        tenantId,
        yukleyenUserId: "baska-kullanici-id",
        depoAnahtari: "sozlesmeler/test-file.pdf",
      });

      const sonuc = await service.sil(tenantId, belgeId, "yonetici", userId);
      expect(sonuc.silindi).toBe(true);
      expect(mockDepo.sil).toHaveBeenCalledWith("sozlesmeler/test-file.pdf");
      expect(mockPrisma.sozlesmeBelge.delete).toHaveBeenCalledWith({
        where: { id: belgeId },
      });
    });
  });
});
