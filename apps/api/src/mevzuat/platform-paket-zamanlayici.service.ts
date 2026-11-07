import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { nabizla } from "../core/nabiz/nabiz";
import { PlatformPaketService } from "./platform-paket.service";

@Injectable()
export class PlatformPaketZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private ilk?: NodeJS.Immediate;
  private zamanlayici?: NodeJS.Timeout;
  private calisiyor = false;
  private kapandi = false;
  constructor(private readonly paket: PlatformPaketService) {}
  onModuleInit() {
    if (process.env.TEKIR_WORKER !== "1" || !process.env.DATABASE_URL_PLATFORM) return;
    this.ilk = setImmediate(() => void nabizla("platform-planli-paket", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("platform-planli-paket", () => this.calistir(), 60_000), 60_000);
  }
  onModuleDestroy() { this.kapandi = true; if (this.ilk) clearImmediate(this.ilk); if (this.zamanlayici) clearInterval(this.zamanlayici); }
  async calistir() {
    if (this.calisiyor || this.kapandi) return;
    this.calisiyor = true;
    try { await this.paket.planliAtamalariIsle(() => this.kapandi); }
    finally { this.calisiyor = false; }
  }
}
