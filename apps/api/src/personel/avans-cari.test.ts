import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { cariTahakkukTutari, PersonelService } from "./personel.service";

const D = (v: string | number) => new Prisma.Decimal(v);

describe("avans–cari eşleşmesi (PRS-04)", () => {
  it("cari tahakkuk avans mahsubu öncesi nettir: avans + maaş ödemesi tahakkuku kapatır", () => {
    const tahakkuk = cariTahakkukTutari({ odenecekTutar: D(25000), kalemler: [{ avansId: null, tutar: D(30000) }, { avansId: "a1", tutar: D(5000) }] });
    expect(tahakkuk.toFixed(2)).toBe("30000.00");
    // cari: avans borç 5.000 + maaş ödemesi borç 25.000 − tahakkuk alacak 30.000 = 0
    expect(D(5000).add(25000).sub(tahakkuk).isZero()).toBe(true);
  });

  it("mahsup edilmiş avansın ödemesi geri alınmaz", async () => {
    const tx = { personelAvans: { findFirst: vi.fn(async () => ({ id: "a1", durum: "kismen_mahsup", mahsupEdilenTutar: D(1000), personel: {} })) } };
    const s = new PersonelService({ tenantId: 1, tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);
    await expect(s.avansOdemeIptal("t1", "a1", "u1", "yanlış kasa")).rejects.toThrow(/mahsubu bordrodan kaldırın/);
  });

  it("avans ödemesi iptalinde kasa ve cari ters kaydı yazılır, avans yeniden onaylı olur", async () => {
    const tx = {
      personelAvans: { findFirst: vi.fn(async () => ({ id: "a1", durum: "odendi", mahsupEdilenTutar: D(0), tutar: D(5000), kasaBankaFiId: "f1", personel: {} })), updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => ({ id: "a1", durum: "onaylandi" })) },
      kasaBankaHareket: { findFirst: vi.fn(async () => ({ id: "f1", kasaId: "k1", bankaHesapId: null, cariId: "c1", tutar: D(5000), tutarTry: D(5000) })), create: vi.fn(async () => ({})) },
      cariHareket: { findFirst: vi.fn(async () => ({ cariId: "c1", tutar: D(5000), tutarTry: D(5000) })), create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);
    await s.avansOdemeIptal("t1", "a1", "u1", "yanlış kasa");
    expect(tx.kasaBankaHareket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tip: "tahsilat", kaynakTur: "personel_avans_iptal", kaynakRef: "a1", karsiHareketId: "f1" }) });
    expect(tx.cariHareket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tip: "alacak", kaynakTur: "personel_avans_iptal" }) });
    expect(tx.personelAvans.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "onaylandi", odendi: false }) }));
  });

  it("cari bağlanınca onaylı ve tahakkuksuz bordroya dönem sonu tarihli tahakkuk yazılır, kapalı dönem reddedilir", async () => {
    const bordro = { id: "b1", donemYil: 2026, donemAy: 9, odenecekTutar: D(25000), kalemler: [{ avansId: "a1", tutar: D(5000) }] };
    const tx = {
      personel: { findFirst: vi.fn(async () => ({ id: "p1", cariId: null })), findFirstOrThrow: vi.fn(async () => ({ id: "p1", personelNo: "PRS-000009", ad: "A", soyad: "B", eposta: null, telefon: null, iban: null, tckn: null })), update: vi.fn(async () => ({})) },
      personelBordro: { findMany: vi.fn(async () => [bordro]) },
      cariHesap: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "c9" })) },
      cariHareket: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const kilit = { tarihDogrula: vi.fn(async () => undefined) };
    const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never, kilit as never);
    expect(await s.cariBagla("t1", "p1", "u1")).toEqual({ cariId: "c9", eksikTahakkuk: 1 });
    expect(tx.cariHareket.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tip: "alacak", tutar: D(30000), tarih: new Date("2026-09-30T00:00:00Z"), kaynakRef: "b1" }) });
    kilit.tarihDogrula.mockRejectedValueOnce(new Error("Eylül 2026 dönemi kapalı"));
    await expect(s.cariBagla("t1", "p1", "u1")).rejects.toThrow("kapalı");
  });
});
