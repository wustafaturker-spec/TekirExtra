import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru, AiAracliSohbetGirdisi, AiAracliYanit } from "./ai-provider.interface";
import { aracGirdisiniAyristir, saglayiciIstegi } from "./aracli-ortak";

/**
 * Anthropic Claude Sağlayıcısı (Claude 3.5 Sonnet, Claude 3.5 Haiku)
 */
export class AnthropicAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "anthropic";
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model = "claude-sonnet-5-5") {
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
    const veri = await saglayiciIstegi("Anthropic", endpoint, {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: this.model,
        max_tokens: 4096,
        system: girdi.sistemRol || "Sen kurumsal bir ERP muhasebe ve analitik uzmanısın. Yanıtları doğrudan JSON olarak üretirsin.",
        messages: [{ role: "user", content }],
        temperature: 0.1,
      });
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
    const veri = await saglayiciIstegi("Anthropic", endpoint, {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      }, {
        model: this.model,
        max_tokens: 2048,
        system: girdi.sistemRol,
        messages: [{ role: "user", content: girdi.prompt }],
        temperature: 0.3,
      });
    return veri.content?.[0]?.text || "";
  }

  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
    for (const m of girdi.mesajlar) {
      if (m.rol === "kullanici") messages.push({ role: "user", content: m.metin });
      else if (m.rol === "asistan") messages.push({ role: "assistant", content: m.ham ?? m.metin });
      else {
        // Ardışık araç sonuçları tek kullanıcı mesajında gider.
        const blok = { type: "tool_result", tool_use_id: m.cagriId, content: m.icerik, ...(m.hata ? { is_error: true } : {}) };
        const son = messages[messages.length - 1];
        if (son?.role === "user" && Array.isArray(son.content) && son.content[0]?.type === "tool_result") son.content.push(blok);
        else messages.push({ role: "user", content: [blok] });
      }
    }
    const veri = await saglayiciIstegi("Anthropic", "https://api.anthropic.com/v1/messages", {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    }, {
      model: this.model,
      max_tokens: 4096,
      system: girdi.sistemRol,
      messages,
      tools: girdi.araclar.map((a) => ({ name: a.ad, description: a.aciklama, input_schema: a.girdiSemasi })),
    });
    const bloklar: any[] = Array.isArray(veri.content) ? veri.content : [];
    return {
      metin: bloklar.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
      aracCagrilari: bloklar.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, ad: b.name, girdi: aracGirdisiniAyristir(b.input) })),
      ham: bloklar,
    };
  }
}
