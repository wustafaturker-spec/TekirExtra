import { describe, expect, it, vi } from "vitest";
import { EbelgeService, gonderimTarihiGecerliMi } from "./ebelge.service";
import { faturaUblOku } from "./ubl-oku";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({
    tenantId: "t1-uuid",
    rol: "muhasebe",
  }),
}));

vi.mock("../core/kripto", () => ({
  coz: (val: string) => val, // pass-through for config JSON
}));

// Ön denetim (EBLG-134) kendi testlerinde; sihirbaz testleri engelleri sınar.
vi.mock("./on-denetim", () => ({ onDenetimCalistir: async () => ({ bulgular: [], susturulan: 0 }) }));

/** Ayrıştırma testlerinde kullanılan asgari ama gerçekçi UBL-TR faturası. */
const GELEN_UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>GIB2026000000001</cbc:ID>
  <cbc:UUID>uuid-1</cbc:UUID>
  <cbc:IssueDate>2026-07-20</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="MERSISNO">0123456789012345</cbc:ID></cac:PartyIdentification>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>Tedarikçi A.Ş.</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">180.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">900.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">900.00</cbc:TaxExclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="TRY">100.00</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="TRY">1080.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">10.000</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">900.00</cbc:LineExtensionAmount>
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:MultiplierFactorNumeric>0.1000</cbc:MultiplierFactorNumeric>
      <cbc:Amount currencyID="TRY">100.00</cbc:Amount>
    </cac:AllowanceCharge>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="TRY">180.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="TRY">900.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="TRY">180.00</cbc:TaxAmount>
        <cbc:Percent>20.00</cbc:Percent>
        <cac:TaxCategory><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>Test Ürünü</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>TED-001</cbc:ID></cac:SellersItemIdentification>
      <cac:StandardItemIdentification><cbc:ID schemeID="GTIN">8690000000017</cbc:ID></cac:StandardItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">100.0000</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

describe("faturaUblOku (EBLG-05 XML ayrıştırma)", () => {
  it("başlık, taraflar, toplamlar ve satırları okur", () => {
    const ubl = faturaUblOku(GELEN_UBL);

    expect(ubl.belgeNo).toBe("GIB2026000000001");
    expect(ubl.profilId).toBe("TICARIFATURA");
    expect(ubl.tarih).toBe("2026-07-20");
    // Birden çok PartyIdentification arasından VKN şemalı olan seçilmeli
    expect(ubl.gonderen.vknTckn).toBe("1234567890");
    expect(ubl.gonderen.unvan).toBe("Tedarikçi A.Ş.");
    expect(ubl.toplamlar.matrah).toBe(900);
    expect(ubl.toplamlar.kdv).toBe(180);
    expect(ubl.toplamlar.genelToplam).toBe(1080);

    expect(ubl.satirlar).toHaveLength(1);
    const s = ubl.satirlar[0];
    expect(s.ad).toBe("Test Ürünü");
    expect(s.miktar).toBe(10);
    expect(s.birim).toBe("adet"); // C62 → adet
    expect(s.birimFiyat).toBe(100);
    expect(s.iskontoOrani).toBe(10); // MultiplierFactorNumeric 0.10
    expect(s.iskontoTutari).toBe(100);
    expect(s.kdvOrani).toBe(20);
    expect(s.matrah).toBe(900);
    expect(s.saticiUrunKodu).toBe("TED-001");
    expect(s.barkod).toBe("8690000000017");
  });

  it("faturanın dayandığı irsaliye numaralarını okur (SAT-13)", () => {
    expect(faturaUblOku(GELEN_UBL).irsaliyeler).toEqual([]);
    const xml = GELEN_UBL.replace(
      "<cbc:IssueDate>2026-07-20</cbc:IssueDate>",
      `<cbc:IssueDate>2026-07-20</cbc:IssueDate>
  <cac:DespatchDocumentReference><cbc:ID>ABC2026000000012</cbc:ID><cbc:IssueDate>2026-07-18</cbc:IssueDate></cac:DespatchDocumentReference>
  <cac:DespatchDocumentReference><cbc:ID>ABC2026000000013</cbc:ID></cac:DespatchDocumentReference>`,
    );
    expect(faturaUblOku(xml).irsaliyeler).toEqual([{ no: "ABC2026000000012", tarih: "2026-07-18" }, { no: "ABC2026000000013", tarih: undefined }]);
  });

  it("UBL olmayan içerikte hata fırlatır", () => {
    expect(() => faturaUblOku("<Baska></Baska>")).toThrow(/Invoice kökü/);
  });

  /** EBLG-76: ibare notta, sevk anı Delivery/Despatch'te taşınır. */
  it("irsaliye yerine geçen faturada notu ve fiili sevk anını okur", () => {
    const xml = GELEN_UBL.replace(
      "<cbc:IssueDate>2026-07-20</cbc:IssueDate>",
      `<cbc:IssueDate>2026-07-20</cbc:IssueDate>
  <cbc:Note>Mal e-Fatura beraberinde sevk edildiğinden ayrıca e-İrsaliye düzenlenmemiştir. Bu fatura irsaliye yerine geçer.</cbc:Note>
  <cac:Delivery><cac:Despatch><cbc:ActualDespatchDate>2026-07-20</cbc:ActualDespatchDate><cbc:ActualDespatchTime>09:30:00</cbc:ActualDespatchTime></cac:Despatch></cac:Delivery>`,
    );

    const ubl = faturaUblOku(xml);

    expect(ubl.notlar).toHaveLength(1);
    expect(ubl.notlar[0]).toContain("irsaliye yerine geçer");
    expect(ubl.sevk).toEqual({ tarih: "2026-07-20", saat: "09:30:00" });
  });

  it("özel matrah faturasında KDV'nin hesaplandığı tutarı ayrıca okur (EBLG-111)", () => {
    const xml = GELEN_UBL
      .replace("<cbc:IssueDate>2026-07-20</cbc:IssueDate>", "<cbc:IssueDate>2026-07-20</cbc:IssueDate>\n  <cbc:InvoiceTypeCode>OZELMATRAH</cbc:InvoiceTypeCode>")
      .replace(
        '<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">180.00</cbc:TaxAmount></cac:TaxTotal>',
        '<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">20.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">20.00</cbc:TaxAmount><cac:TaxCategory><cac:TaxScheme><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>',
      );

    const { toplamlar } = faturaUblOku(xml);

    expect(toplamlar).toMatchObject({ matrah: 900, ozelMatrah: 100, kdv: 20 });
    expect(faturaUblOku(GELEN_UBL).toplamlar.ozelMatrah).toBeUndefined();
  });

  it("sevk taşımayan teslimat bloğunu sevk sanmaz", () => {
    const xml = GELEN_UBL.replace(
      "<cbc:IssueDate>2026-07-20</cbc:IssueDate>",
      `<cbc:IssueDate>2026-07-20</cbc:IssueDate>
  <cac:Delivery><cbc:ActualDeliveryDate>2026-07-21</cbc:ActualDeliveryDate></cac:Delivery>`,
    );

    expect(faturaUblOku(xml).sevk).toBeUndefined();
    expect(faturaUblOku(GELEN_UBL).notlar).toEqual([]);
  });
});

