import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { BELGE_DILLERI, ciftDilGecerli } from "@tekirextra/shared";
import { Roller } from "../../auth/roller.decorator";
import { aktifBaglam } from "../istek-baglami";
import { PrismaService } from "../prisma.service";
import { belgeGorunumuSemasi, gorunumNormalize, TICARI_BELGE_TURLERI } from "./belge-gorunumu";
import { ornekBelgeModeli } from "./ornek-belgeler";
import { PdfService } from "./pdf.service";
import { ticariBelgeHtml } from "./ticari-belge";
import { DestekOturumundaAcik, SaltOkumadaAcik } from "../../auth/public.decorator";

const onizlemeSemasi = z.object({
  /** Kaydedilmemiş görünüm; eksik alanlar kayıtlı görünümden tamamlanır. */
  gorunum: belgeGorunumuSemasi.optional(),
  tur: z.enum(TICARI_BELGE_TURLERI).default("teklif"),
  dil: z.enum(BELGE_DILLERI).default("tr"),
  ciftDil: z.boolean().default(false),
});

/** FTR-42: Belge Görünümü ekranının canlı önizlemesi (gerçek PDF üreteci). */
@Controller("belge-gorunumu")
export class BelgeGorunumuController {
  constructor(
    private readonly pdf: PdfService,
    private readonly prisma: PrismaService,
  ) {}

  /** Kayıtlı görünüm varsayılanlarla tamamlanmış hâliyle; kaşe görseli varsa kimliği. */
  @Get()
  @Roller("yonetici")
  async getir() {
    const { tenantId } = aktifBaglam();
    const [gorunum, kase] = await Promise.all([
      this.pdf.belgeGorunumu(),
      this.prisma.tenantIslem(tenantId, (tx) => tx.ek.findFirst({
        where: { sahipTur: "firma_kase", sahipId: tenantId }, orderBy: { createdAt: "desc" }, select: { id: true, dosyaAdi: true },
      })),
    ]);
    return { gorunum, firmaId: tenantId, kase };
  }

  @SaltOkumadaAcik()
  @DestekOturumundaAcik()
  @Post("onizleme")
  @Roller("yonetici")
  async onizleme(@Body() govde: unknown, @Res() res: Response) {
    const ayristirma = onizlemeSemasi.safeParse(govde);
    if (!ayristirma.success) throw new BadRequestException(ayristirma.error.issues.map((s) => `${s.path.join(".")}: ${s.message}`).join("; "));
    const girdi = ayristirma.data;
    const { tenantId } = aktifBaglam();
    const firma = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenant.findUnique({
      where: { id: tenantId },
      select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true },
    }));
    if (!firma) throw new NotFoundException("Firma bulunamadı");
    const [kayitli, tema, kaseDataUri] = await Promise.all([this.pdf.belgeGorunumu(), this.pdf.belgeTemasi(), this.pdf.firmaKaseDataUri()]);
    const gorunum = gorunumNormalize({ ...kayitli, ...(girdi.gorunum ?? {}) });
    const model = ornekBelgeModeli(girdi.tur, girdi.dil, ciftDilGecerli(girdi.dil, girdi.ciftDil));
    const { html, altBilgi } = ticariBelgeHtml(model, { firma, gorunum, logoDataUri: tema.logoDataUri, kaseDataUri });
    const buffer = await this.pdf.htmlToPdf(html, { altBilgi });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="belge-onizleme.pdf"');
    res.send(buffer);
  }
}
