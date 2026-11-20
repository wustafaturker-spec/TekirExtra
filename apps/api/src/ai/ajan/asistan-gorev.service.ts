import { BadRequestException, HttpException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient, type AiAsistanGorevi } from "@prisma/client";
import { ekranDurumunuAyristir } from "@tekirextra/shared";
import { randomUUID } from "node:crypto";
import { olayYaz } from "../olay/ai-olay.service";
import { aktifBaglam } from "../../core/istek-baglami";
import { kullaniciAdinaCalistir } from "../../core/kullanici-baglami";
import { PrismaService } from "../../core/prisma.service";
import { aiButcesiDoldu } from "../saglayici/kiraci-saglayici";
import { AiBosYanitHatasi } from "../saglayici/ai-bos-yanit";
import { SaglayiciHatasi } from "../saglayici/aracli-ortak";
import { AiAjanService, ArkaPlanSahiplikHatasi, EKRAN_TURLERI, type EkranBaglami, type EkranTuru } from "./ai-ajan.service";

/**
 * AI-105: arka planda süren asistan analizi.
 *
 * - Kuyruğun kaynağı `ai_asistan_gorevleri` tablosudur (BullMQ gerekmez): worker 5 sn'de bir
 *   bekleyen ya da kirası dolmuş işi atomik `updateMany` ile sahiplenir; kira 3 dk, süren işte
 *   dakikada bir tazelenir. Worker çökerse kirası dolan iş bir kez devralınır.
 * - Sonuç mesajı ve "tamamlandi" aynı işlemde, sahiplik koşuluyla yazılır: iki worker ya da
 *   iptal edilmiş iş sonuç yazamaz.
 * - Görev kullanıcının güncel kimliği ve rolüyle (AI-94) yalnız okuma araçlarıyla çalışır;
 *   yan etki üretmediği için yeniden çalışma çift kayıt oluşturmaz.
 * - Yeniden deneme yalnız sağlayıcı/model hatasında ya da çökmede, en çok 3; bütçe/sınır,
 *   yetki ve girdi hataları denenmez.
 * - AI-106: her durum değişikliği aynı işlemde `asistan_gorevi.durum` olayı yazar; "tamamlandi"
 *   ve "hata" olayları teslimatçıda bildirime dönüşür, diğerleri yalnız olay geçmişidir.
 */
export const GOREV_AZAMI_DENEME = 3;
const KIRA_MS = 3 * 60 * 1000;
const NABIZ_MS = 60 * 1000;
const TARAMA_MS = 5 * 1000;
const ESZAMANLI = 2;
const ACIK = ["kuyrukta", "calisiyor"];

export interface AsistanGoreviGorunumu {
  id: string;
  oturumId: string;
  mesaj: string;
  durum: string;
  deneme: number;
  sonucMesajId: string | null;
  hata: string | null;
  createdAt: string;
  bittiAt: string | null;
}

