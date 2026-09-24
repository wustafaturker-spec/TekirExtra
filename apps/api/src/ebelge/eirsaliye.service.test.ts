import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import { EirsaliyeService, eirsaliyeSorguKosulu } from "./eirsaliye.service";

/**
 * Üretilen DespatchAdvice'ın yapısı. Aşağıdaki kuralların hepsi NES test
 * ortamında gerçek reddedilme sebebiydi (2026-09-10): eleman sırası, e-Fatura
 * profilinin yazılması, eksik teslimat adresi ve eksik taşıyan bilgisi.
 */
describe("EirsaliyeService UBL", () => {
  const ubl = (belge: unknown) =>
    (EirsaliyeService.prototype as unknown as { ubl: (b: unknown, t: unknown) => string }).ubl.call(
      Object.create(EirsaliyeService.prototype),
      belge,
      { unvan: "Satıcı A.Ş.", vkn: "1234567801" },
    );

  const belge = {
    id: "11111111-1111-4111-8111-111111111111",
    no: "GBZ2026000800001",
    tarih: "2026-09-10",
    createdAt: new Date("2026-09-10T15:30:00Z"),
    cari: {
      unvan: "Alıcı A.Ş.", vknTckn: "1230460944",
      adresler: [{ tip: "merkez", adres: "OSB 3. Cadde No:7", il: "Denizli", ilce: "Honaz", postaKodu: "20330", ulke: "TR" }],
    },
    teslimatAdresi: { adres: "OSB 3. Cadde No:7", il: "Denizli", ilce: "Honaz", postaKodu: "20330" },
    fiiliSevkZamani: new Date("2026-09-10T07:45:00+03:00"),
    plaka: "34 ABC 123",
    dorsePlaka: "34 DR 4088",
    soforAdi: "Mehmet",
    soforSoyadi: "Öztürk",
    soforTckn: "10000000078",
    satirlar: [{ miktar: "5", stok: { ad: "Ürün", kod: "STK-1" } }],
  };

  it("gönderen, imza ve kendi taşımamızda firma kartındaki adresi yazar (EBLG-62)", () => {
    const xml = (EirsaliyeService.prototype as unknown as { ubl: (b: unknown, t: unknown) => string }).ubl.call(
      Object.create(EirsaliyeService.prototype),
      belge,
      { unvan: "Satıcı A.Ş.", vkn: "1234567801", adres: "Maltepe Mh. No:7", ilce: "Zeytinburnu", il: "İstanbul", postaKodu: "34010" },
    );
    const gonderen = xml.slice(xml.indexOf("<cac:DespatchSupplierParty>"), xml.indexOf("</cac:DespatchSupplierParty>"));
    expect(gonderen).toContain("<cbc:StreetName>Maltepe Mh. No:7</cbc:StreetName>");
    expect(gonderen).toContain("<cbc:CitySubdivisionName>Zeytinburnu</cbc:CitySubdivisionName>");
    const tasiyan = xml.slice(xml.indexOf("<cac:CarrierParty>"), xml.indexOf("</cac:CarrierParty>"));
    expect(tasiyan).toContain("<cbc:CityName>İstanbul</cbc:CityName>");
    expect(xml).not.toContain(">Merkez<");
  });

  it("profili ve belge türünü ayrı alanlara yazar", () => {
    const xml = ubl(belge);

    // `SEVK` belgenin türüdür, profili değil.
    expect(xml).toContain("<cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>");
    expect(xml).toContain("<cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode>");
  });

  // GİB İDİS Teknik Kılavuzu v1.0 §3 (EBLG-72).
  it("İDİS irsaliyesinde profili, sevkiyat ve etiket numaralarını yazar", () => {
    const xml = ubl({
      ...belge,
      idisSevkiyatNo: "se-1345840",
      satirlar: [{ miktar: "5", idisEtiketNo: "cv0152457", stok: { ad: "10 mm İnşaat Demiri", kod: "DEMIR-10" } }],
    });

    expect(xml).toContain("<cbc:ProfileID>IDISIRSALIYE</cbc:ProfileID>");
    const gonderen = xml.slice(xml.indexOf("<cac:DespatchSupplierParty>"), xml.indexOf("</cac:DespatchSupplierParty>"));
    expect(gonderen).toContain('<cbc:ID schemeID="SEVKIYATNO">SE-1345840</cbc:ID>');
    expect(xml).toContain('<cac:AdditionalItemIdentification><cbc:ID schemeID="ETIKETNO">CV0152457</cbc:ID></cac:AdditionalItemIdentification>');
  });

  it("sevkiyat numarası yoksa irsaliye İDİS alanlarını taşımaz", () => {
    const xml = ubl(belge);
    expect(xml).toContain("<cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>");
    expect(xml).not.toContain("SEVKIYATNO");
    expect(xml).not.toContain("ETIKETNO");
  });

  // Sipariş referansı (EBLG-74); GİB `DespatchAdvice.xml` sırasına göre
  // DespatchAdviceTypeCode ile AdditionalDocumentReference arasında durur.
  it("belgeye girilen sipariş referansını yazar", () => {
    const xml = ubl({ ...belge, siparisNo: "SIP-2026-993", siparisTarihi: "2026-09-15" });
    expect(xml).toContain("<cac:OrderReference><cbc:ID>SIP-2026-993</cbc:ID><cbc:IssueDate>2026-09-15</cbc:IssueDate></cac:OrderReference>");
    expect(xml.indexOf("<cac:OrderReference>")).toBeGreaterThan(xml.indexOf("<cbc:LineCountNumeric>"));
    expect(xml.indexOf("<cac:OrderReference>")).toBeLessThan(xml.indexOf("<cac:Signature>"));
  });

  it("elle girilmediyse zincirdeki siparişin numarasını ve tarihini kullanır", () => {
    const xml = ubl({ ...belge, kaynakBelge: { tur: "siparis", no: "SIP2026000006", tarih: "2026-09-18" } });
    expect(xml).toContain("<cbc:ID>SIP2026000006</cbc:ID><cbc:IssueDate>2026-09-18</cbc:IssueDate>");
  });

  it("sipariş tarihi yoksa belgenin tarihine düşer — UBL-TR tarihi zorunlu tutuyor", () => {
    const xml = ubl({ ...belge, siparisNo: "SIP-2026-994" });
    expect(xml).toContain("<cbc:ID>SIP-2026-994</cbc:ID><cbc:IssueDate>2026-09-10</cbc:IssueDate>");
  });

  it("sipariş referansı yoksa bloğu hiç yazmaz", () => {
    expect(ubl(belge)).not.toContain("OrderReference");
  });

  it("önce düzenlenen faturanın numara ve tarihini e-İrsaliyeye yazar", () => {
    const xml = ubl({ ...belge, fatura: { no: "FTR2026000000001", tarih: new Date("2026-09-09") } });
    expect(xml).toContain("<cbc:ID>FTR2026000000001</cbc:ID><cbc:IssueDate>2026-09-09</cbc:IssueDate><cbc:DocumentType>FATURA</cbc:DocumentType>");
    expect(xml.indexOf("<cac:AdditionalDocumentReference>")).toBeLessThan(xml.indexOf("<cac:Signature>"));
  });

  it("alıcı tarafına karttaki adresi yazar (EBLG-55)", () => {
    const alici = ubl(belge).match(/<cac:DeliveryCustomerParty>[\s\S]*?<\/cac:DeliveryCustomerParty>/)![0];

    expect(alici).toContain("<cbc:CityName>Denizli</cbc:CityName>");
    expect(alici).toContain("<cbc:CitySubdivisionName>Honaz</cbc:CitySubdivisionName>");
    expect(alici).toContain("<cbc:PostalZone>20330</cbc:PostalZone>");
    expect(alici).not.toContain("Istanbul");
  });

  it("UBL-TR eleman sırasını korur", () => {
    const xml = ubl(belge);
    const sira = ["<cbc:ProfileID>", "<cbc:ID>", "<cbc:CopyIndicator>", "<cbc:UUID>", "<cbc:IssueDate>", "<cac:DespatchSupplierParty>", "<cac:DeliveryCustomerParty>", "<cac:Shipment>", "<cac:DespatchLine>"];

    const yerler = sira.map((e) => xml.indexOf(e));
    expect(yerler.every((y) => y >= 0)).toBe(true);
    expect([...yerler].sort((a, b) => a - b)).toEqual(yerler);
  });

  it("teslimat adresini ve taşıyanı bildirir", () => {
    const gonderi = ubl(belge).match(/<cac:Shipment>[\s\S]*?<\/cac:Shipment>/)![0];

    expect(gonderi).toContain("<cbc:CitySubdivisionName>Honaz</cbc:CitySubdivisionName>");
    expect(gonderi).toContain("<cbc:CityName>Denizli</cbc:CityName>");
    // Posta kodu ve taşıyan olmadan şematron belgeyi geçirmiyor.
    expect(gonderi).toContain("<cbc:PostalZone>20330</cbc:PostalZone>");
    expect(gonderi).toContain("<cac:CarrierParty>");
  });

  it("fiili sevk zamanını belgeden alır, kaydın oluşturulma anından değil", () => {
    // Sevk zamanı yanlış yazılırsa belge yanlış saatte yola çıkmış görünür.
    const gonderi = ubl(belge).match(/<cac:Despatch>[\s\S]*?<\/cac:Despatch>/)![0];

    expect(gonderi).toContain("<cbc:ActualDespatchDate>2026-09-10</cbc:ActualDespatchDate>");
    expect(gonderi).toContain("<cbc:ActualDespatchTime>07:45:00</cbc:ActualDespatchTime>");
  });

  it("şoförü, plakayı ve dorseyi taşıma alanlarına yazar; plakayı GİB biçimine getirir", () => {
    // Şematron 14.09.2026 §3: plaka boşluksuz ve büyük harf olmalı.
    const xml = ubl(belge);

    expect(xml).toContain(`<cbc:LicensePlateID schemeID="PLAKA">34ABC123</cbc:LicensePlateID>`);
    expect(xml).toContain("<cbc:FirstName>Mehmet</cbc:FirstName>");
    expect(xml).toContain("<cbc:NationalityID>10000000078</cbc:NationalityID>");
    expect(xml).toContain(`<cbc:ID schemeID="DORSEPLAKA">34DR4088</cbc:ID>`);
  });

  it("satır birimini GİB birim koduna çevirir", () => {
    const kiloluk = { ...belge, satirlar: [{ ...belge.satirlar[0], birim: "kg" }] };
    expect(ubl(kiloluk)).toContain('<cbc:DeliveredQuantity unitCode="KGM">');
    expect(ubl(belge)).toContain('<cbc:DeliveredQuantity unitCode="C62">');
  });

  it("yabancı plakayı kendi schemeID'siyle bildirir", () => {
    const xml = ubl({ ...belge, plaka: "AFK-159", dorsePlaka: "BG_77" });

    expect(xml).toContain(`<cbc:LicensePlateID schemeID="YABANCIPLAKA">AFK-159</cbc:LicensePlateID>`);
    expect(xml).toContain(`<cbc:ID schemeID="YABANCIDORSEPLAKA">BG_77</cbc:ID>`);
  });

  it("taşıyıcı seçilmediyse taşıyan firmanın kendisidir", () => {
    const gonderi = ubl(belge).match(/<cac:CarrierParty>[\s\S]*?<\/cac:CarrierParty>/)![0];

    expect(gonderi).toContain("Satıcı A.Ş.");
    expect(gonderi).toContain(`<cbc:ID schemeID="VKN">1234567801</cbc:ID>`);
  });

  it("taşıyıcı cari seçildiyse taşıyan o firmadır", () => {
    // Kargoyla giden malda kendi firmamızı taşıyan yazmak belgeyi yanlışlar.
    const gonderi = ubl({ ...belge, tasiyiciCari: { unvan: "Hızlı Nakliyat Ltd.", vknTckn: "4620553774" } })
      .match(/<cac:CarrierParty>[\s\S]*?<\/cac:CarrierParty>/)![0];

    expect(gonderi).toContain("Hızlı Nakliyat Ltd.");
    expect(gonderi).toContain(`<cbc:ID schemeID="VKN">4620553774</cbc:ID>`);
  });

  it("şoför ve plaka yoksa taşıma aşaması hiç yazılmaz", () => {
    const xml = ubl({ ...belge, plaka: null, dorsePlaka: null, soforAdi: null, soforSoyadi: null, soforTckn: null });

    expect(xml).not.toContain("<cac:ShipmentStage>");
    expect(xml).not.toContain("<cac:TransportHandlingUnit>");
  });

  it("satırda sipariş satırı referansını atlamaz", () => {
    // Şemada `cac:OrderLineReference` zorunlu; yoksa XSD kontrolü düşer.
    const satir = ubl(belge).match(/<cac:DespatchLine>[\s\S]*?<\/cac:DespatchLine>/)![0];

    expect(satir.indexOf("<cac:OrderLineReference>")).toBeLessThan(satir.indexOf("<cac:Item>"));
  });
});

