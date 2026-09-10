import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { SevkiyatService } from "./sevkiyat.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1-uuid", userId: "u1", rol: "muhasebe" }),
}));

describe("SevkiyatService (EBLG-25)", () => {
  function kur(tx: Record<string, unknown>) {
    const prisma = { tenantIslem: vi.fn((_t: string, cb: (t: unknown) => unknown) => cb(tx)) } as never;
    return new SevkiyatService(prisma);
  }

  it("araç listesi varsayılan olarak yalnız aktifleri getirir", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await kur({ arac: { findMany } }).araclar(true);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { aktif: true } }));
  });

  it("tümü istendiğinde pasifleri de getirir", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await kur({ arac: { findMany } }).araclar(false);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("kart alanlarını seçerek döner, tenant kimliğini dışarı vermez", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await kur({ sofor: { findMany } }).soforler(true);

    const secim = findMany.mock.calls[0][0].select;
    expect(secim).toBeDefined();
    expect(secim).not.toHaveProperty("tenantId");
  });

  it("aynı plaka ikinci kez açılamaz", async () => {
    // İki aynı plaka olursa irsaliyede hangisinin seçildiği belirsizleşir.
    const create = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("benzersizlik", { code: "P2002", clientVersion: "6" }),
    );
    const servis = kur({ arac: { create } });

    await expect(servis.aracOlustur({ plaka: "34 ABC 123", aktif: true })).rejects.toBeInstanceOf(ConflictException);
  });

  it("olmayan şoförü güncellemeye çalışmaz", async () => {
    const update = vi.fn();
    const servis = kur({ sofor: { findUnique: vi.fn().mockResolvedValue(null), update } });

    await expect(servis.soforGuncelle("yok", { ad: "Ali" })).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});
