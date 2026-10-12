import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru } from "./ai-provider.interface";

/**
 * Anthropic Claude Sağlayıcısı (Claude 3.5 Sonnet, Claude 3.5 Haiku)
 */
export class AnthropicAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "anthropic";
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model = "claude-3-5-sonnet-20241022") {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.model = model;
  }

  async yapilandirilmisUretim<T>(
    girdi: AiMultimodalGirdi,
    sema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY tanımlanmamış. Lütfen Tenant AI ayarlarını kontrol edin.");
    }

    const content: any[] = [];

    if (girdi.gorselBase64) {
      const temizBase64 = girdi.gorselBase64.replace(/^data:[^;]+;base64,/, "");
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: girdi.mimeType || "image/jpeg",
          data: temizBase64,
        },
      });
    }

    content.push({
      type: "text",
      text: `${girdi.prompt}\n\nÖNEMLİ: Yanıtını SADECE geçerli bir JSON nesnesi olarak ver. Hiçbir açıklama veya markdown code block tırnağı ekleme.`,
    });

    const endpoint = "https://api.anthropic.com/v1/messages";
    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: girdi.sistemRol || "Sen kurumsal bir ERP muhasebe ve analitik uzmanısın. Yanıtları doğrudan JSON olarak üretirsin.",
        messages: [{ role: "user", content }],
        temperature: 0.1,
      }),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      throw new Error(`Anthropic API Hatası (${yanit.status}): ${hataMetni}`);
    }

    const veri = (await yanit.json()) as any;
    const hamMetin = veri.content?.[0]?.text;
    if (!hamMetin) {
      throw new Error("Anthropic API'den boş yanıt döndü.");
    }

    // Markdown tırnaklarını temizle (varsa)
    const temizJsonMetni = hamMetin.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
    const parsedJson = JSON.parse(temizJsonMetni);
    return sema.parse(parsedJson);
  }

  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY tanımlanmamış.");
    }

    const endpoint = "https://api.anthropic.com/v1/messages";
    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: girdi.sistemRol,
        messages: [{ role: "user", content: girdi.prompt }],
        temperature: 0.3,
      }),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      throw new Error(`Anthropic API Hatası (${yanit.status}): ${hataMetni}`);
    }

    const veri = (await yanit.json()) as any;
    return veri.content?.[0]?.text || "";
  }
}
