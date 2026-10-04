import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { PersonelService } from "./personel.service";

const D = (v: string | number) => new Prisma.Decimal(v);
const p = { asgariUcretBrut: 30000, sgkTavan: 225000, sgkIsciOrani: 14, issizlikIsciOrani: 1, sgkIsverenOrani: 20.75, issizlikIsverenOrani: 2, damgaVergisiOrani: 0.759, gelirVergisiDilimleri: [{ ustSinir: 100000, oran: 15 }, { ustSinir: null, oran: 20 }] };

describe("ücret geçmişi servisi (PRS-06)", () => {
  it("net anlaşılan personel mevzuat seti varsa brüte çevrilir; net hedefi tutar, kesintiler yazılır", async () => {
    const tx: any = {
      personel: { findMany: vi.fn(async () => [{ id: "p1", personelNo: "PRS-1", engellilikDerecesi: null, sgkTesvikOrani: D(0), istihdamDonemleri: [{ baslangicTarihi: new Date("2025-01-01T00:00:00Z"), bitisTarihi: null }], ucretler: [{ yururlukTarihi: new Date("2025-01-01T00:00:00Z"), tip: "net", tutar: D(25500) }] }]) },
      personelIstihdamDonemi: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },

      personelDonemCalisma: { findMany: vi.fn(async () => []) },
      personelIzinTalebi: { findMany: vi.fn(async () => []) },
      bordroMevzuatSeti: { findFirst: vi.fn(async () => ({ id: "m1", parametreler: p })) },
      personelBordro: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    };
    const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);
    await s.bordroTopluTahakkuk("t1", "u1", { donemYil: 2026, donemAy: 9 });
    const veri = tx.personelBordro.create.mock.calls[0][0].data;
    expect(veri.mevzuatSetiId).toBe("m1");
    expect(veri.brutMaas.toFixed(2)).toBe("30000.00");
    expect(veri.netMaas.toFixed(2)).toBe("25500.00");
    expect(veri.hesapOzeti).toMatchObject({ ucretTipi: "net", hedefNet: "25500.00" });
    expect(veri.kalemler.create.map((k: { kod: string }) => k.kod)).toEqual(expect.arrayContaining(["temel_brut_ucret", "sgk_isci", "gelir_vergisi"]));
  });

  it("brüt ücretli personelde mevzuat seti yoksa o kişi tahakkuk edilmez, nedeni döner", async () => {
    const tx: any = {
      personel: { findMany: vi.fn(async () => [{ id: "p1", personelNo: "PRS-1", engellilikDerecesi: null, sgkTesvikOrani: D(0), istihdamDonemleri: [{ baslangicTarihi: new Date("2025-01-01T00:00:00Z"), bitisTarihi: null }], ucretler: [{ yururlukTarihi: new Date("2025-01-01T00:00:00Z"), tip: "brut", tutar: D(40000) }] }]) },
      personelIstihdamDonemi: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },

      personelDonemCalisma: { findMany: vi.fn(async () => []) },
      personelIzinTalebi: { findMany: vi.fn(async () => []) },
      bordroMevzuatSeti: { findFirst: vi.fn(async () => null) },
      personelBordro: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), create: vi.fn() },
    };
    const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);
    // P3-5: bir kişinin hatası tahakkuku durdurmaz; nedeniyle döner, bordro yazılmaz.
    const sonuc = await s.bordroTopluTahakkuk("t1", "u1", { donemYil: 2026, donemAy: 9 });
    expect(sonuc.olusturulanSayi).toBe(0);
    expect(sonuc.hatalar[0].mesaj).toMatch(/PRS-1 brüt ücretli/);
    expect(tx.personelBordro.create).not.toHaveBeenCalled();
  });

  it("onaylı bordro dönemine geriye dönük ücret girilmez", async () => {
    const tx: any = {
      personel: { findFirst: vi.fn(async () => ({ id: "p1", girisTarihi: new Date("2025-01-01") })) },
      personelBordro: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => ({ donemYil: 2026, donemAy: 9 })) },
    };
    const s = new PersonelService({ tenantIslem: (_t: string, cb: (t: unknown) => unknown) => cb(tx) } as never);
    await expect(s.ucretEkle("t1", "p1", "u1", { yururlukTarihi: new Date("2026-09-16"), tip: "net", tutar: 35000 } as never)).rejects.toThrow(/2026\/09 bordrosu onaylı/);
  });
});
