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