describe("EbelgeService (EBLG-01..08)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = {
    tenantIslem: mockTenantIslem,
  } as any;

  const mockAdapter = {
    mukellefSorgula: vi.fn().mockResolvedValue({
      eFaturaMukellefi: true,
      postaKutusu: "urn:mail:defaultpk@1234567890",
    }),
    belgeGonder: vi.fn().mockResolvedValue({ basarili: true, belgeRef: "REF-123" }),
    durumSorgula: vi.fn().mockResolvedValue({ durum: "kabul" }),
    gelenBelgeleriCek: vi.fn().mockResolvedValue([
      {
        uuid: "uuid-1",
        belgeNo: "GIB2026000000001",
        gonderenVkn: "1234567890",
        gonderenUnvan: "Tedarikçi A.Ş.",
        tarih: new Date("2026-07-20"),
        xml: GELEN_UBL,
      },
    ]),
    yanitGonder: vi.fn().mockResolvedValue({ basarili: true, belgeRef: "REF-9" }),
    belgeAra: vi.fn(),
  };

  const mockBaglantilar = {
    adapterCoz: vi.fn().mockReturnValue(mockAdapter),
  } as any;

  const mockFatura = {
    olustur: vi.fn(),
    sil: vi.fn(),
  } as any;

  // Kanal kararı artık lokal mükellef listesinden gelir (EBLG-10); bu testler
  // gönderim akışını ölçtüğü için karar sabitlenir.
  const mockMukellefListesi = {
    kanalBelirle: vi.fn().mockResolvedValue({ vknTckn: "1234567890", eFaturaMukellefi: true, postaKutusu: "urn:mail:defaultpk@alici.test" }),
    listeTuru: vi.fn().mockResolvedValue(null),
  } as any;
  const mockMetrics = { increment: vi.fn(), set: vi.fn() } as any;

  const mockBildirimler = { uret: vi.fn() } as any;

  const service = new EbelgeService(mockPrisma, mockBaglantilar, mockFatura, mockMukellefListesi, mockMetrics, mockBildirimler);

  it("gonder kanalı lokal mükellef listesinden belirler, UBL uretir ve gönderir (EBLG-01/02/03/10)", async () => {
    const mockTx = {
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1",
          tip: "satis",
          durum: "kesin",
          tarih: new Date(),
          no: "TKR2026000000001",
          toplamBrut: 100,
          toplamMatrah: 100,
          toplamKdv: 20,
          genelToplam: 120,
          dovizCinsi: "TRY",
          toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          cari: { vknTckn: "1234567890", unvan: "Müşteri", adresler: [] },
        }),
      },
      baglanti: {
        findFirst: vi.fn().mockResolvedValue({
          saglayici: "izibiz",
          sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }),
        }),
      },
      cariHesap: {
        update: vi.fn().mockResolvedValue({}),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh. Çırpıcı Yol Sk. No:7", ilce: "Zeytinburnu", il: "İstanbul" }),
      },
      ebelgeKayit: {
        create: vi.fn().mockResolvedValue({ id: "eb1" }),
        update: vi.fn().mockResolvedValue({ id: "eb1" }),
      },
      ebelgeArsiv: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const sonuc = await service.gonder("f1");

    // Kanal kararı lokal listeden verilir; entegratöre gönderim başına
    // mükellef sorgusu gitmez (EBLG-10).
    expect(mockMukellefListesi.kanalBelirle).toHaveBeenCalledWith(
      "izibiz",
      expect.any(Object),
      "1234567890",
      "efatura",
      // EBLG-86: carinin elle seçtiği kutu (yoksa kural seçer).
      undefined,
    );
    expect(mockAdapter.mukellefSorgula).not.toHaveBeenCalled();
    expect(mockAdapter.belgeGonder).toHaveBeenCalled();
    expect(mockTx.ebelgeKayit.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1-uuid",
        faturaId: "f1",
        tur: "earsiv",
        durum: "kuyrukta",
        hataMesaji: null,
      },
      select: { id: true },
    });
    expect(mockTx.ebelgeKayit.update).toHaveBeenCalledWith({
      where: { id: "eb1" },
      data: {
        tur: "efatura",
        durum: "iletildi",
        entegratorRef: "REF-123",
        hataMesaji: null,
      },
    });
    expect(sonuc.basarili).toBe(true);
  });


  /**
   * İhracatta kanal alıcının ülkesinden gelir (EBLG-53): mükellef listesi hiç
   * sorulmaz, belge alıcının değil Ticaret Bakanlığı'nın kutusuna gider ve
   * yurt dışı alıcının VKN'si olmadığı için kart kimliği aranmaz.
   */
  it("ihracat faturasında mükellef listesi sorulmaz, belge Ticaret Bakanlığı kutusuna gider (EBLG-53)", async () => {
    mockMukellefListesi.kanalBelirle.mockClear();
    mockAdapter.belgeGonder.mockClear();
    const mockTx = {
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f9", tip: "satis", durum: "kesin", tarih: new Date(), no: "TKR2026000000009",
          toplamBrut: 1000, toplamMatrah: 1000, toplamKdv: 0, genelToplam: 1000,
          dovizCinsi: "USD", kur: 41.5, toplamSatirIskontosu: 0,
          senaryo: "istisna", efaturaProfili: "temel",
          ihracatTeslimTarihi: new Date("2026-09-20"), ihracatTeslimSarti: "FOB", ihracatTasimaSekli: "1",
          gumrukBeyannameNo: null,
          satirlar: [{
            miktar: 1, matrah: 1000, iskontoTutari: 0, kdvTutari: 0, kdvOrani: 0, birimFiyat: 1000,
            stok: { kod: "U9", ad: "Fındık", tip: "urun", gtipKodu: "080222100000", mensei: "TR" },
          }],
          // Yurt dışı alıcının VKN'si yoktur; adresteki ülke kanalı belirler.
          cari: { vknTckn: null, unvan: "Muster GmbH", adresler: [{ tip: "fatura", ulke: "DE", adres: "Hauptstr. 1", il: "Berlin", ilce: "Mitte", postaKodu: "10115" }] },
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "t" }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh. Çırpıcı Yol Sk. No:7", ilce: "Zeytinburnu", il: "İstanbul" }) },
      ebelgeKayit: { create: vi.fn().mockResolvedValue({ id: "eb9" }), update: vi.fn().mockResolvedValue({ id: "eb9" }) },
      ebelgeArsiv: { upsert: vi.fn().mockResolvedValue({}) },
    };
    mockTenantIslem.mockImplementation((tenantId: string, cb: (tx: unknown) => unknown) => cb(mockTx));

    const sonuc = await service.gonder("f9");

    expect(mockMukellefListesi.kanalBelirle).not.toHaveBeenCalled();
    expect(sonuc.basarili).toBe(true);
    const gonderilen = mockAdapter.belgeGonder.mock.calls.at(-1)![1];
    expect(gonderilen.tur).toBe("efatura");
    expect(gonderilen.aliciPostaKutusu).toBe("urn:mail:ihracatpk@gtb.gov.tr");
    expect(gonderilen.xml).toContain("<cbc:ProfileID>IHRACAT</cbc:ProfileID>");
    expect(gonderilen.xml).toContain('<cbc:ID schemeID="VKN">1460415308</cbc:ID>');
    expect(gonderilen.xml).toContain('<cbc:ID schemeID="PARTYTYPE">EXPORT</cbc:ID>');
  });

  it("ihracat faturasında fiili ihracat tarihi ve GTİP eksikse göndermez (EBLG-53)", async () => {
    mockAdapter.belgeGonder.mockClear();
    const mockTx = {
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f10", tip: "satis", durum: "kesin", tarih: new Date(), no: "TKR2026000000010",
          toplamBrut: 1000, toplamMatrah: 1000, toplamKdv: 0, genelToplam: 1000,
          dovizCinsi: "USD", kur: 41.5, toplamSatirIskontosu: 0,
          senaryo: "istisna", efaturaProfili: "temel",
          ihracatTeslimTarihi: null, ihracatTeslimSarti: null, ihracatTasimaSekli: null, gumrukBeyannameNo: null,
          satirlar: [{ miktar: 1, matrah: 1000, iskontoTutari: 0, kdvTutari: 0, kdvOrani: 0, birimFiyat: 1000, stok: { kod: "U9", ad: "Fındık", tip: "urun", gtipKodu: null, mensei: "TR" } }],
          cari: { vknTckn: null, unvan: "Muster GmbH", adresler: [{ tip: "fatura", ulke: "DE", adres: null, il: null, ilce: null, postaKodu: null }] },
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "t" }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh. Çırpıcı Yol Sk. No:7", ilce: "Zeytinburnu", il: "İstanbul" }) },
      ebelgeKayit: { create: vi.fn(), update: vi.fn() },
      ebelgeArsiv: { upsert: vi.fn() },
    };
    mockTenantIslem.mockImplementation((tenantId: string, cb: (tx: unknown) => unknown) => cb(mockTx));

    await expect(service.gonder("f10")).rejects.toThrow("Fiili ihracat tarihi");
    expect(mockAdapter.belgeGonder).not.toHaveBeenCalled();
    expect(mockTx.ebelgeKayit.create).not.toHaveBeenCalled();
  });

  /**
   * Entegratör test ortamlarının sentetik kimlikleri VKN kontrol hanesini
   * tutmaz. Kural gönderen için zaten gevşetiliyordu; alıcı için de aynı
   * olmalı — o kimliklerden belge alıp onlara belge kesememek tutarsızdı.
   */
  function sentetikVknTx(testOrtami: boolean) {
    return {
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1", tip: "satis", durum: "kesin", tarih: new Date(), no: null,
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          // GİB sandbox kimliği: kontrol hanesi tutmaz.
          cari: { vknTckn: "1234567801", unvan: "Test Kurum", adresler: [] },
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "t", testOrtami }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      // Gönderen VKN'si geçerli: böylece test yalnız alıcı kuralını ölçer.
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh. Çırpıcı Yol Sk. No:7", ilce: "Zeytinburnu", il: "İstanbul" }) },
      ebelgeKayit: { create: vi.fn().mockResolvedValue({ id: "eb1" }), update: vi.fn().mockResolvedValue({ id: "eb1" }) },
      ebelgeArsiv: { upsert: vi.fn().mockResolvedValue({}) },
    };
  }

  it("test ortamında sentetik alıcı VKN'sini kabul eder", async () => {
    const tx = sentetikVknTx(true);
    mockTenantIslem.mockImplementation((_t: string, cb: (x: unknown) => unknown) => cb(tx));
    mockMukellefListesi.kanalBelirle.mockResolvedValueOnce({ vknTckn: "1234567801", eFaturaMukellefi: true, postaKutusu: "urn:mail:defaultpk@nes.com.tr" });
    await expect(service.gonder("f1")).resolves.toMatchObject({ basarili: true });
  });

  it("üretimde sentetik alıcı VKN'sini reddeder", async () => {
    const tx = sentetikVknTx(false);
    mockTenantIslem.mockImplementation((_t: string, cb: (x: unknown) => unknown) => cb(tx));
    await expect(service.gonder("f1")).rejects.toThrow(/Alıcının geçerli bir VKN/);
  });

  /** Yeniden deneme senaryosu için ortak tx: fatura zaten hatalı bir e-belge kaydına sahip. */
  function yenidenDenemeTx(ebelge: Record<string, unknown> = { id: "eb1", durum: "hata" }) {
    return {
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1", tip: "satis", durum: "kesin", tarih: new Date(), no: "TKR2026000000001",
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          cari: { vknTckn: "1234567890", unvan: "Müşteri", adresler: [] },
          ebelge,
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh. Çırpıcı Yol Sk. No:7", ilce: "Zeytinburnu", il: "İstanbul" }) },
      ebelgeKayit: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "eb1" }),
      },
      ebelgeArsiv: { upsert: vi.fn().mockResolvedValue({}) },
    };
  }

  it("yeniden denemede sağlayıcıda duran belgeyi benimser, ikinci kez göndermez (EBLG-17)", async () => {
    // Önceki denemede ağ çağrısı geçmiş ama kalıcılaştırma düşmüş olabilir;
    // yeniden göndermek aynı satış için ikinci belge düzenlemek olurdu.
    mockAdapter.belgeGonder.mockClear();
    mockAdapter.belgeAra.mockResolvedValue({ basarili: true, belgeRef: "REF-ONCEKI", belgeNo: "K072026000000015" });
    const mockTx = yenidenDenemeTx();
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const sonuc = await service.gonder("f1");

    expect(mockAdapter.belgeAra).toHaveBeenCalledWith(expect.any(Object), "f1", "efatura");
    expect(mockAdapter.belgeGonder).not.toHaveBeenCalled();
    expect(mockTx.ebelgeKayit.update).toHaveBeenCalledWith({
      where: { id: "eb1" },
      data: { tur: "efatura", durum: "iletildi", entegratorRef: "REF-ONCEKI", hataMesaji: null },
    });
    expect(sonuc.basarili).toBe(true);
  });

  it("mükerrer kontrolü çalışmazsa gönderimi durdurur, körlemesine göndermez", async () => {
    // Sorgu düşerse mükerrer ihtimali elenemez; göndermek ikinci belge demektir.
    mockAdapter.belgeGonder.mockClear();
    mockAdapter.belgeAra.mockRejectedValue(new Error("NES 403: API anahtarının yetkisi yok"));
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(yenidenDenemeTx()));

    await expect(service.gonder("f1")).rejects.toThrow("mükerrer gönderim riski");
    expect(mockAdapter.belgeGonder).not.toHaveBeenCalled();
  });

  it("yeniden denemede adaptör belge aramayı desteklemiyorsa göndermez", async () => {
    mockAdapter.belgeGonder.mockClear();
    mockBaglantilar.adapterCoz.mockReturnValueOnce({ ...mockAdapter, belgeAra: undefined });
    const mockTx = yenidenDenemeTx();
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    await expect(service.gonder("f1")).rejects.toThrow("arama desteği sunmuyor");
    expect(mockAdapter.belgeGonder).not.toHaveBeenCalled();
    expect(mockTx.ebelgeKayit.update).toHaveBeenCalledWith({
      where: { id: "eb1" },
      data: { durum: "hata", hataMesaji: expect.stringContaining("mükerrer gönderim riski") },
    });
  });

  it("sağlayıcıda belge yoksa yeniden denemede normal gönderim yapar", async () => {
    mockAdapter.belgeGonder.mockClear();
    mockAdapter.belgeAra.mockResolvedValue(undefined);
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(yenidenDenemeTx()));

    await service.gonder("f1");

    expect(mockAdapter.belgeAra).toHaveBeenCalled();
    expect(mockAdapter.belgeGonder).toHaveBeenCalled();
  });

  it("yarım kalmış rezervasyonu yeniden gönderir, önce sağlayıcıya sorar (EBLG-37)", async () => {
    // Süreç rezervasyonla sonuç yazımı arasında ölmüş; kayıt referanssız kaldı.
    mockAdapter.belgeGonder.mockClear();
    mockAdapter.belgeAra.mockReset().mockResolvedValue(undefined);
    const mockTx = yenidenDenemeTx({ id: "eb1", durum: "kuyrukta", entegratorRef: null, updatedAt: new Date(Date.now() - 20 * 60 * 1000) });
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    await expect(service.gonder("f1")).resolves.toMatchObject({ basarili: true });

    expect(mockTx.ebelgeKayit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "eb1", OR: [{ durum: { in: ["hata", "ret"] } }, expect.objectContaining({ durum: "kuyrukta", entegratorRef: null })] },
    }));
    expect(mockAdapter.belgeAra).toHaveBeenCalled();
    expect(mockAdapter.belgeGonder).toHaveBeenCalled();
  });

  it("15 dakika dolmamış ya da referanslı kuyrukta kaydı yeniden göndermez (EBLG-37)", async () => {
    mockAdapter.belgeGonder.mockClear();
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(yenidenDenemeTx({ id: "eb1", durum: "kuyrukta", entegratorRef: null, updatedAt: new Date() })));
    await expect(service.gonder("f1")).rejects.toThrow("zaten başlatılmış");

    mockTenantIslem.mockImplementation((tenantId, cb) => cb(yenidenDenemeTx({ id: "eb1", durum: "kuyrukta", entegratorRef: "EARSIV:1", updatedAt: new Date(0) })));
    await expect(service.gonder("f1")).rejects.toThrow("zaten başlatılmış");
    expect(mockAdapter.belgeGonder).not.toHaveBeenCalled();
  });

  it("ilk gönderimde sağlayıcıya belge sorgusu yapılmaz", async () => {
    mockAdapter.belgeAra.mockClear();
    // İlk gönderimde kayıt yeni yaratılır; boşuna çağrı yapmak çağrı
    // disiplinini bozardı (EBLG-15).
    expect(mockAdapter.belgeAra).not.toHaveBeenCalled();
  });

  /** e-Arşiv kanalı: alıcı e-Fatura mükellefi değil, kayıt ilk kez yaratılıyor. */
  function earsivTx(config: Record<string, unknown>) {
    return {
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1", tip: "satis", durum: "kesin", tarih: new Date(), no: null,
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          cari: { vknTckn: "10000000078", unvan: "Ayşe Yılmaz", adresler: [] },
          ebelge: null,
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify(config) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh. Çırpıcı Yol Sk. No:7", ilce: "Zeytinburnu", il: "İstanbul" }) },
      ebelgeKayit: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: "eb1" }),
        update: vi.fn().mockResolvedValue({ id: "eb1" }),
      },
      ebelgeArsiv: { upsert: vi.fn().mockResolvedValue({}) },
    };
  }

  it("e-Arşiv serisi tanımlı değilse gönderimi durdurur (GİB ayrı seri ister)", async () => {
    // Aynı önekle giden e-Arşiv belgesini GİB şematronu reddediyor; hatayı
    // entegratörden almaktansa gönderimden önce söylemek gerekir.
    mockAdapter.belgeGonder.mockClear();
    mockAdapter.belgeNoAtar = true;
    mockMukellefListesi.kanalBelirle.mockResolvedValueOnce({ vknTckn: "10000000078", eFaturaMukellefi: false });
    mockTenantIslem.mockImplementation((tenantId: string, cb: (tx: unknown) => unknown) => cb(earsivTx({ kullaniciAdi: "test", belgeSeriOneki: "K07" })));

    await expect(service.gonder("f1")).rejects.toThrow("e-Arşiv seri öneki");
    expect(mockAdapter.belgeGonder).not.toHaveBeenCalled();
  });

  it("e-Arşiv kanalında UBL'e e-Arşiv serisinin önekini yazar", async () => {
    mockAdapter.belgeGonder.mockClear();
    mockAdapter.belgeNoAtar = true;
    mockMukellefListesi.kanalBelirle.mockResolvedValueOnce({ vknTckn: "10000000078", eFaturaMukellefi: false });
    mockTenantIslem.mockImplementation((tenantId: string, cb: (tx: unknown) => unknown) => cb(earsivTx({ kullaniciAdi: "test", belgeSeriOneki: "K07", earsivSeriOneki: "SNC" })));

    await service.gonder("f1");

    const belge = mockAdapter.belgeGonder.mock.calls[0][1];
    expect(belge.tur).toBe("earsiv");
    expect(belge.belgeNo).toBe("SNC");
    expect(belge.xml).toContain("<cbc:ID>SNC</cbc:ID>");
    expect(belge.xml).toContain("<cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>");
  });

  it("gelenBelgeleriCek fatura ÜRETMEZ, belgeyi gelen kutusuna yazar (EBLG-05 onay kapısı)", async () => {
    const mockTx = {
      baglanti: {
        findFirst: vi.fn().mockResolvedValue({
          saglayici: "izibiz",
          sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }),
        }),
      },
      gelenEbelge: {
        findUnique: vi.fn().mockResolvedValue(null), // henüz çekilmemiş
        upsert: vi.fn().mockResolvedValue({ id: "gelen-1" }),
      },
      ebelgeGelenKursor: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      fatura: { create: vi.fn() },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));

    const sonuc = await service.gelenBelgeleriCek();

    expect(mockAdapter.gelenBelgeleriCek).toHaveBeenCalled();
    expect(mockTx.fatura.create).not.toHaveBeenCalled();
    expect(mockTx.gelenEbelge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_uuid: { tenantId: "t1-uuid", uuid: "uuid-1" } },
        create: expect.objectContaining({
          belgeNo: "GIB2026000000001",
          gonderenVkn: "1234567890",
          profilId: "TICARIFATURA",
        }),
      }),
    );
    expect(sonuc.toplamCekilen).toBe(1);
    expect(sonuc.yeniBelgeSayisi).toBe(1);
  });

  it("gelenOnayla eşleşmemiş satır varsa faturaya işlemez (S-01 stok eşleştirme kuralı)", async () => {
    const mockTx = {
      gelenEbelge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "gelen-1",
          durum: "beklemede",
          belgeNo: "GIB2026000000001",
          gonderenVkn: "1234567890",
          gonderenUnvan: "Tedarikçi A.Ş.",
          tarih: new Date("2026-07-20"),
          xmlIcerik: GELEN_UBL,
        }),
      },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));

    await expect(service.gelenOnayla("gelen-1", { satirEslesmeleri: [] })).rejects.toThrow(
      /eşleştirilmedi/,
    );
    expect(mockFatura.olustur).not.toHaveBeenCalled();
  });

  it("gelenOnayla eşleşmiş satırlarla taslak alış faturası üretir ve belgeyi bağlar (EBLG-05)", async () => {
    const guncelle = vi.fn().mockResolvedValue({});
    const mockTx = {
      gelenEbelge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "gelen-1",
          durum: "beklemede",
          belgeNo: "GIB2026000000001",
          gonderenVkn: "1234567890",
          gonderenUnvan: "Tedarikçi A.Ş.",
          tarih: new Date("2026-07-20"),
          xmlIcerik: GELEN_UBL,
        }),
        update: guncelle,
      },
      stokKart: {
        findMany: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]),
      },
      cariHesap: {
        findFirst: vi.fn().mockResolvedValue({ id: "cari-1" }), findMany: vi.fn().mockResolvedValue([{ id: "cari-1", tip: "tedarikci" }]),
      },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));
    mockFatura.olustur.mockResolvedValue({ id: "fatura-1", genelToplam: "1080.00" });

    const sonuc = await service.gelenOnayla("gelen-1", {
      satirEslesmeleri: [{ siraNo: 1, stokId: "11111111-1111-4111-8111-111111111111" }],
    });

    expect(mockFatura.olustur).toHaveBeenCalledWith(
      expect.objectContaining({
        tip: "alis",
        cariId: "cari-1",
        satirlar: [
          expect.objectContaining({
            stokId: "11111111-1111-4111-8111-111111111111",
            miktar: "10.000",
            birimFiyat: "100.0000",
            iskontoOrani: "10.00",
            kdvOrani: "20.00",
          }),
        ],
      }),
      // CARI-32: gelen belgenin kaydı cari blokajına takılmaz.
      { gelenBelge: true },
    );
    expect(guncelle).toHaveBeenCalledWith({
      where: { id: "gelen-1" },
      data: { durum: "islendi", faturaId: "fatura-1" },
    });
    expect(sonuc.faturaId).toBe("fatura-1");
    expect(sonuc.tutarDenetimi.gecerli).toBe(true); // belge toplamı ile hesaplanan uyuşuyor
  });

  it("gelen iade belgesi satış iadesi olur, numarasını korur ve satış faturamıza bağlanır (EBLG-119)", async () => {
    const xml = GELEN_UBL.replace(
      "<cbc:IssueDate>2026-07-20</cbc:IssueDate>",
      `<cbc:IssueDate>2026-07-20</cbc:IssueDate>
  <cbc:InvoiceTypeCode>IADE</cbc:InvoiceTypeCode>
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>TKR2026000000007</cbc:ID><cbc:IssueDate>2026-07-01</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>KAGIT-12</cbc:ID><cbc:IssueDate>2026-06-15</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`,
    );
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const mockTx = {
      gelenEbelge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "gelen-1", durum: "beklemede", belgeNo: "GIB2026000000001", gonderenVkn: "1234567890",
          gonderenUnvan: "Müşteri A.Ş.", tarih: new Date("2026-07-20"), xmlIcerik: xml,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      stokKart: { findMany: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]) },
      cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "cari-1", tip: "musteri" }), findMany: vi.fn().mockResolvedValue([{ id: "cari-1", tip: "musteri" }]) },
      fatura: { findMany: vi.fn().mockResolvedValue([{ id: "satis-7", no: "TKR2026000000007", tarih: new Date("2026-07-01") }]) },
      faturaIadeReferansi: { createMany },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));
    mockFatura.olustur.mockResolvedValue({ id: "fatura-1", genelToplam: "1080.00" });

    await service.gelenOnayla("gelen-1", { satirEslesmeleri: [{ siraNo: 1, stokId: "11111111-1111-4111-8111-111111111111" }] });

    expect(mockFatura.olustur).toHaveBeenCalledWith(expect.objectContaining({ tip: "satis_iade", no: "GIB2026000000001", cariId: "cari-1" }), { gelenBelge: true });
    expect(mockTx.fatura.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ cariId: "cari-1", tip: "satis", durum: "kesin" }) }));
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ faturaId: "fatura-1", sira: 1, belgeNo: "TKR2026000000007", kaynakFaturaId: "satis-7" }),
        expect.objectContaining({ faturaId: "fatura-1", sira: 2, belgeNo: "KAGIT-12", kaynakFaturaId: null, tarih: new Date("2026-06-15") }),
      ],
    });
  });

  it("iade belgesini yalnız tedarikçi tipindeki cariye işlemez (EBLG-119)", async () => {
    const xml = GELEN_UBL.replace("<cbc:IssueDate>2026-07-20</cbc:IssueDate>", "<cbc:IssueDate>2026-07-20</cbc:IssueDate>\n  <cbc:InvoiceTypeCode>IADE</cbc:InvoiceTypeCode>");
    const mockTx = {
      gelenEbelge: { findUnique: vi.fn().mockResolvedValue({ id: "gelen-1", durum: "beklemede", belgeNo: "GIB2026000000001", gonderenVkn: "1234567890", gonderenUnvan: "X", tarih: new Date("2026-07-20"), xmlIcerik: xml }) },
      stokKart: { findMany: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]) },
      cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "cari-1", tip: "tedarikci" }), findMany: vi.fn().mockResolvedValue([{ id: "cari-1", tip: "tedarikci" }]) },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));
    mockFatura.olustur.mockClear();

    await expect(service.gelenOnayla("gelen-1", { satirEslesmeleri: [{ siraNo: 1, stokId: "11111111-1111-4111-8111-111111111111" }] })).rejects.toThrow(/tedarikçi tipinde; iade faturası için müşteri/);
    expect(mockFatura.olustur).not.toHaveBeenCalled();
  });

  describe("gelen ihraç kayıtlı fatura (EBLG-114)", () => {
    const ihracKayitliUbl = (kod: string | null) => GELEN_UBL
      .replace("<cbc:IssueDate>2026-07-20</cbc:IssueDate>", "<cbc:IssueDate>2026-07-20</cbc:IssueDate>\n  <cbc:InvoiceTypeCode>IHRACKAYITLI</cbc:InvoiceTypeCode>")
      .replaceAll(
        "<cac:TaxCategory><cac:TaxScheme>",
        `<cac:TaxCategory>${kod ? `<cbc:TaxExemptionReasonCode>${kod}</cbc:TaxExemptionReasonCode>` : ""}<cac:TaxScheme>`,
      );
    const txKur = (xml: string) => ({
      gelenEbelge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "gelen-1", durum: "beklemede", belgeNo: "GIB2026000000001", gonderenVkn: "1234567890",
          gonderenUnvan: "Tedarikçi A.Ş.", tarih: new Date("2026-07-20"), xmlIcerik: xml,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      stokKart: { findMany: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]) },
      cariHesap: { findFirst: vi.fn().mockResolvedValue({ id: "cari-1" }), findMany: vi.fn().mockResolvedValue([{ id: "cari-1", tip: "tedarikci" }]) },
    });
    const eslesme = { satirEslesmeleri: [{ siraNo: 1, stokId: "11111111-1111-4111-8111-111111111111" }] };

    it("kodu alış faturasına aktarır; KDV cariye girmez", async () => {
      const mockTx = txKur(ihracKayitliUbl("701"));
      mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));
      mockFatura.olustur.mockResolvedValue({ id: "fatura-1", genelToplam: "900.00" });

      await service.gelenOnayla("gelen-1", eslesme);

      expect(mockFatura.olustur).toHaveBeenCalledWith(expect.objectContaining({ tip: "alis", ihracKayitliKodu: "701" }), { gelenBelge: true });
    });

    it("tanınan kodu olmayan ihraç kayıtlı belgeyi işlemez", async () => {
      const mockTx = txKur(ihracKayitliUbl(null));
      mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));
      mockFatura.olustur.mockClear();

      await expect(service.gelenOnayla("gelen-1", eslesme)).rejects.toThrow(/ihraç kayıtlı kodu/);
      expect(mockFatura.olustur).not.toHaveBeenCalled();
    });
  });

  it("gelen taramada entegratörde verilmiş kararı yanıtı olmayan kayda yazar (EBLG-34)", async () => {
    mockAdapter.gelenBelgeleriCek.mockResolvedValueOnce([
      { uuid: "uuid-1", belgeNo: "GIB2026000000001", gonderenVkn: "1234567890", gonderenUnvan: "Tedarikçi A.Ş.", tarih: new Date("2026-07-20"), xml: GELEN_UBL, yanit: { karar: "ret", not: "Portalda reddedildi" } },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const mockTx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "izibiz", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
      gelenEbelge: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: "gelen-1" }), updateMany },
      ebelgeGelenKursor: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      fatura: { create: vi.fn() },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));

    await service.gelenBelgeleriCek();

    const kosul = { tenantId: "t1-uuid", uuid: "uuid-1", yanit: null };
    // Ret yalnız bekleyen belgeyi kapatır; faturaya işlenmiş belgenin durumu korunur.
    expect(updateMany).toHaveBeenCalledWith({ where: { ...kosul, durum: "beklemede" }, data: { durum: "reddedildi" } });
    expect(updateMany).toHaveBeenCalledWith({
      where: kosul,
      data: expect.objectContaining({ yanit: "ret", yanitGerekce: "Portalda reddedildi" }),
    });
  });

  it("gelenYanitGonder entegratörde zaten yanıtlanmış belgeye göndermez, kararı kayda işler (EBLG-34)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const kayit = { id: "gelen-1", uuid: "uuid-1", durum: "beklemede", yanit: null, profilId: "TICARIFATURA", gonderenVkn: "1234567890", xmlIcerik: GELEN_UBL };
    const mockTx = {
      gelenEbelge: { findUnique: vi.fn().mockResolvedValue(kayit), update: vi.fn(), updateMany },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "izibiz", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));
    const adaptor = mockAdapter as typeof mockAdapter & { gelenYanitDurumu?: ReturnType<typeof vi.fn> };
    adaptor.gelenYanitDurumu = vi.fn().mockResolvedValue({ karar: "kabul" });
    mockAdapter.yanitGonder.mockClear();
    try {
      await expect(service.gelenYanitGonder("gelen-1", { yanit: "ret", gerekce: "Hatalı" })).rejects.toThrow(/zaten 'kabul'/);
      expect(adaptor.gelenYanitDurumu).toHaveBeenCalledWith(expect.any(Object), "uuid-1");
      expect(mockAdapter.yanitGonder).not.toHaveBeenCalled();
      expect(updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1-uuid", uuid: "uuid-1", yanit: null }, data: expect.objectContaining({ yanit: "kabul" }) });

      // Sorgu yapılamazsa gönderim sürer: mükerrer yanıtı entegratör reddeder.
      adaptor.gelenYanitDurumu = vi.fn().mockRejectedValue(new Error("NES 500"));
      await service.gelenYanitGonder("gelen-1", { yanit: "kabul" });
      expect(mockAdapter.yanitGonder).toHaveBeenCalledTimes(1);
    } finally {
      delete adaptor.gelenYanitDurumu;
    }
  });

  it("gelenYanitGonder temel faturada kabul/ret kabul etmez, ticaride gönderir (EBLG-06)", async () => {
    const guncelle = vi.fn().mockResolvedValue({});
    const kayit = {
      id: "gelen-1",
      uuid: "uuid-1",
      durum: "beklemede",
      yanit: null,
      profilId: "TEMELFATURA",
    };
    const mockTx = {
      gelenEbelge: { findUnique: vi.fn().mockResolvedValue(kayit), update: guncelle },
      baglanti: {
        findFirst: vi.fn().mockResolvedValue({
          saglayici: "izibiz",
          sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }),
        }),
      },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));

    await expect(
      service.gelenYanitGonder("gelen-1", { yanit: "kabul" }),
    ).rejects.toThrow(/TICARIFATURA/);

    kayit.profilId = "TICARIFATURA";
    await service.gelenYanitGonder("gelen-1", { yanit: "ret", gerekce: "Hatalı tutar" });

    expect(mockAdapter.yanitGonder).toHaveBeenCalledWith(
      expect.any(Object),
      "uuid-1",
      "ret",
      "Hatalı tutar",
      expect.objectContaining({ gonderenVkn: expect.anything(), xml: expect.anything() }),
    );
    expect(guncelle).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          yanit: "ret",
          yanitGerekce: "Hatalı tutar",
          durum: "reddedildi",
        }),
      }),
    );
  });

  it("gelenXmlYukle alıcı VKN eşleşmediğinde hata fırlatır", async () => {
    const mockTx = {
      tenant: { findUnique: vi.fn().mockResolvedValue({ vkn: "9999999999" }) },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));

    const xmlWithAlici = GELEN_UBL.replace(
      "</Invoice>",
      `<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>Farklı Firma</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty></Invoice>`,
    );

    await expect(service.gelenXmlYukle(xmlWithAlici)).rejects.toThrow(
      /bilgisi, firmanızın VKN \(9999999999\) bilgisi ile eşleşmiyor/,
    );
  });

  it("gelenXmlYukle alıcı VKN eşleştiğinde belgeyi kaydeder", async () => {
    const mockTx = {
      tenant: { findUnique: vi.fn().mockResolvedValue({ vkn: "1111111111" }) },
      gelenEbelge: {
        upsert: vi.fn().mockResolvedValue({
          id: "g-xml-1",
          uuid: "uuid-1",
          belgeNo: "GIB2026000000001",
          gonderenVkn: "1234567890",
          gonderenUnvan: "Tedarikçi A.Ş.",
          tarih: new Date("2026-07-20"),
          profilId: "TICARIFATURA",
          durum: "beklemede",
        }),
      },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));

    const xmlWithAlici = GELEN_UBL.replace(
      "</Invoice>",
      `<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>Bizim Firma</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty></Invoice>`,
    );

    const sonuc = await service.gelenXmlYukle(xmlWithAlici);
    expect(sonuc.aliciVkn).toBe("1111111111");
    expect(sonuc.belgeNo).toBe("GIB2026000000001");
  });

  it("gelenTaslakIptalEt taslak faturayı silip belgeyi tekrar beklemede durumuna getirir", async () => {
    const mockTx = {
      gelenEbelge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "g-1",
          durum: "islendi",
          faturaId: "fatura-taslak-1",
          fatura: { id: "fatura-taslak-1", durum: "taslak" },
        }),
      },
    };
    mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(mockTx));

    const sonuc = await service.gelenTaslakIptalEt("g-1");
    expect(mockFatura.sil).toHaveBeenCalledWith("fatura-taslak-1");
    expect(sonuc.basarili).toBe(true);
  });

  describe("KAMU senaryosu", () => {
    const kamuFatura = (ek: Record<string, unknown> = {}) => ({
      id: "fk1",
      tip: "satis",
      senaryo: "satis",
      efaturaProfili: "temel",
      durum: "kesin",
      tarih: new Date(),
      no: "TKR2026000000009",
      cariId: "c-kamu",
      dovizCinsi: "TRY",
      kur: 1,
      toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120, toplamSatirIskontosu: 0, genelIskontoToplam: 0,
      satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, birim: "adet", stok: { kod: "U1", ad: "Ürün 1" } }],
      cari: { vknTckn: "2222222105", unvan: "Kamu İhale Kurumu", kamuIdaresi: true, adresler: [{ tip: "fatura", ulke: "TR", adres: "Mevlana Blv.", il: "Ankara", ilce: "Çankaya", postaKodu: null }] },
      iadeReferanslari: [],
      kamuHarcamaBirimiVkn: null,
      kamuHarcamaBirimiAdi: null,
      kamuIban: null,
      ...ek,
    });
    const tx = (fatura: unknown) => ({
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      fatura: { findUnique: vi.fn().mockResolvedValue(fatura) },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh.", ilce: "Zeytinburnu", il: "İstanbul" }) },
    });

    it("kartta işaretli kamu alıcısında harcama birimi ve IBAN yoksa önizlemez", async () => {
      mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(tx(kamuFatura())));
      await expect(service.onizle("fk1")).rejects.toThrow(/harcama biriminin 10 haneli VKN/);
    });

    it("bilgiler tamsa belgeyi KAMU profiliyle, harcama birimi ve IBAN'la üretir", async () => {
      mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(tx(kamuFatura({
        kamuHarcamaBirimiVkn: "2222222105", kamuHarcamaBirimiAdi: "Destek Hizmetleri", kamuIban: "TR330006100519786457841326",
      }))));
      const belgeOnizle = vi.fn().mockResolvedValue({ basarili: true, html: "<html/>" });
      (mockAdapter as any).belgeOnizle = belgeOnizle;
      try {
        const sonuc = await service.onizle("fk1");
        expect(sonuc.profil).toBe("KAMU");
        const xml = belgeOnizle.mock.calls[0][1].xml as string;
        expect(xml).toContain("<cac:BuyerCustomerParty>");
        expect(xml).toContain("<cbc:ID>TR330006100519786457841326</cbc:ID>");
      } finally {
        delete (mockAdapter as any).belgeOnizle;
      }
    });

    it("kamu alıcısı e-Fatura listesinde yoksa e-Arşiv'e düşürmez, durdurur", async () => {
      mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(tx(kamuFatura({
        kamuHarcamaBirimiVkn: "2222222105", kamuHarcamaBirimiAdi: "Destek Hizmetleri", kamuIban: "TR330006100519786457841326",
      }))));
      mockMukellefListesi.kanalBelirle.mockResolvedValueOnce({ vknTckn: "2222222105", eFaturaMukellefi: false });
      await expect(service.onizle("fk1")).rejects.toThrow(/KAMU senaryosu yalnız e-Fatura/);
    });
  });

  describe("yurt dışındaki tedarikçiye iade", () => {
    const yurtDisiIade = {
      id: "fi1",
      tip: "alis_iade",
      durum: "kesin",
      tarih: new Date(),
      no: null,
      cariId: "c-de",
      satirlar: [{ birim: "adet", kdvOrani: 0, stok: { kod: "U1", ad: "Ürün 1", gtipKodu: "080222100000" } }],
      cari: { vknTckn: null, unvan: "Lieferant GmbH", adresler: [{ tip: "fatura", ulke: "DE", adres: "Hauptstrasse 12", il: "Hamburg", ilce: null, postaKodu: "20095" }] },
      iadeReferanslari: [{ sira: 1, belgeNo: "REA2026000000042", tarih: new Date("2026-01-10"), kaynakFaturaId: null }],
      ihracatTeslimTarihi: new Date(),
      ihracatTeslimSarti: null,
      ihracatTasimaSekli: null,
      gumrukBeyannameNo: null,
      internetSatisi: false,
      ebelge: null,
    };
    const tx = () => ({
      fatura: { findUnique: vi.fn().mockResolvedValue(yurtDisiIade) },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, eirsaliyeMukellefi: false, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh.", ilce: "Zeytinburnu", il: "İstanbul" }) },
    });

    it("sihirbaz ilk adımda durur, ihracat faturasına düşürmez", async () => {
      mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(tx()));
      const bilgi = await service.wizardBilgisi("fi1");
      expect(bilgi.gonderilebilir).toBe(false);
      expect(bilgi.neden).toMatch(/yurt dışındaki tedarikçiye iade e-belge ile kesilmez/);
    });

    it("gönderim ve önizleme sunucuda da reddedilir", async () => {
      mockTenantIslem.mockImplementation((_tenantId: string, cb: any) => cb(tx()));
      await expect(service.gonder("fi1")).rejects.toThrow(/yurt dışındaki tedarikçiye iade/);
      await expect(service.onizle("fi1")).rejects.toThrow(/yurt dışındaki tedarikçiye iade/);
    });
  });

  /**
   * EBLG-77: firmanın kendi kapsamı. e-Fatura uygulamasına kayıtlı olmayan
   * firma, alıcı mükellef olsa bile e-Fatura kesemez; ikisi de kapalıysa belge
   * hiç gönderilmez.
   */
  describe("firma e-belge kapsamı", () => {
    const tx = (firma: Record<string, unknown>) => ({
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "fk1", tip: "satis", durum: "kesin", tarih: new Date(), no: "TKR2026000000031",
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1", tip: "hizmet" } }],
          cari: { vknTckn: "1234567890", unvan: "Müşteri", adresler: [] },
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "izibiz", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", vergiDairesi: "Davutpaşa", adres: "Maltepe Mh.", ilce: "Zeytinburnu", il: "İstanbul", eirsaliyeMukellefi: false, ...firma }) },
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      ebelgeKayit: { create: vi.fn().mockResolvedValue({ id: "eb1" }), update: vi.fn().mockResolvedValue({ id: "eb1" }) },
      ebelgeArsiv: { upsert: vi.fn().mockResolvedValue({}) },
      // Elle belirtilmemiş uygulama için liste sorgusu.
      gibMukellef: { findFirst: vi.fn().mockResolvedValue(null) },
      gibMukellefSenkron: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    it("e-Arşiv kullanıcısında alıcı mükellef olsa bile belge e-Arşiv'e düşer", async () => {
      mockMukellefListesi.kanalBelirle.mockClear();
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb(tx({ efaturaMukellefi: false, earsivMukellefi: true })));

      await expect(service.gonder("fk1")).resolves.toMatchObject({ basarili: true, tur: "earsiv" });
      // Alıcının listesi hiç sorulmaz: kanal satıcının kapsamından çıkar.
      expect(mockMukellefListesi.kanalBelirle).not.toHaveBeenCalled();
    });

    /*
     * EBLG-80: yurt dışı alıcı. Hizmet satışı ya da e-Fatura kullanmayan firma
     * ihracat e-Faturası kesemez; belge e-Arşiv ISTISNA olur, alıcı 2222222222.
     */
    const yurtDisiTx = (firma: Record<string, unknown>, stokTipi: string) => {
      const temel = tx(firma);
      return {
        ...temel,
        fatura: {
          findUnique: vi.fn().mockResolvedValue({
            id: "fk2", tip: "satis", durum: "kesin", tarih: new Date(), no: "TKR2026000000032", senaryo: "istisna",
            toplamBrut: 100, toplamMatrah: 100, toplamKdv: 0, genelToplam: 100,
            dovizCinsi: "TRY", toplamSatirIskontosu: 0,
            satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 0, kdvOrani: 0, birimFiyat: 100, gibIstisnaKodu: null, stok: { kod: "U1", ad: "Kalem 1", tip: stokTipi } }],
            cari: { vknTckn: null, unvan: "Muster GmbH", adresler: [{ tip: "fatura", adres: "Hauptstr. 1", il: "Berlin", ilce: "Mitte", postaKodu: "10115", ulke: "DE" }] },
          }),
        },
      };
    };

    it("yalnız e-Arşiv kullanan firma yurt dışına mal satışını e-Arşiv istisna keser (EBLG-80)", async () => {
      mockAdapter.belgeGonder.mockClear();
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb(yurtDisiTx({ efaturaMukellefi: false, earsivMukellefi: true }, "urun")));

      await expect(service.gonder("fk2")).resolves.toMatchObject({ basarili: true, tur: "earsiv" });
      const { xml } = mockAdapter.belgeGonder.mock.calls[0][1];
      expect(xml).toContain('<cbc:ID schemeID="VKN">2222222222</cbc:ID>');
      expect(xml).toContain("<cbc:InvoiceTypeCode>ISTISNA</cbc:InvoiceTypeCode>");
      expect(xml).toContain("<cbc:TaxExemptionReasonCode>301</cbc:TaxExemptionReasonCode>");
    });

    it("e-Fatura kullanan firmada da yurt dışına hizmet satışı e-Arşiv istisna 302 olur (EBLG-80)", async () => {
      mockAdapter.belgeGonder.mockClear();
      mockMukellefListesi.kanalBelirle.mockClear();
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb(yurtDisiTx({ efaturaMukellefi: true, earsivMukellefi: true }, "hizmet")));

      await expect(service.gonder("fk2")).resolves.toMatchObject({ basarili: true, tur: "earsiv" });
      expect(mockMukellefListesi.kanalBelirle).not.toHaveBeenCalled();
      const { xml } = mockAdapter.belgeGonder.mock.calls[0][1];
      expect(xml).toContain("<cbc:TaxExemptionReasonCode>302</cbc:TaxExemptionReasonCode>");
      expect(xml).not.toContain("IHRACAT");
    });

    it("hiçbir uygulamaya kayıtlı olmayan firmada belge gönderilmez", async () => {
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb(tx({ efaturaMukellefi: false, earsivMukellefi: false })));

      await expect(service.gonder("fk1")).rejects.toThrow(/kağıt olarak düzenlenir/);
    });

    it("e-Fatura durumu bilinmiyorken mükellef alıcıya belge gönderilmez", async () => {
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb(tx({ efaturaMukellefi: null, earsivMukellefi: true })));

      await expect(service.gonder("fk1")).rejects.toThrow(/e-Fatura mükellefiyeti bilinmiyor/);
    });
  });

  /**
   * EBLG-76: sevkiyat denetimi. Firma e-İrsaliye mükellefiyse mal satışında
   * yollardan biri seçilmeden belge gönderilmez; mükellef değilse kural hiç
   * çalışmaz.
   */
  describe("sevkiyat ve irsaliye yerine geçen fatura", () => {
    const tx = (fatura: Record<string, unknown>, firma: Record<string, unknown>) => ({
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "fs1", tip: "satis", durum: "kesin", tarih: new Date(), no: "TKR2026000000021",
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1", tip: "urun" } }],
          cari: { vknTckn: "1234567890", unvan: "Müşteri", adresler: [] },
          ...fatura,
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "izibiz", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114", efaturaMukellefi: true, earsivMukellefi: true, vergiDairesi: "Davutpaşa", adres: "Maltepe Mh.", ilce: "Zeytinburnu", il: "İstanbul", ...firma }) },
      belge: { findMany: vi.fn().mockResolvedValue([]) },
      ebelgeKayit: { create: vi.fn().mockResolvedValue({ id: "eb1" }), update: vi.fn().mockResolvedValue({ id: "eb1" }) },
      ebelgeArsiv: { upsert: vi.fn().mockResolvedValue({}) },
    });

    it("mükellef firmada yol seçilmeden gönderimi durdurur", async () => {
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb(tx({ sevkiyatYontemi: null }, { eirsaliyeMukellefi: true })));

      await expect(service.gonder("fs1")).rejects.toThrow(/Sevkiyatın nasıl belgelendiğini seçin/);
    });

    it("sihirbaz aynı eksiği engel olarak bildirir; gönder ucu kuyruğa almadan durdurur", async () => {
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb({ ...tx({ sevkiyatYontemi: null }, { eirsaliyeMukellefi: true }), belge: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } }));

      const bilgi = await service.wizardBilgisi("fs1");
      expect(bilgi.sevkiyat?.engeller.map((e) => e.mesaj)).toEqual([expect.stringMatching(/Sevkiyatın nasıl belgelendiğini seçin/)]);
    });

    it("mükellef olmayan firmada hiç sormaz", async () => {
      mockAdapter.belgeGonder.mockClear();
      mockTenantIslem.mockImplementation((_t: string, cb: any) => cb(tx({ sevkiyatYontemi: null }, { eirsaliyeMukellefi: false })));

      await expect(service.gonder("fs1")).resolves.toMatchObject({ basarili: true });
    });

    it("irsaliye yerine geçen faturayı ibaresi ve sevk anıyla gönderir", async () => {
      mockAdapter.belgeGonder.mockClear();
      mockTenantIslem.mockImplementation((_t: string, cb: any) =>
        cb(tx({ sevkiyatYontemi: "irsaliye_yerine", fiiliSevkZamani: new Date("2026-09-21T07:45:00+03:00") }, { eirsaliyeMukellefi: true })));

      await expect(service.gonder("fs1")).resolves.toMatchObject({ basarili: true });
      const xml = mockAdapter.belgeGonder.mock.calls[0][1].xml as string;
      expect(xml).toContain("irsaliye yerine geçer");
      expect(xml).toContain("<cbc:ActualDespatchTime>07:45:00</cbc:ActualDespatchTime>");
    });

    it("sevk anı yazılmamış irsaliye yerine faturayı göndermez", async () => {
      mockTenantIslem.mockImplementation((_t: string, cb: any) =>
        cb(tx({ sevkiyatYontemi: "irsaliye_yerine", fiiliSevkZamani: null }, { eirsaliyeMukellefi: true })));

      await expect(service.gonder("fs1")).rejects.toThrow(/fiili sevk tarihi ve saati/);
    });
  });
});

