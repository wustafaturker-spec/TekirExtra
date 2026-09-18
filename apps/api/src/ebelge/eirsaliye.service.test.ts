import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import { EirsaliyeService } from "./eirsaliye.service";

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
    fiiliSevkZamani: new Date("2026-09-10T07:45:00Z"),
    plaka: "34 ABC 123",
    dorsePlaka: "34 DR 4088",
    soforAdi: "Mehmet",
    soforSoyadi: "Öztürk",
    soforTckn: "10000000078",
    satirlar: [{ miktar: "5", stok: { ad: "Ürün", kod: "STK-1" } }],
  };

  it("profili ve belge türünü ayrı alanlara yazar", () => {
    const xml = ubl(belge);

    // `SEVK` belgenin türüdür, profili değil.
    expect(xml).toContain("<cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>");
    expect(xml).toContain("<cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode>");
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
