import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { type Browser, chromium } from "playwright";
import { DepoService } from "../../ekler/depo.service";
import { aktifBaglam } from "../istek-baglami";
import { PrismaService } from "../prisma.service";

/**
 * T-02: HTML→PDF üretimi (Playwright/Chromium — 4. aşama S-01 kararı).
 * Tarayıcı tembel başlatılır ve süreç boyunca tek örnek yaşar; her üretim
 * kendi sayfasında çalışır ve sayfa işi bitince kapatılır.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private tarayici: Browser | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly depo: DepoService,
  ) {}

  /**
   * KLN-03: firma logosunu data URI olarak verir (PDF'ler dış kaynak
   * yükleyemez). Logo yoksa veya depo erişilemezse PDF logosuz üretilir.
   */
  async firmaLogoDataUri(): Promise<string | undefined> {
    const { tenantId } = aktifBaglam();
    const logo = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ek.findFirst({
        where: { sahipTur: "firma", sahipId: tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    if (!logo) return undefined;

    try {
      const icerik = await this.depo.indir(logo.depoAnahtari);
      return `data:${logo.mimeTip};base64,${icerik.toString("base64")}`;
    } catch (hata) {
      this.logger.warn(`Firma logosu okunamadı, PDF logosuz üretiliyor: ${String(hata)}`);
      return undefined;
    }
  }

  private async tarayiciAl(): Promise<Browser> {
    if (!this.tarayici || !this.tarayici.isConnected()) {
      this.tarayici = await chromium.launch({
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }
    return this.tarayici;
  }

  async htmlToPdf(
    html: string,
    secenekler?: { yatay?: boolean },
  ): Promise<Buffer> {
    const sayfa = await (await this.tarayiciAl()).newPage();
    try {
      await sayfa.setContent(html, { waitUntil: "load" });
      return await sayfa.pdf({
        format: "A4",
        landscape: secenekler?.yatay ?? false,
        printBackground: true,
        margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
      });
    } finally {
      await sayfa.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.tarayici?.close();
    this.tarayici = null;
  }
}
