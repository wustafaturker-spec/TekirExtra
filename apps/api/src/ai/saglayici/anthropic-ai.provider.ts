import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru, AiAracliSohbetGirdisi, AiAracliYanit } from "./ai-provider.interface";
import { aracGirdisiniAyristir, saglayiciAkisi, saglayiciIstegi } from "./aracli-ortak";

/**
 * Anthropic Claude Sağlayıcısı (Claude 3.5 Sonnet, Claude 3.5 Haiku)
 */
export class AnthropicAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "anthropic";
  get modelAdi() { return this.model; }
  sonKullanim?: { girisToken?: number; cikisToken?: number };
  private kullanimiAl(veri: any) { this.sonKullanim = { girisToken: veri.usage?.input_tokens, cikisToken: veri.usage?.output_tokens }; }
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
    this.kullanimiAl(veri);
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
    this.kullanimiAl(veri);
    return veri.content?.[0]?.text || "";
  }

  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    const messages = this.mesajlar(girdi);
    const veri = await saglayiciIstegi("Anthropic", "https://api.anthropic.com/v1/messages", this.basliklar(), this.aracliGovde(girdi, messages));
    this.kullanimiAl(veri);
    return this.yanitKur(Array.isArray(veri.content) ? veri.content : []);
  }

  private mesajlar(girdi: AiAracliSohbetGirdisi) {
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
    return messages;
  }

  private basliklar() {
    return { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" };
  }

  private aracliGovde(girdi: AiAracliSohbetGirdisi, messages: unknown[]) {
    return {
      model: this.model,
      max_tokens: 4096,
      system: girdi.sistemRol,
      messages,
      tools: girdi.araclar.map((a) => ({ name: a.ad, description: a.aciklama, input_schema: a.girdiSemasi })),
    };
  }

  /** AI-116: SSE; metin `text_delta`, araç girdisi `input_json_delta` parçalarıyla blok blok birleşir. */
  async aracliSohbetAkis(girdi: AiAracliSohbetGirdisi, onParca: (metin: string | null) => void): Promise<AiAracliYanit> {
    const messages = this.mesajlar(girdi);
    const bloklar: any[] = [];
    const jsonlar: string[] = [];
    const kullanim: { input_tokens?: number; output_tokens?: number } = {};
    await saglayiciAkisi("Anthropic", "https://api.anthropic.com/v1/messages", this.basliklar(), { ...this.aracliGovde(girdi, messages), stream: true }, "sse", (satir) => {
      let o: any;
      try { o = JSON.parse(satir); } catch { return; }
      if (o.type === "message_start") kullanim.input_tokens = o.message?.usage?.input_tokens;
      else if (o.type === "message_delta") kullanim.output_tokens = o.usage?.output_tokens;
      else if (o.type === "content_block_start") { bloklar[o.index] = { ...o.content_block, ...(o.content_block?.type === "text" ? { text: "" } : {}) }; jsonlar[o.index] = ""; }
      else if (o.type === "content_block_delta") {
        const b = bloklar[o.index];
        if (!b) return;
        if (o.delta?.type === "text_delta" && o.delta.text) { b.text += o.delta.text; onParca(o.delta.text); }
        else if (o.delta?.type === "input_json_delta") jsonlar[o.index] += o.delta.partial_json ?? "";
      }
    });
    bloklar.forEach((b, i) => { if (b?.type === "tool_use") b.input = jsonlar[i] ? aracGirdisiniAyristir(jsonlar[i]) : (b.input ?? {}); });
    this.kullanimiAl({ usage: kullanim });
    return this.yanitKur(bloklar.filter(Boolean));
  }

  private yanitKur(bloklar: any[]): AiAracliYanit {
    return {
      metin: bloklar.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
      aracCagrilari: bloklar.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, ad: b.name, girdi: aracGirdisiniAyristir(b.input) })),
      ham: bloklar,
    };
  }
}
