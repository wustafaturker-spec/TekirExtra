import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Res } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { Roller } from "../auth/roller.decorator";
import { aktifBaglam } from "../core/istek-baglami";
import { PdfService } from "../core/pdf/pdf.service";
import { PrismaService } from "../core/prisma.service";
import { cariDenklestir } from "../fatura/denklestirme";
import { mahsupAdaylari, mahsupGeriAlYaz, mahsupYaz } from "../fatura/mahsup";
import { EpostaService } from "../tenant/eposta.service";
import { mahsupBildirimiHtml } from "./mahsup-pdf";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const tutar = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Tutar en çok 2 ondalıklı olmalıdır");
const mahsupSemasi = z.object({
  tarih: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD olmalıdır"),
  dovizCinsi: z.string().length(3),
  aciklama: z.string().trim().max(500).optional().nullable(),
  satirlar: z.array(z.object({ faturaId: z.uuid(), tutar, karsilik: tutar.optional() })).min(2).max(500),
});
const otomatikSemasi = z.object({ acik: z.boolean() });

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const s = sema.safeParse(govde);
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
}

const MAHSUP_YAPAN = ["muhasebe"] as const;
const MAHSUP_GOREN = ["muhasebe", "satis", "salt_okunur", "mali_musavir"] as const;

/**
 * KSB-25: alış–satış faturası mahsubu. Mahsup yapma/geri alma muhasebe ve
 * yönetici; görüntüleme cari finans ayrıntılarını görebilen roller.
 */
