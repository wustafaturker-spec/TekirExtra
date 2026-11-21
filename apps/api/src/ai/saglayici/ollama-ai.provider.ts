import { z } from "zod";
import { IAiProvider, AiMultimodalGirdi, AiProviderTuru, AiAracliSohbetGirdisi, AiAracliYanit } from "./ai-provider.interface";
import { aracGirdisiniAyristir, saglayiciAkisi, saglayiciIstegi } from "./aracli-ortak";

/**
 * Yerel / Sunucu İçi Ollama Sağlayıcısı (Llama 3.2, DeepSeek-R1, Qwen2.5)
 * Veri gizliliği sağlar; hiçbir finansal veri dış buluta çıkmaz.
 */
export class OllamaAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "ollama";
  get modelAdi() { return this.model; }
  sonKullanim?: { girisToken?: number; cikisToken?: number };
  private kullanimiAl(veri: any) { this.sonKullanim = { girisToken: veri.prompt_eval_count, cikisToken: veri.eval_count }; }
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
    const veri = await saglayiciIstegi("Ollama", endpoint, {}, {
        model: this.model,
        prompt: `${systemPrompt}\n\nİstek: ${girdi.prompt}`,
        format: "json",
        stream: false,
        images: images.length > 0 ? images : undefined,
        options: { temperature: 0.1 },
      });
    this.kullanimiAl(veri);
    const hamMetin = veri.response;
    if (!hamMetin) {
      throw new Error("Ollama API'den boş yanıt döndü.");
    }

    const parsedJson = JSON.parse(hamMetin);
    return sema.parse(parsedJson);
  }

  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    const endpoint = `${this.baseUrl}/api/generate`;
    const veri = await saglayiciIstegi("Ollama", endpoint, {}, {
        model: this.model,
        prompt: `${girdi.sistemRol ? `${girdi.sistemRol}\n\n` : ""}${girdi.prompt}`,
        stream: false,
        options: { temperature: 0.3 },
      });
    this.kullanimiAl(veri);
    return veri.response || "";
  }

  private aracliGovde(girdi: AiAracliSohbetGirdisi, stream: boolean) {
    const messages: any[] = [{ role: "system", content: girdi.sistemRol }];
    for (const m of girdi.mesajlar) {
      if (m.rol === "kullanici") messages.push({ role: "user", content: m.metin });
      else if (m.rol === "asistan") messages.push(m.ham ?? { role: "assistant", content: m.metin });
      else messages.push({ role: "tool", tool_name: m.ad, content: m.icerik });
    }
    return {
      model: this.model,
      messages,
      stream,
      options: { temperature: 0.2 },
      tools: girdi.araclar.map((a) => ({ type: "function", function: { name: a.ad, description: a.aciklama, parameters: a.girdiSemasi } })),
    };
  }

  /** AI-116: NDJSON akışı; her satırda `message.content` parçası, araç çağrıları ve kullanım son satırda. */
  async aracliSohbetAkis(girdi: AiAracliSohbetGirdisi, onParca: (metin: string | null) => void): Promise<AiAracliYanit> {
    let metin = "";
    const cagrilar: any[] = [];
    let son: any = {};
    await saglayiciAkisi("Ollama", `${this.baseUrl}/api/chat`, {}, this.aracliGovde(girdi, true), "ndjson", (satir) => {
      let p: any;
      try { p = JSON.parse(satir); } catch { return; }
      const icerik = p.message?.content;
      if (typeof icerik === "string" && icerik) { metin += icerik; onParca(icerik); }
      if (Array.isArray(p.message?.tool_calls)) cagrilar.push(...p.message.tool_calls);
      if (p.done) son = p;
    });
    this.kullanimiAl(son);
    return this.yanitKur({ role: "assistant", content: metin, ...(cagrilar.length ? { tool_calls: cagrilar } : {}) });
  }

  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    const veri = await saglayiciIstegi("Ollama", `${this.baseUrl}/api/chat`, {}, this.aracliGovde(girdi, false));
    this.kullanimiAl(veri);
    return this.yanitKur(veri.message ?? { role: "assistant", content: "" });
  }

  private yanitKur(mesaj: any): AiAracliYanit {
    const cagrilar: any[] = Array.isArray(mesaj.tool_calls) ? mesaj.tool_calls : [];
    return {
      metin: typeof mesaj.content === "string" ? mesaj.content.trim() : "",
      aracCagrilari: cagrilar.map((c, i) => ({ id: c.id ?? `${c.function?.name}-${i}`, ad: c.function?.name, girdi: aracGirdisiniAyristir(c.function?.arguments) })),
      ham: mesaj,
    };
  }
}
