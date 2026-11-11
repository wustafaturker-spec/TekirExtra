import { afterAll, describe, expect, it } from "vitest";
import { PdfService } from "../src/core/pdf/pdf.service";

/**
 * EBLG-159: gömülü/firma XSLT görünümü Chrome'un yerleşik XSLT'sine (Chrome 158'de kalkar)
 * değil libxslt polyfill'ine dayanır. Gerçek Chromium gerekir; CI'da Playwright kurulduktan
 * sonra koşan kabul paketinde durur. Veritabanı kullanmaz.
 */
const servis = new PdfService({} as never, {} as never, {} as never);
afterAll(() => servis.onModuleDestroy());

const XML = `<?xml version="1.0" encoding="UTF-8"?><Invoice><ID>GIB2026000000001</ID><Line><Ad>Çay</Ad><Tutar>1234.5</Tutar></Line><Line><Ad>Şeker</Ad><Tutar>20</Tutar></Line></Invoice>`;
const bicem = (govde: string, ust = "") => `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">${ust}
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/">${govde}</xsl:template>
</xsl:stylesheet>`;

describe("XSLT görünümü polyfill ile (EBLG-159)", () => {
  it("şablon, döngü ve sayı biçimi libxslt ile uygulanır", async () => {
    const html = await servis.xsltIleHtml(XML, bicem(`<html><body><h1><xsl:value-of select="Invoice/ID"/></h1>
      <xsl:for-each select="Invoice/Line"><p><xsl:value-of select="Ad"/>: <xsl:value-of select="format-number(Tutar, '#,##0.00')"/></p></xsl:for-each></body></html>`));
    expect(html).toContain("<h1>GIB2026000000001</h1>");
    expect(html).toContain("Çay: 1,234.50");
    expect(html).toContain("Şeker: 20.00");
  }, 30_000);

  it("betik, olay özniteliği ve dış kaynak atılır; data: görsel kalır", async () => {
    const html = await servis.xsltIleHtml(XML, bicem(`<html><body><script>alert(1)</script><img src="https://kotu.example/x.png"/><img src="data:image/png;base64,AAAA"/><a href="javascript:alert(1)" onclick="x()">a</a></body></html>`));
    expect(html).not.toMatch(/<script|onclick|kotu\.example|javascript:/i);
    expect(html).toContain("data:image/png;base64,AAAA");
  }, 30_000);

  it("document() ve xsl:include sunucudaki dosyaları okuyamaz", async () => {
    const okuma = await servis.xsltIleHtml(XML, bicem(`<html><body><pre><xsl:value-of select="document('file:///etc/passwd')"/><xsl:value-of select="document('/etc/hostname')"/></pre></body></html>`));
    expect(okuma ?? "").not.toMatch(/root:|\/bin\//);
    const ekleme = await servis.xsltIleHtml(XML, bicem(`<html><body>x</body></html>`, `<xsl:include href="file:///etc/passwd"/>`));
    expect(ekleme ?? "").not.toMatch(/root:/);
  }, 30_000);

  it("bitmeyen dönüşüm süre sınırında yedek görünüme düşer", async () => {
    const sonsuz = `<?xml version="1.0"?><xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
      <xsl:template match="/"><xsl:call-template name="d"><xsl:with-param name="n" select="0"/></xsl:call-template></xsl:template>
      <xsl:template name="d"><xsl:param name="n"/><xsl:if test="$n &gt;= 0"><xsl:call-template name="d"><xsl:with-param name="n" select="$n + 1"/></xsl:call-template></xsl:if></xsl:template>
    </xsl:stylesheet>`;
    const bas = Date.now();
    expect(await servis.xsltIleHtml(XML, sonsuz, 3_000)).toBeNull();
    expect(Date.now() - bas).toBeLessThan(15_000);
  }, 30_000);
});
