import { z } from "zod";

/**
 * Desteklenen Yapay Zeka Sağlayıcıları
 */
export type AiProviderTuru = "gemini" | "openai" | "anthropic" | "ollama" | "mock" | "tanimsiz";

/**
 * Çok Modlu (Multimodal) Girdi İçeriği
 */
export interface AiMultimodalGirdi {
  sistemRol?: string;
  prompt: string;
  gorselBase64?: string;
  mimeType?: string;
  /**
   * Kısa denetim çağrıları için düşünme (reasoning) kapalı istenir. Yalnız
   * destekleyen sağlayıcılar uygular (OpenAI uyumlu özel adresler, ör. EVREN
   * qwen3: düşünmeyle 60 sn'yi aşan çağrı kapalıyken 1–6 sn, 2026-10-21).
   */
  dusunmeKapali?: boolean;
}

/** AI-05: modele sunulan araç; `girdiSemasi` JSON Schema (sağlayıcılar arası ortak alt küme). */
export interface AiAracTanimi {
  ad: string;
  aciklama: string;
  girdiSemasi: Record<string, unknown>;
}

export interface AiAracCagrisi {
  id: string;
  ad: string;
  girdi: Record<string, unknown>;
}

/**
 * Sağlayıcıdan bağımsız sohbet geçmişi. `ham`, sağlayıcının kendi asistan
 * mesajıdır; aynı tur içinde araç sonucu gönderilirken olduğu gibi geri
 * verilir (Gemini düşünce imzası, Anthropic içerik blokları).
 */
export type AiSohbetMesaji =
  | { rol: "kullanici"; metin: string }
  | { rol: "asistan"; metin: string; aracCagrilari?: AiAracCagrisi[]; ham?: unknown }
  | { rol: "arac_sonucu"; cagriId: string; ad: string; icerik: string; hata?: boolean };

export interface AiAracliSohbetGirdisi {
  sistemRol: string;
  mesajlar: AiSohbetMesaji[];
  araclar: AiAracTanimi[];
}

export interface AiAracliYanit {
  metin: string;
  aracCagrilari: AiAracCagrisi[];
  ham?: unknown;
}

/** Sağlayıcı çağrılarının zaman aşımı (AI-11). */
export const SAGLAYICI_ZAMAN_ASIMI_MS = 60_000;

/**
 * Model-Agnostik Yapay Zeka Sağlayıcı Arayüzü (Interface)
 */
export interface IAiProvider {
  readonly saglayiciAdi: AiProviderTuru;
  readonly modelAdi?: string;
  readonly sonKullanim?: { girisToken?: number; cikisToken?: number };

  /**
   * Yapılandırılmış JSON çıktısı üretir (Zod şeması ile zorlanmış)
   */
  yapilandirilmisUretim<T>(
    girdi: AiMultimodalGirdi,
    sema: z.ZodType<T>,
  ): Promise<T>;

  /**
   * Serbest metin üretimi / sohbet
   */
  metinUret(girdi: AiMultimodalGirdi): Promise<string>;

  /**
   * AI-05: araç çağırabilen sohbet turu. Model ya metin yanıtı ya da bir veya
   * birkaç araç çağrısı döner; araç sonuçları bir sonraki çağrıda verilir.
   */
  aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit>;
}
