import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PlatformIletiService } from "../ileti/platform-ileti.service";
import { abonelikTutari } from "../abonelik-odeme/abonelik-tutari";
import { bagliAbonelikTutari } from "../tenant/abonelik-kosullari";
import { baglantiAnahtariUret } from "../abonelik-odeme/baglanti-anahtari";
import { SaglayiciAyarlariService } from "../abonelik-odeme/saglayici-ayarlari.service";
import { PlatformPrismaService } from "./platform-prisma.service";
import { nabizla } from "../core/nabiz/nabiz";

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
  paket_surumu_id?: string | null;
  paket_kosullari?: unknown;
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
 * PLT-13: etkin sağlayıcı varsa ve plan fiyatlıysa e-postaya oturumsuz ödeme
 * bağlantısı eklenir; yoksa PLT-09 metni (yanıtlayarak ödeme bilgisi isteme) kalır.
 */
export function odemeBaglantisi(a: Pick<TahsilatAdayi, "tenant_id" | "plan_kodu"> & Partial<Pick<TahsilatAdayi, "paket_surumu_id" | "paket_kosullari">>, saglayiciEtkin: boolean, simdi = new Date()): string | null {
  if (!saglayiciEtkin) return null;
  const fiyat = a.paket_surumu_id
    ? bagliAbonelikTutari({ planKodu: a.plan_kodu, paketSurumId: a.paket_surumu_id, paketKosullari: a.paket_kosullari }, 1)
    : abonelikTutari(a.plan_kodu, 1);
  if (!fiyat) return null;
  const kok = (process.env.PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${kok}/api/v1/abonelik-odeme/baglanti/${baglantiAnahtariUret(a.tenant_id, simdi)}`;
}

/**
 * PLT-09: elle tahsilat hatırlatmaları (PLT-13 ile ödeme bağlantısı da taşır). Dönem
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

  constructor(private readonly platform: PlatformPrismaService, private readonly ileti: PlatformIletiService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_PLATFORM) return;
    setImmediate(() => void nabizla("tahsilat-hatirlatma", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("tahsilat-hatirlatma", () => this.calistir(), BIR_SAAT_MS), BIR_SAAT_MS);
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

      const yeniYaklasan = yaklasan.filter((a) => !gonderilmis.has(yaklasanAnahtari(a)));
      const saglayiciEtkin = yeniYaklasan.length > 0 && Boolean(await new SaglayiciAyarlariService(this.platform).etkin());
      const hatirlatilan: TahsilatAdayi[] = [];
      for (const a of yeniYaklasan) {
        const alicilar = firmaAlicilari(a);
        const baglanti = odemeBaglantisi(a, saglayiciEtkin, simdi);
        try {
          if (alicilar.length) {
            await this.ileti.gonder({
              tur: "abonelik_hatirlatma", tenantId: a.tenant_id, alicilar,
              konu: "TekirExtra aboneliğinizin dönemi bitiyor",
              metin: baglanti
                ? `Merhaba,\n\n${a.unvan.trim()} firmasının TekirExtra abonelik dönemi ${tarih(a.donem_sonu)} tarihinde bitiyor. Kesintisiz kullanım için ödemenizi dönem sonundan önce aşağıdaki bağlantıdan kartla yapabilirsiniz:\n\n${baglanti}\n\nÖdemeyi panelde Ayarlar › Abonelik sayfasından da yapabilirsiniz. Ödeme alındığında dönem hemen uzar ve makbuz e-postanıza gelir.`
                : `Merhaba,\n\n${a.unvan.trim()} firmasının TekirExtra abonelik dönemi ${tarih(a.donem_sonu)} tarihinde bitiyor. Kesintisiz kullanım için ödemenizi dönem sonundan önce yapın; ödeme bilgileri için bu e-postayı yanıtlayabilirsiniz.\n\nÖdeme alındığında dönem uzatılır ve size ayrıca bilgi verilir.`,
            });
          }
          await db.mevzuatOlay.create({ data: { olay: "tahsilat_hatirlatma", detay: { anahtar: yaklasanAnahtari(a), tenantId: a.tenant_id, donemSonu: a.donem_sonu, alici: alicilar.length, odemeBaglantisi: Boolean(baglanti) } as Prisma.InputJsonValue } });
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
        await this.ileti.gonder({ tur: "abonelik_ozeti", alicilar: platformAlicilari, konu: ozetGerekli ? "TekirExtra tahsilat özeti: askıya alınacak firmalar" : "TekirExtra tahsilat: dönemi yaklaşan firmalar", metin: bolumler.join("\n\n") });
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
