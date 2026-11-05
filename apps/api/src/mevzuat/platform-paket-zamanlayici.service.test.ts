import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformPaketZamanlayiciService } from "./platform-paket-zamanlayici.service";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("planlı paket worker zamanlayıcısı", () => {
  it("API sürecinde ve platform bağlantısı yokken çalışmaz", async () => {
    vi.useFakeTimers(); vi.stubEnv("TEKIR_WORKER", "0");
    const paket = { planliAtamalariIsle: vi.fn() }, s = new PlatformPaketZamanlayiciService(paket as never);
    s.onModuleInit(); await vi.advanceTimersByTimeAsync(60001); s.onModuleDestroy();
    expect(paket.planliAtamalariIsle).not.toHaveBeenCalled();
    vi.stubEnv("TEKIR_WORKER", "1"); vi.stubEnv("DATABASE_URL_PLATFORM", "");
    const diger = new PlatformPaketZamanlayiciService(paket as never);
    diger.onModuleInit(); await vi.advanceTimersByTimeAsync(60001); diger.onModuleDestroy();
    expect(paket.planliAtamalariIsle).not.toHaveBeenCalled();
  });
  it("açılışta ve dakikalık tarar; kapanışta durur", async () => {
    vi.useFakeTimers(); vi.stubEnv("TEKIR_WORKER", "1"); vi.stubEnv("DATABASE_URL_PLATFORM", "test");
    const paket = { planliAtamalariIsle: vi.fn(async () => undefined) }, s = new PlatformPaketZamanlayiciService(paket as never);
    s.onModuleInit(); await vi.advanceTimersByTimeAsync(1);
    expect(paket.planliAtamalariIsle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000); expect(paket.planliAtamalariIsle).toHaveBeenCalledTimes(2);
    s.onModuleDestroy(); await vi.advanceTimersByTimeAsync(60000); expect(paket.planliAtamalariIsle).toHaveBeenCalledTimes(2);
  });
  it("taramalar çakışmaz; hata veya kapanma sonraki çağrıları doğru etkiler", async () => {
    let bitir!: () => void;
    const paket = { planliAtamalariIsle: vi.fn(() => new Promise<void>((r) => { bitir = r; })) };
    const s = new PlatformPaketZamanlayiciService(paket as never), ilk = s.calistir();
    await s.calistir(); expect(paket.planliAtamalariIsle).toHaveBeenCalledTimes(1); bitir(); await ilk;
    paket.planliAtamalariIsle.mockRejectedValueOnce(new Error("DB geçici hata"));
    await expect(s.calistir()).rejects.toThrow("DB geçici hata");
    paket.planliAtamalariIsle.mockResolvedValueOnce(); await s.calistir();
    expect(paket.planliAtamalariIsle).toHaveBeenCalledTimes(3);
    s.onModuleDestroy(); await s.calistir(); expect(paket.planliAtamalariIsle).toHaveBeenCalledTimes(3);
  });
});