/* ─── Entegratör çağrı disiplini (EBLG-11, 13, 14) ──────────────────────── */

describe("EbelgeService.earsivBelgesiniIptalEt (EBLG-22)", () => {
  const mockTenantIslem = vi.fn();
  const prisma = { tenantIslem: mockTenantIslem } as any;
  const metrics = { increment: vi.fn(), set: vi.fn() } as any;

  function kur(durumSonucu: Record<string, unknown>, gunSayisi = 8) {
    const earsivIptal = vi.fn().mockResolvedValue({ basarili: true, mesaj: "iptal edildi" });
    const adapter = { durumSorgula: vi.fn().mockResolvedValue(durumSonucu), earsivIptal };
    const baglantilar = { adapterCoz: vi.fn().mockReturnValue(adapter) } as any;
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "u" }) }) },
      ebelgeKayit: { update: vi.fn().mockResolvedValue({}) },
    } as any;
    const bildirimler = { uret: vi.fn().mockResolvedValue({}) };
    const ayarlar = { getir: vi.fn().mockResolvedValue({ earsivIptalGunSayisi: gunSayisi }) } as any;
    const service = new EbelgeService(prisma, baglantilar, {} as any, {} as any, metrics, bildirimler as any, ayarlar);
    return { service, tx, earsivIptal, bildirimler, adapter };
  }

  const gunOnce = (gun: number) => new Date(Date.now() - gun * 86_400_000);
  const fatura = { id: "f1", no: "SNC2026000000003", tarih: gunOnce(2), genelToplam: { toFixed: () => "900.00" } as any };
  const ebelge = { id: "eb1", entegratorRef: "EARSIV:x" };

  it("iptal süresi geçmiş faturayı iptal etmez, iade faturasına yönlendirir", async () => {
    // e-Arşiv raporu günlük gidiyor; sınır raporlanma değil süredir.
    const { service, tx, earsivIptal } = kur({ durum: "iletildi", raporlandi: true });

    await expect(service.earsivBelgesiniIptalEt(tx, { ...fatura, tarih: gunOnce(9) }, ebelge)).rejects.toThrow("iade faturası");
    expect(earsivIptal).not.toHaveBeenCalled();
    expect(tx.ebelgeKayit.update).not.toHaveBeenCalled();
  });

  it("geriye tarihli faturada süre gönderim gününden işler", async () => {
    const { service, tx, earsivIptal } = kur({ durum: "iletildi", raporlandi: false });
    await service.earsivBelgesiniIptalEt(tx, { ...fatura, tarih: gunOnce(12) }, { ...ebelge, createdAt: gunOnce(3) });
    expect(earsivIptal).toHaveBeenCalled();
  });

  it("Mevzuat Merkezi süreyi uzatırsa eski faturayı da iptal eder (MVZ-13)", async () => {
    // Süre kiracı ayarı değil, fatura tarihindeki merkezi kanuni değerdir.
    const { service, earsivIptal } = kur({ durum: "iletildi", raporlandi: false });
    const tx = { ...kur({}).tx, mevzuatKayit: { findFirst: vi.fn().mockResolvedValue({ deger: { deger: 30 } }) } };

    await service.earsivBelgesiniIptalEt(tx as never, { ...fatura, tarih: gunOnce(20) }, ebelge);

    expect(tx.mevzuatKayit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tur: "kanuni_deger", anahtar: "earsiv_iptal_gun" }) }));
    expect(earsivIptal).toHaveBeenCalled();
  });

  it("süre içindeki belgeyi iptal eder ve kaydı iptal olarak işaretler", async () => {
    const { service, tx, earsivIptal } = kur({ durum: "iletildi", raporlandi: false });

    await service.earsivBelgesiniIptalEt(tx, fatura, ebelge);

    expect(earsivIptal).toHaveBeenCalled();
    expect(tx.ebelgeKayit.update).toHaveBeenCalledWith({ where: { id: "eb1" }, data: { durum: "iptal", hataMesaji: null } });
  });

  it("raporlanmış belge iptal edilince muhasebeyi bildirimle uyarır", async () => {
    // Raporlanmış olmak iptali engellemez ama iptalin de bildirilmesi gerekir.
    const { service, tx, earsivIptal, bildirimler } = kur({ durum: "iletildi", raporlandi: true });

    await service.earsivBelgesiniIptalEt(tx, fatura, ebelge);

    expect(earsivIptal).toHaveBeenCalled();
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ tur: "ebelge", onem: "uyari" }));
  });

  it("entegratörde zaten iptalse ikinci iptal çağrısı yapmaz, kaydı eşitler", async () => {
    // NES iptal edilmiş belgeyi listede döndürmüyor; ikinci iptal denemesi
    // "belge bulunamadı" diye dönüp gerçek arıza gibi görünüyordu.
    const { service, tx, earsivIptal, bildirimler } = kur({ durum: "iletildi", iptalEdilmis: true, raporlandi: true });

    await service.earsivBelgesiniIptalEt(tx, fatura, ebelge);

    expect(earsivIptal).not.toHaveBeenCalled();
    expect(bildirimler.uret).not.toHaveBeenCalled();
    expect(tx.ebelgeKayit.update).toHaveBeenCalledWith({ where: { id: "eb1" }, data: { durum: "iptal", hataMesaji: null } });
  });

  it("durum sorgusu entegratöre ulaşamazsa iptal çağrısı yapmadan durur (EBLG-39)", async () => {
    // Sorgu okunamazsa belgenin zaten iptal olup olmadığı ve raporlanıp
    // raporlanmadığı bilinemez; körlemesine iptal edilmez.
    const { service, tx, earsivIptal, adapter } = kur({});
    adapter.durumSorgula.mockRejectedValue(new Error("NES 503"));

    await expect(service.earsivBelgesiniIptalEt(tx, fatura, ebelge)).rejects.toThrow("NES 503");
    expect(earsivIptal).not.toHaveBeenCalled();
    expect(tx.ebelgeKayit.update).not.toHaveBeenCalled();
  });

  it("rapora girmemiş belgede bildirim üretilmez", async () => {
    const { service, tx, bildirimler } = kur({ durum: "iletildi", raporlandi: false });

    await service.earsivBelgesiniIptalEt(tx, fatura, ebelge);

    expect(bildirimler.uret).not.toHaveBeenCalled();
  });
});

