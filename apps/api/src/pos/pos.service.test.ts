import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { PosService } from "./pos.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
  baglamlaCalistir: (_b: unknown, is: () => Promise<unknown>) => is(),
}));

const D = (v: string | number) => new Prisma.Decimal(v);

function kur(tx: Record<string, unknown>) {
  const prisma = { tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)) } as any;
  const bildirimler = { uret: vi.fn().mockResolvedValue({}) };
  const donemKilidi = { tarihDogrula: vi.fn().mockResolvedValue(undefined) };
  return { service: new PosService(prisma, {} as any, {} as any, bildirimler as any, donemKilidi as any), bildirimler };
}

describe("PosService (P1-6)", () => {
  it("aynı faturanın açık bağlantısı varken yenisini açmaz", async () => {
    const tx = {
      posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "p1", aktif: true, saglayici: "iyzico", dovizCinsi: "TRY", baglanti: { durum: "aktif" } }) },
      posTahsilat: { findFirst: vi.fn().mockResolvedValue({ id: "eski", tutar: D(100), dovizCinsi: "TRY", createdAt: new Date("2026-10-01T10:00:00Z") }) },
    };
    const { service } = kur(tx);
    await expect(service.baslat({ posHesapId: "p1", cariId: "c1", faturaId: "f1", tutar: "100" })).rejects.toThrow(/açık ödeme bağlantısı var/);
  });

  it("banka POS'unda ödeme bağlantısı açılmaz", async () => {
    const { service } = kur({ posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "p1", aktif: true, saglayici: "banka" }) } });
    await expect(service.baslat({ posHesapId: "p1", cariId: "c1", tutar: "100" })).rejects.toThrow(/Slip gir/);
  });

  it("süresi dolmuş bağlantıya gelen ödemeyi kaydeder, geç ödeme işaretler ve bildirir", async () => {
    const tx = {
      posTahsilat: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn() },
      kasaBankaHareket: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
      cariHareket: { create: vi.fn() },
    };
    const { service, bildirimler } = kur(tx);
    const kayit = { id: "t1", durum: "suresi_doldu", makbuzAnahtari: "m", posHesapId: "p1", tutar: D(250), dovizCinsi: "TRY", cariId: "c1", faturaId: null };
    const sonuc = await (service as any).odemeyiKaydet("t1", kayit, "odeme-1", "PayTR kart tahsilatı");
    expect(sonuc).toMatchObject({ tekrar: false, gecOdeme: true });
    expect(tx.posTahsilat.updateMany.mock.calls[0][0]).toMatchObject({ where: { durum: { in: ["baslatildi", "suresi_doldu", "iptal"] } }, data: { durum: "odendi", gecOdeme: true } });
    expect(tx.kasaBankaHareket.create).toHaveBeenCalledOnce();
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ birlesimAnahtari: "pos-gec-odeme:t1" }));
  });

  describe("iade", () => {
    const tahsilat = (iadeler: { tutar: number; mahsup: number }[]) => ({
      id: "t1", durum: "odendi", tutar: D(1000), dovizCinsi: "TRY", posHesapId: "p1", cariId: "c1", faturaId: "f1",
      posHesap: { ad: "Ziraat POS" },
      hareket: { faturaMahsubu: D(800) },
      iadeler: iadeler.map((i) => ({ tutar: D(i.tutar), hareket: { faturaMahsubu: D(-i.mahsup) } })),
    });
    const iadeTx = (kayit: unknown) => ({
      $queryRaw: vi.fn(),
      posTahsilat: { findUnique: vi.fn().mockResolvedValue(kayit) },
      kasaBankaHareket: { create: vi.fn(async ({ data }) => ({ id: "ih", ...data })) },
      cariHareket: { create: vi.fn() },
      posIade: { create: vi.fn(async ({ data }) => data) },
    });

    it("iade edilebilir kalanı aşan iadeyi reddeder", async () => {
      const { service } = kur(iadeTx(tahsilat([{ tutar: 700, mahsup: 700 }])));
      await expect(service.iade("t1", { tutar: "400", tarih: "2026-10-02", neden: "Ürün iadesi" })).rejects.toThrow(/kalanı \(300.00 TRY\) aşıyor/);
    });

    it("faturaya mahsup edilmiş kısım kadar mahsubu geri açar", async () => {
      const tx = iadeTx(tahsilat([{ tutar: 500, mahsup: 500 }]));
      const { service } = kur(tx);
      await service.iade("t1", { tutar: "400", tarih: "2026-10-02", neden: "Ürün iadesi" });
      // Mahsup 800, önceki iade 500'ünü geri açtı: kalan 300 geri açılır, 100'ü avanstan düşer.
      expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "tediye", kaynakTur: "pos_iade" });
      expect(tx.kasaBankaHareket.create.mock.calls[0][0].data.faturaMahsubu.toFixed(2)).toBe("-300.00");
      expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "borc", kaynakTur: "pos_iade" });
    });
  });
});
