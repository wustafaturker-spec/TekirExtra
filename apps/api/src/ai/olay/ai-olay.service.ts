import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient, type AiOlay } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { BildirimService } from "../../bildirimler/bildirim.service";
import { aktifBaglam } from "../../core/istek-baglami";
import { kullaniciAdinaCalistir } from "../../core/kullanici-baglami";
import { nabizla } from "../../core/nabiz/nabiz";
import { PrismaService } from "../../core/prisma.service";

/**
 * AI-106: yapay zekâ olay kaydı ve giden kutusu.
 *
 * - `olayYaz` iş kaydını yazan işlemin içinde çağrılır: iş kaydı kalıcıysa olay da kalıcıdır.
 * - Teslimatçı worker'da `nabizla` ile tek süreçte çalışır (Sistem Sağlığı'nda iş olarak
 *   görünür); her olayı ayrıca sahiplik + kira ile alır. Teslim bildirime çevirmektir; bildirim
 *   birleşim anahtarıyla tekil olduğundan teslim sonrası çökme tekrar teslim ettirse de çift
 *   bildirim oluşmaz. Telegram ve e-posta bildirimin kendi teslim kurallarıyla gider; kanal
 *   kapalıysa olay ve bildirim kaybolmaz.
 * - Başarısız teslim artan beklemeyle (30 sn × 2^deneme, en çok 1 sa) yeniden denenir; 6.
 *   denemeden sonra "teslim_edilemedi" olur ve tur hata verir (Sistem Sağlığı / alarm).
 * - 30 günden eski, bekleyen olmayan olaylar silinir.
 */
export const OLAY_AZAMI_DENEME = 6;
export const OLAY_SAKLAMA_GUN = 30;
const TUR_MS = 10_000;
const KIRA_MS = 2 * 60_000;
const PARTI = 50;

export type OlayTuru = "ai_onay.acildi" | "ai_onay.sonuclandi" | "asistan_gorevi.durum";

export interface OlayGirdisi {
  tenantId: string;
  topluTur: "asistan_gorevi" | "ai_onay";
  topluId: string;
  tur: OlayTuru;
  yuk: Record<string, unknown>;
  /** Yalnız olay geçmişi için; bildirime dönüşmez. */
  teslimGerekmez?: boolean;
}

/** İş kaydını yazan işlemin içinde çağrılır. */
export function olayYaz(tx: Prisma.TransactionClient | PrismaClient, o: OlayGirdisi) {
  return tx.aiOlay.create({
    data: {
      tenantId: o.tenantId, topluTur: o.topluTur, topluId: o.topluId, tur: o.tur,
      yuk: JSON.parse(JSON.stringify(o.yuk)) as Prisma.InputJsonValue,
      teslimDurumu: o.teslimGerekmez ? "teslim_gerekmez" : "bekliyor",
    },
  });
}

export const onayBildirimAnahtari = (talepId: string) => `yapay_zeka:talep:${talepId}`;

/** Artan bekleme: 30 sn, 1 dk, 2 dk … en çok 1 saat. */
export function sonrakiDeneme(deneme: number, simdi = new Date()): Date {
  return new Date(simdi.getTime() + Math.min(30_000 * 2 ** Math.max(0, deneme - 1), 3_600_000));
}

export interface GorevOlayi { sira: string; tur: string; durum: unknown; zaman: string }

