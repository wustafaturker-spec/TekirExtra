import { HttpException, Logger, ServiceUnavailableException } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { disFetch, ozelIpMi } from "../../core/guvenlik/dis-istek";
import { SAGLAYICI_ZAMAN_ASIMI_MS } from "./ai-provider.interface";

const logger = new Logger("AiSaglayici");

/**
 * Çağrıya özel, varsayılandan kısa zaman aşımı (ör. OCR'da güçlü model denemesi). Sağlayıcıların
 * imzası değişmesin diye bağlamla taşınır; bütün sağlayıcılar `saglayiciIstegi`'nden geçer.
 */
const zamanAsimiBaglami = new AsyncLocalStorage<number>();
export function zamanAsimiyla<T>(ms: number, is: () => Promise<T>): Promise<T> {
  return zamanAsimiBaglami.run(ms, is);
}

/**
 * AI-99: kullanıcının durdurması sağlayıcı isteğine kadar taşınır. Sinyal
 * bağlamla taşınır (sağlayıcı imzaları değişmez); süre sınırıyla birleşir.
 */
const iptalBaglami = new AsyncLocalStorage<AbortSignal>();
export function iptalSinyaliyle<T>(sinyal: AbortSignal | undefined, is: () => Promise<T>): Promise<T> {
  return sinyal ? iptalBaglami.run(sinyal, is) : is();
}
export function iptalSinyali(): AbortSignal | undefined {
  return iptalBaglami.getStore();
}

/** AI-99: kullanıcı durdurdu; yeniden denenmez, izde "IPTAL" sınıfıyla görünür. */
export class AiIptalHatasi extends HttpException {
  readonly telemetriSinifi = "IPTAL";
  constructor() {
    super("Yanıt durduruldu.", 499);
  }
}
export function iptalEdildiyseDur(): void {
  if (iptalBaglami.getStore()?.aborted) throw new AiIptalHatasi();
}

/** AI-102: çağıran özel zaman aşımı koyduysa (ör. OCR güçlü model denemesi) dayanıklılığı da o yönetir. */
export function ozelZamanAsimi(): number | undefined {
  return zamanAsimiBaglami.getStore();
}

export async function dnsAdresiniDogrula(url: string): Promise<void> {
  const anaMakine = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const adresler = await lookup(anaMakine, { all: true, verbatim: true });
  if (!adresler.length || adresler.some((a) => ozelIpMi(a.address))) {
    throw new ServiceUnavailableException("Sağlayıcı adresi özel veya yerel bir ağa çözümleniyor.");
  }
}

/**
 * AI-102: sağlayıcı isteğinin başarısızlık türü. Kullanıcıya dönen durum yine
 * 503'tür; izde ve yeniden deneme kararında tür ayrılır. Yalnız geçici
 * hatalar (ağ, zaman aşımı, 408/429/5xx) yeniden denenir; 400/401/403 ve
 * yönlendirme denenmez.
 */
export class SaglayiciHatasi extends ServiceUnavailableException {
  constructor(mesaj: string, readonly tur: "zaman_asimi" | "ag" | "http" | "yonlendirme", readonly httpDurumu: number | null = null) {
    super(mesaj);
  }
  get gecici(): boolean {
    return this.tur === "ag" || this.tur === "zaman_asimi" || (this.tur === "http" && this.httpDurumu !== null && (GECICI_HTTP.has(this.httpDurumu) || this.httpDurumu >= 500));
  }
  get telemetriSinifi(): string {
    return this.tur === "http" ? `SAGLAYICI_HTTP_${this.httpDurumu}` : this.tur === "zaman_asimi" ? "SAGLAYICI_ZAMAN_ASIMI" : this.tur === "ag" ? "SAGLAYICI_AG" : "SAGLAYICI_YONLENDIRME";
  }
}
const GECICI_HTTP = new Set([408, 425, 429]);

/** Sağlayıcıya zaman aşımlı JSON isteği; özel adreslerde DNS kontrolü ve yönlendirme yasağı uygulanır. */
export async function saglayiciIstegi(ad: string, url: string, basliklar: Record<string, string>, govde: unknown, secenek: { dnsDogrula?: boolean } = {}): Promise<any> {
  return (await istekGonder(ad, url, basliklar, govde, secenek)).json();
}

/**
 * AI-116: akışlı istek. Gövde SSE (`data: …` satırları; `[DONE]` atlanır) ya da NDJSON satırları
 * olarak okunur; her veri satırı `onVeri`'ye verilir. Zaman aşımı, iptal, yönlendirme ve HTTP
 * hata kuralları tek seferlik istekle aynıdır; akış ortasında kopma sağlayıcı hatasıdır.
 */
export async function saglayiciAkisi(ad: string, url: string, basliklar: Record<string, string>, govde: unknown, bicim: "sse" | "ndjson", onVeri: (veri: string) => void, secenek: { dnsDogrula?: boolean } = {}): Promise<void> {
  const yanit = await istekGonder(ad, url, basliklar, govde, secenek);
  if (!yanit.body) throw new SaglayiciHatasi(`${ad} akış gövdesi döndürmedi.`, "ag");
  const okuyucu = yanit.body.getReader();
  const cozucu = new TextDecoder();
  let tampon = "";
  const satir = (s: string) => {
    const t = s.replace(/\r$/, "");
    if (bicim === "ndjson") { if (t.trim()) onVeri(t); return; }
    if (!t.startsWith("data:")) return;
    const veri = t.slice(5).trimStart();
    if (veri && veri !== "[DONE]") onVeri(veri);
  };
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      tampon += cozucu.decode(value, { stream: true });
      let i: number;
      while ((i = tampon.indexOf("\n")) >= 0) { satir(tampon.slice(0, i)); tampon = tampon.slice(i + 1); }
    }
    tampon += cozucu.decode();
    if (tampon) satir(tampon);
  } catch (hata) {
    if (hata instanceof HttpException) throw hata;
    if (iptalBaglami.getStore()?.aborted) throw new AiIptalHatasi();
    logger.warn(`${ad} akışı kesildi: ${String(hata)}`);
    throw new SaglayiciHatasi(`${ad} akışı yarıda kesildi.`, "ag");
  } finally {
    okuyucu.releaseLock();
  }
}

