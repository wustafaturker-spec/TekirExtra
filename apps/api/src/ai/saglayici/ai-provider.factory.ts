import { IAiProvider, AiProviderTuru } from "./ai-provider.interface";
import { MockAiProvider } from "./mock-ai.provider";
import { GeminiAiProvider } from "./gemini-ai.provider";
import { OpenAiAiProvider } from "./openai-ai.provider";
import { AnthropicAiProvider } from "./anthropic-ai.provider";
import { OllamaAiProvider } from "./ollama-ai.provider";

export interface TenantAiYapilandirma {
  saglayici?: string | null;
  apiKey?: string | null;
  modelAdi?: string | null;
  baseUrl?: string | null;
}

/**
 * Dinamik ve Tenant Uyumlu (BYOK) Yapay Zeka Sağlayıcı Fabrikası (Factory)
 */
export class AiProviderFactory {
  static uret(yapilandirma?: string | TenantAiYapilandirma): IAiProvider {
    const config: TenantAiYapilandirma = typeof yapilandirma === "string"
      ? { saglayici: yapilandirma }
      : yapilandirma || {};

    const istenen = config.saglayici && config.saglayici !== "varsayilan"
      ? config.saglayici
      : process.env.AI_PROVIDER || "mock";

    const tur = istenen.toLowerCase() as AiProviderTuru;

    switch (tur) {
      case "openai": {
        const key = config.apiKey || process.env.OPENAI_API_KEY;
        if (key) {
          return new OpenAiAiProvider(key, config.modelAdi || "gpt-4o-mini", config.baseUrl || undefined);
        }
        console.warn("[AiProviderFactory] OpenAI API anahtarı bulunamadı, MockAiProvider'a düşülüyor.");
        return new MockAiProvider();
      }

      case "anthropic": {
        const key = config.apiKey || process.env.ANTHROPIC_API_KEY;
        if (key) {
          return new AnthropicAiProvider(key, config.modelAdi || "claude-3-5-sonnet-20241022");
        }
        console.warn("[AiProviderFactory] Anthropic API anahtarı bulunamadı, MockAiProvider'a düşülüyor.");
        return new MockAiProvider();
      }

      case "ollama":
        return new OllamaAiProvider(config.baseUrl || undefined, config.modelAdi || undefined);

      case "gemini": {
        const geminiKey = config.apiKey || process.env.GEMINI_API_KEY;
        if (geminiKey) {
          return new GeminiAiProvider(geminiKey, config.modelAdi || "gemini-1.5-flash");
        }
        console.warn("[AiProviderFactory] GEMINI_API_KEY bulunamadı, MockAiProvider'a geri düşülüyor.");
        return new MockAiProvider();
      }

      case "mock":
      default:
        return new MockAiProvider();
    }
  }
}
