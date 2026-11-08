import { describe, expect, it, vi } from "vitest";
import { FIYAT_ONERISI_VARSAYILAN } from "./fiyat-onerisi";
import { StokService } from "./stok.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));

function kur(ayarlar?: { getir: ReturnType<typeof vi.fn> }) {
  const tx = { cariHesap: { findUnique: vi.fn().mockResolvedValue({ grup: { ad: "Bayi" } }) }, faturaSatir: { findMany: vi.fn().mockResolvedValue([]) } };
  const prisma = { tenantIslem: vi.fn((_t: string, f: (t: unknown) => unknown) => f(tx)) };
  const servis = new StokService(prisma as never, {} as never, {} as never, {} as never, undefined, ayarlar as never);
  vi.spyOn(servis as never, "kaynakFiyatBul").mockResolvedValue({ stok: { alisFiyati: null, alisFiyatiDoviz: "TRY" }, birimFiyat: 100, kaynakDoviz: "TRY", fiyatKaynagi: "stok", iskontoOrani: 0 } as never);
  return servis;
}

describe("tavsiye fiyatta firma ayarı (AI-21)", () => {
  it("firmanın kaydettiği iskontoyu kullanır", async () => {
    const getir = vi.fn().mockResolvedValue({ ...FIYAT_ONERISI_VARSAYILAN, bayiIskontoYuzde: 25 });
    const r = await kur({ getir }).tavsiyeFiyat("s1", "c1");
    expect(getir).toHaveBeenCalledWith("fiyat_onerisi");
    expect(r.fiyatOnerisi?.kirilim.grupIskontosuYuzde).toBe(25);
  });
  it("ayar servisi yoksa eski sabit değerler geçerlidir", async () => {
    const r = await kur().tavsiyeFiyat("s1", "c1");
    expect(r.fiyatOnerisi?.kirilim.grupIskontosuYuzde).toBe(15);
  });
});
