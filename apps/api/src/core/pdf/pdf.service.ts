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
    secenekler?: { yatay?: boolean; yalitilmis?: boolean },
  ): Promise<Buffer> {
    const tarayici = await this.tarayiciAl();
    // Yalıtılmış kip yabancı kaynaklı HTML içindir (EBLG-29): betik çalışmaz,
    // hiçbir istek ağa çıkamaz. Kendi şablonlarımız varsayılan kipte basılır.
    const baglam = secenekler?.yalitilmis
      ? await tarayici.newContext({ javaScriptEnabled: false, offline: true })
      : null;
    const sayfa = baglam ? await baglam.newPage() : await tarayici.newPage();
    try {
      if (secenekler?.yalitilmis) await sayfa.route("**", (yol) => void yol.abort());
      await sayfa.setContent(html, { waitUntil: secenekler?.yalitilmis ? "domcontentloaded" : "load" });
      return await sayfa.pdf({
        format: "A4",
        landscape: secenekler?.yatay ?? false,
        printBackground: true,
        margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
      });
    } finally {
      await sayfa.close();
      await baglam?.close();
    }
  }

  /**
   * EBLG-28/29: yabancı bir XSLT'yi yalıtılmış bir sayfada uygulayıp ortaya
   * çıkan HTML'i verir. Dönüşüm Chromium'un yerleşik `XSLTProcessor`'ıyla
   * yapılır; sayfa çevrimdışıdır, her istek düşürülür ve sonuç DOM üzerinde
   * temizlenir (betik, çerçeve, dış kaynak ve olay öznitelikleri atılır).
   *
   * Bozuk, kötü niyetli ya da sonsuz döngüye giren XSLT `null` döndürür;
   * çağıran kendi yedek görünümüne düşer, PDF üretimi düşmez.
   */
  async xsltIleHtml(xml: string, xslt: string, zamanAsimiMs = 10_000): Promise<string | null> {
    const baglam = await (await this.tarayiciAl()).newContext({ offline: true });
    const sayfa = await baglam.newPage();
    let zamanlayici: NodeJS.Timeout | undefined;
    try {
      await sayfa.route("**", (yol) => void yol.abort());
      await sayfa.setContent("<!doctype html><html><body></body></html>", { waitUntil: "domcontentloaded" });
      const donusum = sayfa.evaluate<string | null, [string, string]>(([kaynak, bicem]) => {
        // Sunucu tarafı tsconfig'inde DOM tipleri yok; sayfa içinde kullanılan
        // arayüz burada yerel olarak tanımlanır.
        interface Oznitelik { name: string; value: string }
        interface Dugum {
          attributes: ArrayLike<Oznitelik>;
          remove(): void;
          removeAttribute(ad: string): void;
        }
        interface Belge {
          documentElement: unknown;
          querySelector(secici: string): unknown;
          querySelectorAll(secici: string): ArrayLike<Dugum>;
        }
        const tarayici = globalThis as unknown as {
          DOMParser: new () => { parseFromString(metin: string, tur: string): Belge };
          XSLTProcessor: new () => {
            importStylesheet(bicem: Belge): void;
            transformToDocument(kaynak: Belge): Belge | null;
          };
          XMLSerializer: new () => { serializeToString(belge: Belge): string };
        };

        const ayristirici = new tarayici.DOMParser();
        const xmlBelge = ayristirici.parseFromString(kaynak, "application/xml");
        const bicemBelge = ayristirici.parseFromString(bicem, "application/xml");
        if (xmlBelge.querySelector("parsererror") || bicemBelge.querySelector("parsererror")) return null;

        const islemci = new tarayici.XSLTProcessor();
        islemci.importStylesheet(bicemBelge);
        const sonuc = islemci.transformToDocument(xmlBelge);
        if (!sonuc?.documentElement) return null;

        // Görünüm yalnız metin ve biçimdir: çalışabilir ya da dışarı bağlanan
        // her şey atılır. Gömülü data: görselleri korunur.
        for (const dugum of Array.from(sonuc.querySelectorAll("script,iframe,object,embed,link,base,form,meta"))) {
          dugum.remove();
        }
        for (const dugum of Array.from(sonuc.querySelectorAll("*"))) {
          for (const oznitelik of Array.from(dugum.attributes)) {
            const ad = oznitelik.name.toLowerCase();
            const deger = oznitelik.value.trim().toLowerCase();
            const disKaynak = (ad === "src" || ad === "href" || ad === "srcset" || ad === "action") && !deger.startsWith("data:");
            if (ad.startsWith("on") || disKaynak || deger.startsWith("javascript:")) dugum.removeAttribute(oznitelik.name);
          }
        }
        return new tarayici.XMLSerializer().serializeToString(sonuc);
      }, [xml, xslt] as [string, string]);

      const zamanAsimi = new Promise<null>((coz) => {
        zamanlayici = setTimeout(() => coz(null), zamanAsimiMs);
      });
      return await Promise.race([donusum, zamanAsimi]);
    } catch (hata) {
      this.logger.warn(`Gömülü XSLT uygulanamadı, yedek görünüme düşülüyor: ${String(hata)}`);
      return null;
    } finally {
      if (zamanlayici) clearTimeout(zamanlayici);
      // Zaman aşımında sayfa hâlâ dönüşümle meşgul olabilir; bağlamı kapatmak
      // çalışmayı da sonlandırır.
      await baglam.close().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.tarayici?.close();
    this.tarayici = null;
  }
}
