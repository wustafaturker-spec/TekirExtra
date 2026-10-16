import { describe, expect, it } from "vitest";
import { belgePdfModeli, type BelgePdfVerisi } from "../../belgeler/belge-pdf";
import { gorunumNormalize, VARSAYILAN_GORUNUM } from "./belge-gorunumu";
import { birimAdi } from "./belge-sozlugu";
import { ticariBelgeHtml } from "./ticari-belge";

const firma = { unvan: "DEMO MAKİNA A.Ş.", vkn: "1234567801", vergiDairesi: "Kozyatağı", webSitesi: "www.demo.com.tr" };
const belge = (ek: Partial<BelgePdfVerisi> = {}): BelgePdfVerisi => ({
  tur: "teklif", yon: "satis", durum: "onaylandi", no: "TKF2026000148", tarih: "2026-10-16", gecerlilikTarihi: "2026-10-31",
  odemeVadeGun: 30, teslimSekli: "FOB", dovizCinsi: "USD", kur: "34.2150",
  toplamBrut: "1000.00", toplamSatirIskontosu: "0", genelIskontoToplam: "0", toplamMatrah: "1000.00", toplamKdv: "0.00", genelToplam: "1000.00",
  aciklama: "Fiyatlara nakliye dahil değildir.",
  cari: { kod: "M1", unvan: "GULF SUPPLIES LLC", vknTckn: "100345678900003", adres: { adres: "Plot 18", il: "Dubai", ulke: "AE" } },
  satirlar: [{ stokKod: "PMP-200", stokAd: "Santrifüj pompa", yabanciAd: "Centrifugal pump", miktar: "2", birim: "adet", birimFiyat: "500", iskontoOrani: "0", kdvOrani: "0", toplamTutar: "1000.00" }],
  bankalar: [{ bankaAdi: "İş Bankası", iban: "TR12 0006 4000 0011 2345 6789 01", swift: "ISBKTRIS", doviz: "USD" }],
  ...ek,
});
const html = (b: BelgePdfVerisi, g = {}) => ticariBelgeHtml(belgePdfModeli(b), { firma, gorunum: gorunumNormalize(g) });

describe("ticari belge düzeni (FTR-37…42)", () => {
  it("Türkçe teklif: başlık, yazıyla tutar, banka ve imza alanları; TekirExtra alt bilgisi yok", () => {
    const { html: h, altBilgi } = html(belge());
    expect(h).toContain("TEKLİF");
    expect(h).toContain("BİN ABD DOLARI");
    expect(h).toContain("TR12 0006 4000 0011 2345 6789 01");
    expect(h).toContain("Müşteri Onayı");
    expect(h).toContain("Santrifüj pompa");
    expect(h).not.toContain("Centrifugal pump");
    expect(h).not.toContain("TekirExtra ile oluşturuldu");
    expect(altBilgi).toContain("TKF2026000148");
    expect(altBilgi).toContain("pageNumber");
  });

  it("İngilizce tek dil: yabancı ad, İngilizce sayı biçimi ve Incoterms adı", () => {
    const { html: h } = html(belge({ belgeDili: "en", satirlar: [{ ...belge().satirlar[0], birimFiyat: "1234.5", toplamTutar: "2469.00" }], genelToplam: "2469.00" }));
    expect(h).toContain("QUOTATION");
    expect(h).toContain("Centrifugal pump");
    expect(h).toContain("1,234.50");
    expect(h).toContain("FOB — Free On Board");
    expect(h).toContain("30 days net");
    expect(h).toContain("pcs");
  });

  it("çift dil: Türkçe ana, İngilizce ikinci; iki ad da basılır", () => {
    const { html: h } = html(belge({ belgeDili: "en", ciftDil: true }));
    expect(h).toContain("TEKLİF");
    expect(h).toContain("QUOTATION");
    expect(h).toContain("Santrifüj pompa");
    expect(h).toContain("Centrifugal pump");
    expect(h).toContain("Amount in words");
    // Hazır seçenekler iki dilde.
    expect(h).toContain("30 gün vadeli / 30 days net");
    expect(h).toContain("FOB — Gemide masrafsız teslim / Free On Board");
  });

  it("vergi dairesi adı zaten VD ile bitiyorsa ek yinelenmez", () => {
    const { html: h } = ticariBelgeHtml(belgePdfModeli(belge()), { firma: { ...firma, vergiDairesi: "DAVUTPAŞA VD" } });
    expect(h).toContain("DAVUTPAŞA VD");
    expect(h).not.toContain("DAVUTPAŞA VD V.D.");
  });

  it("Arapça: sağdan sola ve Latin veri yalıtılır", () => {
    const { html: h } = html(belge({ belgeDili: "ar" }));
    expect(h).toContain('dir="rtl"');
    expect(h).toContain("عرض سعر");
    expect(h).toContain('<bdi dir="ltr">GULF SUPPLIES LLC</bdi>');
  });

  it("Türkçe belgede çift dil bayrağı yok sayılır", () => {
    expect(belgePdfModeli(belge({ belgeDili: "tr", ciftDil: true })).ciftDil).toBe(false);
  });

  it("görünüm: bölümler kapanınca banka ve yazıyla tutar basılmaz; taslakta filigran", () => {
    const { html: h } = html(belge({ durum: "taslak" }), { bolumler: { teklif: { banka: false, yaziyla: false } } });
    expect(h).not.toContain("TR12 0006");
    expect(h).not.toContain("BİN ABD DOLARI");
    expect(h).toContain('class="filigran"');
  });

  it("görünüm: özel kapanış ve imza adları sözlüğün önüne geçer", () => {
    const { html: h } = html(belge(), { metinler: { teklif: { tr: { kapanis: "Özel kapanış", imzalar: "Satış Müdürü\nGenel Müdür" } } } });
    expect(h).toContain("Özel kapanış");
    expect(h).toContain("Genel Müdür");
    expect(h).not.toContain("Müşteri Onayı");
  });

  it("iskonto yoksa iskonto sütunu gizlenir", () => {
    expect(html(belge()).html).not.toContain("İsk.");
    expect(html(belge({ satirlar: [{ ...belge().satirlar[0], iskontoOrani: "5" }] })).html).toContain("İsk.");
  });
});

describe("görünüm normalize (FTR-42)", () => {
  it("bozuk değerler varsayılana düşer, geçerliler kalır", () => {
    const g = gorunumNormalize({ anaRenk: "kırmızı", ikincilRenk: "#ABCDEF", yaziTipi: "comic", tabloBaslik: "sade", bolumler: { teklif: { banka: "evet", imza: false } } });
    expect(g.anaRenk).toBe(VARSAYILAN_GORUNUM.anaRenk);
    expect(g.ikincilRenk).toBe("#abcdef");
    expect(g.yaziTipi).toBe("dejavu");
    expect(g.tabloBaslik).toBe("sade");
    expect(g.bolumler.teklif.banka).toBe(true);
    expect(g.bolumler.teklif.imza).toBe(false);
  });
});

describe("birim çevirisi", () => {
  it("tanınan birim dile çevrilir, tanınmayan olduğu gibi kalır", () => {
    expect(birimAdi("adet", "en")).toBe("pcs");
    expect(birimAdi("saat", "de")).toBe("Std.");
    expect(birimAdi("m2", "ru")).toBe("м²");
    expect(birimAdi("bağ", "en")).toBe("bağ");
  });
});
