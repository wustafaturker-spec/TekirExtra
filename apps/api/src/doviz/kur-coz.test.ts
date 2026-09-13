import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { KUR_GERI_BAKIS_GUN, kurBul, kurCoz, kurZorunlu } from "./kur-coz";

vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }) }));

const g = (t: string) => new Date(`${t}T00:00:00.000Z`);
const D = (v: string) => new Prisma.Decimal(v);

type Satir = { tarih: Date; dovizAlis: Prisma.Decimal; dovizSatis: Prisma.Decimal };

/** Sorguları kaydeder; pencere koşulunu gerçekten uygular. */
function sahteTx(elle: Satir[], tcmb: Satir[]) {
  const cagrilar: { tablo: string; arg: any }[] = [];
  const bul = (tablo: string, satirlar: Satir[], ek: object) => (arg: any) => {
    cagrilar.push({ tablo, arg });
    const { gte, lte } = arg.where.tarih;
    const uygun = satirlar.filter((s) => s.tarih >= gte && s.tarih <= lte).sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
    return Promise.resolve(uygun[0] ? { ...uygun[0], ...ek } : null);
  };
  const tx = {
    elleKur: { findFirst: bul("elle", elle, { updatedAt: g("2026-09-13") }) },
    tcmbKuru: { findFirst: bul("tcmb", tcmb, { kaynak: "TCMB_XML", alindiAt: g("2026-09-12") }) },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, cagrilar };
}

describe("kurBul / kurCoz (DVZ-04, DVZ-05)", () => {
  it("TRY için sorgu yapmadan 1 döner", async () => {
    const { tx, cagrilar } = sahteTx([], []);
    expect((await kurCoz(tx, "t1", "TRY", g("2026-09-12")))?.toString()).toBe("1");
    expect(cagrilar).toHaveLength(0);
  });

  it("belge tarihindeki ya da pencere içindeki en yakın önceki TCMB satış kurunu verir", async () => {
    const { tx, cagrilar } = sahteTx([], [{ tarih: g("2026-09-11"), dovizAlis: D("41.10"), dovizSatis: D("41.25") }]);
    expect((await kurCoz(tx, "t1", "USD", g("2026-09-13")))?.toString()).toBe("41.25");
    expect((await kurCoz(tx, "t1", "USD", g("2026-09-13"), "alis"))?.toString()).toBe("41.1");
    // Elle kur kiracıya göre, TCMB kuru ortak tablodan aranır.
    expect(cagrilar.find((c) => c.tablo === "elle")!.arg.where).toMatchObject({ tenantId: "t1", dovizCinsi: "USD" });
    expect(cagrilar.find((c) => c.tablo === "tcmb")!.arg.where).not.toHaveProperty("tenantId");
  });

  it(`${KUR_GERI_BAKIS_GUN} günden eski kuru kullanmaz`, async () => {
    const { tx } = sahteTx([], [{ tarih: g("2026-07-07"), dovizAlis: D("39"), dovizSatis: D("39.1") }]);
    expect(await kurCoz(tx, "t1", "USD", g("2026-09-01"))).toBeNull();
    const sinirda = sahteTx([], [{ tarih: g("2026-08-22"), dovizAlis: D("40"), dovizSatis: D("40.1") }]);
    expect((await kurCoz(sinirda.tx, "t1", "USD", g("2026-09-01")))?.toString()).toBe("40.1");
  });

  it("aynı gün için elle kur TCMB kurunun yerine geçer; daha yeni TCMB günü elle kuru geçer", async () => {
    const tcmb = [{ tarih: g("2026-09-10"), dovizAlis: D("41.00"), dovizSatis: D("41.20") }];
    const ayniGun = sahteTx([{ tarih: g("2026-09-10"), dovizAlis: D("42.00"), dovizSatis: D("42.50") }], tcmb);
    expect(await kurBul(ayniGun.tx, "t1", "USD", g("2026-09-10"))).toMatchObject({ kaynak: "ELLE", satis: D("42.50") });

    const eskiElle = sahteTx([{ tarih: g("2026-09-08"), dovizAlis: D("40.00"), dovizSatis: D("40.50") }], tcmb);
    expect(await kurBul(eskiElle.tx, "t1", "USD", g("2026-09-10"))).toMatchObject({ kaynak: "TCMB_XML", satis: D("41.20") });
  });

  it("kurZorunlu kur yoksa ekrana yönlendiren hata verir, varsa kuru döner", async () => {
    const bos = sahteTx([], []);
    await expect(kurZorunlu(bos.tx, "EUR", g("2026-09-12"))).rejects.toThrow(/EUR için 2026-09-12.*Döviz Kurları/);
    const dolu = sahteTx([], [{ tarih: g("2026-09-12"), dovizAlis: D("45"), dovizSatis: D("45.5") }]);
    expect((await kurZorunlu(dolu.tx, "EUR", g("2026-09-12"))).toString()).toBe("45.5");
  });
});
