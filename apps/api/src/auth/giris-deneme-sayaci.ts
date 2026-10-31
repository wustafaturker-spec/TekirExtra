import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { structuredLogger } from "../core/observability/structured-logger";

export type DenemeTuru = "parola" | "totp" | "platform" | "platform_davet" | "platform_davet_ip";

/**
 * Yönetim P1-3: e-posta başına, 15 dakikalık pencerede izin verilen hatalı deneme.
 * PLT-30: platform daveti/2FA yeniden kurulumu hesap başına 5, IP başına 20 hatada kilitlenir.
 */
export const DENEME_SINIRI: Record<DenemeTuru, number> = { parola: 10, totp: 5, platform: 5, platform_davet: 5, platform_davet_ip: 20 };
export const KILIT_PENCERESI_MS = 15 * 60_000;

/**
 * Hesap başına başarısız giriş sayacı. IP sınırı (dakikada 300) dağıtık
 * denemeyi durdurmuyordu. Sayaç kayıtlı olsun olmasın her adres için tutulur;
 * kilit mesajı hesabın varlığını belli etmez. Redis yoksa (ya da düşerse)
 * süreç belleğine iner.
 */
@Injectable()
export class GirisDenemeSayaci implements OnModuleDestroy {
  private readonly bellek = new Map<string, { n: number; bitis: number }>();
  private istemci: Promise<RedisClientType | null> | null = null;
  private redisUrl: string | undefined = process.env.REDIS_URL;

  /** Testler için: Redis'e hiç bağlanmayan sayaç. */
  static bellekte(): GirisDenemeSayaci {
    const s = new GirisDenemeSayaci();
    s.redisUrl = undefined;
    return s;
  }

  async kilitliMi(eposta: string, turler: readonly DenemeTuru[] = ["parola", "totp"]): Promise<boolean> {
    for (const tur of turler) {
      if ((await this.oku(this.anahtar(tur, eposta))) >= DENEME_SINIRI[tur]) return true;
    }
    return false;
  }

  /** Hatayı sayar; bu hatayla sınıra ulaşıldıysa true döner (kilit yeni başladı). */
  async hataKaydet(tur: DenemeTuru, eposta: string): Promise<boolean> {
    return (await this.artir(this.anahtar(tur, eposta))) === DENEME_SINIRI[tur];
  }

  async temizle(eposta: string, turler: readonly DenemeTuru[] = ["parola", "totp"]): Promise<void> {
    const anahtarlar = turler.map((tur) => this.anahtar(tur, eposta));
    anahtarlar.forEach((a) => this.bellek.delete(a));
    const r = await this.redis();
    if (r) await r.del(anahtarlar).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    const r = await this.istemci;
    if (r?.isOpen) await r.quit().catch(() => r.disconnect());
  }

  private anahtar(tur: DenemeTuru, eposta: string): string {
    return `tekir:giris-hata:${tur}:${createHash("sha256").update(eposta.trim().toLocaleLowerCase("tr-TR")).digest("hex")}`;
  }

  private async oku(anahtar: string): Promise<number> {
    const r = await this.redis();
    if (r) {
      try {
        return Number((await r.get(anahtar)) ?? 0);
      } catch {
        /* belleğe in */
      }
    }
    const k = this.bellek.get(anahtar);
    return k && k.bitis > Date.now() ? k.n : 0;
  }

  private async artir(anahtar: string): Promise<number> {
    const r = await this.redis();
    if (r) {
      try {
        const n = await r.sendCommand([
          "EVAL",
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n",
          "1",
          anahtar,
          String(KILIT_PENCERESI_MS),
        ]);
        return Number(n);
      } catch (hata) {
        structuredLogger.warn("giris_sayaci_redis_fallback", { hata: String(hata) });
      }
    }
    const simdi = Date.now();
    const k = this.bellek.get(anahtar);
    const yeni = k && k.bitis > simdi ? { n: k.n + 1, bitis: k.bitis } : { n: 1, bitis: simdi + KILIT_PENCERESI_MS };
    if (this.bellek.size > 50_000) this.bellek.clear();
    this.bellek.set(anahtar, yeni);
    return yeni.n;
  }

  private redis(): Promise<RedisClientType | null> {
    if (!this.redisUrl) return Promise.resolve(null);
    this.istemci ??= (async () => {
      const r = createClient({ url: this.redisUrl, socket: { connectTimeout: 2_000, reconnectStrategy: (n) => Math.min(n * 200, 5_000) } });
      r.on("error", (hata) => structuredLogger.warn("giris_sayaci_redis_error", { hata: String(hata) }));
      try {
        await r.connect();
        return r as RedisClientType;
      } catch {
        if (r.isOpen) await r.disconnect().catch(() => undefined);
        return null;
      }
    })();
    return this.istemci.then((r) => (r?.isReady ? r : null));
  }
}
