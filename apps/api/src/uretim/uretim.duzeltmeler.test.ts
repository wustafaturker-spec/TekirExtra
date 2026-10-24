import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { siparisKarsiligi, UretimService } from "./uretim.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "tenant-1", userId: "user-1", rol: "uretim_operatoru" }),
}));

const D = (deger: string | number) => new Prisma.Decimal(deger);
const ANAHTAR = "11111111-1111-4111-8111-111111111111";

/** Bildirim akışı için en küçük sahte veritabanı; malzemenin depo-1'de serbest stoğu `serbest`. */
function kur(p: { serbest?: number; aktifRezerv?: number; takipTipi?: string } = {}) {
  const rezervasyon = { id: "r-1", depoId: "depo-1", rezerveMiktar: D(p.aktifRezerv ?? 20), sarfEdilenMiktar: D(0), cozulenMiktar: D(0) };
  const emir = {
    id: "emir-1", no: "URT-1", durum: "uretimde", stokId: "mamul-1", varyantId: null, hedefDepoId: "depo-1", kaliteKontrolGerekli: false,
    planlananMiktar: D(10), uretilenMiktar: D(0),
    stok: { anaBirim: "adet", takipTipi: p.takipTipi ?? "yok", satisFiyati: null, satisFiyatiDoviz: "TRY" }, recete: { yanUrunMaliyetYontemi: "sifir" },
    // Birim başına 2 kg malzeme, ortalama maliyet 5 TL.
    kalemler: [{ id: "k-1", malzemeStokId: "malzeme-1", malzemeVaryantId: null, planlananMiktar: D(20), malzeme: { ad: "Granül", anaBirim: "kg", ortalamaMaliyet: D(5) }, rezervasyonlar: [rezervasyon] }],
    ciktilar: [], operasyonlar: [], giderler: [],
  };
  const prisma: any = {
    tenantIslem: vi.fn((_t, cb) => cb(prisma)),
    uretimDonemKilidi: { findFirst: vi.fn().mockResolvedValue(null) },
    uretimBildirimi: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(({ data }) => Promise.resolve({ id: "b-1", ...data })) },
    uretimEmri: { findUnique: vi.fn().mockResolvedValue(emir), update: vi.fn() },
    uretimEmriKalem: { update: vi.fn() },
    uretimMalzemeRezervasyon: { update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    stokKart: { update: vi.fn() },
    stokDepoBakiye: {
      update: vi.fn(),
      // Planlanan pay ayrıldıktan sonraki bakiye: mevcut 50, rezerve 50 − serbest.
      findMany: vi.fn().mockResolvedValue([{ depoId: "depo-1", mevcutMiktar: D(50), rezerveMiktar: D(50 - (p.serbest ?? 38)), depo: { varsayilan: true } }]),
    },
  };
  const hareketEkle = vi.fn().mockResolvedValue({ partiTahsisleri: [] });
  const service = new UretimService(prisma, { hareketEkle, kartlariKilitle: vi.fn() } as any);
  const sarflar = () => hareketEkle.mock.calls.filter((c) => c[1].kaynakTur === "uretim_bildirimi_sarf").map((c) => [c[1].depoId, c[1].miktar.toFixed()]);
  return { prisma, service, hareketEkle, sarflar };
}

