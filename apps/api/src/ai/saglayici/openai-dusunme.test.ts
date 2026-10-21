import { ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const istek = vi.fn();
vi.mock("./aracli-ortak", async (asil) => ({ ...(await asil<typeof import("./aracli-ortak")>()), saglayiciIstegi: (...a: unknown[]) => istek(...a) }));
const { OpenAiAiProvider } = await import("./openai-ai.provider");

const yanit = { choices: [{ message: { content: "{\"tamam\":true}" } }] };
const sema = z.object({ tamam: z.boolean() });
const govde = (i: number) => istek.mock.calls[i][3] as Record<string, unknown>;

describe("OpenAI uyumlu sağlayıcıda düşünmeyi kapatma", () => {
  beforeEach(() => istek.mockReset());

  it("özel adreste istenince sohbet şablonuna düşünme kapalı gider", async () => {
    istek.mockResolvedValue(yanit);
    await new OpenAiAiProvider("k", "qwen", "https://evren.example/v1").yapilandirilmisUretim({ prompt: "x", dusunmeKapali: true }, sema);
    expect(govde(0).chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("istenmezse ya da OpenAI'nin kendisiyse parametre gönderilmez", async () => {
    istek.mockResolvedValue(yanit);
    await new OpenAiAiProvider("k", "qwen", "https://evren.example/v1").yapilandirilmisUretim({ prompt: "x" }, sema);
    await new OpenAiAiProvider("k", "gpt").yapilandirilmisUretim({ prompt: "x", dusunmeKapali: true }, sema);
    await new OpenAiAiProvider("k", "gpt", "https://api.openai.com/v1").yapilandirilmisUretim({ prompt: "x", dusunmeKapali: true }, sema);
    expect(istek.mock.calls.map((_, i) => "chat_template_kwargs" in govde(i))).toEqual([false, false, false]);
  });

  it("adres parametreyi reddederse (400) parametresiz yeniden dener; başka hata yükselir", async () => {
    istek.mockRejectedValueOnce(new ServiceUnavailableException("OpenAI isteği reddetti (HTTP 400). Ayrıntı sunucu kaydında.")).mockResolvedValueOnce(yanit);
    await expect(new OpenAiAiProvider("k", "m", "https://x.example/v1").yapilandirilmisUretim({ prompt: "x", dusunmeKapali: true }, sema)).resolves.toEqual({ tamam: true });
    expect("chat_template_kwargs" in govde(1)).toBe(false);
    istek.mockReset();
    istek.mockRejectedValueOnce(new ServiceUnavailableException("OpenAI isteği reddetti (HTTP 401). Ayrıntı sunucu kaydında."));
    await expect(new OpenAiAiProvider("k", "m", "https://x.example/v1").yapilandirilmisUretim({ prompt: "x", dusunmeKapali: true }, sema)).rejects.toThrow("HTTP 401");
    expect(istek).toHaveBeenCalledTimes(1);
  });
});
