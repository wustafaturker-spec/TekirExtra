import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { EkstreService } from "./ekstre.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", rol: "muhasebe" }) }));

const satir = (ek: Record<string, unknown> = {}) => ({
  id: "satir-1", bankaHesapId: "banka-1", tarih: new Date("2026-09-10"), tutar: new Prisma.Decimal("500"),
  aciklama: "EFT ANADOLU KIMYA", durum: "beklemede", hareketId: null, bankaHesap: { dovizCinsi: "TRY" }, ...ek,
});

function hazirla(baslangic = satir(), sahiplenilen = 1) {
  const tx = {
    bankaEkstreSatir: {
      findUnique: vi.fn().mockResolvedValue(baslangic),
      updateMany: vi.fn().mockResolvedValue({ count: sahiplenilen }),
      update: vi.fn().mockResolvedValue({}),
    },
    cariHesap: { findUnique: vi.fn().mockResolvedValue({ id: "cari-1" }) },
    kasaBankaHareket: { findUnique: vi.fn().mockResolvedValue({ id: "h1", kaynakTur: "fatura_kapama" }), deleteMany: vi.fn() },
    cariHareket: { deleteMany: vi.fn() },
  };
  const kasaBanka = { hareketEkle: vi.fn().mockResolvedValue({ id: "h1" }) };
  const donemKilidi = { tarihDogrula: vi.fn() };
  const service = new EkstreService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, kasaBanka as any, donemKilidi as any);
  return { tx, kasaBanka, donemKilidi, service };
}

describe("EkstreService eşleştirme (KSB-06)", () => {
  it("satırı fiş üretmeden önce sahiplenir, sonra fişi bağlar", async () => {
    const { tx, kasaBanka, service } = hazirla();

    await service.eslestir("satir-1", { cariId: "cari-1" });

    expect(tx.bankaEkstreSatir.updateMany).toHaveBeenCalledWith({
      where: { id: "satir-1", durum: { not: "eslesti" }, hareketId: null },
      data: { durum: "eslesti", cariId: "cari-1", faturaId: null },
    });
    expect(kasaBanka.hareketEkle).toHaveBeenCalledTimes(1);
    expect(tx.bankaEkstreSatir.update).toHaveBeenCalledWith({ where: { id: "satir-1" }, data: { hareketId: "h1" } });
  });

  it("satırı başka işlem sahiplendiyse ikinci fişi üretmez", async () => {
    const { kasaBanka, service } = hazirla(satir(), 0);

    await expect(service.eslestir("satir-1", { cariId: "cari-1" })).rejects.toBeInstanceOf(ConflictException);
    expect(kasaBanka.hareketEkle).not.toHaveBeenCalled();
  });

  it("fiş üretilemezse satırı yeniden onaya bırakır", async () => {
    const { tx, kasaBanka, service } = hazirla();
    kasaBanka.hareketEkle.mockRejectedValueOnce(new Error("Mali dönem kapalı"));

    await expect(service.eslestir("satir-1", { cariId: "cari-1" })).rejects.toThrow("Mali dönem kapalı");
    expect(tx.bankaEkstreSatir.update).toHaveBeenCalledWith({ where: { id: "satir-1" }, data: { durum: "beklemede", cariId: null, faturaId: null } });
  });

  it("geri almada fişin tarihindeki dönem kilidini denetler", async () => {
    const { donemKilidi, tx, service } = hazirla(satir({ durum: "eslesti", hareketId: "h1" }));
    donemKilidi.tarihDogrula.mockRejectedValueOnce(new ConflictException("Eylül 2026 mali dönemi kapalı"));

    await expect(service.geriAl("satir-1")).rejects.toThrow("kapalı");
    expect(donemKilidi.tarihDogrula).toHaveBeenCalledWith("t1", new Date("2026-09-10"), "ekstre eşleşmesini geri alma");
    expect(tx.kasaBankaHareket.deleteMany).not.toHaveBeenCalled();
  });

  it("eşleştirilmiş satırı yoksaymaz (eşzamanlı eşleştirmeyi ezmez)", async () => {
    const { service } = hazirla(satir(), 0);

    await expect(service.yoksay("satir-1")).rejects.toBeInstanceOf(ConflictException);
  });
});
