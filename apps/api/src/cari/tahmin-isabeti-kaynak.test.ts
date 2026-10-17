import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { eksikTahminleriTamamla, kesinlesmeTahminiYaz } from "./tahmin-isabeti-kaynak";

const D = (v: number) => new Prisma.Decimal(v);
const gun = (iso: string) => new Date(`${iso}T00:00:00Z`);
const hareket = (tip: string, tutar: number, tarih: string, kaynakRef: string | null = null, vade: string | null = null) =>
  ({ cariId: "c1", tip, tutarTry: D(tutar), tarih: gun(tarih), vadeTarihi: vade ? gun(vade) : null, kaynakTur: kaynakRef ? "fatura" : "kasa_banka", kaynakRef });
const GECMIS = [
  hareket("borc", 100, "2026-01-01", "a", "2026-01-01"), hareket("alacak", 100, "2026-01-11"),
  hareket("borc", 100, "2026-02-01", "b", "2026-02-01"), hareket("alacak", 100, "2026-02-21"),
];

function kur(eksikler: unknown[] = []) {
  return {
    cariHareket: { findMany: vi.fn().mockResolvedValue(GECMIS) },
    fatura: { findMany: vi.fn().mockResolvedValue(eksikler) },
    faturaGecikmeTahmini: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe("CARI-49 tahmin kayıtları", () => {
  it("kesinleşmede o anki tahmin bir kez yazılır (yeniden kesinleşmede ilk kayıt korunur)", async () => {
    const tx = kur();
    await kesinlesmeTahminiYaz(tx as never, "t1", { id: "yeni", cariId: "c1" }, null, gun("2026-03-01"));
    expect(tx.faturaGecikmeTahmini.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "t1", faturaId: "yeni", cariId: "c1", tahminGun: 15, guven: "dusuk", kapananBorcSayisi: 2, kaynak: "kesinlesme" }],
      skipDuplicates: true,
    });
  });

  it("kaydı olmayan kesin satış faturaları fatura tarihindeki hareketlerle geriye dönük doldurulur", async () => {
    const tx = kur([{ id: "eski", cariId: "c1", tarih: gun("2026-01-15"), cari: { riskLimiti: null } }]);
    await eksikTahminleriTamamla(tx as never, "t1");
    expect(tx.fatura.findMany.mock.calls[0][0].where).toMatchObject({ tip: "satis", durum: "kesin", gecikmeTahmini: { is: null } });
    // 15 Ocak'ta yalnız "a" kapanmıştı (10 gün); "b" henüz yoktu.
    expect(tx.faturaGecikmeTahmini.createMany.mock.calls[0][0].data).toEqual([
      { tenantId: "t1", faturaId: "eski", cariId: "c1", tahminGun: 10, guven: "dusuk", kapananBorcSayisi: 1, kaynak: "geriye_donuk" },
    ]);
  });

  it("eksik yoksa yazmaz", async () => {
    const tx = kur([]);
    await eksikTahminleriTamamla(tx as never, "t1");
    expect(tx.faturaGecikmeTahmini.createMany).not.toHaveBeenCalled();
  });
});
