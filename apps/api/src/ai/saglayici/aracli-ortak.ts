import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { disFetch, ozelIpMi } from "../../core/guvenlik/dis-istek";
import { SAGLAYICI_ZAMAN_ASIMI_MS } from "./ai-provider.interface";

const logger = new Logger("AiSaglayici");

export async function dnsAdresiniDogrula(url: string): Promise<void> {
  const anaMakine = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const adresler = await lookup(anaMakine, { all: true, verbatim: true });
  if (!adresler.length || adresler.some((a) => ozelIpMi(a.address))) {
    throw new ServiceUnavailableException("Sağlayıcı adresi özel veya yerel bir ağa çözümleniyor.");
  }
}

/** Sağlayıcıya zaman aşımlı JSON isteği; özel adreslerde DNS kontrolü ve yönlendirme yasağı uygulanır. */
export async function saglayiciIstegi(ad: string, url: string, basliklar: Record<string, string>, govde: unknown, secenek: { dnsDogrula?: boolean } = {}): Promise<any> {
  let yanit: Response;
  try {
    if (secenek.dnsDogrula) await dnsAdresiniDogrula(url);
    // SEC-08: kiracı adresinde bağlantı IP'si de denetlenir (DNS rebinding).
    yanit = await (secenek.dnsDogrula ? disFetch : fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...basliklar },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(SAGLAYICI_ZAMAN_ASIMI_MS),
      redirect: "manual",
    });
  } catch (hata) {
    logger.warn(`${ad} isteği başarısız: ${String(hata)}`);
    throw new ServiceUnavailableException(`${ad} yanıt vermedi.`);
  }
  if (yanit.status >= 300 && yanit.status < 400) {
    logger.warn(`${ad} güvenlik nedeniyle HTTP yönlendirmesi izlenmedi.`);
    throw new ServiceUnavailableException(`${ad} isteği güvenli olmayan bir yönlendirme döndürdü.`);
  }
  if (!yanit.ok) {
    // Sağlayıcı hata gövdesi kullanıcı metnini/anahtarını yansıtabilir; loga alınmaz.
    logger.warn(`${ad} HTTP ${yanit.status}`);
    await yanit.body?.cancel().catch(() => undefined);
    throw new ServiceUnavailableException(`${ad} isteği reddetti (HTTP ${yanit.status}). Ayrıntı sunucu kaydında.`);
  }
  return yanit.json();
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