describe("EirsaliyeService.topluGonder (EBLG-43)", () => {
  /** `gonder` dışındaki her şeyi sahteleyip toplu akışı tek başına ölçer. */
  function servisKur(gonderSonuclari: Record<string, "ok" | string>) {
    const numaralar = Object.keys(gonderSonuclari).map((id, i) => ({ id, no: `GBZ202600080000${i + 1}` }));
    const prisma = {
      tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) =>
        calistir({ belge: { findMany: vi.fn().mockResolvedValue(numaralar) } }),
      ),
    } as never;
    const servis = new EirsaliyeService(prisma, {} as never, {} as never, {} as never, {} as never);
    vi.spyOn(servis, "gonder").mockImplementation(async (belgeId: string) => {
      const sonuc = gonderSonuclari[belgeId];
      if (sonuc !== "ok") throw new BadRequestException(sonuc);
      return {} as never;
    });
    return { servis, numaralar };
  }

  it("biri başarısız olsa da kalanları göndermeyi sürdürür ve belge numarasıyla raporlar", async () => {
    const { servis } = servisKur({
      "11111111-1111-4111-8111-111111111111": "ok",
      "22222222-2222-4222-8222-222222222222": "Cari e-İrsaliye alıcısı olarak tanımlı değil",
      "33333333-3333-4333-8333-333333333333": "ok",
    });

    const sonuc = await baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () =>
      servis.topluGonder([
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ]),
    );

    expect(sonuc.gonderilen).toBe(2);
    expect(sonuc.basarisiz).toEqual([
      { belgeId: "22222222-2222-4222-8222-222222222222", belgeNo: "GBZ2026000800002", hata: "Cari e-İrsaliye alıcısı olarak tanımlı değil" },
    ]);
  });

  it("üst sınırı aşan seçimi hiç göndermeden reddeder", async () => {
    const { servis } = servisKur({});
    const fazla = Array.from({ length: 51 }, (_, i) => `1111111${String(i).padStart(4, "0")}-1111-4111-8111-111111111111`);

    await expect(
      baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () => servis.topluGonder(fazla)),
    ).rejects.toThrow(/en çok 50/);
    expect(servis.gonder).not.toHaveBeenCalled();
  });
});

