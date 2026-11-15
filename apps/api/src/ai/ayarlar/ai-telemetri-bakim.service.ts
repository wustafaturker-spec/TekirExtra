import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { baglamlaCalistir } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { istanbulAyBaslangici, trSimdi } from "../ai-zaman";
import { buAyMaliyeti, kiraciButceKurali, platformAnahtariMi } from "../saglayici/ai-butce";
import { nabizla } from "../../core/nabiz/nabiz";
import { SISTEM_USER_ID } from "../../core/sistem-kimligi";

const BIR_SAAT_MS = 60 * 60 * 1000;
const IDEMPOTENCY_SAKLAMA_GUN = 7;
const ONAY_KAYDI_SAKLAMA_GUN = 90;
/** AI-24 */
const ICGORU_SAKLAMA_GUN = 90;
const ASGARI_ORNEK = 10;

/** Eski AI izlerini temizler; son saatteki hata/gecikme eşiklerini yöneticilere bildirir. */
@Injectable()
export class AiTelemetriBakimService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiTelemetriBakimService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly prisma: PrismaService, private readonly bildirimler: BildirimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("ai-telemetri-bakim", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("ai-telemetri-bakim", () => this.calistir(), BIR_SAAT_MS), BIR_SAAT_MS);
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  private async tenantIdleriAl(): Promise<string[]> {
    const url = process.env.DATABASE_URL_MIGRATE;
    if (!url) throw new Error("AI telemetri bakımı için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: url });
    try { return (await yonetim.tenant.findMany({ select: { id: true } })).map((x) => x.id); }
    finally { await yonetim.$disconnect(); }
  }

  async tenantBakim(tenantId: string, simdi = new Date()): Promise<{ silinen: number; silinenIdempotency: number; silinenSohbetMesaji: number; silinenOturum: number; silinenOnay: number; silinenKullanim: number; toplam: number; hataOrani: number; ortalamaSureMs: number }> {
    const sonuc = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const ayar = await tx.tenantAiAyari.findUnique({ where: { tenantId }, select: { telemetriSaklamaGun: true, sohbetSaklamaGun: true, aylikMaliyetButcesiUsd: true, telemetriHataEsigiYuzde: true, telemetriGecikmeEsigiMs: true, saglayici: true, apiKey: true, girisTokenMilyonUsd: true, cikisTokenMilyonUsd: true } });
      const saklamaGun = ayar?.telemetriSaklamaGun ?? 90;
      const saklamaSonu = new Date(simdi.getTime() - saklamaGun * 86_400_000);
      const onaySaklamaSonu = new Date(simdi.getTime() - ONAY_KAYDI_SAKLAMA_GUN * 86_400_000);
      const idempotencySonu = new Date(simdi.getTime() - IDEMPOTENCY_SAKLAMA_GUN * 86_400_000);
      const ayBaslangici = istanbulAyBaslangici(simdi);
      // Bütçe ya da platform tavanı varsa bu ayın izleri harcama hesabı için saklanır.
      const butce = await kiraciButceKurali(tx, tenantId, ayar, platformAnahtariMi(ayar));
      const cagriSaklamaSonu = butce.sinirUsd !== null && ayBaslangici < saklamaSonu ? ayBaslangici : saklamaSonu;
      const sohbetSonu = ayar?.sohbetSaklamaGun != null ? new Date(simdi.getTime() - ayar.sohbetSaklamaGun * 86_400_000) : null;
      await tx.aiOnayTalebi.updateMany({ where: { tenantId, durum: "bekliyor", gecerlilikSonu: { lte: simdi } }, data: { durum: "suresi_doldu", kararAt: simdi } });
      await tx.aiIcgoru.deleteMany({ where: { tenantId, hesaplandiAt: { lt: new Date(simdi.getTime() - ICGORU_SAKLAMA_GUN * 86_400_000) } } });
      const [silinen, silinenIdempotency, , silinenSohbetMesaji, silinenOturum, silinenOnay, silinenKullanim, gruplar] = await Promise.all([
        tx.aiCagriIz.deleteMany({ where: { tenantId, createdAt: { lt: cagriSaklamaSonu } } }),
        tx.aiAracIstegi.deleteMany({ where: { tenantId, durum: "tamamlandi", tamamlandiAt: { lt: idempotencySonu } } }),
        tx.aiOcrDenetim.deleteMany({ where: { tenantId, createdAt: { lt: saklamaSonu } } }),
        sohbetSonu ? tx.ajanMesajGecmisi.deleteMany({ where: { oturum: { tenantId }, createdAt: { lt: sohbetSonu }, OR: [{ requestId: null }, { yanit: { not: Prisma.DbNull } }] } }) : Promise.resolve({ count: 0 }),
        sohbetSonu ? tx.ajanOturumu.deleteMany({ where: { tenantId, sonEtkilesim: { lt: sohbetSonu }, mesajlar: { none: { OR: [{ createdAt: { gte: sohbetSonu } }, { requestId: { not: null }, yanit: { equals: Prisma.DbNull } }] } }, onayTalepleri: { none: { durum: { in: ["bekliyor", "isleniyor"] } } } } }) : Promise.resolve({ count: 0 }),
        sohbetSonu ? tx.aiOnayTalebi.deleteMany({ where: { tenantId, durum: { in: ["onaylandi", "reddedildi", "suresi_doldu", "hata"] }, kararAt: { lt: onaySaklamaSonu } } }) : Promise.resolve({ count: 0 }),
        tx.aiKullanim.deleteMany({ where: { tenantId, gun: { lt: new Date(simdi.getTime() - Math.max(saklamaGun, 31) * 86_400_000) } } }),
        tx.aiCagriIz.groupBy({ by: ["basarili"], where: { tenantId, createdAt: { gte: new Date(simdi.getTime() - BIR_SAAT_MS) } }, _count: { _all: true }, _avg: { sureMs: true } }),
      ]);
      const toplam = gruplar.reduce((t, x) => t + x._count._all, 0);
      const hata = gruplar.filter((x) => !x.basarili).reduce((t, x) => t + x._count._all, 0);
      const ortalamaSureMs = toplam ? Math.round(gruplar.reduce((t, x) => t + (x._avg.sureMs ?? 0) * x._count._all, 0) / toplam) : 0;
      const buAyUsd = butce.sinirUsd !== null ? await buAyMaliyeti(tx, tenantId, simdi) : 0;
      return { butce, buAyUsd, silinen: silinen.count, silinenIdempotency: silinenIdempotency.count, silinenSohbetMesaji: silinenSohbetMesaji.count, silinenOturum: silinenOturum.count, silinenOnay: silinenOnay.count, silinenKullanim: silinenKullanim.count, toplam, hataOrani: toplam ? Math.round((hata / toplam) * 100) : 0, ortalamaSureMs, hataEsigi: ayar?.telemetriHataEsigiYuzde ?? 20, gecikmeEsigi: ayar?.telemetriGecikmeEsigiMs ?? 10_000 };
    });

    const acik: string[] = [];
    if (sonuc.toplam >= ASGARI_ORNEK && sonuc.hataOrani >= sonuc.hataEsigi) {
      acik.push("yapay_zeka:telemetri:hata_orani");
      await this.bildirimler.uret({ tur: "yapay_zeka", onem: "kritik", baslik: "AI hata oranı eşiği aşıldı", aciklama: `Son 1 saatte ${sonuc.toplam} çağrının %${sonuc.hataOrani} kadarı başarısız oldu (eşik: %${sonuc.hataEsigi}).`, birlesimAnahtari: acik.at(-1)!, kaynakTur: "ai_telemetri", hedefYol: "/panel/ayarlar/yapay-zeka", roller: ["yonetici"] });
    }
    if (sonuc.toplam >= ASGARI_ORNEK && sonuc.ortalamaSureMs >= sonuc.gecikmeEsigi) {
      acik.push("yapay_zeka:telemetri:gecikme");
      await this.bildirimler.uret({ tur: "yapay_zeka", onem: "uyari", baslik: "AI yanıt süresi eşiği aşıldı", aciklama: `Son 1 saatin ortalama AI yanıt süresi ${sonuc.ortalamaSureMs} ms (eşik: ${sonuc.gecikmeEsigi} ms).`, birlesimAnahtari: acik.at(-1)!, kaynakTur: "ai_telemetri", hedefYol: "/panel/ayarlar/yapay-zeka", roller: ["yonetici"] });
    }
    // AI-29: bütçenin %80'i ve tamamı; anahtar ayı taşır, yeni ayda eskiler kapanır.
    const { butce, buAyUsd } = sonuc;
    if (butce.sinirUsd !== null) {
      const ay = trSimdi(simdi).gun.slice(0, 7);
      const tutar = (x: number) => `${x.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
      const kaynak = butce.platformTavaniUsd === butce.sinirUsd ? "platform tavanı" : "aylık bütçe";
      if (!butce.fiyat) {
        acik.push("yapay_zeka:butce:fiyat");
        await this.bildirimler.uret({ tur: "yapay_zeka", onem: "kritik", baslik: "AI bütçesi ölçülemiyor", aciklama: butce.platformAnahtari ? "Platform yapay zekâ fiyatları tanımlı olmadığından tavan uygulanamıyor; yapay zekâ çağrıları durduruldu. Destek ekibine bildirin." : "Aylık bütçe tanımlı ama token fiyatları girilmemiş; yapay zekâ çağrıları durduruldu. Fiyatları Ayarlar → Yapay Zeka ekranından girin.", birlesimAnahtari: acik.at(-1)!, kaynakTur: "ai_telemetri", hedefYol: "/panel/ayarlar/yapay-zeka", roller: ["yonetici"] });
      } else {
        if (buAyUsd >= butce.sinirUsd * 0.8 && buAyUsd < butce.sinirUsd) {
          acik.push(`yapay_zeka:butce:80:${ay}`);
          await this.bildirimler.uret({ tur: "yapay_zeka", onem: "uyari", baslik: "AI bütçesinin %80'i kullanıldı", aciklama: `Bu ay ${tutar(buAyUsd)} harcandı (${kaynak}: ${tutar(butce.sinirUsd)}). Sınıra ulaşılınca yapay zekâ özellikleri ay sonuna kadar durur.`, birlesimAnahtari: acik.at(-1)!, kaynakTur: "ai_telemetri", hedefYol: "/panel/ayarlar/yapay-zeka", roller: ["yonetici"] });
        }
        if (buAyUsd >= butce.sinirUsd) {
          acik.push(`yapay_zeka:butce:100:${ay}`);
          await this.bildirimler.uret({ tur: "yapay_zeka", onem: "kritik", baslik: "AI bütçesi doldu", aciklama: `Bu ay ${tutar(buAyUsd)} harcandı (${kaynak}: ${tutar(butce.sinirUsd)}). Yapay zekâ özellikleri yeni ayda kendiliğinden açılır.`, birlesimAnahtari: acik.at(-1)!, kaynakTur: "ai_telemetri", hedefYol: "/panel/ayarlar/yapay-zeka", roller: ["yonetici"] });
        }
      }
    }
    await this.bildirimler.kapatEksikleri("yapay_zeka", acik, ["yapay_zeka:telemetri:", "yapay_zeka:butce:"]);
    return { silinen: sonuc.silinen, silinenIdempotency: sonuc.silinenIdempotency, silinenSohbetMesaji: sonuc.silinenSohbetMesaji, silinenOturum: sonuc.silinenOturum, silinenOnay: sonuc.silinenOnay, silinenKullanim: sonuc.silinenKullanim, toplam: sonuc.toplam, hataOrani: sonuc.hataOrani, ortalamaSureMs: sonuc.ortalamaSureMs };
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      for (const tenantId of await this.tenantIdleriAl()) {
        try { await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.tenantBakim(tenantId)); }
        catch (hata) { this.logger.error(JSON.stringify({ event: "ai_telemetry_maintenance_tenant_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) })); }
      }
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "ai_telemetry_maintenance_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally { this.calisiyor = false; }
  }
}