async function istekGonder(ad: string, url: string, basliklar: Record<string, string>, govde: unknown, secenek: { dnsDogrula?: boolean }): Promise<Response> {
  let yanit: Response;
  const iptal = iptalBaglami.getStore();
  iptalEdildiyseDur();
  const sure = AbortSignal.timeout(zamanAsimiBaglami.getStore() ?? SAGLAYICI_ZAMAN_ASIMI_MS);
  try {
    if (secenek.dnsDogrula) await dnsAdresiniDogrula(url);
    // SEC-08: kiracı adresinde bağlantı IP'si de denetlenir (DNS rebinding).
    yanit = await (secenek.dnsDogrula ? disFetch : fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...basliklar },
      body: JSON.stringify(govde),
      signal: iptal ? AbortSignal.any([sure, iptal]) : sure,
      redirect: "manual",
    });
  } catch (hata) {
    // DNS/özel ağ reddi gibi kendi kararlarımız olduğu gibi geçer; geçici değildir.
    if (hata instanceof HttpException) throw hata;
    if (iptal?.aborted) throw new AiIptalHatasi();
    logger.warn(`${ad} isteği başarısız: ${String(hata)}`);
    const zamanAsimi = hata instanceof Error && (hata.name === "TimeoutError" || hata.name === "AbortError");
    throw new SaglayiciHatasi(zamanAsimi ? `${ad} zamanında yanıt vermedi.` : `${ad} yanıt vermedi.`, zamanAsimi ? "zaman_asimi" : "ag");
  }
  if (yanit.status >= 300 && yanit.status < 400) {
    logger.warn(`${ad} güvenlik nedeniyle HTTP yönlendirmesi izlenmedi.`);
    throw new SaglayiciHatasi(`${ad} isteği güvenli olmayan bir yönlendirme döndürdü.`, "yonlendirme", yanit.status);
  }
  if (!yanit.ok) {
    // Sağlayıcı hata gövdesi kullanıcı metnini/anahtarını yansıtabilir; loga alınmaz.
    logger.warn(`${ad} HTTP ${yanit.status}`);
    await yanit.body?.cancel().catch(() => undefined);
    throw new SaglayiciHatasi(`${ad} isteği reddetti (HTTP ${yanit.status}). Ayrıntı sunucu kaydında.`, "http", yanit.status);
  }
  return yanit;
}

const IZINLI_ANAHTARLAR = new Set(["type", "description", "enum", "properties", "required", "items", "minimum", "maximum", "minItems", "maxItems", "nullable"]);

/**
 * Zod'un ürettiği JSON Schema'yı sağlayıcıların ortak anladığı alt kümeye
 * indirger (Gemini `additionalProperties`, `$schema`, `format` gibi
 * anahtarları reddeder). `anyOf: [X, null]` → X + nullable.
 */
export function jsonSemaSadelestir(sema: unknown): Record<string, unknown> {
  if (!sema || typeof sema !== "object" || Array.isArray(sema)) return {};
  const giris = sema as Record<string, unknown>;
  if (Array.isArray(giris.anyOf)) {
    const secenekler = giris.anyOf as Record<string, unknown>[];
    const dolu = secenekler.filter((s) => s.type !== "null");
    const temel = jsonSemaSadelestir(dolu[0] ?? {});
    if (dolu.length !== secenekler.length) temel.nullable = true;
    if (giris.description && !temel.description) temel.description = giris.description;
    return temel;
  }
  const cikis: Record<string, unknown> = {};
  for (const [anahtar, deger] of Object.entries(giris)) {
    if (!IZINLI_ANAHTARLAR.has(anahtar)) continue;
    if (anahtar === "properties" && deger && typeof deger === "object") {
      cikis.properties = Object.fromEntries(Object.entries(deger as Record<string, unknown>).map(([k, v]) => [k, jsonSemaSadelestir(v)]));
    } else if (anahtar === "items") {
      cikis.items = jsonSemaSadelestir(deger);
    } else if (anahtar === "type" && Array.isArray(deger)) {
      const turler = (deger as string[]).filter((t) => t !== "null");
      cikis.type = turler[0];
      if (turler.length !== (deger as string[]).length) cikis.nullable = true;
    } else {
      cikis[anahtar] = deger;
    }
  }
  return cikis;
}

/** Model araç girdisini metin olarak verirse ayrıştırır; bozuksa boş nesne. */
export function aracGirdisiniAyristir(deger: unknown): Record<string, unknown> {
  if (deger && typeof deger === "object" && !Array.isArray(deger)) return deger as Record<string, unknown>;
  if (typeof deger === "string") {
    try {
      const nesne = JSON.parse(deger);
      return nesne && typeof nesne === "object" && !Array.isArray(nesne) ? nesne : {};
    } catch {
      return {};
    }
  }
  return {};
}
