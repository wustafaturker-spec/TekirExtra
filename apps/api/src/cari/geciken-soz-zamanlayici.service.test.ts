import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GecikenSozZamanlayiciService } from "./geciken-soz-zamanlayici.service";
import { aktifBaglam } from "../core/istek-baglami";
import { tahsilatOtomasyonSemasi } from "./tahsilat-otomasyon-ayari";
import { Logger } from "@nestjs/common";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const yonetim = vi.hoisted(() => ({ findMany: vi.fn(), disconnect: vi.fn() }));
vi.mock("@prisma/client", async (original) => ({ ...await original<typeof import("@prisma/client")>(), PrismaClient: class { tenant = { findMany: yonetim.findMany }; $disconnect = yonetim.disconnect; } }));
function kur() {
  const tx = {
    modulAyar: { findMany: vi.fn().mockResolvedValue([{ modul: "tahsilat_operasyonu", ayarlar: { mod: "pilot" } }, { modul: "tahsilat_otomasyonu", ayarlar: { acik: true, sorumluUserId: id } }]) },
    user: { findFirst: vi.fn().mockResolvedValue({ id, rol: "muhasebe" }) },
    odemeSozu: { findMany: vi.fn().mockResolvedValue([{ cariId: "c1" }, { cariId: "c2" }]) },
    $queryRaw: vi.fn().mockResolvedValue([{ zaman: new Date("2026-10-15T21:30:00Z") }]),
  };
  const prisma = { tenantIslem: vi.fn((_id, fn) => fn(tx)) };
  const takip = { gecikenSozleriBagla: vi.fn().mockImplementation(async () => { expect(aktifBaglam()).toMatchObject({ tenantId: "tenant", userId: id, rol: "muhasebe" }); return { baglanan: 1, olusturulan: 1 }; }) };
  const service = new GecikenSozZamanlayiciService(prisma as never, takip as never);
  return { tx, prisma, takip, service };
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined); vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined); yonetim.findMany.mockResolvedValue([]); yonetim.disconnect.mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Geciken söz otomasyon ayarı", () => {
  it("varsayılan kapalı ve sorumlusuzdur", () => { expect(tahsilatOtomasyonSemasi.parse({})).toEqual({ acik: false, sorumluUserId: null, uygulamaIciBildirim: false }); });
  it.each([{ acik: true }, { acik: true, sorumluUserId: "hata" }, { acik: "true" }, { acik: true, sorumluUserId: id, tenantId: id }])("geçersiz ayar reddedilir %j", (g) => { expect(tahsilatOtomasyonSemasi.safeParse(g).success).toBe(false); });
});
describe("Geciken söz tarayıcısı", () => {
  it("Türkiye gününü ve tenant koşulunu kullanır; gerçek sorumluyla çalışır", async () => {
    const { service, tx } = kur(); expect(await service.taraTenant("tenant")).toEqual({ baglanan: 2, olusturulan: 2, hatali: 0 });
    expect(tx.odemeSozu.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "tenant", kayitDurumu: "aktif", sozTarihi: { lt: new Date("2026-10-16") }, takipBaglantisi: null }, take: 101 });
  });
  it.each(["kapali", "salt_okunur"])("%s modunda çalışmaz", async (mod) => {
    const { service, tx, takip } = kur(); tx.modulAyar.findMany.mockResolvedValue([{ modul: "tahsilat_operasyonu", ayarlar: { mod } }, { modul: "tahsilat_otomasyonu", ayarlar: { acik: true, sorumluUserId: id } }] as never);
    expect((await service.taraTenant("tenant")).baglanan).toBe(0); expect(takip.gecikenSozleriBagla).not.toHaveBeenCalled();
  });
  it("ayar yokken aday ve kullanıcı sorgulamaz", async () => {
    const { service, tx } = kur(); tx.modulAyar.findMany.mockResolvedValue([]);
    await service.taraTenant("tenant"); expect(tx.user.findFirst).not.toHaveBeenCalled(); expect(tx.odemeSozu.findMany).not.toHaveBeenCalled();
  });
  it("sorumlu uygun değilse kimlik yükseltmez", async () => {
    const { service, tx, takip } = kur(); tx.user.findFirst.mockResolvedValue(null as never);
    await expect(service.taraTenant("tenant")).rejects.toThrow("uygun değil"); expect(takip.gecikenSozleriBagla).not.toHaveBeenCalled();
  });
  it("100 cari sınırında kısmi iş üretmez", async () => {
    const { service, tx, takip } = kur(); tx.odemeSozu.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ cariId: `c${i}` })));
    await expect(service.taraTenant("tenant")).rejects.toThrow("100 cari"); expect(takip.gecikenSozleriBagla).not.toHaveBeenCalled();
  });
  it("bir cari hatası diğerini durdurmaz; hata sayısı döner", async () => {
    const { service, takip } = kur(); takip.gecikenSozleriBagla.mockRejectedValueOnce(new Error("Tutarsız kaynak"));
    expect(await service.taraTenant("tenant")).toEqual({ baglanan: 1, olusturulan: 1, hatali: 1 });
  });
  it("API sürecinde zamanlayıcı kurulmaz", () => {
    vi.stubEnv("TEKIR_WORKER", "0"); vi.useFakeTimers(); const { service } = kur(); service.onModuleInit(); expect(vi.getTimerCount()).toBe(0); service.onModuleDestroy();
  });
  it("worker başlangıcında ve 15 dakikada tarar; kapanışta zamanlayıcıları temizler", async () => {
    vi.stubEnv("TEKIR_WORKER", "1"); vi.useFakeTimers(); const { service } = kur(); const calis = vi.spyOn(service, "calistir").mockResolvedValue();
    service.onModuleInit(); await vi.advanceTimersByTimeAsync(1); expect(calis).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000); expect(calis).toHaveBeenCalledTimes(2);
    service.onModuleDestroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it("tenant keşfi sayfalanır ve bir tenant hatası diğerini durdurmaz", async () => {
    vi.stubEnv("DATABASE_URL_MIGRATE", "test-only"); const { service } = kur(); const tara = vi.spyOn(service, "taraTenant").mockResolvedValue({ baglanan: 0, olusturulan: 0, hatali: 0 });
    tara.mockRejectedValueOnce(new Error("Sentetik tenant hatası"));
    yonetim.findMany.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` }))).mockResolvedValueOnce([{ id: "t100" }]);
    await service.calistir(); expect(tara).toHaveBeenCalledTimes(101); expect(yonetim.findMany.mock.calls[1][0]).toMatchObject({ where: { id: { gt: "t99" } }, take: 100 }); expect(yonetim.disconnect).toHaveBeenCalledTimes(1);
  });
  it("çakışan taramayı ve kapanıştan sonraki çalışmayı bastırır", async () => {
    vi.stubEnv("DATABASE_URL_MIGRATE", "test-only"); const { service } = kur(); let bitir!: (x: []) => void;
    yonetim.findMany.mockImplementationOnce(() => new Promise((r) => { bitir = r; }));
    const ilk = service.calistir(); await service.calistir(); expect(yonetim.findMany).toHaveBeenCalledTimes(1);
    bitir([]); await ilk; service.onModuleDestroy(); await service.calistir(); expect(yonetim.findMany).toHaveBeenCalledTimes(1);
  });
});
