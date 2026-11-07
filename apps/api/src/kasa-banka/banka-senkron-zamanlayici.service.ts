import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { PrismaClient } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { BankaEntegrasyonService } from "./banka-entegrasyon.service";
import { CEKILEN_SAGLAYICILAR } from "./banka-saglayici-kaydi";
import { nabizla } from "../core/nabiz/nabiz";

const BES_DAKIKA_MS = 5 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

/**
 * KSB-15: worker'da 5 dakikada bir, otomatik çekimi açık API'li banka
 * bağlantılarından aralığı dolanları çeker. Aralık bağlantı başına
 * (`otomatikSenkronDk`); hatalar bağlantıda saklanır, bildirimi Bildirim
 * Merkezi taraması üretir.
 */
@Injectable()
export class BankaSenkronZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BankaSenkronZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;

  constructor(private readonly entegrasyon: BankaEntegrasyonService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    setImmediate(() => void nabizla("banka-senkron-zamanlayici", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("banka-senkron-zamanlayici", () => this.calistir(), BES_DAKIKA_MS), BES_DAKIKA_MS);
  }

  onModuleDestroy(): void {
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  /** Yalnız otomatik çekimi açık bağlantısı olan kiracılar; diğerleri hiç açılmaz. */
  private async adayKiracilar(): Promise<string[]> {
    const yonetimUrl = process.env.DATABASE_URL_MIGRATE;
    if (!yonetimUrl) throw new Error("Banka otomatik çekimi için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: yonetimUrl });
    try {
      const kayitlar = await yonetim.baglanti.findMany({
        where: { aile: "banka", saglayici: { in: CEKILEN_SAGLAYICILAR() }, durum: "aktif", otomatikSenkronDk: { gt: 0 }, otomatikDurduNedeni: null },
        select: { tenantId: true },
        distinct: ["tenantId"],
      });
      return kayitlar.map((k) => k.tenantId);
    } finally {
      await yonetim.$disconnect();
    }
  }

  async calistir(): Promise<void> {
    if (this.calisiyor) return;
    this.calisiyor = true;
    try {
      for (const tenantId of await this.adayKiracilar()) {
        // PLT-05: askıdaki firmada banka hareketi çekilmez.
        if (await this.erisim?.otomasyonDurdu(tenantId, "kasa_banka")) continue;
        try {
          const sonuc = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.entegrasyon.vadesiGelenleriCek());
          if (sonuc.denenen) this.logger.log(JSON.stringify({ event: "bank_sync_auto", tenantId, ...sonuc }));
        } catch (hata) {
          this.logger.error(JSON.stringify({ event: "bank_sync_auto_failed", tenantId, error: hata instanceof Error ? hata.message : String(hata) }));
        }
      }
    } catch (hata) {
      this.logger.error("Banka otomatik çekimi başarısız", hata instanceof Error ? hata.stack : String(hata));
    } finally {
      this.calisiyor = false;
    }
  }
}
