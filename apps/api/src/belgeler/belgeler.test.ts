import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { bugunTR, vadeTarihiHesapla } from "@tekirextra/shared";
import { BelgelerService } from "./belgeler.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
}));

// CARI-32 denetimi kendi testinde; burada servis akışı sınanır.
vi.mock("../cari/cari-islem-denetimi", () => ({
  cariIslemDenetle: vi.fn(async () => undefined),
  riskLimitiDenetle: vi.fn(async () => null),
}));


describe("BelgelerService", () => {
  it("eşzamanlı işlemde kapanan belge sayısı değişirse taslağı geri aldırır", async () => {
    const belge = {
      id: "b1",
      no: "SP-001",
      durum: "onaylandi",
      tur: "siparis",
      cariId: "c1",
      dovizCinsi: "TRY",
      kur: new Prisma.Decimal(1),
      yon: "satis",
      depoId: "d1",
      satirlar: [],
    };
    const tx = {
      belge: {
        findMany: vi.fn().mockResolvedValue([belge]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      fatura: { create: vi.fn().mockResolvedValue({ id: "f1" }) },
      faturaSatir: { create: vi.fn() },
      stokEkVergi: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await expect(service.topluFatura({ belgeIds: ["b1"] })).rejects.toThrow(ConflictException);
    expect(tx.belge.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, durum: "onaylandi", faturaId: null },
      data: { durum: "kapandi", faturaId: "f1" },
    });
  });

  it("toplu faturada ilk dolu referansları, ilgili kişiyi ve koşulları faturaya yazar (FTR-31/32/33)", async () => {
    const belge = (id: string, ek: Record<string, unknown>) => ({
      id, no: id, durum: "onaylandi", tur: "irsaliye", cariId: "c1", dovizCinsi: "TRY",
      kur: new Prisma.Decimal(1), yon: "satis", depoId: "d1", satirlar: [], ...ek,
    });
    const tx = {
      belge: {
        findMany: vi.fn().mockResolvedValue([
          belge("i1", { siparisNo: null, talepNo: "RFQ-1", talepTarihi: new Date("2026-09-01"), teslimSekli: "EXW" }),
          belge("i2", { siparisNo: "PO-2", siparisTarihi: new Date("2026-09-10"), talepNo: "RFQ-1", ilgiliKisi: "Ali Er", ilgiliKisiGorevi: "Depo", odemeVadeGun: 30 }),
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      fatura: { create: vi.fn().mockResolvedValue({ id: "f1" }), findUnique: vi.fn().mockResolvedValue(null) },
      faturaSatir: { create: vi.fn() },
      stokEkVergi: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await service.topluFatura({ belgeIds: ["i1", "i2"] });

    expect(tx.fatura.create.mock.calls[0][0].data).toMatchObject({
      siparisNo: "PO-2", siparisTarihi: new Date("2026-09-10"), talepNo: "RFQ-1", talepTarihi: new Date("2026-09-01"),
      ilgiliKisi: "Ali Er", ilgiliKisiGorevi: "Depo",
      // FTR-33: vade = bugün + 30 gün; teslim şekli ihracat teslim şartına gider.
      vadeTarihi: new Date(vadeTarihiHesapla(bugunTR(), 30)!),
      ihracatTeslimSarti: "EXW",
    });
  });

  it("zincirden açılan faturaya ürün kartının KDV dışı vergisi yazılır (EBLG-125)", async () => {
    const satir = { stokId: "s1", varyantId: null, miktar: new Prisma.Decimal(1), birim: "adet", birimFiyat: new Prisma.Decimal(1000), iskontoOrani: new Prisma.Decimal(0), kdvOrani: new Prisma.Decimal(20), tevkifatPay: null, tevkifatPayda: null };
    const tx = {
      belge: {
        findMany: vi.fn().mockResolvedValue([{ id: "i1", no: "i1", durum: "onaylandi", tur: "irsaliye", cariId: "c1", dovizCinsi: "TRY", kur: new Prisma.Decimal(1), yon: "satis", depoId: "d1", satirlar: [satir] }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      fatura: { create: vi.fn().mockResolvedValue({ id: "f1" }), findUnique: vi.fn().mockResolvedValue(null) },
      faturaSatir: { create: vi.fn() },
      stokEkVergi: { findMany: vi.fn().mockResolvedValue([{ stokId: "s1", kod: "0074", hesap: "oran", deger: new Prisma.Decimal(25) }]) },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await service.topluFatura({ belgeIds: ["i1"] });

    const fatura = tx.fatura.create.mock.calls[0][0].data;
    expect(fatura.toplamEkVergi.toString()).toBe("250");
    expect(fatura.toplamKdv.toString()).toBe("250");
    expect(fatura.genelToplam.toString()).toBe("1500");
    const kayit = tx.faturaSatir.create.mock.calls[0][0].data;
    expect(kayit.ekVergiTutari.toString()).toBe("250");
    expect(kayit.ekVergiler).toEqual([expect.objectContaining({ kod: "0074", oran: "25", tutar: "250.00", kdvMatrahinaDahil: true })]);
  });

  it("belgedeki KDV dışı vergi faturaya karttan değil belgeden geçer (EBLG-132)", async () => {
    const satir = {
      stokId: "s1", varyantId: null, miktar: new Prisma.Decimal(2), birim: "adet", birimFiyat: new Prisma.Decimal(500), iskontoOrani: new Prisma.Decimal(0), kdvOrani: new Prisma.Decimal(20), tevkifatPay: null, tevkifatPayda: null,
      // Kullanıcı teklifte kart oranını (%25) %10'a indirmiş
      ekVergiler: [{ kod: "0074", ad: "ÖTV III", hesap: "oran", oran: "10", birimTutar: null, matrah: "1000.00", tutar: "100.00", stopaj: false, kdvMatrahinaDahil: true }],
    };
    const tx = {
      belge: {
        findMany: vi.fn().mockResolvedValue([{ id: "i1", no: "i1", durum: "onaylandi", tur: "irsaliye", cariId: "c1", dovizCinsi: "TRY", kur: new Prisma.Decimal(1), yon: "satis", depoId: "d1", satirlar: [satir] }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      fatura: { create: vi.fn().mockResolvedValue({ id: "f1" }), findUnique: vi.fn().mockResolvedValue(null) },
      faturaSatir: { create: vi.fn() },
      stokEkVergi: { findMany: vi.fn().mockResolvedValue([{ stokId: "s1", kod: "0074", hesap: "oran", deger: new Prisma.Decimal(25) }]) },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await service.topluFatura({ belgeIds: ["i1"] });

    expect(tx.fatura.create.mock.calls[0][0].data.toplamEkVergi.toString()).toBe("100");
    expect(tx.faturaSatir.create.mock.calls[0][0].data.ekVergiler).toEqual([expect.objectContaining({ kod: "0074", oran: "10", tutar: "100.00" })]);
  });

  describe("belge oluşturmada KDV dışı vergiler (EBLG-132)", () => {
    const girdi = (ek: Record<string, unknown>) => ({
      tur: "teklif" as const, yon: "satis" as const, tarih: "2026-10-11", cariId: "11111111-1111-1111-1111-111111111111", dovizCinsi: "TRY" as const, kur: "1",
      genelIskontoYuzdesi: "0", genelIskontoTutari: "0",
      satirlar: [{ stokId: "22222222-2222-2222-2222-222222222222", miktar: "2", birim: "adet", birimFiyat: "500", iskontoOrani: "0", kdvOrani: "20", ...ek }],
    });
    const kur = () => {
      const tx = {
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        belge: { create: vi.fn((a: { data: Record<string, unknown> }) => Promise.resolve({ id: "b1", ...a.data })) },
        belgeSatir: { create: vi.fn() },
        stokEkVergi: { findMany: vi.fn().mockResolvedValue([{ stokId: "22222222-2222-2222-2222-222222222222", kod: "0074", hesap: "oran", deger: new Prisma.Decimal(25) }]) },
        stokKart: { findMany: vi.fn().mockResolvedValue([{ id: "22222222-2222-2222-2222-222222222222", anaBirim: "adet", birimler: [] }]) },
        stokVaryant: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
        cariHesap: { findUnique: vi.fn().mockResolvedValue({ varsayilanVadeGun: null }) },
      };
      const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as any;
      return { tx, servis: new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any) };
    };

    it("alan gönderilmezse ürün kartının vergisini uygular", async () => {
      const { tx, servis } = kur();
      await servis.olustur(girdi({}) as any);
      const belge = tx.belge.create.mock.calls[0][0].data;
      // 1000 + ÖTV 250 → KDV 250, genel 1500
      expect(belge.toplamEkVergi.toString()).toBe("250");
      expect(belge.genelToplam.toString()).toBe("1500");
      expect(tx.belgeSatir.create.mock.calls[0][0].data.ekVergiler).toEqual([expect.objectContaining({ kod: "0074", tutar: "250.00" })]);
    });

    it("boş dizi gönderilirse vergisiz kaydeder ve boş dizi saklar", async () => {
      const { tx, servis } = kur();
      await servis.olustur(girdi({ ekVergiler: [] }) as any);
      expect(tx.belge.create.mock.calls[0][0].data.genelToplam.toString()).toBe("1200");
      expect(tx.belgeSatir.create.mock.calls[0][0].data.ekVergiler).toEqual([]);
    });

    it("maktu vergiyi miktar başı hesaplar", async () => {
      const { tx, servis } = kur();
      await servis.olustur(girdi({ ekVergiler: [{ kod: "0071", hesap: "birim", birimTutar: "12.5" }] }) as any);
      expect(tx.belge.create.mock.calls[0][0].data.toplamEkVergi.toString()).toBe("25");
    });
  });

  it("sonraki sayfa imlecini son döndürülen belgeye koyar", async () => {
    const belge = (id: string) => ({
      id, tur: "siparis", yon: "satis", durum: "onaylandi", no: id,
      tarih: new Date("2026-08-08"), gecerlilikTarihi: null, cariId: "c1", depoId: "d1",
      dovizCinsi: "TRY", kur: new Prisma.Decimal(1), genelIskontoYuzdesi: new Prisma.Decimal(0),
      genelIskontoTutari: new Prisma.Decimal(0), toplamBrut: new Prisma.Decimal(100),
      toplamSatirIskontosu: new Prisma.Decimal(0), genelIskontoToplam: new Prisma.Decimal(0),
      toplamMatrah: new Prisma.Decimal(100), toplamKdv: new Prisma.Decimal(20),
      toplamTevkifat: new Prisma.Decimal(0), toplamNetKdv: new Prisma.Decimal(20),
      genelToplam: new Prisma.Decimal(120), aciklama: null, notlar: null, kaynakBelgeId: null, faturaId: null,
      cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
    });
    const findMany = vi.fn().mockResolvedValue([belge("b1"), belge("b2"), belge("b3")]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ belge: { findMany } })),
    } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    const sonuc = await service.listele(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 2);

    expect(sonuc.kayitlar.map((kayit) => kayit.id)).toEqual(["b1", "b2"]);
    expect(sonuc.sonrakiImlec).toBe("b2");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });

  // ─── Kısmi teslim (SAT-09) ────────────────────────────────────────────────

  const D = (v: string | number) => new Prisma.Decimal(v);

  /** Tek satırlı (100 adet × 10 TL) onaylı sipariş ve sahte işlem bağlamı. */
  function siparisKurulumu(secenek: { teslimEdilen?: string; durum?: string; miktar?: string } = {}) {
    const satir = {
      id: "s1",
      stokId: "stk1",
      varyantId: null,
      partiBilgileri: null,
      miktar: D(secenek.miktar ?? "100"),
      teslimEdilenMiktar: D(secenek.teslimEdilen ?? "0"),
      birim: "adet",
      birimFiyat: D("10"),
      iskontoOrani: D(0),
      iskontoTutari: D(0),
      genelIskontoPayi: D(0),
      matrah: D("1000"),
      kdvOrani: D("20"),
      kdvTutari: D("200"),
      tevkifatPay: null,
      tevkifatPayda: null,
      tevkifatTutari: D(0),
      netKdvTutari: D("200"),
      toplamTutar: D("1200"),
    };
    const belge = {
      id: "sip1",
      tur: "siparis",
      yon: "alis",
      durum: secenek.durum ?? "onaylandi",
      no: "SIP2026000001",
      tarih: new Date("2026-09-16"),
      gecerlilikTarihi: null,
      cariId: "c1",
      depoId: "d1",
      dovizCinsi: "TRY",
      kur: D(1),
      genelIskontoYuzdesi: D(0),
      genelIskontoTutari: D(0),
      toplamBrut: D("1000"),
      toplamSatirIskontosu: D(0),
      genelIskontoToplam: D(0),
      toplamMatrah: D("1000"),
      toplamKdv: D("200"),
      toplamTevkifat: D(0),
      toplamNetKdv: D("200"),
      genelToplam: D("1200"),
      aciklama: null,
      notlar: null,
      kaynakBelgeId: null,
      faturaId: null,
      satirlar: [satir],
    };
    const tx = {
      belge: {
        findUnique: vi.fn().mockResolvedValue(belge),
        create: vi.fn().mockResolvedValue({ id: "irs1" }),
        update: vi.fn().mockResolvedValue(belge),
      },
      belgeSatir: { createMany: vi.fn(), update: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
    return { servis, tx, belge, satir };
  }

  it("kısmi teslimde irsaliyeyi girilen miktarla keser ve siparişi açık bırakır (SAT-09)", async () => {
    const { servis, tx } = siparisKurulumu();

    const sonuc = await servis.donustur("sip1", "irsaliye", { kalemler: [{ satirId: "s1", miktar: "40" }] });

    expect(sonuc).toMatchObject({ donusenTur: "irsaliye", belgeId: "irs1", kaynakKapandi: false });
    // Yeni belgenin toplamları 40 adede göre yeniden hesaplanır
    expect(tx.belge.create.mock.calls[0][0].data).toMatchObject({ tur: "irsaliye", kaynakBelgeId: "sip1" });
    expect(Number(tx.belge.create.mock.calls[0][0].data.toplamMatrah)).toBe(400);
    expect(Number(tx.belge.create.mock.calls[0][0].data.genelToplam)).toBe(480);
    // İrsaliye satırı türediği sipariş satırını gösterir
    const yeniSatir = tx.belgeSatir.createMany.mock.calls[0][0].data[0];
    expect(yeniSatir).toMatchObject({ kaynakSatirId: "s1" });
    expect(Number(yeniSatir.miktar)).toBe(40);
    expect(Number(yeniSatir.matrah)).toBe(400);
    // Teslim edilen sipariş satırında birikir, sipariş kısmen kapanır
    expect(tx.belgeSatir.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { teslimEdilenMiktar: { increment: expect.anything() } } });
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "sip1" }, data: { durum: "kismen_kapandi" } });
  });

  it("kısmi dönüşümde KDV dışı vergiyi yeni miktarla taşır (EBLG-132)", async () => {
    const { servis, tx, satir } = siparisKurulumu();
    Object.assign(satir, {
      ekVergiler: [{ kod: "0071", ad: "ÖTV I", hesap: "oran", oran: "10", birimTutar: null, matrah: "1000.00", tutar: "100.00", stopaj: false, kdvMatrahinaDahil: true }],
      ekVergiTutari: D("100"), stopajTutari: D(0), kdvTutari: D("220"), netKdvTutari: D("220"), toplamTutar: D("1320"),
    });

    await servis.donustur("sip1", "irsaliye", { kalemler: [{ satirId: "s1", miktar: "40" }] });

    const yeni = tx.belge.create.mock.calls[0][0].data;
    // 400 + ÖTV 40 = KDV matrahı 440, KDV 88
    expect(Number(yeni.toplamEkVergi)).toBe(40);
    expect(Number(yeni.toplamKdv)).toBe(88);
    expect(Number(yeni.genelToplam)).toBe(528);
    const yeniSatir = tx.belgeSatir.createMany.mock.calls[0][0].data[0];
    expect(Number(yeniSatir.ekVergiTutari)).toBe(40);
    expect(yeniSatir.ekVergiler).toEqual([expect.objectContaining({ kod: "0071", oran: "10", matrah: "400.00", tutar: "40.00" })]);
  });

  it("özellikten önceki satırı (vergisi NULL) dönüşümde vergisiz taşır (EBLG-132)", async () => {
    const { servis, tx, satir } = siparisKurulumu();
    Object.assign(satir, { ekVergiler: null });

    await servis.donustur("sip1", "irsaliye");

    expect(tx.belgeSatir.createMany.mock.calls[0][0].data[0].ekVergiler).toBe(Prisma.JsonNull);
  });

  it("müşterinin referanslarını, ilgili kişisini ve koşulları yeni belgeye kopyalar (FTR-31/32/33)", async () => {
    const { servis, tx, belge } = siparisKurulumu();
    Object.assign(belge, { siparisNo: "PO-7", siparisTarihi: new Date("2026-09-12"), talepNo: "RFQ-3", talepTarihi: new Date("2026-09-01"), ilgiliKisi: "Ayşe Kaya", ilgiliKisiGorevi: "Satınalma", odemeVadeGun: 45, teslimSuresi: "10 iş günü", teslimSekli: "FOB" });

    await servis.donustur("sip1", "irsaliye");

    expect(tx.belge.create.mock.calls[0][0].data).toMatchObject({
      siparisNo: "PO-7", siparisTarihi: new Date("2026-09-12"), talepNo: "RFQ-3", talepTarihi: new Date("2026-09-01"),
      // FTR-32: ilgili kişi de taşınır.
      ilgiliKisi: "Ayşe Kaya", ilgiliKisiGorevi: "Satınalma",
      // FTR-33: koşullar da taşınır.
      odemeVadeGun: 45, teslimSuresi: "10 iş günü", teslimSekli: "FOB",
    });
  });

  it("kalan miktarı aşan teslimi reddeder (SAT-09)", async () => {
    const { servis } = siparisKurulumu({ teslimEdilen: "70" });

    await expect(servis.donustur("sip1", "irsaliye", { kalemler: [{ satirId: "s1", miktar: "40" }] })).rejects.toThrow(/kalanını aşamaz/);
  });

  it("kalan tamamlanınca siparişi kapatır (SAT-09)", async () => {
    const { servis, tx } = siparisKurulumu({ teslimEdilen: "70", durum: "kismen_kapandi" });

    const sonuc = await servis.donustur("sip1", "irsaliye");

    expect(sonuc).toMatchObject({ kaynakKapandi: true });
    // Kalem verilmediğinde kalan (100 − 70) dönüşür
    expect(Number(tx.belgeSatir.createMany.mock.calls[0][0].data[0].miktar)).toBe(30);
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "sip1" }, data: { durum: "kapandi" } });
  });

  it("kısmen teslim edilmiş siparişi doğrudan faturalatmaz (SAT-09)", async () => {
    const { servis } = siparisKurulumu({ teslimEdilen: "40", durum: "kismen_kapandi" });

    await expect(servis.donustur("sip1", "fatura")).rejects.toThrow(/irsaliyelerini faturalayın/);
  });

  it("satır bazında miktarı yalnız siparişten irsaliyeye dönüşümde kabul eder (SAT-09)", async () => {
    const { servis } = siparisKurulumu();

    await expect(servis.donustur("sip1", "fatura", { kalemler: [{ satirId: "s1", miktar: "40" }] })).rejects.toThrow(/yalnız siparişten irsaliyeye/);
  });

  describe("gümrükten depoya sevkin onayı (EBLG-87)", () => {
    const onayla = async (ek: Record<string, unknown>, oncekiEnBuyuk: number | null) => {
      const taslak = {
        id: "i1", tur: "irsaliye", yon: "alis", durum: "taslak", no: null, tarih: new Date("2026-09-24"), gecerlilikTarihi: null, cariId: "c1", depoId: null,
        dovizCinsi: "TRY", kur: D(1), genelIskontoYuzdesi: D(0), genelIskontoTutari: D(0), toplamBrut: D(0), toplamSatirIskontosu: D(0), genelIskontoToplam: D(0),
        toplamMatrah: D(0), toplamKdv: D(0), toplamTevkifat: D(0), toplamNetKdv: D(0), genelToplam: D(0), aciklama: null, notlar: null,
        fiiliSevkZamani: new Date("2026-09-24T09:00:00Z"), kaynakBelgeId: null, faturaId: null, satirlar: [],
        gumrukDepoSevki: true, gumrukBeyannameNo: "26341300IM000123", gumrukBeyannameTarihi: new Date("2026-09-20"), ...ek,
      };
      const tx = {
        belge: { findUnique: vi.fn().mockResolvedValue(taslak), update: vi.fn(({ data }) => Promise.resolve({ ...taslak, ...data })), aggregate: vi.fn().mockResolvedValue({ _max: { gumrukSeferNo: oncekiEnBuyuk } }) },
        belgeSayac: { upsert: vi.fn().mockResolvedValue({ sonSira: 7 }) },
        tenant: { findUnique: vi.fn().mockResolvedValue({ vkn: "1234567801", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: true }) },
        gibMukellef: { findFirst: vi.fn() },
        gibMukellefSenkron: { findUnique: vi.fn() },
      };
      const prisma = { tenantIslem: vi.fn((_t, calistir) => calistir(tx)) } as any;
      const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
      return { sonuc: await servis.onayla("i1"), tx };
    };

    it("aynı beyannamenin sonraki sefer numarasını verir; e-İrsaliye numarası gönderime kalır", async () => {
      const { sonuc, tx } = await onayla({}, 2);
      expect(sonuc.gumrukSeferNo).toBe(3);
      expect(sonuc.no).toBeNull();
      expect(tx.belge.aggregate).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ gumrukBeyannameNo: "26341300IM000123", durum: { not: "iptal" } }),
      }));
    });

    it("beyannamenin ilk seferi 1'dir", async () => {
      expect((await onayla({}, null)).sonuc.gumrukSeferNo).toBe(1);
    });

    it("beyanname girilmeden onaylamaz", async () => {
      await expect(onayla({ gumrukBeyannameNo: null }, null)).rejects.toThrow(/beyanname/);
    });
  });

  describe("GİB'e ulaşmış e-İrsaliyenin programda iptali (EBLG-90)", () => {
    const kur = (eirsaliye: { durum: string; aliciKayitsiz: boolean } | null) => {
      const irsaliye = {
        id: "irs1", tur: "irsaliye", yon: "satis", durum: "onaylandi", no: "GBZ2026000800030", tarih: new Date("2026-09-24"),
        gecerlilikTarihi: null, cariId: "c1", depoId: null, dovizCinsi: "TRY", kur: D(1), genelIskontoYuzdesi: D(0), genelIskontoTutari: D(0),
        toplamBrut: D(0), toplamSatirIskontosu: D(0), genelIskontoToplam: D(0), toplamMatrah: D(0), toplamKdv: D(0), toplamTevkifat: D(0),
        toplamNetKdv: D(0), genelToplam: D(0), aciklama: null, notlar: null, kaynakBelgeId: null, faturaId: null, satirlar: [], eirsaliye,
      };
      const tx = { belge: { findUnique: vi.fn().mockResolvedValue(irsaliye), update: vi.fn().mockResolvedValue({ ...irsaliye, durum: "iptal" }) }, belgeSatir: { update: vi.fn() } };
      const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as any;
      return { servis: new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any), tx };
    };

    it("onay olmadan iptal etmez; mesaj alıcıya göre yasal yolu söyler", async () => {
      const kayitli = kur({ durum: "iletildi", aliciKayitsiz: false });
      await expect(kayitli.servis.iptal("irs1")).rejects.toThrow(/RET yanıtı/);
      expect(kayitli.tx.belge.update).not.toHaveBeenCalled();
      await expect(kur({ durum: "kabul", aliciKayitsiz: true }).servis.iptal("irs1")).rejects.toThrow(/KEP/);
    });

    it("onaylanınca programda iptal eder", async () => {
      const { servis, tx } = kur({ durum: "iletildi", aliciKayitsiz: false });
      await servis.iptal("irs1", { uyariOnaylandi: true });
      expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "irs1" }, data: { durum: "iptal" } });
    });

    it("alıcının reddettiği irsaliyede onay istemez", async () => {
      await kur({ durum: "ret", aliciKayitsiz: false }).servis.iptal("irs1");
    });

    // EBLG-92: numara almış ama GİB'e ulaşmamış belgenin numarası seride boşluk kalır.
    it("numara almış ama GİB'e ulaşmamış irsaliyede boşluk onayı ister", async () => {
      await expect(kur({ durum: "hata", aliciKayitsiz: false }).servis.iptal("irs1")).rejects.toThrow(/boşluk/);
      await expect(kur(null).servis.iptal("irs1")).rejects.toThrow(/GBZ2026000800030 numarası/);
      await kur(null).servis.iptal("irs1", { uyariOnaylandi: true });
    });
  });

  it("siparişten açılmış taslak irsaliye silinince teslim miktarı geri alınır, sipariş yeniden açılır", async () => {
    const irsaliye = { id: "irs9", tur: "irsaliye", durum: "taslak", kaynakBelgeId: "sip9", satirlar: [{ stokId: "stk1", varyantId: null, miktar: D("5"), birim: "metre", kaynakSatirId: "s9" }] };
    const siparis = { id: "sip9", tur: "siparis", yon: "alis", durum: "kismen_kapandi", depoId: null, faturaId: null, satirlar: [{ miktar: D("10000"), teslimEdilenMiktar: D("0") }] };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      firsatBelgeBagi: { count: vi.fn().mockResolvedValue(0) },
      belge: { findUnique: vi.fn().mockResolvedValueOnce(irsaliye).mockResolvedValueOnce(siparis), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
      belgeSatir: { update: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
    vi.spyOn(servis, "getir").mockResolvedValue(irsaliye as any);

    await servis.sil("irs9");

    expect(tx.belgeSatir.update).toHaveBeenCalledWith({ where: { id: "s9" }, data: { teslimEdilenMiktar: { decrement: D("5") } } });
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "sip9" }, data: { durum: "onaylandi" } });
    expect(tx.belge.delete).toHaveBeenCalledWith({ where: { id: "irs9" } });
  });

  describe("iptal edilmiş siparişin irsaliyesi iptal edilince", () => {
    /** Sipariş 10 onaylandı, 4'ü irsaliyeyle teslim edildi; sipariş iptali yalnız 6'yı çözdü. */
    const kur = (siparisDurumu: string) => {
      const irsaliye = {
        id: "irs1", tur: "irsaliye", yon: "satis", durum: "onaylandi", no: "GBZ2026000800001", tarih: new Date("2026-09-24"),
        gecerlilikTarihi: null, cariId: "c1", depoId: null, dovizCinsi: "TRY", kur: D(1), genelIskontoYuzdesi: D(0), genelIskontoTutari: D(0),
        toplamBrut: D(0), toplamSatirIskontosu: D(0), genelIskontoToplam: D(0), toplamMatrah: D(0), toplamKdv: D(0), toplamTevkifat: D(0),
        toplamNetKdv: D(0), genelToplam: D(0), aciklama: null, notlar: null, kaynakBelgeId: "sip1", faturaId: null,
        satirlar: [{ stokId: "stk1", varyantId: null, miktar: D("4"), kaynakSatirId: "s1" }],
      };
      const siparis = { id: "sip1", tur: "siparis", yon: "satis", durum: siparisDurumu, depoId: "d1", faturaId: null, satirlar: [{ miktar: D("10"), teslimEdilenMiktar: D("0") }] };
      const tx = {
        belge: { findUnique: vi.fn().mockResolvedValueOnce(irsaliye).mockResolvedValueOnce(siparis), update: vi.fn().mockResolvedValue({ ...irsaliye, durum: "iptal" }) },
        belgeSatir: { update: vi.fn() },
      };
      const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as any;
      const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
      const siparisEtkisi = vi.spyOn(servis, "siparisEtkisiUygula").mockResolvedValue();
      return { servis, tx, siparisEtkisi };
    };

    it("irsaliyenin taşıdığı rezervi çözer; siparişi yeniden açmaz", async () => {
      const { servis, tx, siparisEtkisi } = kur("iptal");

      // Numara almış ama GİB'e ulaşmamış irsaliye: boşluk uyarısı onaylanır (EBLG-92).
      await servis.iptal("irs1", { uyariOnaylandi: true });

      expect(siparisEtkisi).toHaveBeenCalledWith(tx, "satis", [expect.objectContaining({ stokId: "stk1", miktar: D("4") })], -1, "d1");
      expect(tx.belge.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sip1" } }));
    });

    it("sipariş açıksa rezerve dokunmaz; miktar siparişin kalanına döner", async () => {
      const { servis, siparisEtkisi } = kur("kismen_kapandi");

      // Numara almış ama GİB'e ulaşmamış irsaliye: boşluk uyarısı onaylanır (EBLG-92).
      await servis.iptal("irs1", { uyariOnaylandi: true });

      expect(siparisEtkisi).not.toHaveBeenCalled();
    });
  });

  it("iptal edilen irsaliyenin miktarını siparişten düşer ve siparişi yeniden açar (SAT-09)", async () => {
    const irsaliye = {
      id: "irs1",
      tur: "irsaliye",
      yon: "alis",
      durum: "onaylandi",
      no: "IRS2026000000001",
      tarih: new Date("2026-09-16"),
      gecerlilikTarihi: null,
      cariId: "c1",
      depoId: "d1",
      dovizCinsi: "TRY",
      kur: D(1),
      genelIskontoYuzdesi: D(0),
      genelIskontoTutari: D(0),
      toplamBrut: D("400"),
      toplamSatirIskontosu: D(0),
      genelIskontoToplam: D(0),
      toplamMatrah: D("400"),
      toplamKdv: D("80"),
      toplamTevkifat: D(0),
      toplamNetKdv: D("80"),
      genelToplam: D("480"),
      aciklama: null,
      notlar: null,
      kaynakBelgeId: "sip1",
      faturaId: null,
      satirlar: [{ miktar: D("40"), kaynakSatirId: "s1" }],
    };
    const siparis = {
      id: "sip1",
      tur: "siparis",
      durum: "kismen_kapandi",
      faturaId: null,
      // İptal anında satırdaki birikim çoktan düşmüş olur
      satirlar: [{ miktar: D("100"), teslimEdilenMiktar: D("0") }],
    };
    const tx = {
      belge: {
        findUnique: vi.fn().mockResolvedValueOnce(irsaliye).mockResolvedValueOnce(siparis),
        update: vi.fn().mockResolvedValue({ ...irsaliye, durum: "iptal" }),
      },
      belgeSatir: { update: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await servis.iptal("irs1");

    expect(tx.belgeSatir.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { teslimEdilenMiktar: { decrement: expect.anything() } } });
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "sip1" }, data: { durum: "onaylandi" } });
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "irs1" }, data: { durum: "iptal" } });
  });

  it("teslim geçmişinde iptal edilen irsaliyeyi saymaz (SAT-10)", async () => {
    const siparisSatiri = {
      id: "s1", stokId: "stk1", varyantId: null, partiBilgileri: null,
      miktar: D("100"), teslimEdilenMiktar: D("40"), birim: "adet", birimFiyat: D("10"),
      iskontoOrani: D(0), iskontoTutari: D(0), genelIskontoPayi: D(0), matrah: D("1000"),
      kdvOrani: D("20"), kdvTutari: D("200"), tevkifatPay: null, tevkifatPayda: null,
      tevkifatTutari: D(0), netKdvTutari: D("200"), ekVergiler: null, ekVergiTutari: D(0), stopajTutari: D(0), toplamTutar: D("1200"),
      stok: { id: "stk1", kod: "STK-1", ad: "Ürün" }, varyant: null,
    };
    const irsaliyeSatiri = (miktar: string) => ({
      kaynakSatirId: "s1", miktar: D(miktar), birim: "adet", stok: { kod: "STK-1", ad: "Ürün" },
    });
    const kayit = {
      id: "sip1", tur: "siparis", yon: "alis", durum: "kismen_kapandi", no: "SIP2026000001",
      tarih: new Date("2026-09-16"), gecerlilikTarihi: null, cariId: "c1", depoId: "d1",
      dovizCinsi: "TRY", kur: D(1), genelIskontoYuzdesi: D(0), genelIskontoTutari: D(0),
      toplamBrut: D("1000"), toplamSatirIskontosu: D(0), genelIskontoToplam: D(0),
      toplamMatrah: D("1000"), toplamKdv: D("200"), toplamTevkifat: D(0), toplamNetKdv: D("200"),
      genelToplam: D("1200"), aciklama: null, notlar: null, kaynakBelgeId: null, faturaId: null,
      cari: { id: "c1", kod: "C1", unvan: "Tedarikçi" },
      satirlar: [siparisSatiri],
      kaynakBelge: null,
      turetilenler: [
        { id: "irs1", tur: "irsaliye", no: "IRS1", durum: "onaylandi", tarih: new Date("2026-09-16"), satirlar: [irsaliyeSatiri("40")], turetilenler: [] },
        { id: "irs2", tur: "irsaliye", no: "IRS2", durum: "iptal", tarih: new Date("2026-09-16"), satirlar: [irsaliyeSatiri("25")], turetilenler: [] },
      ],
      fatura: null,
      eirsaliye: null,
    };
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir({ belge: { findUnique: vi.fn().mockResolvedValue(kayit) } })) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    const detay = await servis.getir("sip1");

    expect(detay.teslimatlar).toHaveLength(1);
    expect(detay.teslimatlar[0]).toMatchObject({ no: "IRS1", kalemler: [{ satirId: "s1", stokKod: "STK-1", miktar: "40.000" }] });
    // Satırda kalan miktar da görünür (SAT-09)
    expect(detay.satirlar[0]).toMatchObject({ teslimEdilenMiktar: "40.000", kalanMiktar: "60.000" });
  });

  it("virgüllü durum süzgecini çoklu duruma çevirir (SAT-10)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir({ belge: { findMany } })) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

    await servis.listele("siparis", "alis", "onaylandi,kismen_kapandi");
    expect(findMany.mock.calls[0][0].where).toMatchObject({ durum: { in: ["onaylandi", "kismen_kapandi"] } });

    await servis.listele("siparis", "alis", "onaylandi");
    expect(findMany.mock.calls[1][0].where).toMatchObject({ durum: "onaylandi" });
  });

  // ─── Sonradan faturaya bağlama (FTR-26) ───────────────────────────────────

  function baglamaKurulumu(secenek: { fatura?: Record<string, unknown>; irsaliyeler?: Record<string, unknown>[]; guncellenen?: number } = {}) {
    const fatura = { cariId: "c1", tip: "satis", durum: "kesin", sevkiyatYontemi: null, ebelge: null, ...secenek.fatura };
    const irsaliyeler = (secenek.irsaliyeler ?? [{ id: "i1", no: "IRS2026000000001", tur: "irsaliye", yon: "satis", cariId: "c1", durum: "onaylandi", faturaId: null, eirsaliye: null }])
      .map((b) => ({ cari: { vknTckn: "1111111111", adresler: [] }, ...b }));
    const tx = {
      fatura: { findUnique: vi.fn().mockResolvedValue(fatura), update: vi.fn() },
      belge: {
        findMany: vi.fn().mockResolvedValue(irsaliyeler),
        updateMany: vi.fn().mockResolvedValue({ count: secenek.guncellenen ?? irsaliyeler.length }),
      },
    };
    const servis = new BelgelerService({} as any, {} as any, {} as any, {} as any);
    const zincir = vi.spyOn(servis, "zincirEtkisiniCoz").mockResolvedValue();
    return { servis, tx, zincir };
  }

  it("irsaliyeyi faturaya bağlar ve kapatır; kesin faturada sipariş rezervini çözer (FTR-26)", async () => {
    const { servis, tx, zincir } = baglamaKurulumu();
    await expect(servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["i1"])).resolves.toEqual({ baglanan: 1 });
    expect(tx.belge.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["i1"] }, faturaId: null, durum: "onaylandi" }, data: { faturaId: "f1", durum: "kapandi" } });
    expect(zincir).toHaveBeenCalledWith(tx, ["i1"], -1);
  });

  it("teslim yeri boş faturaya ilk irsaliyenin teslim yerini yazar (FTR-30)", async () => {
    const { servis, tx } = baglamaKurulumu({
      fatura: { durum: "taslak", teslimatAdres: null, teslimatIl: null, teslimatIlce: null },
      irsaliyeler: [{ id: "i1", no: "GBZ1", tur: "irsaliye", yon: "satis", cariId: "c1", durum: "onaylandi", faturaId: null, eirsaliye: null, teslimatAdres: "Liman Cd. 5", teslimatIl: "İzmir", teslimatIlce: "Konak", teslimatPostaKodu: "35250" }],
    });
    await servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["i1"]);
    expect(tx.fatura.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { teslimatAdres: "Liman Cd. 5", teslimatIl: "İzmir", teslimatIlce: "Konak", teslimatPostaKodu: "35250" } });
  });

  it("elle girilmiş teslim yerini irsaliyeyle ezmez (FTR-30)", async () => {
    const { servis, tx } = baglamaKurulumu({
      fatura: { durum: "taslak", teslimatAdres: "Depo 2", teslimatIl: "Ankara", teslimatIlce: "Sincan" },
      irsaliyeler: [{ id: "i1", no: "GBZ1", tur: "irsaliye", yon: "satis", cariId: "c1", durum: "onaylandi", faturaId: null, eirsaliye: null, teslimatAdres: "Liman Cd. 5", teslimatIl: "İzmir", teslimatIlce: "Konak", teslimatPostaKodu: "35250" }],
    });
    await servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["i1"]);
    expect(tx.fatura.update).not.toHaveBeenCalled();
  });

  it("taslak faturada rezerve dokunmaz; kesinleştirme çözer (FTR-26)", async () => {
    const { servis, tx, zincir } = baglamaKurulumu({ fatura: { durum: "taslak" } });
    await servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["i1"]);
    expect(zincir).not.toHaveBeenCalled();
  });

  it("gönderilmiş e-Belgeye irsaliye bağlamaz (FTR-26)", async () => {
    const { servis, tx } = baglamaKurulumu({ fatura: { ebelge: { durum: "iletildi" } } });
    await expect(servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["i1"])).rejects.toThrow(ConflictException);
  });

  it("farklı cari, ters yön ve onaysız irsaliyeyi reddeder (FTR-26)", async () => {
    const temel = { id: "i1", no: "IRS1", tur: "irsaliye", yon: "satis", cariId: "c1", durum: "onaylandi", faturaId: null, eirsaliye: null };
    for (const fark of [{ cariId: "c2" }, { yon: "alis" }, { durum: "taslak" }]) {
      const { servis, tx } = baglamaKurulumu({ irsaliyeler: [{ ...temel, ...fark }] });
      await expect(servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["i1"])).rejects.toThrow();
    }
  });

  it("gitmemiş e-İrsaliyeyi bağlamaz, gitmiş olanda faturanın sevkiyat yolunu yazar (FTR-26)", async () => {
    const irs = (durum: string) => [{ id: "i1", no: "GBZ1", tur: "irsaliye", yon: "satis", cariId: "c1", durum: "onaylandi", faturaId: null, eirsaliye: { durum } }];
    const hata = baglamaKurulumu({ irsaliyeler: irs("hata") });
    await expect(hata.servis.irsaliyeBaglaTx(hata.tx as any, "t1", "f1", ["i1"])).rejects.toThrow("henüz iletilmedi");
    const gitti = baglamaKurulumu({ irsaliyeler: irs("iletildi") });
    await gitti.servis.irsaliyeBaglaTx(gitti.tx as any, "t1", "f1", ["i1"]);
    expect(gitti.tx.fatura.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { sevkiyatYontemi: "irsaliye", fiiliSevkZamani: null } });
  });

  it("eşzamanlı faturalanan irsaliyede çakışma verir (FTR-26)", async () => {
    const { servis, tx } = baglamaKurulumu({ guncellenen: 0 });
    await expect(servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["i1"])).rejects.toThrow(ConflictException);
  });

  it("bağı kaldırınca irsaliyeyi açar ve kesin faturada rezervi geri koyar (FTR-26)", async () => {
    const tx = {
      belge: {
        findUnique: vi.fn().mockResolvedValue({ id: "i1", tur: "irsaliye", faturaId: "f1", eirsaliye: null }),
        update: vi.fn(),
      },
      fatura: { findUnique: vi.fn().mockResolvedValue({ id: "f1", durum: "kesin", sevkiyatYontemi: null, ebelge: null }) },
    };
    const servis = new BelgelerService({} as any, {} as any, {} as any, {} as any);
    const zincir = vi.spyOn(servis, "zincirEtkisiniCoz").mockResolvedValue();
    await expect(servis.irsaliyeBaginiKaldirTx(tx as any, "t1", "i1")).resolves.toEqual({ kaldirildi: true });
    expect(zincir).toHaveBeenCalledWith(tx, ["i1"], 1);
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { faturaId: null, durum: "onaylandi" } });
  });

  it("gönderilmiş faturanın bağını kaldırmaz (FTR-26)", async () => {
    const tx = {
      belge: { findUnique: vi.fn().mockResolvedValue({ id: "i1", tur: "irsaliye", faturaId: "f1", eirsaliye: null }), update: vi.fn() },
      fatura: { findUnique: vi.fn().mockResolvedValue({ id: "f1", durum: "kesin", sevkiyatYontemi: null, ebelge: { durum: "kabul" } }) },
    };
    const servis = new BelgelerService({} as any, {} as any, {} as any, {} as any);
    await expect(servis.irsaliyeBaginiKaldirTx(tx as any, "t1", "i1")).rejects.toThrow(ConflictException);
    expect(tx.belge.update).not.toHaveBeenCalled();
  });

  it("siparişten türeyen irsaliyede yalnız irsaliye miktarını çözer (SAT-09 / FTR-26)", async () => {
    const tx = {
      belge: {
        findMany: vi.fn().mockResolvedValue([
          { tur: "irsaliye", yon: "satis", depoId: "d1", kaynakBelge: { tur: "siparis", yon: "satis", depoId: "d1" }, satirlar: [{ stokId: "stk1", varyantId: null, miktar: D("40"), kaynakSatirId: "s1" }] },
          { tur: "irsaliye", yon: "satis", depoId: "d1", kaynakBelge: null, satirlar: [{ stokId: "stk2", varyantId: null, miktar: D("5"), kaynakSatirId: null }] },
        ]),
      },
    };
    const servis = new BelgelerService({} as any, {} as any, {} as any, {} as any);
    const etki = vi.spyOn(servis, "siparisEtkisiUygula").mockResolvedValue();
    await servis.zincirEtkisiniCoz(tx as any, ["i1", "i2"], -1);
    expect(etki).toHaveBeenCalledTimes(1);
    expect(etki).toHaveBeenCalledWith(tx, "satis", [expect.objectContaining({ stokId: "stk1", miktar: D("40") })], -1, "d1");
  });

  it("faturalanmayı bekleyen irsaliye süzgecini ve kalan süreyi uygular (EBLG-82)", async () => {
    const irsaliye = (id: string, fatura: { durum: string } | null, tarih: string) => ({
      id, tur: "irsaliye", yon: "satis", durum: fatura ? "kapandi" : "onaylandi", no: id,
      tarih: new Date(`${tarih}T00:00:00Z`), fiiliSevkZamani: null, gecerlilikTarihi: null, cariId: "c1", depoId: "d1",
      dovizCinsi: "TRY", kur: D(1), genelIskontoYuzdesi: D(0), genelIskontoTutari: D(0), toplamBrut: D(0),
      toplamSatirIskontosu: D(0), genelIskontoToplam: D(0), toplamMatrah: D(0), toplamKdv: D(0),
      toplamTevkifat: D(0), toplamNetKdv: D(0), genelToplam: D(0), aciklama: null, notlar: null, kaynakBelgeId: null,
      faturaId: fatura ? "f1" : null, fatura, cari: { id: "c1", kod: "C1", unvan: "Müşteri" },
    });
    const findMany = vi.fn().mockResolvedValue([irsaliye("i1", null, "2020-01-01"), irsaliye("i2", { durum: "kesin" }, "2020-01-01")]);
    const prisma = { tenantIslem: vi.fn((_t, calistir) => calistir({ belge: { findMany } })) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, {} as any, { getir: vi.fn().mockResolvedValue({ irsaliyeFaturaGunSayisi: 7 }) } as any);

    const sonuc = await servis.listele("irsaliye", undefined, undefined, undefined, undefined, undefined, undefined, 50, true);

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      tur: "irsaliye",
      durum: { in: ["onaylandi", "kapandi"] },
      AND: [
        { OR: [{ faturaId: null }, { fatura: { is: { durum: { not: "kesin" } } } }] },
        // EBLG-95: muhtelif irsaliye takibe girmez; VKN'siz cari düşmemeli.
        { cari: { OR: [{ vknTckn: null }, { vknTckn: { not: "5555555555" } }] } },
      ],
    });
    expect(sonuc.kayitlar[0].faturalamaSuresi).toMatchObject({ sonGun: "2020-01-08", gecti: true });
    // Kesin faturaya bağlı irsaliye faturalanmıştır.
    expect(sonuc.kayitlar[1].faturalamaSuresi).toBeNull();
  });

  it("muhtelif müşteri irsaliyesine faturalama süresi hesaplamaz (EBLG-95)", async () => {
    const muhtelif = {
      id: "m1", tur: "irsaliye", yon: "satis", durum: "onaylandi", no: "m1",
      tarih: new Date("2020-01-01T00:00:00Z"), fiiliSevkZamani: null, gecerlilikTarihi: null, cariId: "c9", depoId: "d1",
      dovizCinsi: "TRY", kur: D(1), genelIskontoYuzdesi: D(0), genelIskontoTutari: D(0), toplamBrut: D(0),
      toplamSatirIskontosu: D(0), genelIskontoToplam: D(0), toplamMatrah: D(0), toplamKdv: D(0),
      toplamTevkifat: D(0), toplamNetKdv: D(0), genelToplam: D(0), aciklama: null, notlar: null, kaynakBelgeId: null,
      faturaId: null, fatura: null, cari: { id: "c9", kod: "MUHTELIF", unvan: "Muhtelif Müşteriler", vknTckn: "5555555555" },
    };
    const findMany = vi.fn().mockResolvedValue([muhtelif]);
    const prisma = { tenantIslem: vi.fn((_t, calistir) => calistir({ belge: { findMany } })) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, {} as any, { getir: vi.fn().mockResolvedValue({ irsaliyeFaturaGunSayisi: 7 }) } as any);

    const sonuc = await servis.listele("irsaliye");

    expect(sonuc.kayitlar[0].faturalamaSuresi).toBeNull();
  });

  it("muhtelif müşteri belgesini dönüştürmez ve faturaya bağlamaz (EBLG-95)", async () => {
    const tx = {
      belge: {
        findUnique: vi.fn().mockResolvedValue({ id: "m1", tur: "irsaliye", durum: "onaylandi", satirlar: [], cari: { vknTckn: "5555555555" } }),
        findMany: vi.fn().mockResolvedValue([{ id: "m1", no: "GBZ2026000800040", tur: "irsaliye", yon: "satis", cariId: "c9", durum: "onaylandi", faturaId: null, cari: { vknTckn: "5555555555" }, eirsaliye: { durum: "iletildi" } }]),
      },
      fatura: { findUnique: vi.fn().mockResolvedValue({ cariId: "c9", tip: "satis", durum: "taslak", sevkiyatYontemi: null, ebelge: null }) },
    };
    const prisma = { tenantIslem: vi.fn((_t, calistir) => calistir(tx)) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, {} as any, {} as any);

    await expect(servis.donustur("m1", "fatura")).rejects.toThrow(/Muhtelif Müşteriler belgesi dönüştürülemez/);
    await expect(servis.irsaliyeBaglaTx(tx as any, "t1", "f1", ["m1"])).rejects.toThrow(/faturaya bağlanmaz/);
  });

  describe("irsaliye numarası onayda (FTR-27, EBLG-83)", () => {
    /** Firmanın e-İrsaliye ayarı elle verilir; `null` ise GİB listesine bakılır. */
    const onayla = async (yon: "satis" | "alis", ortam: { firmaEirsaliye?: boolean | null; listeGuncel?: boolean; belge?: Record<string, unknown> } = {}) => {
      const { firmaEirsaliye = true, listeGuncel = true } = ortam;
      const taslak = {
        id: "i1", tur: "irsaliye", yon, durum: "taslak", no: null, tarih: new Date("2026-09-24"),
        gecerlilikTarihi: null, cariId: "c1", depoId: null, dovizCinsi: "TRY", kur: new Prisma.Decimal(1),
        genelIskontoYuzdesi: new Prisma.Decimal(0), genelIskontoTutari: new Prisma.Decimal(0),
        toplamBrut: new Prisma.Decimal(0), toplamSatirIskontosu: new Prisma.Decimal(0), genelIskontoToplam: new Prisma.Decimal(0),
        toplamMatrah: new Prisma.Decimal(0), toplamKdv: new Prisma.Decimal(0), toplamTevkifat: new Prisma.Decimal(0),
        toplamNetKdv: new Prisma.Decimal(0), genelToplam: new Prisma.Decimal(0), aciklama: null, notlar: null,
        fiiliSevkZamani: new Date("2026-09-24T09:00:00Z"), kaynakBelgeId: null, faturaId: null, satirlar: [],
        kagitIrsaliye: false, ...ortam.belge,
      };
      const tx = {
        belge: {
          findUnique: vi.fn().mockResolvedValue(taslak),
          update: vi.fn(({ data }) => Promise.resolve({ ...taslak, ...data })),
        },
        belgeSayac: { upsert: vi.fn().mockResolvedValue({ sonSira: 12 }) },
        tenant: { findUnique: vi.fn().mockResolvedValue({ vkn: "1234567801", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: firmaEirsaliye }) },
        gibMukellef: { findFirst: vi.fn().mockResolvedValue(null) },
        gibMukellefSenkron: { findUnique: vi.fn().mockResolvedValue({ sonSenkronAt: listeGuncel ? new Date() : new Date("2026-01-01") }) },
      };
      const prisma = { tenantIslem: vi.fn((_t, calistir) => calistir(tx)) } as any;
      const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
      const sonuc = await servis.onayla("i1");
      return { sonuc, tx, sayacAnahtari: tx.belgeSayac.upsert.mock.calls[0]?.[0].where.tenantId_tur_yon_seri_yil };
    };

    it("e-İrsaliye kullanıcısı firmada satış irsaliyesi numarasız onaylanır; numara gönderimde verilir", async () => {
      const { sonuc, tx } = await onayla("satis");
      expect(sonuc.no).toBeNull();
      expect(sonuc.kagitIrsaliye).toBe(false);
      expect(tx.belgeSayac.upsert).not.toHaveBeenCalled();
    });

    it("firma e-İrsaliye kullanıcısı değilse kâğıt irsaliye keser ve giden seriye dokunmaz", async () => {
      const { sonuc, sayacAnahtari } = await onayla("satis", { firmaEirsaliye: false, listeGuncel: false });
      expect(sonuc.no).toBe("KIR2026000012");
      expect(sonuc.kagitIrsaliye).toBe(true);
      expect(sayacAnahtari).toMatchObject({ tur: "irsaliye", yon: "satis", seri: "KIR", yil: 2026 });
    });

    it("firmanın kapsamı bilinmiyorsa onaylamaz", async () => {
      await expect(onayla("satis", { firmaEirsaliye: null, listeGuncel: false })).rejects.toThrow(/kapsamı bilinmiyor/);
    });

    it("alış irsaliyesi iç seriden numara alır, kanal sorulmaz", async () => {
      const { sonuc, sayacAnahtari, tx } = await onayla("alis", { listeGuncel: false });
      expect(sonuc.no).toBe("AIR2026000012");
      expect(sayacAnahtari).toMatchObject({ tur: "irsaliye", yon: "alis", seri: "", yil: 2026 });
      expect(tx.tenant.findUnique).not.toHaveBeenCalled();
    });

    it("taslağa geri alınmış irsaliye numarasını ve kanalını korur, sayaca dokunmaz (FTR-29)", async () => {
      const eirsaliye = await onayla("satis", { belge: { no: "GBZ2026000800031" } });
      expect(eirsaliye.sonuc).toMatchObject({ no: "GBZ2026000800031", kagitIrsaliye: false });
      expect(eirsaliye.tx.belgeSayac.upsert).not.toHaveBeenCalled();
      expect(eirsaliye.tx.tenant.findUnique).not.toHaveBeenCalled();

      const kagit = await onayla("satis", { belge: { no: "KIR2026000004", kagitIrsaliye: true } });
      expect(kagit.sonuc).toMatchObject({ no: "KIR2026000004", kagitIrsaliye: true });
      expect(kagit.tx.belgeSayac.upsert).not.toHaveBeenCalled();
    });
  });

  describe("irsaliyeyi taslağa geri alma (FTR-29)", () => {
    const geriAl = async (belge: Record<string, unknown>) => {
      const tx = {
        belge: {
          findUnique: vi.fn().mockResolvedValue({ id: "i1", tur: "irsaliye", tarih: new Date("2026-09-24"), ...belge }),
          update: vi.fn(({ data }) => Promise.resolve({ id: "i1", ...belge, ...data })),
        },
      };
      const prisma = { tenantIslem: vi.fn((_t, calistir) => calistir(tx)) } as any;
      const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
      vi.spyOn(servis as any, "gorunum").mockImplementation((b) => b);
      return { sonuc: servis.taslagaGeriAl("i1"), tx };
    };

    it("gönderilmemiş ya da entegratöre ulaşmamış onaylı irsaliyeyi yalnız durumunu değiştirerek geri alır", async () => {
      for (const eirsaliye of [null, { durum: "hata", entegratorRef: null }]) {
        const { sonuc, tx } = await geriAl({ durum: "onaylandi", no: "GBZ2026000800031", eirsaliye });
        await expect(sonuc).resolves.toMatchObject({ durum: "taslak", no: "GBZ2026000800031" });
        expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { durum: "taslak" } });
      }
    });

    describe("taslak düzenlenirken sipariş teslimi (FTR-29)", () => {
      const kur = (siparisSatiri: Record<string, unknown>) => {
        const tx = {
          belgeSatir: {
            findMany: vi.fn()
              .mockResolvedValueOnce([{ id: "ss1", miktar: new Prisma.Decimal(10), teslimEdilenMiktar: new Prisma.Decimal(4), belge: { id: "sip1", tur: "siparis", durum: "kismen_kapandi", faturaId: null }, ...siparisSatiri }])
              .mockResolvedValueOnce([{ miktar: new Prisma.Decimal(10), teslimEdilenMiktar: new Prisma.Decimal(10) }]),
            update: vi.fn(),
          },
          belge: { update: vi.fn() },
        };
        const servis = new BelgelerService({} as any, {} as any, {} as any, {} as any);
        const uygula = (eski: unknown[], yeni: unknown[]) => (servis as any).teslimFarkiniUygula(tx, eski, yeni);
        return { tx, uygula };
      };

      it("miktar farkını sipariş satırına yazar ve siparişin durumunu yeniden hesaplar", async () => {
        const { tx, uygula } = kur({});
        await uygula([{ kaynakSatirId: "ss1", miktar: "4.000" }], [{ kaynakSatirId: "ss1", miktar: "10" }]);
        expect(tx.belgeSatir.update.mock.calls[0][0]).toMatchObject({ where: { id: "ss1" } });
        expect(tx.belgeSatir.update.mock.calls[0][0].data.teslimEdilenMiktar.increment.toString()).toBe("6");
        expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "sip1" }, data: { durum: "kapandi" } });
      });

      it("sipariş miktarını aşan teslime ve yabancı sipariş satırına izin vermez", async () => {
        await expect(kur({}).uygula([{ kaynakSatirId: "ss1", miktar: "4" }], [{ kaynakSatirId: "ss1", miktar: "11" }])).rejects.toThrow(/aşamaz/);
        await expect(kur({}).uygula([{ kaynakSatirId: "ss1", miktar: "4" }], [{ kaynakSatirId: "baska", miktar: "1" }])).rejects.toThrow(/bağlanamaz/);
      });

      it("silinen bağlı satırın teslimini geri alır; iptal edilmiş siparişte değiştirmez", async () => {
        const { tx, uygula } = kur({});
        await uygula([{ kaynakSatirId: "ss1", miktar: "4" }], [{ kaynakSatirId: null, miktar: "4" }]);
        expect(tx.belgeSatir.update.mock.calls[0][0].data.teslimEdilenMiktar.increment.toString()).toBe("-4");
        await expect(kur({ belge: { id: "sip1", tur: "siparis", durum: "iptal", faturaId: null } }).uygula([{ kaynakSatirId: "ss1", miktar: "4" }], [{ kaynakSatirId: "ss1", miktar: "3" }])).rejects.toThrow(/değiştirilemez/);
      });
    });

    it("gönderilmiş e-İrsaliyede ve faturaya bağlı irsaliyede geri almaz", async () => {
      await expect((await geriAl({ durum: "onaylandi", eirsaliye: { durum: "iletildi", entegratorRef: "u" } })).sonuc).rejects.toThrow(/gönderilmiş/);
      await expect((await geriAl({ durum: "kapandi", eirsaliye: null })).sonuc).rejects.toThrow(/bağını kaldırın/);
    });
  });
});

