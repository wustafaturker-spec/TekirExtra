import { afterEach, describe, expect, it, vi } from "vitest";
import { DuzeltmeTaramaZamanlayiciService, STOK_DEGISIM_PAYI_MS, sonTamDenetimSiniri, stokDenetimBaslangici } from "./duzeltme-tarama-zamanlayici.service";

describe("DuzeltmeTaramaZamanlayiciService", () => {
  const oncekiWorker = process.env.TEKIR_WORKER;
  const oncekiAralik = process.env.DUZELTME_TARAMA_INTERVAL_MS;
  const metrics = { increment: vi.fn(), set: vi.fn() };

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    if (oncekiWorker === undefined) delete process.env.TEKIR_WORKER; else process.env.TEKIR_WORKER = oncekiWorker;
    if (oncekiAralik === undefined) delete process.env.DUZELTME_TARAMA_INTERVAL_MS; else process.env.DUZELTME_TARAMA_INTERVAL_MS = oncekiAralik;
  });

  it("API sürecinde zamanlayıcı başlatmaz", () => {
    delete process.env.TEKIR_WORKER; vi.useFakeTimers();
    const service = new DuzeltmeTaramaZamanlayiciService({ tara: vi.fn() } as never, metrics as never);
    service.onModuleInit();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("worker sürecinde taramayı hemen ve en fazla 15 dakikalık aralıkla planlar", async () => {
    process.env.TEKIR_WORKER = "1"; process.env.DUZELTME_TARAMA_INTERVAL_MS = String(20 * 60 * 1000); vi.useFakeTimers();
    const service = new DuzeltmeTaramaZamanlayiciService({ tara: vi.fn() } as never, metrics as never);
    const calistir = vi.spyOn(service, "calistir").mockResolvedValue();
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(calistir).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(calistir).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it("başarılı taramanın bulgu, çözüm ve son başarı metriklerini yayınlar", async () => {
    const duzeltmeler = { tara: vi.fn().mockResolvedValue({ bulunan: 3, otomatikCozulen: 1 }) };
    const service = new DuzeltmeTaramaZamanlayiciService(duzeltmeler as never, metrics as never);
    vi.spyOn(service as never, "tenantIdleriAl").mockResolvedValue({ tumu: ["tenant-1"], aktifler: new Set(["tenant-1"]) });

    await service.calistir();

    expect(metrics.increment).toHaveBeenCalledWith("correction_scan_runs_total", { result: "success" });
    expect(metrics.increment).toHaveBeenCalledWith("correction_findings_total", {}, 3);
    expect(metrics.increment).toHaveBeenCalledWith("correction_auto_resolutions_total", {}, 1);
    expect(metrics.set).toHaveBeenCalledWith("correction_scan_last_success_timestamp_seconds", expect.any(Number));
  });

  it("bir tenant başarısız olduğunda sonraki tenantı taramaya devam eder", async () => {
    const duzeltmeler = { tara: vi.fn().mockRejectedValueOnce(new Error("tenant bozuk")).mockResolvedValueOnce({ bulunan: 2, otomatikCozulen: 0 }) };
    const service = new DuzeltmeTaramaZamanlayiciService(duzeltmeler as never, metrics as never);
    vi.spyOn(service as never, "tenantIdleriAl").mockResolvedValue({ tumu: ["tenant-1", "tenant-2"], aktifler: new Set(["tenant-1", "tenant-2"]) });

    await service.calistir();

    expect(duzeltmeler.tara).toHaveBeenCalledTimes(2);
    expect(metrics.increment).toHaveBeenCalledWith("correction_scan_runs_total", { result: "partial" });
    expect(metrics.set).toHaveBeenCalledWith("correction_scan_failed_tenants", 1);
    expect(metrics.set).not.toHaveBeenCalledWith("correction_scan_last_success_timestamp_seconds", expect.any(Number));
  });
  it("BLD-11: pasif firmayı yalnız kendi dilimindeki çalışmada tarar (saatte bir), aktifi her çalışmada", async () => {
    const duzeltmeler = { tara: vi.fn().mockResolvedValue({ bulunan: 0, otomatikCozulen: 0 }) };
    const service = new DuzeltmeTaramaZamanlayiciService(duzeltmeler as never, metrics as never);
    const tumu = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    vi.spyOn(service as never, "tenantIdleriAl").mockResolvedValue({ tumu, aktifler: new Set([tumu[0]]) });
    vi.useFakeTimers();
    const sayac = new Map<string, number>();
    duzeltmeler.tara.mockImplementation(async () => ({ bulunan: 0, otomatikCozulen: 0 }));
    const t0 = Date.UTC(2026, 10, 6, 10, 0);
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(t0 + i * 15 * 60 * 1000);
      const once = duzeltmeler.tara.mock.calls.length;
      await service.calistir();
      sayac.set(String(i), duzeltmeler.tara.mock.calls.length - once);
    }
    const toplam = [...sayac.values()].reduce((a, b) => a + b, 0);
    // Aktif firma 4 kez, 39 pasif firma birer kez: toplam 43 tarama.
    expect(toplam).toBe(4 + 39);
  });
});

describe("BLD-15 stok tutarlılık denetimi: gecede bir tam, arada artımlı", () => {
  const saat = (iso: string) => Date.parse(iso);

  it("son tam denetim sınırı İstanbul 03:00'tür; 03:00'ten önce dünkü sınır geçerlidir", () => {
    expect(new Date(sonTamDenetimSiniri(saat("2026-11-07T06:00:00Z"))).toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(new Date(sonTamDenetimSiniri(saat("2026-11-06T23:59:00Z"))).toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(new Date(sonTamDenetimSiniri(saat("2026-11-07T00:00:00Z"))).toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("ilk tarama ve 03:00'ü geçen ilk tarama tam; arada son taramadan 5 dk payla artımlı", () => {
    const simdi = saat("2026-11-07T10:00:00Z");
    expect(stokDenetimBaslangici(undefined, undefined, simdi)).toBeUndefined();
    expect(stokDenetimBaslangici(saat("2026-11-07T09:45:00Z"), saat("2026-11-06T22:00:00Z"), simdi)).toBeUndefined();
    expect(stokDenetimBaslangici(saat("2026-11-07T09:45:00Z"), saat("2026-11-07T00:30:00Z"), simdi)?.toISOString()).toBe(new Date(saat("2026-11-07T09:45:00Z") - STOK_DEGISIM_PAYI_MS).toISOString());
  });
});
