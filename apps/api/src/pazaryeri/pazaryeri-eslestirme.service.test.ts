import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { PazaryeriEslestirmeService } from "./pazaryeri-eslestirme.service";

const B = "11111111-1111-4111-8111-111111111111";
const F = "22222222-2222-4222-8222-222222222222";
const calistir = <T>(fn: () => Promise<T>) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, fn);
const kesinti = (id: string, ek: Record<string, unknown> = {}) => ({ id, baglantiId: B, sinif: "faturali", durum: "bekliyor", gelenEbelgeId: null, tutar: new Prisma.Decimal(50), dovizCinsi: "TRY", ...ek });

function kur(kesintiler: ReturnType<typeof kesinti>[], ek: { vkn?: string | null; faturaVkn?: string; updateCount?: number } = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: ek.updateCount ?? kesintiler.length });
  const tx = {
    gelenEbelge: { findUnique: vi.fn().mockResolvedValue({ id: F, gonderenVkn: ek.faturaVkn ?? "1234567890", genelToplam: new Prisma.Decimal(100), dovizCinsi: "TRY" }) },
    pazaryeriKesinti: { findMany: vi.fn().mockResolvedValue(kesintiler), updateMany, aggregate: vi.fn().mockResolvedValue({ _sum: { tutar: new Prisma.Decimal(100) } }) },
    baglanti: { findFirst: vi.fn().mockResolvedValue({ faturaKesenVkn: ek.vkn === undefined ? "1234567890" : ek.vkn }) },
  };
  return { servis: new PazaryeriEslestirmeService({ tenantIslem: vi.fn((_t, fn) => fn(tx)) } as never), updateMany };
}

describe("PZR-07 eşleştirme servisi", () => {
  it("faturalı bekleyen kesintileri aynı VKN'li faturaya bağlar, farkı döner", async () => {
    const { servis, updateMany } = kur([kesinti("a"), kesinti("b")]);
    await expect(calistir(() => servis.eslestir({ gelenEbelgeId: F, kesintiIds: ["a", "b"] }))).resolves.toEqual({ eslesen: 2, faturaToplami: "100.00", kesintiToplami: "100.00", fark: "0.00" });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] }, durum: "bekliyor", sinif: "faturali", gelenEbelgeId: null }, data: { durum: "faturayla_eslesti", gelenEbelgeId: F } });
  });

  it("VKN yok/uyuşmuyor, faturalı değil, bekleyen değil, döviz farklı ya da yarış: reddeder", async () => {
    const dene = async (k: ReturnType<typeof kesinti>[], ek: Parameters<typeof kur>[1], hata: RegExp) => {
      const { servis } = kur(k, ek);
      await expect(calistir(() => servis.eslestir({ gelenEbelgeId: F, kesintiIds: k.map((x) => x.id) }))).rejects.toThrow(hata);
    };
    await dene([kesinti("a")], { vkn: null }, /fatura kesen VKN/);
    await dene([kesinti("a")], { faturaVkn: "9999999999" }, /VKN'sinden gelmemiş/);
    await dene([kesinti("a", { sinif: "stopaj" })], {}, /Yalnız faturalı/);
    await dene([kesinti("a", { durum: "faturayla_eslesti", gelenEbelgeId: F })], {}, /bekleyen değil/);
    await dene([kesinti("a", { dovizCinsi: "USD" })], {}, /dövizi/);
    await dene([kesinti("a", { baglantiId: B }), kesinti("b", { baglantiId: "33333333-3333-4333-8333-333333333333" })], {}, /aynı pazaryeri/);
    await dene([kesinti("a"), kesinti("b")], { updateCount: 1 }, /bu sırada değişti/);
  });

  it("durum: öneri eskiden yeniye dağıtılır, bir kesinti iki faturaya önerilmez; faturası gelmeyenler sayılır", async () => {
    const g = (gun: number) => new Date(Date.UTC(2026, 6, gun));
    const tx = {
      baglanti: { findMany: vi.fn().mockResolvedValue([{ id: B, saglayici: "amazon_tr", durum: "aktif", faturaKesenVkn: "1234567890" }]) },
      gelenEbelge: {
        groupBy: vi.fn().mockResolvedValue([{ gonderenVkn: "1234567890", gonderenUnvan: "AMAZON TURKEY", _count: { _all: 3 } }, { gonderenVkn: "5555555555", gonderenUnvan: "KARSEL", _count: { _all: 9 } }]),
        findMany: vi.fn().mockResolvedValue([
          { id: "f2", belgeNo: "AMZ2", tarih: g(20), genelToplam: new Prisma.Decimal(30), dovizCinsi: "TRY", gonderenUnvan: "AMAZON TURKEY" },
          { id: "f1", belgeNo: "AMZ1", tarih: g(10), genelToplam: new Prisma.Decimal(30), dovizCinsi: "TRY", gonderenUnvan: "AMAZON TURKEY" },
        ]),
      },
      pazaryeriKesinti: {
        findMany: vi.fn().mockResolvedValue([{ id: "k1", tarih: g(5), tutar: new Prisma.Decimal(30), dovizCinsi: "TRY", tur: "Commission", siparisNo: null }, { id: "k2", tarih: g(15), tutar: new Prisma.Decimal(30), dovizCinsi: "TRY", tur: "Commission", siparisNo: null }, { id: "k3", tarih: g(16), tutar: new Prisma.Decimal(7), dovizCinsi: "TRY", tur: "Commission", siparisNo: null }]),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    const servis = new PazaryeriEslestirmeService({ tenantIslem: vi.fn((_t, fn) => fn(tx)) } as never);
    const [b] = await calistir(() => servis.durum());
    expect(b.vknOnerileri).toEqual([{ vkn: "1234567890", unvan: "AMAZON TURKEY", faturaSayisi: 3 }]);
    expect(b.faturalar.map((f) => [f.belgeNo, f.oneri?.kesintiIds])).toEqual([["AMZ2", ["k2"]], ["AMZ1", ["k1"]]]);
    // Önerilen k1/k2 sayılmaz; yalnız hiçbir faturaya önerilmeyen eski k3.
    expect(b.faturasiGelmeyen).toEqual(expect.objectContaining({ adet: 1, tutarlar: { TRY: "7.00" } }));
    expect(b.kesintisiOlmayanFatura).toBe(0);
  });
});
