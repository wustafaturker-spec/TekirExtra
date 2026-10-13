import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import type { AiAracliSohbetGirdisi } from "./ai-provider.interface";
import { AnthropicAiProvider } from "./anthropic-ai.provider";
import { GeminiAiProvider } from "./gemini-ai.provider";
import { OpenAiAiProvider } from "./openai-ai.provider";
import { jsonSemaSadelestir } from "./aracli-ortak";

const ARAC = { ad: "cari_ara", aciklama: "Cari arar", girdiSemasi: { type: "object", properties: { arama: { type: "string" } }, required: ["arama"] } };

const girdi = (ham?: unknown): AiAracliSohbetGirdisi => ({
  sistemRol: "kurallar",
  araclar: [ARAC],
  mesajlar: [
    { rol: "kullanici", metin: "Yılmaz bakiyesi" },
    { rol: "asistan", metin: "", aracCagrilari: [{ id: "c1", ad: "cari_ara", girdi: { arama: "Yılmaz" } }, { id: "c2", ad: "cari_ara", girdi: { arama: "Kaya" } }], ham },
    { rol: "arac_sonucu", cagriId: "c1", ad: "cari_ara", icerik: "{\"a\":1}" },
    { rol: "arac_sonucu", cagriId: "c2", ad: "cari_ara", icerik: "Hata: yok", hata: true },
  ],
});

function fetchSahte(yanit: unknown) {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => yanit });
  vi.stubGlobal("fetch", f);
  return f;
}
const govde = (f: ReturnType<typeof vi.fn>) => JSON.parse(f.mock.calls[0][1].body);

describe("araç çağırma eşlemesi (AI-05)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Anthropic: araçlar input_schema ile gider, ardışık sonuçlar tek kullanıcı mesajında, tool_use ayrıştırılır", async () => {
    const f = fetchSahte({ content: [{ type: "text", text: "Bakıyorum" }, { type: "tool_use", id: "t9", name: "cari_ara", input: { arama: "X" } }] });
    const y = await new AnthropicAiProvider("k", "m").aracliSohbet(girdi([{ type: "tool_use", id: "c1", name: "cari_ara", input: {} }]));
    const g = govde(f);
    expect(g.system).toBe("kurallar");
    expect(g.tools[0]).toEqual({ name: "cari_ara", description: "Cari arar", input_schema: ARAC.girdiSemasi });
    expect(g.messages).toHaveLength(3);
    expect(g.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "c1", content: "{\"a\":1}" },
      { type: "tool_result", tool_use_id: "c2", content: "Hata: yok", is_error: true },
    ]);
    expect(y).toMatchObject({ metin: "Bakıyorum", aracCagrilari: [{ id: "t9", ad: "cari_ara", girdi: { arama: "X" } }] });
  });

  it("OpenAI: tool mesajları tool_call_id ile, argümanlar metinden ayrıştırılır", async () => {
    const f = fetchSahte({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "x1", type: "function", function: { name: "cari_ara", arguments: "{\"arama\":\"Y\"}" } }] } }] });
    const y = await new OpenAiAiProvider("k", "m").aracliSohbet(girdi({ role: "assistant", tool_calls: [] }));
    const g = govde(f);
    expect(g.messages[0]).toEqual({ role: "system", content: "kurallar" });
    expect(g.messages.slice(-2)).toEqual([
      { role: "tool", tool_call_id: "c1", content: "{\"a\":1}" },
      { role: "tool", tool_call_id: "c2", content: "Hata: yok" },
    ]);
    expect(g.tools[0].function.parameters).toEqual(ARAC.girdiSemasi);
    expect(y.aracCagrilari).toEqual([{ id: "x1", ad: "cari_ara", girdi: { arama: "Y" } }]);
  });

  it("Gemini: anahtar başlıkta gider, model içeriği aynen geri verilir, functionCall ayrıştırılır", async () => {
    const f = fetchSahte({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "cari_ara", args: { arama: "Z" } }, thoughtSignature: "imza" }] } }] });
    const ham = { role: "model", parts: [{ functionCall: { name: "cari_ara", args: {} }, thoughtSignature: "eski" }] };
    const y = await new GeminiAiProvider("gizli", "gemini-2.5-flash").aracliSohbet(girdi(ham));
    expect(f.mock.calls[0][0]).not.toContain("gizli");
    expect(f.mock.calls[0][1].headers["x-goog-api-key"]).toBe("gizli");
    const g = govde(f);
    expect(g.contents[1]).toEqual(ham);
    expect(g.contents[2].parts).toHaveLength(2);
    expect(y.aracCagrilari[0]).toMatchObject({ ad: "cari_ara", girdi: { arama: "Z" } });
    expect((y.ham as { parts: Array<{ thoughtSignature?: string }> }).parts[0].thoughtSignature).toBe("imza");
  });

  it("sağlayıcı hata gövdesi kullanıcıya dönmez", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "invalid key sk-gizli" }));
    const hata = await new OpenAiAiProvider("k", "m").aracliSohbet(girdi()).catch((e) => e);
    expect(hata).toBeInstanceOf(ServiceUnavailableException);
    expect(String(hata.message)).not.toContain("sk-gizli");
  });

  it("JSON şeması ortak alt kümeye indirgenir", () => {
    expect(jsonSemaSadelestir({
      $schema: "x", type: "object", additionalProperties: false, required: ["a"],
      properties: { a: { type: "string", format: "uuid", description: "kimlik" }, b: { anyOf: [{ type: "number" }, { type: "null" }] } },
    })).toEqual({ type: "object", required: ["a"], properties: { a: { type: "string", description: "kimlik" }, b: { type: "number", nullable: true } } });
  });
});
