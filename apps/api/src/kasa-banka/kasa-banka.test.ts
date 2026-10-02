import { describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { KasaBankaService } from "./kasa-banka.service";

// Mock the istek baglami (aktifBaglam)
vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({
    tenantId: "t1-uuid",
    rol: "muhasebe",
  }),
}));

// Fatura dövizinin işlem günü kuru: 1 USD = 30 TL.
vi.mock("../doviz/kur-coz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../doviz/kur-coz")>()),
  kurZorunlu: vi.fn(async (_tx: unknown, doviz: string) => new Prisma.Decimal(doviz === "USD" ? "30" : "1")),
}));

describe("KasaBankaService (KSB-01..07)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = {
    tenantIslem: mockTenantIslem,
  } as any;

  const service = new KasaBankaService(mockPrisma, {} as any, { tarihDogrula: vi.fn() } as any);

  it("kasaOlustur yeni bir kasa kaydı oluşturur (KSB-01)", async () => {
    const mockTx = {
      kasa: {
        create: vi.fn().mockResolvedValue({ id: "k1", ad: "Merkez Kasa", dovizCinsi: "TRY" }),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const girdi = { ad: "Merkez Kasa", dovizCinsi: "TRY" as const };
    const sonuc = await service.kasaOlustur(girdi);

    expect(mockTx.kasa.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1-uuid",
        ad: "Merkez Kasa",
        dovizCinsi: "TRY",
      },
    });
    expect(sonuc.id).toBe("k1");
  });

  it("virmanEkle iki ayrı kasa/banka hareketi ve karsiHareketId bağı oluşturur (KSB-03)", async () => {
    const mockTx = {
      kasa: {
        findUnique: vi.fn().mockResolvedValue({ aktif: true, dovizCinsi: "TRY" }),
      },
      kasaBankaHareket: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "gidis-id" }) // 1. çağrı (gidis)
          .mockResolvedValueOnce({ id: "gelis-id" }), // 2. çağrı (gelis)
        update: vi.fn().mockResolvedValue({}),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const girdi = {
      kaynakKasaId: "kasa-source",
      hedefKasaId: "kasa-target",
      tutar: "150.00",
      tarih: "2026-07-12",
      aciklama: "Transfer",
    };

    const sonuc = await service.virmanEkle(girdi);

    expect(mockTx.kasaBankaHareket.create).toHaveBeenCalledTimes(2);
    expect(mockTx.kasaBankaHareket.update).toHaveBeenCalledWith({
      where: { id: "gidis-id" },
      data: { karsiHareketId: "gelis-id" },
    });
    expect(sonuc.gidis.id).toBe("gidis-id");
    expect(sonuc.gelis.id).toBe("gelis-id");
  });

  it("hareketEkle tahsilat durumunda cariye ALACAK yazar (KSB-02/07)", async () => {
    const mockTx = {
      kasa: {
        findUnique: vi.fn().mockResolvedValue({ aktif: true, dovizCinsi: "TRY" }),
      },
      cariHesap: {
        findFirst: vi.fn().mockResolvedValue({ id: "cari-1" }),
      },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          tip: "satis",
          durum: "kesin",
          cariId: "cari-1",
          dovizCinsi: "TRY",
          genelToplam: new Prisma.Decimal("500.00"),
          kasaBankaHarekets: [],
          krediKartiHareketleri: [],
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      kasaBankaHareket: {
        create: vi.fn().mockResolvedValue({ id: "h1" }),
      },
      cariHareket: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const girdi = {
      kasaId: "kasa-1",
      tip: "tahsilat" as const,
      tutar: "500.00",
      dovizCinsi: "TRY" as const,
      kur: "1.00",
      tarih: "2026-07-12",
      cariId: "cari-1",
      faturaId: "fatura-1",
    };

    await service.hareketEkle(girdi);

    expect(mockTx.kasaBankaHareket.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1-uuid",
        kasaId: "kasa-1",
        bankaHesapId: undefined,
        posHesapId: undefined,
        tip: "tahsilat",
        tutar: new Prisma.Decimal("500.00"),
        dovizCinsi: "TRY",
        kur: new Prisma.Decimal("1.00"),
        tutarTry: new Prisma.Decimal("500.00"),
        tarih: new Date("2026-07-12"),
        aciklama: undefined,
        cariId: "cari-1",
        faturaId: "fatura-1",
        faturaKarsiligi: new Prisma.Decimal("500.00"),
        faturaMahsubu: new Prisma.Decimal("500.00"),
        kaynakTur: "fatura_kapama",
        kaynakRef: "fatura-1",
      },
    });

    expect(mockTx.cariHareket.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1-uuid",
        cariId: "cari-1",
        tip: "alacak", // Tahsilat cariyi alacaklandırır!
        tutar: new Prisma.Decimal("500.00"),
        dovizCinsi: "TRY",
        kur: new Prisma.Decimal("1.00"),
        tutarTry: new Prisma.Decimal("500.00"),
        tarih: new Date("2026-07-12"),
        aciklama: "TAHSILAT kasa/banka fişi",
        kaynakTur: "kasa_banka",
        kaynakRef: "h1",
      },
    });
  });

  it("POS brut alacagini net banka virmani ve komisyon gideriyle kapatir (ENT-04)", async () => {
    const create = vi.fn().mockResolvedValueOnce({ id: "gidis" }).mockResolvedValueOnce({ id: "gelis" }).mockResolvedValueOnce({ id: "komisyon" });
    const masrafCreate = vi.fn().mockResolvedValue({ id: "masraf-1" });
    const tx = {
      posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "pos-1", ad: "iyzico POS", aktif: true, dovizCinsi: "TRY", varsayilanBankaHesapId: "banka-1" }) },
      bankaHesap: { findUnique: vi.fn().mockResolvedValue({ id: "banka-1", aktif: true, dovizCinsi: "TRY" }) },
      kasaBankaHareket: { groupBy: vi.fn().mockResolvedValue([{ tip: "tahsilat", _sum: { tutar: new Prisma.Decimal(100) } }]), create, update: vi.fn().mockResolvedValue({}) },
      masrafKategori: { upsert: vi.fn().mockResolvedValue({ id: "kategori-1" }) },
      masraf: { create: masrafCreate },
    };
    mockTenantIslem.mockImplementation((_tenantId, cb) => cb(tx));
    const sonuc = await service.posBankayaAktar({ posHesapId: "11111111-1111-4111-8111-111111111111", brutTutar: "100.00", komisyonTutar: "4.00", tarih: "2026-08-11" });
    expect(sonuc).toEqual(expect.objectContaining({ brutTutar: "100.00", netTutar: "96.00", komisyonTutar: "4.00" }));
    expect(create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ posHesapId: "pos-1", tip: "virman_gidis", tutar: new Prisma.Decimal(96) }) });
    expect(create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ bankaHesapId: "banka-1", tip: "virman_gelis", tutar: new Prisma.Decimal(96), karsiHareketId: "gidis" }) });
    expect(create).toHaveBeenNthCalledWith(3, { data: expect.objectContaining({ posHesapId: "pos-1", tip: "tediye", tutar: new Prisma.Decimal(4), kaynakTur: "pos_mutabakat" }) });
    expect(masrafCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ kategoriId: "kategori-1", hareketId: "komisyon", toplam: new Prisma.Decimal(4), durum: "onaylandi", odemeDurumu: "odendi", kdvOrani: new Prisma.Decimal(0) }) });
  });

  it("POS mutabakatini bekleyen banka ekstre satirina baglar", async () => {
    const create = vi.fn().mockResolvedValueOnce({ id: "gidis" }).mockResolvedValueOnce({ id: "gelis" }).mockResolvedValueOnce({ id: "komisyon" });
    const ekstreGuncelle = vi.fn().mockResolvedValue({});
    const tx = {
      posHesap: { findUnique: vi.fn().mockResolvedValue({ id: "pos-1", ad: "PayTR POS", aktif: true, dovizCinsi: "TRY", varsayilanBankaHesapId: "banka-1" }) },
      bankaHesap: { findUnique: vi.fn().mockResolvedValue({ id: "banka-1", aktif: true, dovizCinsi: "TRY" }) },
      bankaEkstreSatir: { findUnique: vi.fn().mockResolvedValue({ id: "ekstre-1", bankaHesapId: "banka-1", durum: "beklemede", hareketId: null, tutar: new Prisma.Decimal(96) }), update: ekstreGuncelle },
      kasaBankaHareket: { groupBy: vi.fn().mockResolvedValue([{ tip: "tahsilat", _sum: { tutar: new Prisma.Decimal(100) } }]), create, update: vi.fn().mockResolvedValue({}) },
      masrafKategori: { upsert: vi.fn().mockResolvedValue({ id: "kategori-1" }) },
      masraf: { create: vi.fn().mockResolvedValue({ id: "masraf-1" }) },
    };
    mockTenantIslem.mockImplementation((_tenantId, cb) => cb(tx));
    await service.posBankayaAktar({ posHesapId: "11111111-1111-4111-8111-111111111111", ekstreSatirId: "22222222-2222-4222-8222-222222222222", brutTutar: "100.00", komisyonTutar: "4.00", tarih: "2026-08-11" });
    expect(ekstreGuncelle).toHaveBeenCalledWith({ where: { id: "ekstre-1" }, data: { durum: "eslesti", hareketId: "gelis" } });
  });
});

