import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { FaturaService } from "./fatura.service";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { _tumPolitikalariTemizle, registerEylemPolitikasi } from "../core/eylemler/eylem-kayit";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({
    tenantId: "t1-uuid",
    userId: "u1-uuid",
    rol: "satis",
  }),
}));

describe("FaturaService (FTR-14 - maksIskontoYuzdesi)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = {
    tenantIslem: mockTenantIslem,
  } as any;
  const mockEposta = {} as any;
  const service = new FaturaService(mockPrisma, mockEposta, {} as any, {} as any, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

  it("maksIskontoYuzdesi asildiginda BadRequestException firlatir", async () => {
    const mockTx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "u1-uuid",
          maksIskontoYuzdesi: new Prisma.Decimal("10.00"),
        }),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    // Case 1: Line discount exceeds limit
    const girdi1 = {
      cariId: "c1",
      tip: "satis" as const,
      tarih: "2026-07-13",
      satirlar: [
        {
          stokId: "s1",
          miktar: "1",
          birim: "adet",
          birimFiyat: "100",
          iskontoOrani: "15", // Exceeds 10%
          kdvOrani: "20",
        },
      ],
    };

    await expect(service.olustur(girdi1)).rejects.toThrow(
      new BadRequestException("Satır 1 için maksimum iskonto yetkiniz (%10) aşılmıştır.")
    );

    // Case 2: General discount exceeds limit
    const girdi2 = {
      cariId: "c1",
      tip: "satis" as const,
      tarih: "2026-07-13",
      genelIskontoYuzdesi: "12", // Exceeds 10%
      satirlar: [
        {
          stokId: "s1",
          miktar: "1",
          birim: "adet",
          birimFiyat: "100",
          iskontoOrani: "5",
          kdvOrani: "20",
        },
      ],
    };

    await expect(service.olustur(girdi2)).rejects.toThrow(
      new BadRequestException("Maksimum iskonto yetkiniz (%10) aşılmıştır.")
    );
  });

  it("yon, durum ve e-Belge filtrelerini veritabani sorgusuna uygular", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    mockTenantIslem.mockImplementation((_tenantId, cb) => cb({ fatura: { findMany } }));

    await service.listele(undefined, undefined, "kesin", undefined, 50, "satis", "hata");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tip: { in: ["satis", "satis_iade", "proforma"] },
        durum: "kesin",
        ebelge: { is: { durum: { in: ["hata", "ret"] } } },
      },
    }));
  });

  it("iş kuyruğu sayaçlarını fatura dövizindeki mahsupla hesaplar (KSB-07)", async () => {
    const fatura = (tip: string, durum: string, toplam: string, odemeler: Array<{ mahsup: string }>, ebelgeDurum?: string, kur = "1") => ({
      tip, durum, genelToplam: new Prisma.Decimal(toplam), kur: new Prisma.Decimal(kur),
      ebelge: ebelgeDurum ? { durum: ebelgeDurum } : null,
      kasaBankaHarekets: odemeler.map(({ mahsup }) => ({ faturaMahsubu: new Prisma.Decimal(mahsup) })),
      krediKartiHareketleri: [],
    });
    const findMany = vi.fn().mockResolvedValue([
      fatura("satis", "taslak", "100", [], "hata"),
      fatura("alis", "taslak", "100", []),
      fatura("satis", "kesin", "100", [{ mahsup: "20" }]),
      fatura("alis", "kesin", "100", [{ mahsup: "100" }]),
      fatura("satis_iade", "kesin", "100", []),
      fatura("alis_iade", "kesin", "100", []),
      fatura("satis", "kesin", "100", [{ mahsup: "100" }], undefined, "2"),
    ]);
    mockTenantIslem.mockImplementation((_tenantId, cb) => cb({ fatura: { findMany } }));

    await expect(service.isKuyruguOzeti()).resolves.toEqual({
      taslakSatis: 1, taslakAlis: 1, ebelgeHata: 1, acikTahsilat: 2, acikOdeme: 1,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.any(Object) }));
  });
});

