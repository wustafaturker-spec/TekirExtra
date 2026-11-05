import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { PlatformIstatistikZamanlayiciService } from "./platform-istatistik-zamanlayici.service";

function kur() {
  const db = { $queryRaw: vi.fn(async () => [{ gun: "2026-11-01" }, { gun: "2026-11-02" }]) };
  const metrik = { gunuUret: vi.fn(async (_gun: string) => 1), operasyonGozle: vi.fn(async () => true) };
  return { db, metrik, s: new PlatformIstatistikZamanlayiciService({ db } as never, metrik as never) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("firma istatistik zamanlayıcısı", () => {
  it("API sürecinde veya platform bağlantısı yokken çalışmaz", async () => {
    vi.useFakeTimers(); vi.stubEnv("TEKIR_WORKER", "0");
    const k = kur(); k.s.onModuleInit(); await vi.advanceTimersByTimeAsync(600001);
    expect(k.db.$queryRaw).not.toHaveBeenCalled(); k.s.onModuleDestroy();
    vi.stubEnv("TEKIR_WORKER", "1"); vi.stubEnv("DATABASE_URL_PLATFORM", "");
    const diger = kur(); diger.s.onModuleInit(); await vi.advanceTimersByTimeAsync(600001);
    expect(diger.db.$queryRaw).not.toHaveBeenCalled(); diger.s.onModuleDestroy();
  });
  it("worker açılışında ve aralıkta aday günleri işler, kapanınca durur", async () => {
    vi.useFakeTimers(); vi.stubEnv("TEKIR_WORKER", "1"); vi.stubEnv("DATABASE_URL_PLATFORM", "test");
    const k = kur(); k.s.onModuleInit(); await vi.advanceTimersByTimeAsync(1);
    expect(k.metrik.gunuUret.mock.calls.map((c) => c[0])).toEqual(["2026-11-01", "2026-11-02"]);
    expect(k.metrik.operasyonGozle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600000); expect(k.db.$queryRaw).toHaveBeenCalledTimes(2);
    k.s.onModuleDestroy(); await vi.advanceTimersByTimeAsync(600000); expect(k.db.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it("aynı süreçte iki tarama üst üste binmez; hata sonraki taramayı kilitlemez", async () => {
    const k = kur(); let bitir!: () => void;
    k.metrik.gunuUret.mockImplementationOnce(() => new Promise<number>((r) => { bitir = () => r(1); }));
    const ilk = k.s.calistir(); await vi.waitFor(() => expect(k.metrik.gunuUret).toHaveBeenCalled()); await k.s.calistir();
    expect(k.db.$queryRaw).toHaveBeenCalledTimes(1); bitir(); await ilk;
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    k.db.$queryRaw.mockRejectedValueOnce(new Error("DB geçici hata"));
    await expect(k.s.calistir()).rejects.toThrow("DB geçici hata");
    await k.s.calistir(); expect(k.db.$queryRaw).toHaveBeenCalledTimes(3); k.s.onModuleDestroy();
  });
});