describe("KasaBankaService fatura kapama (KSB-07)", () => {
  const mockTenantIslem = vi.fn();
  const service = new KasaBankaService({ tenantIslem: mockTenantIslem } as any, {} as any, { tarihDogrula: vi.fn() } as any);

  const kur = (deger: string) => new Prisma.Decimal(deger);
  const islem = (fatura: Record<string, unknown>, hesapDovizi = "TRY") => {
    const tx = {
      bankaHesap: { findUnique: vi.fn().mockResolvedValue({ aktif: true, dovizCinsi: hesapDovizi }) },
      cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "cari-1" }) },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "fatura-1", no: "K07-1", tip: "satis", durum: "kesin", cariId: "cari-1",
          dovizCinsi: "TRY", kur: kur("1"), krediKartiHareketleri: [], kasaBankaHarekets: [], ...fatura,
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      kasaBankaHareket: { create: vi.fn(async ({ data }) => ({ id: "h1", ...data })) },
      cariHareket: { create: vi.fn().mockResolvedValue({}) },
    };
    mockTenantIslem.mockImplementation((_t, cb) => cb(tx));
    return tx;
  };
  const tahsilat = { bankaHesapId: "banka-1", tip: "tahsilat" as const, tarih: "2026-10-02", cariId: "cari-1", faturaId: "fatura-1" };

  it("USD faturayı TL ile kapatınca cari hareketi USD karşılıkla yazar", async () => {
    const tx = islem({ dovizCinsi: "USD", kur: kur("29.5"), genelToplam: kur("1000") });

    const sonuc = await service.hareketEkle({ ...tahsilat, tutar: "30000", dovizCinsi: "TRY" });

    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ faturaKarsiligi: kur("1000"), faturaMahsubu: kur("1000") });
    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ dovizCinsi: "USD", tutar: kur("1000"), kur: kur("30"), tutarTry: kur("30000") });
    expect(sonuc.faturaKapama).toEqual({ dovizCinsi: "USD", karsilik: "1000.00", mahsup: "1000.00", avans: "0.00" });
  });

  it("kullanıcının girdiği karşılık (banka kuru) TCMB kurunun yerine geçer", async () => {
    const tx = islem({ dovizCinsi: "USD", kur: kur("29.5"), genelToplam: kur("1000") });

    await service.hareketEkle({ ...tahsilat, tutar: "30000", dovizCinsi: "TRY", faturaKarsiligi: "985.22" });

    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ faturaKarsiligi: kur("985.22"), faturaMahsubu: kur("985.22") });
    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ dovizCinsi: "USD", tutar: kur("985.22") });
  });

  it("kalanı aşan ödemede kalan kadar mahsup eder, artanı avans bırakır", async () => {
    const tx = islem({ genelToplam: kur("500"), kasaBankaHarekets: [{ faturaMahsubu: kur("200") }] });

    const sonuc = await service.hareketEkle({ ...tahsilat, tutar: "450", dovizCinsi: "TRY" });

    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ faturaKarsiligi: kur("450"), faturaMahsubu: kur("300") });
    // Cariye ödemenin tamamı yazılır; 150 TL carinin avansı olarak kalır.
    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ tutar: kur("450") });
    expect(sonuc.faturaKapama).toMatchObject({ mahsup: "300.00", avans: "150.00" });
  });

  it("kapanmış faturaya ödeme bağlanmasını reddeder", async () => {
    islem({ genelToplam: kur("500"), kasaBankaHarekets: [{ faturaMahsubu: kur("500") }] });

    await expect(service.hareketEkle({ ...tahsilat, tutar: "10", dovizCinsi: "TRY" })).rejects.toThrow("zaten kapanmış");
  });

  it("faturayı satır kilidiyle okur (eşzamanlı iki ödeme aynı kalanı kullanamaz)", async () => {
    const tx = islem({ genelToplam: kur("500") });

    await service.hareketEkle({ ...tahsilat, tutar: "100", dovizCinsi: "TRY" });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("KasaBankaService dönem kilidi", () => {
  const kapali = () => ({ tarihDogrula: vi.fn().mockRejectedValue(new Error("Eylül 2026 mali dönemi kapalı")) });

  it("kapalı döneme virman yazmaz", async () => {
    const tenantIslem = vi.fn();
    const service = new KasaBankaService({ tenantIslem } as any, {} as any, kapali() as any);

    await expect(service.virmanEkle({ kaynakKasaId: "k1", hedefKasaId: "k2", tutar: "10", tarih: "2026-09-10" })).rejects.toThrow("kapalı");
    expect(tenantIslem).not.toHaveBeenCalled();
  });

  it("kapalı döneme POS aktarımı ve çek kaydı yazmaz", async () => {
    const tenantIslem = vi.fn();
    const service = new KasaBankaService({ tenantIslem } as any, {} as any, kapali() as any);

    await expect(service.posBankayaAktar({ posHesapId: "p1", brutTutar: "100", komisyonTutar: "2", tarih: "2026-09-10" })).rejects.toThrow("kapalı");
    await expect(service.cekSenetOlustur({ tur: "cek", yon: "alinan", portfoyNo: "P1", cekNo: "C1", islemTarihi: "2026-09-10", vadeTarihi: "2026-12-10", tutar: "100", dovizCinsi: "TRY", kur: "1", borclu: "Müşteri" })).rejects.toThrow("kapalı");
    expect(tenantIslem).not.toHaveBeenCalled();
  });

  it("çek tahsilini kapalı döneme yazmaz ama yalnız konum değişikliğine izin verir", async () => {
    const donemKilidi = kapali();
    const cek = { id: "cs1", yon: "alinan", durum: "portfoyde", tutar: new Prisma.Decimal("100"), kur: new Prisma.Decimal("1"), dovizCinsi: "TRY", tur: "cek", portfoyNo: "P1", borclu: "M", cari: null, aciklama: null };
    const tx = {
      cekSenet: { findUnique: vi.fn().mockResolvedValue(cek), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue(cek) },
      kasa: { findUnique: vi.fn().mockResolvedValue({ dovizCinsi: "TRY" }) },
      cekSenetOlay: { create: vi.fn() },
    };
    const service = new KasaBankaService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, {} as any, donemKilidi as any);

    await expect(service.cekSenetGuncelle("cs1", { durum: "tahsil_edildi", hesapKasaId: "k1", islemTarihi: "2026-09-10" })).rejects.toThrow("kapalı");
    await expect(service.cekSenetGuncelle("cs1", { durum: "tahsile_verildi", islemTarihi: "2026-09-10" })).resolves.toBeDefined();
  });
});

describe("KasaBankaService fiş geri alma (KSB-08)", () => {
  const D = (d: string) => new Prisma.Decimal(d);
  const hareket = (ek: Record<string, unknown> = {}) => ({
    id: "h1", tip: "tahsilat", kasaId: "k1", bankaHesapId: null, posHesapId: null, tutar: D("500"), dovizCinsi: "TRY", kur: D("1"), tutarTry: D("500"),
    tarih: new Date("2026-09-10"), aciklama: "Tahsilat", cariId: "cari-1", faturaId: "f1", faturaKarsiligi: D("500"), faturaMahsubu: D("500"),
    karsiHareketId: null, kaynakTur: "fatura_kapama", kaynakRef: "f1",
    ekstreSatir: null, posTahsilat: null, masraf: null, krediKartiOdemesi: null, gelirKaydi: null, pazaryeriKesinti: null, ...ek,
  });
  const cariHareket = { id: "ch1", cariId: "cari-1", tip: "alacak", tutar: D("500"), dovizCinsi: "TRY", kur: D("1"), tutarTry: D("500"), aciklama: "Tahsilat", kaynakRef: "h1" };

  function hazirla(kayitlar: Record<string, ReturnType<typeof hareket>>, donemKapali = false, tersVar = false) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      kasaBankaHareket: {
        findUnique: vi.fn(async ({ where }) => kayitlar[where.id] ?? null),
        findFirst: vi.fn().mockResolvedValue(tersVar ? { id: "ters" } : null),
        deleteMany: vi.fn(),
        create: vi.fn(async ({ data }) => ({ id: `ters-${data.kaynakRef}`, ...data })),
        update: vi.fn(),
      },
      cariHareket: { findMany: vi.fn().mockResolvedValue([cariHareket]), deleteMany: vi.fn(), create: vi.fn() },
      bankaEkstreSatir: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const donemKilidi = {
      tarihDogrula: vi.fn(async (_t: string, tarih: Date | string) => {
        const gun = typeof tarih === "string" ? tarih : tarih.toISOString().slice(0, 10);
        if (donemKapali && gun.startsWith("2026-09")) throw new ConflictException("Eylül 2026 mali dönemi kapalı");
      }),
    };
    const service = new KasaBankaService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, {} as any, donemKilidi as any);
    return { tx, service };
  }

  it("açık dönemde fişi cari hareketiyle siler ve görüntüsünü denetim izine yazar", async () => {
    const { tx, service } = hazirla({ h1: hareket({ ekstreSatir: { id: "es1" } }) });

    await expect(service.hareketGeriAl("h1", "Yanlış cari")).resolves.toEqual({ yontem: "silindi", hareketIdleri: ["h1"] });
    expect(tx.cariHareket.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["ch1"] } } });
    expect(tx.kasaBankaHareket.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["h1"] } } });
    expect(tx.bankaEkstreSatir.update).toHaveBeenCalledWith({ where: { id: "es1" }, data: { durum: "beklemede", cariId: null, faturaId: null, hareketId: null } });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ islem: "kasa_banka_fisi_silindi", varlikId: "h1", detay: expect.objectContaining({ neden: "Yanlış cari" }) });
  });

  it("kapalı dönemde bugün tarihli ters kayıt atar ve fatura mahsubunu geri açar", async () => {
    const { tx, service } = hazirla({ h1: hareket() }, true);

    const sonuc = await service.hareketGeriAl("h1", "Mükerrer giriş");

    expect(sonuc.yontem).toBe("ters_kayit");
    expect(tx.kasaBankaHareket.deleteMany).not.toHaveBeenCalled();
    expect(tx.kasaBankaHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "tediye", tutar: D("500"), faturaId: "f1", faturaMahsubu: D("-500"), kaynakTur: "ters_kayit", kaynakRef: "h1" });
    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "borc", tutar: D("500"), kaynakRef: "ters-h1" });
  });

  it("virmanın iki bacağını birlikte geri alır", async () => {
    const { tx, service } = hazirla({
      g1: hareket({ id: "g1", tip: "virman_gidis", kaynakTur: "manuel", faturaId: null, cariId: null, karsiHareketId: "g2" }),
      g2: hareket({ id: "g2", tip: "virman_gelis", kasaId: "k2", kaynakTur: "manuel", faturaId: null, cariId: null, karsiHareketId: "g1" }),
    });
    tx.cariHareket.findMany.mockResolvedValue([]);

    await expect(service.hareketGeriAl("g1", "Yanlış hesap")).resolves.toEqual({ yontem: "silindi", hareketIdleri: ["g1", "g2"] });
  });

  it("başka modülün ürettiği fişi geri almaz, kaynağını söyler", async () => {
    const { service } = hazirla({ h1: hareket({ kaynakTur: "masraf", masraf: { id: "m1" } }) });

    await expect(service.hareketGeriAl("h1", "Deneme")).rejects.toThrow("Masraflar ekranı");
  });

  it("aynı fişi ikinci kez geri almaz", async () => {
    const { service } = hazirla({ h1: hareket() }, true, true);

    await expect(service.hareketGeriAl("h1", "Deneme")).rejects.toThrow("zaten geri alındı");
  });

  it("düzeltmede eski fişi geri alıp yenisini aynı işlemde yazar", async () => {
    const { tx, service } = hazirla({ h1: hareket({ faturaId: null, faturaKarsiligi: null, faturaMahsubu: null, kaynakTur: "manuel" }) });
    Object.assign(tx, {
      kasa: { findUnique: vi.fn().mockResolvedValue({ aktif: true, dovizCinsi: "TRY" }) },
      cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "cari-1" }) },
    });
    tx.kasaBankaHareket.create.mockImplementation(async ({ data }) => ({ id: "yeni", ...data }));

    const sonuc = await service.hareketDuzelt("h1", "Tutar hatalı", { kasaId: "k1", tip: "tahsilat", tutar: "450", dovizCinsi: "TRY", tarih: "2026-10-02", cariId: "cari-1" });

    expect(sonuc.geriAlma.yontem).toBe("silindi");
    expect(sonuc.hareket).toMatchObject({ id: "yeni", tutar: D("450") });
  });
});

