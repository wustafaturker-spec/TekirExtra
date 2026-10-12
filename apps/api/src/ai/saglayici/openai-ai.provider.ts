import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru } from "./ai-provider.interface";

/**
 * OpenAI API / Azure OpenAI Uyumlu Sağlayıcı (GPT-4o, GPT-4o-mini)
 */
export class OpenAiAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "openai";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey?: string, model = "gpt-4o-mini", baseUrl = "https://api.openai.com/v1") {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async yapilandirilmisUretim<T>(
    girdi: AiMultimodalGirdi,
    sema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY tanımlanmamış. Lütfen Tenant AI ayarlarını veya ortam değişkenini kontrol edin.");
    }

    const messages: any[] = [];
    if (girdi.sistemRol) {
      messages.push({
        role: "system",
        content: `${girdi.sistemRol}\nYanıtını SADECE geçerli bir JSON nesnesi olarak ver. Markdown codeblock tırnakları ekleme.`,
      });
    } else {
      messages.push({
        role: "system",
        content: "Lütfen yanıtını SADECE geçerli bir JSON formatında döndür.",
      });
    }

    const userContent: any[] = [{ type: "text", text: girdi.prompt }];

    if (girdi.gorselBase64) {
      const dataUri = girdi.gorselBase64.startsWith("data:")
        ? girdi.gorselBase64
        : `data:${girdi.mimeType || "image/jpeg"};base64,${girdi.gorselBase64}`;
      userContent.push({
        type: "image_url",
        image_url: { url: dataUri, detail: "high" },
      });
    }

    messages.push({ role: "user", content: userContent });

    const endpoint = `${this.baseUrl}/chat/completions`;
    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      throw new Error(`OpenAI API Hatası (${yanit.status}): ${hataMetni}`);
    }

    const veri = (await yanit.json()) as any;
    const hamMetin = veri.choices?.[0]?.message?.content;
    if (!hamMetin) {
      throw new Error("OpenAI API'den boş yanıt döndü.");
    }

    const parsedJson = JSON.parse(hamMetin);
    return sema.parse(parsedJson);
  }

  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY tanımlanmamış.");
    }

    const messages: any[] = [];
    if (girdi.sistemRol) {
      messages.push({ role: "system", content: girdi.sistemRol });
    }
    messages.push({ role: "user", content: girdi.prompt });

    const endpoint = `${this.baseUrl}/chat/completions`;
    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
      }),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      throw new Error(`OpenAI API Hatası (${yanit.status}): ${hataMetni}`);
    }

    const veri = (await yanit.json()) as any;
    return veri.choices?.[0]?.message?.content || "";
  }
}
