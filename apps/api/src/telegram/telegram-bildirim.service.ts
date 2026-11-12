import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Rol } from "@tekirextra/shared";
import { AiAjanService } from "../ai/ajan/ai-ajan.service";
import { UcCagirici } from "../ai/ajan/uc-cagirici";
import { istanbulAyBaslangici, trSimdi } from "../ai/ai-zaman";
import { brifingMetni, brifingVerisiTopla } from "../ai/icgoru/gunluk-brifing";
import { aiButcesiDoldu } from "../ai/saglayici/kiraci-saglayici";
import { sessizSaatte, trDakika } from "../bildirimler/bildirim-eposta.service";
import { baglamlaCalistir, type IstekBaglami } from "../core/istek-baglami";
import { nabizla } from "../core/nabiz/nabiz";
import { PrismaService } from "../core/prisma.service";
import { ACIK_SORU_SINIRI, TELEGRAM_SORU_OMRU_MS } from "../asistan-soru/asistan-soru.kurallari";
import { telegramAyariOku } from "./telegram-ayar";
import {
  bildirimMesaji, brifingMaddeleri, brifingZamaniMi, gunBasi, TELEGRAM_BILDIRIM_PENCERESI_MS, teslimatlariSec, tercihCoz, type AdayTeslimat, type TelegramTercihi,
} from "./telegram-bildirim.kurallari";
import { TelegramKanalService } from "./telegram-kanal.service";
import { TelegramService } from "./telegram.service";

const ARALIK_MS = 60_000;
const ADAY_SINIRI = 50;
/** Günlük sınıra sayılan kendiliğinden mesaj türleri (brifing ayrıdır). */
const SAYILAN_TURLER = ["bildirim", "ozet", "soru"];

/**
 * CNL-06/07/08/12: kendiliğinden Telegram mesajları. Yalnız Telegram sürecinde ve süreçler arası
 * tek turla (nabız kilidi) çalışır. Firma yalnız bağ işlevinden gelir, her firma ve her kullanıcı
 * kendi RLS bağlamında işlenir; bir firmanın hatası ötekileri durdurmaz (CNL-17e). Mesajlar modelsizdir.
 */