describe("KasaBankaService çek/senet son işlemi geri alma (KSB-08)", () => {
  const D = (d: string) => new Prisma.Decimal(d);
  const cek = (durum: string, olay: Record<string, unknown>) => ({
    id: "cs1", yon: "alinan", durum, tur: "cek", portfoyNo: "P1", tutar: D("1000"), kur: D("1"), dovizCinsi: "TRY", fizikselKonum: "x",
    olaylar: [{ id: "o1", islemTarihi: new Date("2026-09-10"), ...olay }],
  });
  function hazirla(kayit: ReturnType<typeof cek>, donemKapali = false, cariler: unknown[] = [], fisler: unknown[] = []) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      cekSenet: { findUnique: vi.fn().mockResolvedValue(kayit), delete: vi.fn(), update: vi.fn() },
      cekSenetOlay: { update: vi.fn(), create: vi.fn() },
      cariHareket: { findMany: vi.fn(async ({ where }) => (where.kaynakTur === "cek_senet_geri_alma" ? [] : cariler)), deleteMany: vi.fn(), create: vi.fn() },
      kasaBankaHareket: {
        findMany: vi.fn(async ({ where }) => (where.kaynakTur === "ters_kayit" ? [] : fisler)),
        findUnique: vi.fn(async ({ where }) => ({ id: where.id, tip: "tahsilat", kaynakTur: "cek_senet", tarih: new Date("2026-09-10"), karsiHareketId: null, ekstreSatir: null })),
        findFirst: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const donemKilidi = { tarihDogrula: vi.fn(async (_t: string, tarih: Date | string) => {
      const gun = typeof tarih === "string" ? tarih : tarih.toISOString().slice(0, 10);
      if (donemKapali && gun.startsWith("2026-09")) throw new ConflictException("kapalı");
    }) };
    const service = new KasaBankaService({ tenantIslem: vi.fn((_t, cb) => cb(tx)) } as any, {} as any, donemKilidi as any);
    return { tx, service };
  }
  const cariKaydi = { id: "c1", cariId: "cari-1", tip: "borc", tutar: D("1000"), dovizCinsi: "TRY", kur: D("1"), tutarTry: D("1000"), aciklama: "Ciro" };

  it("açık dönemde yalnız kaydı olan evrakı cari hareketiyle siler", async () => {
    const { tx, service } = hazirla(cek("portfoyde", { oncekiDurum: null, yeniDurum: "portfoyde" }), false, [cariKaydi]);

    await expect(service.cekSenetSonIslemiGeriAl("cs1", "Yanlış giriş")).resolves.toMatchObject({ yontem: "silindi", silindi: true });
    expect(tx.cariHareket.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["c1"] } } });
    expect(tx.cekSenet.delete).toHaveBeenCalledWith({ where: { id: "cs1" } });
  });

  it("tahsili geri alınca tahsil fişini siler ve evrakı portföye döndürür", async () => {
    const { tx, service } = hazirla(cek("tahsil_edildi", { oncekiDurum: "portfoyde", yeniDurum: "tahsil_edildi" }), false, [], [{ id: "f1" }]);

    await expect(service.cekSenetSonIslemiGeriAl("cs1", "Banka iade etti")).resolves.toMatchObject({ durum: "portfoyde" });
    expect(tx.kasaBankaHareket.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["f1"] } } });
    expect(tx.cekSenet.update.mock.calls[0][0].data).toMatchObject({ durum: "portfoyde", fizikselKonum: "Şirket portföyü" });
    expect(tx.cekSenetOlay.update).toHaveBeenCalledWith({ where: { id: "o1" }, data: { geriAlindi: true } });
    expect(tx.cekSenetOlay.create.mock.calls[0][0].data).toMatchObject({ oncekiDurum: "tahsil_edildi", yeniDurum: "portfoyde", geriAlma: true });
  });

  it("kapalı dönemdeki ciroyu ters cari hareketiyle geri alır ve ciro carisini boşaltır", async () => {
    const { tx, service } = hazirla(cek("ciro_edildi", { oncekiDurum: "portfoyde", yeniDurum: "ciro_edildi" }), true, [cariKaydi]);

    await expect(service.cekSenetSonIslemiGeriAl("cs1", "Tedarikçi iade etti")).resolves.toMatchObject({ yontem: "ters_kayit" });
    expect(tx.cariHareket.deleteMany).not.toHaveBeenCalled();
    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "alacak", tutar: D("1000"), kaynakTur: "cek_senet_geri_alma", kaynakRef: "c1" });
    expect(tx.cekSenet.update.mock.calls[0][0].data).toMatchObject({ durum: "portfoyde", ciroCariId: null });
  });
});

