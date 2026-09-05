import { describe, expect, it, vi } from "vitest";
import { DonemKapatmaService } from "./donem-kapatma.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "tenant-1", userId: "user-1", rol: "yonetici" }) }));

describe("DonemKapatmaService", () => {
  it("finans ve entegrasyon mutabakatlarını kapanış kontrolüne kaydeder", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const tx: any = {
      maliDonem: { upsert: vi.fn().mockResolvedValue({ id: "donem-1", durum: "acik" }), findUnique: vi.fn().mockResolvedValue({ id: "donem-1", kontroller: [] }) },
      donemKontrolu: { upsert },
      fatura: { count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0) },
      masraf: { count: vi.fn().mockResolvedValue(0) }, duzeltmeKaydi: { count: vi.fn().mockResolvedValue(0) },
      bankaEkstreSatir: { count: vi.fn().mockResolvedValue(2) }, sayim: { count: vi.fn().mockResolvedValue(1) },
      gelenEbelge: { count: vi.fn().mockResolvedValue(0) }, pazaryeriSiparis: { count: vi.fn().mockResolvedValue(0) },
      posTahsilat: { count: vi.fn().mockResolvedValue(0) }, krediKartiHareket: { count: vi.fn().mockResolvedValue(0) },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, cb) => cb(tx)) } as any;
    await new DonemKapatmaService(prisma, {} as any).kontrolleriCalistir(2026, 8);
    expect(upsert).toHaveBeenCalledTimes(10);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ kod: "BANKA_MUTABAKATI", basarili: false, detay: { sayi: 2 } }),
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ kod: "STOK_SAYIMI", basarili: false, detay: { sayi: 1 } }),
    }));
  });
});
