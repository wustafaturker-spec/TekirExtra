import { afterEach, describe, expect, it, vi } from "vitest";
import { guvenliTekrar, istanbulSaat, OdemeSozuHatirlatmaService } from "./odeme-sozu-hatirlatma.service";
import { IletiSiniriAsildi } from "../ileti/ileti-kurallari";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("Ödeme sözü günü e-posta planlama", () => {
  it("Türkiye gün sınırını UTC tarihinden ayırır", () => {
    expect(istanbulSaat(new Date("2026-10-20T21:30:00Z"))).toEqual({ gun: "2026-10-21", saat: 0 });
    expect(istanbulSaat(new Date("2026-10-21T06:00:00Z"))).toEqual({ gun: "2026-10-21", saat: 9 });
  });
  it.each([{ code: "EDNS" }, { code: "ECONNECTION" }, { code: "EAUTH" }, { code: "ETLS" }, { responseCode: 451 }, { responseCode: 550 }])("kesinlikle kabul edilmemiş SMTP denemesi tekrar edilebilir %j", e => expect(guvenliTekrar(e)).toBe(true));
  it("sınıra takılan ileti güvenle tekrar edilir (ILT-14)", () => expect(guvenliTekrar(new IletiSiniriAsildi("tavan", "gunluk"))).toBe(true));
  it.each([{ code: "ETIMEDOUT", command: "DATA" }, { code: "ESOCKET" }, new Error("socket closed"), null])("belirsiz teslimat sonucu otomatik tekrarlanmaz %j", e => expect(guvenliTekrar(e)).toBe(false));
  const kur = () => { const s = new OdemeSozuHatirlatmaService({} as never, {} as never); return { s, tara: vi.spyOn(s, "taraTenant") }; };
  it("sabit firma tanımlı değilse keşfedilen tüm firmaları tarar, biri hata verse de sürer", async () => {
    const { s, tara } = kur(), firmalar = Array.from({ length: 9 }, (_, i) => `t${i}`);
    vi.spyOn(s, "firmalar").mockResolvedValue([...firmalar]);
    tara.mockImplementation(async (t) => { if (t === "t2") throw new Error("bozuk"); return { gonderilen: 0, atlanan: 0, hatali: 0 }; });
    await s.calistir();
    expect(tara.mock.calls.map(([t]) => t).sort()).toEqual(firmalar);
    expect(s.saglikli()).toBe(true);
  });
  it("aynı anda en çok dört firma taranır", async () => {
    const { s, tara } = kur(); let anlik = 0, enCok = 0;
    vi.spyOn(s, "firmalar").mockResolvedValue(Array.from({ length: 12 }, (_, i) => `t${i}`));
    tara.mockImplementation(async () => { enCok = Math.max(enCok, ++anlik); await new Promise((r) => setTimeout(r, 2)); anlik--; return { gonderilen: 0, atlanan: 0, hatali: 0 }; });
    await s.calistir();
    expect(enCok).toBe(4);
  });
  it("kapanışta yeni firmaya geçmez", async () => {
    const { s, tara } = kur();
    vi.spyOn(s, "firmalar").mockResolvedValue(Array.from({ length: 12 }, (_, i) => `t${i}`));
    tara.mockImplementation(async () => { s.onModuleDestroy(); return { gonderilen: 0, atlanan: 0, hatali: 0 }; });
    await s.calistir();
    expect(tara.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("sabit firma tanımlıysa yalnız onu döner, geçersizse başlamaz", async () => {
    vi.stubEnv("ODEME_SOZU_HATIRLATMA_TENANT_ID", id);
    expect(await kur().s.firmalar()).toEqual([id]);
    vi.stubEnv("ODEME_SOZU_HATIRLATMA_TENANT_ID", "yanlis"); vi.stubEnv("TEKIR_ODEME_SOZU_WORKER", "1");
    expect(() => kur().s.onModuleInit()).toThrow();
  });
  it("sabit firma yoksa worker başlangıçta hata vermez", () => {
    vi.useFakeTimers(); vi.stubEnv("TEKIR_ODEME_SOZU_WORKER", "1"); vi.stubEnv("ODEME_SOZU_HATIRLATMA_TENANT_ID", "");
    const s = kur().s; vi.spyOn(s, "calistir").mockResolvedValue();
    expect(() => s.onModuleInit()).not.toThrow(); s.onModuleDestroy();
  });
  it("normal API ve genel worker süreci yeni zamanlayıcıyı başlatmaz", () => {
    vi.useFakeTimers();vi.stubEnv("TEKIR_WORKER", "1");vi.stubEnv("TEKIR_ODEME_SOZU_WORKER", "0");
    const s = new OdemeSozuHatirlatmaService({} as never, {} as never);s.onModuleInit();expect(vi.getTimerCount()).toBe(0);
  });
  it("ayrı worker başlangıçta ve 15 dakikada çalışır; kapanışta temizlenir", async () => {
    vi.useFakeTimers();vi.stubEnv("TEKIR_ODEME_SOZU_WORKER", "1");vi.stubEnv("ODEME_SOZU_HATIRLATMA_TENANT_ID", id);
    const s = new OdemeSozuHatirlatmaService({} as never, {} as never), calis = vi.spyOn(s, "calistir").mockResolvedValue();
    s.onModuleInit();await vi.advanceTimersByTimeAsync(1);expect(calis).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15*60*1000);expect(calis).toHaveBeenCalledTimes(2);s.onModuleDestroy();expect(vi.getTimerCount()).toBe(0);
  });
});
