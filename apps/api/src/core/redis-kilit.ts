import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { structuredLogger } from "./observability/structured-logger";

/**
 * Süreçler arası kısa kilit (Redis SET NX EX). Kilit alınamazsa null döner.
 * Redis yoksa (test, yerel) süreç içi kilit kullanılır. Kilidi yalnız sahibi
 * bırakır (değer karşılaştırmalı silme); süresi dolan kilit kendiliğinden düşer.
 */
const yerel = new Set<string>();
let istemci: Promise<RedisClientType | null> | null = null;

function redis(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL || process.env.NODE_ENV === "test") return Promise.resolve(null);
  istemci ??= (async () => {
    const r = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2_000, reconnectStrategy: (n) => Math.min(n * 200, 5_000) } });
    r.on("error", (hata) => structuredLogger.warn("redis_kilit_error", { hata: String(hata) }));
    try { await r.connect(); return r as RedisClientType; } catch (hata) { structuredLogger.warn("redis_kilit_baglanamadi", { hata: String(hata) }); istemci = null; return null; }
  })();
  return istemci;
}

const BIRAK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const UZAT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end";
/** Redis yanıt vermezse (yeniden bağlanırken komut bekler) çağıran askıda kalmasın. */
const REDIS_BEKLEME_MS = 3_000;
function sureli<T>(is: Promise<T>): Promise<T> {
  let z: NodeJS.Timeout | undefined;
  return Promise.race([is, new Promise<never>((_, ret) => { z = setTimeout(() => ret(new Error("Redis yanıt vermedi")), REDIS_BEKLEME_MS); })]).finally(() => clearTimeout(z));
}

/**
 * BLD-18: uzun sürebilen iş için kilit; iş sürerken süresi tazelenir, süreç ölürse
 * `sureSn` içinde düşer. Alınamazsa null. Redis erişilemezse hata fırlatır.
 */
export async function uzayanKilitle(anahtar: string, sureSn: number): Promise<(() => Promise<void>) | null> {
  const r = await sureli(redis());
  if (!r) return kilitle(anahtar, sureSn);
  const deger = randomUUID();
  if ((await sureli(r.set(anahtar, deger, { NX: true, EX: sureSn }))) !== "OK") return null;
  const tazele = setInterval(() => void r.eval(UZAT, { keys: [anahtar], arguments: [deger, String(sureSn)] }).catch(() => undefined), (sureSn * 1000) / 3);
  tazele.unref();
  return async () => { clearInterval(tazele); await sureli(r.eval(BIRAK, { keys: [anahtar], arguments: [deger] })).catch(() => undefined); };
}

/** BLD-18: bu pencerede ilk gelen true alır; işaret süresi dolana kadar kalır, bırakılmaz. Redis yoksa true. */
export async function pencereIsareti(anahtar: string, sureSn: number): Promise<boolean> {
  const r = await sureli(redis());
  if (!r) return true;
  return (await sureli(r.set(anahtar, "1", { NX: true, EX: sureSn }))) === "OK";
}

export async function kilitle(anahtar: string, sureSn: number): Promise<(() => Promise<void>) | null> {
  const r = await redis();
  if (!r) {
    if (yerel.has(anahtar)) return null;
    yerel.add(anahtar);
    return async () => { yerel.delete(anahtar); };
  }
  const deger = randomUUID();
  const sonuc = await r.set(anahtar, deger, { NX: true, EX: sureSn });
  if (sonuc !== "OK") return null;
  return async () => { await r.eval(BIRAK, { keys: [anahtar], arguments: [deger] }).catch(() => undefined); };
}