describe("EbelgeService.gitmemisBelgeyiKapat (EBLG-81)", () => {
  const metrics = { increment: vi.fn(), set: vi.fn() } as any;

  function kur(belgeAra: ReturnType<typeof vi.fn>) {
    const earsivIptal = vi.fn();
    const baglantilar = { adapterCoz: vi.fn().mockReturnValue({ belgeAra, earsivIptal }) } as any;
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "u" }) }) },
      ebelgeKayit: { update: vi.fn().mockResolvedValue({}) },
    } as any;
    const service = new EbelgeService({} as any, baglantilar, {} as any, {} as any, metrics, {} as any, {} as any, {} as any);
    return { service, tx, earsivIptal };
  }

  it("belge entegratörde yoksa kaydı iptal eder, entegratöre iptal göndermez", async () => {
    const belgeAra = vi.fn().mockResolvedValue(undefined);
    const { service, tx, earsivIptal } = kur(belgeAra);

    await service.gitmemisBelgeyiKapat(tx, { id: "f1" }, { id: "eb1", tur: "earsiv" });

    expect(belgeAra).toHaveBeenCalledWith(expect.anything(), "f1", "earsiv");
    expect(tx.ebelgeKayit.update).toHaveBeenCalledWith({ where: { id: "eb1" }, data: { durum: "iptal" } });
    expect(earsivIptal).not.toHaveBeenCalled();
  });

  it("belge entegratörde oluşmuşsa durur", async () => {
    const { service, tx } = kur(vi.fn().mockResolvedValue({ basarili: true, belgeRef: "x", belgeNo: "SNC2026000000009" }));

    await expect(service.gitmemisBelgeyiKapat(tx, { id: "f1" }, { id: "eb1", tur: "earsiv" })).rejects.toThrow("SNC2026000000009");
    expect(tx.ebelgeKayit.update).not.toHaveBeenCalled();
  });

  it("sorgu çalışmazsa körlemesine iptal etmez", async () => {
    const { service, tx } = kur(vi.fn().mockRejectedValue(new Error("zaman aşımı")));

    await expect(service.gitmemisBelgeyiKapat(tx, { id: "f1" }, { id: "eb1", tur: "efatura" })).rejects.toThrow("kontrol edilemedi");
    expect(tx.ebelgeKayit.update).not.toHaveBeenCalled();
  });
});