describe("teklif revizyonu (FTR-34)", () => {
  const D = (d: string | number) => new Prisma.Decimal(d);
  const teklif = (ek: Record<string, unknown> = {}) => ({
    id: "t1", tenantId: "t1", tur: "teklif", yon: "satis", durum: "onaylandi", no: "TKF2026000012", revizyonNo: 0, revizyonKokId: null,
    tarih: new Date("2026-09-20"), cariId: "c1", kaynakBelgeId: null, faturaId: null, b2bIdempotencyAnahtari: null, gelenEirsaliyeId: null,
    createdAt: new Date(), updatedAt: new Date(), talepNo: "RFQ-1", odemeVadeGun: 30, genelToplam: D(120), kur: D(1),
    gecerlilikTarihi: null, depoId: null, dovizCinsi: "TRY", genelIskontoYuzdesi: D(0), genelIskontoTutari: D(0), toplamBrut: D(100),
    toplamSatirIskontosu: D(0), genelIskontoToplam: D(0), toplamMatrah: D(100), toplamKdv: D(20), toplamTevkifat: D(0), toplamNetKdv: D(20),
    aciklama: null, notlar: null,
    satirlar: [{ id: "s1", belgeId: "t1", tenantId: "t1", stokId: "k1", miktar: D(2), birimFiyat: D(50), partiBilgileri: null, kaynakSatirId: null, teslimEdilenMiktar: D(0) }],
    ...ek,
  });
  function kur(belge: Record<string, unknown>, devredilen = 1) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      firsatBelgeBagi: { count: vi.fn().mockResolvedValue(0) },
      belge: {
        findUnique: vi.fn().mockResolvedValue(belge),
        updateMany: vi.fn().mockResolvedValue({ count: devredilen }),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: "t2" })),
        delete: vi.fn(),
      },
      belgeSatir: { createMany: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, cb: (tx: unknown) => unknown) => cb(tx)) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);
    return { servis, tx };
  }

  it("aynı numarayla yeni taslak sürüm açar, öncekini revize edildi yapar", async () => {
    const { servis, tx } = kur(teklif());

    const yeni = await servis.revizeEt("t1");

    expect(tx.belge.updateMany).toHaveBeenCalledWith({ where: { id: "t1", durum: "onaylandi" }, data: { durum: "revize_edildi" } });
    const veri = tx.belge.create.mock.calls[0][0].data;
    expect(veri).toMatchObject({ no: "TKF2026000012", revizyonNo: 1, revizyonKokId: "t1", durum: "taslak", talepNo: "RFQ-1", odemeVadeGun: 30 });
    expect(veri.id).toBeUndefined();
    expect(tx.belgeSatir.createMany.mock.calls[0][0].data[0]).toMatchObject({ belgeId: "t2", stokId: "k1" });
    expect(tx.belgeSatir.createMany.mock.calls[0][0].data[0].id).toBeUndefined();
    expect(yeni).toMatchObject({ revizyonNo: 1 });
  });

  it("ikinci revizyonda kökü korur", async () => {
    const { servis, tx } = kur(teklif({ id: "t2", revizyonNo: 1, revizyonKokId: "t1" }));
    await servis.revizeEt("t2");
    expect(tx.belge.create.mock.calls[0][0].data).toMatchObject({ revizyonNo: 2, revizyonKokId: "t1" });
  });

  it("siparişe dönüşmüş teklifi ve eşzamanlı değişmiş teklifi revize etmez", async () => {
    await expect(kur(teklif({ durum: "kapandi" })).servis.revizeEt("t1")).rejects.toThrow(/Siparişe dönüşmüş/);
    await expect(kur(teklif(), 0).servis.revizeEt("t1")).rejects.toThrow(ConflictException);
  });

  it("fırsat bağı geçmişi bulunan taslak teklifi silmez", async () => {
    const belge = teklif({ id: "t2", durum: "taslak" });
    const { servis, tx } = kur(belge);
    vi.spyOn(servis, "getir").mockResolvedValue(belge as any);
    tx.firsatBelgeBagi.count.mockResolvedValue(1);
    await expect(servis.sil("t2")).rejects.toThrow(/Fırsat bağı geçmişi/);
    expect(tx.belge.delete).not.toHaveBeenCalled();
  });

  it("taslak sürüm silinince önceki sürümü yeniden onaylı yapar", async () => {
    const { servis, tx } = kur(teklif({ id: "t2", durum: "taslak", revizyonNo: 1, revizyonKokId: "t1" }));
    vi.spyOn(servis, "getir").mockResolvedValue(teklif({ id: "t2", durum: "taslak", revizyonNo: 1, revizyonKokId: "t1" }) as any);

    await servis.sil("t2");

    expect(tx.belge.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ id: "t1" }, { revizyonKokId: "t1" }], revizyonNo: 0, durum: "revize_edildi" },
      data: { durum: "onaylandi" },
    });
  });

  it("eski sürümü siparişe dönüştürmez", async () => {
    const { servis } = kur({ ...teklif({ durum: "revize_edildi" }), cari: { vknTckn: "1234567890" } });
    await expect(servis.donustur("t1", "siparis")).rejects.toThrow(/yalnız son sürüm/);
  });
});

