import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "../tenant/eposta.service";
import { IletiSiniriAsildi } from "../ileti/ileti-kurallari";
import { sozSmsSablonu } from "../ileti/sms-kurallari";
import { IletiSablonService } from "../ileti/ileti-sablon.service";
import { varsayilanSablon } from "../ileti/ileti-sablonlari";
import { SmsService } from "../ileti/sms.service";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { odemeSozuKaynaklariniOku } from "./odeme-sozu-kaynak";
import { itirazliCariler } from "./tahsilat-iletisim";
import { TAHSILAT_MODULU, tahsilatAyariSemasi } from "./tahsilat-erisim";
import { nabizla } from "../core/nabiz/nabiz";

const ARALIK = 15 * 60 * 1000;
/** Bir firmanın yavaş e-posta sunucusu diğerlerini bekletmesin. */
const ESZAMANLI_FIRMA = 4;
const SISTEM = "00000000-0000-4000-8000-000000000000";
export const istanbulSaat = (zaman: Date) => ({
  gun: zaman.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }),
  saat: Number(zaman.toLocaleTimeString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false })),
});
/** Yalnız sunucunun kesinlikle kabul etmediği SMTP denemeleri tekrar edilir. */
export function guvenliTekrar(hata: unknown): boolean {
  // ILT-14: sınıra takılan ileti hiç çıkmadı.
  if (hata instanceof IletiSiniriAsildi) return true;
  const e = hata as { code?: string; command?: string; responseCode?: number } | null;
  return Boolean(e && (["EDNS", "ECONNECTION", "EAUTH", "ETLS"].includes(e.code ?? "") ||
    (e.responseCode && e.responseCode >= 400 && e.responseCode <= 599)));
}

