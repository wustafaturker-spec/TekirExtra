import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { nabizla } from "../core/nabiz/nabiz";
import { EndeksArtisService } from "./endeks-artis.service";

/** Endeks çekimiyle aynı sıklık: TÜİK ayın 3'ünde açıklar, en geç 6 saatte öneri düşer. */
const ARALIK_MS = 6 * 60 * 60 * 1000;
const ACILIS_GECIKMESI_MS = 5 * 60_000;

/**
 * END-17: worker'da etkin artış kurallarından öneri üretir. Kural tablosu RLS'li
 * olduğundan kuralı olan firmalar yönetim bağlantısıyla bulunur, öneri firma
 * işleminde yazılır. Askıdaki firmada otomasyon durur.
 */
@Injectable()
export class EndeksArtisZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EndeksArtisZamanlayiciService.name);
  private ilk?: NodeJS.Timeout;
  private zamanlayici?: NodeJS.Timeout;

  constructor(private readonly artis: EndeksArtisService, @Optional() private readonly erisim?: AbonelikErisimService) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1") return;
    this.ilk = setTimeout(() => void this.tur(), ACILIS_GECIKMESI_MS);
    this.zamanlayici = setInterval(() => void this.tur(ARALIK_MS), ARALIK_MS);
  }

  onModuleDestroy(): void {
    if (this.ilk) clearTimeout(this.ilk);
    if (this.zamanlayici) clearInterval(this.zamanlayici);
  }

  private async firmalar(): Promise<string[]> {
    const url = process.env.DATABASE_URL_MIGRATE;
    if (!url) throw new Error("Endeksli artış taraması için DATABASE_URL_MIGRATE tanımlı olmalıdır");
    const yonetim = new PrismaClient({ datasourceUrl: url });
    try { return (await yonetim.endeksArtisKurali.findMany({ where: { aktif: true }, distinct: ["tenantId"], select: { tenantId: true } })).map((k) => k.tenantId); }
    finally { await yonetim.$disconnect(); }
  }

  async tur(aralikMs?: number): Promise<void> {
    await nabizla("endeks-artis", async () => {
      let toplam = 0;
      for (const tenantId of await this.firmalar()) {
        if (await this.erisim?.otomasyonDurdu(tenantId, "masraf_gelir")) continue;
        try { toplam += await this.artis.uret(tenantId); }
        catch (hata) { this.logger.error(`Endeksli artış önerisi üretilemedi: ${hata instanceof Error ? hata.message : String(hata)}`); }
      }
      if (toplam) this.logger.log(`${toplam} endeksli artış önerisi üretildi`);
    }, aralikMs);
  }
}