describe("FaturaService.taslagaGeriAl (FTR-29)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = { tenantIslem: mockTenantIslem } as any;
  const tarih = new Date("2026-09-20T00:00:00Z");

  function kur(ebelge: unknown, fatura: Record<string, unknown> = {}) {
    const entegratoreUlasmadiginiDogrula = vi.fn();
    const hareketEkle = vi.fn();
    const zincirEtkisiniCoz = vi.fn();
    const tx = {
      fatura: {
        findUnique: vi.fn().mockResolvedValue({ id: "f1", no: "TKR2026000000007", sira: 7, seri: "TKR", durum: "kesin", tip: "satis", tarih, vadeTarihi: null, genelToplam: new Prisma.Decimal("900.00"), cariId: "c1", dovizCinsi: "TRY", kur: new Prisma.Decimal("1"), ebelge, ...fatura }),
        update: vi.fn().mockResolvedValue({ id: "f1", durum: "taslak" }),
      },
      kasaBankaHareket: { count: vi.fn().mockResolvedValue(0) },
      posTahsilat: { count: vi.fn().mockResolvedValue(0) },
      krediKartiHareket: { count: vi.fn().mockResolvedValue(0) },
      stokHareket: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      cariHareket: { create: vi.fn().mockResolvedValue({}) },
      ebelgeKayit: { delete: vi.fn().mockResolvedValue({}) },
      belge: { findMany: vi.fn().mockResolvedValue([{ id: "irs1" }]) },
    } as any;
    mockTenantIslem.mockImplementation((_t: string, cb: (t: unknown) => unknown) => cb(tx));
    const service = new FaturaService(
      mockPrisma, { hareketEkle } as any, {} as any, {} as any, {} as any, { zincirEtkisiniCoz } as any,
      { tarihDogrula: vi.fn() } as any, {} as any, { entegratoreUlasmadiginiDogrula } as any,
    );
    vi.spyOn(service as any, "gorunum").mockImplementation((f) => f);
    return { service, tx, entegratoreUlasmadiginiDogrula, hareketEkle, zincirEtkisiniCoz };
  }

  it("stok ve cariyi fatura tarihinde ters kayıtla geri alır, rezervi geri koyar, numarayı korur", async () => {
    const { service, tx, hareketEkle, zincirEtkisiniCoz } = kur(null);
    tx.stokHareket.findMany.mockResolvedValue([{
      stokId: "s1", varyantId: null, depoId: "d1", tip: "cikis", tarih,
      miktar: new Prisma.Decimal("-5"), girilenBirim: "adet", girilenMiktar: new Prisma.Decimal("5"),
      maliyet: new Prisma.Decimal("0"), partiler: [],
    }]);

    await service.taslagaGeriAl("f1");

    const stok = hareketEkle.mock.calls[0][1];
    expect(stok).toMatchObject({ tip: "giris", tarih, kaynakTur: "fatura_geri_alma", kaynakRef: "f1" });
    expect(stok.miktar.toString()).toBe("5");
    expect(tx.cariHareket.create.mock.calls[0][0].data).toMatchObject({ tip: "alacak", tarih, kaynakTur: "fatura_geri_alma" });
    expect(zincirEtkisiniCoz).toHaveBeenCalledWith(tx, ["irs1"], 1);
    // Numara, seri ve sıra yazılmaz: yeniden kesinleştirmede aynısı kullanılır.
    expect(tx.fatura.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { durum: "taslak" } });
  });

  it("yalnız son kesinleştirmenin hareketlerini çevirir", async () => {
    const { service, tx } = kur(null);
    const onceki = new Date("2026-09-21T10:00:00Z");
    tx.stokHareket.findFirst.mockResolvedValue({ createdAt: onceki });

    await service.taslagaGeriAl("f1");

    expect(tx.stokHareket.findMany.mock.calls[0][0].where).toMatchObject({ kaynakTur: "fatura", createdAt: { gt: onceki } });
  });

  it("entegratöre ulaşmamış e-Belgeyi sağlayıcıya sorup siler", async () => {
    const ebelge = { id: "eb1", tur: "efatura", durum: "hata", entegratorRef: null };
    const { service, tx, entegratoreUlasmadiginiDogrula } = kur(ebelge);

    await service.taslagaGeriAl("f1");

    expect(entegratoreUlasmadiginiDogrula).toHaveBeenCalled();
    expect(tx.ebelgeKayit.delete).toHaveBeenCalledWith({ where: { id: "eb1" } });
  });

  it("belge entegratörde çıkarsa hiçbir şeyi değiştirmez", async () => {
    const { service, tx, entegratoreUlasmadiginiDogrula, hareketEkle } = kur({ id: "eb1", tur: "efatura", durum: "hata", entegratorRef: null });
    entegratoreUlasmadiginiDogrula.mockRejectedValue(new Error("Belge entegratörde oluşmuş"));

    await expect(service.taslagaGeriAl("f1")).rejects.toThrow("oluşmuş");
    expect(tx.ebelgeKayit.delete).not.toHaveBeenCalled();
    expect(hareketEkle).not.toHaveBeenCalled();
  });

  it("gönderilmiş ya da reddedilmiş e-Belgede ve tahsilat bağlıyken geri almaz", async () => {
    await expect(kur({ id: "eb1", tur: "efatura", durum: "iletildi", entegratorRef: "u" }).service.taslagaGeriAl("f1")).rejects.toThrow("gönderilmiş");
    await expect(kur({ id: "eb1", tur: "efatura", durum: "hata", entegratorRef: "u" }).service.taslagaGeriAl("f1")).rejects.toThrow("reddedilmiş");
    const { service, tx } = kur(null);
    tx.kasaBankaHareket.count.mockResolvedValue(1);
    await expect(service.taslagaGeriAl("f1")).rejects.toThrow("Tahsilat veya ödeme");
  });
});

