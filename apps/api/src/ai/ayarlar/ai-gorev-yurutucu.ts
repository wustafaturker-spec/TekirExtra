import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../../core/abonelik-erisim.service";
import { PrismaClient, type TenantAiGorev } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Rol } from "@tekirextra/shared";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { baglamlaCalistir } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { AiAjanService } from "../ajan/ai-ajan.service";
import { UC } from "../ajan/araclar/uclar";
import { UcCagirici } from "../ajan/uc-cagirici";
import { trSimdi, type TrSimdi } from "../ai-zaman";
import { AiIcgoruService } from "../icgoru/ai-icgoru.service";
import { AnalizYapilamadi, icgoruMetni } from "../icgoru/nakit-tahsilat-analizi";
import { AiSinirHatasi } from "../saglayici/ai-butce";
import { kiraciSaglayicisi } from "../saglayici/kiraci-saglayici";
import { brifingMetni, brifingOncelikleri, brifingOnemi, brifingTamMetni, brifingVerisiTopla } from "../icgoru/gunluk-brifing";

export { trSimdi, type TrSimdi };

const BES_DAKIKA_MS = 5 * 60 * 1000;
const AZAMI_DENEME = 3;
const SAHIPLIK_ZAMAN_ASIMI_MS = 15 * 60 * 1000;

/** AI-30: bütçe ya da günlük sınır; aynı gün yeniden denemek sonucu değiştirmez. */
class GorevSinirHatasi extends Error {}

/** AI-16: saat geçmiş, gün listedeyse (boş = her gün) ve bugün henüz tetiklenmediyse. */
export function gorevZamaniGeldiMi(g: Pick<TenantAiGorev, "aktif" | "zamanlamaCron" | "gunler" | "sonTetikGunu">, simdi: TrSimdi): boolean {
  if (!g.aktif) return false;
  if (g.sonTetikGunu && g.sonTetikGunu.toISOString().slice(0, 10) === simdi.gun) return false;
  if (g.gunler.length && !g.gunler.includes(simdi.haftaGunu)) return false;
  return simdi.saat >= (g.zamanlamaCron ?? "09:00");
}

/**
 * AI-16: görevi sahibinin kimliği ve güncel rolüyle çalıştırır (asistan, yalnız
 * okuma araçları). Zamanlanmış çalışmada sonuç sahibine bildirim olarak düşer;
 * e-posta bildirim tercihine göre gider. Worker'da 5 dakikada bir tarar.
 */
