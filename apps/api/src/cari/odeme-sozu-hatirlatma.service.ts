import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "../tenant/eposta.service";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { odemeSozuKaynaklariniOku } from "./odeme-sozu-kaynak";
import { itirazliCariler } from "./tahsilat-iletisim";
import { TAHSILAT_MODULU, tahsilatAyariSemasi } from "./tahsilat-erisim";
import { nabizla } from "../core/nabiz/nabiz";

const ARALIK = 15 * 60 * 1000;
const SISTEM = "00000000-0000-4000-8000-000000000000";
export const istanbulSaat = (zaman: Date) => ({
  gun: zaman.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }),
  saat: Number(zaman.toLocaleTimeString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false })),
});
/** Yalnız sunucunun kesinlikle kabul etmediği SMTP denemeleri tekrar edilir. */
export function guvenliTekrar(hata: unknown): boolean {
  const e = hata as { code?: string; command?: string; responseCode?: number } | null;
  return Boolean(e && (["EDNS", "ECONNECTION", "EAUTH", "ETLS"].includes(e.code ?? "") ||
    (e.responseCode && e.responseCode >= 400 && e.responseCode <= 599)));
}

/** Sadece ödeme sözü e-postası için ayrılmış worker; diğer otomasyonları başlatmaz. */
@Injectable()
export class OdemeSozuHatirlatmaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OdemeSozuHatirlatmaService.name);
  private zamanlayici?: NodeJS.Timeout;
  private ilk?: NodeJS.Immediate;
  private calisiyor = false;
  private kapandi = false;
  private sonBasariliTarama: number | null = null;
  constructor(private readonly prisma: PrismaService, private readonly eposta: EpostaService, @Optional() private readonly erisim?: AbonelikErisimService) {}
  onModuleInit() {
    if (process.env.TEKIR_ODEME_SOZU_WORKER !== "1") return;
    z.uuid().parse(process.env.ODEME_SOZU_HATIRLATMA_TENANT_ID);
    this.ilk = setImmediate(() => void nabizla("odeme-sozu-hatirlatma", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("odeme-sozu-hatirlatma", () => this.calistir()), ARALIK);
  }
  onModuleDestroy() { this.kapandi = true; if (this.ilk) clearImmediate(this.ilk); if (this.zamanlayici) clearInterval(this.zamanlayici); }
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
      const cari = await tx.cariHesap.findFirst({ where: { tenantId, id: ilk.cariId, aktif: true, karaListe: false }, select: { unvan: true, eposta: true } });
      const adres = z.email().max(255).safeParse(cari?.eposta?.trim());
      if (!cari || !adres.success || (await itirazliCariler(tx, tenantId, [ilk.cariId])).size) return null;
      const fatura = await tx.fatura.findFirst({ where: { tenantId, id: soz.faturaId, cariId: ilk.cariId, durum: "kesin", tip: "satis" }, select: { no: true, durum: true, genelToplam: true, ...FATURA_ODEME_SECIMI } });
      if (!fatura) return null;
      // Aynı gün/önceki tahsilatlar söz uzlaştırmasında sayılmasa da ödenmiş faturaya ileti çıkmaz.
      const kalan = Prisma.Decimal.min(soz.gerceklesme.kalan, faturaOdemeDurumu(fatura).kalan);
      if (!kalan.gt(0)) return null;
      const firma = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { unvan: true } });
      const konu = `Ödeme sözü hatırlatması — ${gun.split("-").reverse().join(".")}`;
      const messageId = `<odeme-sozu-${sozId}@tekirextra.local>`;
      const metin = `Sayın ${cari.unvan},\n\n${firma.unvan} ile paylaştığınız ödeme sözünün tarihi bugün (${gun.split("-").reverse().join(".")}).\n\nFatura: ${fatura.no ?? "Numarasız fatura"}\nSöz tutarı: ${soz.tutar} ${soz.dovizCinsi}\nHatırlatılan kalan tutar: ${kalan.toFixed(2)} ${soz.dovizCinsi}\n\nÖdemenizi bugün gerçekleştirmenizi rica ederiz. Ödemenizi yaptıysanız bu hatırlatmayı dikkate almayabilir, ödeme bilginizi bizimle paylaşabilirsiniz.\n\nTeşekkür ederiz.\n${firma.unvan}`;
      const data = { durum: "gonderiliyor", deneme: (eski?.deneme ?? 0) + 1, alici: adres.data, konu, messageId, baslangicAt: simdi, sonrakiDenemeAt: null, hataMesaji: null };
      await tx.odemeSozuHatirlatma.upsert({ where: { tenantId_sozId: { tenantId, sozId } }, create: { tenantId, sozId, ...data }, update: data });
      return { alici: adres.data, konu, metin, messageId };
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
              await this.eposta.odemeSozuHatirlat(ileti);
            } catch (hata) {
              await this.prisma.tenantIslem(tenantId, tx => tx.odemeSozuHatirlatma.update({ where: { tenantId_sozId: { tenantId, sozId: id } }, data: { durum: guvenliTekrar(hata) ? "basarisiz" : "belirsiz", sonrakiDenemeAt: guvenliTekrar(hata) ? new Date(Date.now() + ARALIK) : null, hataMesaji: (hata instanceof Error ? hata.message : "SMTP gönderim sonucu belirsiz").slice(0, 1000) } }));
              throw hata;
            }
            // Buradaki DB hatası, SMTP başarısını yeniden gönderime dönüştürmez.
            await this.prisma.tenantIslem(tenantId, tx => tx.odemeSozuHatirlatma.update({ where: { tenantId_sozId: { tenantId, sozId: id } }, data: { durum: "gonderildi", gonderildiAt: new Date(), sonrakiDenemeAt: null } }));
            sonuc.gonderilen++;
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
      const tenantId = z.uuid().parse(process.env.ODEME_SOZU_HATIRLATMA_TENANT_ID);
      const sonuc = await this.taraTenant(tenantId);
      this.sonBasariliTarama = Date.now();
      this.logger.log(JSON.stringify({ event: "promise_email_scan", tenantId, ...sonuc }));
    } catch (hata) { this.logger.error(hata instanceof Error ? hata.message : String(hata)); }
    finally { this.calisiyor = false; }
  }
}
