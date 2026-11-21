import { BadRequestException, HttpException, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { DagitikRateLimiter } from "../../core/guvenlik/rate-limiter";
import { aiOzellikDenetle, aiOzellikKapaliMi } from "../ozellik-kapisi";
import { kiraciSaglayicisi } from "../saglayici/kiraci-saglayici";
import type { IAiProvider } from "../saglayici/ai-provider.interface";
import { UcCagirici } from "../ajan/uc-cagirici";
import { EKRAN_TURLERI, ekranKaydiOku, type EkranTuru } from "../ajan/ai-ajan.service";
import {
  DAKIKA_SINIRI, METIN_AZAMI, oneriGirdisi, oneriIstemi, oneriyiTemizle, rakamKaynaktaMi, yenidenYazGirdisi, yenidenYazIstemi,
} from "./metin-kurallari";

/**
 * AI-115: metin alanında devam önerisi ve seçili metni yeniden yazma. Ayrı özellik (`metin`):
 * çağrı izinde ve kotada ayrı sayılır, AI-109 anahtarı `metin_tamamlama`. Kayıt bağlamı yalnız
 * kullanıcının rolüyle ekran ucundan okunur. Yurt dışı onayı yoksa ya da sağlayıcı tanımsızsa
 * `durum` kullanılamaz döner ve bileşen düz alan olarak çalışır.
 */
@Injectable()
export class MetinTamamlamaService implements OnModuleDestroy {
  private readonly logger = new Logger(MetinTamamlamaService.name);
  private sinirlayici?: Promise<DagitikRateLimiter>;

  constructor(private readonly prisma: PrismaService, private readonly uc: UcCagirici) {}

  /** Testlerde değiştirilebilir. */
  saglayiciBul = async (tenantId: string): Promise<IAiProvider> => (await kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "metin" })).saglayici;

  async onModuleDestroy(): Promise<void> {
    await (await this.sinirlayici)?.kapat();
  }

  async durum(): Promise<{ kullanilabilir: boolean; kisiselAcik: boolean }> {
    const { tenantId, userId } = aktifBaglam();
    const kisiselAcik = await this.kisiselAcikMi(tenantId, userId);
    if (!kisiselAcik || (await aiOzellikKapaliMi(this.prisma, tenantId, "metin_tamamlama"))) return { kullanilabilir: false, kisiselAcik };
    const saglayici = await this.saglayiciBul(tenantId).catch(() => null);
    return { kullanilabilir: !!saglayici && saglayici.saglayiciAdi !== "tanimsiz", kisiselAcik };
  }

  async tercihKaydet(acik: unknown): Promise<{ kullanilabilir: boolean; kisiselAcik: boolean }> {
    if (typeof acik !== "boolean") throw new BadRequestException("acik true ya da false olmalıdır.");
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.user.update({ where: { id: userId }, data: { aiMetinTamamlama: acik } }));
    return this.durum();
  }

  async oneri(govde: unknown): Promise<{ oneri: string | null }> {
    const g = oneriGirdisi.safeParse(govde);
    if (!g.success) throw new BadRequestException("Geçersiz öneri isteği.");
    if (g.data.metin.trim().length < 3) return { oneri: null };
    const { saglayici, kayitOzeti } = await this.hazirla(g.data.kayit);
    const { sistemRol, prompt } = oneriIstemi(g.data.alan, g.data.metin, kayitOzeti);
    const oneri = oneriyiTemizle(await saglayici.metinUret({ sistemRol, prompt, dusunmeKapali: true }), g.data.metin);
    // (e) Rakam üreten öneri gösterilmez; boş öneri de yok sayılır.
    if (!oneri.trim() || !rakamKaynaktaMi(oneri, `${g.data.metin} ${kayitOzeti ?? ""}`)) return { oneri: null };
    return { oneri };
  }

  async yenidenYaz(govde: unknown): Promise<{ metin: string }> {
    const g = yenidenYazGirdisi.safeParse(govde);
    if (!g.success) throw new BadRequestException("Geçersiz yeniden yazma isteği.");
    const { saglayici, kayitOzeti } = await this.hazirla(g.data.kayit);
    const { sistemRol, prompt } = yenidenYazIstemi(g.data.alan, g.data.metin, g.data.kip, kayitOzeti);
    const ham = (await saglayici.metinUret({ sistemRol, prompt, dusunmeKapali: true })).replace(/^```[a-z]*\n?|```$/gi, "").replace(/^\s*["“]|["”]\s*$/g, "").trim();
    if (!ham || ham.length > METIN_AZAMI || !rakamKaynaktaMi(ham, `${g.data.metin} ${kayitOzeti ?? ""}`)) {
      throw new BadRequestException("Yeniden yazılan metin doğrulanamadı; metniniz değiştirilmedi.");
    }
    return { metin: ham };
  }

  /** Kişisel tercih, özellik kapısı, dakika sınırı, sağlayıcı ve (varsa) kayıt özeti. */
  private async hazirla(kayit?: { tur: string; id: string }): Promise<{ saglayici: IAiProvider; kayitOzeti: string | null }> {
    const { tenantId, userId } = aktifBaglam();
    if (!(await this.kisiselAcikMi(tenantId, userId))) throw new HttpException("Metin önerileri hesabınızda kapalı.", 409);
    await aiOzellikDenetle(this.prisma, tenantId, "metin_tamamlama");
    const sinir = await (this.sinirlayici ??= DagitikRateLimiter.olustur(DAKIKA_SINIRI, 60_000, process.env.REDIS_URL));
    if (!(await sinir.tuket(`ai-metin:${tenantId}:${userId}`)).izinli) throw new HttpException("Metin önerisi sınırına ulaşıldı; bir dakika sonra yeniden deneyin.", 429);
    const saglayici = await this.saglayiciBul(tenantId);
    let kayitOzeti: string | null = null;
    if (kayit && (EKRAN_TURLERI as readonly string[]).includes(kayit.tur)) {
      // Kullanıcı kaydı göremiyorsa uç hata verir; öneri bağlamsız sürer.
      const k = await ekranKaydiOku(this.uc, kayit.tur as EkranTuru, kayit.id).catch(() => null);
      if (k) kayitOzeti = [k.etiket, ...Object.entries(k.alanlar ?? {}).filter(([, v]) => v).map(([a, v]) => `${a}: ${v}`)].join(" · ").slice(0, 400);
    }
    return { saglayici, kayitOzeti };
  }

  private async kisiselAcikMi(tenantId: string, userId: string): Promise<boolean> {
    const u = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { aiMetinTamamlama: true } }));
    return u?.aiMetinTamamlama !== false;
  }
}
