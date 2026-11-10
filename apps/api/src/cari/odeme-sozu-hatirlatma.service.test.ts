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
