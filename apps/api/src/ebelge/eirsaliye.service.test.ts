import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import { EirsaliyeService, eirsaliyeSorguKosulu, eirsaliyeYenidenDenemeKosulu } from "./eirsaliye.service";

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

  function kur(belge: ReturnType<typeof taslakBelge>, gonderim: { basarili: boolean; hataMesaji?: string; kalici?: boolean } = { basarili: true }, aliciKayitli = true, cfg: Record<string, unknown> = { eirsaliyeSeriOneki: "GBZ" }) {
    const tx = {
      belge: { findUnique: vi.fn().mockResolvedValue(belge), update: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
      belgeSayac: {
        findUnique: vi.fn().mockResolvedValue({ id: "sayac-1" }),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({ sonSira: 800022 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: { findUnique: vi.fn().mockResolvedValue(firma) },
      eirsaliyeKayit: { upsert: vi.fn(({ create }) => Promise.resolve(create)) },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as never;
    const mukellef = { kanalBelirle: vi.fn().mockResolvedValue(aliciKayitli ? { vknTckn: "1230460944", eFaturaMukellefi: true, postaKutusu: "urn:mail:alici" } : { vknTckn: "1230460944", eFaturaMukellefi: false }) } as never;
    const servis = new EirsaliyeService(prisma, {} as never, mukellef);
    const irsaliyeGonder = vi.fn().mockResolvedValue({ ...gonderim, belgeRef: gonderim.basarili ? "nes-uuid" : undefined });
    vi.spyOn(servis as never, "baglanti").mockResolvedValue({ baglanti: { saglayici: "nes" }, cfg, adapter: { irsaliyeGonder } } as never);
    return { servis, tx, irsaliyeGonder };
  }
  const calistir = <T>(f: () => Promise<T>) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, f);

  it("numarasız irsaliyeye numarayı gönderimde verir ve belgeye yazar", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge());

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belgeSayac.update.mock.calls[0][0].where.tenantId_tur_yon_seri_yil).toEqual({ tenantId: "t1", tur: "irsaliye", yon: "satis", seri: "EIRS:GBZ", yil: 2026 });
    expect(tx.belge.update).toHaveBeenCalledWith({ where: { id: "11111111-1111-4111-8111-111111111111" }, data: { no: "GBZ2026000800022" } });
    expect(irsaliyeGonder.mock.calls[0][1].belgeNo).toBe("GBZ2026000800022");
    expect(irsaliyeGonder.mock.calls[0][1].xml).toContain("<cbc:ID>GBZ2026000800022</cbc:ID>");
  });

  it("yükleme kabulünü iletim saymaz; belge durum sorgusuna kadar kuyrukta kalır (EBLG-106)", async () => {
    const { servis, tx } = kur(taslakBelge());

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.eirsaliyeKayit.upsert.mock.calls[0][0].create).toMatchObject({ durum: "kuyrukta", entegratorRef: "nes-uuid", entegratorDurumu: null });
  });

  it("birden çok kutulu alıcıda seçilen kutu canlı listede yoksa canlıdakiyle gönderir (EBLG-106)", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge());
    const NES = "urn:mail:defaultpk@nes.com.tr";
    const TICARI = "urn:mail:defaultpki@ticari1as_edesp.com.tr";
    (servis as unknown as { mukellefListesi: unknown }).mukellefListesi = { kanalBelirle: vi.fn().mockResolvedValue({ vknTckn: "1230460944", eFaturaMukellefi: true, postaKutusu: NES, postaKutulari: [NES, TICARI] }) };
    Object.assign(tx, { gibMukellef: { findMany: vi.fn().mockResolvedValue([{ postaKutusu: NES, kutuKayitZamani: new Date("2025-07-30"), tur: "OZEL" }, { postaKutusu: TICARI, kutuKayitZamani: new Date("2025-02-05"), tur: "OZEL" }]) } });
    const irsaliyePostaKutulariSorgula = vi.fn().mockResolvedValue([TICARI, "urn:mail:baska@x"]);
    vi.spyOn(servis as never, "baglanti").mockResolvedValue({ baglanti: { saglayici: "nes" }, cfg: { eirsaliyeSeriOneki: "GBZ", gondericiBirimEtiketi: "urn:mail:defaultgb@nes.com.tr" }, adapter: { irsaliyeGonder, irsaliyePostaKutulariSorgula } } as never);

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(irsaliyePostaKutulariSorgula).toHaveBeenCalledWith(expect.anything(), "1230460944");
    expect(irsaliyeGonder.mock.calls[0][1].aliciPostaKutusu).toBe(TICARI);
  });

  it("tek kutulu alıcıda canlı sorgu yapmaz", async () => {
    const { servis, irsaliyeGonder } = kur(taslakBelge());
    const irsaliyePostaKutulariSorgula = vi.fn();
    vi.spyOn(servis as never, "baglanti").mockResolvedValue({ baglanti: { saglayici: "nes" }, cfg: { eirsaliyeSeriOneki: "GBZ" }, adapter: { irsaliyeGonder, irsaliyePostaKutulariSorgula } } as never);

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(irsaliyePostaKutulariSorgula).not.toHaveBeenCalled();
    expect(irsaliyeGonder.mock.calls[0][1].aliciPostaKutusu).toBe("urn:mail:alici");
  });

  it("entegratöre ulaşmış belgeyi ikinci kez yüklemez (EBLG-106)", async () => {
    const mevcut = { durum: "kuyrukta", entegratorRef: "nes-uuid", entegratorDurumu: "Waiting" };
    const { servis, irsaliyeGonder } = kur(taslakBelge({ no: "GBZ2026000800021", eirsaliye: mevcut }));

    expect(await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"))).toBe(mevcut);
    expect(irsaliyeGonder).not.toHaveBeenCalled();
  });

  it("hata almış irsaliyeyi aynı numarayla yeniden gönderir, sayacı ilerletmez", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({ no: "GBZ2026000800021", eirsaliye: { durum: "hata" } }));

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belgeSayac.update).not.toHaveBeenCalled();
    expect(irsaliyeGonder.mock.calls[0][1].belgeNo).toBe("GBZ2026000800021");
    // Başarılı yeniden gönderim önceki hatayı temizler.
    expect(tx.eirsaliyeKayit.upsert.mock.calls[0][0].update.hataMesaji).toBeNull();
  });

  it("bağlantıda e-İrsaliye öneki yoksa varsayılan seriye düşmez, numara harcamadan durur (EBLG-97)", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge(), { basarili: true }, true, {});

    await expect(calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"))).rejects.toThrow(/e-İrsaliye seri öneki girilmemiş/);
    expect(tx.belgeSayac.update).not.toHaveBeenCalled();
    expect(irsaliyeGonder).not.toHaveBeenCalled();
  });

  it("yanlış seriden numara almış, entegratöre ulaşmamış belgeyi yeni seriden numaralar ve sayacı geri alır (EBLG-97)", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({ no: "IRS2026000000001", eirsaliye: { durum: "hata", entegratorRef: null } }), { basarili: true }, true, { eirsaliyeSeriOneki: "TX2" });
    tx.belgeSayac.update.mockResolvedValue({ sonSira: 1 });

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belgeSayac.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", tur: "irsaliye", yon: "satis", seri: { in: ["EIRS:IRS", ""] }, yil: 2026, sonSira: 1 },
      data: { sonSira: { decrement: 1 } },
    });
    expect(irsaliyeGonder.mock.calls[0][1].belgeNo).toBe("TX22026000000001");
  });

  it("yeni önek 1'den başlar, başka serinin sırasını devam ettirmez", async () => {
    // TEKİREXTRA2: önek IRS→TK0 değişince yeni seri 002'den başlamıştı (2026-09-26).
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge(), { basarili: true }, true, { eirsaliyeSeriOneki: "TK0" });
    tx.belgeSayac.findUnique.mockResolvedValue(null);
    tx.belgeSayac.update.mockResolvedValue({ sonSira: 1 });

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belge.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1", tur: "irsaliye", no: { startsWith: "TK02026" } });
    expect(tx.belgeSayac.create).toHaveBeenCalledWith({ data: { tenantId: "t1", tur: "irsaliye", yon: "satis", seri: "EIRS:TK0", yil: 2026, sonSira: 0 } });
    expect(irsaliyeGonder.mock.calls[0][1].belgeNo).toBe("TK02026000000001");
  });

  it("sayacı olmayan önek o seride kesilmiş belgelerin en büyük sırasından devam eder", async () => {
    const { servis, tx } = kur(taslakBelge());
    tx.belgeSayac.findUnique.mockResolvedValue(null);
    tx.belge.findMany.mockResolvedValue([{ no: "GBZ2026000800029" }, { no: "GBZ2026000800007" }, { no: "GBZ2026001" }]);

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belgeSayac.create.mock.calls[0][0].data.sonSira).toBe(800029);
  });

  it("entegratöre ulaşmış belgenin numarasına önek değişse de dokunmaz (EBLG-97)", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({ no: "GBZ2026000800021", eirsaliye: { durum: "hata", entegratorRef: "nes-uuid" } }), { basarili: true }, true, { eirsaliyeSeriOneki: "TX2" });

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.belgeSayac.updateMany).not.toHaveBeenCalled();
    expect(irsaliyeGonder.mock.calls[0][1].belgeNo).toBe("GBZ2026000800021");
  });

  it("otomatik seri reddine yapılacak işi ekler (EBLG-97)", async () => {
    const { servis, tx } = kur(taslakBelge(), { basarili: false, kalici: true, hataMesaji: "NES 422: HATALI ISTEK — SCHEMATRON_CHECK_RESULT_HAS_FAILED (OTOMATIK NUMARALANDIRILAN SERIDIR! 16 HANELI NUMARA VERILEMEZ : GBZ2026000800022)" });

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(tx.eirsaliyeKayit.upsert.mock.calls[0][0].create.hataMesaji).toContain("elle numaralı bir seri yazıp bağlantıyı yeniden etkinleştirin");
  });

  it("engele takılan gönderim numara harcamaz", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({ cari: { unvan: "Alıcı A.Ş.", vknTckn: "1230460944", adresler: [] } }));

    await expect(calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"))).rejects.toThrow(/adres/i);
    expect(tx.belgeSayac.update).not.toHaveBeenCalled();
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

  it("muhtelif müşteri irsaliyesini 5555555555 ile ve alıcı etiketi olmadan gönderir, listeye bakmaz (EBLG-95)", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({
      cari: { unvan: "Muhtelif Müşteriler", vknTckn: "5555555555", adresler: [{ tip: "merkez", adres: "Deneme Mah. Örnek Sk. No:1", il: "İstanbul", ilce: "Kadıköy", postaKodu: "34710", ulke: "TR" }] },
    }));
    const kanalBelirle = (servis as unknown as { mukellefListesi: { kanalBelirle: ReturnType<typeof vi.fn> } }).mukellefListesi.kanalBelirle;

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    expect(kanalBelirle).not.toHaveBeenCalled();
    const { xml, aliciPostaKutusu } = irsaliyeGonder.mock.calls[0][1];
    expect(aliciPostaKutusu).toBeUndefined();
    const alici = xml.slice(xml.indexOf("<cac:DeliveryCustomerParty>"), xml.indexOf("</cac:DeliveryCustomerParty>"));
    expect(alici).toContain('<cbc:ID schemeID="VKN">5555555555</cbc:ID>');
    expect(alici).toContain("<cbc:Name>Muhtelif Müşteriler</cbc:Name>");
    expect(tx.eirsaliyeKayit.upsert.mock.calls[0][0].create.aliciKayitsiz).toBe(true);
  });

  it("yurt dışı alıcıya 2222222222 ve gümrük kapısıyla gönderir, listeye bakmaz (EBLG-84)", async () => {
    const { servis, tx, irsaliyeGonder } = kur(taslakBelge({
      cari: { unvan: "Müller GmbH", vknTckn: null, adresler: [{ tip: "fatura", adres: "Hauptstr. 1", il: "Berlin", ilce: "Mitte", postaKodu: "10115", ulke: "DE" }] },
      teslimatAdres: "Ambarlı Gümrük Müdürlüğü", teslimatIl: "İstanbul", teslimatIlce: "Avcılar", teslimatPostaKodu: "34315",
      fatura: { no: "K072026000000090", tarih: new Date("2026-09-23") },
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
    // EBLG-89: bağlı ihracat faturası açıklamada anılır.
    expect(xml).toContain("<cbc:Note>Bu irsaliye 23.09.2026 tarih ve K072026000000090 numaralı ihracat faturasına istinaden düzenlenmiştir.</cbc:Note>");
  });

  it("gümrükten depoya sevki firmanın kendisine, açıklama ve yükleme adresiyle gönderir (EBLG-87)", async () => {
    const { servis, irsaliyeGonder } = kur(taslakBelge({
      yon: "alis", no: "GBZ2026000800030", gumrukDepoSevki: true,
      gumrukBeyannameNo: "26341300IM000123", gumrukBeyannameTarihi: new Date("2026-09-20"), gumrukSeferNo: 2,
      yuklemeAdres: "Ambarlı Gümrük Müdürlüğü", yuklemeIl: "İstanbul", yuklemeIlce: "Avcılar", yuklemePostaKodu: "34315",
      depo: { adres: "Organize San. 5. Cad. No:3", il: "Kocaeli", ilce: "Gebze", postaKodu: "41400" },
      cari: { unvan: "Müller GmbH", vknTckn: null, adresler: [{ tip: "fatura", adres: "Hauptstr. 1", il: "Berlin", ilce: "Mitte", postaKodu: "10115", ulke: "DE" }] },
    }));
    const kanalBelirle = (servis as unknown as { mukellefListesi: { kanalBelirle: ReturnType<typeof vi.fn> } }).mukellefListesi.kanalBelirle;

    await calistir(() => servis.gonder("11111111-1111-4111-8111-111111111111"));

    // Alıcı firmanın kendisi: kendi VKN'si için posta kutusu sorulur.
    expect(kanalBelirle.mock.calls[0][2]).toBe("1234567801");
    const { xml } = irsaliyeGonder.mock.calls[0][1];
    const alici = xml.slice(xml.indexOf("<cac:DeliveryCustomerParty>"), xml.indexOf("</cac:DeliveryCustomerParty>"));
    expect(alici).toContain('<cbc:ID schemeID="VKN">1234567801</cbc:ID>');
    expect(alici).toContain("Satıcı A.Ş.");
    expect(xml).toContain("<cbc:Note>20.09.2026 Tarih ve 26341300IM000123 Sayılı Gümrük Beyannamesi muhteviyatı malların gümrükten depoya kısım kısım taşınmasına ilişkin 2. seferidir.</cbc:Note><cbc:LineCountNumeric>");
    expect(xml).toMatch(/<cbc:ActualDespatchTime>[^<]*<\/cbc:ActualDespatchTime><cac:DespatchAddress><cbc:StreetName>Ambarlı Gümrük Müdürlüğü<\/cbc:StreetName>/);
    const bosaltma = xml.slice(xml.indexOf("<cac:DeliveryAddress>"), xml.indexOf("</cac:DeliveryAddress>"));
    expect(bosaltma).toContain("<cbc:CitySubdivisionName>Gebze</cbc:CitySubdivisionName>");
  });

  it("geçici hatayı kaydeder, içerik hatasını kaydetmez; otomatik deneme sayacı işler (EBLG-94)", async () => {
    const gecici = kur(taslakBelge(), { basarili: false, hataMesaji: "NES'e ulaşılamadı" });
    await calistir(() => gecici.servis.gonder("11111111-1111-4111-8111-111111111111", { otomatik: true }));
    const kayit = gecici.tx.eirsaliyeKayit.upsert.mock.calls[0][0];
    expect(kayit.create).toMatchObject({ durum: "hata", geciciHata: true, yenidenDenemeSayisi: 1 });
    expect(kayit.update.yenidenDenemeSayisi).toEqual({ increment: 1 });

    const icerik = kur(taslakBelge(), { basarili: false, hataMesaji: "SCHEMATRON", kalici: true } as never);
    await calistir(() => icerik.servis.gonder("11111111-1111-4111-8111-111111111111"));
    expect(icerik.tx.eirsaliyeKayit.upsert.mock.calls[0][0].create).toMatchObject({ geciciHata: false, yenidenDenemeSayisi: 0 });
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

  it("GİB sonucu beklenen yeni irsaliyeyi ilk saat 5, ilk gün 30 dakikada bir sorar; sonrası 2 saat", () => {
    const simdi = Date.parse("2026-09-30T19:10:00Z");
    const dk = 60_000;
    const aralik = (kosul: ReturnType<typeof eirsaliyeSorguKosulu>) =>
      (kosul.OR as { durum?: string; createdAt?: { gte: Date }; sonDurumSorguAt: { lt: Date } | null }[])
        .map((k) => [k.durum ?? "hepsi", k.createdAt ? (simdi - k.createdAt.gte.getTime()) / dk : null, k.sonDurumSorguAt ? (simdi - k.sonDurumSorguAt.lt.getTime()) / dk : null]);
    expect(aralik(eirsaliyeSorguKosulu("t1", simdi, 10))).toEqual([
      ["hepsi", null, null],
      ["hepsi", null, 120],
      ["kuyrukta", 60, 5],
      ["kuyrukta", 1440, 30],
    ]);
  });
});

describe("e-İrsaliye otomatik yeniden deneme (EBLG-94)", () => {
  it("yalnız geçici hatalı, hakkı kalmış, aralığı geçmiş ve iptal edilmemiş kaydı dener", () => {
    const simdi = Date.parse("2026-09-24T12:00:00Z");
    const kosul = eirsaliyeYenidenDenemeKosulu("t1", simdi);
    expect(kosul).toMatchObject({ tenantId: "t1", durum: "hata", geciciHata: true, yenidenDenemeSayisi: { lt: 3 }, belge: { durum: { not: "iptal" } } });
    expect((kosul.updatedAt as { lt: Date }).lt.getTime()).toBe(simdi - 15 * 60 * 1000);
  });

  it("aynı numarayla yeniden gönderir; engele takılan denemeyi de sayar", async () => {
    const update = vi.fn();
    const tx = { eirsaliyeKayit: { findMany: vi.fn().mockResolvedValue([{ id: "k1", belgeId: "b1" }, { id: "k2", belgeId: "b2" }]), update } };
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as never;
    const servis = new EirsaliyeService(prisma, {} as never, {} as never);
    const gonder = vi.spyOn(servis, "gonder")
      .mockResolvedValueOnce({ durum: "iletildi" } as never)
      .mockRejectedValueOnce(new BadRequestException("Cari VKN/TCKN bilgisi eksik"));

    const sonuc = await baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () => servis.geciciHatalariYenidenGonder());

    expect(gonder).toHaveBeenNthCalledWith(1, "b1", { otomatik: true });
    expect(sonuc).toEqual({ denenen: 2, basarili: 1, basarisiz: 1 });
    expect(update).toHaveBeenCalledWith({ where: { id: "k2" }, data: { yenidenDenemeSayisi: { increment: 1 }, hataMesaji: "Cari VKN/TCKN bilgisi eksik" } });
  });
});

describe("EirsaliyeService.gelenYanit süre (EBLG-96)", () => {
  function servisKur(sevkTarihi: string) {
    const kayit = { id: "g1", uuid: "u1", durum: "yeni", kendiSevkimiz: false, sevkTarihi: new Date(`${sevkTarihi}T00:00:00Z`), xmlIcerik: "<x/>" };
    const prisma = {
      tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) =>
        calistir({ gelenEirsaliye: { findUnique: vi.fn().mockResolvedValue(kayit) } }),
      ),
    } as never;
    const servis = new EirsaliyeService(prisma, {} as never, {} as never, {} as never, {} as never);
    const baglanti = vi.fn();
    (servis as unknown as { baglanti: unknown }).baglanti = baglanti;
    return { servis, baglanti };
  }

  it("fiilî sevkten 7 gün geçmişse yanıtı entegratöre gitmeden reddeder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T09:00:00+03:00"));
    try {
      const { servis, baglanti } = servisKur("2026-09-18");
      await expect(
        baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () => servis.gelenYanit("g1", "kabul")),
      ).rejects.toThrow("Yanıt süresi 25.09.2026 tarihinde doldu");
      expect(baglanti).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("EirsaliyeService.taslakGonder (EBLG-106)", () => {
  const ETIKET = "urn:mail:defaultpki@ticari1as_edesp.com.tr";
  function kur(kayit: Record<string, unknown>, adaylar = [ETIKET, "urn:mail:defaultpk@nilvera.com"], canli?: string[]) {
    const tx = {
      eirsaliyeKayit: {
        findFirst: vi.fn().mockResolvedValue({ id: "k1", entegratorRef: "nes-uuid", entegratorDurumu: "Waiting", belge: { no: "TK02026000000006", cariId: "c1", gumrukDepoSevki: false, cari: { vknTckn: "1234567801", eirsaliyePostaKutusu: null } }, ...kayit }),
        update: vi.fn(({ data }) => Promise.resolve(data)),
      },
      cariHesap: { update: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_t: string, calistir: (tx: unknown) => unknown) => calistir(tx)) } as never;
    const servis = new EirsaliyeService(prisma, {} as never, {} as never);
    const irsaliyeTaslaginiGonder = vi.fn().mockResolvedValue(undefined);
    const irsaliyeDurumSorgula = vi.fn().mockResolvedValue({ belgeRef: "nes-uuid", durum: "kuyrukta", hamDurum: "WaitingToBeSend" });
    const irsaliyePostaKutulariSorgula = canli ? vi.fn().mockResolvedValue(canli) : undefined;
    vi.spyOn(servis as never, "baglanti").mockResolvedValue({ cfg: {}, adapter: { irsaliyeTaslaginiGonder, irsaliyeDurumSorgula, irsaliyePostaKutulariSorgula } } as never);
    vi.spyOn(servis as never, "aliciPostaKutulari").mockResolvedValue({ vkn: "1234567801", adaylar, kartta: null } as never);
    return { servis, tx, irsaliyeTaslaginiGonder };
  }
  const calistir = <T>(f: () => Promise<T>) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, f);

  it("etiketi verip taslağı gönderir, kartı günceller, yeni aşamayı yazar", async () => {
    const { servis, tx, irsaliyeTaslaginiGonder } = kur({});

    const sonuc = await calistir(() => servis.taslakGonder("b1", { postaKutusu: ETIKET, kartaKaydet: true }));

    expect(irsaliyeTaslaginiGonder).toHaveBeenCalledWith({}, "nes-uuid", ETIKET);
    expect(tx.cariHesap.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { eirsaliyePostaKutusu: ETIKET } });
    expect(sonuc).toMatchObject({ durum: "kuyrukta", entegratorDurumu: "WaitingToBeSend" });
  });

  it("taslakta olmayan belgeye dokunmaz", async () => {
    const { servis, irsaliyeTaslaginiGonder } = kur({ entegratorDurumu: "EnvelopeIsWaitingToBeSendedToReceiverByGib" });
    await expect(calistir(() => servis.taslakGonder("b1", { postaKutusu: ETIKET }))).rejects.toThrow(/taslakta değil/);
    expect(irsaliyeTaslaginiGonder).not.toHaveBeenCalled();
  });

  it("alıcının GİB listesinde olmayan kutuyu kabul etmez, kartı değiştirmez", async () => {
    const { servis, tx, irsaliyeTaslaginiGonder } = kur({});
    await expect(calistir(() => servis.taslakGonder("b1", { postaKutusu: "urn:mail:uydurma@x", kartaKaydet: true }))).rejects.toThrow(/listesinde yok/);
    expect(irsaliyeTaslaginiGonder).not.toHaveBeenCalled();
    expect(tx.cariHesap.update).not.toHaveBeenCalled();
  });

  it("toplu listede olup entegratörün canlı sorgusunda olmayan kutuyu kabul etmez", async () => {
    const { servis, irsaliyeTaslaginiGonder } = kur({}, ["urn:mail:defaultpk@nes.com.tr", ETIKET], [ETIKET]);
    await expect(calistir(() => servis.taslakGonder("b1", { postaKutusu: "urn:mail:defaultpk@nes.com.tr" }))).rejects.toThrow(/güncel listesinde yok/);
    expect(irsaliyeTaslaginiGonder).not.toHaveBeenCalled();
  });
});
