import type { EbelgeSaglayici } from "@tekirextra/shared";
import type { EntegratorAdapter } from "./adapter";
import type {
  BaglantiSonuc,
  BelgeDurumSonuc,
  EntegratorConfig,
  GelenBelge,
  GonderimSonuc,
  MukellefDurum,
  UblBelge,
} from "./types";

/**
 * Geliştirme/test için sahte entegratör (T-01): gerçek sağlayıcı hesapları
 * edinilene kadar tüm e-belge akışı bu adaptörle uçtan uca çalıştırılır.
 * Davranış deterministiktir ki testler tekrarlanabilir olsun.
 */
export class MockEntegratorAdapter implements EntegratorAdapter {
  readonly saglayici: EbelgeSaglayici;

  private readonly gonderilenler = new Map<string, number>();

  constructor(saglayici: EbelgeSaglayici = "izibiz") {
    this.saglayici = saglayici;
  }

  async baglantiTest(cfg: EntegratorConfig): Promise<BaglantiSonuc> {
    if (!cfg.kullaniciAdi) {
      return { basarili: false, mesaj: "Kullanıcı adı boş olamaz" };
    }
    return { basarili: true, mesaj: "Mock bağlantı başarılı" };
  }

  /** Son hanesi çift olan VKN/TCKN e-Fatura mükellefi kabul edilir. */
  async mukellefSorgula(_cfg: EntegratorConfig, vknTckn: string): Promise<MukellefDurum> {
    const sonHane = Number(vknTckn.at(-1));
    const mukellef = sonHane % 2 === 0;
    return {
      vknTckn,
      eFaturaMukellefi: mukellef,
      postaKutusu: mukellef ? `urn:mail:defaultpk@${vknTckn}` : undefined,
    };
  }

  async belgeGonder(_cfg: EntegratorConfig, belge: UblBelge): Promise<GonderimSonuc> {
    const belgeRef = `MOCK-${belge.uuid}`;
    this.gonderilenler.set(belgeRef, 0);
    return { basarili: true, belgeRef };
  }

