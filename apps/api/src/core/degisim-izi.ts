import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type RedisClientType } from "redis";
import { structuredLogger } from "./observability/structured-logger";

/**
 * BLD-14: firma başına "son değişim" izi. Kiracı işlemi (tenantIslem) gerçekten
 * yazdıysa (Postgres işlem kimliği atandıysa) firmanın son değişim zamanı
 * Redis'e yazılır; bildirim/düzeltme taramaları değişmeyen firmayı atlar.
 *
 * - Aynı firma için süreç başına `DEGISIM_PENCERESI_MS` içinde en çok bir kez
 *   bakılır/yazılır; tarama tarafı bu pencere kadar pay bırakır.
 * - Taramaların kendi yazmaları (`taramaYazimiyla`) değişim sayılmaz; yoksa
 *   tarama kendi bulgusunu yazıp firmayı her turda "değişmiş" gösterirdi.
 * - Redis yoksa iz tutulmaz; okuma başarısızsa tarama herkesi tarar.
 */
export const DEGISIM_PENCERESI_MS = 10_000;
const ANAHTAR = (tenantId: string) => `tekir:degisim:${tenantId}`;
/** İz 2 gün tutulur; daha eski iz yerine zaten saatlik zorunlu tarama devrededir. */
const IZ_OMRU_SN = 2 * 24 * 3600;

const taramaYazimi = new AsyncLocalStorage<true>();
/** Taramanın kendi yazmaları değişim izi bırakmaz. */
export function taramaYazimiyla<T>(fn: () => Promise<T>): Promise<T> {
  return taramaYazimi.run(true, fn);
}

const sonIsaret = new Map<string, number>();
let istemci: Promise<RedisClientType | null> | null = null;

let testEtkin: boolean | null = null;
function etkin(): boolean {
  if (testEtkin !== null) return testEtkin;
  return !!process.env.REDIS_URL && process.env.NODE_ENV !== "test" && process.env.DEGISIM_IZI_KAPALI !== "1";
}

function redis(): Promise<RedisClientType | null> {
  if (!etkin() || !process.env.REDIS_URL) return Promise.resolve(null);
  istemci ??= (async () => {
    const r = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2_000, reconnectStrategy: (n) => Math.min(n * 200, 5_000) } });
    r.on("error", (hata) => structuredLogger.warn("degisim_izi_redis_error", { hata: String(hata) }));
    try {
      await r.connect();
      return r as RedisClientType;
    } catch {
      if (r.isOpen) await r.disconnect().catch(() => undefined);
      return null;
    }
  })();
  return istemci.then((r) => (r?.isReady ? r : null));
}

/**
 * Bu işlemin sonunda yazma denetimi yapılmalı mı? Tarama yazımında, izin
 * kapalıyken ya da firma son pencere içinde zaten işaretlendiyse hayır.
 */
export function degisimDenetlenmeli(tenantId: string, simdi = Date.now()): boolean {
  if (!etkin() || taramaYazimi.getStore()) return false;
  const son = sonIsaret.get(tenantId);
  return !son || simdi - son >= DEGISIM_PENCERESI_MS;
}

/** Firma yazdı: izi tazele (beklemeden; hata işi bozmaz). */
export function degisimKaydet(tenantId: string, simdi = Date.now()): void {
  if (sonIsaret.size > 50_000) sonIsaret.clear();
  sonIsaret.set(tenantId, simdi);
  void redis()
    .then((r) => r?.set(ANAHTAR(tenantId), String(simdi), { EX: IZ_OMRU_SN }))
    .catch((hata) => structuredLogger.warn("degisim_izi_yazilamadi", { hata: String(hata) }));
}

/** Firmaların son değişim zamanları (ms; iz yoksa 0). Okunamazsa null → herkes taranır. */
export async function sonDegisimler(tenantIdleri: string[]): Promise<Map<string, number> | null> {
  if (!tenantIdleri.length) return new Map();
  const r = await redis();
  if (!r) return null;
  try {
    const degerler = await r.mGet(tenantIdleri.map(ANAHTAR));
    return new Map(tenantIdleri.map((id, i) => [id, Number(degerler[i] ?? 0) || 0]));
  } catch (hata) {
    structuredLogger.warn("degisim_izi_okunamadi", { hata: String(hata) });
    return null;
  }
}

/** Testler için: süreç izini sıfırlar; `etkin` verilirse ortamdan bağımsız açar/kapatır (Redis'e bağlanmaz). */
export function degisimIziniSifirla(etkin: boolean | null = null) {
  sonIsaret.clear();
  testEtkin = etkin;
}

/**
 * BLD-17: taramanın firma başına durumu (son tarama, son tam stok denetimi).
 * Birden çok worker aynı durumu görsün diye Redis'te; Redis yoksa (test,
 * kuyruksuz mod) ya da okunamazsa süreç belleğine iner. Eksik değer "hiç
 * taranmadı" sayılır, yani güvenli yönde tarama yapılır.
 */
export class TaramaDurumu {
  private readonly bellek = new Map<string, number>();
  constructor(private readonly ad: string) {}

  private anahtar(tenantId: string) {
    return `tekir:tarama:${this.ad}:${tenantId}`;
  }

  async oku(tenantIdleri: string[]): Promise<Map<string, number>> {
    const r = tenantIdleri.length ? await redis() : null;
    if (r) {
      try {
        const degerler = await r.mGet(tenantIdleri.map((id) => this.anahtar(id)));
        return new Map(tenantIdleri.flatMap((id, i) => (degerler[i] ? [[id, Number(degerler[i])] as const] : [])));
      } catch (hata) {
        structuredLogger.warn("tarama_durumu_okunamadi", { ad: this.ad, hata: String(hata) });
      }
    }
    return new Map(tenantIdleri.flatMap((id) => (this.bellek.has(id) ? [[id, this.bellek.get(id)!] as const] : [])));
  }

  async yaz(tenantId: string, ms: number): Promise<void> {
    if (this.bellek.size > 50_000) this.bellek.clear();
    this.bellek.set(tenantId, ms);
    const r = await redis();
    if (r) await r.set(this.anahtar(tenantId), String(ms), { EX: IZ_OMRU_SN }).catch((hata) => structuredLogger.warn("tarama_durumu_yazilamadi", { ad: this.ad, hata: String(hata) }));
  }
}