@Injectable()
export class AiGorevYurutucu implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiGorevYurutucu.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ajan: AiAjanService,
    private readonly uc: UcCagirici,
    private readonly bildirimler: BildirimService,
    private readonly icgoru: AiIcgoruService,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    this.zamanlayici = setInterval(() => void this.taraGuvenli(), BES_DAKIKA_MS);
    setImmediate(() => void this.taraGuvenli());
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  /** Sahibin bağlamında çalıştırır; sonucu kaydeder. `bildir` zamanlanmış çalışmada sonucu bildirime çevirir. */
  async yurut(tenantId: string, gorev: TenantAiGorev, secenek: { bildir?: boolean } = {}): Promise<{ metin: string; basarili: boolean; sinir?: boolean }> {
    const sahip = gorev.userId
      ? await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findFirst({ where: { id: gorev.userId!, aktif: true }, select: { id: true, rol: true } }))
      : null;
    let metin: string;
    let basarili = true;
    let sinir = false;
    let onem: "bilgi" | "uyari" | "kritik" = "bilgi";
    const nakitTahsilat = gorev.tur === "NAKIT_TAHSILAT";
    const brifing = gorev.tur === "BRIFING";
    if (!sahip) {
      metin = "Çalışmadı: görev sahibi kullanıcı yok ya da etkin değil.";
      basarili = false;
    } else if (brifing) {
      // AI-83: bölümler sahibin rolüyle uçlardan okunur; model yalnız öncelik yazar (ekonomik, sayılar kaynaktan).
      try {
        const sonuc = await baglamlaCalistir({ tenantId, userId: sahip.id, rol: sahip.rol as Rol }, async () => {
          const veri = await brifingVerisiTopla((uc, arg) => this.uc.cagir(uc, arg), trSimdi().gun);
          const duz = brifingMetni(veri);
          const saglayici = await kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "ozet" }).then((x) => x.saglayici).catch(() => null);
          return { metin: brifingTamMetni(duz, await brifingOncelikleri(saglayici, duz)), onem: brifingOnemi(veri) };
        });
        metin = sonuc.metin;
        onem = sonuc.onem;
      } catch (hata) {
        metin = `Çalışmadı: ${hata instanceof Error ? hata.message : String(hata)}`;
        basarili = false;
      }
    } else if (nakitTahsilat) {
      // AI-23: deterministik analiz; model, AI-14 onayı ve AI-15 sayacı devreye girmez.
      try {
        const { icerik } = await baglamlaCalistir({ tenantId, userId: sahip.id, rol: sahip.rol as Rol }, () => this.icgoru.analizEt({ gorevId: gorev.id }));
        metin = icgoruMetni(icerik);
        onem = icerik.onem;
      } catch (hata) {
        metin = hata instanceof AnalizYapilamadi ? `Çalışmadı: ${hata.message.replace(/^Analiz yapılamadı: /, "")}` : `Çalışmadı: ${hata instanceof Error ? hata.message : String(hata)}`;
        basarili = false;
      }
    } else {
      try {
        const sonuc = await baglamlaCalistir({ tenantId, userId: sahip.id, rol: sahip.rol as Rol }, () => this.ajan.gorevYurut(gorev.ad, gorev.gorevTalimati));
        metin = sonuc.kapali ? `Çalışmadı: ${sonuc.kapali}` : sonuc.cevap;
      } catch (hata) {
        metin = `Çalışmadı: ${hata instanceof Error ? hata.message : String(hata)}`;
        basarili = false;
        sinir = hata instanceof AiSinirHatasi;
      }
    }
    await this.prisma.tenantIslem(tenantId, (tx) => tx.tenantAiGorev.update({ where: { id: gorev.id }, data: { sonCalisma: new Date(), sonSonuc: metin } }));
    if (secenek.bildir && sahip && basarili) {
      await baglamlaCalistir({ tenantId, userId: sahip.id, rol: sahip.rol as Rol }, () =>
        this.bildirimler.uret({
          tur: "yapay_zeka", onem, baslik: brifing ? gorev.ad : `Görev: ${gorev.ad}`, aciklama: metin.slice(0, 1500),
          birlesimAnahtari: `yapay_zeka:gorev:${gorev.id}:${trSimdi().gun}`, kaynakTur: "ai_gorev", kaynakRef: gorev.id,
          hedefYol: nakitTahsilat ? "/panel/nakit-akisi" : brifing ? "/panel/bildirimler" : "/panel/ayarlar/yapay-zeka", roller: [], kullaniciIdler: [sahip.id],
        }),
      ).catch((h: unknown) => this.logger.warn(`Görev bildirimi üretilemedi: ${String(h)}`));
    }
    return { metin, basarili, ...(sinir ? { sinir } : {}) };
  }

  private async sonHatayiBildir(gorev: TenantAiGorev, mesaj: string, sinirda = false): Promise<void> {
    const kullanicilar = await this.prisma.tenantIslem(gorev.tenantId, (tx) =>
      tx.user.findMany({ where: { aktif: true, OR: [...(gorev.userId ? [{ id: gorev.userId }] : []), { rol: "yonetici" }] }, select: { id: true, rol: true } }),
    );
    const baglamKullanicisi = kullanicilar.find((k) => k.id === gorev.userId) ?? kullanicilar[0];
    if (!baglamKullanicisi) return;
    await baglamlaCalistir({ tenantId: gorev.tenantId, userId: baglamKullanicisi.id, rol: baglamKullanicisi.rol as Rol }, () =>
      this.bildirimler.uret({
        tur: "yapay_zeka",
        onem: "kritik",
        baslik: `AI görevi çalıştırılamadı: ${gorev.ad}`,
        aciklama: `${sinirda ? "Yapay zekâ sınırına ulaşıldığı için yeniden denenmedi." : "Üç deneme başarısız oldu."} ${mesaj}`.slice(0, 1500),
        birlesimAnahtari: `yapay_zeka:gorev:hata:${gorev.id}:${trSimdi().gun}`,
        kaynakTur: "ai_gorev",
        kaynakRef: gorev.id,
        hedefYol: "/panel/ayarlar/yapay-zeka",
        roller: ["yonetici"],
        kullaniciIdler: gorev.userId ? [gorev.userId] : [],
      }),
    ).catch((hata: unknown) => this.logger.warn(`Görev hata bildirimi üretilemedi: ${String(hata)}`));
  }

  /** Benzersiz gün kaydı ve sahiplik belirteci, süreçler arası atomik kilittir. */
  private async sahiplen(yonetim: PrismaClient, gorev: TenantAiGorev, simdi: TrSimdi): Promise<{ id: string; deneme: number; anahtar: string } | null> {
    const tetikGunu = new Date(`${simdi.gun}T00:00:00.000Z`);
    const anahtar = randomUUID();
    const mevcut = await yonetim.tenantAiGorevCalisma.upsert({
      where: { gorevId_tetikGunu: { gorevId: gorev.id, tetikGunu } },
      create: { tenantId: gorev.tenantId, gorevId: gorev.id, tetikGunu, durum: "calisiyor", sahiplikAnahtari: anahtar },
      update: {},
      select: { id: true, durum: true, deneme: true, sahiplikAnahtari: true, sonrakiDenemeAt: true, basladiAt: true },
    });
    if (mevcut.sahiplikAnahtari === anahtar) return { id: mevcut.id, deneme: 1, anahtar };

    const an = new Date();
    const zamaniGecmis = mevcut.durum === "calisiyor" && mevcut.basladiAt.getTime() < an.getTime() - SAHIPLIK_ZAMAN_ASIMI_MS;
    const yenidenDenenebilir = mevcut.durum === "hata" && mevcut.deneme < AZAMI_DENEME && (!mevcut.sonrakiDenemeAt || mevcut.sonrakiDenemeAt <= an);
    if (!zamaniGecmis && !yenidenDenenebilir) return null;
    const alindi = await yonetim.tenantAiGorevCalisma.updateMany({
      where: {
        id: mevcut.id,
        sahiplikAnahtari: mevcut.sahiplikAnahtari,
        durum: mevcut.durum,
        deneme: mevcut.deneme,
      },
      data: { durum: "calisiyor", sahiplikAnahtari: anahtar, deneme: { increment: 1 }, basladiAt: an, bittiAt: null, hata: null },
    });
    return alindi.count === 1 ? { id: mevcut.id, deneme: mevcut.deneme + 1, anahtar } : null;
  }

  /** Vade/kasa tetikleyicisinin koşulu, sahibin rolüyle rapor uçlarından okunur. */
  async kosulSaglandi(gorev: TenantAiGorev): Promise<boolean> {
    try {
      if (gorev.tetikleyici === "VADE_GECIKMESI") {
        const r = await this.uc.cagir<{ toplamAlacak: string }>(UC.vadesiGecenler, []);
        return Number(r.toplamAlacak) > 0;
      }
      if (gorev.tetikleyici === "KASA_KRITIK") {
        const r = await this.uc.cagir<{ nakitVarliklar: string }>(UC.finansalOzet, []);
        return gorev.esikTutar !== null && Number(r.nakitVarliklar) < Number(gorev.esikTutar);
      }
      return true;
    } catch (hata) {
      if (hata instanceof ForbiddenException) return false;
      throw hata;
    }
  }

  // Zamanlayıcıdan çağrılır: veritabanı anlık erişilemezse hata yakalanmadan süreci düşürmesin, sonraki turda yeniden dener.
  private async taraGuvenli(): Promise<void> {
    try { await this.tara(); }
    catch (hata) { this.logger.error(`AI görev taraması başarısız: ${hata instanceof Error ? hata.message.split("\n").filter(Boolean).pop() : String(hata)}`); }
  }

  async tara(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
      if (!yonetimUrl) return;
      const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
      try {
        const gorevler = await yonetim.tenantAiGorev.findMany({ where: { aktif: true } });
        const simdi = trSimdi();
        for (const g of gorevler.filter((x) => gorevZamaniGeldiMi(x, simdi))) {
          // PLT-05: askıdaki firmada yapay zekâ görevleri ve günlük brifing çalışmaz; sahiplenilmediği için açılınca ilk turda çalışır.
          if (await this.erisim?.otomasyonDurdu(g.tenantId)) continue;
          const calisma = await this.sahiplen(yonetim, g, simdi);
          if (!calisma) continue;
          try {
            const sahip = g.userId ? await this.prisma.tenantIslem(g.tenantId, (tx) => tx.user.findFirst({ where: { id: g.userId!, aktif: true }, select: { id: true, rol: true } })) : null;
            const kosul = sahip ? await baglamlaCalistir({ tenantId: g.tenantId, userId: sahip.id, rol: sahip.rol as Rol }, () => this.kosulSaglandi(g)) : true;
            if (!kosul) {
              await yonetim.tenantAiGorevCalisma.update({ where: { id: calisma.id }, data: { durum: "kosul_saglanmadi", bittiAt: new Date(), sonuc: "Tetikleyici koşulu sağlanmadı." } });
              await yonetim.tenantAiGorev.update({ where: { id: g.id }, data: { sonTetikGunu: new Date(`${simdi.gun}T00:00:00Z`) } });
              continue;
            }
            const sonuc = await this.yurut(g.tenantId, g, { bildir: true });
            if (!sonuc.basarili) throw sonuc.sinir ? new GorevSinirHatasi(sonuc.metin) : new Error(sonuc.metin);
            await yonetim.tenantAiGorevCalisma.update({ where: { id: calisma.id }, data: { durum: "basarili", bittiAt: new Date(), sonuc: sonuc.metin, sonrakiDenemeAt: null } });
            await yonetim.tenantAiGorev.update({ where: { id: g.id }, data: { sonTetikGunu: new Date(`${simdi.gun}T00:00:00Z`) } });
          } catch (hata) {
            const mesaj = hata instanceof Error ? hata.message : String(hata);
            const sinirda = hata instanceof GorevSinirHatasi;
            const sonDeneme = sinirda || calisma.deneme >= AZAMI_DENEME;
            await yonetim.tenantAiGorevCalisma.update({
              where: { id: calisma.id },
              // Sınır hatasında deneme hakkı bitmiş sayılır; çalışma bugün yeniden sahiplenilmez.
              data: { durum: "hata", bittiAt: new Date(), hata: mesaj.slice(0, 2000), sonrakiDenemeAt: sonDeneme ? null : new Date(Date.now() + BES_DAKIKA_MS * calisma.deneme), ...(sinirda ? { deneme: AZAMI_DENEME } : {}) },
            });
            if (sonDeneme) await yonetim.tenantAiGorev.update({ where: { id: g.id }, data: { sonTetikGunu: new Date(`${simdi.gun}T00:00:00Z`) } });
            if (sonDeneme) await this.sonHatayiBildir(g, mesaj, sinirda);
            this.logger.error(`AI görevi çalıştırılamadı (${g.id}, deneme ${calisma.deneme}/${AZAMI_DENEME}): ${mesaj}`);
          }
        }
      } finally {
        await yonetim.$disconnect().catch(() => {});
      }
    } catch (err) {
      const mesaj = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI görevleri taranırken bağlantı/işlem hatası: ${mesaj}`);
    } finally {
      this.calisiyor = false;
    }
  }
}
