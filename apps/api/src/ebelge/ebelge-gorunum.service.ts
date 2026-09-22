import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { EntegratorConfig } from "@tekirextra/baglanti";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { PdfService } from "../core/pdf/pdf.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { ebelgeYedekPdfHtml } from "./ebelge-pdf";
import { eirsaliyeYedekPdfHtml } from "./eirsaliye-pdf";
import { IrsaliyeUblOkumaHatasi, irsaliyeUblOku } from "./eirsaliye-ubl-oku";
import { karekodDataUri, karekoduHtmlEkle } from "./karekod";
import { UblOkumaHatasi, faturaKarekodVerisi, faturaUblOku } from "./ubl-oku";
import { gomuluXsltCikar } from "./ubl-gorunum";

/**
 * EBLG-27/28/33: gelen ve giden e-belgeleri PDF olarak gösterir. Kaynak her
 * zaman saklanan UBL'dir; PDF saklanmaz, her istekte üretilir.
 */
@Injectable()
export class EbelgeGorunumService {
  private readonly logger = new Logger(EbelgeGorunumService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly baglantilar: BaglantilarService,
  ) {}

  /**
   * Gönderilmiş belgenin resmî görünümü (EBLG-75). Alıcının gördüğü tasarım
   * entegratördedir — belgeye XSLT gömmüyoruz (EBLG-31 kararı) — bu yüzden
   * kendi yedek görünümümüzü basmadan önce oradan indirmeyi deneriz.
   * İndirilemezse `null` döner ve çağıran yedek görünüme düşer; belge
   * görüntülemek entegratör erişilemediği için hiç başarısız olmamalı.
   */
  private async saglayicidanPdf(tur: "efatura" | "earsiv", uuid: string): Promise<Buffer | null> {
    const { tenantId } = aktifBaglam();
    try {
      const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }),
      );
      if (!baglanti) return null;
      const adapter = this.baglantilar.adapterCoz(baglanti.saglayici);
      if (!adapter.gidenBelgePdf) return null;
      const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
      return await adapter.gidenBelgePdf(cfg, uuid, tur);
    } catch (hata) {
      this.logger.warn({ event: "ebelge_saglayici_gorunumu_alinamadi", uuid, hata: hata instanceof Error ? hata.message : String(hata) });
      return null;
    }
  }

  /** Belgenin gömülü görünümünü (EBLG-28) basmayı dener; yoksa `null`. */
  private async gomuluGorunumHtml(xml: string): Promise<string | null> {
    const xslt = gomuluXsltCikar(xml);
    return xslt ? this.pdf.xsltIleHtml(xml, xslt) : null;
  }

  /**
   * Belgeyi kendi gömülü görünümüyle basar. XSLT yoksa ya da uygulanamadıysa
   * belgenin verilerinden yedek görünüm üretilir (EBLG-28); belge hiç
   * okunamıyorsa hata verilir, çünkü basacak bir şey kalmaz.
   *
   * `karekodlu` yalnız kestiğimiz belgede açıktır (EBLG-32): gelen belgenin
   * karekodu göndereninin işidir.
   */
  private async pdfUret(xml: string, dosyaAdi: string, karekodlu = false) {
    // `karekodlu` yalnız kendi kestiğimiz belgede açık; yedek görünümün
    // "gönderenin şablonu yok" notu da o belgede yersizdir.
    const kendiBelgemiz = karekodlu;
    const karekod = karekodlu ? faturaKarekodVerisi(xml) : null;
    const karekodUri = karekod ? karekodDataUri(karekod) : undefined;

    const html = await this.gomuluGorunumHtml(xml);
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
    const tema = await this.pdf.belgeTemasi();
    return {
      buffer: await this.pdf.htmlToPdf(ebelgeYedekPdfHtml(fatura, { tema, karekodDataUri: karekodUri, kendiBelgemiz })),
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
        select: { tur: true, fatura: { select: { no: true } }, arsiv: { select: { xmlIcerik: true } } },
      }),
    );
    if (!kayit?.arsiv) {
      throw new NotFoundException(
        "Bu fatura için arşivlenmiş e-belge bulunamadı; belge henüz gönderilmemiş olabilir",
      );
    }
    const dosyaAdi = `efatura-${kayit.fatura.no ?? faturaId}.pdf`;
    // EBLG-75: önce alıcının gördüğü resmî görünüm; yedek görünüm ancak
    // entegratörden belge gelmezse basılır.
    const saglayiciPdf = await this.saglayicidanPdf(kayit.tur === "earsiv" ? "earsiv" : "efatura", faturaId);
    if (saglayiciPdf?.length) return { buffer: saglayiciPdf, dosyaAdi };
    return this.pdfUret(kayit.arsiv.xmlIcerik, dosyaAdi, true);
  }

  /** EBLG-33: gelen e-İrsaliye — gönderenin görünümüyle, yoksa irsaliye yedek görünümüyle. */
  async gelenIrsaliyePdf(id: string) {
    const { tenantId } = aktifBaglam();
    const belge = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEirsaliye.findUnique({ where: { id }, select: { belgeNo: true, xmlIcerik: true } }),
    );
    if (!belge) throw new NotFoundException("Gelen e-İrsaliye bulunamadı");
    const dosyaAdi = `gelen-irsaliye-${belge.belgeNo}.pdf`;

    const html = await this.gomuluGorunumHtml(belge.xmlIcerik);
    if (html) return { buffer: await this.pdf.htmlToPdf(html, { yalitilmis: true }), dosyaAdi };

    let irsaliye;
    try {
      irsaliye = irsaliyeUblOku(belge.xmlIcerik);
    } catch (hata) {
      if (hata instanceof IrsaliyeUblOkumaHatasi) {
        throw new NotFoundException(`Belge görüntülenemiyor: ${hata.message}`);
      }
      throw hata;
    }
    const tema = await this.pdf.belgeTemasi();
    return { buffer: await this.pdf.htmlToPdf(eirsaliyeYedekPdfHtml(irsaliye, { tema })), dosyaAdi };
  }
}
