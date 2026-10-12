import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { OdemeTalimatiService } from "./odeme-talimati.service";

// KSB-16: denkleştirmenin veritabanı tarafı kendi testinde; burada akışın çağırdığı sınanır.
vi.mock("../fatura/denklestirme", async (orijinal) => ({
  ...(await orijinal<typeof import("../fatura/denklestirme")>()),
  cariDenklestir: vi.fn(async () => ({ kapamalar: [] })),
  carileriDenklestir: vi.fn(async () => undefined),
  elleKapamaYaz: vi.fn(async () => undefined),
  kaynakKapamalariniCoz: vi.fn(async () => undefined),
  faturaKapamalariniCoz: vi.fn(async () => undefined),
}));


vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "tenant", userId: "onaylayan", rol: "muhasebe" }) }));
const D = (d: string) => new Prisma.Decimal(d);
const IBAN = "TR330006100519786457841326";

function kur(tx: Record<string, unknown>, kasaBanka: Record<string, unknown> = {}) {
  const prisma = { tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any;
  const auth = { kritikIslemTotpDogrula: vi.fn().mockResolvedValue(undefined) } as any;
  return { auth, service: new OdemeTalimatiService(prisma, auth, kasaBanka as any, { tarihDogrula: vi.fn() } as any) };
}

describe("OdemeTalimatiService onay (ENT-07)", () => {
  it("oluşturan kullanıcının kendi talimatını onaylamasını reddeder; TOTP sorulmaz", async () => {
    const { auth, service } = kur({ bankaOdemeTalimati: { findMany: vi.fn().mockResolvedValue([{ id: "x", no: "OT2026-000001", olusturanUserId: "onaylayan", durum: "onay_bekliyor" }]) } });
    await expect(service.onayla(["x"], "123456")).rejects.toThrow("oluşturan kullanıcı onaylayamaz");
    expect(auth.kritikIslemTotpDogrula).not.toHaveBeenCalled();
  });

  it("birden çok talimatı tek TOTP ile atomik onaylar; biri işlenmişse hepsi reddedilir", async () => {
    const tx = {
      bankaOdemeTalimati: {
        findMany: vi.fn().mockResolvedValue([{ id: "x", olusturanUserId: "baska", durum: "onay_bekliyor" }, { id: "y", olusturanUserId: "baska", durum: "onay_bekliyor" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const { auth, service } = kur(tx);
    await expect(service.onayla(["x", "y"], "123456")).resolves.toEqual({ onaylanan: 2 });
    expect(auth.kritikIslemTotpDogrula).toHaveBeenCalledTimes(1);
    expect(tx.bankaOdemeTalimati.updateMany.mock.calls[0][0]).toMatchObject({ where: { durum: "onay_bekliyor", onaylayanUserId: null }, data: { durum: "onaylandi", onaylayanUserId: "onaylayan" } });
    tx.bankaOdemeTalimati.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.onayla(["x", "y"], "123456")).rejects.toThrow("başka bir kullanıcı");
  });
});

describe("OdemeTalimatiService oluşturma (ENT-07)", () => {
  function tx(planlanan = "0") {
    return {
      bankaHesap: { findUnique: vi.fn().mockResolvedValue({ id: "b1", aktif: true, dovizCinsi: "TRY" }) },
      cariHesap: { findUnique: vi.fn().mockResolvedValue({ id: "c1", unvan: "Ege Ambalaj", aktif: true }) },
      cariBankaHesap: { findUnique: vi.fn().mockResolvedValue({ id: "cb1", cariId: "c1", iban: IBAN, hesapSahibi: null }) },
      fatura: {
        findMany: vi.fn().mockResolvedValue([{ id: "f1", no: "ALS-1", cariId: "c1", tip: "alis", durum: "kesin", dovizCinsi: "TRY", genelToplam: D("1000"), kapamalar: [{ tutar: D("300") }], iadeKapamalari: [] }]),
      },
      bankaOdemeTalimatiFatura: { groupBy: vi.fn().mockResolvedValue(planlanan === "0" ? [] : [{ faturaId: "f1", _sum: { tutar: D(planlanan) } }]) },
      $queryRaw: vi.fn().mockResolvedValue([{ son_sira: 7 }]),
      bankaOdemeTalimati: { create: vi.fn(async ({ data }) => ({ id: "t1", ...data })) },
    };
  }
  const girdi = { bankaHesapId: "b1", cariId: "c1", cariBankaHesapId: "cb1", aliciUnvan: null, aliciIban: null, tutar: null, odemeTarihi: "2026-10-05", aciklama: null, faturalar: [{ faturaId: "f1", tutar: "700" }] };

  it("IBAN cari banka hesabından gelir, tutar fatura toplamıdır, numara ve açıklama üretilir", async () => {
    const t = tx();
    const { service } = kur(t);
    await service.olustur(girdi);
    expect(t.bankaOdemeTalimati.create.mock.calls[0][0].data).toMatchObject({
      no: expect.stringMatching(/^OT\d{4}-000007$/), aliciIban: IBAN, aliciUnvan: "Ege Ambalaj", tutar: D("700"), aciklama: "ALS-1 ödemesi", cariId: "c1",
      faturalar: { create: [{ tenantId: "tenant", faturaId: "f1", tutar: D("700") }] },
    });
  });

  it("açık talimatlardaki planlanan tutar düşülür; kalanı aşan talimat reddedilir", async () => {
    const { service } = kur(tx("200"));
    await expect(service.olustur(girdi)).rejects.toThrow("ödenebilir tutar 500.00");
  });

  it("geçersiz IBAN reddedilir", async () => {
    const t = tx();
    t.cariBankaHesap.findUnique.mockResolvedValue({ id: "cb1", cariId: "c1", iban: "TR000000000000000000000000", hesapSahibi: null });
    const { service } = kur(t);
    await expect(service.olustur(girdi)).rejects.toThrow("geçerli bir IBAN yok");
  });
});

describe("OdemeTalimatiService gerçekleşme (ENT-07)", () => {
  it("fatura başına tediye fişi, artanı cariye yazar; fişler talimata bağlanır", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      bankaOdemeTalimati: {
        findUnique: vi.fn().mockResolvedValue({ id: "t1", no: "OT2026-000001", durum: "gonderildi", bankaHesapId: "b1", dovizCinsi: "TRY", aciklama: "ALS-1 ödemesi", cariId: "c1", tutar: D("1000"), faturalar: [{ faturaId: "f1", tutar: D("700") }] }),
        update: vi.fn(),
      },
      kasaBankaHareket: { updateMany: vi.fn() },
    };
    let sira = 0;
    const kasaBanka = { hareketOlustur: vi.fn(async () => ({ id: `h${++sira}` })) };
    const { service } = kur(tx, kasaBanka);
    const sonuc = await service.gerceklestirTx(tx as never, "tenant", "t1", "2026-10-06", "es1");
    expect(kasaBanka.hareketOlustur.mock.calls.map((c: any[]) => [c[2].tutar, c[2].faturaId, c[2].tip])).toEqual([["700.00", "f1", "tediye"], ["300.00", null, "tediye"]]);
    expect(tx.kasaBankaHareket.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["h1", "h2"] } }, data: { kaynakTur: "odeme_talimati", kaynakRef: "t1", ekstreSatirId: "es1" } });
    expect(tx.bankaOdemeTalimati.update.mock.calls[0][0].data).toMatchObject({ durum: "gerceklesti" });
    expect(sonuc.hareketIdleri).toEqual(["h1", "h2"]);
  });

  it("onay bekleyen talimat gerçekleşti işaretlenemez", async () => {
    const tx = { $queryRaw: vi.fn(), bankaOdemeTalimati: { findUnique: vi.fn().mockResolvedValue({ id: "t1", no: "OT2026-000001", durum: "onay_bekliyor", faturalar: [] }) } };
    const { service } = kur(tx);
    await expect(service.gerceklestirTx(tx as never, "tenant", "t1", "2026-10-06", null)).rejects.toThrow("gerçekleşti işaretlenemez");
  });
});

describe("OdemeTalimatiService paket (ENT-07)", () => {
  it("yalnız aynı hesaptan, onaylı ve pakete girmemiş talimat pakete alınır", async () => {
    const tx = {
      bankaHesap: { findUnique: vi.fn().mockResolvedValue({ odemeDosyaProfili: null }) },
      bankaOdemeTalimati: { findMany: vi.fn().mockResolvedValue([{ id: "t1", no: "OT2026-000001", durum: "onaylandi", bankaHesapId: "b1", paketId: "p0", tutar: D("10") }]) },
    };
    const { service } = kur(tx);
    await expect(service.paketOlustur("b1", ["t1"])).rejects.toThrow("pakete alınamaz");
  });
});
