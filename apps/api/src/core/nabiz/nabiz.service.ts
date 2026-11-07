import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { getHeapStatistics } from "node:v8";
import { PrismaService } from "../prisma.service";
import { nabizKaydediciAyarla, TUR_ASIM_ORANI, type NabizSonucu } from "./nabiz";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const mb = (b: number) => Math.round(b / 1048576);

/**
 * PLT-16: süreç nabzı ve zamanlayıcı sonuçlarının kaydı. Her süreç açılışında
 * bir satır açılır (yeniden başlamalar buradan sayılır), 5 dakikada bir bellek
 * yazılır. Kayıtlar kiracı verisi içermez; RLS'siz sistem tablolarıdır.
 */
@Injectable()
export class NabizService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NabizService.name);
  private readonly surecId = randomUUID();
  private zamanlayici?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.NABIZ_KAPALI === "1" || process.env.NODE_ENV === "test") return;
    nabizKaydediciAyarla((s) => this.kaydet(s));
    await this.nabiz(true);
    this.zamanlayici = setInterval(() => void this.nabiz(false), BES_DAKIKA_MS);
    this.zamanlayici.unref();
  }

  onModuleDestroy() {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
    nabizKaydediciAyarla(null);
  }

  private async nabiz(ilk: boolean) {
    const bellek = process.memoryUsage();
    const veri = { rssMb: mb(bellek.rss), heapMb: mb(bellek.heapUsed), heapSinirMb: mb(getHeapStatistics().heap_size_limit), sonNabizAt: new Date() };
    try {
      if (ilk) {
        await this.prisma.sistemSureci.create({ data: { id: this.surecId, tur: process.env.TEKIR_WORKER === "1" ? "worker" : "api", makine: hostname().slice(0, 120), pid: process.pid, ...veri } });
        // 30 günden eski süreç satırları atılır.
        await this.prisma.sistemSureci.deleteMany({ where: { basladiAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
      } else {
        await this.prisma.sistemSureci.update({ where: { id: this.surecId }, data: veri });
      }
    } catch (hata) {
      this.logger.warn(JSON.stringify({ event: "heartbeat_write_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    }
  }

  async kaydet(s: NabizSonucu) {
    const aralik = s.aralikMs && s.aralikMs > 0 ? Math.round(s.aralikMs) : null;
    if (s.atlandi) {
      // BLD-12: atlanan tetik yalnız atlama sayacını işler; süre/başarı/çalışma sayısı değişmez.
      // Sayım 1 saatlik pencerelerle tutulur; pencere dolunca 1'den başlar.
      await this.prisma.$executeRaw`
        INSERT INTO sistem_isleri (is_adi, aralik_ms, son_atlama_at, atlama_pencere_at, pencere_atlama, updated_at)
        VALUES (${s.ad}, ${aralik}, ${s.baslangic}, ${s.baslangic}, 1, now())
        ON CONFLICT (is_adi) DO UPDATE SET
          aralik_ms = COALESCE(EXCLUDED.aralik_ms, sistem_isleri.aralik_ms),
          pencere_atlama = CASE WHEN sistem_isleri.atlama_pencere_at > EXCLUDED.son_atlama_at - interval '1 hour' THEN sistem_isleri.pencere_atlama + 1 ELSE 1 END,
          atlama_pencere_at = CASE WHEN sistem_isleri.atlama_pencere_at > EXCLUDED.son_atlama_at - interval '1 hour' THEN sistem_isleri.atlama_pencere_at ELSE EXCLUDED.son_atlama_at END,
          son_atlama_at = EXCLUDED.son_atlama_at,
          updated_at = now()`;
      return;
    }
    const sure = s.bitis.getTime() - s.baslangic.getTime();
    const uzun = aralik !== null && sure > aralik * TUR_ASIM_ORANI;
    await this.prisma.$executeRaw`
      INSERT INTO sistem_isleri (is_adi, son_baslangic, son_bitis, son_sure_ms, son_basari_at, son_hata, son_hata_at, ardisik_hata, calisma_sayisi, aralik_ms, ardisik_uzun, updated_at)
      VALUES (${s.ad}, ${s.baslangic}, ${s.bitis}, ${sure}, ${s.hata ? null : s.bitis}, ${s.hata}, ${s.hata ? s.bitis : null}, ${s.hata ? 1 : 0}, 1, ${aralik}, ${uzun ? 1 : 0}, now())
      ON CONFLICT (is_adi) DO UPDATE SET
        aralik_ms = COALESCE(EXCLUDED.aralik_ms, sistem_isleri.aralik_ms),
        -- BLD-12: açılış tetiğinde aralık gelmez; kayıtlı aralıkla kıyaslanır.
        ardisik_uzun = CASE WHEN COALESCE(EXCLUDED.aralik_ms, sistem_isleri.aralik_ms) IS NOT NULL
            AND EXCLUDED.son_sure_ms > COALESCE(EXCLUDED.aralik_ms, sistem_isleri.aralik_ms) * ${TUR_ASIM_ORANI}::float8
          THEN sistem_isleri.ardisik_uzun + 1 ELSE 0 END,
        son_baslangic = EXCLUDED.son_baslangic,
        son_bitis = EXCLUDED.son_bitis,
        son_sure_ms = EXCLUDED.son_sure_ms,
        son_basari_at = COALESCE(EXCLUDED.son_basari_at, sistem_isleri.son_basari_at),
        son_hata = COALESCE(EXCLUDED.son_hata, sistem_isleri.son_hata),
        son_hata_at = COALESCE(EXCLUDED.son_hata_at, sistem_isleri.son_hata_at),
        ardisik_hata = CASE WHEN EXCLUDED.son_hata IS NULL THEN 0 ELSE sistem_isleri.ardisik_hata + 1 END,
        calisma_sayisi = sistem_isleri.calisma_sayisi + 1,
        updated_at = now()`;
  }
}
