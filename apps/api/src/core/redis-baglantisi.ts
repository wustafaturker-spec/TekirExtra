/** BullMQ kuyruklarının ortak Redis bağlantı ayarı (REDIS_URL; rediss: ile TLS). */
export function redisBaglantisi() {
  const adres = new URL(process.env.REDIS_URL || "redis://localhost:6380");
  const db = adres.pathname.length > 1 ? Number(adres.pathname.slice(1)) : 0;
  return { host: adres.hostname, port: Number(adres.port || 6379), username: adres.username || undefined, password: adres.password || undefined, db: Number.isFinite(db) ? db : 0, ...(adres.protocol === "rediss:" ? { tls: {} } : {}), maxRetriesPerRequest: null };
}
