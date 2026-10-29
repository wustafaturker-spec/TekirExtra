import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { PrismaClient } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { CariMutabakatService } from "./cari-mutabakat.service";
import { nabizla } from "../core/nabiz/nabiz";

const SAAT_MS = 60 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

/**
 * CARI-42: worker içinde saatte bir, son tarihine 3 gün kalan yanıtsız
 * mutabakatlara tek hatırlatma gönderir. Bir kiracının hatası ötekileri durdurmaz.
 */
@Injectable()
export class MutabakatZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MutabakatZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly mutabakat: CariMutabakatService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("mutabakat-zamanlayici", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("mutabakat-zamanlayici", () => this.calistir()), SAAT_MS);
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
    try {
      const tenantlar = await yonetim.tenant.findMany({ select: { id: true } });
      let gonderilen = 0;
      for (const { id: tenantId } of tenantlar) {
        // PLT-05: askıdaki firma cariye mutabakat hatırlatması göndermez.
        if (await this.erisim?.otomasyonDurdu(tenantId)) continue;
        try {
          gonderilen += await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.mutabakat.hatirlatmalariGonder());
        } catch (hata) {
          this.logger.error(JSON.stringify({ event: "mutabakat_reminder_tenant_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) }));
        }
      }
      if (gonderilen) this.logger.log(JSON.stringify({ event: "mutabakat_reminders_sent", gonderilen }));
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "mutabakat_reminder_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally {
      await yonetim.$disconnect();
      this.calisiyor = false;
    }
  }
}
