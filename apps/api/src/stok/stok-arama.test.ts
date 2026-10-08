import { describe, expect, it, vi } from "vitest";
import { StokService } from "./stok.service";
import { Prisma } from "@prisma/client";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }),
}));

describe("StokService arama", () => {
  it("tedarikci urun kodunu ad, kod ve barkodla ayni sorguda arar", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ stokKart: { findMany } })),
    } as any;
    const servis = new StokService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await servis.listele("TED-URUN-42");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { aramaNormal: { contains: "ted-urun-42" } },
          { tedarikciler: { some: { tedarikciUrunKodu: { contains: "TED-URUN-42", mode: "insensitive" } } } },
          { tedarikciler: { some: { varyantKodlari: { some: { tedarikciUrunKodu: { contains: "TED-URUN-42", mode: "insensitive" } } } } } },
        ]),
      }),
      include: expect.objectContaining({
        tedarikciler: { select: { tedarikciUrunKodu: true, varyantKodlari: { select: { tedarikciUrunKodu: true } } } },
      }),
    }));
  });

  it("kritik stok sayısını veritabanında hesaplar", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ sayi: 7 }]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ $queryRaw: queryRaw })),
    } as any;
    const servis = new StokService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await expect(servis.kritikOzeti()).resolves.toEqual({ kritikStok: 7 });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("başka stok kartına ait varyantla hareket yazılmasını engeller", async () => {
    const servis = new StokService({} as any, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
    const tx = {
      stokKart: { findUnique: vi.fn().mockResolvedValue({ id: "stok-1", tip: "urun", mevcutMiktar: new Prisma.Decimal(0), ortalamaMaliyet: new Prisma.Decimal(0) }) },
      stokVaryant: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as any;
    await expect(servis.hareketEkle(tx, {
      stokId: "stok-1", varyantId: "varyant-baska", depoId: "depo-1", tip: "giris",
      miktar: new Prisma.Decimal(1), girilenBirim: "adet", girilenMiktar: new Prisma.Decimal(1),
      birimMaliyet: new Prisma.Decimal(10), tarih: new Date("2026-08-10"),
    })).rejects.toThrow("Varyant bu stok kartına ait değil");
  });

  it("STK-24: kart satırını okumadan önce FOR UPDATE ile kilitler", async () => {
    const servis = new StokService({} as any, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
    const sira: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (parcalar: TemplateStringsArray, idler: string[]) => { sira.push(`kilit:${parcalar.join("?")}:${idler.join(",")}`); return []; }),
      stokKart: { findUnique: vi.fn(async () => { sira.push("oku"); return null; }) },
    } as any;
    await expect(servis.hareketEkle(tx, { stokId: "stok-1", depoId: "depo-1", tip: "giris", miktar: new Prisma.Decimal(1), girilenBirim: "adet", girilenMiktar: new Prisma.Decimal(1), birimMaliyet: new Prisma.Decimal(1), tarih: new Date("2026-10-08") })).rejects.toThrow("Stok kartı bulunamadı");
    expect(sira[0]).toMatch(/^kilit:.*FOR UPDATE:stok-1$/);
    expect(sira[1]).toBe("oku");
  });

  it("STK-24: toplu kilit tekrarsız kimliklerle tek sorgu", async () => {
    const servis = new StokService({} as any, {} as any, {} as any, {} as any);
    const $queryRaw = vi.fn().mockResolvedValue([]);
    await servis.kartlariKilitle({ $queryRaw } as any, ["b", "a", "b"]);
    await servis.kartlariKilitle({ $queryRaw } as any, []);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect($queryRaw.mock.calls[0][0].join("?")).toContain("ORDER BY id FOR UPDATE");
    expect($queryRaw.mock.calls[0][1]).toEqual(["b", "a"]);
  });

  it("parti çıkışını FEFO sırasıyla tahsis eder", async () => {
    const servis = new StokService({} as any, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
    const erken = { id: "p1", lotNo: "LOT-ERKEN", seriNo: null, sonKullanmaTarihi: new Date("2026-09-01"), uretimTarihi: null, kalanMiktar: new Prisma.Decimal(2), createdAt: new Date() };
    const gec = { ...erken, id: "p2", lotNo: "LOT-GEC", sonKullanmaTarihi: new Date("2026-12-01"), kalanMiktar: new Prisma.Decimal(5) };
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({});
    const tx = { stokParti: { findMany: vi.fn().mockResolvedValue([erken, gec]), update }, stokHareketParti: { create } } as any;

    const sonuc = await (servis as any).partiTahsisEt(tx, "lot", "h1", {
      stokId: "s1", varyantId: null, depoId: "d1", miktarDegisimi: new Prisma.Decimal(-3), partiler: [],
    });

    expect(sonuc.map((p: { lotNo: string; miktar: Prisma.Decimal }) => [p.lotNo, p.miktar.toString()])).toEqual([["LOT-ERKEN", "2"], ["LOT-GEC", "1"]]);
    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "p1" } }));
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: "p2" } }));
    expect(create).toHaveBeenCalledTimes(2);
  });
});
