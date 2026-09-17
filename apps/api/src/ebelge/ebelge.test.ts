import { describe, expect, it, vi } from "vitest";
import { EbelgeService } from "./ebelge.service";
import { VARSAYILAN_TEMA } from "../core/pdf/belge-temasi";
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
  } as any;
  const mockMetrics = { increment: vi.fn(), set: vi.fn() } as any;

  const mockBildirimler = { uret: vi.fn() } as any;

  const mockPdf = { belgeTemasi: vi.fn().mockResolvedValue(VARSAYILAN_TEMA) } as any;
  const service = new EbelgeService(mockPrisma, mockBaglantilar, mockFatura, mockMukellefListesi, mockMetrics, mockBildirimler, undefined as any, mockPdf);

  it("gonder kanalı lokal mükellef listesinden belirler, UBL uretir ve gönderir (EBLG-01/02/03/10)", async () => {
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

    // Kanal kararı lokal listeden verilir; entegratöre gönderim başına
    // mükellef sorgusu gitmez (EBLG-10).
    expect(mockMukellefListesi.kanalBelirle).toHaveBeenCalledWith(
      "izibiz",
      expect.any(Object),
      "1234567890",
    );
    expect(mockAdapter.mukellefSorgula).not.toHaveBeenCalled();
    expect(mockAdapter.belgeGonder).toHaveBeenCalled();
    // FTR-25: gönderilen belgenin gömülü görünümü kiracının temasıyla üretilir.
    expect(mockPdf.belgeTemasi).toHaveBeenCalled();
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
   * Entegratör test ortamlarının sentetik kimlikleri VKN kontrol hanesini
   * tutmaz. Kural gönderen için zaten gevşetiliyordu; alıcı için de aynı
   * olmalı — o kimliklerden belge alıp onlara belge kesememek tutarsızdı.
   */
  function sentetikVknTx(testOrtami: boolean) {
    return {
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1", tip: "satis", durum: "kesin", tarih: new Date(), no: null,
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          // GİB sandbox kimliği: kontrol hanesi tutmaz.
          cari: { vknTckn: "1234567801", unvan: "Test Kurum" },
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "t", testOrtami }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      // Gönderen VKN'si geçerli: böylece test yalnız alıcı kuralını ölçer.
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114" }) },
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
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1", tip: "satis", durum: "kesin", tarih: new Date(), no: "TKR2026000000001",
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          cari: { vknTckn: "1234567890", unvan: "Müşteri" },
          ebelge,
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify({ kullaniciAdi: "test" }) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114" }) },
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
      fatura: {
        findUnique: vi.fn().mockResolvedValue({
          id: "f1", tip: "satis", durum: "kesin", tarih: new Date(), no: null,
          toplamBrut: 100, toplamMatrah: 100, toplamKdv: 20, genelToplam: 120,
          dovizCinsi: "TRY", toplamSatirIskontosu: 0,
          satirlar: [{ miktar: 1, matrah: 100, iskontoTutari: 0, kdvTutari: 20, kdvOrani: 20, birimFiyat: 100, stok: { kod: "U1", ad: "Ürün 1" } }],
          cari: { vknTckn: "10000000078", unvan: "Ayşe Yılmaz" },
          ebelge: null,
        }),
      },
      baglanti: { findFirst: vi.fn().mockResolvedValue({ saglayici: "nes", sifreliConfig: JSON.stringify(config) }) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      tenant: { findUnique: vi.fn().mockResolvedValue({ unvan: "Bizim Firma", vkn: "1111111114" }) },
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
    const service = new EbelgeService(prisma, baglantilar, {} as any, {} as any, metrics, bildirimler as any, ayarlar, { belgeTemasi: vi.fn().mockResolvedValue(VARSAYILAN_TEMA) } as any);
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

  it("süre ayarı uzatılırsa eski faturayı da iptal eder", async () => {
    // Süre tebliğ metninden değil sektör kaynağından geldi; ayarlanabilir.
    const { service, earsivIptal } = kur({ durum: "iletildi", raporlandi: false }, 30);

    await service.earsivBelgesiniIptalEt(kur({}, 30).tx, { ...fatura, tarih: gunOnce(20) }, ebelge);

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
      undefined as any,
      { belgeTemasi: vi.fn().mockResolvedValue(VARSAYILAN_TEMA) } as any,
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
    };
    const { service } = kur(tx, {});

    await expect(service.elleTazelemeIzniAl()).rejects.toThrow(/saatte bir tazelenebilir/);
    expect(tx.ebelgeGelenKursor.upsert).not.toHaveBeenCalled();
  });

  it("bir saat geçtiyse elle tazelemeye izin verir ve tetikleme anını işaretler", async () => {
    const upsert = vi.fn();
    const tx = {
      ebelgeGelenKursor: {
        findUnique: vi.fn().mockResolvedValue({ sonCekimAt: new Date(), sonTetiklemeAt: new Date(Date.now() - 90 * 60_000) }),
        upsert,
      },
    };
    const { service } = kur(tx, {});

    await service.elleTazelemeIzniAl();

    expect(upsert.mock.calls[0][0].update.sonTetiklemeAt).toBeInstanceOf(Date);
  });
});