describe("hurda malzeme sarfı (URT-HURDA)", () => {
  it("gerçek sarf girilmediyse hurdanın reçete payı da düşülür; plan payı ayrımdan, hurda payı serbest stoktan", async () => {
    const k = kur();
    // 4 iyi + 1 hurda: plan payı 4 × 2 = 8 kg (ayrımdan), hurda payı 1 × 2 = 2 kg (serbest stoktan).
    await k.service.bildir("emir-1", { idempotencyAnahtari: ANAHTAR, uretilenMiktar: "4", hurdaMiktari: "1", hurdaNedeni: "Çapak", yenidenIslemeMiktari: "0" } as any);
    expect(k.sarflar()).toEqual([["depo-1", "8"], ["depo-1", "2"]]);
    expect(k.prisma.uretimMalzemeRezervasyon.update.mock.calls.map((c: any) => c[0].data.sarfEdilenMiktar.increment.toFixed())).toEqual(["8"]);
    const kalem = k.prisma.uretimEmriKalem.update.mock.calls[0][0].data;
    expect(kalem.sarfEdilenMiktar.increment.toFixed()).toBe("10");
    expect(kalem.ekIhtiyacMiktari.increment.toFixed()).toBe("2");
    // Hurdanın malzemesi iyi birimlere yüklenir: 10 kg × 5 TL / 4 adet = 12,5.
    const mamulGirisi = k.hareketEkle.mock.calls.find((c) => c[1].kaynakTur === "uretim_bildirimi_giris")[1];
    expect(mamulGirisi.birimMaliyet.toFixed()).toBe("12.5");
  });

  it("hurda yoksa sarf eskisi gibi yalnız plan payıdır", async () => {
    const k = kur();
    await k.service.bildir("emir-1", { idempotencyAnahtari: ANAHTAR, uretilenMiktar: "4", hurdaMiktari: "0", yenidenIslemeMiktari: "0" } as any);
    expect(k.sarflar()).toEqual([["depo-1", "8"]]);
    expect(k.prisma.uretimEmriKalem.update.mock.calls[0][0].data.ekIhtiyacMiktari).toBeUndefined();
  });

  it("girilen gerçek sarf geçerlidir; planı aşan kısmı serbest stoktan düşer", async () => {
    const k = kur();
    await k.service.bildir("emir-1", { idempotencyAnahtari: ANAHTAR, uretilenMiktar: "4", hurdaMiktari: "1", hurdaNedeni: "Çapak", yenidenIslemeMiktari: "0", sarflar: [{ uretimEmriKalemId: "k-1", miktar: "9" }] } as any);
    expect(k.sarflar()).toEqual([["depo-1", "8"], ["depo-1", "1"]]);
  });

  it("serbest stok yetmezse hurda payının kalanı emrin ayrımından düşer", async () => {
    const k = kur({ serbest: 0.5 });
    await k.service.bildir("emir-1", { idempotencyAnahtari: ANAHTAR, uretilenMiktar: "4", hurdaMiktari: "1", hurdaNedeni: "Çapak", yenidenIslemeMiktari: "0" } as any);
    expect(k.sarflar()).toEqual([["depo-1", "8"], ["depo-1", "0.5"], ["depo-1", "1.5"]]);
    expect(k.prisma.uretimMalzemeRezervasyon.update.mock.calls.map((c: any) => c[0].data.sarfEdilenMiktar.increment.toFixed())).toEqual(["8", "1.5"]);
  });

  it("lot üretim tarihi bildirimin Türkiye günüdür", async () => {
    const k = kur({ takipTipi: "lot" });
    await k.service.bildir("emir-1", { idempotencyAnahtari: ANAHTAR, uretilenMiktar: "4", hurdaMiktari: "0", yenidenIslemeMiktari: "0", bildirimTarihi: "2026-10-31T21:30:00.000Z" } as any);
    const giris = k.hareketEkle.mock.calls.find((c) => c[1].kaynakTur === "uretim_bildirimi_giris")[1];
    expect(giris.partiler[0].uretimTarihi).toBe("2026-11-01");
  });

  it("dönem kilidi Türkiye ayıyla denetlenir", async () => {
    const k = kur();
    // 31.10 21:30 UTC = 1 Kasım 00:30 Türkiye.
    await k.service.bildir("emir-1", { idempotencyAnahtari: ANAHTAR, uretilenMiktar: "4", hurdaMiktari: "0", yenidenIslemeMiktari: "0", bildirimTarihi: "2026-10-31T21:30:00.000Z" } as any);
    expect(k.prisma.uretimDonemKilidi.findFirst).toHaveBeenCalledWith({ where: { yil: 2026, ay: 11 } });
  });
});