describe("EirsaliyeService.gonder numara (EBLG-83)", () => {
  const firma = { unvan: "Satıcı A.Ş.", vkn: "1234567801", adres: "Maltepe Mh. No:7", ilce: "Zeytinburnu", il: "İstanbul", postaKodu: "34010", vergiDairesi: "Zeytinburnu" };
  const taslakBelge = (ek: Record<string, unknown> = {}) => ({
    id: "11111111-1111-4111-8111-111111111111", tur: "irsaliye", yon: "satis", durum: "onaylandi", no: null, kagitIrsaliye: false,
    tarih: new Date("2026-09-24"), createdAt: new Date("2026-09-24T07:00:00Z"), fiiliSevkZamani: new Date("2026-09-24T09:00:00+03:00"),
    cari: { unvan: "Alıcı A.Ş.", vknTckn: "1230460944", adresler: [{ tip: "merkez", adres: "OSB 3. Cadde No:7", il: "Denizli", ilce: "Honaz", postaKodu: "20330", ulke: "TR" }] },
    tasiyiciCari: null, plaka: "34 ABC 123", soforAdi: "Mehmet", soforSoyadi: "Öztürk", soforTckn: "10000000078",
    satirlar: [{ miktar: "5", stok: { ad: "Ürün", kod: "STK-1" } }], eirsaliye: null, fatura: null, kaynakBelge: null,
    ...ek,
  });

  function kur(belge: ReturnType<typeof taslakBelge>, gonderim: { basarili: boolean; hataMesaji?: string } = { basarili: true }, aliciKayitli = true) {
    const tx = {
      belge: { findUnique: vi.fn().mockResolvedValue(belge), update: vi.fn().mockResolvedValue({}) },
      belgeSayac: { upsert: vi.fn().mockResolvedValue({ sonSira: 800022 }) },
      tenant: { findUnique: vi.fn().mockResolvedValue(firma) },
      eirsaliyeKayit: { upsert: vi.fn(({ create }) => Promise.resolve(create)) },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as never;
    const mukellef = { kanalBelirle: vi.fn().mockResolvedValue(aliciKayitli ? { vknTckn: "1230460944", eFaturaMukellefi: true, postaKutusu: "urn:mail:alici" } : { vknTckn: "1230460944", eFaturaMukellefi: false }) } as never;
    const servis = new EirsaliyeService(prisma, {} as never, mukellef);
    const irsaliyeGonder = vi.fn().mockResolvedValue({ ...gonderim, belgeRef: gonderim.basarili ? "nes-uuid" : undefined });
    vi.spyOn(servis as never, "baglanti").mockResolvedValue({ baglanti: { saglayici: "nes" }, cfg: { eirsaliyeSeriOneki: "GBZ" }, adapter: { irsaliyeGonder } } as never);
    return { servis, tx, irsaliyeGonder };
  }
  const calistir = <T>(f: () => Promise<T>) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, f);

  it("numarasız irsaliyeye numarayı gönderimde verir ve belgeye yazar", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge());

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belgeSayac.upsert.mock.calls[0][0].where.tenantId_tur_yon_seri_yil).toEqual({ tenantId: "t1", tur: "irsaliye", yon: "satis", seri: "", yil: 2026 });
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "11111111-1111-4111-8111-111111111111" }, data: { no: "GBZ2026000800022" } });
    expect(irsaliyeGonder.mock.calls[0][1].belgeNo).toBe("GBZ2026000800022");
    expect(irsaliyeGonder.mock.calls[0][1].xml).toContain("<cbc:ID>GBZ2026000800022</cbc:ID>");
  });

  it("hata almış irsaliyeyi aynı numarayla yeniden gönderir, sayacı ilerletmez", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({ no: "GBZ2026000800021", eirsaliye: { durum: "hata" } }));

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belgeSayac.upsert).not.toHaveBeenCalled();
    expect(irsaliyeGonder.mock.calls[0][1].belgeNo).toBe("GBZ2026000800021");
  });

  it("engele takılan gönderim numara harcamaz", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({ cari: { unvan: "Alıcı A.Ş.", vknTckn: "1230460944", adresler: [] } }));

    await expect(calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"))).rejects.toThrow(/adres/i);
    expect(tx.belgeSayac.upsert).not.toHaveBeenCalled();
    expect(irsaliyeGonder).not.toHaveBeenCalled();
  });

  it("GİB listesinde olmayan alıcıya alıcı etiketi olmadan gönderir", async () => {
    const { servis, irsaliyeGonder } = kur(taslakBelge(), { basarili: true }, false);

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(irsaliyeGonder).toHaveBeenCalledOnce();
    expect(irsaliyeGonder.mock.calls[0][1].aliciPostaKutusu).toBeUndefined();
  });

  it("listede olmayan alıcıya giden belgeyi 'alıcı kayıtlı değil' diye işaretler (EBLG-85)", async () => {
    const { servis, tx } = kur(taslakBelge(), { basarili: true }, false);

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.eirsaliyeKayit.upsert.mock.calls[0][0].create.aliciKayitsiz).toBe(true);
  });

  it("yurt dışı alıcıya 2222222222 ve gümrük kapısıyla gönderir, listeye bakmaz (EBLG-84)", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({
      cari: { unvan: "Müller GmbH", vknTckn: null, adresler: [{ tip: "fatura", adres: "Hauptstr. 1", il: "Berlin", ilce: "Mitte", postaKodu: "10115", ulke: "DE" }] },
      teslimatAdres: "Ambarlı Gümrük Müdürlüğü", teslimatIl: "İstanbul", teslimatIlce: "Avcılar", teslimatPostaKodu: "34315",
    }));
    const kanalBelirle = (servis as unknown as { mukellefListesi: { kanalBelirle: ReturnType<typeof vi.fn> } }).mukellefListesi.kanalBelirle;

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(kanalBelirle).not.toHaveBeenCalled();
    const { xml, aliciPostaKutusu } = irsaliyeGonder.mock.calls[0][1];
    expect(aliciPostaKutusu).toBeUndefined();
    const alici = xml.slice(xml.indexOf("<cac:DeliveryCustomerParty>"), xml.indexOf("</cac:DeliveryCustomerParty>"));
    expect(alici).toContain('<cbc:ID schemeID="VKN">2222222222</cbc:ID>');
    expect(alici).toContain("Müller GmbH");
    const teslimat = xml.slice(xml.indexOf("<cac:DeliveryAddress>"), xml.indexOf("</cac:DeliveryAddress>"));
    expect(teslimat).toContain("Ambarlı Gümrük Müdürlüğü");
    expect(teslimat).toContain("<cbc:CityName>İstanbul</cbc:CityName>");
    expect(tx.eirsaliyeKayit.upsert.mock.calls[0][0].create.aliciKayitsiz).toBe(true);
  });

  it("kâğıt irsaliyeyi göndermez", async () => {
    const { servis, irsaliyeGonder } = kur(taslakBelge({ kagitIrsaliye: true, no: "KIR2026000001" }));

    await expect(calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"))).rejects.toThrow(/Kâğıt irsaliye/);
    expect(irsaliyeGonder).not.toHaveBeenCalled();
  });
});

describe("eirsaliyeSorguKosulu (EBLG-85)", () => {
  it("kayıtlı olmayan alıcının iletilen belgesini yanıt için sorgulamaz", () => {
    const kosul = eirsaliyeSorguKosulu("t1", Date.now(), 10);
    expect(JSON.stringify(kosul.AND)).toContain('"durum":"iletildi","aliciKayitsiz":false');
    expect(JSON.stringify(kosul.AND)).toContain('{"durum":"kuyrukta"}');
  });
});
