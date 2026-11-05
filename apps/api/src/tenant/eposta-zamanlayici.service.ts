import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { PrismaClient } from "@prisma/client";
import { ImapService } from "./imap.service";
import { nabizla } from "../core/nabiz/nabiz";

const BES_DAKIKA_MS = 5 * 60 * 1000;

/**
 * Worker sürecinde IMAP gelen e-postalarını periyodik olarak tarar ve senkronize eder.
 */
@Injectable()
export class EpostaZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EpostaZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly imapService: ImapService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("eposta-zamanlayici", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("eposta-zamanlayici", () => this.calistir()), BES_DAKIKA_MS);
    this.logger.log(JSON.stringify({ event: "imap_email_scan_scheduled", intervalMs: BES_DAKIKA_MS }));
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async imapAktifKiracilar(): Promise<{ tenant_id: string }[]> {
    const url = process.env.DATABASE_URL_MIGRATE;
    if (!url) return [];
    const yonetim = new PrismaClient({ datasourceUrl: url });
    try {
      return await yonetim.$queryRaw<{ tenant_id: string }[]>`
        SELECT tenant_id::text FROM modul_ayarlari
        WHERE modul = 'eposta' AND (ayarlar->>'imapAktif')::boolean = true`;
    } finally {
      await yonetim.$disconnect();
    }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      const kiracilar = await this.imapAktifKiracilar();
      for (const k of kiracilar) {
        // PLT-05: askıdaki firmanın gelen kutusu eşitlenmez.
        if (await this.erisim?.otomasyonDurdu(k.tenant_id, "satis")) continue;
        try {
          const res = await this.imapService.senkronizeEt(k.tenant_id);
          if (res.senkronizeEdildi > 0) {
            this.logger.log(
              JSON.stringify({
                event: "imap_sync_success",
                tenantId: k.tenant_id,
                newCount: res.senkronizeEdildi,
              }),
            );
          }
        } catch (hata) {
          this.logger.error(
            JSON.stringify({
              event: "imap_sync_failed",
              tenantId: k.tenant_id,
              error: hata instanceof Error ? hata.message : String(hata),
            }),
          );
        }
      }
    } catch (hata) {
      this.logger.error(
        JSON.stringify({
          event: "imap_scan_job_failed",
          error: hata instanceof Error ? hata.message : String(hata),
        }),
      );
    } finally {
      this.calisiyor = false;
    }
  }
}