describe("FaturaService.iptal — e-belge kuralı (EBLG-22)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = { tenantIslem: mockTenantIslem } as any;

  function kur(ebelge: unknown, no: string | null = "SNC2026000000003") {
    const earsivBelgesiniIptalEt = vi.fn();
    const gitmemisBelgeyiKapat = vi.fn();
    const hareketEkle = vi.fn();
    const tx = {
      fatura: { findUnique: vi.fn().mockResolvedValue({ id: "f1", no, durum: "kesin", tip: "satis", tarih: new Date(), genelToplam: new Prisma.Decimal("900.00"), cariId: "c1", dovizCinsi: "TRY", kur: new Prisma.Decimal("1"), ebelge }) },
      kasaBankaHareket: { count: vi.fn().mockResolvedValue(0) },
      posTahsilat: { count: vi.fn().mockResolvedValue(0) },
      krediKartiHareket: { count: vi.fn().mockResolvedValue(0) },
      stokHareket: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      cariHareket: { create: vi.fn().mockResolvedValue({}) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      belge: { updateMany: vi.fn().mockResolvedValue({}) },
      gelenEbelge: { updateMany: vi.fn().mockResolvedValue({}) },
      fatura2: null,
    } as any;
    tx.fatura.update = vi.fn().mockResolvedValue({ id: "f1", durum: "iptal" });
    mockTenantIslem.mockImplementation((_t: string, cb: (t: unknown) => unknown) => cb(tx));
    const service = new FaturaService(
      mockPrisma, { hareketEkle } as any, {} as any, {} as any, {} as any, {} as any,
      { tarihDogrula: vi.fn() } as any, {} as any, { earsivBelgesiniIptalEt, gitmemisBelgeyiKapat } as any,
    );
    return { service, tx, earsivBelgesiniIptalEt, gitmemisBelgeyiKapat, hareketEkle };
  }

  it("stok çıkışını pozitif miktarlı girişle geri alır", async () => {
    // Hareket miktarı işaretli saklanır (çıkış -1000); işaretli verilirse
    // iptalin girişi stoğu bir kez daha düşürüyordu.
    const { service, tx, hareketEkle } = kur(null);
    tx.stokHareket.findMany.mockResolvedValue([{
      stokId: "s1", varyantId: null, depoId: "d1", tip: "cikis",
      miktar: new Prisma.Decimal("-1000"), girilenBirim: "adet", girilenMiktar: new Prisma.Decimal("1000"),
      maliyet: new Prisma.Decimal("0"), partiler: [],
    }]);

    await service.iptal("f1");

    const girdi = hareketEkle.mock.calls[0][1];
    expect(girdi.tip).toBe("giris");
    expect(girdi.miktar.toString()).toBe("1000");
  });

  it("e-Fatura olarak gönderilmiş faturayı iptal etmez, iade faturasına yönlendirir", async () => {
    // Kesilen e-Fatura iptal edilmez; düzeltme yolu iade faturasıdır.
    const { service, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "efatura", durum: "iletildi", entegratorRef: "REF" });

    await expect(service.iptal("f1")).rejects.toThrow("iade faturası düzenleyin");
    expect(earsivBelgesiniIptalEt).not.toHaveBeenCalled();
  });

  it("e-Arşiv faturasında belgeyi entegratörde de iptal eder", async () => {
    // Tek adım: iki sistem ya birlikte iptal olur ya hiç.
    const { service, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "earsiv", durum: "iletildi", entegratorRef: "EARSIV:x" });

    await service.iptal("f1");

    expect(earsivBelgesiniIptalEt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "f1" }),
      expect.objectContaining({ id: "eb1" }),
    );
  });

  it("entegratör iptali başarısızsa fatura iptal edilmez", async () => {
    // Hata yukarı taşınır ve çağıranın işlemi geri alınır; bizde iptal görünüp
    // GİB'de canlı duran belge kalmaz.
    const { service, tx, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "earsiv", durum: "iletildi", entegratorRef: "EARSIV:x" });
    earsivBelgesiniIptalEt.mockRejectedValue(new BadRequestException("GİB raporuna girmiş"));

    await expect(service.iptal("f1")).rejects.toThrow("GİB raporuna girmiş");
    expect(tx.fatura.update).not.toHaveBeenCalled();
  });

  it("entegratöre hiç ulaşmamış e-Fatura belgesinde faturayı iptal eder, iade istemez (EBLG-81)", async () => {
    const { service, tx, earsivBelgesiniIptalEt, gitmemisBelgeyiKapat } = kur({ id: "eb1", tur: "efatura", durum: "hata", entegratorRef: null }, null);

    await service.iptal("f1");

    expect(gitmemisBelgeyiKapat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "f1" }), expect.objectContaining({ id: "eb1" }));
    expect(earsivBelgesiniIptalEt).not.toHaveBeenCalled();
    expect(tx.cariHareket.create).toHaveBeenCalled();
    expect(tx.fatura.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { durum: "iptal" } });
  });

  it("belge entegratörde bulunursa fatura iptal edilmez (EBLG-81)", async () => {
    const { service, tx, gitmemisBelgeyiKapat } = kur({ id: "eb1", tur: "earsiv", durum: "hata", entegratorRef: null }, null);
    gitmemisBelgeyiKapat.mockRejectedValue(new BadRequestException("Belge entegratörde oluşmuş"));

    await expect(service.iptal("f1")).rejects.toThrow("entegratörde oluşmuş");
    expect(tx.fatura.update).not.toHaveBeenCalled();
  });

  it("hata durumunda ama numarası olan e-Fatura iade ister (EBLG-81)", async () => {
    const { service, gitmemisBelgeyiKapat } = kur({ id: "eb1", tur: "efatura", durum: "hata", entegratorRef: null }, "K072026000000001");

    await expect(service.iptal("f1")).rejects.toThrow("iade faturası düzenleyin");
    expect(gitmemisBelgeyiKapat).not.toHaveBeenCalled();
  });

  it("zaten iptal edilmiş belgeyi ikinci kez iptal etmeye çalışmaz", async () => {
    const { service, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "earsiv", durum: "iptal", entegratorRef: "EARSIV:x" });

    await service.iptal("f1");

    expect(earsivBelgesiniIptalEt).not.toHaveBeenCalled();
  });
});

