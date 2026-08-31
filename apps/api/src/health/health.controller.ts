import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { URL } from "node:url";
import net from "node:net";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../core/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Konteyner/yük dengeleyici sağlık yoklaması — kimlik doğrulama istemez (NFR-14). */
  @Public()
  @Get()
  health(): { durum: string; zaman: string } {
    return {
      durum: "ok",
      zaman: new Date().toISOString(),
    };
  }

  /** Trafiğe hazır olma kontrolü. Liveness'tan ayrı tutulur; orkestratör
   * yalnızca zorunlu bağımlılıklar erişilebiliyorsa trafik yönlendirir. */
  @Public()
  @Get("ready")
  async ready(): Promise<{
    durum: string;
    bagimliliklar: Record<string, string>;
    zaman: string;
  }> {
    const bagimliliklar: Record<string, string> = { veritabani: "ok" };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      bagimliliklar.veritabani = "erisilemiyor";
    }

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      bagimliliklar.redis = await this.tcpKontrol(redisUrl);
    }

    // Ek deposu yapılandırılmışsa zorunlu kabul edilir; yerel geliştirmede
    // S3_ENDPOINT yoksa kontrol edilmez.
    const s3Endpoint = process.env.S3_ENDPOINT;
    if (s3Endpoint) {
      bagimliliklar.depo = await this.tcpKontrol(s3Endpoint);
    }

    const hazir = Object.values(bagimliliklar).every((durum) => durum === "ok");
    const yanit = { durum: hazir ? "ready" : "not_ready", bagimliliklar, zaman: new Date().toISOString() };
    if (!hazir) throw new HttpException(yanit, HttpStatus.SERVICE_UNAVAILABLE);
    return yanit;
  }

  private tcpKontrol(adres: string): Promise<string> {
    return new Promise((resolve) => {
      let url: URL;
      try { url = new URL(adres); } catch { resolve("gecersiz_adres"); return; }
      const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      const socket = net.createConnection({ host: url.hostname, port });
      const bitir = (durum: string) => { socket.destroy(); resolve(durum); };
      socket.setTimeout(800);
      socket.once("connect", () => bitir("ok"));
      socket.once("timeout", () => bitir("zaman_asimi"));
      socket.once("error", () => bitir("erisilemiyor"));
    });
  }
}