const gorunum = (g: AiAsistanGorevi): AsistanGoreviGorunumu => ({
  id: g.id, oturumId: g.oturumId, mesaj: g.mesaj.slice(0, 200), durum: g.durum, deneme: g.deneme,
  sonucMesajId: g.sonucMesajId, hata: g.hata, createdAt: g.createdAt.toISOString(), bittiAt: g.bittiAt?.toISOString() ?? null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AI-106: görev durum olayı; yalnız "tamamlandi" ve "hata" bildirime dönüşür. */
function durumOlayi(g: Pick<AiAsistanGorevi, "id" | "tenantId" | "userId" | "mesaj">, durum: string, hata?: string) {
  return {
    tenantId: g.tenantId, topluTur: "asistan_gorevi" as const, topluId: g.id, tur: "asistan_gorevi.durum" as const,
    yuk: { userId: g.userId, durum, konu: g.mesaj.replace(/\s+/g, " ").slice(0, 80), ...(hata ? { hata } : {}) },
    teslimGerekmez: durum !== "tamamlandi" && durum !== "hata",
  };
}

/** Yeniden denenebilir mi: sağlayıcı/model hatası ya da beklenmeyen çökme. */
export function yenidenDenenir(hata: unknown): boolean {
  if (hata instanceof SaglayiciHatasi || hata instanceof AiBosYanitHatasi) return true;
  return !(hata instanceof HttpException);
}

/** Görevle saklanan bağlam: yalnız ekran kaydı ve ekran durumu (sözleşmeye indirgenmiş). */
function baglamAyristir(girdi: unknown): EkranBaglami | undefined {
  if (!girdi || typeof girdi !== "object") return undefined;
  const g = girdi as { kayit?: { tur?: unknown; id?: unknown }; durum?: unknown; sayfa?: unknown };
  const kayit = g.kayit && typeof g.kayit.tur === "string" && (EKRAN_TURLERI as readonly string[]).includes(g.kayit.tur) && typeof g.kayit.id === "string" && g.kayit.id.length <= 80
    ? { tur: g.kayit.tur as EkranTuru, id: g.kayit.id } : undefined;
  const durum = ekranDurumunuAyristir(g.durum) ?? undefined;
  const sayfa = typeof g.sayfa === "string" && /^\/panel(\/[a-z0-9-]+)*$/.test(g.sayfa) ? g.sayfa : undefined;
  if (!kayit && !durum && !sayfa) return undefined;
  return { ...(kayit ? { kayit } : {}), ...(durum ? { durum } : {}), ...(sayfa ? { sayfa } : {}) };
}

@Injectable()
export class AsistanGorevService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AsistanGorevService.name);
  private zamanlayici?: NodeJS.Timeout;
  private yonetim?: PrismaClient;
  private calisan = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ajan: AiAjanService,
  ) {}

  // ─── API: kullanıcının isteğiyle ────────────────────────────────────────

  async olustur(girdi: { mesaj?: unknown; requestId?: unknown; baglam?: unknown }): Promise<AsistanGoreviGorunumu> {
    const { tenantId, userId } = aktifBaglam();
    const mesaj = typeof girdi.mesaj === "string" ? girdi.mesaj.trim() : "";
    if (!mesaj) throw new BadRequestException("Lütfen bir talimat yazın.");
    if (mesaj.length > 4000) throw new BadRequestException("Mesaj en çok 4000 karakter olabilir.");
    const istekId = typeof girdi.requestId === "string" && UUID.test(girdi.requestId) ? girdi.requestId : null;
    if (!istekId) throw new BadRequestException("requestId geçerli bir UUID olmalıdır.");
    // (e) Bütçe görev kuyruğa girmeden denetlenir; günlük sınır her model çağrısında ayrıca uygulanır.
    if (await aiButcesiDoldu(this.prisma, tenantId)) throw new HttpException("Bu ayın yapay zekâ bütçesi doldu; arka plan analizi başlatılmadı.", 429);
    const mevcut = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAsistanGorevi.findUnique({ where: { tenantId_userId_istekId: { tenantId, userId, istekId } } }));
    if (mevcut) return gorunum(mevcut);
    const oturum = await this.ajan.webOturumu();
    const baglam = baglamAyristir(girdi.baglam);
    const gorev = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const istek = await tx.ajanMesajGecmisi.create({ data: { oturumId: oturum.id, requestId: istekId, rol: "user", icerik: mesaj, kanal: "WEB" } });
      await tx.ajanOturumu.update({ where: { id: oturum.id }, data: { sonEtkilesim: new Date(), baslik: oturum.baslik ?? mesaj.slice(0, 120) } });
      const yeni = await tx.aiAsistanGorevi.create({ data: { tenantId, userId, oturumId: oturum.id, istekId, istekMesajId: istek.id, mesaj, ...(baglam ? { baglam: baglam as object } : {}) } });
      await olayYaz(tx, durumOlayi(yeni, "kuyrukta"));
      return yeni;
    });
    return gorunum(gorev);
  }

  /** Yalnız sahibi görür; başka kullanıcı ya da firma için 404 (varlık sızdırılmaz). */
  async getir(id: string): Promise<AsistanGoreviGorunumu> {
    const { tenantId, userId } = aktifBaglam();
    if (!UUID.test(id)) throw new NotFoundException("Görev bulunamadı.");
    const g = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAsistanGorevi.findFirst({ where: { id, userId } }));
    if (!g) throw new NotFoundException("Görev bulunamadı.");
    return gorunum(g);
  }

  /** Açık görevler ve son 24 saatte bitenler. */
  async listele(): Promise<AsistanGoreviGorunumu[]> {
    const { tenantId, userId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.aiAsistanGorevi.findMany({
      where: { userId, OR: [{ durum: { in: ACIK } }, { bittiAt: { gte: new Date(Date.now() - 24 * 3600_000) } }] },
      orderBy: { createdAt: "desc" }, take: 20,
    }));
    return kayitlar.map(gorunum);
  }

  async iptal(id: string): Promise<AsistanGoreviGorunumu> {
    const { tenantId, userId } = aktifBaglam();
    await this.getir(id);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const r = await tx.aiAsistanGorevi.updateMany({
        where: { id, userId, durum: { in: ACIK } },
        data: { durum: "iptal", sahiplikAnahtari: null, kiraBitisAt: null, bittiAt: new Date() },
      });
      if (r.count) await olayYaz(tx, durumOlayi({ id, tenantId, userId, mesaj: "" }, "iptal"));
    });
    return this.getir(id);
  }

  // ─── Worker ─────────────────────────────────────────────────────────────

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_MIGRATE) return;
    this.zamanlayici = setInterval(() => void this.tara().catch((h: unknown) => this.logger.error(`Asistan görev taraması başarısız: ${String(h)}`)), TARAMA_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
    await this.yonetim?.$disconnect().catch(() => undefined);
  }

  private yonetimIstemcisi(): PrismaClient {
    return (this.yonetim ??= new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE }));
  }

  /** Bekleyen ya da kirası dolmuş görevleri sahiplenip çalıştırır (en çok ESZAMANLI). */
  async tara(simdi = new Date()): Promise<void> {
    if (this.calisan >= ESZAMANLI) return;
    const db = this.yonetimIstemcisi();
    const adaylar = await db.aiAsistanGorevi.findMany({
      where: { OR: [{ durum: "kuyrukta" }, { durum: "calisiyor", kiraBitisAt: { lt: simdi } }] },
      orderBy: { createdAt: "asc" }, take: ESZAMANLI - this.calisan,
    });
    for (const aday of adaylar) {
      const alinan = await this.sahiplen(db, aday, simdi);
      if (!alinan) continue;
      this.calisan++;
      void this.calistir(db, alinan).finally(() => { this.calisan--; });
    }
  }

  /** Atomik sahiplenme; deneme hakkı bittiyse görev hata olur ve bildirilir. */
  async sahiplen(db: PrismaClient, g: AiAsistanGorevi, simdi = new Date()): Promise<(AiAsistanGorevi & { anahtar: string }) | null> {
    const kosul = { id: g.id, OR: [{ durum: "kuyrukta" }, { durum: "calisiyor", kiraBitisAt: { lt: simdi } }] };
    if (g.deneme >= GOREV_AZAMI_DENEME) {
      await db.$transaction(async (tx) => {
        const r = await tx.aiAsistanGorevi.updateMany({ where: kosul, data: { durum: "hata", hata: "Analiz üç denemede tamamlanamadı.", sahiplikAnahtari: null, kiraBitisAt: null, bittiAt: simdi } });
        if (r.count) await olayYaz(tx, durumOlayi(g, "hata", "Analiz üç denemede tamamlanamadı."));
      });
      return null;
    }
    const anahtar = randomUUID();
    const alindi = await db.$transaction(async (tx) => {
      const r = await tx.aiAsistanGorevi.updateMany({
        where: kosul,
        data: { durum: "calisiyor", sahiplikAnahtari: anahtar, kiraBitisAt: new Date(simdi.getTime() + KIRA_MS), deneme: { increment: 1 }, basladiAt: simdi },
      });
      if (r.count) await olayYaz(tx, durumOlayi(g, "calisiyor"));
      return r.count === 1;
    });
    return alindi ? { ...g, deneme: g.deneme + 1, anahtar } : null;
  }

  async calistir(db: PrismaClient, g: AiAsistanGorevi & { anahtar: string }): Promise<void> {
    const durdur = new AbortController();
    const nabiz = setInterval(() => void db.aiAsistanGorevi.updateMany({
      where: { id: g.id, sahiplikAnahtari: g.anahtar, durum: "calisiyor" },
      data: { kiraBitisAt: new Date(Date.now() + KIRA_MS) },
    }).then((r) => { if (r.count === 0) durdur.abort(); }).catch(() => undefined), NABIZ_MS);
    try {
      await kullaniciAdinaCalistir(this.prisma, g.tenantId, g.userId, () => this.ajan.mesajiIsle(g.mesaj, undefined, (g.baglam ?? undefined) as EkranBaglami | undefined, [], {
        sinyal: durdur.signal,
        arkaPlan: {
          oturumId: g.oturumId,
          istekMesajId: g.istekMesajId,
          sonucYaz: async (tx, sonucMesajId) => {
            const r = await tx.aiAsistanGorevi.updateMany({
              where: { id: g.id, sahiplikAnahtari: g.anahtar, durum: "calisiyor" },
              data: { durum: "tamamlandi", sonucMesajId, sahiplikAnahtari: null, kiraBitisAt: null, bittiAt: new Date(), hata: null },
            });
            if (r.count === 1) await olayYaz(tx, durumOlayi(g, "tamamlandi"));
            return r.count === 1;
          },
        },
      }));
    } catch (hata) {
      if (hata instanceof ArkaPlanSahiplikHatasi || durdur.signal.aborted) return;
      const mesaj = hata instanceof Error ? hata.message.slice(0, 500) : String(hata);
      const tekrar = yenidenDenenir(hata) && g.deneme < GOREV_AZAMI_DENEME;
      await db.$transaction(async (tx) => {
        const r = await tx.aiAsistanGorevi.updateMany({
          where: { id: g.id, sahiplikAnahtari: g.anahtar, durum: "calisiyor" },
          data: tekrar ? { durum: "kuyrukta", sahiplikAnahtari: null, kiraBitisAt: null, hata: mesaj } : { durum: "hata", hata: mesaj, sahiplikAnahtari: null, kiraBitisAt: null, bittiAt: new Date() },
        });
        if (r.count) await olayYaz(tx, durumOlayi(g, tekrar ? "kuyrukta" : "hata", tekrar ? undefined : mesaj));
      });
      this.logger.warn(`Asistan görevi ${g.id} hata verdi (deneme ${g.deneme}${tekrar ? ", yeniden denenecek" : ""}): ${mesaj}`);
    } finally {
      clearInterval(nabiz);
    }
  }
}