describe("üretimdeki emre ek rezervasyon (URT-HURDA)", () => {
  it("hurda ek ihtiyacı üretimdeki emir için ayrılır, emir durumu değişmez", async () => {
    const prisma: any = {
      tenantIslem: vi.fn((_t, cb) => cb(prisma)),
      uretimEmri: {
        findUnique: vi.fn().mockResolvedValue({ id: "emir-1", durum: "uretimde", kalemler: [{ id: "k-1", malzemeStokId: "m-1", malzemeVaryantId: null, planlananMiktar: D(20), ekIhtiyacMiktari: D(2), sarfEdilenMiktar: D(10), rezervasyonlar: [{ rezerveMiktar: D(20), sarfEdilenMiktar: D(8), cozulenMiktar: D(0) }] }] }),
        update: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "emir-1", durum: "uretimde" }),
      },
      stokDepoBakiye: { findMany: vi.fn().mockResolvedValue([{ id: "b-1", depoId: "depo-1", mevcutMiktar: D(50), rezerveMiktar: D(12), depo: { varsayilan: true } }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      stokKart: { update: vi.fn() },
      uretimMalzemeRezervasyon: { upsert: vi.fn() },
    };
    const service = new UretimService(prisma, {} as any);
    await service.rezerveEt("emir-1");
    // Gereken: plan 20 + ek 2 − sarf 10 = 12; aktif ayrım 12 → yeni ayrım gerekmez.
    expect(prisma.uretimMalzemeRezervasyon.upsert).not.toHaveBeenCalled();
    expect(prisma.uretimEmri.update).not.toHaveBeenCalled();
  });
});

describe("maliyet raporu sarf düzeltmeleri", () => {
  it("bildirimden sonra girilen ek sarf eklenir, iade düşülür", () => {
    const servis = new UretimService({} as never, {} as never);
    const ozet = (servis as any).maliyetOzeti({
      id: "e", no: "URT-1", tarih: new Date(), durum: "tamamlandi", stok: {}, planlananMiktar: D(10), uretilenMiktar: D(10),
      kalemler: [{ planlananMiktar: D(10), planlananBirimMaliyet: D(100), sarfEdilenMiktar: D(13), birimMaliyet: D(100) }],
      operasyonlar: [], giderler: [],
      bildirimler: [{ sarflar: [{ miktar: D(10), birimMaliyet: D(100) }] }],
      sarfDuzeltmeleri: [{ tip: "ek_sarf", miktar: D(5), birimMaliyet: D(100) }, { tip: "iade", miktar: D(2), birimMaliyet: D(100) }],
    });
    expect(ozet.kalemler.malzeme.gerceklesen).toBe("1300.0000");
    expect(ozet.toplamlar.sapma).toBe("300.0000");
  });
});

describe("satış siparişi karşılığı", () => {
  it("tamamlanan emir üretilenle, açık emir planlananla sayılır", () => {
    expect(siparisKarsiligi([
      { durum: "tamamlandi", planlananMiktar: D(100), uretilenMiktar: D(40) },
      { durum: "uretimde", planlananMiktar: D(30), uretilenMiktar: D(10) },
    ]).toFixed()).toBe("70");
  });

  it("eksik kapatılan emrin üretilmeyen kısmı üretilecekler listesine döner", async () => {
    const prisma: any = { tenantIslem: vi.fn((_t, cb) => cb(prisma)), belgeSatir: { findMany: vi.fn().mockResolvedValue([{ id: "s", miktar: D(100), belge: {}, stok: {}, varyant: null, uretimEmirleri: [{ durum: "tamamlandi", planlananMiktar: D(100), uretilenMiktar: D(40) }] }]) } };
    const satirlar = await new UretimService(prisma, {} as any).uretimBekleyenSatisSiparisleri();
    expect(satirlar.map((s) => s.kalanMiktar)).toEqual(["60.000"]);
  });
});
