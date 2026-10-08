import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UretimService } from "./uretim.service";
import { kapasiteGunu, operasyonlariPlanla } from "./uretim-takvim";
import { maliyetDagit } from "./uretim-maliyet";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "tenant-1", userId: "user-1", rol: "muhasebe" }),
}));

const D = (deger: string | number) => new Prisma.Decimal(deger);

describe("UretimService profesyonel emir akışı", () => {
  let prisma: any;
  let service: UretimService;

  beforeEach(() => {
    prisma = {
      tenantIslem: vi.fn((_tenantId, cb) => cb(prisma)),
      urunRecetesi: {
        findFirst: vi.fn().mockResolvedValue({
          id: "recete-1",
          aktif: true,
          kaliteKontrolGerekli: false,
          ciktiMiktari: D(1),
          operasyonlar: [],
          kalemler: [{ malzemeStokId: "malzeme-1", malzemeVaryantId: null, miktar: D(2), fireOrani: D(5), malzeme: { ortalamaMaliyet: D(10) } }],
        }),
        findMany: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      depo: { findFirst: vi.fn().mockResolvedValue({ id: "depo-1" }) },
      isMerkezi: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn() },
      uretimEmriOperasyonu: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn(), findUniqueOrThrow: vi.fn() },
      uretimSayac: { upsert: vi.fn().mockResolvedValue({ tenantId: "tenant-1", yil: 2026, sonSira: 17 }) },
      uretimEmri: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "emir-1", ...data })),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "emir-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "emir-1", durum: "planlandi" }),
        groupBy: vi.fn(),
        aggregate: vi.fn(),
        count: vi.fn(),
      },
      stokKart: { update: vi.fn() },
      stokVaryant: { update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      stokDepoBakiye: { findMany: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn(), update: vi.fn() },
      stokVaryantDepoBakiye: { findMany: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn() },
      uretimMalzemeRezervasyon: { upsert: vi.fn(), update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      uretimBildirimi: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      uretimSarfDuzeltme: { count: vi.fn().mockResolvedValue(0) },
      uretimEmriKalem: { update: vi.fn() },
      uretimKaliteKontrol: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0), findUniqueOrThrow: vi.fn() },
      uretimDonemKilidi: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    };
    service = new UretimService(prisma, {} as any);
  });

  it("tenant ve yıl bazlı atomik sayaçtan üretim emri numarası üretir", async () => {
    const emir = await service.emirOlustur({
      stokId: "11111111-1111-4111-8111-111111111111",
      hedefDepoId: "22222222-2222-4222-8222-222222222222",
      planlananMiktar: "10",
      tarih: "2026-08-21",
      aciklama: null,
    });

    expect(prisma.uretimSayac.upsert).toHaveBeenCalledWith({
      where: { tenantId_yil: { tenantId: "tenant-1", yil: 2026 } },
      create: { tenantId: "tenant-1", yil: 2026, sonSira: 1 },
      update: { sonSira: { increment: 1 } },
    });
    expect(emir.no).toBe("URT-2026-000017");
  });

  it("kapalı üretim dönemine emir kaydını engeller", async () => {
    prisma.uretimDonemKilidi.findFirst.mockResolvedValue({ yil: 2026, ay: 8 });
    await expect(service.emirOlustur({ stokId: "11111111-1111-4111-8111-111111111111", hedefDepoId: "22222222-2222-4222-8222-222222222222", planlananMiktar: "10", tarih: "2026-08-21", aciklama: null })).rejects.toThrow("08/2026 üretim dönemi kapalı");
    expect(prisma.uretimEmri.create).not.toHaveBeenCalled();
  });

  it("üretim kontrol merkezi KPI'larını hesaplar", async () => {
    prisma.uretimEmri.groupBy.mockResolvedValue([
      { durum: "uretimde", _count: { _all: 2 } },
      { durum: "kismen_tamamlandi", _count: { _all: 1 } },
      { durum: "malzeme_bekliyor", _count: { _all: 3 } },
      { durum: "tamamlandi", _count: { _all: 4 } },
    ]);
    prisma.uretimEmri.aggregate.mockResolvedValue({ _sum: { uretilenMiktar: D(90), hurdaMiktari: D(10), yenidenIslemeMiktari: D(5) } });
    prisma.uretimEmri.count.mockResolvedValue(2);

    await expect(service.ozet()).resolves.toEqual({ acikEmir: 6, uretimde: 3, malzemeBekleyen: 3, kaliteBekleyen: 0, geciken: 2, uretilenMiktar: "90.000", hurdaMiktari: "10.000", yenidenIslemeMiktari: "5.000", hurdaOrani: "10.00" });
  });

  it("taslak emri koşullu güncellemeyle planlar", async () => {
    await service.planla("emir-1");

    expect(prisma.uretimEmri.updateMany).toHaveBeenCalledWith({
      where: { id: "emir-1", tenantId: "tenant-1", durum: { in: ["taslak"] } },
      data: { durum: "planlandi" },
    });
  });

  it("yeni reçete sürümünü onaylarken önceki aktif sürümü pasifleştirir", async () => {
    prisma.urunRecetesi.findFirst.mockResolvedValue({ id: "recete-2", stokId: "mamul-1", durum: "taslak", yururlukBaslangic: null });
    prisma.urunRecetesi.update.mockResolvedValue({ id: "recete-2", durum: "aktif" });

    await service.receteOnayla("mamul-1", "recete-2");

    expect(prisma.urunRecetesi.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stokId: "mamul-1", varyantId: undefined, durum: "aktif", id: { not: "recete-2" } }, data: expect.objectContaining({ durum: "pasif", aktif: false }) }));
    expect(prisma.urunRecetesi.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "recete-2" }, data: expect.objectContaining({ durum: "aktif", aktif: true, onaylayanUserId: "user-1" }) }));
  });

  it("uygunsuz durum geçişini reddeder", async () => {
    prisma.uretimEmri.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.baslat("emir-1")).rejects.toThrow("Üretim yalnız tüm malzemeleri rezerve edilmiş hazır emirlerde başlatılabilir");
  });

  it("yeterli malzemeyi depo bazında rezerve edip emri hazır durumuna getirir", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({
      id: "emir-1", durum: "planlandi",
      kalemler: [{ id: "kalem-1", malzemeStokId: "malzeme-1", malzemeVaryantId: null, planlananMiktar: D(8), sarfEdilenMiktar: D(0), malzeme: { ad: "Hammadde" }, rezervasyonlar: [] }],
    });
    prisma.stokDepoBakiye.findMany.mockResolvedValue([
      { id: "bakiye-1", depoId: "depo-1", mevcutMiktar: D(10), rezerveMiktar: D(2), depo: { id: "depo-1", varsayilan: true } },
    ]);

    await service.rezerveEt("emir-1");

    expect(prisma.stokDepoBakiye.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { rezerveMiktar: { increment: D(8) } } }));
    expect(prisma.uretimMalzemeRezervasyon.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ depoId: "depo-1", rezerveMiktar: D(8) }) }));
    expect(prisma.uretimEmri.update).toHaveBeenCalledWith({ where: { id: "emir-1", tenantId: "tenant-1" }, data: { durum: "hazir" } });
  });

  it("malzeme uygunluğunda rezerve miktarı kullanılabilir stoktan düşer", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({
      id: "emir-1", no: "URT-2026-000017", planlananMiktar: D(10),
      stok: { id: "mamul-1", kod: "M-01", ad: "Mamul", anaBirim: "adet" },
      kalemler: [{ id: "kalem-1", malzemeStokId: "malzeme-1", malzemeVaryantId: null, planlananMiktar: D(8), sarfEdilenMiktar: D(0), malzeme: { id: "malzeme-1", kod: "HM-01", ad: "Hammadde", anaBirim: "kg" }, malzemeVaryant: null, rezervasyonlar: [] }],
    });
    prisma.stokDepoBakiye.findMany.mockResolvedValue([
      { mevcutMiktar: D(10), rezerveMiktar: D(4), depo: { id: "depo-1", kod: "HMD", ad: "Hammadde Deposu", varsayilan: true } },
    ]);

    const sonuc = await service.malzemeUygunlugu("emir-1");

    expect(sonuc.uretimeHazir).toBe(false);
    expect(sonuc.kalemler[0]).toMatchObject({ gerekenMiktar: "8.000", kullanilabilirMiktar: "6.000", eksikMiktar: "2.000", yeterli: false });
  });

  it("aynı idempotency anahtarıyla yinelenen bildirimi yeniden işlemez", async () => {
    const onceki = { id: "bildirim-1", uretimEmriId: "emir-1", sarflar: [] };
    prisma.uretimBildirimi.findUnique.mockResolvedValue(onceki);

    const sonuc = await service.bildir("emir-1", {
      idempotencyAnahtari: "11111111-1111-4111-8111-111111111111",
      uretilenMiktar: "2", hurdaMiktari: "0", sarflar: [],
    });

    expect(sonuc).toBe(onceki);
    expect(prisma.uretimEmri.findUnique).not.toHaveBeenCalled();
    expect(prisma.uretimBildirimi.create).not.toHaveBeenCalled();
  });

  it("bildirim ek giderleri mamul maliyetine ve emir toplamına katar", async () => {
    const hareketEkle = vi.fn();
    service = new UretimService(prisma, { hareketEkle, kartlariKilitle: vi.fn() } as any);
    prisma.uretimBildirimi.findUnique.mockResolvedValue(null);
    prisma.uretimBildirimi.create.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: "b-1", ...(data as object) }));
    prisma.uretimEmriGider = { update: vi.fn() };
    prisma.uretimEmri.findUnique.mockResolvedValue({
      id: "emir-1", no: "URT-1", durum: "uretimde", stokId: "mamul-1", varyantId: null, hedefDepoId: "depo-1", kaliteKontrolGerekli: false,
      planlananMiktar: D(10), uretilenMiktar: D(0), stok: { anaBirim: "adet", takipTipi: "yok", satisFiyati: null, satisFiyatiDoviz: "TRY" }, recete: { yanUrunMaliyetYontemi: "sifir" },
      kalemler: [], ciktilar: [],
      operasyonlar: [{ planlananDakika: D(60), saatlikMaliyet: D(120), durum: "planlandi" }],
      giderler: [{ id: "g-1", yontem: "birim_basi", deger: D(2), planlananTutar: D(20) }, { id: "g-2", yontem: "emir_basi", deger: D(100), planlananTutar: D(100) }],
    });

    // 4 / 10 adet: operasyon 120 × 0,4 = 48; ek gider 2 × 4 + 100 × 0,4 = 48 → birim (48 + 48) / 4 = 24
    const bildirim = await service.bildir("emir-1", { idempotencyAnahtari: "11111111-1111-4111-8111-111111111111", uretilenMiktar: "4", hurdaMiktari: "0", yenidenIslemeMiktari: "0", sarflar: [] } as any);

    expect(bildirim.ekGiderMaliyeti.toFixed()).toBe("48");
    expect(hareketEkle.mock.calls[0][1].birimMaliyet.toFixed()).toBe("24");
    expect(prisma.uretimEmriGider.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.gerceklesenTutar.increment.toFixed()])).toEqual([["g-1", "8"], ["g-2", "40"]]);
    expect(prisma.uretimEmri.update.mock.calls.at(-1)[0].data.toplamMaliyet.increment.toFixed()).toBe("48");
  });

  it("iş merkezi kapasitesini verimlilik ve planlanan operasyon yüküyle hesaplar", async () => {
    prisma.isMerkezi.findMany.mockResolvedValue([{ id: "merkez-1", kod: "KESIM", ad: "Kesim", gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(80), saatlikMaliyet: D(0), aktif: true }]);
    prisma.uretimEmriOperasyonu.findMany.mockResolvedValue([{ id: "op-1", isMerkeziId: "merkez-1", planlananDakika: D(300), planlananBaslangic: new Date("2026-08-24T08:00:00Z"), planlananBitis: new Date("2026-08-24T13:00:00Z"), uretimEmri: { id: "emir-1", no: "URT-1", durum: "planlandi", stok: { kod: "M-1", ad: "Mamul" } } }]);

    const [sonuc] = await service.kapasite("2026-08-24", "2026-08-24");

    expect(sonuc).toMatchObject({ kapasiteDakika: "384.00", planlananDakika: "300.00", dolulukYuzdesi: "78.13", asimDakika: "0.00" });
  });

  it("önceki adım tamamlanmadan operasyonu başlatmaz", async () => {
    prisma.uretimEmriOperasyonu.findFirst.mockResolvedValue({ id: "op-2", uretimEmriId: "emir-1", sira: 2, durum: "hazir", uretimEmri: { durum: "uretimde" } });
    prisma.uretimEmriOperasyonu.count.mockResolvedValue(1);

    await expect(service.operasyonBaslat("emir-1", "op-2")).rejects.toThrow("Önce önceki operasyonlar tamamlanmalıdır");
    expect(prisma.uretimEmriOperasyonu.updateMany).not.toHaveBeenCalled();
  });

  it("operasyonu tamamlayıp sıradaki adımı hazırlar", async () => {
    prisma.uretimEmriOperasyonu.findFirst
      .mockResolvedValueOnce({ id: "op-1", uretimEmriId: "emir-1", sira: 1, durum: "devam_ediyor", fiiliBaslangic: new Date(), gerceklesenDakika: D(0), saatlikMaliyet: D(120) })
      .mockResolvedValueOnce({ id: "op-2", uretimEmriId: "emir-1", sira: 2, durum: "planlandi" });
    prisma.uretimEmriOperasyonu.findUniqueOrThrow.mockResolvedValue({ id: "op-1", durum: "tamamlandi" });

    await service.operasyonTamamla("emir-1", "op-1", { gerceklesenDakika: 12.5 });

    expect(prisma.uretimEmriOperasyonu.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "op-1", durum: "devam_ediyor" }, data: expect.objectContaining({ durum: "tamamlandi", gerceklesenDakika: D(12.5) }) }));
    expect(prisma.uretimEmriOperasyonu.updateMany).toHaveBeenNthCalledWith(2, { where: { id: "op-2", durum: "planlandi" }, data: { durum: "hazir" } });
  });

  it("planlanan ve gerçekleşen üretim maliyeti sapmasını hesaplar", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({
      id: "emir-1", no: "URT-1", tarih: new Date("2026-08-22"), durum: "tamamlandi", planlananMiktar: D(10), uretilenMiktar: D(10), stok: { kod: "M-1", ad: "Mamul", anaBirim: "adet" },
      kalemler: [{ planlananMiktar: D(20), planlananBirimMaliyet: D(5), sarfEdilenMiktar: D(22), birimMaliyet: D(5), malzeme: { kod: "H-1", ad: "Hammadde" } }],
      operasyonlar: [{ planlananDakika: D(60), gerceklesenDakika: D(75), saatlikMaliyet: D(120), iscilikSaatlik: D(80), makineSaatlik: D(30), genelGiderSaatlik: D(10), isMerkezi: { kod: "KESIM", ad: "Kesim" } }],
      giderler: [{ ad: "Enerji", yontem: "birim_basi", deger: D(2), planlananTutar: D(20), gerceklesenTutar: D(22) }],
      bildirimler: [{ sarflar: [{ miktar: D(22), birimMaliyet: D(5) }] }],
    });

    const sonuc = await service.maliyet("emir-1");

    expect(sonuc.kalemler).toEqual({
      malzeme: { planlanan: "100.0000", gerceklesen: "110.0000", sapma: "10.0000" },
      operasyon: { planlanan: "120.0000", gerceklesen: "150.0000", sapma: "30.0000" },
      iscilik: { planlanan: "80.0000", gerceklesen: "100.0000", sapma: "20.0000" },
      makine: { planlanan: "30.0000", gerceklesen: "37.5000", sapma: "7.5000" },
      genelGider: { planlanan: "10.0000", gerceklesen: "12.5000", sapma: "2.5000" },
      ekGider: { planlanan: "20.0000", gerceklesen: "22.0000", sapma: "2.0000" },
    });
    expect(sonuc.ekGiderler).toEqual([{ ad: "Enerji", yontem: "birim_basi", deger: "2", planlanan: "20.0000", gerceklesen: "22.0000", sapma: "2.0000" }]);
    expect(sonuc.toplamlar).toEqual({ planlanan: "240.0000", gerceklesen: "282.0000", sapma: "42.0000", sapmaYuzdesi: "17.50" });
  });

  it("kalite kabulünde karantina stoğunu hedef depoya aktarır", async () => {
    const kontrol = { id: "kalite-1", tenantId: "tenant-1", uretimEmriId: "emir-1", karantinaDepoId: "karantina-1", miktar: D(5), uretimBildirimi: { toplamMaliyet: D(100) }, uretimEmri: { id: "emir-1", no: "URT-1", stokId: "mamul-1", hedefDepoId: "depo-1", stok: { anaBirim: "adet" } } };
    prisma.uretimKaliteKontrol.findFirst.mockResolvedValue(kontrol);
    prisma.uretimKaliteKontrol.findUniqueOrThrow.mockResolvedValue({ ...kontrol, durum: "kabul" });
    prisma.uretimEmri.findUniqueOrThrow.mockResolvedValue({ id: "emir-1", uretilenMiktar: D(5), planlananMiktar: D(5) });
    const hareketEkle = vi.fn().mockResolvedValueOnce({ partiTahsisleri: [{ lotNo: "LOT-1", seriNo: null, sonKullanmaTarihi: null, uretimTarihi: null, miktar: D(5) }] }).mockResolvedValue({ partiTahsisleri: [] });
    (service as any).stokService = { hareketEkle, kartlariKilitle: vi.fn() };

    await service.kaliteKarari("kalite-1", { karar: "kabul", kontrolNotu: "Ölçümler tolerans içinde" });

    expect(hareketEkle).toHaveBeenCalledTimes(2);
    expect(hareketEkle).toHaveBeenNthCalledWith(2, prisma, expect.objectContaining({ depoId: "depo-1", tip: "giris", partiler: expect.arrayContaining([expect.objectContaining({ lotNo: "LOT-1" })]) }));
    expect(prisma.uretimEmri.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "emir-1", tenantId: "tenant-1" }, data: expect.objectContaining({ durum: "tamamlandi" }) }));
  });

  it("kalite reddinde miktarı gerçekleşenden düşürüp emri yeniden üretime açar", async () => {
    const kontrol = { id: "kalite-1", tenantId: "tenant-1", uretimEmriId: "emir-1", karantinaDepoId: "karantina-1", miktar: D(2), uretimBildirimi: { toplamMaliyet: D(40) }, uretimEmri: { id: "emir-1", no: "URT-1", stokId: "mamul-1", hedefDepoId: "depo-1", planlananMiktar: D(5), stok: { anaBirim: "adet" }, kalemler: [{ id: "kalem-1", planlananMiktar: D(10) }] } };
    prisma.uretimKaliteKontrol.findFirst.mockResolvedValue(kontrol);
    prisma.uretimKaliteKontrol.findUniqueOrThrow.mockResolvedValue({ ...kontrol, durum: "red" });
    prisma.uretimEmri.findUniqueOrThrow.mockResolvedValue({ id: "emir-1", uretilenMiktar: D(5), planlananMiktar: D(5) });
    const hareketEkle = vi.fn().mockResolvedValue({ partiTahsisleri: [] });
    (service as any).stokService = { hareketEkle, kartlariKilitle: vi.fn() };

    await service.kaliteKarari("kalite-1", { karar: "red", kontrolNotu: "Ölçüm tolerans dışında" });

    expect(hareketEkle).toHaveBeenCalledTimes(1);
    expect(prisma.uretimEmri.update).toHaveBeenLastCalledWith({
      where: { id: "emir-1", tenantId: "tenant-1" },
      data: { durum: "malzeme_bekliyor", uretilenMiktar: D(3), tamamlanmaTarihi: null, hurdaMiktari: { increment: D(2) } },
    });
    expect(prisma.uretimEmriKalem.update).toHaveBeenCalledWith({ where: { id: "kalem-1", tenantId: "tenant-1" }, data: { ekIhtiyacMiktari: { increment: D(4) } } });
  });

  it("kısmen üretilmiş emri üretilen kadarıyla kapatır, ayrımı çözer, bekleyen operasyonları iptal eder", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({ id: "emir-1", durum: "kismen_tamamlandi", uretilenMiktar: D(80), planlananMiktar: D(100) });
    prisma.uretimBildirimi.count.mockResolvedValue(2);
    prisma.uretimMalzemeRezervasyon.findMany.mockResolvedValue([{ id: "rez-1", depoId: "depo-1", rezerveMiktar: D(20), sarfEdilenMiktar: D(16), cozulenMiktar: D(0), uretimEmriKalem: { malzemeStokId: "malzeme-1", malzemeVaryantId: null } }]);

    await service.kapat("emir-1", { neden: "Sipariş miktarı düşürüldü" });

    expect(prisma.uretimEmri.updateMany).toHaveBeenCalledWith({ where: { id: "emir-1", tenantId: "tenant-1", durum: "kismen_tamamlandi" }, data: expect.objectContaining({ durum: "tamamlandi", kapanisNedeni: "Sipariş miktarı düşürüldü" }) });
    expect(prisma.uretimMalzemeRezervasyon.update).toHaveBeenCalledWith({ where: { id: "rez-1" }, data: { cozulenMiktar: { increment: D(4) } } });
    expect(prisma.uretimEmriOperasyonu.updateMany).toHaveBeenCalledWith({ where: { uretimEmriId: "emir-1", durum: { in: ["planlandi", "hazir", "beklemede"] } }, data: { durum: "iptal" } });
  });

  it("hiç bildirimi olmayan başlamış emri kapatınca iptal eder", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({ id: "emir-1", durum: "uretimde", uretilenMiktar: D(0), planlananMiktar: D(10) });

    await service.kapat("emir-1", { neden: "Müşteri vazgeçti" });

    expect(prisma.uretimEmri.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "iptal", tamamlanmaTarihi: null }) }));
  });

  it("süren operasyonu olan ya da kalite bekleyen emri kapatmaz", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({ id: "emir-1", durum: "uretimde", uretilenMiktar: D(5), planlananMiktar: D(10) });
    prisma.uretimEmriOperasyonu.count.mockResolvedValue(1);
    await expect(service.kapat("emir-1", { neden: "Deneme" })).rejects.toThrow("Süren operasyon var");

    prisma.uretimEmri.findUnique.mockResolvedValue({ id: "emir-1", durum: "kalite_bekliyor", uretilenMiktar: D(5), planlananMiktar: D(10) });
    await expect(service.kapat("emir-1", { neden: "Deneme" })).rejects.toThrow("kapatılabilir");
    expect(prisma.uretimEmri.updateMany).not.toHaveBeenCalled();
  });

  it("iptal edilen emrin operasyonlarını da iptal eder", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({ id: "emir-1", durum: "planlandi" });

    await service.iptal("emir-1");

    expect(prisma.uretimEmriOperasyonu.updateMany).toHaveBeenCalledWith({ where: { uretimEmriId: "emir-1", durum: { in: ["planlandi", "hazir", "beklemede"] } }, data: { durum: "iptal" } });
  });

  it("kapasite yüküne kapanmış emirlerin operasyonlarını katmaz", async () => {
    await service.kapasite("2026-08-22", "2026-08-22");

    expect(prisma.uretimEmriOperasyonu.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ uretimEmri: { durum: { notIn: ["iptal", "tamamlandi"] } } }) }));
  });

  it("ileri tarihli sürüm onaylanınca eski sürüm o tarihe kadar geçerli kalır", async () => {
    prisma.urunRecetesi.findFirst.mockResolvedValue({ id: "recete-2", stokId: "mamul-1", durum: "taslak", yururlukBaslangic: new Date("2099-01-10") });
    prisma.urunRecetesi.update.mockResolvedValue({ id: "recete-2", durum: "aktif" });

    await service.receteOnayla("mamul-1", "recete-2");

    expect(prisma.urunRecetesi.updateMany).toHaveBeenCalledWith({ where: { stokId: "mamul-1", durum: "aktif", id: { not: "recete-2" } }, data: { yururlukBitis: new Date("2099-01-09") } });
    expect(prisma.urunRecetesi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ yururlukBaslangic: new Date("2099-01-10") }) }));
  });

  it("üretilebilir ürünleri ürün başına tek satır listeler", async () => {
    prisma.urunRecetesi.findMany.mockResolvedValue([{ id: "r-3", stokId: "mamul-1", surum: 3 }, { id: "r-2", stokId: "mamul-1", surum: 2 }, { id: "r-9", stokId: "mamul-2", surum: 1 }]);

    const sonuc = await service.uretilebilirUrunler();

    expect(sonuc.map((r: { id: string }) => r.id)).toEqual(["r-3", "r-9"]);
  });

  it("karantina deposundaki stoğu ayırmaz", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({ id: "emir-1", durum: "planlandi", kalemler: [{ id: "kalem-1", malzemeStokId: "malzeme-1", malzemeVaryantId: null, planlananMiktar: D(1), sarfEdilenMiktar: D(0), malzeme: { ad: "Yarı mamul" }, rezervasyonlar: [] }] });
    prisma.stokDepoBakiye.findMany.mockResolvedValue([]);

    await service.rezerveEt("emir-1");

    expect(prisma.stokDepoBakiye.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stokId: "malzeme-1", depo: { aktif: true, kod: { not: "KARANTINA" } } } }));
  });

  it("kapasitede cumartesi yarım gün, pazar hiç sayılmaz", () => {
    // 24.08.2026 pazartesi … 30.08.2026 pazar: 5 tam + cumartesi yarım
    expect(kapasiteGunu(new Date("2026-08-24T00:00:00"), new Date("2026-08-30T23:59:59.999")).toString()).toBe("5.5");
    expect(kapasiteGunu(new Date("2026-08-29T00:00:00"), new Date("2026-08-29T23:59:59.999")).toString()).toBe("0.5");
    expect(kapasiteGunu(new Date("2026-08-30T00:00:00"), new Date("2026-08-30T23:59:59.999")).toString()).toBe("0");
  });

  it("operasyonları iş günü takvimine yerleştirir: cumartesi yarım, pazar yok", () => {
    const [kesim, paket] = operasyonlariPlanla(new Date("2026-08-28T00:00:00"), [
      // Cuma 480 + cumartesi 240 + pazartesi 280 = 1000 dk
      { dakika: D(1000), gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(100) },
      // Verimlilik %50: günde 240 dk; pazartesi 280. dakikadan sonra yer yok → salı
      { dakika: D(60), gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(50) },
    ]);
    expect(kesim.baslangic).toEqual(new Date("2026-08-28T08:00:00"));
    expect(kesim.bitis).toEqual(new Date("2026-08-31T12:40:00"));
    expect(paket.baslangic).toEqual(new Date("2026-09-01T08:00:00"));
    expect(paket.bitis).toEqual(new Date("2026-09-01T09:00:00"));
  });

  it("pazar başlayan emrin ilk operasyonu pazartesi 08:00'de başlar", () => {
    const [op] = operasyonlariPlanla(new Date("2026-08-30T00:00:00"), [{ dakika: D(30), gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(100) }]);
    expect(op.baslangic).toEqual(new Date("2026-08-31T08:00:00"));
    expect(op.bitis).toEqual(new Date("2026-08-31T08:30:00"));
  });

  it("tatil günlerini atlar, arifeyi yarım gün sayar, ayardaki saatten başlar", () => {
    // 28.10.2026 çarşamba arife (yarım), 29.10 perşembe Cumhuriyet Bayramı
    const tatiller = new Map([["2026-10-28", 0.5], ["2026-10-29", 0]]);
    const [op] = operasyonlariPlanla(new Date("2026-10-28T00:00:00"), [{ dakika: D(600), gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(100) }], { baslangicSaati: "07:30", tatiller });
    // Çarşamba 240 dk (07:30–11:30), perşembe tatil, cuma 360 dk (07:30–13:30)
    expect(op.baslangic).toEqual(new Date("2026-10-28T07:30:00"));
    expect(op.bitis).toEqual(new Date("2026-10-30T13:30:00"));
    expect(kapasiteGunu(new Date("2026-10-26T00:00:00"), new Date("2026-11-01T23:59:59.999"), tatiller).toString()).toBe("4"); // pzt 1 + salı 1 + arife 0,5 + bayram 0 + cuma 1 + cts 0,5
  });

  it("gece yarısını aşan iş günü aynı gün sayılır", () => {
    // 22:00'de başlayan 480 dk'lık gün ertesi 06:00'da biter; 600 dk'nın kalanı sonraki iş gününe
    const [op] = operasyonlariPlanla(new Date("2026-08-24T00:00:00"), [{ dakika: D(600), gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(100) }], { baslangicSaati: "22:00" });
    expect(op.baslangic).toEqual(new Date("2026-08-24T22:00:00"));
    expect(op.bitis).toEqual(new Date("2026-08-26T00:00:00"));
  });

  it("reçeteyi hazırlayan kullanıcı onaylayamaz", async () => {
    prisma.urunRecetesi.findFirst.mockResolvedValue({ id: "recete-2", stokId: "mamul-1", durum: "taslak", yururlukBaslangic: null, olusturanUserId: "user-1" });

    await expect(service.receteOnayla("mamul-1", "recete-2")).rejects.toThrow("Reçeteyi hazırlayan onaylayamaz");
    expect(prisma.urunRecetesi.update).not.toHaveBeenCalled();
  });

  it("döngüsel reçeteyi kaydetmez ve yolu gösterir", async () => {
    prisma.stokKart.findUnique = vi.fn().mockResolvedValue({ id: "x", tip: "urun" });
    (service as any).stokService = { varyantDogrula: vi.fn() };
    prisma.stokVaryant = { findMany: vi.fn().mockResolvedValue([]) };
    // A'nın reçetesine B giriyor; B'nin reçetesinde C, C'nin reçetesinde A var.
    prisma.urunRecetesiKalem = { findMany: vi.fn()
      .mockResolvedValueOnce([{ malzemeStokId: "C", recete: { stokId: "B" } }])
      .mockResolvedValueOnce([{ malzemeStokId: "A", recete: { stokId: "C" } }]) };
    prisma.stokKart.findMany = vi.fn().mockResolvedValue([{ id: "A", kod: "A-01" }, { id: "B", kod: "B-01" }, { id: "C", kod: "C-01" }]);

    await expect(service.receteKaydet("A", { ciktiMiktari: "1", kaliteKontrolGerekli: false, yanUrunMaliyetYontemi: "sifir", kalemler: [{ malzemeStokId: "B", miktar: "1", fireOrani: "0" }], ciktilar: [], operasyonlar: [] })).rejects.toThrow("Döngüsel reçete: A-01 → B-01 → C-01 → A-01");
    expect(prisma.urunRecetesi.create).not.toHaveBeenCalled();
  });

  it("varyantlı malzeme ya da yan ürün reçeteye varyantsız girilemez", async () => {
    prisma.stokKart.findUnique = vi.fn().mockResolvedValue({ id: "x", tip: "urun" });
    (service as any).stokService = { varyantDogrula: vi.fn() };
    prisma.stokVaryant = { findMany: vi.fn().mockResolvedValue([{ id: "v1", stokId: "B" }]) };
    const girdi = { ciktiMiktari: "1", kaliteKontrolGerekli: false, yanUrunMaliyetYontemi: "sifir" as const, ciktilar: [], operasyonlar: [] };

    await expect(service.receteKaydet("A", { ...girdi, kalemler: [{ malzemeStokId: "B", miktar: "1", fireOrani: "0" }] })).rejects.toThrow("Malzeme listesi: 1. satırda varyant seçilmedi");
    await expect(service.receteKaydet("A", { ...girdi, kalemler: [{ malzemeStokId: "C", miktar: "1", fireOrani: "0" }], ciktilar: [{ stokId: "B", tip: "yan_urun", miktar: "1" }] })).rejects.toThrow("Yan/ortak ürünler: 1. satırda varyant seçilmedi");
    expect(prisma.urunRecetesi.create).not.toHaveBeenCalled();
  });

  it("varyantlı mamulün emri varyantsız açılmaz; varyant emre yazılır", async () => {
    prisma.stokVaryant.findMany.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", stokId: "22222222-2222-4222-8222-222222222222" }]);
    const girdi = { stokId: "22222222-2222-4222-8222-222222222222", hedefDepoId: "33333333-3333-4333-8333-333333333333", planlananMiktar: "5", tarih: "2026-10-01" };
    await expect(service.emirOlustur(girdi)).rejects.toThrow("üretilecek varyantı seçin");
    expect(prisma.uretimEmri.create).not.toHaveBeenCalled();

    await service.emirOlustur({ ...girdi, varyantId: "11111111-1111-4111-8111-111111111111" });
    expect(prisma.uretimEmri.create.mock.calls[0][0].data.varyantId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("varyanta özel reçete onaylanınca yalnız o varyantın eski reçetesi pasife düşer", async () => {
    prisma.urunRecetesi.findFirst.mockResolvedValue({ id: "recete-v2", stokId: "mamul-1", varyantId: "v-mavi", durum: "taslak", yururlukBaslangic: null });
    prisma.urunRecetesi.update.mockResolvedValue({ id: "recete-v2", durum: "aktif" });
    await service.receteOnayla("mamul-1", "recete-v2");
    expect(prisma.urunRecetesi.updateMany.mock.calls[0][0].where).toEqual({ stokId: "mamul-1", varyantId: "v-mavi", durum: "aktif", id: { not: "recete-v2" } });
  });

  it("emir varyantın kendi reçetesini, yoksa genel reçeteyi kullanır", async () => {
    const genel = await prisma.urunRecetesi.findFirst();
    const V = "11111111-1111-4111-8111-111111111111";
    prisma.stokVaryant.findMany.mockResolvedValue([{ id: V, stokId: "22222222-2222-4222-8222-222222222222" }]);
    const girdi = { stokId: "22222222-2222-4222-8222-222222222222", varyantId: V, hedefDepoId: "33333333-3333-4333-8333-333333333333", planlananMiktar: "5", tarih: "2026-10-01" };

    prisma.urunRecetesi.findFirst.mockImplementation(async ({ where }: { where: { varyantId: string | null } }) => (where.varyantId === V ? { ...genel, id: "recete-mavi" } : genel));
    await service.emirOlustur(girdi);
    expect(prisma.uretimEmri.create.mock.calls[0][0].data.receteId).toBe("recete-mavi");

    prisma.urunRecetesi.findFirst.mockImplementation(async ({ where }: { where: { varyantId: string | null } }) => (where.varyantId === null ? genel : null));
    await service.emirOlustur(girdi);
    expect(prisma.uretimEmri.create.mock.calls[1][0].data.receteId).toBe(genel.id);
  });

  it("emir reçete ek giderlerini kopyalar, operasyon kırılımını alır ve planlanan maliyete katar", async () => {
    prisma.urunRecetesi.findFirst.mockResolvedValue({ id: "recete-1", aktif: true, kaliteKontrolGerekli: false, ciktiMiktari: D(1), ciktilar: [],
      kalemler: [{ malzemeStokId: "malzeme-1", malzemeVaryantId: null, miktar: D(2), fireOrani: D(0), malzeme: { kod: "H-1", anaBirim: "kg", ortalamaMaliyet: D(10) } }],
      giderler: [
        { sira: 1, ad: "Enerji", yontem: "malzeme_yuzdesi", deger: D(10) },
        { sira: 2, ad: "Ambalaj", yontem: "birim_basi", deger: D("1.5") },
        { sira: 3, ad: "Kalıp", yontem: "emir_basi", deger: D(40) },
      ],
      operasyonlar: [{ isMerkeziId: "m-1", sira: 1, operasyonKodu: "MON", operasyonAdi: "Montaj", hazirlikDakika: D(0), cevrimDakika: D(6), isMerkezi: { saatlikMaliyet: D(450), iscilikSaatlik: D(300), makineSaatlik: D(100), genelGiderSaatlik: D(50), gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(100) } }] });

    // 10 adet: malzeme 10×2×10 = 200; operasyon 60 dk × 450 = 450; ek: %10 → 20, 1,5×10 → 15, emir başı 40
    await service.emirOlustur({ stokId: "11111111-1111-4111-8111-111111111111", hedefDepoId: "22222222-2222-4222-8222-222222222222", planlananMiktar: "10", tarih: "2026-08-24", aciklama: null });
    const data = prisma.uretimEmri.create.mock.calls[0][0].data;
    expect(data.giderler.create.map((g: { ad: string; planlananTutar: Prisma.Decimal }) => [g.ad, g.planlananTutar.toFixed()])).toEqual([["Enerji", "20"], ["Ambalaj", "15"], ["Kalıp", "40"]]);
    expect(data.operasyonlar.create[0]).toMatchObject({ iscilikSaatlik: D(300), makineSaatlik: D(100), genelGiderSaatlik: D(50) });
    expect(data.planlananMaliyet.toFixed()).toBe("725");
  });

  it("planlanan bitiş girilmezse operasyon planının bittiği gün olur", async () => {
    prisma.urunRecetesi.findFirst.mockResolvedValue({ id: "recete-1", aktif: true, kaliteKontrolGerekli: false, ciktiMiktari: D(1), ciktilar: [],
      kalemler: [{ malzemeStokId: "malzeme-1", malzemeVaryantId: null, miktar: D(1), fireOrani: D(0), malzeme: { ortalamaMaliyet: D(1) } }],
      operasyonlar: [{ isMerkeziId: "m-1", sira: 1, operasyonKodu: "KES", operasyonAdi: "Kesim", hazirlikDakika: D(0), cevrimDakika: D(60), isMerkezi: { saatlikMaliyet: D(0), gunlukKapasiteDakika: 480, verimlilikYuzdesi: D(100) } }] });

    // 20 adet × 60 dk = 1200 dk, günde 480 dk: pazartesi, salı, çarşamba öğlene kadar
    const emir = await service.emirOlustur({ stokId: "11111111-1111-4111-8111-111111111111", hedefDepoId: "22222222-2222-4222-8222-222222222222", planlananMiktar: "20", tarih: "2026-08-24", aciklama: null });
    expect(emir.planlananBitis).toEqual(new Date("2026-08-26"));

    const elle = await service.emirOlustur({ stokId: "11111111-1111-4111-8111-111111111111", hedefDepoId: "22222222-2222-4222-8222-222222222222", planlananMiktar: "1", tarih: "2026-08-24", planlananBitis: "2026-08-31", aciklama: null });
    expect(elle.planlananBitis).toEqual(new Date("2026-08-31"));
  });

  it("maliyet sapmasında planı üretilen miktara oranlar", async () => {
    prisma.uretimEmri.findUnique.mockResolvedValue({
      id: "emir-1", no: "URT-1", tarih: new Date("2026-08-24"), durum: "tamamlandi", planlananMiktar: D(10), uretilenMiktar: D(6), stok: { kod: "M-1", ad: "Mamul", anaBirim: "adet" },
      kalemler: [{ planlananMiktar: D(20), planlananBirimMaliyet: D(10), sarfEdilenMiktar: D(12), birimMaliyet: D(10), malzeme: { kod: "H-1", ad: "Hammadde" } }],
      operasyonlar: [{ planlananDakika: D(35), gerceklesenDakika: D(30), saatlikMaliyet: D(600), isMerkezi: { kod: "KES", ad: "Kesim" } }],
      bildirimler: [{ sarflar: [{ miktar: D(12), birimMaliyet: D(10) }] }],
    });

    const sonuc = await service.maliyet("emir-1");

    // Plan 6 adet için: malzeme 200×0,6=120, operasyon 350×0,6=210
    expect(sonuc.kalemler.malzeme).toEqual({ planlanan: "120.0000", gerceklesen: "120.0000", sapma: "0.0000" });
    expect(sonuc.kalemler.operasyon).toEqual({ planlanan: "210.0000", gerceklesen: "300.0000", sapma: "90.0000" });
  });
});

describe("maliyetDagit", () => {
  const c = (miktar: number, birimMaliyet: number | null, satisFiyati: number | null) => ({ miktar: D(miktar), birimMaliyet: birimMaliyet == null ? null : D(birimMaliyet), satisFiyati: satisFiyati == null ? null : D(satisFiyati) });

  it("sıfır yönteminde tüm maliyet ana ürüne kalır; toplam sıfırsa birim maliyet sıfırdır", () => {
    expect(maliyetDagit({ toplam: D(100), mamulMiktar: D(4), mamulSatisFiyati: null, yontem: "sifir", ciktilar: [c(2, null, null)] })).toEqual({ mamulBirimMaliyeti: D(25), ciktiBirimMaliyetleri: [D(0)] });
    expect(maliyetDagit({ toplam: D(0), mamulMiktar: D(4), mamulSatisFiyati: null, yontem: "sifir", ciktilar: [] }).mamulBirimMaliyeti).toEqual(D(0));
  });

  it("sabit değerde yan ürün tutarı ana üründen düşülür, toplamı aşarsa orantılı küçülür", () => {
    expect(maliyetDagit({ toplam: D(100), mamulMiktar: D(4), mamulSatisFiyati: null, yontem: "sabit_deger", ciktilar: [c(2, 10, null)] })).toEqual({ mamulBirimMaliyeti: D(20), ciktiBirimMaliyetleri: [D(10)] });
    expect(maliyetDagit({ toplam: D(100), mamulMiktar: D(4), mamulSatisFiyati: null, yontem: "sabit_deger", ciktilar: [c(2, 100, null)] })).toEqual({ mamulBirimMaliyeti: D(0), ciktiBirimMaliyetleri: [D(50)] });
  });

  it("satış değerinde toplam miktar × fiyat ağırlığıyla bölünür", () => {
    // Ana: 4 × 30 = 120, yan: 2 × 40 = 80 → %60 / %40
    expect(maliyetDagit({ toplam: D(100), mamulMiktar: D(4), mamulSatisFiyati: D(30), yontem: "satis_degeri", ciktilar: [c(2, null, 40)] })).toEqual({ mamulBirimMaliyeti: D(15), ciktiBirimMaliyetleri: [D(20)] });
    expect(() => maliyetDagit({ toplam: D(100), mamulMiktar: D(4), mamulSatisFiyati: null, yontem: "satis_degeri", ciktilar: [c(2, null, 40)] })).toThrow("satış fiyatı");
  });
});
