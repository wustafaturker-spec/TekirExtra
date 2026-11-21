import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiAracliSohbetGirdisi } from "./ai-provider.interface";
import { AnthropicAiProvider } from "./anthropic-ai.provider";
import { GeminiAiProvider } from "./gemini-ai.provider";
import { OllamaAiProvider } from "./ollama-ai.provider";
import { OpenAiAiProvider } from "./openai-ai.provider";

/** AI-116: sağlayıcı akışları. Gövde parçaları satır sınırına denk gelmeyecek biçimde bölünür. */
const ARAC = { ad: "cari_ara", aciklama: "Cari arar", girdiSemasi: { type: "object", properties: { arama: { type: "string" } } } };
const girdi: AiAracliSohbetGirdisi = { sistemRol: "kurallar", araclar: [ARAC], mesajlar: [{ rol: "kullanici", metin: "Merhaba" }] };

function akisSahte(metin: string, parcaBoyu = 7) {
  const kodlayici = new TextEncoder();
  const f = vi.fn().mockImplementation(async () => ({
    ok: true, status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < metin.length; i += parcaBoyu) c.enqueue(kodlayici.encode(metin.slice(i, i + parcaBoyu))); c.close(); },
    }),
  }));
  vi.stubGlobal("fetch", f);
  return f;
}
const sse = (...nesneler: unknown[]) => nesneler.map((n) => `data: ${typeof n === "string" ? n : JSON.stringify(n)}\n\n`).join("");

describe("AI-116 sağlayıcı akışı", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("OpenAI: metin parçaları sırayla akar; araç çağrısı index'e göre birleşir; kullanım son parçadan; stream bayrağı gider", async () => {
    const f = akisSahte(sse(
      { choices: [{ delta: { role: "assistant", content: "Mer" } }] },
      { choices: [{ delta: { content: "haba, " } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "cari_", arguments: '{"ara' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "ara", arguments: 'ma":"Yılmaz"}' } }] } }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
      "[DONE]",
    ));
    const parcalar: Array<string | null> = [];
    const p = new OpenAiAiProvider("k", "m", "https://api.openai.com/v1");
    const y = await p.aracliSohbetAkis(girdi, (m) => parcalar.push(m));
    expect(parcalar).toEqual(["Mer", "haba, "]);
    expect(y.metin).toBe("Merhaba,");
    expect(y.aracCagrilari).toEqual([{ id: "c1", ad: "cari_ara", girdi: { arama: "Yılmaz" } }]);
    expect(y.ham).toMatchObject({ role: "assistant", content: "Merhaba, ", tool_calls: [{ id: "c1", type: "function", function: { name: "cari_ara" } }] });
    expect(p.sonKullanim).toEqual({ girisToken: 12, cikisToken: 5 });
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("Anthropic: text_delta akar, input_json_delta araç girdisine birleşir", async () => {
    akisSahte(sse(
      { type: "message_start", message: { usage: { input_tokens: 9 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bakı" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "yorum" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "cari_ara", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"arama":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Kaya"}' } },
      { type: "message_delta", usage: { output_tokens: 4 } },
    ));
    const parcalar: Array<string | null> = [];
    const y = await new AnthropicAiProvider("k", "m").aracliSohbetAkis(girdi, (m) => parcalar.push(m));
    expect(parcalar).toEqual(["Bakı", "yorum"]);
    expect(y.metin).toBe("Bakıyorum");
    expect(y.aracCagrilari).toEqual([{ id: "t1", ad: "cari_ara", girdi: { arama: "Kaya" } }]);
  });

  it("Gemini: düşünce parçası akmaz; parçalar birleşir; araç çağrısı ayrıştırılır", async () => {
    akisSahte(sse(
      { candidates: [{ content: { role: "model", parts: [{ text: "gizli", thought: true }] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: "Cari " }] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: "aranıyor" }, { functionCall: { name: "cari_ara", args: { arama: "A" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } },
    ));
    const parcalar: Array<string | null> = [];
    const y = await new GeminiAiProvider("k", "m").aracliSohbetAkis(girdi, (m) => parcalar.push(m));
    expect(parcalar).toEqual(["Cari ", "aranıyor"]);
    expect(y.aracCagrilari).toMatchObject([{ ad: "cari_ara", girdi: { arama: "A" } }]);
  });

  it("Ollama: NDJSON satırları akar; araç çağrısı son satırdan", async () => {
    akisSahte([
      JSON.stringify({ message: { role: "assistant", content: "Tamam" } }),
      JSON.stringify({ message: { role: "assistant", content: ", bakıyorum." } }),
      JSON.stringify({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "cari_ara", arguments: { arama: "B" } } }] }, done: true, prompt_eval_count: 5, eval_count: 3 }),
    ].join("\n") + "\n", 11);
    const parcalar: Array<string | null> = [];
    const y = await new OllamaAiProvider("http://127.0.0.1:11434", "m").aracliSohbetAkis(girdi, (m) => parcalar.push(m));
    expect(parcalar).toEqual(["Tamam", ", bakıyorum."]);
    expect(y.metin).toBe("Tamam, bakıyorum.");
    expect(y.aracCagrilari).toMatchObject([{ ad: "cari_ara", girdi: { arama: "B" } }]);
  });

  it("akış HTTP hatasında sağlayıcı hatası verir, parça akmaz", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, body: { cancel: async () => undefined } }));
    const parcalar: Array<string | null> = [];
    await expect(new OpenAiAiProvider("k", "m", "https://api.openai.com/v1").aracliSohbetAkis(girdi, (m) => parcalar.push(m))).rejects.toThrow(/HTTP 503/);
    expect(parcalar).toEqual([]);
  });
});