@Controller()
export class CariMahsupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly eposta: EpostaService,
  ) {}

  /** Cari kartındaki panel: otomatik mahsup durumu, iki taraftaki açık faturalar ve mahsup geçmişi. */
  @Roller(...MAHSUP_GOREN)
  @Get("cari/:id/mahsup")
  async durum(@Param("id", ParseUUIDPipe) cariId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findUnique({ where: { id: cariId }, select: { otomatikMahsup: true } });
      if (!cari) throw new NotFoundException("Cari bulunamadı");
      const [adaylar, mahsuplar] = await Promise.all([
        mahsupAdaylari(tx, cariId),
        tx.cariMahsup.findMany({
          where: { cariId }, orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], take: 50,
          include: { kapamalar: { select: { tutar: true, fatura: { select: { id: true, no: true, tip: true, dovizCinsi: true } } } }, olusturan: { select: { adSoyad: true } } },
        }),
      ]);
      return {
        otomatikMahsup: cari.otomatikMahsup,
        // Mahsup edilebilir tutarı olanlar; ekranda açık tutar (otomatik kapamalar düşülmüş) gösterilir.
        adaylar: adaylar.filter((a) => a.mahsupEdilebilir.gt(0)).map((a) => ({
          id: a.id, no: a.no, tip: a.tip, taraf: a.taraf, tarih: a.tarih.toISOString().slice(0, 10), vadeTarihi: a.vadeTarihi?.toISOString().slice(0, 10) ?? null,
          dovizCinsi: a.dovizCinsi, genelToplam: a.genelToplam.toFixed(2), acik: a.acik.toFixed(2), mahsupEdilebilir: a.mahsupEdilebilir.toFixed(2),
        })),
        mahsuplar: mahsuplar.map((m) => ({
          id: m.id, tarih: m.tarih.toISOString().slice(0, 10), dovizCinsi: m.dovizCinsi, tutar: m.tutar.toFixed(2), aciklama: m.aciklama, otomatik: m.otomatik,
          olusturan: m.olusturan?.adSoyad ?? null, geriAlindi: Boolean(m.geriAlindiAt),
          faturalar: m.kapamalar.map((k) => ({ id: k.fatura.id, no: k.fatura.no, tip: k.fatura.tip, dovizCinsi: k.fatura.dovizCinsi, tutar: k.tutar.toFixed(2) })),
        })),
      };
    });
  }

  @Roller(...MAHSUP_YAPAN)
  @Post("cari/:id/mahsup")
  async olustur(@Param("id", ParseUUIDPipe) cariId: string, @Body() govde: unknown) {
    const g = ayristir(mahsupSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    const mahsup = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Denkleştirmeyle aynı kilit: eşzamanlı ödeme/mahsup birbirini ezmez.
      await tx.$queryRaw`SELECT id FROM cari_hesaplar WHERE id = ${cariId}::uuid FOR UPDATE`;
      const m = await mahsupYaz(tx, {
        tenantId, cariId, userId, tarih: new Date(`${g.tarih}T00:00:00Z`), dovizCinsi: g.dovizCinsi.toUpperCase(), aciklama: g.aciklama || null, otomatik: false,
        satirlar: g.satirlar.map((s) => ({ faturaId: s.faturaId, tutar: D(s.tutar), karsilik: s.karsilik ? D(s.karsilik) : undefined })),
      });
      // Mahsup elle kapamadır; otomatik kapamalar kalan faturalara yeniden dağılır.
      await cariDenklestir(tx, tenantId, cariId);
      return m;
    }, { timeout: 30_000 });
    return { id: mahsup.id, mesaj: `${mahsup.tutar.toFixed(2)} ${mahsup.dovizCinsi} mahsup edildi.` };
  }

  @Roller(...MAHSUP_YAPAN)
  @Post("cari-mahsuplari/:mahsupId/geri-al")
  @HttpCode(200)
  async geriAl(@Param("mahsupId", ParseUUIDPipe) mahsupId: string) {
    const { tenantId, userId } = aktifBaglam();
    const m = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.cariMahsup.findUnique({ where: { id: mahsupId }, select: { cariId: true } });
      if (!kayit) throw new NotFoundException("Mahsup bulunamadı");
      await tx.$queryRaw`SELECT id FROM cari_hesaplar WHERE id = ${kayit.cariId}::uuid FOR UPDATE`;
      const geri = await mahsupGeriAlYaz(tx, tenantId, mahsupId, userId);
      await cariDenklestir(tx, tenantId, geri.cariId);
      return geri;
    }, { timeout: 30_000 });
    const not = m.otomatik ? " Otomatik mahsup bu caride açıksa bir sonraki denkleştirmede yeniden yapılır; kalıcı geri almak için otomatik mahsubu kapatın." : "";
    return { mesaj: `Mahsup geri alındı; faturalar yeniden denkleştirildi.${not}` };
  }

  /** Cari kartındaki "Alış ve satış faturalarını otomatik mahsup et"; açılınca cari hemen denkleştirilir. */
  @Roller(...MAHSUP_YAPAN)
  @Put("cari/:id/otomatik-mahsup")
  async otomatik(@Param("id", ParseUUIDPipe) cariId: string, @Body() govde: unknown) {
    const { acik } = ayristir(otomatikSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const onceki = await tx.cariHesap.findUnique({ where: { id: cariId }, select: { otomatikMahsup: true, unvan: true } });
      if (!onceki) throw new NotFoundException("Cari bulunamadı");
      await tx.cariHesap.update({ where: { id: cariId }, data: { otomatikMahsup: acik } });
      if (onceki.otomatikMahsup !== acik) {
        await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_otomatik_mahsup_degisti", varlik: "cari", varlikId: cariId, detay: { unvan: onceki.unvan, eski: onceki.otomatikMahsup, yeni: acik } } });
      }
      if (acik) await cariDenklestir(tx, tenantId, cariId);
    }, { timeout: 30_000 });
    return { otomatikMahsup: acik, mesaj: acik ? "Otomatik mahsup açıldı; açık alış ve satış faturaları mahsup edildi." : "Otomatik mahsup kapatıldı; mevcut mahsuplar yerinde kalır." };
  }

  @Roller(...MAHSUP_GOREN)
  @Get("cari-mahsuplari/:mahsupId/pdf")
  async pdfIndir(@Param("mahsupId", ParseUUIDPipe) mahsupId: string, @Res() res: Response) {
    const { pdf, dosyaAdi } = await this.bildirimPdf(mahsupId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${dosyaAdi}`);
    res.send(pdf);
  }

  @Roller(...MAHSUP_YAPAN)
  @Post("cari-mahsuplari/:mahsupId/eposta")
  @HttpCode(200)
  async epostaGonder(@Param("mahsupId", ParseUUIDPipe) mahsupId: string, @Body() govde: unknown) {
    const { alici } = ayristir(z.object({ alici: z.email().optional() }), govde ?? {});
    const { pdf, dosyaAdi, cari, mahsup } = await this.bildirimPdf(mahsupId);
    const hedef = alici ?? cari.eposta;
    if (!hedef) throw new BadRequestException("Cari kartında e-posta adresi yok; alıcı girin");
    await this.eposta.ekliIletiGonder({
      alici: hedef,
      konu: `Alış–satış mahsup bildirimi — ${cari.unvan}`,
      metin: `Sayın Yetkili,\n\n${mahsup.tarih.toISOString().slice(0, 10)} tarihinde karşılıklı faturalarımız ${mahsup.tutar.toFixed(2)} ${mahsup.dovizCinsi} tutarında mahsup edilmiştir. Ayrıntılar ekteki bildirimdedir.\n\nSaygılarımızla`,
      ekler: [{ dosyaAdi, icerik: pdf, mime: "application/pdf" }],
    });
    return { mesaj: `Mahsup bildirimi ${hedef} adresine gönderildi` };
  }

  private async bildirimPdf(mahsupId: string) {
    const { tenantId } = aktifBaglam();
    const [veri, tema] = await Promise.all([
      this.prisma.tenantIslem(tenantId, async (tx) => {
        const mahsup = await tx.cariMahsup.findUnique({
          where: { id: mahsupId },
          include: {
            cari: { select: { kod: true, unvan: true, vknTckn: true, eposta: true } },
            kapamalar: { select: { tutar: true, kaynakTutari: true, fatura: { select: { no: true, tip: true, tarih: true, vadeTarihi: true, dovizCinsi: true, genelToplam: true } } } },
          },
        });
        if (!mahsup) throw new NotFoundException("Mahsup bulunamadı");
        const firma = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true },
        });
        if (!firma) throw new NotFoundException("Firma bulunamadı");
        return { mahsup, firma };
      }),
      this.pdf.belgeTemasi(),
    ]);
    const pdf = await this.pdf.htmlToPdf(mahsupBildirimiHtml(veri.mahsup, veri.firma, tema), { sayfaNumarasi: true });
    return { pdf, dosyaAdi: `mahsup-${veri.mahsup.cari.kod}-${veri.mahsup.tarih.toISOString().slice(0, 10)}.pdf`, cari: veri.mahsup.cari, mahsup: veri.mahsup };
  }
}
