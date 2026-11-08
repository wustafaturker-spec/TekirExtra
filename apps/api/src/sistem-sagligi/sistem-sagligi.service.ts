import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createTransport } from "nodemailer";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EbelgeKuyrukService } from "../ebelge/ebelge-kuyruk.service";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { yedekSorunlari } from "../yedekleme/yedek-kurallari";
import { YedeklemeService } from "../yedekleme/yedekleme.service";
import { ESIK, saatlikAtlama, sorunlariBul, type Sorun } from "./sistem-alarm-kurallari";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const GUN_MS = 86_400_000;

interface KursorSatiri { tenant_id: string; unvan: string; saglayici: string; son_cekim_at: Date | null; irsaliye_son_cekim_at: Date | null }
interface BaglantiSatiri { tenant_id: string; unvan: string; aile: string; saglayici: string; durum: string; son_senkron_tarihi: Date | null; son_senkron_hatasi: string | null; ardisik_hata: number }

/**
 * PLT-17…19: sistem sağlığı. Ekran verisi ve alarm aynı toplamadan gelir.
 * Alarm denetimi API sürecinde çalışır (worker düşse de haber verir); kiracı
 * bilgisi yalnız platform işlevlerinden (unvan, tarih, hata metni) okunur.
 */
@Injectable()
export class SistemSagligiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SistemSagligiService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformPrismaService,
    private readonly kuyruk: EbelgeKuyrukService,
    private readonly yedekleme: YedeklemeService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER === "1" || !process.env.DATABASE_URL_PLATFORM || process.env.NABIZ_KAPALI === "1" || process.env.NODE_ENV === "test") return;
    // İlk denetim süreçler nabız yazdıktan sonra.
    setTimeout(() => void this.alarmDenetle(), 60_000).unref();
    this.zamanlayici = setInterval(() => void this.alarmDenetle(), BES_DAKIKA_MS);
    this.zamanlayici.unref();
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  private async topla(simdi = new Date()) {
    const [isler, surecler, oncekiWorker, kuyruk, kursorSatirlari, baglantilar, alarmlar] = await Promise.all([
      this.prisma.sistemIsi.findMany({ orderBy: { isAdi: "asc" } }),
      this.prisma.sistemSureci.findMany({ where: { basladiAt: { gt: new Date(simdi.getTime() - GUN_MS) } }, orderBy: { basladiAt: "desc" } }),
      this.prisma.sistemSureci.count({ where: { tur: "worker", basladiAt: { lte: new Date(simdi.getTime() - 3_600_000) } } }),
      this.kuyruk.platformOzeti(),
      this.platform.db.$queryRaw<KursorSatiri[]>`SELECT * FROM platform_gelen_kursor_durumu()`,
      this.platform.db.$queryRaw<BaglantiSatiri[]>`SELECT * FROM platform_baglanti_sagligi()`,
      this.prisma.sistemAlarmi.findMany({ where: { OR: [{ acik: true }, { kapandiAt: { gt: new Date(simdi.getTime() - GUN_MS) } }] }, orderBy: { sonGorulmeAt: "desc" } }),
    ]);
    const kuyrukFirmalari = [...new Set([...kuyruk.firmalar.map((f) => f.tenantId), ...kuyruk.oluIsler.map((o) => o.tenantId)])];
    const adlar = new Map(
      kuyrukFirmalari.length
        ? (await this.platform.db.$queryRaw<{ tenant_id: string; unvan: string }[]>`SELECT * FROM platform_firma_adlari(${kuyrukFirmalari}::uuid[])`).map((r) => [r.tenant_id, r.unvan.trim()])
        : [],
    );
    // Üretimde gerçek adaptörü olmayan sağlayıcının taraması bilinçli olarak atlanır; kursörü eskir ama sorun değildir.
    const kursorler = kursorSatirlari.filter((k) => BaglantilarService.taranir(k.saglayici));
    const workerSurecleri = surecler.filter((s) => s.tur === "worker");
    return { simdi, isler, surecler, workerSurecleri, oncekiWorkerVar: oncekiWorker > 0, kuyruk, adlar, kursorler, baglantilar, alarmlar };
  }

  /** PLT-17: ekran. */
  async ekran() {
    const v = await this.topla();
    const t = v.simdi.getTime();
    const sonWorker = v.workerSurecleri[0] ?? null;
    const sonApi = v.surecler.find((s) => s.tur === "api") ?? null;
    const sureci = (s: (typeof v.surecler)[number] | null) => (s ? { basladiAt: s.basladiAt, sonNabizAt: s.sonNabizAt, rssMb: s.rssMb, heapMb: s.heapMb, heapSinirMb: s.heapSinirMb, makine: s.makine } : null);
    return {
      zaman: v.simdi,
      esikler: ESIK,
      worker: {
        son: sureci(sonWorker),
        nabizGecikmesiDk: sonWorker ? Math.round((t - sonWorker.sonNabizAt.getTime()) / 60_000) : null,
        // 24 saatteki açılışlar: çökme sonrası yeniden başlamalar ve dağıtımlar birlikte.
        acilis24s: v.workerSurecleri.length,
        acilislar: v.workerSurecleri.slice(0, 20).map((s) => ({ basladiAt: s.basladiAt, sonNabizAt: s.sonNabizAt, rssMb: s.rssMb })),
      },
      api: sureci(sonApi),
      isler: v.isler.map((i) => ({ ...i, calismaSayisi: Number(i.calismaSayisi), saatlikAtlama: saatlikAtlama(i, t) })),
      kuyruk: {
        sayilar: v.kuyruk.sayilar,
        firmalar: v.kuyruk.firmalar.map((f) => ({ ...f, unvan: v.adlar.get(f.tenantId) ?? f.tenantId })).sort((a, b) => (b.failed ?? 0) - (a.failed ?? 0)),
        oluIsler: v.kuyruk.oluIsler.map((o) => ({ ...o, unvan: v.adlar.get(o.tenantId) ?? o.tenantId })),
      },
      gecikenKursorler: v.kursorler
        .filter((k) => !k.son_cekim_at || t - k.son_cekim_at.getTime() > ESIK.kursorSaat * 3_600_000)
        .map((k) => ({ tenantId: k.tenant_id, unvan: k.unvan.trim(), saglayici: k.saglayici, sonCekimAt: k.son_cekim_at })),
      taranan: v.kursorler.length,
      baglantilar: v.baglantilar.filter((b) => BaglantilarService.taranir(b.saglayici) || b.aile !== "ebelge").map((b) => ({
        tenantId: b.tenant_id, unvan: b.unvan.trim(), aile: b.aile, saglayici: b.saglayici, durum: b.durum, sonSenkron: b.son_senkron_tarihi, hata: b.son_senkron_hatasi, ardisikHata: b.ardisik_hata,
      })),
      alarmlar: v.alarmlar,
    };
  }

  /** PLT-18: kuyruktan düşen işi yeniden kuyruğa alır; platform olay kaydına yazılır. */
  async yenidenDene(oluIsId: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    const sonuc = await this.kuyruk.platformYenidenDene(oluIsId);
    await this.platform.db.mevzuatOlay.create({ data: { kullaniciId, olay: "kuyruk_isi_yeniden_denendi", detay: { oluIsId } as Prisma.InputJsonValue } });
    await this.prisma.sistemAlarmi.updateMany({ where: { anahtar: `olu-is:${oluIsId}`, acik: true }, data: { acik: false, kapandiAt: new Date() } });
    return { mesaj: "İş yeniden kuyruğa alındı.", sonuc };
  }

  /**
   * PLT-19: sorunlar alarm tablosuyla karşılaştırılır. Açıldığından beri
   * bildirilmemiş sorun e-posta alır; aynı anahtar son 1 saatte bildirildiyse
   * (kapanıp yeniden açılsa da) beklenir. "Bildirildi" ancak e-posta gidince
   * yazılır — gönderilemezse sonraki denetimde yeniden denenir. Bildirilmiş
   * sorun kapanınca "düzeldi" gider.
   */
  async alarmDenetle(simdi = new Date()): Promise<{ yeni: Sorun[]; duzelen: string[] }> {
    if (this.calisiyor) return { yeni: [], duzelen: [] };
    this.calisiyor = true;
    try {
      const v = await this.topla(simdi);
      const sorunlar = [...sorunlariBul({
        simdi, workerSurecleri: v.workerSurecleri, oncekiWorkerVar: v.oncekiWorkerVar,
        oluIsler: v.kuyruk.oluIsler.map((o) => ({ ...o, unvan: v.adlar.get(o.tenantId) })),
        kursorler: v.kursorler.map((k) => ({ tenantId: k.tenant_id, unvan: k.unvan, sonCekimAt: k.son_cekim_at })),
        isler: v.isler,
      }), ...yedekSorunlari(await this.yedekleme.durum(simdi))];
      const mevcut = new Map((await this.prisma.sistemAlarmi.findMany()).map((a) => [a.anahtar, a]));
      const bildirilecek: Sorun[] = [];
      for (const s of sorunlar) {
        const a = mevcut.get(s.anahtar);
        const yeniAcilis = !a || !a.acik;
        const ilkAt = yeniAcilis ? simdi : a.ilkAt;
        const bildirilmedi = yeniAcilis || !a.sonBildirimAt || a.sonBildirimAt < a.ilkAt;
        const yakinda = a?.sonBildirimAt && simdi.getTime() - a.sonBildirimAt.getTime() < 3_600_000;
        await this.prisma.sistemAlarmi.upsert({
          where: { anahtar: s.anahtar },
          create: { anahtar: s.anahtar, tur: s.tur, ozet: s.ozet, ilkAt, sonGorulmeAt: simdi },
          update: { tur: s.tur, ozet: s.ozet, acik: true, sonGorulmeAt: simdi, ...(yeniAcilis ? { ilkAt, kapandiAt: null } : {}) },
        });
        if (bildirilmedi && !yakinda) bildirilecek.push(s);
      }
      const acikAnahtarlar = new Set(sorunlar.map((s) => s.anahtar));
      const duzelen = [...mevcut.values()].filter((a) => a.acik && !acikAnahtarlar.has(a.anahtar));
      for (const a of duzelen) await this.prisma.sistemAlarmi.update({ where: { anahtar: a.anahtar }, data: { acik: false, kapandiAt: simdi } });
      // 30 günden eski kapalı alarmlar atılır.
      await this.prisma.sistemAlarmi.deleteMany({ where: { acik: false, kapandiAt: { lt: new Date(simdi.getTime() - 30 * GUN_MS) } } });
      const duzelenBildirilmis = duzelen.filter((a) => a.sonBildirimAt && a.sonBildirimAt >= a.ilkAt).map((a) => a.ozet);
      if (bildirilecek.length || duzelenBildirilmis.length) {
        try {
          await this.eposta(bildirilecek, duzelenBildirilmis);
          if (bildirilecek.length) await this.prisma.sistemAlarmi.updateMany({ where: { anahtar: { in: bildirilecek.map((s) => s.anahtar) } }, data: { sonBildirimAt: simdi } });
        } catch (hata) {
          this.logger.error(JSON.stringify({ event: "system_alarm_mail_failed", error: hata instanceof Error ? hata.message : String(hata) }));
          return { yeni: [], duzelen: duzelen.map((a) => a.anahtar) };
        }
      }
      return { yeni: bildirilecek, duzelen: duzelen.map((a) => a.anahtar) };
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "system_alarm_check_failed", error: hata instanceof Error ? hata.message : String(hata) }));
      return { yeni: [], duzelen: [] };
    } finally {
      this.calisiyor = false;
    }
  }

  private async eposta(yeni: Sorun[], duzelen: string[]) {
    const alicilar = (await this.platform.db.platformKullanici.findMany({ where: { aktif: true, rol: "yonetici", davetTuru: null }, select: { eposta: true } })).map((k) => k.eposta);
    if (!alicilar.length) { this.logger.warn("Sistem alarmı: aktif platform yöneticisi yok"); return; }
    const konu = yeni.length ? `TekirExtra sistem alarmı: ${yeni.length} sorun` : `TekirExtra sistem alarmı: ${duzelen.length} sorun düzeldi`;
    const bolumler = [
      yeni.length ? `Yeni sorunlar:\n${yeni.map((s) => `• ${s.ozet}`).join("\n")}` : "",
      duzelen.length ? `Düzelenler:\n${duzelen.map((o) => `• ${o}`).join("\n")}` : "",
      "Ayrıntı: Platform › Sistem sağlığı",
    ].filter(Boolean);
    const transport = createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false });
    await transport.sendMail({ from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>", to: alicilar.join(", "), subject: konu, text: bolumler.join("\n\n") });
    await this.platform.db.mevzuatOlay.create({ data: { olay: "sistem_alarmi", detay: { yeni: yeni.map((s) => s.anahtar), duzelen: duzelen.length } as Prisma.InputJsonValue } });
  }
}
