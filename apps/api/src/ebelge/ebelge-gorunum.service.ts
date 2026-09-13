import { Injectable, NotFoundException } from "@nestjs/common";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { ebelgeYedekPdfHtml } from "./ebelge-pdf";
import { karekodDataUri, karekoduHtmlEkle } from "./karekod";
import { UblOkumaHatasi, faturaKarekodVerisi, faturaUblOku } from "./ubl-oku";
import { gomuluXsltCikar } from "./ubl-gorunum";

/**
 * EBLG-27/28: gelen ve giden e-belgeleri PDF olarak gösterir. Kaynak her zaman
 * saklanan UBL'dir; PDF saklanmaz, her istekte üretilir.
 */
@Injectable()
export class EbelgeGorunumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  /**
   * Belgeyi kendi gömülü görünümüyle basar. XSLT yoksa ya da uygulanamadıysa
   * belgenin verilerinden yedek görünüm üretilir (EBLG-28); belge hiç
   * okunamıyorsa hata verilir, çünkü basacak bir şey kalmaz.
   *
   * `karekodlu` yalnız kestiğimiz belgede açıktır (EBLG-32): gelen belgenin
   * karekodu göndereninin işidir.
   */
  private async pdfUret(xml: string, dosyaAdi: string, karekodlu = false) {
    const karekod = karekodlu ? faturaKarekodVerisi(xml) : null;
    const karekodUri = karekod ? karekodDataUri(karekod) : undefined;

    const xslt = gomuluXsltCikar(xml);
    const html = xslt ? await this.pdf.xsltIleHtml(xml, xslt) : null;
    if (html) {
      const basilacak = karekodUri ? karekoduHtmlEkle(html, karekodUri) : html;
      return { buffer: await this.pdf.htmlToPdf(basilacak, { yalitilmis: true }), dosyaAdi };
    }

    let fatura;
    try {
      fatura = faturaUblOku(xml);
    } catch (hata) {
      if (hata instanceof UblOkumaHatasi) {
        throw new NotFoundException(`Belge görüntülenemiyor: ${hata.message}`);
      }
      throw hata;
    }
    const logoDataUri = await this.pdf.firmaLogoDataUri();
    return {
      buffer: await this.pdf.htmlToPdf(ebelgeYedekPdfHtml(fatura, { logoDataUri, karekodDataUri: karekodUri })),
      dosyaAdi,
    };
  }

  /** Gelen kutusundaki belgenin görünümü — gönderenin tasarladığı hâliyle. */
  async gelenPdf(id: string) {
    const { tenantId } = aktifBaglam();
    const belge = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.findUnique({ where: { id }, select: { belgeNo: true, xmlIcerik: true } }),
    );
    if (!belge) throw new NotFoundException("Gelen e-belge bulunamadı");
    return this.pdfUret(belge.xmlIcerik, `gelen-fatura-${belge.belgeNo}.pdf`);
  }

  /**
   * Kestiğimiz belgenin alıcıya giden görünümü. Kaynak arşivlenen UBL'dir:
   * gönderilmemiş faturanın böyle bir görünümü yoktur, kullanıcı normal fatura
   * çıktısını alır. Arşivdeki UBL sağlayıcının atadığı numarayı taşıdığı için
   * karekod buradan üretilir (EBLG-32).
   */
  async gidenPdf(faturaId: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ebelgeKayit.findUnique({
        where: { faturaId },
        select: { fatura: { select: { no: true } }, arsiv: { select: { xmlIcerik: true } } },
      }),
    );
    if (!kayit?.arsiv) {
      throw new NotFoundException(
        "Bu fatura için arşivlenmiş e-belge bulunamadı; belge henüz gönderilmemiş olabilir",
      );
    }
    return this.pdfUret(kayit.arsiv.xmlIcerik, `efatura-${kayit.fatura.no ?? faturaId}.pdf`, true);
  }
}
