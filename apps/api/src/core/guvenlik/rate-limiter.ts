import { createClient, type RedisClientType } from "redis";
import { structuredLogger } from "../observability/structured-logger";

export interface LimitSonucu {
  izinli: boolean;
  kalan: number;
  sifirlamaMs: number;
  kaynak: "redis" | "bellek";
}

type BellekKaydi = { baslangic: number; sayi: number };

export class DagitikRateLimiter {
  private readonly bellek = new Map<string, BellekKaydi>();

  private constructor(
    private readonly limit: number,
    private readonly pencereMs: number,
    private readonly redis: RedisClientType | null,
  ) {}

  static async olustur(limit: number, pencereMs: number, redisUrl?: string): Promise<DagitikRateLimiter> {
    if (!redisUrl) return new DagitikRateLimiter(limit, pencereMs, null);
    const redis = createClient({
      url: redisUrl,
      socket: { connectTimeout: 1_500, reconnectStrategy: false },
    });
    redis.on("error", (hata) => structuredLogger.warn("rate_limit_redis_error", {
      message: hata instanceof Error ? hata.message : String(hata),
    }));
    try {
      await redis.connect();
      structuredLogger.info("rate_limit_redis_ready");
      return new DagitikRateLimiter(limit, pencereMs, redis as RedisClientType);
    } catch (hata) {
      structuredLogger.warn("rate_limit_memory_fallback", {
        message: hata instanceof Error ? hata.message : String(hata),
      });
      if (redis.isOpen) await redis.disconnect();
      return new DagitikRateLimiter(limit, pencereMs, null);
    }
  }

  async tuket(anahtar: string, simdi = Date.now()): Promise<LimitSonucu> {
    if (this.redis?.isReady) {
      try {
        const redisAnahtari = `tekir:rate-limit:${anahtar}`;
        const sonuc = await this.redis.sendCommand([
          "EVAL",
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}",
          "1",
          redisAnahtari,
          String(this.pencereMs),
        ]) as unknown as [number, number];
        const sayi = Number(sonuc[0]);
        const kalanSure = Math.max(0, Number(sonuc[1]));
        return {
          izinli: sayi <= this.limit,
          kalan: Math.max(0, this.limit - sayi),
          sifirlamaMs: simdi + kalanSure,
          kaynak: "redis",
        };
      } catch (hata) {
        structuredLogger.warn("rate_limit_redis_fallback", {
          message: hata instanceof Error ? hata.message : String(hata),
        });
      }
    }
    return this.bellektenTuket(anahtar, simdi);
  }

  async kapat(): Promise<void> {
    if (this.redis?.isOpen) await this.redis.quit().catch(() => this.redis?.disconnect());
  }

  private bellektenTuket(anahtar: string, simdi: number): LimitSonucu {
    const mevcut = this.bellek.get(anahtar);
    const kayit = !mevcut || simdi - mevcut.baslangic >= this.pencereMs
      ? { baslangic: simdi, sayi: 1 }
      : { baslangic: mevcut.baslangic, sayi: mevcut.sayi + 1 };
    this.bellek.set(anahtar, kayit);
    if (this.bellek.size > 10_000) {
      for (const [ip, deger] of this.bellek) {
        if (simdi - deger.baslangic >= this.pencereMs) this.bellek.delete(ip);
      }
    }
    return {
      izinli: kayit.sayi <= this.limit,
      kalan: Math.max(0, this.limit - kayit.sayi),
      sifirlamaMs: kayit.baslangic + this.pencereMs,
      kaynak: "bellek",
    };
  }
}