describe("EbelgeService — çağrı disiplini", () => {
  const cfg = JSON.stringify({ kullaniciAdi: "test" });

  function kur(tx: Record<string, any>, adapter: Record<string, any>) {
    const tenantIslem = vi.fn((_tenantId: string, cb: any) => cb(tx));
    const prisma = { tenantIslem } as any;
    const metrics = { increment: vi.fn(), set: vi.fn() } as any;
    const mukellefListesi = { kanalBelirle: vi.fn() } as any;
    const bildirimler = { uret: vi.fn().mockResolvedValue({ bildirimId: "b1", yeniTeslimat: 1 }) } as any;
    const service = new EbelgeService(
      prisma,
      { adapterCoz: () => adapter } as any,
      {} as any,
      mukellefListesi,
      metrics,
      bildirimler,
    );
    return { service, metrics, bildirimler };
  }

  it("gelen belgeleri kursörden ister ve kursörü çekim sonrası ilerletir (EBLG-11)", async () => {
    const kursorAn = new Date("2026-09-05T08:00:00Z");
    const gelenZarflariCek = vi.fn().mockResolvedValue({ belgeler: [], yanitlar: [] });
    const kursorUpsert = vi.fn();
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "sovos", sifreliConfig: cfg }) },
      ebelgeGelenKursor: { findUnique: vi.fn().mockResolvedValue({ sonCekimAt: kursorAn }), upsert: kursorUpsert },
      gelenEbelge: { findUnique: vi.fn(), upsert: vi.fn() },
    };
    const { service } = kur(tx, { gelenZarflariCek });

    await service.gelenBelgeleriCek();

    expect(gelenZarflariCek.mock.calls[0][1].baslangic).toEqual(kursorAn);
    const yeniKursor = kursorUpsert.mock.calls[0][0].update.sonCekimAt as Date;
    expect(yeniKursor.getTime()).toBeGreaterThan(kursorAn.getTime());
  });

  it("kursör yokken 30 gün değil dar bir ilk pencere açar", async () => {
    const gelenZarflariCek = vi.fn().mockResolvedValue({ belgeler: [], yanitlar: [] });
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "sovos", sifreliConfig: cfg }) },
      ebelgeGelenKursor: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      gelenEbelge: { findUnique: vi.fn(), upsert: vi.fn() },
    };
    const { service } = kur(tx, { gelenZarflariCek });

    await service.gelenBelgeleriCek();

    const gunSayisi = (Date.now() - gelenZarflariCek.mock.calls[0][1].baslangic.getTime()) / 86_400_000;
    expect(gunSayisi).toBeLessThan(8);
  });

  it("alıcı yanıtını faturaya yazar ama zarfın durumuna dokunmaz (EBLG-13)", async () => {
    const guncelle = vi.fn();
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "sovos", sifreliConfig: cfg }) },
      ebelgeGelenKursor: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      gelenEbelge: { findUnique: vi.fn(), upsert: vi.fn() },
      fatura: { findFirst: vi.fn().mockResolvedValue({ id: "f9" }) },
      ebelgeKayit: { findUnique: vi.fn().mockResolvedValue({ id: "eb9", aliciYanitRef: null }), update: guncelle },
    };
    const adapter = {
      gelenZarflariCek: vi.fn().mockResolvedValue({
        belgeler: [],
        yanitlar: [{ uuid: "y-1", faturaUuid: "f9", yanit: "ret", gerekce: "Miktar hatalı", tarih: new Date("2026-09-04") }],
      }),
    };

    const { service, bildirimler } = kur(tx, adapter);
    const sonuc = await service.gelenBelgeleriCek();

    expect(sonuc.islenenAliciYaniti).toBe(1);
    const veri = guncelle.mock.calls[0][0].data;
    expect(veri).toEqual(expect.objectContaining({ aliciYaniti: "ret", aliciYanitNotu: "Miktar hatalı", aliciYanitRef: "y-1" }));
    expect(veri).not.toHaveProperty("durum");
    // Ret iade faturası gerektirir; sahiplenilmesi için kritik bildirim üretir.
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ onem: "kritik", tur: "ebelge" }));
  });

  it("aynı alıcı yanıtını ikinci kez işlemez", async () => {
    const guncelle = vi.fn();
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "sovos", sifreliConfig: cfg }) },
      ebelgeGelenKursor: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      gelenEbelge: { findUnique: vi.fn(), upsert: vi.fn() },
      fatura: { findFirst: vi.fn().mockResolvedValue({ id: "f9" }) },
      ebelgeKayit: { findUnique: vi.fn().mockResolvedValue({ id: "eb9", aliciYanitRef: "y-1" }), update: guncelle },
    };
    const { service } = kur(tx, {
      gelenZarflariCek: vi.fn().mockResolvedValue({
        belgeler: [],
        yanitlar: [{ uuid: "y-1", faturaUuid: "f9", yanit: "kabul", tarih: new Date() }],
      }),
    });

    const sonuc = await service.gelenBelgeleriCek();

    expect(sonuc.islenenAliciYaniti).toBe(0);
    expect(guncelle).not.toHaveBeenCalled();
  });

  it("bekleyen zarfları tek toplu çağrıyla sorar ve sorgu anını işaretler (EBLG-14)", async () => {
    const durumSorgulaToplu = vi.fn().mockResolvedValue([
      { belgeRef: "zarf-a", durum: "kabul", detay: "Kabul" },
      { belgeRef: "zarf-b", durum: "iletildi" },
    ]);
    const durumSorgula = vi.fn();
    const guncelle = vi.fn();
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "sovos", sifreliConfig: cfg }) },
      ebelgeKayit: {
        findMany: vi.fn().mockResolvedValue([
          { id: "eb-a", entegratorRef: "zarf-a" },
          { id: "eb-b", entegratorRef: "zarf-b" },
        ]),
        update: guncelle,
      },
    };
    const { service } = kur(tx, { durumSorgulaToplu, durumSorgula });

    const sonuc = await service.durumlariTopluSorgula();

    expect(durumSorgulaToplu).toHaveBeenCalledOnce();
    expect(durumSorgula).not.toHaveBeenCalled();
    expect(sonuc).toEqual({ sorgulanan: 2, guncellenen: 2, atlanan: 0 });
    expect(guncelle.mock.calls[0][0].data.sonDurumSorguAt).toBeInstanceOf(Date);
    // Başarı açıklaması ekranda uyarı kutusuna düşmesin.
    expect(guncelle.mock.calls[0][0].data.hataMesaji).toBeNull();
  });

  it("e-Arşiv referansını zarf sorgusuna karıştırmaz", async () => {
    const durumSorgulaToplu = vi.fn().mockResolvedValue([]);
    const durumSorgula = vi.fn().mockResolvedValue({ belgeRef: "EARSIV:u1", durum: "kabul" });
    const tx = {
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "sovos", sifreliConfig: cfg }) },
      ebelgeKayit: {
        findMany: vi.fn().mockResolvedValue([
          { id: "eb-a", entegratorRef: "zarf-a" },
          { id: "eb-e", entegratorRef: "EARSIV:u1" },
        ]),
        update: vi.fn(),
      },
    };
    const { service } = kur(tx, { durumSorgulaToplu, durumSorgula });

    await service.durumlariTopluSorgula();

    expect(durumSorgulaToplu).toHaveBeenCalledWith(expect.any(Object), ["zarf-a"]);
    expect(durumSorgula).toHaveBeenCalledWith(expect.any(Object), "EARSIV:u1");
  });

  const nesBaglanti = { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: cfg }) };
  const earsivKaydi = (durum: string) => ({ id: "eb-1", faturaId: "f-1", durum, entegratorRef: "EARSIV:u1", aliciYanitNotu: null });

  it("toplu sorguda ulaşılamayan belgeyi hataya çevirmez, diğerlerini günceller (EBLG-39)", async () => {
    const durumSorgula = vi.fn()
      .mockRejectedValueOnce(new Error("NES 503"))
      .mockResolvedValueOnce({ belgeRef: "EARSIV:u2", durum: "iletildi" });
    const guncelle = vi.fn();
    const tx = {
      baglanti: nesBaglanti,
      ebelgeKayit: {
        findMany: vi.fn().mockResolvedValue([earsivKaydi("iletildi"), { ...earsivKaydi("iletildi"), id: "eb-2", faturaId: "f-2", entegratorRef: "EARSIV:u2" }]),
        update: guncelle,
      },
    };
    const { service } = kur(tx, { durumSorgula });

    await expect(service.durumlariTopluSorgula()).resolves.toEqual({ sorgulanan: 2, guncellenen: 1, atlanan: 1 });
    expect(guncelle).toHaveBeenCalledOnce();
    expect(guncelle.mock.calls[0][0].where).toEqual({ id: "eb-2" });
  });

  it("tekil sorguda entegratör hatasını kullanıcıya söyler, kayda dokunmaz (EBLG-39)", async () => {
    const guncelle = vi.fn();
    const tx = { baglanti: nesBaglanti, ebelgeKayit: { findUnique: vi.fn().mockResolvedValue(earsivKaydi("iletildi")), update: guncelle } };
    const { service } = kur(tx, { durumSorgula: vi.fn().mockRejectedValue(new Error("NES 503")) });

    await expect(service.durumSorgula("f-1")).rejects.toThrow("NES 503");
    expect(guncelle).not.toHaveBeenCalled();
  });

  it("entegratörde iptal edilmiş belgeyi iptal yapar, faturayı iptal etmeden haber verir (EBLG-39)", async () => {
    const guncelle = vi.fn().mockResolvedValue({});
    const faturaGuncelle = vi.fn();
    const tx = {
      baglanti: nesBaglanti,
      ebelgeKayit: { findUnique: vi.fn().mockResolvedValue(earsivKaydi("iletildi")), update: guncelle },
      fatura: { findUnique: vi.fn().mockResolvedValue({ no: "NES2026000000007", durum: "kesin" }), update: faturaGuncelle },
    };
    const { service, bildirimler } = kur(tx, {
      durumSorgula: vi.fn().mockResolvedValue({ belgeRef: "EARSIV:u1", durum: "iletildi", detay: "Belge NES'te iptal edilmiş", iptalEdilmis: true }),
    });

    await service.durumSorgula("f-1");

    expect(guncelle.mock.calls[0][0].data.durum).toBe("iptal");
    expect(faturaGuncelle).not.toHaveBeenCalled();
    expect(bildirimler.uret).toHaveBeenCalledWith(expect.objectContaining({ kaynakRef: "f-1", birlesimAnahtari: "earsiv-entegrator-iptal:f-1" }));
  });

  it("iptal edilmiş kaydı yeniden sorgulamaz (EBLG-39)", async () => {
    const durumSorgula = vi.fn();
    const tx = { baglanti: nesBaglanti, ebelgeKayit: { findUnique: vi.fn().mockResolvedValue(earsivKaydi("iptal")), update: vi.fn() } };
    const { service } = kur(tx, { durumSorgula });

    await service.durumSorgula("f-1");

    expect(durumSorgula).not.toHaveBeenCalled();
  });

  it("elle tazeleme saatlik sınıra takılır (EBLG-11)", async () => {
    const tx = {
      ebelgeGelenKursor: {
        findUnique: vi.fn().mockResolvedValue({ sonCekimAt: new Date(), sonTetiklemeAt: new Date(Date.now() - 10 * 60_000) }),
        upsert: vi.fn(),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ id: "b-1" }) },
    };
    const { service } = kur(tx, {});
    vi.stubEnv("EBLG_ELLE_TAZELEME_ARALIK_MS", "3600000");
    try {
      await expect(service.elleTazelemeIzniAl()).rejects.toThrow(/saatte bir tazelenebilir/);
      expect(tx.ebelgeGelenKursor.upsert).not.toHaveBeenCalled();
      // Aralık `.env`'den kullanım anında okunur; kısaltılmış aralıkta 10 dk önceki tetikleme engel değildir.
      vi.stubEnv("EBLG_ELLE_TAZELEME_ARALIK_MS", "300000");
      await expect(service.elleTazelemeIzniAl()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("bir saat geçtiyse elle tazelemeye izin verir ve tetikleme anını işaretler", async () => {
    const upsert = vi.fn();
    const tx = {
      ebelgeGelenKursor: {
        findUnique: vi.fn().mockResolvedValue({ sonCekimAt: new Date(), sonTetiklemeAt: new Date(Date.now() - 90 * 60_000) }),
        upsert,
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ id: "b-1" }) },
    };
    const { service } = kur(tx, {});

    await service.elleTazelemeIzniAl();

    expect(upsert.mock.calls[0][0].update.sonTetiklemeAt).toBeInstanceOf(Date);
  });

  it("aktif bağlantı yoksa elle tazelemeyi sebebiyle reddeder, iş açılmaz (EBLG-98)", async () => {
    const upsert = vi.fn();
    const tx = {
      ebelgeGelenKursor: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      baglanti: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const { service } = kur(tx, {});

    await expect(service.elleTazelemeIzniAl()).rejects.toThrow(/Aktif e-belge bağlantısı yok/);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("gonderimTarihiGecerliMi", () => {
  const an = (metin: string) => new Date(metin);
  const gun = (metin: string) => new Date(`${metin}T00:00:00.000Z`);

  it("Türkiye'de gün dönmüşken bugünkü faturayı kabul eder (UTC'de hâlâ dün)", () => {
    // 20 Eylül 00:28 (TSİ) = 19 Eylül 21:28 UTC.
    expect(gonderimTarihiGecerliMi(gun("2026-09-20"), an("2026-09-19T21:28:00Z"))).toBe(true);
  });

  it("yarının faturasını kabul etmez", () => {
    expect(gonderimTarihiGecerliMi(gun("2026-09-21"), an("2026-09-19T21:28:00Z"))).toBe(false);
  });

  it("yedi günden eskisini kabul etmez, tam yedi günü kabul eder", () => {
    expect(gonderimTarihiGecerliMi(gun("2026-09-13"), an("2026-09-20T09:00:00Z"))).toBe(true);
    expect(gonderimTarihiGecerliMi(gun("2026-09-12"), an("2026-09-20T09:00:00Z"))).toBe(false);
  });
});
