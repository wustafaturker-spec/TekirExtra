import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, forwardRef } from "@nestjs/common";
import type { AiIslemKaynagi, AiOnayTalebi, Prisma } from "@prisma/client";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { aracBul } from "../ajan/araclar";
import { UcCagirici } from "../ajan/uc-cagirici";
import { icerikOzeti, type OnayOnizlemesi } from "../ajan/araclar/arac";

/** AI-04: talep 24 saat geçerlidir. */
export const ONAY_TALEBI_SURESI_MS = 24 * 60 * 60 * 1000;

/**
 * Onaylanan işlem çalışırken süreç çökerse (yeniden başlatma, OOM) talep
 * "isleniyor" durumunda kalır. Bu süreyi aşan talepler sonucu belirsiz olarak
 * kapatılır. İşlem yan etki üretmiş olabileceğinden yeniden ÇALIŞTIRILMAZ.
 */
export const ASKIDA_KALMA_SURESI_MS = 15 * 60 * 1000;
export const ASKIDA_KALAN_TALEP_HATASI =
  "İşlem yarıda kesildi; sonucu belirsiz. Kaydın oluşup oluşmadığını ilgili ekrandan kontrol edin, gerekirse işlemi yeniden isteyin.";

const bildirimAnahtari = (id: string) => `yapay_zeka:talep:${id}`;

export interface OnayTalebiGorunumu {
  id: string;
  arac: string;
  ozet: string;
  onizleme: OnayOnizlemesi | null;
  kaynak: AiIslemKaynagi;
  durum: string;
  gecerlilikSonu: string;
  createdAt: string;
  kararAt: string | null;
  sonuc: unknown;
  hata: string | null;
}

function gorunum(t: AiOnayTalebi): OnayTalebiGorunumu {
  return {
    id: t.id,
    arac: t.arac,
    ozet: t.ozet,
    onizleme: (t.onizleme as unknown as OnayOnizlemesi | null) ?? null,
    kaynak: t.kaynak,
    durum: t.durum,
    gecerlilikSonu: t.gecerlilikSonu.toISOString(),
    createdAt: t.createdAt.toISOString(),
    kararAt: t.kararAt?.toISOString() ?? null,
    sonuc: t.sonuc,
    hata: t.hata,
  };
}

function hataMetni(hata: unknown): string {
  if (hata && typeof hata === "object" && "getResponse" in hata && typeof (hata as { getResponse: unknown }).getResponse === "function") {
    const yanit = (hata as { getResponse: () => unknown }).getResponse();
    if (typeof yanit === "string") return yanit;
    const mesaj = (yanit as { message?: unknown })?.message;
    if (Array.isArray(mesaj)) return mesaj.join("; ");
    if (typeof mesaj === "string") return mesaj;
  }
  return hata instanceof Error ? hata.message : "İşlem tamamlanamadı";
}

/**
 * AI-04: onaya tabi işlemler talep olarak bekler; yalnız isteyen kullanıcı
 * onaylar ya da reddeder. Onayda araç, ekranın ucuyla ve onaylayanın o anki
 * rolüyle çalışır; parametreler talepte saklandığı gibi kullanılır.
 */
@Injectable()
export class AiOnayService {
  private readonly logger = new Logger(AiOnayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uc: UcCagirici,
    @Inject(forwardRef(() => BildirimService))
    private readonly bildirimler: BildirimService,
  ) {}

