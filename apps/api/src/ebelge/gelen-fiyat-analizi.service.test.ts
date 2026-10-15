import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { EbelgeService } from "./ebelge.service";
import { baglamlaCalistir } from "../core/istek-baglami";
import { faturaUblOku, type UblFatura } from "./ubl-oku";
vi.mock("./ubl-oku", async (orijinal) => ({ ...await orijinal<typeof import("./ubl-oku")>(), faturaUblOku: vi.fn() }));
const belge = (): UblFatura => ({
  tarih: "2026-10-14", faturaTipKodu: "SATIS", dovizCinsi: "TRY",
  satirlar: [{ siraNo: 1, ad: "Ürün", miktar: 10, matrah: 1000, birim: "adet" }],
  toplamlar: { matrah: 900, belgeIskontosu: 100, belgeArtirimi: 0 },
} as UblFatura);
const stokId = "11111111-1111-4111-8111-111111111111";
function kur() {
  const tx = {
    gelenEbelge: { findFirst: vi.fn().mockResolvedValue({ id: "gelen", xmlIcerik: "xml", gonderenVkn: "1234567890", faturaId: "kendisi" }) },
    stokKart: { findFirst: vi.fn().mockResolvedValue({ id: stokId, ad: "Ürün", varyantlar: [] }) },
    cariHesap: { findMany: vi.fn().mockResolvedValue([{ id: "c1" }]) },
    faturaSatir: { findMany: vi.fn().mockResolvedValue([{ miktar: new Prisma.Decimal(10), matrah: new Prisma.Decimal(800), birim: "adet",
      fatura: { id: "f1", no: "AL1", tarih: new Date("2026-09-01"), createdAt: new Date("2026-09-01"), dovizCinsi: "TRY", cariId: "c1", cari: { unvan: "Tedarikçi" } } }]) },
  };
  const prisma = { tenantIslem: vi.fn(async (_tenant, fn) => fn(tx)) };
  const service = Object.assign(Object.create(EbelgeService.prototype), { prisma }) as EbelgeService;
  const calistir = (eslesmeler = [{ siraNo: 1, stokId }]) => baglamlaCalistir({ tenantId: "tenant1", userId: "user1", rol: "muhasebe" },
    () => service.gelenFiyatAnalizi("gelen", eslesmeler));
  return { tx, prisma, calistir };
}
beforeEach(() => { vi.mocked(faturaUblOku).mockReset().mockReturnValue(belge()); });
describe("Gelen fiyat analizi veri kapıları", () => {
  it("tenant, kesin alış, tarih, varyant ve kendi faturası filtrelerini uygular; sadece okur", async () => {
    const { tx, prisma, calistir } = kur();
    const sonuc = await calistir();
    expect(prisma.tenantIslem).toHaveBeenCalledWith("tenant1", expect.any(Function), { timeout: 30000 });
    expect(tx.gelenEbelge.findFirst).toHaveBeenCalledWith({ where: { id: "gelen", tenantId: "tenant1" } });
    expect(tx.faturaSatir.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "tenant1", stokId, varyantId: null,
      fatura: { tenantId: "tenant1", tip: "alis", durum: "kesin", ozelMatrahKodu: null,
        id: { not: "kendisi" }, tarih: { gte: new Date("2024-10-14"), lt: new Date("2026-10-14") } } }, take: 2001 });
    expect(sonuc.satirlar[0].analiz?.netBirimFiyat).toBe("90.000000");
    expect(sonuc.satirlar[0].analiz?.sonAlis?.farkYuzde).toBe("12.50");
  });
  it("başka tenant/bulunamayan belgeyi açmaz", async () => {
    const { tx, calistir } = kur(); tx.gelenEbelge.findFirst.mockResolvedValue(null);
    await expect(calistir()).rejects.toThrow("bulunamadı"); expect(tx.faturaSatir.findMany).not.toHaveBeenCalled();
  });
  it("bulunamayan stok, satır ve varyantsız seçimi reddeder", async () => {
    const { tx, calistir } = kur();
    await expect(calistir([{ siraNo: 2, stokId }])).rejects.toThrow("belgede yok");
    tx.stokKart.findFirst.mockResolvedValue(null);
    await expect(calistir()).rejects.toThrow("eşleştirmesini");
    tx.stokKart.findFirst.mockResolvedValue({ id: stokId, ad: "Ürün", varyantlar: [{ id: "v1" }] });
    await expect(calistir()).rejects.toThrow("eşleştirmesini");
  });
  it("belge tutarları uyuşmazsa fiyat sonucu üretmez", async () => {
    const b = belge(); b.toplamlar.matrah = 800; vi.mocked(faturaUblOku).mockReturnValue(b);
    const { tx, calistir } = kur(); await expect(calistir()).rejects.toThrow("tutarsız");
    expect(tx.faturaSatir.findMany).not.toHaveBeenCalled();
  });
  it.each(["IADE", "TEVKIFATIADE", "OZELMATRAH"])("%s belgesini dışlar", async (tip) => {
    const b = belge(); b.faturaTipKodu = tip; vi.mocked(faturaUblOku).mockReturnValue(b);
    await expect(kur().calistir()).rejects.toThrow("dahil değildir");
  });
  it("birden çok aynı VKN'li tedarikçide tek cariyi tahmin etmez", async () => {
    const { tx, calistir } = kur(); tx.cariHesap.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    const s = await calistir(); expect(s.satirlar[0].analiz?.sonAlis).toBeNull();
    expect(s.satirlar[0].uyari).toContain("birden çok");
  });
  it("bedelsiz satırda bölme ve geçmiş sorgusu yapmaz", async () => {
    const b = belge(); b.satirlar[0].matrah = 0; b.toplamlar.matrah = 0; b.toplamlar.belgeIskontosu = 0;
    vi.mocked(faturaUblOku).mockReturnValue(b);
    const { tx, calistir } = kur(); expect((await calistir()).satirlar[0].analiz).toBeNull();
    expect(tx.faturaSatir.findMany).not.toHaveBeenCalled();
  });
});