/** Sadece ödeme sözü e-postası için ayrılmış worker; tahsilat modu açık tüm firmaları tarar, diğer otomasyonları başlatmaz. */
@Injectable()
export class OdemeSozuHatirlatmaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OdemeSozuHatirlatmaService.name);
  private zamanlayici?: NodeJS.Timeout;
  private ilk?: NodeJS.Immediate;
  private calisiyor = false;
  private kapandi = false;
  private sonBasariliTarama: number | null = null;
  constructor(private readonly prisma: PrismaService, private readonly eposta: EpostaService, @Optional() private readonly erisim?: AbonelikErisimService, @Optional() private readonly sms?: SmsService, @Optional() private readonly sablonlar?: IletiSablonService) {}
  onModuleInit() {
    if (process.env.TEKIR_ODEME_SOZU_WORKER !== "1") return;
    this.sabitFirma();
    this.ilk = setImmediate(() => void nabizla("odeme-sozu-hatirlatma", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("odeme-sozu-hatirlatma", () => this.calistir(), ARALIK), ARALIK);
  }
  onModuleDestroy() { this.kapandi = true; if (this.ilk) clearImmediate(this.ilk); if (this.zamanlayici) clearInterval(this.zamanlayici); }
  /** İsteğe bağlı: tanımlıysa yalnız bu firma taranır (kademeli açılış ve deneme için). */
  private sabitFirma() { const v = process.env.ODEME_SOZU_HATIRLATMA_TENANT_ID?.trim(); return v ? z.uuid().parse(v) : null; }
  /** Yalnız tahsilat modu pilot ya da açık firmalar; yönetim bağlantısı yalnız kimlik keşfeder, asıl denetim firma işleminde yenilenir. */
  async firmalar(): Promise<string[]> {
    const sabit = this.sabitFirma();
    if (sabit) return [sabit];
    if (!process.env.DATABASE_URL_MIGRATE) throw new Error("Ödeme sözü firma keşfi için DATABASE_URL_MIGRATE gerekli");
    const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
    try {
      const k = await yonetim.modulAyar.findMany({ where: { modul: TAHSILAT_MODULU, OR: [{ ayarlar: { path: ["mod"], equals: "pilot" } }, { ayarlar: { path: ["mod"], equals: "acik" } }] }, select: { tenantId: true } });
      return k.map((x) => x.tenantId);
    } finally { await yonetim.$disconnect(); }
  }
  saglikli() { return this.sonBasariliTarama !== null && Date.now() - this.sonBasariliTarama < ARALIK * 2; }
  private async zaman(tx: Prisma.TransactionClient) {
    const [r] = await tx.$queryRaw<{ zaman: Date }[]>`SELECT clock_timestamp() AS zaman`;
    return r.zaman;
  }
  private async acik(tx: Prisma.TransactionClient, tenantId: string) {
    const a = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: TAHSILAT_MODULU } } });
    const s = tahsilatAyariSemasi.safeParse(a?.ayarlar ?? {});
    return s.success && ["pilot", "acik"].includes(s.data.mod);
  }
  private async ayir(tenantId: string, sozId: string) {
    return this.prisma.tenantIslem(tenantId, async tx => {
      // Birden çok worker aynı sözü okusa bile tek SMTP denemesi ayırabilir.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ":soz-eposta:" + sozId},0))::text`;
      const ilk = await tx.odemeSozu.findFirst({ where: { id: sozId, tenantId } });
      if (!ilk) return null;
      // Söz revizyonu/iptali aynı cari kilidini kullanır.
      await tx.$queryRaw`SELECT id FROM cari_hesaplar WHERE tenant_id=${tenantId}::uuid AND id=${ilk.cariId}::uuid FOR UPDATE`;
      const simdi = await this.zaman(tx), { gun, saat } = istanbulSaat(simdi);
      if (saat < 9 || !await this.acik(tx, tenantId)) return null;
      const eski = await tx.odemeSozuHatirlatma.findUnique({ where: { tenantId_sozId: { tenantId, sozId } } });
      if (eski && (eski.durum !== "basarisiz" || eski.deneme >= 3 || !eski.sonrakiDenemeAt || eski.sonrakiDenemeAt > simdi)) return null;
      const kaynak = await odemeSozuKaynaklariniOku(tx, tenantId, ilk.cariId);
      const soz = kaynak.sozler.find(s => s.id === sozId);
      if (!soz || soz.kayitDurumu !== "aktif" || soz.sozTarihi !== gun || !soz.gerceklesme || !["aktif", "kismen_gerceklesti"].includes(soz.gerceklesme.durum)) return null;
      const cari = await tx.cariHesap.findFirst({ where: { tenantId, id: ilk.cariId, aktif: true, karaListe: false }, select: { unvan: true, eposta: true, telefon: true, smsHatirlatma: true } });
      const adres = z.email().max(255).safeParse(cari?.eposta?.trim());
      if (!cari || !adres.success || (await itirazliCariler(tx, tenantId, [ilk.cariId])).size) return null;
      const fatura = await tx.fatura.findFirst({ where: { tenantId, id: soz.faturaId, cariId: ilk.cariId, durum: "kesin", tip: "satis" }, select: { no: true, durum: true, genelToplam: true, ...FATURA_ODEME_SECIMI } });
      if (!fatura) return null;
      // Aynı gün/önceki tahsilatlar söz uzlaştırmasında sayılmasa da ödenmiş faturaya ileti çıkmaz.
      const kalan = Prisma.Decimal.min(soz.gerceklesme.kalan, faturaOdemeDurumu(fatura).kalan);
      if (!kalan.gt(0)) return null;
      const firma = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { unvan: true } });
      const messageId = `<odeme-sozu-${sozId}@tekirextra.local>`;
      const sablon = { tur: "odeme_sozu_eposta", degiskenler: { cari: cari.unvan, firma: firma.unvan, tarih: gun.split("-").reverse().join("."), fatura_no: fatura.no ?? "Numarasız fatura", soz_tutari: `${soz.tutar} ${soz.dovizCinsi}`, kalan_tutar: `${kalan.toFixed(2)} ${soz.dovizCinsi}` } };
      const { konu, metin } = this.sablonlar ? await this.sablonlar.uret(sablon, tenantId, tx) : varsayilanSablon(sablon);
      const data = { durum: "gonderiliyor", deneme: (eski?.deneme ?? 0) + 1, alici: adres.data, konu, messageId, baslangicAt: simdi, sonrakiDenemeAt: null, hataMesaji: null };
      await tx.odemeSozuHatirlatma.upsert({ where: { tenantId_sozId: { tenantId, sozId } }, create: { tenantId, sozId, ...data }, update: data });
      // ILT-11/13: izinli cariye e-postadan sonra tek SMS; anahtar söz başına birdir.
      const sms = cari.smsHatirlatma && cari.telefon ? { telefon: cari.telefon, cariId: ilk.cariId, sablon: sozSmsSablonu({ firma: firma.unvan, unvan: cari.unvan, tutar: `${soz.tutar} ${soz.dovizCinsi}` }) } : null;
      return { alici: adres.data, konu, metin, messageId, sms };
    }, { timeout: 15000 });
  }
  async taraTenant(tenantId: string) {
    z.uuid().parse(tenantId);
    // PLT-05: askıdaki firma müşterisine ödeme sözü e-postası göndermez.
    if (await this.erisim?.otomasyonDurdu(tenantId, "cari")) return { gonderilen: 0, atlanan: 0, hatali: 0 };
    return baglamlaCalistir({ tenantId, userId: SISTEM, rol: "yonetici" }, async () => {
      const baslangic = await this.prisma.tenantIslem(tenantId, async tx => {
        const zaman = await this.zaman(tx);
        if (!await this.acik(tx, tenantId) || istanbulSaat(zaman).saat < 9) return null;
        // SMTP sırasında süreç kesilmiş olabilir. Tekrar gönderip müşteriyi çoğaltma.
        await tx.odemeSozuHatirlatma.updateMany({ where: { tenantId, durum: "gonderiliyor", baslangicAt: { lt: new Date(zaman.getTime() - 10 * 60 * 1000) } }, data: { durum: "belirsiz", hataMesaji: "Gönderim tamamlanmadan süreç kesildi; e-posta geçmişinden kontrol edilmeli." } });
        return istanbulSaat(zaman).gun;
      });
      const sonuc = { gonderilen: 0, atlanan: 0, hatali: 0 };
      if (!baslangic) return sonuc;
      let imlec: string | undefined;
      while (!this.kapandi) {
        const adaylar = await this.prisma.tenantIslem(tenantId, tx => tx.odemeSozu.findMany({ where: { tenantId, kayitDurumu: "aktif", sozTarihi: new Date(baslangic), ...(imlec ? { id: { gt: imlec } } : {}) }, select: { id: true }, orderBy: { id: "asc" }, take: 50 }));
        for (const { id } of adaylar) {
          if (this.kapandi) break;
          try {
            const ileti = await this.ayir(tenantId, id);
            if (!ileti) { sonuc.atlanan++; continue; }
            try {
              await this.eposta.odemeSozuHatirlat({ alici: ileti.alici, konu: ileti.konu, metin: ileti.metin, messageId: ileti.messageId });
            } catch (hata) {
              await this.prisma.tenantIslem(tenantId, tx => tx.odemeSozuHatirlatma.update({ where: { tenantId_sozId: { tenantId, sozId: id } }, data: { durum: guvenliTekrar(hata) ? "basarisiz" : "belirsiz", sonrakiDenemeAt: guvenliTekrar(hata) ? new Date(Date.now() + ARALIK) : null, hataMesaji: (hata instanceof Error ? hata.message : "SMTP gönderim sonucu belirsiz").slice(0, 1000) } }));
              throw hata;
            }
            // Buradaki DB hatası, SMTP başarısını yeniden gönderime dönüştürmez.
            await this.prisma.tenantIslem(tenantId, tx => tx.odemeSozuHatirlatma.update({ where: { tenantId_sozId: { tenantId, sozId: id } }, data: { durum: "gonderildi", gonderildiAt: new Date(), sonrakiDenemeAt: null } }));
            sonuc.gonderilen++;
            // SMS'in hatası e-postayı geri almaz; yalnız kaydı ve log'u kalır.
            if (ileti.sms && this.sms) await this.sms.gonder({ tur: "odeme_sozu_hatirlatma", otomatik: true, anahtar: `soz:${id}`, ...ileti.sms }).catch((hata: unknown) => this.logger.warn(JSON.stringify({ event: "promise_sms_failed", tenantId, sozId: id, error: hata instanceof Error ? hata.message : String(hata) })));
          } catch (hata) {
            sonuc.hatali++;
            this.logger.error(JSON.stringify({ event: "promise_email_failed", tenantId, sozId: id, error: hata instanceof Error ? hata.message : String(hata) }));
          }
        }
        if (adaylar.length < 50) break;
        imlec = adaylar.at(-1)!.id;
      }
      return sonuc;
    });
  }
  async calistir() {
    if (this.calisiyor || this.kapandi) return;
    this.calisiyor = true;
    try {
      const sira = await this.firmalar();
      await Promise.all(Array.from({ length: Math.min(ESZAMANLI_FIRMA, sira.length) }, async () => {
        for (let tenantId = sira.shift(); tenantId && !this.kapandi; tenantId = sira.shift()) {
          // Bir firmanın hatası ötekileri durdurmaz; uzun turda süreç sağlıklı görünmeye devam eder.
          try { this.logger.log(JSON.stringify({ event: "promise_email_scan", tenantId, ...await this.taraTenant(tenantId) })); }
          catch (hata) { this.logger.error(JSON.stringify({ event: "promise_email_tenant_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) })); }
          this.sonBasariliTarama = Date.now();
        }
      }));
      this.sonBasariliTarama = Date.now();
    } catch (hata) { this.logger.error(hata instanceof Error ? hata.message : String(hata)); }
    finally { this.calisiyor = false; }
  }
}
