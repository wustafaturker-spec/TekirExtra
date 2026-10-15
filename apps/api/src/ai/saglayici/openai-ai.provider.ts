import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru, AiAracliSohbetGirdisi, AiAracliYanit } from "./ai-provider.interface";
import { aracGirdisiniAyristir, saglayiciIstegi } from "./aracli-ortak";

/**
 * OpenAI API / Azure OpenAI Uyumlu Sağlayıcı (GPT-4o, GPT-4o-mini)
 */
export class OpenAiAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "openai";
  get modelAdi() { return this.model; }
  sonKullanim?: { girisToken?: number; cikisToken?: number };
  private kullanimiAl(veri: any) { this.sonKullanim = { girisToken: veri.usage?.prompt_tokens, cikisToken: veri.usage?.completion_tokens }; }
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private dnsDogrula: boolean;

  constructor(apiKey?: string, model = "gpt-4o-mini", baseUrl?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.model = model;
    this.baseUrl = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.dnsDogrula = Boolean(baseUrl);
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
      }, { dnsDogrula: this.dnsDogrula });
    } else {
      messages.push({
        role: "system",
        content: "Lütfen yanıtını SADECE geçerli bir JSON formatında döndür.",
      }, { dnsDogrula: this.dnsDogrula });
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
    const veri = await saglayiciIstegi("OpenAI", endpoint, {
        Authorization: `Bearer ${this.apiKey}`,
      }, {
        model: this.model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.1,
      }, { dnsDogrula: this.dnsDogrula });
    this.kullanimiAl(veri);
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
    const veri = await saglayiciIstegi("OpenAI", endpoint, {
        Authorization: `Bearer ${this.apiKey}`,
      }, {
        model: this.model,
        messages,
        temperature: 0.3,
      }, { dnsDogrula: this.dnsDogrula });
    this.kullanimiAl(veri);
    return veri.choices?.[0]?.message?.content || "";
  }

  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    const messages: any[] = [{ role: "system", content: girdi.sistemRol }];
    for (const m of girdi.mesajlar) {
      if (m.rol === "kullanici") messages.push({ role: "user", content: m.metin });
      else if (m.rol === "asistan") messages.push(m.ham ?? { role: "assistant", content: m.metin });
      else messages.push({ role: "tool", tool_call_id: m.cagriId, content: m.icerik });
    }
    const veri = await saglayiciIstegi("OpenAI", `${this.baseUrl}/chat/completions`, { Authorization: `Bearer ${this.apiKey}` }, {
      model: this.model,
      messages,
      temperature: 0.2,
      tools: girdi.araclar.map((a) => ({ type: "function", function: { name: a.ad, description: a.aciklama, parameters: a.girdiSemasi } })),
    }, { dnsDogrula: this.dnsDogrula });
    this.kullanimiAl(veri);
    const mesaj = veri.choices?.[0]?.message ?? { role: "assistant", content: "" };
    const cagrilar: any[] = Array.isArray(mesaj.tool_calls) ? mesaj.tool_calls : [];
    return {
      metin: typeof mesaj.content === "string" ? mesaj.content.trim() : "",
      aracCagrilari: cagrilar.map((c) => ({ id: c.id, ad: c.function?.name, girdi: aracGirdisiniAyristir(c.function?.arguments) })),
      ham: mesaj,
    };
  }
}
