import { describe, expect, it, vi } from "vitest";
import { EbelgeService } from "./ebelge.service";
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

  it("UBL olmayan içerikte hata fırlatır", () => {
    expect(() => faturaUblOku("<Baska></Baska>")).toThrow(/Invoice kökü/);
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
  };

  const mockBaglantilar = {
    adapterCoz: vi.fn().mockReturnValue(mockAdapter),
  } as any;

  const mockFatura = {
    olustur: vi.fn(),
    sil: vi.fn(),
  } as any;

  const service = new EbelgeService(mockPrisma, mockBaglantilar, mockFatura);

  it("gonder alıcının e-Fatura mükellefiyetini sorgular, UBL uretir ve gönderir (EBLG-01/02/03)", async () => {
    const mockTx = {
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
          cari: { vknTckn: "1234567890", unvan: "Müşteri" },
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
        findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114" }),
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

    expect(mockAdapter.mukellefSorgula).toHaveBeenCalledWith(
      expect.any(Object),
      "1234567890",
    );
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
        findFirst: vi.fn().mockResolvedValue({ id: "cari-1" }),
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
    );
    expect(guncelle).toHaveBeenCalledWith({
      where: { id: "gelen-1" },
      data: { durum: "islendi", faturaId: "fatura-1" },
    });
    expect(sonuc.faturaId).toBe("fatura-1");
    expect(sonuc.toplamFarki).toBeNull(); // belge toplamı ile hesaplanan uyuşuyor
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
});
