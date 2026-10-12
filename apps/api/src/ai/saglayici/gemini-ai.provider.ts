import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru } from "./ai-provider.interface";

/**
 * Google Gemini Multimodal / Structured Outputs Sağlayıcısı
 */
export class GeminiAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "gemini";
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "";
    let secilenModel = (model || "gemini-1.5-flash").trim();
    if (secilenModel.startsWith("models/")) {
      secilenModel = secilenModel.replace(/^models\//, "");
    }
    this.model = secilenModel;
  }

  async yapilandirilmisUretim<T>(
    girdi: AiMultimodalGirdi,
    sema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY tanımlanmamış. Lütfen API anahtarınızı girin.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const parts: any[] = [];
    if (girdi.gorselBase64) {
      const temizBase64 = girdi.gorselBase64.replace(/^data:[^;]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: girdi.mimeType || "image/jpeg",
          data: temizBase64,
        },
      });
    }

    const sistemTalimati = girdi.sistemRol
      ? `${girdi.sistemRol}\nLütfen yanıtı SADECE geçerli JSON olarak ver, markdown tırnakları (codeblocks) ekleme.`
      : "Lütfen yanıtı SADECE geçerli JSON olarak ver, markdown tırnakları ekleme.";

    parts.push({ text: `${sistemTalimati}\n\nİstek: ${girdi.prompt}` });

    const istekGovdesi = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(istekGovdesi),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      let mesaj = `Gemini API Hatası (${yanit.status}): ${hataMetni}`;
      try {
        const parsed = JSON.parse(hataMetni);
        if (parsed.error?.message) mesaj = `Gemini Hatası: ${parsed.error.message}`;
      } catch {}
      throw new Error(mesaj);
    }

    const veri = (await yanit.json()) as any;
    const hamMetin = veri.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!hamMetin) {
      throw new Error("Gemini API'den boş yanıt döndü.");
    }

    const parsedJson = JSON.parse(hamMetin);
    return sema.parse(parsedJson);
  }

  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY tanımlanmamış. Lütfen API anahtarınızı girin.");
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const parts: any[] = [{ text: girdi.prompt }];

    const yanit = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    if (!yanit.ok) {
      const hataMetni = await yanit.text();
      let mesaj = `Gemini API Hatası (${yanit.status}): ${hataMetni}`;
      try {
        const parsed = JSON.parse(hataMetni);
        if (parsed.error?.message) mesaj = `Gemini Hatası: ${parsed.error.message}`;
      } catch {}
      throw new Error(mesaj);
    }

    const veri = (await yanit.json()) as any;
    return veri.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
}
