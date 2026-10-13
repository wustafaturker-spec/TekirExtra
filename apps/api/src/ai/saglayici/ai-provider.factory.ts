import { isIP } from "node:net";
import { IAiProvider, AiProviderTuru } from "./ai-provider.interface";
import { MockAiProvider } from "./mock-ai.provider";
import { GeminiAiProvider } from "./gemini-ai.provider";
import { OpenAiAiProvider } from "./openai-ai.provider";
import { AnthropicAiProvider } from "./anthropic-ai.provider";
import { OllamaAiProvider } from "./ollama-ai.provider";
import { TanimsizAiProvider } from "./tanimsiz-ai.provider";

export interface TenantAiYapilandirma {
  saglayici?: string | null;
  apiKey?: string | null;
  modelAdi?: string | null;
  baseUrl?: string | null;
}

/**
 * Kiracının girdiği sağlayıcı adresi sunucunun iç ağına ya da kendisine
 * yönelemesin (SSRF): yalnız https, IP değil alan adı, yerel/özel ad yok.
 * Alan adının özel bir IP'ye çözülmesi (DNS rebinding) burada engellenmez.
 */
export function kiraciAdresiHatasi(adres: string): string | null {
  let url: URL;
  try {
    url = new URL(adres);
  } catch {
    return "Adres geçerli bir URL değil.";
  }
  if (url.protocol !== "https:") return "Adres https ile başlamalı.";
  if (url.username || url.password) return "Adreste kullanıcı adı/parola olamaz.";
  const ana = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ana)) return "Adres IP değil alan adı olmalı.";
  if (!ana.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(ana)) {
    return "Yerel ağ adresleri kullanılamaz.";
  }
  return null;
}

/**
 * Dinamik ve Tenant Uyumlu (BYOK) Yapay Zeka Sağlayıcı Fabrikası (Factory)
 *
 * Kiracının adresi (`baseUrl`) yalnız kiracının kendi anahtarıyla kullanılır;
 * platform anahtarı (ortam değişkeni) hiçbir zaman kiracı adresine gitmez.
 * Ollama adresi yalnız platform ayarından gelir. Sağlayıcı ya da anahtar yoksa
 * örnek veri dönen sağlayıcıya düşülmez; çağrı açık bir hatayla reddedilir.
 * Örnek veri sağlayıcısı yalnız ortamda `AI_PROVIDER=mock` iken seçilir.
 */
export class AiProviderFactory {
  static uret(yapilandirma?: string | TenantAiYapilandirma): IAiProvider {
    const config: TenantAiYapilandirma = typeof yapilandirma === "string"
      ? { saglayici: yapilandirma }
      : yapilandirma || {};

    const istenen = config.saglayici && config.saglayici !== "varsayilan"
      ? config.saglayici
      : process.env.AI_PROVIDER;
    if (!istenen) return new TanimsizAiProvider();

    const tur = istenen.toLowerCase() as AiProviderTuru;
    const kiraciAnahtari = config.apiKey?.trim() || null;
    const kiraciAdresi = config.baseUrl?.trim() || null;

    if (kiraciAdresi && kiraciAnahtari) {
      const hata = kiraciAdresiHatasi(kiraciAdresi);
      if (hata) return new TanimsizAiProvider(`Sağlayıcı adresi kullanılamaz: ${hata}`);
    }

    switch (tur) {
      case "openai": {
        if (kiraciAnahtari) {
          return new OpenAiAiProvider(kiraciAnahtari, config.modelAdi || "gpt-4o-mini", kiraciAdresi || undefined);
        }
        const key = process.env.OPENAI_API_KEY;
        return key ? new OpenAiAiProvider(key, config.modelAdi || "gpt-4o-mini") : new TanimsizAiProvider();
      }

      case "anthropic": {
        const key = kiraciAnahtari || process.env.ANTHROPIC_API_KEY;
        return key ? new AnthropicAiProvider(key, config.modelAdi || "claude-sonnet-5-5") : new TanimsizAiProvider();
      }

      case "ollama":
        return process.env.OLLAMA_BASE_URL
          ? new OllamaAiProvider(process.env.OLLAMA_BASE_URL, config.modelAdi || undefined)
          : new TanimsizAiProvider("Ollama sunucusu platformda tanımlı değil.");

      case "gemini": {
        const key = kiraciAnahtari || process.env.GEMINI_API_KEY;
        return key ? new GeminiAiProvider(key, config.modelAdi || "gemini-2.5-flash") : new TanimsizAiProvider();
      }

      case "mock":
        return process.env.AI_PROVIDER === "mock" ? new MockAiProvider() : new TanimsizAiProvider();

      default:
        return new TanimsizAiProvider(`Bilinmeyen yapay zekâ sağlayıcısı: ${istenen}`);
    }
  }
}
