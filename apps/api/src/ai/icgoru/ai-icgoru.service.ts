import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { UC } from "../ajan/araclar/uclar";
import { UcCagirici } from "../ajan/uc-cagirici";
import { trSimdi } from "../ai-zaman";
import {
  nakitTahsilatAnalizi,
  type AnalizBolumu,
  type IcgoruIcerigi,
  type NakitGirdisi,
  type OncelikGirdisi,
  type VadesiGecenGirdisi,
} from "./nakit-tahsilat-analizi";

const NAKIT_UFKU = "30";
const ONCELIK_ADEDI = "5";
const LISTE_SINIRI = 20;

const durumSemasi = z.object({ durum: z.enum(["yeni", "goruldu", "cozuldu"]) });

/**
 * AI-23/AI-24: nakit ve tahsilat analizini aktif kullanıcının kimliği ve rolüyle
 * ekran uçlarından hesaplar ve `ai_icgoruler`'e yazar. Model çağrısı yoktur.
 */
@Injectable()
export class AiIcgoruService {
  constructor(private readonly prisma: PrismaService, private readonly uc: UcCagirici) {}

  /** Rol bu uca erişemiyorsa null döner; başka hata yukarı çıkar (görev yeniden dener). */
  private async oku<T>(bolum: AnalizBolumu, erisimYok: AnalizBolumu[], cagri: () => Promise<T>): Promise<T | null> {
    try {
      return await cagri();
    } catch (hata) {
      if (hata instanceof ForbiddenException) {
        erisimYok.push(bolum);
        return null;
      }
      throw hata;
    }
  }

  async hesapla(): Promise<IcgoruIcerigi> {
    const erisimYok: AnalizBolumu[] = [];
    const nakit = await this.oku("nakit", erisimYok, () => this.uc.cagir<NakitGirdisi>(UC.nakitAkisi, [NAKIT_UFKU]));
    const vadesiGecenler = await this.oku("vadesiGecenler", erisimYok, () => this.uc.cagir<VadesiGecenGirdisi>(UC.vadesiGecenler, []));
    const oncelikler = await this.oku("oncelikler", erisimYok, () => this.uc.cagir<OncelikGirdisi[]>(UC.tahsilatOncelikleri, [ONCELIK_ADEDI]));
    return nakitTahsilatAnalizi({ nakit, vadesiGecenler, oncelikler, erisimYok });
  }

  /** Hesaplar ve kaydeder; aynı anahtar (görev + gün) varsa kaydı günceller. */
  async analizEt(secenek: { gorevId: string | null }): Promise<{ id: string; icerik: IcgoruIcerigi }> {
    const { tenantId, userId } = aktifBaglam();
    const icerik = await this.hesapla();
    const gun = trSimdi().gun;
    const tekilAnahtar = secenek.gorevId ? `gorev:${secenek.gorevId}:${gun}` : `elle:${gun}`;
    const veri = {
      userId,
      onem: icerik.onem,
      durum: "yeni",
      baslik: icerik.baslik,
      ozet: icerik.ozet,
      metrikler: icerik.metrikler as Prisma.InputJsonValue,
      bulgular: icerik.bulgular as unknown as Prisma.InputJsonValue,
      kanitlar: icerik.kanitlar as unknown as Prisma.InputJsonValue,
      varsayimlar: icerik.varsayimlar,
      uyarilar: icerik.uyarilar,
      hesaplandiAt: new Date(),
    };
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.aiIcgoru.upsert({
        where: { tenantId_tekilAnahtar: { tenantId, tekilAnahtar } },
        create: { tenantId, gorevId: secenek.gorevId, tekilAnahtar, ...veri },
        update: veri,
        select: { id: true },
      }),
    );
    return { id: kayit.id, icerik };
  }

  async listele(tumu: boolean) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.aiIcgoru.findMany({
        where: { tenantId, ...(tumu ? {} : { durum: { not: "cozuldu" } }) },
        orderBy: { hesaplandiAt: "desc" },
        take: LISTE_SINIRI,
        include: { gorev: { select: { ad: true } } },
      });
      const kullanicilar = await tx.user.findMany({ where: { id: { in: [...new Set(kayitlar.map((k) => k.userId))] } }, select: { id: true, adSoyad: true } });
      const ad = new Map(kullanicilar.map((k) => [k.id, k.adSoyad]));
      return kayitlar.map(({ gorev, tenantId: _t, tekilAnahtar: _a, ...k }) => ({ ...k, gorevAdi: gorev?.ad ?? null, hesaplayan: ad.get(k.userId) ?? null }));
    });
  }

  async durumGuncelle(id: string, girdi: unknown) {
    const sonuc = durumSemasi.safeParse(girdi);
    if (!sonuc.success) throw new BadRequestException("Durum yeni, goruldu ya da cozuldu olmalıdır.");
    const { tenantId } = aktifBaglam();
    const guncellenen = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiIcgoru.updateMany({ where: { id, tenantId }, data: { durum: sonuc.data.durum } }));
    if (!guncellenen.count) throw new NotFoundException("İçgörü bulunamadı.");
    return { id, durum: sonuc.data.durum };
  }
}
