import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../kasa-banka/baglanmamis-odeme", () => ({
  baglanmamisOdemeler: vi.fn(async (_tx: unknown, _idler: string[], tip: string) => new Map(tip === "tahsilat" ? [["c1", new Prisma.Decimal(150)]] : [])),
}));
import { vadesiGecmisAcilisKalemleri } from "./acilis-kalemleri";

describe("vadesi geçmiş açılış kalemleri (VAK-06)", () => {
  it("bağlanmamış tahsilat en eski vadeden başlayarak kapatır; kalan vadesi geçmişse listelenir", async () => {
    const h = (id: string, tip: string, tutar: number, vade: string, aciklama = `Açık fatura ${id} (2026-09-01)`) => ({ id, cariId: "c1", tip, tutarTry: new Prisma.Decimal(tutar), vadeTarihi: new Date(vade), tarih: new Date("2026-10-31"), aciklama });
    const tx = {
      cariHareket: { findMany: vi.fn().mockResolvedValue([h("F1", "borc", 100, "2026-10-01"), h("F2", "borc", 100, "2026-10-15"), h("F3", "borc", 100, "2026-12-30"), h("B1", "alacak", 70, "2026-10-05")]) },
      cariHesap: { findMany: vi.fn().mockResolvedValue([{ id: "c1", unvan: "Müşteri" }]) },
    };
    const r = await vadesiGecmisAcilisKalemleri(tx as never, "t1", new Date("2026-11-11T00:00:00Z"));
    // 150 tahsilat: F1 (100) kapanır, F2'den 50 düşer; F3'ün vadesi gelmedi.
    expect(r.alacaklar.map((a) => [a.no, a.kalanTry])).toEqual([["F2", "50.00"]]);
    expect(r.alacaklar[0]).toMatchObject({ acilis: true, tip: "satis", cariUnvan: "Müşteri" });
    expect(r.borclar.map((b) => [b.no, b.kalanTry, b.tip])).toEqual([["B1", "70.00", "alis"]]);
  });
});
