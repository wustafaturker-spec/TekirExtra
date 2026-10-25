import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createTransport } from "nodemailer";
import { PlatformPrismaService } from "./platform-prisma.service";

const BIR_SAAT_MS = 60 * 60 * 1000;
const GUN_MS = 24 * BIR_SAAT_MS;
/** PLT-09: dönem sonundan bu kadar gün önce firmaya ve platforma hatırlatma gider. */
export const HATIRLATMA_GUN_ONCE = 7;
/** PLT-09: dönem sonundan bu kadar gün sonra ödemesi işaretlenmemiş firma "askıya alınacaklar"a düşer. */
export const ASKI_ESIGI_GUN = 15;

export interface TahsilatAdayi {
  tenant_id: string;
  unvan: string;
  plan_kodu: string;
  durum: string;
  donem_sonu: Date;
  fatura_epostasi: string | null;
  yonetici_epostalari: string[];
}

export const yaklasanAnahtari = (a: Pick<TahsilatAdayi, "tenant_id" | "donem_sonu">) => `yaklasiyor/${a.tenant_id}/${a.donem_sonu.toISOString()}`;
export const ozetAnahtari = (gun: string) => `ozet/${gun}`;

/** Dönemi 7 gün içinde bitecek (henüz bitmemiş) ve dönem sonundan 15 günden fazla geçmiş firmalar. */
export function tahsilatDurumu(adaylar: TahsilatAdayi[], simdi = new Date()) {
  const t = simdi.getTime();
  return {
    yaklasan: adaylar.filter((a) => a.donem_sonu.getTime() > t && a.donem_sonu.getTime() - t <= HATIRLATMA_GUN_ONCE * GUN_MS),
    geciken: adaylar.filter((a) => t - a.donem_sonu.getTime() > ASKI_ESIGI_GUN * GUN_MS),
  };
}

/** Fatura e-postası + aktif yöneticiler; aynı adres iki kez yazılmaz. */
export function firmaAlicilari(a: Pick<TahsilatAdayi, "fatura_epostasi" | "yonetici_epostalari">): string[] {
  const gorulen = new Set<string>();
  return [a.fatura_epostasi, ...a.yonetici_epostalari]
    .map((e) => e?.trim())
    .filter((e): e is string => Boolean(e && e.includes("@")))
    .filter((e) => (gorulen.has(e.toLowerCase()) ? false : (gorulen.add(e.toLowerCase()), true)));
}

const gunTR = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const tarih = (d: Date) => d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });

/**
 * PLT-09: elle tahsilat hatırlatmaları (ödeme sağlayıcısı sonra). Dönem
 * sonundan 7 gün önce firmaya (fatura e-postası + yöneticiler) ve platform
 * yöneticilerine bir kez; dönem sonundan 15 gün geçmiş firmalar için platforma
 * günlük özet. Otomatik askı yoktur. Her gönderim `mevzuat_olaylari`'na yazılır
 * (tekrar gitmez). Yalnız worker'da, platform bağlantısıyla ve sistem SMTP'siyle
 * çalışır (firmanın kendi SMTP ayarıyla değil).
 */
