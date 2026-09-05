import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { BelgelerService } from "./belgeler.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
}));

describe("BelgelerService", () => {
  it("eşzamanlı işlemde kapanan belge sayısı değişirse taslağı geri aldırır", async () => {
    const belge = {
      id: "b1",
      no: "SP-001",
      durum: "onaylandi",
      tur: "siparis",
      cariId: "c1",
      dovizCinsi: "TRY",
      kur: new Prisma.Decimal(1),
      yon: "satis",
      depoId: "d1",
      satirlar: [],
    };
    const tx = {
      belge: {
        findMany: vi.fn().mockResolvedValue([belge]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      fatura: { create: vi.fn().mockResolvedValue({ id: "f1" }) },
      faturaSatir: { create: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await expect(service.topluFatura({ belgeIds: ["b1"] })).rejects.toThrow(ConflictException);
    expect(tx.belge.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, durum: "onaylandi", faturaId: null },
      data: { durum: "kapandi", faturaId: "f1" },
    });
  });

  it("sonraki sayfa imlecini son döndürülen belgeye koyar", async () => {
    const belge = (id: string) => ({
      id, tur: "siparis", yon: "satis", durum: "onaylandi", no: id,
      tarih: new Date("2026-08-08"), gecerlilikTarihi: null, cariId: "c1", depoId: "d1",
      dovizCinsi: "TRY", kur: new Prisma.Decimal(1), genelIskontoYuzdesi: new Prisma.Decimal(0),
      genelIskontoTutari: new Prisma.Decimal(0), toplamBrut: new Prisma.Decimal(100),
      toplamSatirIskontosu: new Prisma.Decimal(0), genelIskontoToplam: new Prisma.Decimal(0),
      toplamMatrah: new Prisma.Decimal(100), toplamKdv: new Prisma.Decimal(20),
      toplamTevkifat: new Prisma.Decimal(0), toplamNetKdv: new Prisma.Decimal(20),
      genelToplam: new Prisma.Decimal(120), aciklama: null, notlar: null, kaynakBelgeId: null, faturaId: null,
      cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
    });
    const findMany = vi.fn().mockResolvedValue([belge("b1"), belge("b2"), belge("b3")]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ belge: { findMany } })),
    } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    const sonuc = await service.listele(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 2);

    expect(sonuc.kayitlar.map((kayit) => kayit.id)).toEqual(["b1", "b2"]);
    expect(sonuc.sonrakiImlec).toBe("b2");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });
});
