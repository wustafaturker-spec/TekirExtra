import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { AiProviderFactory, kiraciAdresiHatasi } from "./ai-provider.factory";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]) }));

describe("AiProviderFactory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("sağlayıcı tanımlı değilse örnek veri değil 503 döner", async () => {
    vi.stubEnv("AI_PROVIDER", "");
    const p = AiProviderFactory.uret();
    expect(p.saglayiciAdi).toBe("tanimsiz");
    await expect(p.metinUret({ prompt: "x" })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("örnek veri sağlayıcısını kiracı seçemez; yalnız ortamda AI_PROVIDER=mock iken", () => {
    vi.stubEnv("AI_PROVIDER", "");
    expect(AiProviderFactory.uret({ saglayici: "mock" }).saglayiciAdi).toBe("tanimsiz");
    vi.stubEnv("AI_PROVIDER", "mock");
    expect(AiProviderFactory.uret().saglayiciAdi).toBe("mock");
  });

  it("anahtarı olmayan bulut sağlayıcısı örnek veriye düşmez", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    for (const saglayici of ["openai", "anthropic", "gemini"]) {
      expect(AiProviderFactory.uret({ saglayici }).saglayiciAdi).toBe("tanimsiz");
    }
  });

  it("platform anahtarı kiracının adresine gönderilmez", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-platform");
    const fetchSahte = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    vi.stubGlobal("fetch", fetchSahte);

    await AiProviderFactory.uret({ saglayici: "openai", baseUrl: "https://saldirgan.example.com/v1" }).metinUret({ prompt: "x" });

    const [adres, secenek] = fetchSahte.mock.calls[0];
    expect(adres).toBe("https://api.openai.com/v1/chat/completions");
    expect(secenek.headers.Authorization).toBe("Bearer sk-platform");
  });

  it("kiracı kendi anahtarıyla kendi https adresini kullanabilir", async () => {
    const fetchSahte = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) });
    vi.stubGlobal("fetch", fetchSahte);

    await AiProviderFactory.uret({ saglayici: "openai", apiKey: "sk-kiraci", baseUrl: "https://kurum.openai.azure.com/v1" }).metinUret({ prompt: "x" });

    expect(fetchSahte.mock.calls[0][0]).toBe("https://kurum.openai.azure.com/v1/chat/completions");
  });

  it("kiracının yerel/özel ağ adresi kullanılmaz", async () => {
    const fetchSahte = vi.fn();
    vi.stubGlobal("fetch", fetchSahte);
    const p = AiProviderFactory.uret({ saglayici: "openai", apiKey: "sk-kiraci", baseUrl: "https://10.0.0.5/v1" });
    await expect(p.metinUret({ prompt: "x" })).rejects.toThrow(/adresi kullanılamaz/);
    expect(fetchSahte).not.toHaveBeenCalled();
  });

  it("alan adı özel IP'ye çözülürse ve sağlayıcı yönlendirme döndürürse istek engellenir", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    const fetchSahte = vi.fn();
    vi.stubGlobal("fetch", fetchSahte);
    await expect(AiProviderFactory.uret({ saglayici: "openai", apiKey: "sk-x", baseUrl: "https://ai.example.com/v1" }).metinUret({ prompt: "x" })).rejects.toThrow(/özel veya yerel bir ağa/);
    expect(fetchSahte).not.toHaveBeenCalled();

    vi.mocked(lookup).mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }] as never);
    fetchSahte.mockResolvedValueOnce({ status: 302, ok: false });
    await expect(AiProviderFactory.uret({ saglayici: "openai", apiKey: "sk-x", baseUrl: "https://ai.example.com/v1" }).metinUret({ prompt: "x" })).rejects.toThrow(/yönlendirme/);
    expect(fetchSahte.mock.calls[0][1].redirect).toBe("manual");
  });

  it("Ollama adresi kiracıdan alınmaz", () => {
    vi.stubEnv("OLLAMA_BASE_URL", "");
    expect(AiProviderFactory.uret({ saglayici: "ollama", baseUrl: "http://postgres:5432" }).saglayiciAdi).toBe("tanimsiz");
  });

  it("kiraciAdresiHatasi", () => {
    expect(kiraciAdresiHatasi("https://api.openai.com/v1")).toBeNull();
    expect(kiraciAdresiHatasi("http://api.openai.com/v1")).toMatch(/https/);
    expect(kiraciAdresiHatasi("https://192.168.1.10")).toMatch(/IP/);
    expect(kiraciAdresiHatasi("https://[::1]")).toMatch(/IP/);
    expect(kiraciAdresiHatasi("https://minio")).toMatch(/Yerel/);
    expect(kiraciAdresiHatasi("https://x.internal")).toMatch(/Yerel/);
    expect(kiraciAdresiHatasi("https://u:p@api.openai.com")).toMatch(/parola/);
    expect(kiraciAdresiHatasi("yok")).toMatch(/URL/);
  });
});