  async olustur(girdi: { arac: string; parametreler: unknown; ozet: string; onizleme?: OnayOnizlemesi | null; hedefOzeti?: string | null; kaynak: AiIslemKaynagi; oturumId?: string | null }): Promise<OnayTalebiGorunumu> {
    const { tenantId, userId } = aktifBaglam();
    const talep = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiOnayTalebi.create({
        data: {
          tenantId,
          userId,
          oturumId: girdi.oturumId ?? null,
          kaynak: girdi.kaynak,
          arac: girdi.arac,
          parametreler: JSON.parse(JSON.stringify(girdi.parametreler ?? {})) as Prisma.InputJsonValue,
          ozet: girdi.ozet,
          onizleme: girdi.onizleme ? JSON.parse(JSON.stringify(girdi.onizleme)) as Prisma.InputJsonValue : undefined,
          gecerlilikSonu: new Date(Date.now() + ONAY_TALEBI_SURESI_MS),
          hedefOzeti: girdi.hedefOzeti ?? null,
        },
      }),
    );
    await this.bildirimler
      .uret({
        tur: "yapay_zeka",
        onem: "uyari",
        baslik: girdi.kaynak === "mcp" ? "MCP işlemi onayınızı bekliyor" : girdi.kaynak === "otomasyon" ? "E-posta teklif talebi onayınızı bekliyor" : "Asistan işlemi onayınızı bekliyor",
        aciklama: girdi.ozet.slice(0, 500),
        birlesimAnahtari: bildirimAnahtari(talep.id),
        kaynakTur: "ai_onay_talebi",
        kaynakRef: talep.id,
        hedefYol: `/panel/ai?talep=${talep.id}`,
        roller: [],
        kullaniciIdler: [userId],
      })
      .catch((hata: unknown) => this.logger.warn(`Onay talebi bildirimi üretilemedi: ${String(hata)}`));
    return gorunum(talep);
  }

  /** Kullanıcının kendi talepleri; süresi dolan bekleyenler okunurken kapanır. */
  async listele(durum?: string): Promise<OnayTalebiGorunumu[]> {
    const { tenantId, userId } = aktifBaglam();
    await this.sureleriKapat();
    const talepler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiOnayTalebi.findMany({
        where: { userId, ...(durum === "bekliyor" ? { durum: "bekliyor" } : {}) },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    return talepler.map(gorunum);
  }

  async onayla(id: string): Promise<OnayTalebiGorunumu> {
    const { tenantId } = aktifBaglam();
    const talep = await this.kendiTalebi(id);
    if (talep.gecerlilikSonu < new Date()) {
      await this.sureleriKapat();
      throw new BadRequestException("Talebin süresi doldu; işlemi yeniden isteyin.");
    }
    const arac = aracBul(talep.arac);
    if (!arac || arac.sinif !== "onay") throw new BadRequestException("Talepteki işlem artık tanımlı değil.");

    // Aynı talep iki kez çalışmasın: yalnız bekleyen talep işlenmeye alınır.
    const alinan = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiOnayTalebi.updateMany({ where: { id, durum: "bekliyor" }, data: { durum: "isleniyor", kararAt: new Date() } }),
    );
    if (alinan.count === 0) throw new ConflictException("Talep zaten karara bağlanmış.");

    let sonuc: unknown = null;
    let hata: string | null = null;
    let hedefDegisti = false;
    try {
      const girdi = arac.girdi.parse(talep.parametreler);
      const baglam = { uc: this.uc, kaynak: talep.kaynak, arac: arac.ad, talepId: id };
      // AI-27: talepten sonra kayıt değiştiyse kullanıcı görmediği içeriği onaylamış olur.
      if (talep.hedefOzeti && arac.hedefDurumu && icerikOzeti(await arac.hedefDurumu(baglam, girdi)) !== talep.hedefOzeti) {
        hedefDegisti = true;
        hata = "Kayıt bu talep açıldıktan sonra değişti; işlem yapılmadı. Güncel hâliyle yeniden isteyin.";
      } else {
        sonuc = await arac.calistir(baglam, girdi);
      }
    } catch (e) {
      hata = hataMetni(e);
    }
    const durum = hedefDegisti ? "hedef_degisti" : hata ? "hata" : "onaylandi";
    const guncel = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiOnayTalebi.update({
        where: { id },
        data: { durum, sonuc: sonuc == null ? undefined : (JSON.parse(JSON.stringify(sonuc)) as Prisma.InputJsonValue), hata },
      }),
    );
    await this.bildirimiKapat(id);
    return gorunum(guncel);
  }

  async reddet(id: string): Promise<OnayTalebiGorunumu> {
    const { tenantId } = aktifBaglam();
    await this.kendiTalebi(id);
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiOnayTalebi.updateMany({ where: { id, durum: "bekliyor" }, data: { durum: "reddedildi", kararAt: new Date() } }),
    );
    if (sonuc.count === 0) throw new ConflictException("Talep zaten karara bağlanmış.");
    await this.bildirimiKapat(id);
    return gorunum(await this.kendiTalebi(id));
  }

  private async kendiTalebi(id: string): Promise<AiOnayTalebi> {
    const { tenantId, userId } = aktifBaglam();
    const talep = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiOnayTalebi.findUnique({ where: { id } }));
    if (!talep) throw new NotFoundException("Onay talebi bulunamadı");
    if (talep.userId !== userId) throw new ForbiddenException("Talebi yalnız isteyen kullanıcı onaylayabilir.");
    return talep;
  }

  private async sureleriKapat(): Promise<void> {
    const { tenantId, userId } = aktifBaglam();
    const dolanlar = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.aiOnayTalebi.findMany({
        where: { userId, durum: "bekliyor", gecerlilikSonu: { lt: new Date() } },
        select: { id: true },
      });
      if (kayitlar.length) {
        await tx.aiOnayTalebi.updateMany({ where: { id: { in: kayitlar.map((k) => k.id) } }, data: { durum: "suresi_doldu" } });
      }
      const askidakiler = await tx.aiOnayTalebi.findMany({
        where: { userId, durum: "isleniyor", kararAt: { lt: new Date(Date.now() - ASKIDA_KALMA_SURESI_MS) } },
        select: { id: true },
      });
      if (askidakiler.length) {
        // Koşul tekrarlanır: bu arada tamamlanan talebin sonucu ezilmesin.
        await tx.aiOnayTalebi.updateMany({
          where: { id: { in: askidakiler.map((k) => k.id) }, durum: "isleniyor" },
          data: { durum: "hata", hata: ASKIDA_KALAN_TALEP_HATASI },
        });
      }
      return [...kayitlar, ...askidakiler];
    });
    for (const k of dolanlar) await this.bildirimiKapat(k.id);
  }

  private async bildirimiKapat(id: string): Promise<void> {
    await this.bildirimler
      .kapatEksikleri("yapay_zeka", [], [bildirimAnahtari(id)])
      .catch((hata: unknown) => this.logger.warn(`Onay talebi bildirimi kapatılamadı: ${String(hata)}`));
  }
}