describe("BelgelerService.pdfGonder (FTR-36)", () => {
  const kayit = (ek: Record<string, unknown> = {}) => ({
    tur: "teklif", yon: "satis", durum: "onaylandi", no: "TKF2026000020", revizyonNo: null,
    gecerlilikTarihi: new Date("2026-10-27"), cari: { unvan: "KARSEL LTD.", eposta: "cari@ornek.local" }, eirsaliye: null, ...ek,
  });
  const kur = (belge: Record<string, unknown> | null, gorunum?: { gidenIrsaliyePdf: ReturnType<typeof vi.fn> }) => {
    const tx = { belge: { findUnique: vi.fn().mockResolvedValue(belge) } };
    const prisma = { tenantIslem: vi.fn((_t, calistir) => calistir(tx)) } as any;
    const eposta = { ekliIletiGonder: vi.fn().mockResolvedValue(undefined) };
    const servis = new BelgelerService(prisma, {} as any, {} as any, {} as any, undefined, undefined, eposta as any, (gorunum ? { get: () => gorunum } : undefined) as any);
    vi.spyOn(servis, "pdfUret").mockResolvedValue({ buffer: Buffer.from("pdf"), dosyaAdi: "belge-TKF2026000020.pdf" });
    return { servis, eposta };
  };

  it("teklifi cari adresine geçerlilik tarihiyle gönderir", async () => {
    const { servis, eposta } = kur(kayit());
    await expect(servis.pdfGonder("b1")).resolves.toEqual({ gonderildi: true, alici: "cari@ornek.local", belge: "sistem" });
    const ileti = eposta.ekliIletiGonder.mock.calls[0][0];
    expect(ileti.sablon).toMatchObject({ tur: "belge_eposta", degiskenler: { belge_turu: "Satış Teklifi", belge_no: "TKF2026000020" } });
    expect(ileti.sablon.degiskenler.gecerlilik_cumlesi).toContain("27.10.2026 tarihine kadar geçerlidir");
    expect(ileti.ekler[0].dosyaAdi).toBe("belge-TKF2026000020.pdf");
  });

  it("elle yazılan adres cari adresinin önüne geçer", async () => {
    const { servis, eposta } = kur(kayit());
    await servis.pdfGonder("b1", "baska@ornek.local");
    expect(eposta.ekliIletiGonder.mock.calls[0][0].alici).toBe("baska@ornek.local");
  });

  it.each([
    [{ durum: "taslak", no: null }, /Taslak/],
    [{ durum: "iptal" }, /İptal/],
    [{ durum: "revize_edildi" }, /yeni sürümü/],
    [{ yon: "alis" }, /satış belgeleri/],
    [{ cari: { unvan: "X", eposta: null } }, /Alıcı e-postası yok/],
  ])("gönderilemeyen belgeyi reddeder %#", async (ek, hata) => {
    const { servis, eposta } = kur(kayit(ek));
    await expect(servis.pdfGonder("b1")).rejects.toThrow(hata);
    expect(eposta.ekliIletiGonder).not.toHaveBeenCalled();
  });

  it("GİB'e iletilmiş e-İrsaliyede resmî görünümü ekler", async () => {
    const gorunum = { gidenIrsaliyePdf: vi.fn().mockResolvedValue({ buffer: Buffer.from("resmi"), dosyaAdi: "irsaliye-GBZ1.pdf" }) };
    const { servis, eposta } = kur(kayit({ tur: "irsaliye", no: "GBZ1", gecerlilikTarihi: null, eirsaliye: { durum: "iletildi" } }), gorunum);
    await expect(servis.pdfGonder("b1")).resolves.toMatchObject({ belge: "ebelge" });
    expect(eposta.ekliIletiGonder.mock.calls[0][0]).toMatchObject({ sablon: { degiskenler: { belge_turu: "e-İrsaliye", belge_no: "GBZ1" } }, ekler: [{ dosyaAdi: "irsaliye-GBZ1.pdf" }] });
  });

  it("hatalı e-İrsaliyede kendi çıktımızı ekler", async () => {
    const gorunum = { gidenIrsaliyePdf: vi.fn() };
    const { servis, eposta } = kur(kayit({ tur: "irsaliye", no: "GBZ1", gecerlilikTarihi: null, eirsaliye: { durum: "hata" } }), gorunum);
    await servis.pdfGonder("b1");
    expect(gorunum.gidenIrsaliyePdf).not.toHaveBeenCalled();
    expect(eposta.ekliIletiGonder.mock.calls[0][0].sablon.degiskenler).toMatchObject({ belge_turu: "Sevk İrsaliyesi", belge_no: "GBZ1" });
  });
});
