import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { PersonelService } from "./personel.service";

const D = (v: string | number) => new Prisma.Decimal(v);

/** PRS-03: yeniden hesapla, onayı geri al, sil. */
function kur(bordro: Record<string, unknown>, ek: Record<string, unknown> = {}) {
  const tx: any = {
    mevzuatKayit: { findFirst: vi.fn(async () => null) },
    personelIzinTalebi: { findMany: vi.fn(async () => []) },
    personelBordro: {
      findFirst: vi.fn(async (a: { where: { donemAy?: unknown } }) => (a.where.donemAy ? null : bordro)),
      findUnique: vi.fn(async () => ({ ...bordro, kalemler: [], personel: {}, odemeler: [] })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    personel: { findFirstOrThrow: vi.fn(async () => ({ id: "p1", netMaas: D(30000), brutMaas: null, engellilikDerecesi: null, sgkTesvikOrani: D(0), istihdamDonemleri: [{ baslangicTarihi: new Date("2025-01-01T00:00:00Z"), bitisTarihi: null }], ucretler: [{ yururlukTarihi: new Date("2020-01-01T00:00:00Z"), tip: "net", tutar: D(30000) }] })) },
    personelIstihdamDonemi: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },

    personelDonemCalisma: { findUnique: vi.fn(async () => ({ primGunu: 20, eksikGunNedeni: "ucretsiz_izin", fazlaMesaiBrut: D(0), primIkramiyeBrut: D(0), nakitYemekYardimi: D(0), fiiliCalismaGunu: 0, sgkTesvikOrani: null, sahisSigortaPrimi: D(0), hayatSigortaPrimi: D(0), sendikaAidati: D(0) })) },
    personelBordroKalemi: {
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [{ tip: "kazanc", kod: "temel_ucret", tutar: D(20000) }, { tip: "kesinti", kod: "avans_mahsup", tutar: D(5000) }]),
    },
    personelAvans: { update: vi.fn(async () => ({})), findUniqueOrThrow: vi.fn(async () => ({ mahsupEdilenTutar: D(0) })) },
    cariHareket: { findFirst: vi.fn(async () => ({ id: "ch1", cariId: "c1", tutar: D(30000), tutarTry: D(30000) })), count: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
    ...ek,
  };
  const prisma = { tenantIslem: vi.fn((_t: string, cb: (t: unknown) => unknown) => cb(tx)) };
  return { s: new PersonelService(prisma as never), tx };
}

const temel = { id: "b1", personelId: "p1", donemYil: 2026, donemAy: 9, mevzuatKayitId: null, netMaas: D(30000) };

describe("bordro düzeltme (PRS-03)", () => {
  it("yeniden hesap yalnız sistem kalemlerini yeniler, puantaj gününü alır, elle/avans kalemleri korunur", async () => {
    const { s, tx } = kur({ ...temel, durum: "reddedildi" });
    await s.bordroYenidenHesapla("t1", "b1", "u2");
    expect(tx.personelBordroKalemi.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t1", bordroId: "b1", manuel: false } });
    expect(tx.personelBordroKalemi.createMany.mock.calls[0][0].data[0]).toMatchObject({ kod: "temel_ucret", tutar: D(20000) });
    expect(tx.personelBordro.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ primGunu: 20, durum: "hesaplandi", olusturanUserId: "u2" }) }));
    // toplam: 20.000 − 5.000 avans = 15.000
    expect(tx.personelBordro.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ odenecekTutar: D(15000) }) }));
  });

  it("onaylı bordro yeniden hesaplanmaz ve silinmez", async () => {
    const { s } = kur({ ...temel, durum: "onaylandi", kalemler: [], personel: {} });
    await expect(s.bordroYenidenHesapla("t1", "b1", "u2")).rejects.toThrow(/önce onayı geri alın/);
    await expect(s.bordroSil("t1", "b1", "u2", "yanlış kişi")).rejects.toThrow(/önce onayı geri alın/);
  });

  it("mevzuatlı bordroda sonraki ay varsa düzeltme engellenir", async () => {
    const { s, tx } = kur({ ...temel, durum: "hesaplandi", mevzuatKayitId: "m1" });
    tx.personelBordro.findFirst = vi.fn(async (a: { where: { donemAy?: unknown } }) => (a.where.donemAy ? { donemAy: 10 } : { ...temel, durum: "hesaplandi", mevzuatKayitId: "m1" }));
    await expect(s.bordroYenidenHesapla("t1", "b1", "u2")).rejects.toThrow(/2026\/10 bordrosu kümülatif/);
  });

  it("onay geri alınınca cari tahakkuku ters kayıtla kapanır; ödemeli bordroda geri alınmaz", async () => {
    const { s, tx } = kur({ ...temel, durum: "onaylandi", odenenTutar: D(0), odemeler: [], personel: { cariId: "c1" } });
    await s.bordroOnayGeriAl("t1", "b1", "y1", "Puantaj hatalı");
    expect(tx.cariHareket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tip: "borc", tutar: D(30000), kaynakTur: "bordro_tahakkuk_iptal", kaynakRef: "ch1" }) });
    expect(tx.personelBordro.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "hesaplandi" }) }));

    const odemeli = kur({ ...temel, durum: "onaylandi", odenenTutar: D(1000), odemeler: [{ id: "o1" }], personel: { cariId: "c1" } });
    await expect(odemeli.s.bordroOnayGeriAl("t1", "b1", "y1", "Puantaj hatalı")).rejects.toThrow(/önce ödemeleri iptal edin/);
  });

  it("silinen bordronun avans mahsubu avansa geri döner", async () => {
    const { s, tx } = kur({ ...temel, durum: "hesaplandi", kalemler: [{ avansId: "a1", tutar: D(5000) }], personel: { personelNo: "PRS-1", ad: "A", soyad: "B" } });
    await s.bordroSil("t1", "b1", "u2", "o ay çalışmadı");
    expect(tx.personelAvans.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { mahsupEdilenTutar: { decrement: D(5000) }, kalanTutar: { increment: D(5000) } } });
    expect(tx.personelAvans.update).toHaveBeenLastCalledWith({ where: { id: "a1" }, data: { durum: "odendi" } });
    expect(tx.personelBordro.deleteMany).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ islem: "personel_bordro_sil" }) });
  });
});
