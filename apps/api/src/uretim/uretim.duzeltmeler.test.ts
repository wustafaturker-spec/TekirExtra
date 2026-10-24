import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { siparisKarsiligi, UretimService } from "./uretim.service";

const oturum = vi.hoisted(() => ({ tenantId: "tenant-1", userId: "user-1", rol: "uretim_operatoru" }));
vi.mock("../core/istek-baglami", () => ({ aktifBaglam: () => oturum }));

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

afterEach(() => { oturum.userId = "user-1"; oturum.rol = "uretim_operatoru"; });

describe("dönem kilidinin açılması", () => {
  it("hangi ayın, kimin kapattığı dönemin ve nedeninin denetim kaydına yazılır", async () => {
    const prisma: any = {
      tenantIslem: vi.fn((_t, cb) => cb(prisma)),
      uretimDonemKilidi: {
        findFirst: vi.fn().mockResolvedValue({ id: "kilit-1", yil: 2026, ay: 9, aciklama: "Mutabakat", kapatanUserId: "u-9", kapatildiAt: new Date("2026-10-05T09:00:00Z"), kapatan: { adSoyad: "Ayşe Kılıç" } }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn() },
    };
    oturum.rol = "maliyet_muhasebesi";
    await new UretimService(prisma, {} as any).donemKilidiAc("kilit-1", "Eksik sarf düzeltmesi girilecek");
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ islem: "uretim_donem_kilidi_acildi", userId: "user-1", varlikId: "kilit-1", detay: expect.objectContaining({ yil: 2026, ay: 9, neden: "Eksik sarf düzeltmesi girilecek", kapatan: "Ayşe Kılıç" }) }) });
    expect(prisma.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(prisma.uretimDonemKilidi.deleteMany.mock.invocationCallOrder[0]);
  });

  it("kalite kararı kapalı döneme stok hareketi yazmaz", async () => {
    const prisma: any = { tenantIslem: vi.fn((_t, cb) => cb(prisma)), uretimDonemKilidi: { findFirst: vi.fn().mockResolvedValue({ yil: 2026, ay: 10 }) }, uretimKaliteKontrol: { findFirst: vi.fn() } };
    oturum.rol = "kalite";
    await expect(new UretimService(prisma, {} as any).kaliteKarari("k-1", { karar: "kabul", kontrolNotu: "Uygun" })).rejects.toThrow(/dönemi kapalı/);
    expect(prisma.uretimKaliteKontrol.findFirst).not.toHaveBeenCalled();
  });
});

describe("operatör izi", () => {
  function operasyonKur(operatorId: string | null = "user-1") {
    const prisma: any = {
      tenantIslem: vi.fn((_t, cb) => cb(prisma)),
      uretimEmriOperasyonu: {
        findFirst: vi.fn().mockResolvedValue({ id: "op-1", sira: 1, durum: "devam_ediyor", operatorId, fiiliBaslangic: new Date(Date.now() - 60000), gerceklesenDakika: D(0), saatlikMaliyet: D(60), uretimEmri: { durum: "kalite_bekliyor" } }),
        count: vi.fn().mockResolvedValue(0), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "op-1" }),
      },
      uretimVardiya: { findFirst: vi.fn().mockResolvedValue({ id: "v-1" }) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: "user-1" }) },
      uretimDurus: { findFirst: vi.fn().mockResolvedValue(null) },
      uretimEmri: { update: vi.fn() },
    };
    return { prisma, service: new UretimService(prisma, {} as any) };
  }
  const V = "22222222-2222-4222-8222-222222222222", BASKASI = "33333333-3333-4333-8333-333333333333";

  it("operatör başka biri adına başlatamaz; kendi adına ve kalite bekleyen emirde başlatabilir", async () => {
    const k = operasyonKur();
    await expect(k.service.operasyonBaslat("emir-1", "op-1", { vardiyaId: V, operatorId: BASKASI })).rejects.toThrow(/kendi adınıza/);
    await k.service.operasyonBaslat("emir-1", "op-1", { vardiyaId: V, operatorId: "user-1" });
    expect(k.prisma.uretimEmriOperasyonu.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operatorId: "user-1" }) }));
  });

  it("yönetici operatör atayabilir", async () => {
    oturum.rol = "yonetici";
    const k = operasyonKur();
    await k.service.operasyonBaslat("emir-1", "op-1", { vardiyaId: V, operatorId: BASKASI });
    expect(k.prisma.uretimEmriOperasyonu.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operatorId: BASKASI }) }));
  });

  it("operasyonu başlatandan başkası tamamlayamaz; yönetici tamamlayabilir", async () => {
    const k = operasyonKur(BASKASI);
    await expect(k.service.operasyonTamamla("emir-1", "op-1", {})).rejects.toThrow(/başlatan operatör/);
    oturum.rol = "yonetici";
    await k.service.operasyonTamamla("emir-1", "op-1", {});
    expect(k.prisma.uretimEmriOperasyonu.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "tamamlandi" }) }));
  });
});

