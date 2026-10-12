import { z } from "zod";

/**
 * Desteklenen Yapay Zeka Sağlayıcıları
 */
export type AiProviderTuru = "gemini" | "openai" | "anthropic" | "ollama" | "mock";

/**
 * Çok Modlu (Multimodal) Girdi İçeriği
 */
export interface AiMultimodalGirdi {
  sistemRol?: string;
  prompt: string;
  gorselBase64?: string;
  mimeType?: string;
}

/**
 * Model-Agnostik Yapay Zeka Sağlayıcı Arayüzü (Interface)
 */
export interface IAiProvider {
  readonly saglayiciAdi: AiProviderTuru;

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
}