@Injectable()
export class TahsilatHatirlatmaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TahsilatHatirlatmaService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly platform: PlatformPrismaService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_PLATFORM) return;
    setImmediate(() => void this.calistir());
    this.zamanlayici = setInterval(() => void this.calistir(), BIR_SAAT_MS);
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  async calistir(simdi = new Date()): Promise<{ firma: number; ozet: boolean }> {
    if (this.calisiyor) return { firma: 0, ozet: false };
    this.calisiyor = true;
    try {
      const db = this.platform.db;
      const adaylar = await db.$queryRaw<TahsilatAdayi[]>`SELECT * FROM platform_tahsilat_adaylari()`;
      const { yaklasan, geciken } = tahsilatDurumu(adaylar, simdi);
      if (!yaklasan.length && !geciken.length) return { firma: 0, ozet: false };
      const gonderilmis = new Set((await db.mevzuatOlay.findMany({
        where: { olay: { in: ["tahsilat_hatirlatma", "tahsilat_ozeti"] }, zaman: { gt: new Date(simdi.getTime() - 60 * GUN_MS) } },
        select: { detay: true },
      })).map((o) => (o.detay as { anahtar?: string } | null)?.anahtar).filter(Boolean));
      const platformAlicilari = (await db.platformKullanici.findMany({ where: { aktif: true, rol: "yonetici" }, select: { eposta: true } })).map((k) => k.eposta);
      const transport = createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false });
      const from = process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>";

      const yeniYaklasan = yaklasan.filter((a) => !gonderilmis.has(yaklasanAnahtari(a)));
      const hatirlatilan: TahsilatAdayi[] = [];
      for (const a of yeniYaklasan) {
        const alicilar = firmaAlicilari(a);
        try {
          if (alicilar.length) {
            await transport.sendMail({
              from, to: alicilar.join(", "),
              subject: "TekirExtra aboneliğinizin dönemi bitiyor",
              text: `Merhaba,\n\n${a.unvan.trim()} firmasının TekirExtra abonelik dönemi ${tarih(a.donem_sonu)} tarihinde bitiyor. Kesintisiz kullanım için ödemenizi dönem sonundan önce yapın; ödeme bilgileri için bu e-postayı yanıtlayabilirsiniz.\n\nÖdeme alındığında dönem uzatılır ve size ayrıca bilgi verilir.`,
            });
          }
          await db.mevzuatOlay.create({ data: { olay: "tahsilat_hatirlatma", detay: { anahtar: yaklasanAnahtari(a), tenantId: a.tenant_id, donemSonu: a.donem_sonu, alici: alicilar.length } as Prisma.InputJsonValue } });
          hatirlatilan.push(a);
        } catch (hata) {
          this.logger.error(JSON.stringify({ event: "billing_reminder_failed", tenantId: a.tenant_id, error: hata instanceof Error ? hata.message : String(hata) }));
        }
      }

      const firma = hatirlatilan.length;
      const gun = gunTR(simdi);
      const ozetGerekli = geciken.length > 0 && !gonderilmis.has(ozetAnahtari(gun));
      if (platformAlicilari.length && (hatirlatilan.length || ozetGerekli)) {
        const bolumler = [
          hatirlatilan.length ? `Dönemi ${HATIRLATMA_GUN_ONCE} gün içinde bitecek firmalar (firmaya hatırlatma gitti):\n${hatirlatilan.map((a) => `• ${a.unvan.trim()} — ${tarih(a.donem_sonu)}`).join("\n")}` : "",
          ozetGerekli ? `Askıya alınacaklar — dönem sonundan ${ASKI_ESIGI_GUN} günden fazla geçti, ödeme işaretlenmedi:\n${geciken.map((a) => `• ${a.unvan.trim()} — dönem sonu ${tarih(a.donem_sonu)}`).join("\n")}\n\nOtomatik askı yoktur; Firmalar ekranından ödemeyi işaretleyin ya da askıya alın.` : "",
        ].filter(Boolean);
        await transport.sendMail({ from, to: platformAlicilari.join(", "), subject: ozetGerekli ? "TekirExtra tahsilat özeti: askıya alınacak firmalar" : "TekirExtra tahsilat: dönemi yaklaşan firmalar", text: bolumler.join("\n\n") });
        if (ozetGerekli) await db.mevzuatOlay.create({ data: { olay: "tahsilat_ozeti", detay: { anahtar: ozetAnahtari(gun), geciken: geciken.map((a) => a.tenant_id) } as Prisma.InputJsonValue } });
      } else if (!platformAlicilari.length) {
        this.logger.warn("Tahsilat hatırlatması: aktif platform yöneticisi yok");
      }
      if (firma || ozetGerekli) this.logger.log(JSON.stringify({ event: "billing_reminders_sent", firma, ozet: ozetGerekli }));
      return { firma, ozet: ozetGerekli && platformAlicilari.length > 0 };
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "billing_reminder_scan_failed", error: hata instanceof Error ? hata.message : String(hata) }));
      return { firma: 0, ozet: false };
    } finally {
      this.calisiyor = false;
    }
  }
}
