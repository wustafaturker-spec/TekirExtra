import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { BelgelerService } from "./belgeler.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
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
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any, { irsaliyeSeriOneki: vi.fn() } as any);

    await expect(service.topluFatura({ belgeIds: ["b1"] })).rejects.toThrow(ConflictException);
    expect(tx.belge.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, durum: "onaylandi", faturaId: null },
      data: { durum: "kapandi", faturaId: "f1" },
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
    const service = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any, { irsaliyeSeriOneki: vi.fn() } as any);

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
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any, { irsaliyeSeriOneki: vi.fn() } as any);
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
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any, { irsaliyeSeriOneki: vi.fn() } as any);

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
      tevkifatTutari: D(0), netKdvTutari: D("200"), toplamTutar: D("1200"),
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
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any, { irsaliyeSeriOneki: vi.fn() } as any);

    const detay = await servis.getir("sip1");

    expect(detay.teslimatlar).toHaveLength(1);
    expect(detay.teslimatlar[0]).toMatchObject({ no: "IRS1", kalemler: [{ satirId: "s1", stokKod: "STK-1", miktar: "40.000" }] });
    // Satırda kalan miktar da görünür (SAT-09)
    expect(detay.satirlar[0]).toMatchObject({ teslimEdilenMiktar: "40.000", kalanMiktar: "60.000" });
  });

  it("virgüllü durum süzgecini çoklu duruma çevirir (SAT-10)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir({ belge: { findMany } })) } as any;
    const servis = new BelgelerService(prisma, {} as any, {} as any, { tarihDogrula: vi.fn() } as any, { irsaliyeSeriOneki: vi.fn() } as any);

    await servis.listele("siparis", "alis", "onaylandi,kismen_kapandi");
    expect(findMany.mock.calls[0][0].where).toMatchObject({ durum: { in: ["onaylandi", "kismen_kapandi"] } });

    await servis.listele("siparis", "alis", "onaylandi");
    expect(findMany.mock.calls[1][0].where).toMatchObject({ durum: "onaylandi" });
  });
});