describe("FaturaService.kopyala", () => {
  it("toplamları belirleyen fatura ve satır işaretlerini kopyaya taşır", async () => {
    registerEylemPolitikasi("fatura", { kopyala: () => true });
    const olusanFatura = vi.fn().mockResolvedValue({ id: "kopya" });
    const olusanSatir = vi.fn().mockResolvedValue({});
    const tx = {
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1", tip: "satis", durum: "kesin", cariId: "c1", dovizCinsi: "TRY", kur: 1,
          gelirTuru: "ticari_satis", depoId: "d1", senaryo: "ihrackayitli", efaturaProfili: "ticari",
          earsivGonderimSekli: "elektronik", ihracKayitliKodu: "701", ihracatTeslimSarti: null, ihracatTasimaSekli: null,
          aciklama: null, notlar: null,
          satirlar: [{ stokId: "s1", miktar: 1, birimFiyat: 100, tevkifatKodu: "602", tevkifatPay: 9, tevkifatPayda: 10, projeId: "p1", projeAltKirilimId: null, gibIstisnaKodu: null }],
        }),
        create: olusanFatura,
      },
      faturaSatir: { create: olusanSatir },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)) } as any;
    const service = new FaturaService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
    vi.spyOn(service, "getir").mockResolvedValue({ id: "kopya" } as any);

    await service.kopyala("f1");

    expect(olusanFatura.mock.calls[0][0].data).toMatchObject({ durum: "taslak", ihracKayitliKodu: "701", senaryo: "ihrackayitli", efaturaProfili: "ticari", depoId: "d1" });
    expect(olusanSatir.mock.calls[0][0].data).toMatchObject({ tevkifatKodu: "602", projeId: "p1" });
    _tumPolitikalariTemizle();
  });
});