describe("kalite bekleyen emirde üretim sürer", () => {
  it("önceki parti kalite beklerken yeni bildirim girilir ve kendi karantina kaydını açar", async () => {
    const k = kur();
    k.prisma.uretimEmri.findUnique.mockResolvedValue({ ...(await k.prisma.uretimEmri.findUnique()), durum: "kalite_bekliyor", kaliteKontrolGerekli: true, uretilenMiktar: D(4) });
    k.prisma.depo = { upsert: vi.fn().mockResolvedValue({ id: "karantina-1" }) };
    k.prisma.uretimKaliteKontrol = { create: vi.fn() };
    await k.service.bildir("emir-1", { idempotencyAnahtari: ANAHTAR, uretilenMiktar: "4", hurdaMiktari: "0", yenidenIslemeMiktari: "0" } as any);
    expect(k.prisma.uretimKaliteKontrol.create).toHaveBeenCalledWith({ data: expect.objectContaining({ miktar: D(4) }) });
    expect(k.prisma.uretimEmri.update.mock.calls.at(-1)[0].data.durum).toBe("kalite_bekliyor");
  });

  function kararKur(acikKontrol: number, uretilen = 8) {
    const prisma: any = {
      tenantIslem: vi.fn((_t, cb) => cb(prisma)),
      $queryRaw: vi.fn(),
      uretimDonemKilidi: { findFirst: vi.fn().mockResolvedValue(null) },
      uretimKaliteKontrol: {
        findFirst: vi.fn().mockResolvedValue({ id: "k-1", uretimEmriId: "emir-1", karantinaDepoId: "kar-1", miktar: D(4), uretimBildirimi: { mamulBirimMaliyeti: D(10), toplamMaliyet: D(40) }, uretimEmri: { id: "emir-1", no: "URT-1", stokId: "m", varyantId: null, hedefDepoId: "d", planlananMiktar: D(8), stok: { anaBirim: "adet" }, kalemler: [] } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(acikKontrol), findUniqueOrThrow: vi.fn().mockResolvedValue({}),
      },
      uretimEmri: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "emir-1", uretilenMiktar: D(uretilen), planlananMiktar: D(8) }), update: vi.fn() },
      uretimMalzemeRezervasyon: { findMany: vi.fn().mockResolvedValue([]) },
    };
    oturum.rol = "kalite";
    const service = new UretimService(prisma, { hareketEkle: vi.fn().mockResolvedValue({ partiTahsisleri: [] }) } as any);
    return { prisma, service };
  }

  it("başka parti beklerken verilen red üretilenden hemen düşer, emir kalite bekler", async () => {
    const k = kararKur(1);
    await k.service.kaliteKarari("k-1", { karar: "red", kontrolNotu: "Tolerans dışı" });
    expect(k.prisma.$queryRaw).toHaveBeenCalled();
    expect(k.prisma.uretimEmri.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "kalite_bekliyor", uretilenMiktar: D(4), hurdaMiktari: { increment: D(4) } }) }));
  });

  it("yeniden işlemedeki parti varken son kabul emri tamamlamaz", async () => {
    const k = kararKur(1);
    await k.service.kaliteKarari("k-1", { karar: "kabul", kontrolNotu: "Uygun" });
    expect(k.prisma.uretimKaliteKontrol.count).toHaveBeenCalledWith({ where: expect.objectContaining({ durum: { in: ["bekliyor", "yeniden_isleme"] } }) });
    expect(k.prisma.uretimEmri.update.mock.calls.at(-1)[0].data).toMatchObject({ durum: "kalite_bekliyor", tamamlanmaTarihi: null });
  });

  it("açık kontrol kalmayınca ve miktar tamamsa emir tamamlanır", async () => {
    const k = kararKur(0);
    await k.service.kaliteKarari("k-1", { karar: "kabul", kontrolNotu: "Uygun" });
    expect(k.prisma.uretimEmri.update.mock.calls.at(-1)[0].data.durum).toBe("tamamlandi");
  });
});
