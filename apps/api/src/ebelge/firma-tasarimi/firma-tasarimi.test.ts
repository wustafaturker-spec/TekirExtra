import { describe, expect, it } from "vitest";
import { xsltDenetle } from "../../tenant/belge-tasarimlari.service";
import { AZAMI_LOGO_BOYU, firmaTasarimiUret, type FirmaTasarimVerisi } from "./firma-tasarimi";

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

  it("uzun markayı küçültür, marka yoksa ünvanı yazar; büyük logoyu koymaz", () => {
    const x = firmaTasarimiUret("fatura", { ...FIRMA, markaAdi: null, logoDataUri: `data:image/png;base64,${"A".repeat(AZAMI_LOGO_BOYU)}` });
    expect(x).toMatch(/<div class="ad" style="font-size:9(\.\d)?pt;letter-spacing:\.08em">TEKİR &amp; EKTRA ÖN MUHASEBE<\/div>/);
    expect(x).not.toContain('class="logo"');
  });
});
