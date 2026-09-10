import { describe, expect, it } from "vitest";
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
    cari: { unvan: "Alıcı A.Ş.", vknTckn: "1230460944" },
    teslimatAdresi: { adres: "OSB 3. Cadde No:7", il: "Denizli", ilce: "Honaz", postaKodu: "20330" },
    satirlar: [{ miktar: "5", stok: { ad: "Ürün", kod: "STK-1" } }],
  };

  it("profili ve belge türünü ayrı alanlara yazar", () => {
    const xml = ubl(belge);

    // `SEVK` belgenin türüdür, profili değil.
    expect(xml).toContain("<cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>");
    expect(xml).toContain("<cbc:DespatchAdviceTypeCode>SEVK</cbc:DespatchAdviceTypeCode>");
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
    expect(gonderi).toContain("<cbc:ActualDespatchDate>2026-09-10</cbc:ActualDespatchDate>");
  });

  it("satırda sipariş satırı referansını atlamaz", () => {
    // Şemada `cac:OrderLineReference` zorunlu; yoksa XSD kontrolü düşer.
    const satir = ubl(belge).match(/<cac:DespatchLine>[\s\S]*?<\/cac:DespatchLine>/)![0];

    expect(satir.indexOf("<cac:OrderLineReference>")).toBeLessThan(satir.indexOf("<cac:Item>"));
  });
});