@Injectable()
export class AiOlayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiOlayService.name);
  private zamanlayici?: NodeJS.Timeout;
  private yonetim?: PrismaClient;
  private sonTemizlik = 0;

  constructor(private readonly prisma: PrismaService, private readonly bildirimler: BildirimService) {}

  /** Görev olayları `sonra` imlecinden sonra, sırayla (en çok 100). Sahiplik çağıranda denetlenir. */
  async gorevOlaylari(gorevId: string, sonra?: string): Promise<{ olaylar: GorevOlayi[]; sonraki: string | null }> {
    const { tenantId } = aktifBaglam();
    const imlec = sonra && /^\d{1,18}$/.test(sonra) ? BigInt(sonra) : 0n;
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiOlay.findMany({
      where: { topluTur: "asistan_gorevi", topluId: gorevId, sira: { gt: imlec } },
      orderBy: { sira: "asc" }, take: 100,
    }));
    const olaylar = kayitlar.map((k) => ({ sira: k.sira.toString(), tur: k.tur, durum: (k.yuk as { durum?: unknown }).durum ?? null, zaman: k.createdAt.toISOString() }));
    return { olaylar, sonraki: olaylar.at(-1)?.sira ?? (sonra ?? null) };
  }

  // ─── Teslimatçı (worker) ────────────────────────────────────────────────

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_MIGRATE) return;
    this.zamanlayici = setInterval(() => void nabizla("ai-olay-teslimatcisi", () => this.tur(), TUR_MS), TUR_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
    await this.yonetim?.$disconnect().catch(() => undefined);
  }

  private db(): PrismaClient {
    return (this.yonetim ??= new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE }));
  }

  /** Bir teslim turu; teslim edilemeyen olay olursa hata fırlatır (Sistem Sağlığı'nda iş hatası). */
  async tur(simdi = new Date(), db: PrismaClient = this.db()): Promise<{ teslim: number; edilemedi: number }> {
    if (simdi.getTime() - this.sonTemizlik > 3_600_000) {
      this.sonTemizlik = simdi.getTime();
      await db.aiOlay.deleteMany({ where: { createdAt: { lt: new Date(simdi.getTime() - OLAY_SAKLAMA_GUN * 86_400_000) }, teslimDurumu: { not: "bekliyor" } } });
    }
    const kosul = (id?: string): Prisma.AiOlayWhereInput => ({
      ...(id ? { id } : {}),
      teslimDurumu: "bekliyor",
      AND: [
        { OR: [{ sonrakiDenemeAt: null }, { sonrakiDenemeAt: { lte: simdi } }] },
        { OR: [{ kiraBitisAt: null }, { kiraBitisAt: { lt: simdi } }] },
      ],
    });
    const adaylar = await db.aiOlay.findMany({ where: kosul(), orderBy: { sira: "asc" }, take: PARTI });
    let teslim = 0, edilemedi = 0;
    for (const o of adaylar) {
      const anahtar = randomUUID();
      const alindi = await db.aiOlay.updateMany({ where: kosul(o.id), data: { sahiplikAnahtari: anahtar, kiraBitisAt: new Date(simdi.getTime() + KIRA_MS) } });
      if (!alindi.count) continue;
      try {
        await this.teslimEt(o);
        await db.aiOlay.updateMany({ where: { id: o.id, sahiplikAnahtari: anahtar }, data: { teslimDurumu: "teslim_edildi", teslimAt: new Date(), sahiplikAnahtari: null, kiraBitisAt: null, hata: null } });
        teslim++;
      } catch (hata) {
        const deneme = o.deneme + 1;
        const son = deneme >= OLAY_AZAMI_DENEME;
        await db.aiOlay.updateMany({
          where: { id: o.id, sahiplikAnahtari: anahtar },
          data: { deneme, hata: (hata instanceof Error ? hata.message : String(hata)).slice(0, 500), sahiplikAnahtari: null, kiraBitisAt: null, ...(son ? { teslimDurumu: "teslim_edilemedi" } : { sonrakiDenemeAt: sonrakiDeneme(deneme, simdi) }) },
        });
        if (son) edilemedi++;
      }
    }
    if (edilemedi) throw new Error(`${edilemedi} yapay zekâ olayı ${OLAY_AZAMI_DENEME} denemede teslim edilemedi`);
    return { teslim, edilemedi };
  }

  /** Olayı bildirime çevirir; bildirim birleşim anahtarıyla tekildir (tekrar teslim güvenli). */
  async teslimEt(o: AiOlay): Promise<void> {
    const yuk = o.yuk as Record<string, any>;
    const userId = typeof yuk.userId === "string" ? yuk.userId : null;
    if (!userId) throw new Error("Olayda kullanıcı yok");
    await kullaniciAdinaCalistir(this.prisma, o.tenantId, userId, async () => {
      switch (o.tur) {
        case "ai_onay.acildi":
          await this.bildirimler.uret({
            tur: "yapay_zeka", onem: "uyari",
            baslik: yuk.kaynak === "mcp" ? "MCP işlemi onayınızı bekliyor" : yuk.kaynak === "otomasyon" ? "E-posta teklif talebi onayınızı bekliyor" : "Asistan işlemi onayınızı bekliyor",
            aciklama: String(yuk.ozet ?? "").slice(0, 500), birlesimAnahtari: onayBildirimAnahtari(o.topluId),
            kaynakTur: "ai_onay_talebi", kaynakRef: o.topluId, hedefYol: `/panel/ai?talep=${o.topluId}`, roller: [], kullaniciIdler: [userId],
          });
          return;
        case "ai_onay.sonuclandi":
          await this.bildirimler.kapatEksikleri("yapay_zeka", [], [onayBildirimAnahtari(o.topluId)]);
          return;
        case "asistan_gorevi.durum": {
          const hata = yuk.durum === "hata";
          if (!hata && yuk.durum !== "tamamlandi") return;
          const konu = String(yuk.konu ?? "").slice(0, 80);
          await this.bildirimler.uret({
            tur: "yapay_zeka", onem: hata ? "uyari" : "bilgi",
            baslik: hata ? "Arka plan analizi tamamlanamadı" : "Arka plan analizi hazır",
            aciklama: (hata ? `"${konu}": ${String(yuk.hata ?? "hata")}` : `"${konu}" sonucu asistan sohbetinizde.`).slice(0, 1500),
            birlesimAnahtari: `yapay_zeka:asistan_gorevi:${o.topluId}`, kaynakTur: "ai_asistan_gorevi", kaynakRef: o.topluId,
            hedefYol: "/panel/ai", roller: [], kullaniciIdler: [userId],
          });
          return;
        }
        default:
          throw new Error(`Bilinmeyen olay türü: ${o.tur}`);
      }
    });
  }
}
