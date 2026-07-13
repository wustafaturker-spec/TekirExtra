import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { type Browser, chromium } from "playwright";

/**
 * T-02: HTML→PDF üretimi (Playwright/Chromium — 4. aşama S-01 kararı).
 * Tarayıcı tembel başlatılır ve süreç boyunca tek örnek yaşar; her üretim
 * kendi sayfasında çalışır ve sayfa işi bitince kapatılır.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private tarayici: Browser | null = null;

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
