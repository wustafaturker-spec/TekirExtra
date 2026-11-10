import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { EbelgeService } from "./ebelge.service";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));

const satir = (id: string, ek: Record<string, unknown> = {}) => ({
  id, uuid: id, belgeNo: id.toUpperCase(), gonderenVkn: "1", gonderenUnvan: "G", tarih: new Date("2026-11-01T00:00:00Z"), profilId: "TEMELFATURA",
  durum: "beklemede", yanit: null, yanitGerekce: null, faturaId: null, satirSayisi: 2, genelToplam: new Prisma.Decimal("10"), dovizCinsi: "TRY",
  okunabilir: true, denetimUyariSayisi: 0, fatura: null, ...ek,
});

function kur(kayitlar: unknown[]) {
  const tx = {
    gelenEbelge: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue(kayitlar),
      aggregate: vi.fn().mockResolvedValue({ _count: { _all: 120 }, _sum: { genelToplam: new Prisma.Decimal("1234.5"), satirSayisi: 300 } }),
      groupBy: vi.fn().mockResolvedValue([{ durum: "beklemede", _count: { _all: 90 } }, { durum: "islendi", _count: { _all: 30 } }]),
    },
  };
  const prisma = { tenantIslem: vi.fn(async (_t: string, f: (x: typeof tx) => unknown) => f(tx)) };
  return { servis: new EbelgeService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never), tx };
}

describe("gelen kutusu sayfası (rapor V-2)", () => {
  it("bir fazlasını okur, fazlası varsa imleç döner; sayaçlar veritabanından gelir", async () => {
    const { servis, tx } = kur([satir("a"), satir("b"), satir("c")]);
    const s = await servis.gelenSayfa({ adet: 2 });
    expect(tx.gelenEbelge.findMany.mock.calls[0][0]).toMatchObject({ take: 3, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }, { id: "desc" }] });
    expect(s.kayitlar.map((k) => k.id)).toEqual(["a", "b"]);
    expect(s.sonrakiImlec).toBe("b");
    expect(s.ozet).toEqual({ adet: 120, toplamTutar: "1234.50", kalem: 300, beklemede: 90, islendi: 30, reddedildi: 0 });
    expect(tx.gelenEbelge.findMany.mock.calls[0][0].select.xmlIcerik).toBeUndefined();
  });
  it("son sayfada imleç yoktur; imleç verilince ondan sonrası istenir", async () => {
    const { servis, tx } = kur([satir("c")]);
    const s = await servis.gelenSayfa({ adet: 2, imlec: "b" });
    expect(s.sonrakiImlec).toBeNull();
    expect(tx.gelenEbelge.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: "b" }, skip: 1 });
  });
  it("arama Türkçe büyük/küçük biçimleriyle, uyarı süzgeci ve durum veritabanında uygulanır; durum sayaçları durumdan bağımsızdır", async () => {
    const { servis, tx } = kur([]);
    await servis.gelenSayfa({ durum: "beklemede", arama: "istanbul", uyarili: true });
    const where = tx.gelenEbelge.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ durum: "beklemede", denetimUyariSayisi: { gt: 0 } });
    const aranan = where.OR.map((o: Record<string, { contains: string }>) => Object.values(o)[0].contains);
    expect(aranan).toEqual(expect.arrayContaining(["istanbul", "İSTANBUL"]));
    const grupWhere = tx.gelenEbelge.groupBy.mock.calls[0][0].where;
    expect(grupWhere.durum).toBeUndefined();
    expect(grupWhere.denetimUyariSayisi).toEqual({ gt: 0 });
  });
  it("sayfa boyu 1 ile 200 arasında tutulur", async () => {
    const { servis, tx } = kur([]);
    await servis.gelenSayfa({ adet: 5000 });
    expect(tx.gelenEbelge.findMany.mock.calls[0][0].take).toBe(201);
  });
});
