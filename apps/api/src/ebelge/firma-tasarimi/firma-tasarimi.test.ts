import { describe, expect, it } from "vitest";
import { xsltDenetle } from "../../tenant/belge-tasarimlari.service";
import { AZAMI_LOGO_BOYU, firmaTasarimiUret, gorselOlcusu, type FirmaTasarimVerisi } from "./firma-tasarimi";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const FIRMA: FirmaTasarimVerisi = {
  unvan: "TEKİR & EKTRA ÖN MUHASEBE",
  markaAdi: "TEKİR",
  markaAlt: "ÖN MUHASEBE",
  ekBilgi: "ISO 9001 · Belge <123>",
  eposta: "demo@tekirextra.local",
  telefon: "2160000000",
  webSitesi: "www.tekirextra.local",
  logoDataUri: PNG,
  rozetler: [PNG, PNG],
  bankaHesaplari: [
    { bankaAdi: "T.C. Ziraat Bankası A.Ş.", sube: "Kadıköy", swift: "TCZBTR2A", iban: "TR850001002486915798995001", hesapNo: "1-1", dovizCinsi: "TRY" },
    { bankaAdi: "T.C. Ziraat Bankası A.Ş.", sube: "Kadıköy", swift: "TCZBTR2A", iban: "TR580001002486915798995002", hesapNo: "1-2", dovizCinsi: "USD" },
    { bankaAdi: "Vakıfbank", sube: null, swift: null, iban: "TR360001500158007323999329", hesapNo: null, dovizCinsi: "EUR" },
  ],
};