@Injectable()
export class TelegramBildirimService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBildirimService.name);
  private zamanlayici?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly kanal: TelegramKanalService,
    private readonly ajan: AiAjanService,
    private readonly uc: UcCagirici,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_TELEGRAM !== "1" || !process.env.TELEGRAM_BOT_TOKEN?.trim()) return;
    this.zamanlayici = setInterval(() => void nabizla("telegram-bildirim", () => this.tara(), ARALIK_MS), ARALIK_MS);
    this.zamanlayici.unref();
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  async tara(simdi = new Date()): Promise<void> {
    const firmalar = await this.prisma.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id::text FROM telegram_bagli_firmalar()`;
    for (const { tenant_id: tenantId } of firmalar) {
      try {
        await this.firmaTara(tenantId, simdi);
      } catch (hata) {
        // Hata metni firma verisi içermez; sistem sağlığında yalnız tür görünür (CNL-17f).
        this.logger.error(`Telegram kendiliğinden mesaj taraması bir firmada başarısız: ${hata instanceof Error ? hata.name : "bilinmeyen"}`);
      }
    }
  }

  private async firmaTara(tenantId: string, simdi: Date): Promise<void> {
    const { ayar, baglar } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      ayar: await telegramAyariOku(tx, tenantId),
      baglar: await tx.telegramBagi.findMany({ select: { userId: true, oturumSurumu: true, createdAt: true } }),
    }));
    if (!ayar.etkin) return;
    let butce: Promise<boolean> | undefined;
    const butceDolu = () => (butce ??= aiButcesiDoldu(this.prisma, tenantId));
    for (const bag of baglar) {
      try {
        await this.kullaniciTara(tenantId, bag, simdi, butceDolu);
      } catch (hata) {
        this.logger.error(`Telegram kendiliğinden mesajı bir kullanıcıda işlenemedi: ${hata instanceof Error ? hata.name : "bilinmeyen"}`);
      }
    }
  }

  private async kullaniciTara(tenantId: string, bag: { userId: string; oturumSurumu: number; createdAt: Date }, simdi: Date, butceDolu: () => Promise<boolean>): Promise<void> {
    const { userId } = bag;
    const karar = await this.telegram.bagKarari(tenantId, userId, bag);
    if (karar.neden && karar.neden !== "rol_kapali") { await this.telegram.bagDusur(tenantId, userId, karar.neden); return; }
    if (karar.neden === "rol_kapali") return;
    const baglam: IstekBaglami = { tenantId, userId, rol: karar.rol as Rol, ...(karar.ozelRol ? { ozelRol: karar.ozelRol } : {}), paketModulleri: karar.moduller };
    await baglamlaCalistir(baglam, async () => {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.bildirimKullaniciAyari.findUnique({ where: { userId } }));
      const t = tercihCoz(kayit);
      await this.bildirimleriGonder(tenantId, userId, bag.createdAt, t, simdi, butceDolu);
      await this.sorulariGonder(tenantId, userId, karar.rol as Rol, t, simdi, butceDolu);
      await this.brifingGonder(tenantId, userId, t, simdi, butceDolu);
    });
  }

  private isaretle(tenantId: string, idler: string[], sonuc: string) {
    if (!idler.length) return Promise.resolve();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.bildirimTeslimati.updateMany({ where: { id: { in: idler }, telegramIslendiAt: null }, data: { telegramIslendiAt: new Date(), telegramSonuc: sonuc } })).then(() => undefined);
  }

  /** CNL-06/07: uygun bildirimler tek mesaj ya da tek özet; sessiz saatte bekler, sabah özet olarak gider. */
  private async bildirimleriGonder(tenantId: string, userId: string, bagAt: Date, t: TelegramTercihi, simdi: Date, butceDolu: () => Promise<boolean>): Promise<void> {
    const alt = new Date(Math.max(bagAt.getTime(), simdi.getTime() - TELEGRAM_BILDIRIM_PENCERESI_MS));
    const adaylar: AdayTeslimat[] = await this.prisma.tenantIslem(tenantId, (tx) => tx.bildirimTeslimati.findMany({
      where: { userId, telegramIslendiAt: null, createdAt: { gt: alt } },
      select: { id: true, bildirim: { select: { tur: true, onem: true, baslik: true, aciklama: true, hedefYol: true, kapandiAt: true } } },
      orderBy: { createdAt: "asc" }, take: ADAY_SINIRI,
    }));
    if (!adaylar.length) return;
    const { uygun, atlanan } = teslimatlariSec(adaylar, t, simdi);
    for (const neden of ["cozuldu", "konu_disi", "sus"] as const) await this.isaretle(tenantId, atlanan.filter((a) => a.neden === neden).map((a) => a.id), neden);
    // Sessiz saatte teslimat beklemede kalır; aralık bitince birikenler tek özetle gider.
    if (!uygun.length || sessizSaatte(trDakika(simdi), t.sessizBaslangic, t.sessizBitis)) return;

    let gidecek = uygun;
    // CNL-12: bütçe dolunca yalnız kritik bildirimler (modelsiz) gitmeyi sürdürür; kullanıcıya bir kez söylenir.
    if (gidecek.some((x) => x.bildirim.onem !== "kritik") && (await butceDolu())) {
      await this.isaretle(tenantId, gidecek.filter((x) => x.bildirim.onem !== "kritik").map((x) => x.id), "butce");
      gidecek = gidecek.filter((x) => x.bildirim.onem === "kritik");
      await this.butceBildirimiBirKez(tenantId, userId, simdi);
    }
    // CNL-07: günlük sınır kritik olmayanları durdurur.
    const bugun = await this.prisma.tenantIslem(tenantId, (tx) => tx.telegramMesaji.count({ where: { userId, yon: "giden", durum: "gonderildi", tur: { in: SAYILAN_TURLER }, createdAt: { gte: gunBasi(simdi) } } }));
    if (bugun >= t.gunlukSinir) {
      await this.isaretle(tenantId, gidecek.filter((x) => x.bildirim.onem !== "kritik").map((x) => x.id), "sinir");
      gidecek = gidecek.filter((x) => x.bildirim.onem === "kritik");
    }
    if (!gidecek.length) return;

    const metin = bildirimMesaji(gidecek);
    const tur = gidecek.length > 1 ? "ozet" : "bildirim";
    const sonuc = await this.kanal.firmayaGonder(tenantId, userId, null, tur, metin);
    // Telegram hatasında teslimat beklemede kalır, sonraki turda yeniden denenir (24 saat penceresi içinde).
    if (sonuc === "hata") return;
    await this.isaretle(tenantId, gidecek.map((x) => x.id), sonuc === "gonderildi" ? (tur === "ozet" ? "ozet" : "gonderildi") : "bagsiz");
    if (sonuc === "gonderildi") await this.ajan.telegramGecmiseYaz(tur === "ozet" ? "[Bildirim özeti]" : "[Bildirim]", metin).catch(() => undefined);
  }

  /**
   * CNL-09: kişiye aynı anda en çok üç açık soru; üç günden eski soru Telegram'a gitmez (panelde kalır).
   * Sorular kendiliğinden mesajdır: sessiz saat, "sus", günlük sınır ve bütçe freni geçerlidir.
   */
  private async sorulariGonder(tenantId: string, userId: string, rol: Rol, t: TelegramTercihi, simdi: Date, butceDolu: () => Promise<boolean>): Promise<void> {
    await this.kanal.klavyeleriTemizle(tenantId, userId);
    if ((t.susBitis && t.susBitis > simdi) || sessizSaatte(trDakika(simdi), t.sessizBaslangic, t.sessizBitis)) return;
    const [acikGiden, adaylar, bugun] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.asistanSoruGonderimi.count({ where: { userId, klavyeKaldirildiAt: null, soru: { durum: "acik" } } }),
      tx.asistanSorusu.findMany({
        where: { durum: "acik", createdAt: { gt: new Date(simdi.getTime() - TELEGRAM_SORU_OMRU_MS) }, gonderimler: { none: { userId } }, OR: [{ userId }, { userId: null, roller: { has: rol } }] },
        select: { id: true, soru: true, secenekler: true, serbestYanit: true }, orderBy: { createdAt: "asc" }, take: ACIK_SORU_SINIRI,
      }),
      tx.telegramMesaji.count({ where: { userId, yon: "giden", durum: "gonderildi", tur: { in: SAYILAN_TURLER }, createdAt: { gte: gunBasi(simdi) } } }),
    ]));
    const kalan = Math.min(ACIK_SORU_SINIRI - acikGiden, t.gunlukSinir - bugun);
    if (kalan <= 0 || !adaylar.length || (await butceDolu())) return;
    for (const soru of adaylar.slice(0, kalan)) {
      const sonuc = await this.kanal.soruGonder(tenantId, userId, { ...soru, secenekler: soru.secenekler as Array<{ kod: string; etiket: string }> });
      if (sonuc !== "gonderildi") break;
      await this.ajan.telegramGecmiseYaz("[Asistan sorusu]", soru.soru).catch(() => undefined);
    }
  }

  /** CNL-08: iş günü sabahı en çok beş maddelik brifing; günde bir kez, sessiz saat ve "sus" dışında. */
  private async brifingGonder(tenantId: string, userId: string, t: TelegramTercihi, simdi: Date, butceDolu: () => Promise<boolean>): Promise<void> {
    if (!t.brifing || !brifingZamaniMi(simdi)) return;
    if ((t.susBitis && t.susBitis > simdi) || sessizSaatte(trDakika(simdi), t.sessizBaslangic, t.sessizBitis)) return;
    // Günde bir brifing; Telegram hatasında aynı gün en çok üç deneme.
    const bugunku = await this.prisma.tenantIslem(tenantId, (tx) => tx.telegramMesaji.groupBy({ by: ["durum"], where: { userId, yon: "giden", tur: "brifing", createdAt: { gte: gunBasi(simdi) } }, _count: { _all: true } }));
    if (bugunku.some((x) => x.durum === "gonderildi") || bugunku.reduce((n, x) => n + x._count._all, 0) >= 3) return;
    if (await butceDolu()) return;
    // Bölümler kullanıcının kendi rolüyle uçlardan okunur; göremediği bölüm brifinge girmez.
    const veri = await brifingVerisiTopla((uc, arg) => this.uc.cagir(uc, arg), trSimdi(simdi).gun);
    const metin = brifingMaddeleri(brifingMetni(veri));
    const sonuc = await this.kanal.firmayaGonder(tenantId, userId, null, "brifing", metin);
    if (sonuc === "gonderildi") await this.ajan.telegramGecmiseYaz("[Sabah brifingi]", metin).catch(() => undefined);
  }

  private async butceBildirimiBirKez(tenantId: string, userId: string, simdi: Date): Promise<void> {
    const varMi = await this.prisma.tenantIslem(tenantId, (tx) => tx.telegramMesaji.count({ where: { userId, yon: "giden", tur: "butce", createdAt: { gte: istanbulAyBaslangici(simdi) } } }));
    if (varMi) return;
    await this.kanal.firmayaGonder(tenantId, userId, null, "butce", "Bu ayın yapay zekâ bütçesi doldu. Kendiliğinden mesajlar ve sabah brifingi yeni aya dek duruyor; yalnız kritik bildirimler gelmeyi sürdürür. Yöneticiniz bütçeyi Ayarlar › Yapay zekâ ekranından değiştirebilir.");
  }
}
