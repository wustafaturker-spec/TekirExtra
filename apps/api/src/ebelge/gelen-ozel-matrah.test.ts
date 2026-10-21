import { describe, expect, it } from "vitest";
import { gelenFaturaGirdisi, gelenFaturaHesabi, tutarDenetimi } from "./gelen-fatura";
import { faturaUblOku } from "./ubl-oku";

/** Özel matrah alt toplamları ve toplamlarla en küçük UBL faturası. */
function xml(vergi: string, toplam: { satir: string; haric: string; dahil: string; odenecek: string }, satirlar: [string, string][]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:ProfileID>TICARIFATURA</cbc:ProfileID><cbc:ID>OZF2026000000004</cbc:ID><cbc:UUID>u1</cbc:UUID><cbc:IssueDate>2026-10-14</cbc:IssueDate>
<cbc:InvoiceTypeCode>OZELMATRAH</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">1234567801</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>Kuyumcu</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">1234567802</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>Alıcı</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty>
<cac:TaxTotal>${vergi}</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="TRY">${toplam.satir}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="TRY">${toplam.haric}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="TRY">${toplam.dahil}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="TRY">${toplam.odenecek}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${satirlar.map(([ad, tutar], i) => `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="TRY">${tutar}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${ad}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="TRY">${tutar}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join("")}
</Invoice>`;
}

const alt = (matrah: string, kdv: string, oran: string, kod?: string) =>
  `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="TRY">${matrah}</cbc:TaxableAmount><cbc:TaxAmount currencyID="TRY">${kdv}</cbc:TaxAmount><cbc:Percent>${oran}</cbc:Percent><cac:TaxCategory>${kod ? `<cbc:TaxExemptionReasonCode>${kod}</cbc:TaxExemptionReasonCode>` : ""}<cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;

function kapi(belge: string) {
  const ubl = faturaUblOku(belge);
  const { girdi, engeller } = gelenFaturaGirdisi(ubl, (sira) => ({ stokId: `s${sira}` }));
  return { ubl, girdi, engeller, denetim: tutarDenetimi(ubl, gelenFaturaHesabi(girdi, false), false) };
}

describe("gelen özel matrah: ayrık yazım (OZF2026000000004)", () => {
  const satirlar: [string, string][] = [["Külçe altın bedeli", "39600.00"], ["İşçilik", "4500.00"]];

  it("805 kodlu alt toplam %0, KDV kodsuz alt toplamda: özel matrah ve oran oradan alınır, belge tutar", () => {
    const { ubl, girdi, engeller, denetim } = kapi(xml(`<cbc:TaxAmount currencyID="TRY">900.00</cbc:TaxAmount>${alt("39600.00", "0.00", "0", "805")}${alt("4500.00", "900.00", "20")}`,
      { satir: "44100.00", haric: "44100.00", dahil: "45000.00", odenecek: "45000.00" }, satirlar));
    expect(engeller).toEqual([]);
    expect(girdi).toMatchObject({ ozelMatrahKodu: "805", ozelMatrahTutari: "4500.00", ozelMatrahOrani: "20" });
    expect(denetim.gecerli).toBe(true);
    expect(denetim.aciklamalar.join(" ")).toContain("standart dışı");
    expect(ubl.toplamlar.ozelMatrahAyrik).toEqual({ kodsuzMatrah: 4500, kodluMatrah: 39600 });
  });

  it("GİB'in standart yazımı değişmez (tek kodlu alt toplam)", () => {
    const { girdi, denetim, ubl } = kapi(xml(`<cbc:TaxAmount currencyID="TRY">900.00</cbc:TaxAmount>${alt("4500.00", "900.00", "20", "805")}`,
      { satir: "44100.00", haric: "44100.00", dahil: "45000.00", odenecek: "45000.00" }, satirlar));
    expect(girdi).toMatchObject({ ozelMatrahKodu: "805", ozelMatrahTutari: "4500.00", ozelMatrahOrani: "20" });
    expect(denetim.gecerli).toBe(true);
    expect(ubl.toplamlar.ozelMatrahAyrik).toBeUndefined();
  });

  it("kodlu alt toplamda KDV varsa ya da kodsuz alt toplam birden çoksa ayrık sayılmaz", () => {
    expect(kapi(xml(`${alt("39600.00", "10.00", "1", "805")}${alt("4500.00", "900.00", "20")}`, { satir: "44100.00", haric: "44100.00", dahil: "45010.00", odenecek: "45010.00" }, satirlar)).ubl.toplamlar.ozelMatrahAyrik).toBeUndefined();
    expect(kapi(xml(`${alt("39600.00", "0.00", "0", "805")}${alt("4500.00", "900.00", "20")}${alt("100.00", "10.00", "10")}`, { satir: "44200.00", haric: "44200.00", dahil: "45110.00", odenecek: "45110.00" }, [...satirlar, ["Kutu", "100.00"]])).ubl.toplamlar.ozelMatrahAyrik).toBeUndefined();
  });
});