describe("firmaTasarimiUret (EBLG-101)", () => {
  it.each(["fatura", "irsaliye"] as const)("%s: geçerli XSLT üretir, EMSA'ya ait hiçbir şey kalmaz", (tur) => {
    const x = firmaTasarimiUret(tur, FIRMA);
    expect(xsltDenetle(x)).toBeNull();
    expect(x).not.toMatch(/@@[A-Z_]+@@/);
    for (const iz of ["EMSA", "emsa", "Ziraat Bankası A.Ş.</b><xsl:text>  </xsl:text><span>Mustafa", "NCAGE", "TF873", "sales@", "229 70 78"]) expect(x).not.toContain(iz);
    // Firma bilgisi kaçışlı yazılır; GİB logosu ve karekod kalır.
    expect(x).toContain("<b>TEKİR &amp; EKTRA ÖN MUHASEBE</b> · ISO 9001 · Belge &lt;123&gt;");
    expect(x).toContain("demo@tekirextra.local · 2160000000 · www.tekirextra.local");
    expect(x).toContain('alt="T.C. Hazine ve Maliye Bakanlığı Gelir İdaresi Başkanlığı"');
    expect(x).toContain('id="fk-karekod"');
    expect(x.match(/class="logo"/g)).toHaveLength(1);
    expect(x.match(/class="lg"/g)).toHaveLength(1);
  });

  it("banka tablosunu banka + şube başına kutularla yazar; İngilizce belgede TL satırı gizlenir", () => {
    const x = firmaTasarimiUret("fatura", FIRMA);
    expect(x).toContain("<b>T.C. Ziraat Bankası A.Ş.</b><xsl:text>  </xsl:text><span>Kadıköy Şubesi · SWIFT TCZBTR2A</span>");
    expect(x).toContain('<xsl:if test="not($en)"><tr><xsl:if test="$dv=\'TRY\'">');
    expect(x).toContain('<td class="iban">TR85 0001 0024 8691 5798 9950 01</td><td class="hn">1-1</td>');
    expect(x).toContain("<b>Vakıfbank</b></td>");
    // Belgenin kendi PaymentMeans dalındaki kutular şablonda durur; yedek dalda iki banka eklenir.
    const kutu = (xslt: string) => xslt.match(/<table class="bnk">/g)?.length ?? 0;
    expect(kutu(x) - kutu(firmaTasarimiUret("fatura", { ...FIRMA, bankaHesaplari: [] }))).toBe(2);
  });

  it("faturada gösterilecek hesap yoksa yedek banka bölümü hiç basılmaz", () => {
    const x = firmaTasarimiUret("fatura", { ...FIRMA, bankaHesaplari: [] });
    // Belgenin kendi PaymentMeans dalı durur; yedek dal boştur.
    expect(x).toContain("</table></xsl:when><xsl:otherwise></xsl:otherwise></xsl:choose><xsl:if test=\"$iyg!=''\">");
  });

  it("ihracat faturasında şartları, kalem kap bilgisini ve TL karşılıklarını basar (EBLG-102)", () => {
    const x = firmaTasarimiUret("fatura", FIRMA);
    // Kur ve TL sütunu İngilizce düzende de ihracatta açıktır.
    expect(x).toContain("$kur &gt; 0 and (not($en) or /*/cbc:ProfileID='IHRACAT')");
    // Teslim yeri belge düzeyinde yoksa ilk satırın teslim adresinden okunur.
    expect(x).toContain("/*/cac:InvoiceLine[1]/cac:Delivery/cac:DeliveryAddress[normalize-space(concat(cbc:StreetName,cbc:CityName))!='']");
    expect(x).toContain("'TESLİM ŞARTI|INCOTERMS'");
    expect(x).toContain("'GÖNDERİLME ŞEKLİ|MODE OF TRANSPORT'");
    expect(x).toContain("cac:TransportHandlingUnit/cac:ActualPackage");
    expect(x).toContain("<xsl:when test=\"$k='BX'\">");
    expect(x).toContain("<xsl:when test=\"$k='3'\">");
  });

  it("e-Arşivde gönderim şeklini ve internet satışı bilgilerini basar (EBLG-105)", () => {
    const x = firmaTasarimiUret("fatura", FIRMA);
    // Üçüncü sütun e-Arşivde ihracat şartı olmasa da açılır.
    expect(x).toContain("cbc:Note[starts-with(normalize-space(.),'##SART:')] or $ihr_sart or $ea");
    expect(x).toContain("cac:AdditionalDocumentReference[cbc:DocumentTypeCode='SEND_TYPE']");
    for (const etiket of ["SATIŞ YERİ|SOLD ONLINE AT", "ÖDEME ŞEKLİ|PAYMENT METHOD", "ÖDEME TARİHİ|PAYMENT DATE", "TAŞIYICI|CARRIER", "GÖNDERİ TARİHİ|DISPATCH DATE"]) {
      expect(x).toContain(`'${etiket}'`);
    }
    // İnternet satışında ödeme tarihi vade değildir; web adresi notu serbest notlarda tekrarlanmaz.
    expect(x).toContain("/*/cac:PaymentMeans[not($ea_int) or cac:PayeeFinancialAccount]/cbc:PaymentDueDate");
    expect(x.match(/\[not\(\$ea_int and starts-with\(normalize-space\(\.\),'İnternet satışı — '\)\)\]/g)).toHaveLength(7);
  });

  it("faturada senaryoya özgü bilgileri, tevkifat kod-oranını ve istisna sebebini basar (EBLG-108)", () => {
    const x = firmaTasarimiUret("fatura", FIRMA);
    for (const etiket of [
      "FATURA MUHATABI|INVOICE ADDRESSEE", "İADE EDİLEN FATURA|RETURNED INVOICE", "TEŞVİK BELGESİ|INVESTMENT INCENTIVE", "ŞARJ DÖNEMİ|CHARGING PERIOD",
      "PASAPORT|PASSPORT", "UYRUK|NATIONALITY", "İADE HESABI|REFUND ACCOUNT", "ARACI KURUM|TAX-FREE AGENT",
      "ARAÇ PLAKASI|VEHICLE PLATE", "ESU RAPOR NO|CHARGING REPORT", "ÖDEME HESABI (IBAN)|PAYMENT ACCOUNT", "SGK DOSYA NO|SGK FILE NO", "İDİS SEVKİYAT NO|İDİS SHIPMENT NO",
    ]) expect(x).toContain(`'${etiket}'`);
    expect(x).toContain('<xsl:call-template name="senaryo-bilgi"/>');
    expect(x).toContain("cac:Item/cbc:ModelName[normalize-space(.)!='']");
    expect(x).toContain("cac:Item/cac:AdditionalItemIdentification/cbc:ID[@schemeID='ETIKETNO']");
    // Tevkifat toplamında kod ve oran; şablonun tanımadığı istisna kodunda UBL'deki sebep metni.
    expect(x).toContain('<xsl:for-each select="cac:WithholdingTaxTotal/cac:TaxSubtotal"><span class="l alt" style="display:block">');
    expect(x).toContain('<xsl:variable name="ist_metin" select="normalize-space(cbc:TaxExemptionReason)"/>');
  });

  it("e-İrsaliyede şoför kimliğini, İDİS numaralarını ve yükleme yerini basar (EBLG-107)", () => {
    const x = firmaTasarimiUret("irsaliye", FIRMA);
    // GİB kılavuzu şoför TCKN'sini NationalityID'de taşır; maskeli basılır.
    expect(x).toContain("(cbc:NationalityID | cac:IdentityDocumentReference/cbc:ID)[normalize-space(.)!=''][1]\"> · TCKN ********");
    expect(x).toContain("cbc:ID[@schemeID='SEVKIYATNO'][1]");
    expect(x).toContain("cac:AdditionalItemIdentification/cbc:ID[@schemeID='ETIKETNO']");
    expect(x).toContain("<xsl:when test=\"$k='IDISIRSALIYE'\">İDİS İRSALİYE</xsl:when>");
    expect(x.match(/<xsl:call-template name="yukleme-yeri"\/>/g)).toHaveLength(2);
  });

  it("yatay logoyu oranına göre genişletir, kare logoda düzeni değiştirmez (EBLG-104)", () => {
    // 300×105 PNG başlığı: IHDR'de en ve boy.
    const png = (en: number, boy: number) => {
      const b = Buffer.alloc(33);
      b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
      b.writeUInt32BE(en, 16); b.writeUInt32BE(boy, 20);
      return `data:image/png;base64,${b.toString("base64")}`;
    };
    expect(gorselOlcusu(png(300, 105))).toEqual({ en: 300, boy: 105 });
    const yatay = firmaTasarimiUret("fatura", { ...FIRMA, logoDataUri: png(300, 105) });
    expect(yatay).toContain('<td style="width:54.4mm"><img class="logo"');
    expect(yatay).toContain('style="object-fit:contain;width:51.4mm;height:18mm"');
    expect(yatay).toContain('<td style="width:30.6mm"><img class="lg"');
    const kare = firmaTasarimiUret("irsaliye", { ...FIRMA, logoDataUri: png(200, 200) });
    expect(kare).toContain('<td style="width:24mm"><img class="logo" alt="TEKİR" src="data:image/png;base64,');
    expect(kare).toContain('<td style="width:15mm"><img class="lg"');
    // Logo yoksa hücre genişliği yine kare düzenindedir.
    expect(firmaTasarimiUret("fatura", { ...FIRMA, logoDataUri: null })).toContain('<td style="width:24mm"></td>');
  });

  it("uzun markayı küçültür, marka yoksa ünvanı yazar; büyük logoyu koymaz", () => {
    const x = firmaTasarimiUret("fatura", { ...FIRMA, markaAdi: null, logoDataUri: `data:image/png;base64,${"A".repeat(AZAMI_LOGO_BOYU)}` });
    expect(x).toMatch(/<div class="ad" style="font-size:9(\.\d)?pt;letter-spacing:\.08em">TEKİR &amp; EKTRA ÖN MUHASEBE<\/div>/);
    expect(x).not.toContain('class="logo"');
  });
});