  /** Her sorguda durum bir adım ilerler: kuyrukta → iletildi → kabul. */
  async durumSorgula(_cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc> {
    const sorguSayisi = this.gonderilenler.get(belgeRef);
    if (sorguSayisi === undefined) {
      return { belgeRef, durum: "hata", detay: "Belge bulunamadı" };
    }
    this.gonderilenler.set(belgeRef, sorguSayisi + 1);
    const durumlar = ["kuyrukta", "iletildi", "kabul"] as const;
    return { belgeRef, durum: durumlar[Math.min(sorguSayisi, 2)] };
  }

  /**
   * Deterministik iki gelen e-Fatura döner (biri TİCARİ — kabul/ret ister, biri
   * TEMEL). UUID'ler sabit olduğu için ebelge servisi tekrarlı çekimlerde
   * bunları yinelemez (EBLG-05). XML'ler ayrıştırılabilir gerçek UBL-TR 1.2
   * belgeleridir: `ubl-oku.ts` uçtan uca bunlarla denenir.
   */
  async gelenBelgeleriCek(_cfg: EntegratorConfig, sonrasi: Date): Promise<GelenBelge[]> {
    // Tarih girdiye bağlı türetilir: hem "son 30 gün" penceresine düşer hem de
    // deterministik kalır.
    const tarih = new Date(sonrasi.getTime() + 24 * 60 * 60 * 1000);
    const tarihStr = tarih.toISOString().slice(0, 10);

    const ticari: GelenBelge = {
      uuid: "00000000-0000-4000-8000-000000000001",
      belgeNo: "MCK2026000000001",
      gonderenVkn: "4840847211",
      gonderenUnvan: "Mock Tedarik A.Ş.",
      tarih,
      xml: mockUbl({
        uuid: "00000000-0000-4000-8000-000000000001",
        belgeNo: "MCK2026000000001",
        profilId: "TICARIFATURA",
        tarihStr,
        gonderenVkn: "4840847211",
        gonderenUnvan: "Mock Tedarik A.Ş.",
        vergiDairesi: "Kadıköy V.D.",
        satirlar: [
          {
            ad: "Vidalı Bağlantı Elemanı 8mm",
            saticiUrunKodu: "TED-VDA-08",
            barkod: "8690000000017",
            miktar: 100,
            birimKodu: "C62",
            birimFiyat: 12.5,
            iskontoOrani: 0,
            kdvOrani: 20,
          },
          {
            ad: "Endüstriyel Yağlayıcı 5L",
            saticiUrunKodu: "TED-YAG-5L",
            miktar: 10,
            birimKodu: "C62",
            birimFiyat: 340,
            iskontoOrani: 10,
            kdvOrani: 20,
          },
          {
            ad: "Nakliye Hizmeti",
            saticiUrunKodu: "TED-NKL",
            miktar: 1,
            birimKodu: "C62",
            birimFiyat: 750,
            iskontoOrani: 0,
            kdvOrani: 20,
          },
        ],
      }),
    };

    const temel: GelenBelge = {
      uuid: "00000000-0000-4000-8000-000000000002",
      belgeNo: "MCK2026000000002",
      gonderenVkn: "1234567802",
      gonderenUnvan: "Mock Kırtasiye Ltd. Şti.",
      tarih,
      xml: mockUbl({
        uuid: "00000000-0000-4000-8000-000000000002",
        belgeNo: "MCK2026000000002",
        profilId: "TEMELFATURA",
        tarihStr,
        gonderenVkn: "1234567802",
        gonderenUnvan: "Mock Kırtasiye Ltd. Şti.",
        vergiDairesi: "Beşiktaş V.D.",
        satirlar: [
          {
            ad: "Ofis Kırtasiye Paketi",
            saticiUrunKodu: "KRT-PKT-01",
            miktar: 5,
            birimKodu: "PA",
            birimFiyat: 220,
            iskontoOrani: 0,
            kdvOrani: 20,
          },
        ],
      }),
    };

    return [ticari, temel];
  }

  async yanitGonder(
    _cfg: EntegratorConfig,
    belgeRef: string,
    _yanit: "kabul" | "ret",
    _gerekce?: string,
    _kaynak?: { gonderenVkn: string; xml: string },
  ): Promise<GonderimSonuc> {
    return { basarili: true, belgeRef };
  }
}

/* ─── Mock UBL-TR üretici ──────────────────────────────────────────────────
   Yalnızca sahte gelen belgeler için; giden faturaların UBL'i api tarafındaki
   `xml-uretec.ts` ile üretilir.                                            */

interface MockSatir {
  ad: string;
  saticiUrunKodu: string;
  barkod?: string;
  miktar: number;
  birimKodu: string;
  birimFiyat: number;
  iskontoOrani: number;
  kdvOrani: number;
}

function mockUbl(g: {
  uuid: string;
  belgeNo: string;
  profilId: string;
  tarihStr: string;
  gonderenVkn: string;
  gonderenUnvan: string;
  vergiDairesi: string;
  satirlar: MockSatir[];
}): string {
  const yuvarla = (d: number) => Math.round(d * 100) / 100;

  const hesaplananlar = g.satirlar.map((s) => {
    const brut = yuvarla(s.miktar * s.birimFiyat);
    const iskonto = yuvarla((brut * s.iskontoOrani) / 100);
    const matrah = yuvarla(brut - iskonto);
    const kdv = yuvarla((matrah * s.kdvOrani) / 100);
    return { ...s, brut, iskonto, matrah, kdv };
  });

  const satirToplami = yuvarla(hesaplananlar.reduce((t, s) => t + s.matrah, 0));
  const iskontoToplami = yuvarla(hesaplananlar.reduce((t, s) => t + s.iskonto, 0));
  const kdvToplami = yuvarla(hesaplananlar.reduce((t, s) => t + s.kdv, 0));
  const genelToplam = yuvarla(satirToplami + kdvToplami);

  const satirXml = hesaplananlar
    .map(
      (s, i) => `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${s.birimKodu}">${s.miktar.toFixed(3)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">${s.matrah.toFixed(2)}</cbc:LineExtensionAmount>${
      s.iskonto > 0
        ? `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:MultiplierFactorNumeric>${(s.iskontoOrani / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>
      <cbc:Amount currencyID="TRY">${s.iskonto.toFixed(2)}</cbc:Amount>
      <cbc:BaseAmount currencyID="TRY">${s.brut.toFixed(2)}</cbc:BaseAmount>
    </cac:AllowanceCharge>`
        : ""
    }
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="TRY">${s.kdv.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="TRY">${s.matrah.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="TRY">${s.kdv.toFixed(2)}</cbc:TaxAmount>
        <cbc:Percent>${s.kdvOrani.toFixed(2)}</cbc:Percent>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:Name>KDV</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${s.ad}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>${s.saticiUrunKodu}</cbc:ID>
      </cac:SellersItemIdentification>${
        s.barkod
          ? `
      <cac:StandardItemIdentification>
        <cbc:ID schemeID="GTIN">${s.barkod}</cbc:ID>
      </cac:StandardItemIdentification>`
          : ""
      }
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="TRY">${s.birimFiyat.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${g.profilId}</cbc:ProfileID>
  <cbc:ID>${g.belgeNo}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${g.uuid}</cbc:UUID>
  <cbc:IssueDate>${g.tarihStr}</cbc:IssueDate>
  <cbc:IssueTime>10:00:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${g.satirlar.length}</cbc:LineCountNumeric>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${g.gonderenVkn}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyIdentification>
        <cbc:ID schemeID="MERSISNO">0${g.gonderenVkn}00001</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${g.gonderenUnvan}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Merkez</cbc:CitySubdivisionName>
        <cbc:CityName>İstanbul</cbc:CityName>
        <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme><cbc:Name>${g.vergiDairesi}</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">1111111111</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName><cbc:Name>Alıcı Firma</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">${kdvToplami.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">${satirToplami.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">${kdvToplami.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">${satirToplami.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">${satirToplami.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">${genelToplam.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="TRY">${iskontoToplami.toFixed(2)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="TRY">${genelToplam.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${satirXml}
</Invoice>`;
}
