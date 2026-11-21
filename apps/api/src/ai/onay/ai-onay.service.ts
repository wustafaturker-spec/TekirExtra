import { OnayGerekliHatasi } from "../../onay/onay-kurallari";
import { aiMetrik } from "../../core/observability/ai-metrikleri";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, forwardRef } from "@nestjs/common";
import type { AiIslemKaynagi, AiOnayTalebi, Prisma } from "@prisma/client";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { olayYaz } from "../olay/ai-olay.service";
import { aktifBaglam } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { aracBul } from "../ajan/araclar";
import { UcCagirici } from "../ajan/uc-cagirici";
import { icerikOzeti, type OnayOnizlemesi } from "../ajan/araclar/arac";
import { DUZENLENEBILIR_ALANLAR } from "../ajan/araclar/duzenlenebilir";
import { onayRiski, type OnayRiski } from "../ajan/araclar/onay-riski";
import { GirisDenemeSayaci } from "../../auth/giris-deneme-sayaci";
import { totpDogrula } from "../../auth/totp-dogrula";
import { coz } from "../../core/kripto";
import { telegramAyariOku } from "../../telegram/telegram-ayar";

/** AI-107: kararın verildiği kanal. */
export type KararKanali = "WEB" | "TELEGRAM" | "MCP";

/** AI-107: karar çakışmaları; istemci ve Telegram `kod` ile ayırt eder. */
export type CakismaKodu = "ESKI_SURUM" | "ZATEN_SONUCLANDI" | "SURESI_DOLDU";
const CAKISMA_METNI: Record<CakismaKodu, string> = {
  ESKI_SURUM: "Talep siz görüntüledikten sonra düzenlendi; güncel hâlini inceleyip yeniden onaylayın.",
  ZATEN_SONUCLANDI: "Bu talep zaten karara bağlandı.",
  SURESI_DOLDU: "Talebin süresi doldu; işlemi yeniden isteyin.",
};
export const cakisma = (kod: CakismaKodu) => {
  aiMetrik.artir("tekirextra_ai_onay_cakisma_toplam", { kod });
  return new ConflictException({ message: CAKISMA_METNI[kod], kod });
};

/**
 * AI-108: Telegram'dan finansal onay ret nedenleri. WEB_GEREKLI: firma ayarı kapalı ya da
 * kullanıcının iki adımlı doğrulaması yok; KOD_GEREKLI: düğme kodsuz geldi.
 */
export type EkDogrulamaKodu = "WEB_GEREKLI" | "KOD_GEREKLI" | "KOD_GECERSIZ" | "KILITLI";
const EK_DOGRULAMA_METNI: Record<EkDogrulamaKodu, string> = {
  WEB_GEREKLI: "Bu finansal işlem Telegram'dan onaylanamaz; web'de onaylayın.",
  KOD_GEREKLI: "Bu finansal işlem için iki adımlı doğrulama kodu gerekir.",
  KOD_GECERSIZ: "Doğrulama kodu geçersiz.",
  KILITLI: "Çok fazla hatalı kod girildi. 15 dakika sonra yeniden deneyin ya da web'de onaylayın.",
};
export const ekDogrulamaHatasi = (kod: EkDogrulamaKodu) => new ForbiddenException({ message: EK_DOGRULAMA_METNI[kod], kod });

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
  /** AI-107: kartın onay/düzenleme isteğinde geri göndereceği sürüm. */
  surum: number;
  /** AI-107: karttan düzenlenebilir alanlar ve güncel değerleri (yalnız bekleyen talepte). */
  duzenlenebilir: Record<string, unknown> | null;
  /** AI-108: Telegram'da finansal onay ek doğrulama ister. */
  risk: OnayRiski;
}

