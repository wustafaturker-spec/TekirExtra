import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru } from "./ai-provider.interface";

/**
 * Yerel / Sunucu İçi Ollama Sağlayıcısı (Llama 3.2, DeepSeek-R1, Qwen2.5)
 * Veri gizliliği sağlar; hiçbir finansal veri dış buluta çıkmaz.
 */
export class OllamaAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = "http://localhost:11434", model = "llama3.2") {
    this.baseUrl = (baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
    this.model = model || process.env.OLLAMA_MODEL || "llama3.2";
  }

  async yapilandirilmisUretim<T>(
    girdi: AiMultimodalGirdi,
    sema: z.ZodType<T>,
  ): Promise<T> {
    const images: string[] = [];
    if (girdi.gorselBase64) {
      const temizBase64 = girdi.gorselBase64.replace(/^data:[^;]+;base64,/, "");
      images.push(temizBase64);
    }

    const systemPrompt = girdi.sistemRol
      ? `${girdi.sistemRol}\nYanıtını SADECE geçerli bir JSON formatında ver.`
      : "Yanıtını SADECE geçerli bir JSON formatında ver.";

    const endpoint = `${this.baseUrl}/api/generate`;
    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: `${systemPrompt}\n\nİstek: ${girdi.prompt}`,
        format: "json",
        stream: false,
        images: images.length > 0 ? images : undefined,
        options: { temperature: 0.1 },
      }),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      throw new Error(`Ollama API Hatası (${yanit.status}): ${hataMetni}`);
    }

    const veri = (await yanit.json()) as any;
    const hamMetin = veri.response;
    if (!hamMetin) {
      throw new Error("Ollama API'den boş yanıt döndü.");
    }

    const parsedJson = JSON.parse(hamMetin);
    return sema.parse(parsedJson);
  }

  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    const endpoint = `${this.baseUrl}/api/generate`;
    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: `${girdi.sistemRol ? `${girdi.sistemRol}\n\n` : ""}${girdi.prompt}`,
        stream: false,
        options: { temperature: 0.3 },
      }),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      throw new Error(`Ollama API Hatası (${yanit.status}): ${hataMetni}`);
    }

    const veri = (await yanit.json()) as any;
    return veri.response || "";
  }
}
