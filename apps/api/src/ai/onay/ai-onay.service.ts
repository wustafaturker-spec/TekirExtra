import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { AiIslemKaynagi, AiOnayTalebi, Prisma } from "@prisma/client";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { aracBul } from "../ajan/araclar";
import { UcCagirici } from "../ajan/uc-cagirici";

/** AI-04: talep 24 saat geçerlidir. */
export const ONAY_TALEBI_SURESI_MS = 24 * 60 * 60 * 1000;

const bildirimAnahtari = (id: string) => `yapay_zeka:talep:${id}`;

export interface OnayTalebiGorunumu {
  id: string;
  arac: string;
  ozet: string;
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
    private readonly bildirimler: BildirimService,
  ) {}

  async olustur(girdi: { arac: string; parametreler: unknown; ozet: string; kaynak: AiIslemKaynagi; oturumId?: string | null }): Promise<OnayTalebiGorunumu> {
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
          gecerlilikSonu: new Date(Date.now() + ONAY_TALEBI_SURESI_MS),
        },
      }),
    );
    await this.bildirimler
      .uret({
        tur: "yapay_zeka",
        onem: "uyari",
        baslik: girdi.kaynak === "mcp" ? "MCP işlemi onayınızı bekliyor" : "Asistan işlemi onayınızı bekliyor",
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
    try {
      const girdi = arac.girdi.parse(talep.parametreler);
      sonuc = await arac.calistir({ uc: this.uc, kaynak: talep.kaynak, arac: arac.ad, talepId: id }, girdi);
    } catch (e) {
      hata = hataMetni(e);
    }
    const guncel = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiOnayTalebi.update({
        where: { id },
        data: { durum: hata ? "hata" : "onaylandi", sonuc: sonuc == null ? undefined : (JSON.parse(JSON.stringify(sonuc)) as Prisma.InputJsonValue), hata },
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
      return kayitlar;
    });
    for (const k of dolanlar) await this.bildirimiKapat(k.id);
  }

  private async bildirimiKapat(id: string): Promise<void> {
    await this.bildirimler
      .kapatEksikleri("yapay_zeka", [], [bildirimAnahtari(id)])
      .catch((hata: unknown) => this.logger.warn(`Onay talebi bildirimi kapatılamadı: ${String(hata)}`));
  }
}
