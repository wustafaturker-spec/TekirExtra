import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { KrediKartiService } from "./kredi-karti.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", rol: "muhasebe" }) }));
// 1 USD = 30 TL.
vi.mock("../doviz/kur-coz", () => ({ kurZorunlu: vi.fn(async () => new Prisma.Decimal("30")) }));

const D = (deger: string) => new Prisma.Decimal(deger);

function hazirla(kartDovizi: string, fatura?: Record<string, unknown>) {
  const tx = {
    krediKarti: {
      findUnique: vi.fn().mockResolvedValue({ id: "kart-1", ad: "Şirket kartı", sonDortHane: "1234", aktif: true, dovizCinsi: kartDovizi, hareketler: [{ tip: "harcama", tutar: D("5000") }] }),
    },
    cariHesap: { findUnique: vi.fn().mockResolvedValue({ id: "cari-1", aktif: true, dovizCinsi: kartDovizi }) },
    bankaHesap: { findUnique: vi.fn().mockResolvedValue({ id: "banka-1", aktif: true, dovizCinsi: kartDovizi }) },
    fatura: {
      findUnique: vi.fn().mockResolvedValue({
        id: "fatura-1", no: "ALS-1", tip: "alis", durum: "kesin", cariId: "cari-1", dovizCinsi: kartDovizi, kur: D("1"),
        genelToplam: D("1000"), kasaBankaHarekets: [], krediKartiHareketleri: [], ...fatura,
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    krediKartiHareket: { create: vi.fn(async ({ data }) => ({ id: "kk-1", ...data })) },
    krediKartiTaksit: { createMany: vi.fn() },
    kasaBankaHareket: { create: vi.fn(async ({ data }) => ({ id: "h-1", ...data })), update: vi.fn() },
    cariHareket: { create: vi.fn() },
  };
  const service = new KrediKartiService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, { tarihDogrula: vi.fn() } as any);
  return { tx, service };
}

const cariOdeme = { krediKartiId: "kart-1", cariId: "cari-1", tarih: "2026-10-02", ilkTaksitTarihi: "2026-11-02", taksitSayisi: 1, komisyonTutari: "0", aciklama: "Tedarikçi ödemesi" };

describe("KrediKartiService", () => {
  it("dövizli kartla cari ödemenin TL karşılığını işlem günü kuruyla yazar", async () => {
    const { tx, service } = hazirla("USD");

    await service.cariOdeme({ ...cariOdeme, cariOdemeTutari: "100" });

    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ dovizCinsi: "USD", tutar: D("100"), kur: D("30"), tutarTry: D("3000") });
  });

  it("dövizli kart ekstre ödemesinde banka hareketini gerçek kurla yazar", async () => {
    const { tx, service } = hazirla("USD");

    await service.ekstreOdeme({ krediKartiId: "kart-1", bankaHesapId: "banka-1", tarih: "2026-10-02", tutar: "200", aciklama: "Kredi kartı ekstre ödemesi" });

    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ kur: D("30"), tutarTry: D("6000") });
  });

  it("faturanın kalanını aşan kart ödemesinde kalan kadar mahsup eder (KSB-07)", async () => {
    const { tx, service } = hazirla("TRY", { kasaBankaHarekets: [{ faturaMahsubu: D("700") }] });

    await service.cariOdeme({ ...cariOdeme, faturaId: "fatura-1", cariOdemeTutari: "500" });

    expect(tx.krediKartiHareket.create.mock.calls[0][0].data).toMatchObject({ cariOdemeTutari: D("500"), faturaMahsubu: D("300") });
    // Cariye ödemenin tamamı yazılır; 200 TL tedarikçide avans kalır.
    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ tutar: D("500"), kur: D("1"), tutarTry: D("500") });
  });
});

describe("KrediKartiService hareket geri alma (KSB-08)", () => {
  const D = (deger: string) => new Prisma.Decimal(deger);
  function hazirla(hareket: Record<string, unknown>, donemKapali = false) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      krediKartiHareket: {
        findUnique: vi.fn(async ({ where }) => (where.id ? { id: "kk1", krediKartiId: "kart-1", tip: "harcama", tarih: new Date("2026-09-10"), aciklama: "Yakıt", tutar: D("500"), cariId: null, faturaId: null, faturaMahsubu: null, geriAlinanHareketId: null, masrafOdemesi: null, taksitler: [], bankaHareket: null, ...hareket } : null)),
        delete: vi.fn(),
        create: vi.fn(async ({ data }) => ({ id: "ters", ...data })),
      },
      krediKartiTaksit: { deleteMany: vi.fn() },
      cariHareket: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), create: vi.fn() },
      kasaBankaHareket: { delete: vi.fn(), create: vi.fn(async ({ data }) => ({ id: "banka-ters", ...data })) },
      bankaEkstreSatir: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const donemKilidi = { tarihDogrula: vi.fn(async (_t: string, tarih: Date | string) => {
      const gun = typeof tarih === "string" ? tarih : tarih.toISOString().slice(0, 10);
      if (donemKapali && gun.startsWith("2026-09")) throw new ConflictException("kapalı");
    }) };
    const service = new KrediKartiService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, donemKilidi as any);
    return { tx, service };
  }

  it("açık dönemde hareketi ve ekstre ödemesinin banka fişini siler", async () => {
    const { tx, service } = hazirla({ tip: "odeme", bankaHareket: { id: "b1", ekstreSatir: { id: "es1" } } });

    await expect(service.hareketGeriAl("kk1", "Mükerrer")).resolves.toEqual({ yontem: "silindi" });
    expect(tx.krediKartiHareket.delete).toHaveBeenCalledWith({ where: { id: "kk1" } });
    expect(tx.kasaBankaHareket.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
    expect(tx.bankaEkstreSatir.update).toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ islem: "kredi_karti_hareketi_silindi", varlikId: "kk1" });
  });

  it("kapalı dönemdeki ekstre ödemesine ters hareket ve banka ters fişi atar", async () => {
    const { tx, service } = hazirla({ tip: "odeme", bankaHareket: { id: "b1", bankaHesapId: "banka-1", tip: "tediye", tutar: D("500"), dovizCinsi: "TRY", kur: D("1"), tutarTry: D("500"), aciklama: "Ekstre", ekstreSatir: null } }, true);

    await expect(service.hareketGeriAl("kk1", "Banka iade etti")).resolves.toEqual({ yontem: "ters_kayit" });
    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "tahsilat", kaynakTur: "ters_kayit", kaynakRef: "b1" });
    expect(tx.krediKartiHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "harcama", geriAlinanHareketId: "kk1", bankaHareketId: "banka-ters" });
    expect(tx.krediKartiTaksit.deleteMany).toHaveBeenCalled();
  });

  it("masraftan kartla ödenen harcamayı buradan geri almaz", async () => {
    const { service } = hazirla({ masrafOdemesi: { id: "mo1" } });

    await expect(service.hareketGeriAl("kk1", "Deneme")).rejects.toThrow("Masraflar");
  });
});

