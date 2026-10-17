import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { type Browser, chromium } from "playwright";
import { DepoService } from "../../ekler/depo.service";
import { AyarlarService } from "../ayarlar/ayarlar.service";
import {
  type BelgeTemasi,
  renkNormalize,
  sablonNormalize,
} from "./belge-temasi";
import { BELGE_GORUNUMU_MODULU, type BelgeGorunumu, gorunumNormalize } from "./belge-gorunumu";
import { aktifBaglam } from "../istek-baglami";
import { PrismaService } from "../prisma.service";

/**
 * T-02: HTML→PDF üretimi (Playwright/Chromium — 4. aşama S-01 kararı).
 * Tarayıcı tembel başlatılır ve süreç boyunca tek örnek yaşar; her üretim
 * kendi sayfasında çalışır ve sayfa işi bitince kapatılır.
 */
/** A4 dikey, 12 mm yan ve 14 mm üst/alt kenarla yazdırılabilir alan (CSS px, 96 dpi). */
const YAZDIRILABILIR_GENISLIK_PX = Math.floor((186 / 25.4) * 96);
const YAZDIRILABILIR_YUKSEKLIK_PX = Math.floor((269 / 25.4) * 96);
/** Tek sayfaya sığdırmada okunurluğu bozmayacak en küçük ölçek. */
const EN_KUCUK_OLCEK = 0.88;

/** PDF'teki sayfa nesnelerinin sayısı (Chromium çıktısı sıkıştırılmamış nesne başlıkları yazar). */
export function pdfSayfaSayisi(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private tarayici: Browser | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly depo: DepoService,
    private readonly ayarlar: AyarlarService,
  ) {}

  /**
   * FTR-22/23: kiracının belge teması. Şablon ve vurgu rengi fatura modülü
   * ayarlarından, logo firma kartından gelir; ayar okunamazsa varsayılan
   * şablonla basılır — belge basımı ayar yüzünden düşmez.
   */
  async belgeTemasi(): Promise<BelgeTemasi> {
    const logoDataUri = await this.firmaLogoDataUri();
    try {
      const [ayar, gorunum] = await Promise.all([this.ayarlar.getir("fatura"), this.ayarlar.getir(BELGE_GORUNUMU_MODULU)]);
      return {
        sablon: sablonNormalize(ayar.faturaSablonu),
        // FTR-42: Belge Görünümü'nde ana renk seçildiyse raporlar da onu kullanır.
        vurguRengi: renkNormalize(gorunum.anaRenk ?? ayar.vurguRengi),
        logoDataUri,
      };
    } catch (hata) {
      this.logger.warn(`Belge teması okunamadı, varsayılan şablon kullanılıyor: ${String(hata)}`);
      return { sablon: "standart", vurguRengi: renkNormalize(undefined), logoDataUri };
    }
  }

  /**
   * FTR-42: ticari belgelerin görünüm ayarı. Ana renk seçilmemişse fatura
   * ayarındaki vurgu rengi (FTR-23) devam eder; ayar okunamazsa varsayılan
   * görünümle basılır.
   */
  async belgeGorunumu(): Promise<BelgeGorunumu> {
    try {
      const [ayar, fatura] = await Promise.all([this.ayarlar.getir(BELGE_GORUNUMU_MODULU), this.ayarlar.getir("fatura")]);
      return gorunumNormalize({ anaRenk: renkNormalize(fatura.vurguRengi), ...ayar });
    } catch (hata) {
      this.logger.warn(`Belge görünümü okunamadı, varsayılan kullanılıyor: ${String(hata)}`);
      return gorunumNormalize({});
    }
  }

  /**
   * KLN-03: firma logosunu data URI olarak verir (PDF'ler dış kaynak
   * yükleyemez). Logo yoksa veya depo erişilemezse PDF logosuz üretilir.
   */
  async firmaLogoDataUri(): Promise<string | undefined> {
    return this.firmaGorseliDataUri("firma");
  }

  /** FTR-42: imza alanına basılan kaşe/imza görseli; yoksa alan boş kalır. */
  async firmaKaseDataUri(): Promise<string | undefined> {
    return this.firmaGorseliDataUri("firma_kase");
  }

  private async firmaGorseliDataUri(sahipTur: "firma" | "firma_kase"): Promise<string | undefined> {
    const { tenantId } = aktifBaglam();
    const logo = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.ek.findFirst({
        where: { sahipTur, sahipId: tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    // Yalnız resim basılır; görsel yerine yüklenmiş PDF/belge sessizce atlanır.
    if (!logo || !/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(logo.mimeTip)) return undefined;

    try {
      const icerik = await this.depo.indir(logo.depoAnahtari);
      return `data:${logo.mimeTip};base64,${icerik.toString("base64")}`;
    } catch (hata) {
      this.logger.warn(`Firma görseli (${sahipTur}) okunamadı, PDF onsuz üretiliyor: ${String(hata)}`);
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
    secenekler?: {
      yatay?: boolean; yalitilmis?: boolean; sayfaNumarasi?: boolean; altBilgi?: string;
      /** Az taşan iki sayfalık belgeyi hafif küçülterek tek sayfaya alır; ticari belgelerde (altBilgi) varsayılan açık. */
      tekSayfayaSigdir?: boolean;
    },
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
      const bas = (scale = 1) => sayfa.pdf({
        scale,
        format: "A4",
        landscape: secenekler?.yatay ?? false,
        printBackground: true,
        margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
        // CARI-24: çok sayfalı raporlarda "Sayfa X / Y"; alt kenar boşluğuna basılır.
        // FTR-38: ticari belgeler kendi sayfa altını (firma, belge no, dilinde "Sayfa X/Y") verir.
        ...(secenekler?.altBilgi
          ? { displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: secenekler.altBilgi }
          : secenekler?.sayfaNumarasi
          ? {
              displayHeaderFooter: true,
              headerTemplate: "<span></span>",
              footerTemplate: `<div style="width:100%;font-size:7pt;color:#9ca3af;padding:0 12mm;text-align:right;font-family:Arial,sans-serif">Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
            }
          : {}),
      });
      const ilk = await bas();
      if (!(secenekler?.tekSayfayaSigdir ?? Boolean(secenekler?.altBilgi)) || pdfSayfaSayisi(ilk) !== 2) return ilk;
      // Çift dilli etiketler gibi birkaç satırlık taşma (ör. yalnız imza bloğu) ikinci sayfa açmasın:
      // içerik yüksekliği yazdırılabilir alanla ölçülür, taşma küçükse en çok %12 küçültülerek yeniden basılır.
      if (secenekler?.yatay) return ilk;
      await sayfa.setViewportSize({ width: YAZDIRILABILIR_GENISLIK_PX, height: YAZDIRILABILIR_YUKSEKLIK_PX });
      await sayfa.emulateMedia({ media: "print" });
      const yukseklik = Number(await sayfa.evaluate("document.documentElement.scrollHeight"));
      const gereken = YAZDIRILABILIR_YUKSEKLIK_PX / yukseklik;
      if (gereken < EN_KUCUK_OLCEK) return ilk;
      for (const olcek of [Math.min(0.98, gereken * 0.98), EN_KUCUK_OLCEK]) {
        const kucuk = await bas(Math.max(EN_KUCUK_OLCEK, olcek));
        if (pdfSayfaSayisi(kucuk) === 1) return kucuk;
      }
      return ilk;
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