function gorunum(t: AiOnayTalebi): OnayTalebiGorunumu {
  const alanlar = DUZENLENEBILIR_ALANLAR[t.arac] ?? [];
  const parametreler = (t.parametreler ?? {}) as Record<string, unknown>;
  return {
    id: t.id,
    arac: t.arac,
    risk: onayRiski(t.arac),
    ozet: t.ozet,
    onizleme: (t.onizleme as unknown as OnayOnizlemesi | null) ?? null,
    kaynak: t.kaynak,
    durum: t.durum,
    gecerlilikSonu: t.gecerlilikSonu.toISOString(),
    createdAt: t.createdAt.toISOString(),
    kararAt: t.kararAt?.toISOString() ?? null,
    sonuc: t.sonuc,
    hata: t.hata,
    surum: t.surum,
    duzenlenebilir: t.durum === "bekliyor" && alanlar.length ? Object.fromEntries(alanlar.map((a) => [a, parametreler[a] ?? null])) : null,
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
    // AI-106: bildirimler artık olay teslimatçısından gelir; bağımlılık eski kurucu imzası için durur.
    @Inject(forwardRef(() => BildirimService))
    private readonly _bildirimler: BildirimService,
    @Optional() denemeler?: GirisDenemeSayaci,
  ) {
    this.denemeler = denemeler ?? GirisDenemeSayaci.bellekte();
  }

  /** AI-108: Telegram'daki hatalı doğrulama kodları; kullanıcı başına 15 dakikada 5 hata kilitler. */
  private readonly denemeler: GirisDenemeSayaci;

  async olustur(girdi: { arac: string; parametreler: unknown; ozet: string; onizleme?: OnayOnizlemesi | null; hedefOzeti?: string | null; kaynak: AiIslemKaynagi; oturumId?: string | null }): Promise<OnayTalebiGorunumu> {
    const { tenantId, userId } = aktifBaglam();
    // AI-106: talep ve "açıldı" olayı aynı işlemde; bildirimi worker'daki teslimatçı üretir.
    const talep = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const t = await tx.aiOnayTalebi.create({
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
          parametreOzeti: icerikOzeti(girdi.parametreler ?? {}),
        },
      });
      await olayYaz(tx, { tenantId, topluTur: "ai_onay", topluId: t.id, tur: "ai_onay.acildi", yuk: { userId, kaynak: girdi.kaynak, ozet: girdi.ozet.slice(0, 500) } });
      return t;
    });
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

  /**
   * AI-107: `surum` kartın gördüğü sürümdür; verilmezse yüklenen sürüm kullanılır. Talep yalnız
   * bekliyor + aynı sürümdeyken işlenmeye alınır ve karar kaydı aynı işlemde yazılır (tekil):
   * eşzamanlı istekler ve kanallar arası yarışta tek karar, tek yan etki.
   */
  async onayla(id: string, secenek: { surum?: number; kanal?: KararKanali; dogrulamaKodu?: string } = {}): Promise<OnayTalebiGorunumu> {
    const { tenantId, userId } = aktifBaglam();
    const talep = await this.kendiTalebi(id);
    await this.kararaUygunMu(talep, secenek.surum);
    const ekDogrulama = await this.telegramFinansalKapisi(talep, secenek);
    const arac = aracBul(talep.arac);
    if (!arac || arac.sinif !== "onay") throw new BadRequestException("Talepteki işlem artık tanımlı değil.");

    // Aynı talep iki kez çalışmasın: yalnız bekleyen ve aynı sürümdeki talep işlenmeye alınır.
    const alinan = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const r = await tx.aiOnayTalebi.updateMany({ where: { id, durum: "bekliyor", surum: talep.surum }, data: { durum: "isleniyor", kararAt: new Date() } });
      if (r.count) await this.kararYaz(tx, talep, "onaylandi", userId, secenek.kanal ?? "WEB", ekDogrulama);
      return r.count;
    });
    if (alinan === 0) throw await this.cakismaNedeni(id);

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
      // ONY-09: işlem genel onay kuralına takıldı; hata değil, onay talebi açıldı.
      if (e instanceof OnayGerekliHatasi) sonuc = { onayaGonderildi: true, ...(e.getResponse() as Record<string, unknown>) };
      else hata = hataMetni(e);
    }
    const durum = hedefDegisti ? "hedef_degisti" : hata ? "hata" : "onaylandi";
    const guncel = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const g = await tx.aiOnayTalebi.update({
        where: { id },
        data: { durum, sonuc: sonuc == null ? undefined : (JSON.parse(JSON.stringify(sonuc)) as Prisma.InputJsonValue), hata },
      });
      await this.sonuclandi(tx, g.id, g.userId, durum);
      return g;
    });
    return gorunum(guncel);
  }

  async reddet(id: string, secenek: { surum?: number; kanal?: KararKanali } = {}): Promise<OnayTalebiGorunumu> {
    const { tenantId, userId } = aktifBaglam();
    const talep = await this.kendiTalebi(id);
    if (talep.durum !== "bekliyor") throw cakisma("ZATEN_SONUCLANDI");
    if (secenek.surum !== undefined && secenek.surum !== talep.surum) throw cakisma("ESKI_SURUM");
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const r = await tx.aiOnayTalebi.updateMany({ where: { id, durum: "bekliyor", surum: talep.surum }, data: { durum: "reddedildi", kararAt: new Date() } });
      if (r.count) {
        await this.kararYaz(tx, talep, "reddedildi", userId, secenek.kanal ?? "WEB");
        await this.sonuclandi(tx, id, userId, "reddedildi");
      }
      return r;
    });
    if (sonuc.count === 0) throw await this.cakismaNedeni(id);
    return gorunum(await this.kendiTalebi(id));
  }

  /**
   * AI-107: bekleyen talebin karttan izinli alanlarını düzenler. Değerler aracın şemasıyla
   * doğrulanır; özet, önizleme ve hedef özeti yeniden hesaplanır, sürüm artar. Eski sürümle
   * gelen düzenleme ve onay reddedilir.
   */
  async duzenle(id: string, girdi: { surum?: unknown; degerler?: unknown }): Promise<OnayTalebiGorunumu> {
    const { tenantId } = aktifBaglam();
    const talep = await this.kendiTalebi(id);
    if (typeof girdi.surum !== "number" || !Number.isInteger(girdi.surum)) throw new BadRequestException("Düzenleme sürüm bilgisi taşımalı.");
    await this.kararaUygunMu(talep, girdi.surum);
    const arac = aracBul(talep.arac);
    const alanlar = DUZENLENEBILIR_ALANLAR[talep.arac] ?? [];
    if (!arac || arac.sinif !== "onay" || !alanlar.length) throw new BadRequestException("Bu işlemin alanları düzenlenemez.");
    const degerler = girdi.degerler && typeof girdi.degerler === "object" && !Array.isArray(girdi.degerler) ? (girdi.degerler as Record<string, unknown>) : null;
    if (!degerler || !Object.keys(degerler).length) throw new BadRequestException("Düzenlenecek alan verilmedi.");
    const yasak = Object.keys(degerler).filter((a) => !alanlar.includes(a));
    if (yasak.length) throw new BadRequestException(`Bu alanlar düzenlenemez: ${yasak.join(", ")}`);
    const yeni = { ...((talep.parametreler ?? {}) as Record<string, unknown>), ...degerler };
    const ayristirma = arac.girdi.safeParse(yeni);
    if (!ayristirma.success) throw new BadRequestException(`Geçersiz değer: ${ayristirma.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const baglam = { uc: this.uc, kaynak: talep.kaynak, arac: arac.ad };
    const ozet = arac.ozetle ? await arac.ozetle(baglam, ayristirma.data) : talep.ozet;
    const onizleme = arac.onizle ? await arac.onizle(baglam, ayristirma.data) : (talep.onizleme as unknown as OnayOnizlemesi | null);
    const hedefOzeti = arac.hedefDurumu ? icerikOzeti(await arac.hedefDurumu(baglam, ayristirma.data)) : talep.hedefOzeti;
    const parametreler = JSON.parse(JSON.stringify(ayristirma.data)) as Prisma.InputJsonValue;
    const r = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiOnayTalebi.updateMany({
      where: { id, durum: "bekliyor", surum: talep.surum },
      data: { parametreler, parametreOzeti: icerikOzeti(ayristirma.data), ozet, onizleme: onizleme ? (JSON.parse(JSON.stringify(onizleme)) as Prisma.InputJsonValue) : undefined, hedefOzeti, surum: { increment: 1 } },
    }));
    if (r.count === 0) throw await this.cakismaNedeni(id);
    return gorunum(await this.kendiTalebi(id));
  }

  /** Bekleyen, süresi dolmamış ve (verildiyse) aynı sürümde olmalı. */
  private async kararaUygunMu(talep: AiOnayTalebi, surum: number | undefined): Promise<void> {
    if (talep.durum !== "bekliyor") throw cakisma("ZATEN_SONUCLANDI");
    if (talep.gecerlilikSonu < new Date()) { await this.sureleriKapat(); throw cakisma("SURESI_DOLDU"); }
    if (surum !== undefined && surum !== talep.surum) throw cakisma("ESKI_SURUM");
  }

  /** Atomik güncelleme tutmadıysa nedeni: sonuçlandı mı, sürüm mü değişti. */
  private async cakismaNedeni(id: string) {
    const guncel = await this.kendiTalebi(id);
    return cakisma(guncel.durum !== "bekliyor" ? "ZATEN_SONUCLANDI" : "ESKI_SURUM");
  }

  /** AI-107: talep başına tek karar kaydı (tekil); içerik değil sürüm ve özet yazılır. */
  private async kararYaz(tx: Prisma.TransactionClient, talep: AiOnayTalebi, karar: "onaylandi" | "reddedildi", kararVerenId: string, kanal: KararKanali, ekDogrulama = false): Promise<void> {
    aiMetrik.artir("tekirextra_ai_onay_karari_toplam", { karar, kanal });
    await tx.aiOnayKarari.create({ data: { tenantId: talep.tenantId, talepId: talep.id, karar, kararVerenId, kanal, ekDogrulama, surum: talep.surum, parametreOzeti: talep.parametreOzeti ?? icerikOzeti(talep.parametreler ?? {}) } });
  }

  /**
   * AI-108: Telegram'dan finansal onay yalnız firma ayarı "kodla" iken ve kullanıcının iki adımlı
   * doğrulaması açıkken, geçerli 6 haneli kodla verilir; aksi hâlde web'e yönlendirilir. Denetim
   * sunucudadır: düğme ya da istemci atlansa da kod olmadan finansal işlem Telegram'dan geçmez.
   * Web onayı değişmez (oturum zaten doğrulanmıştır). Kod doğrulandıysa true döner.
   */
  private async telegramFinansalKapisi(talep: AiOnayTalebi, secenek: { kanal?: KararKanali; dogrulamaKodu?: string }): Promise<boolean> {
    if (secenek.kanal !== "TELEGRAM" || onayRiski(talep.arac) !== "finansal") return false;
    const { tenantId, userId } = aktifBaglam();
    const { ayar, kullanici } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      ayar: await telegramAyariOku(tx, tenantId),
      kullanici: await tx.user.findUnique({ where: { id: userId }, select: { totpAktif: true, totpSecretSifreli: true } }),
    }));
    if (ayar.finansalOnay !== "totp" || !kullanici?.totpAktif || !kullanici.totpSecretSifreli) throw ekDogrulamaHatasi("WEB_GEREKLI");
    const kod = secenek.dogrulamaKodu?.trim();
    if (!kod) throw ekDogrulamaHatasi("KOD_GEREKLI");
    const anahtar = `ai-onay:${userId}`;
    if (await this.denemeler.kilitliMi(anahtar, ["ek_dogrulama"])) throw ekDogrulamaHatasi("KILITLI");
    if (!/^\d{6}$/.test(kod) || !totpDogrula(coz(kullanici.totpSecretSifreli), kod)) {
      if (await this.denemeler.hataKaydet("ek_dogrulama", anahtar)) {
        await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId, islem: "ai_onay_kodu_kilitlendi", varlik: "ai_onay_talebi", varlikId: talep.id, detay: { kanal: "TELEGRAM" } } }))
          .catch((e: unknown) => this.logger.warn(`Kilit denetim kaydı yazılamadı: ${String(e)}`));
        throw ekDogrulamaHatasi("KILITLI");
      }
      throw ekDogrulamaHatasi("KOD_GECERSIZ");
    }
    await this.denemeler.temizle(anahtar, ["ek_dogrulama"]);
    return true;
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
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.aiOnayTalebi.findMany({
        where: { userId, durum: "bekliyor", gecerlilikSonu: { lt: new Date() } },
        select: { id: true },
      });
      if (kayitlar.length) {
        await tx.aiOnayTalebi.updateMany({ where: { id: { in: kayitlar.map((k) => k.id) } }, data: { durum: "suresi_doldu" } });
        for (const k of kayitlar) await this.sonuclandi(tx, k.id, userId, "suresi_doldu");
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
        for (const k of askidakiler) await this.sonuclandi(tx, k.id, userId, "hata");
      }
    });
  }

  /** AI-106: "sonuçlandı" olayı karar işleminin içinde yazılır; teslimatçı bildirimi kapatır. */
  private async sonuclandi(tx: Prisma.TransactionClient, id: string, userId: string, durum: string): Promise<void> {
    await olayYaz(tx, { tenantId: aktifBaglam().tenantId, topluTur: "ai_onay", topluId: id, tur: "ai_onay.sonuclandi", yuk: { userId, durum } });
  }
}
