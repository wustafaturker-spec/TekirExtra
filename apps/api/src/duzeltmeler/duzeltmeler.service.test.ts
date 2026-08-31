import { beforeEach, describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import { DuzeltmelerService } from "./duzeltmeler.service";

describe("DuzeltmelerService", () => {
  const tx = {
    bankaEkstreSatir: { findMany: vi.fn() },
    masraf: { findMany: vi.fn() },
    krediKartiHareket: { findMany: vi.fn() },
    posTahsilat: { findMany: vi.fn() },
    ebelgeKayit: { findMany: vi.fn() },
    stokDepoBakiye: { findMany: vi.fn() },
    cekSenet: { findMany: vi.fn() },
    fatura: { findMany: vi.fn() },
    duzeltmeKaydi: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    duzeltmeOlayi: { create: vi.fn() },
  };
  const prisma = { tenantIslem: vi.fn(async (_tenantId: string, is: (istemci: typeof tx) => unknown) => is(tx)) };
  let service: DuzeltmelerService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.bankaEkstreSatir.findMany.mockResolvedValue([]);
    tx.masraf.findMany.mockResolvedValue([]);
    tx.krediKartiHareket.findMany.mockResolvedValue([]);
    tx.posTahsilat.findMany.mockResolvedValue([]);
    tx.ebelgeKayit.findMany.mockResolvedValue([]);
    tx.stokDepoBakiye.findMany.mockResolvedValue([]);
    tx.cekSenet.findMany.mockResolvedValue([]);
    tx.fatura.findMany.mockResolvedValue([]);
    tx.duzeltmeKaydi.findMany.mockResolvedValue([]);
    tx.duzeltmeKaydi.upsert.mockResolvedValue({});
    service = new DuzeltmelerService(prisma as never);
  });

  it("aynı kaynak için deterministik tekillik anahtarıyla upsert yapar", async () => {
    tx.bankaEkstreSatir.findMany.mockResolvedValue([{ id: "satir-1", aciklama: "Havale", tutar: { toString: () => "1250" } }]);

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.tara(),
    );

    expect(sonuc).toMatchObject({ taranan: 1, bulunan: 1, otomatikCozulen: 0 });
    expect(tx.duzeltmeKaydi.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_tekillikAnahtari: { tenantId: "tenant-1", tekillikAnahtari: "ESLESMEMIS_EKSTRE:banka_ekstre_satiri:satir-1" } },
    }));
  });

  it("kaynakta artık bulunmayan açık kaydı otomatik çözer", async () => {
    tx.duzeltmeKaydi.findMany.mockResolvedValue([{ id: "duzeltme-1", tekillikAnahtari: "ESLESMEMIS_EKSTRE:banka_ekstre_satiri:satir-1", durum: "acik" }]);

    const sonuc = await baglamlaCalistir(
      { tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" },
      () => service.tara(),
    );

    expect(sonuc.otomatikCozulen).toBe(1);
    expect(tx.duzeltmeKaydi.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "duzeltme-1" }, data: expect.objectContaining({ durum: "cozuldu", tekillikAnahtari: null }) }));
    expect(tx.duzeltmeOlayi.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ olayTuru: "otomatik_cozum" }) }));
  });
});