describe("FaturaService.pdfGonder — e-posta eki", () => {
  const kur = (ebelge: { durum: string; tur: string } | null, gorunum: { gidenPdf: ReturnType<typeof vi.fn> }) => {
    const ekliIletiGonder = vi.fn().mockResolvedValue(undefined);
    const service = new FaturaService(
      {} as any, {} as any, {} as any, {} as any, { ekliIletiGonder } as any, {} as any,
      {} as any, {} as any, {} as any, gorunum as any,
    );
    vi.spyOn(service, "getir").mockResolvedValue({ id: "f1", no: "K072026000000110", durum: "kesin", cariId: "c1", cari: { unvan: "Alıcı A.Ş." }, ebelge } as any);
    const sistemPdf = vi.spyOn(service, "pdfUret").mockResolvedValue({ buffer: Buffer.from("sistem"), dosyaAdi: "fatura-K07.pdf" });
    return { service, ekliIletiGonder, sistemPdf };
  };

  it("GİB'e gitmiş faturada resmî e-Belge görünümünü ekler", async () => {
    const gorunum = { gidenPdf: vi.fn().mockResolvedValue({ buffer: Buffer.from("resmi"), dosyaAdi: "efatura-K07.pdf" }) };
    const { service, ekliIletiGonder, sistemPdf } = kur({ durum: "iletildi", tur: "efatura" }, gorunum);

    const sonuc = await service.pdfGonder("f1", "alici@example.com");

    expect(sonuc.belge).toBe("ebelge");
    expect(sistemPdf).not.toHaveBeenCalled();
    const ileti = ekliIletiGonder.mock.calls[0][0];
    expect(ileti.ekler[0]).toMatchObject({ dosyaAdi: "efatura-K07.pdf", icerik: Buffer.from("resmi") });
    expect(ileti.metin).toContain("e-Faturanız");
  });

  it("e-Belgesi olmayan ya da arşivi bulunmayan faturada sistem PDF'ine düşer", async () => {
    const yok = { gidenPdf: vi.fn() };
    const bos = kur(null, yok);
    expect((await bos.service.pdfGonder("f1", "alici@example.com")).belge).toBe("sistem");
    expect(yok.gidenPdf).not.toHaveBeenCalled();

    const arsivsiz = { gidenPdf: vi.fn().mockRejectedValue(new NotFoundException("arşiv yok")) };
    const hata = kur({ durum: "iletildi", tur: "earsiv" }, arsivsiz);
    expect((await hata.service.pdfGonder("f1", "alici@example.com")).belge).toBe("sistem");
    expect(hata.sistemPdf).toHaveBeenCalled();
  });
});
