import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

/** OCR: güçlü model görsel okuyamazsa ekonomik modele düşülür, sonraki belgede güçlü model atlanır. */
const cagrilar: string[] = [];
let gucluDavranis: "zaman_asimi" | "basarili" | "zod" = "zaman_asimi";
const saglayici = (model: string) => ({
  saglayiciAdi: "openai", modelAdi: model,
  async yapilandirilmisUretim(girdi: { dusunmeKapali?: boolean }) {
    cagrilar.push(`${model}:${girdi.dusunmeKapali ? "kapali" : "acik"}`);
    if (model === "guclu" && gucluDavranis === "zaman_asimi") throw new ServiceUnavailableException("OpenAI yanıt vermedi.");
    if (model === "guclu" && gucluDavranis === "zod") throw new Error("ZodError");
    return { model };
  },
});
vi.mock("./saglayici/kiraci-saglayici", () => ({
  kiraciSaglayicisi: async (_p: unknown, _t: string, s: { ekonomikModel?: boolean }) => ({ saglayici: saglayici(s.ekonomikModel ? "ekonomik" : "guclu"), ozelTalimatlar: null }),
}));

const { AiService } = await import("./ai.service");
const servis = new AiService({} as never);
const calistir = (tenantId: string, gorsel = true) => (servis as unknown as { taramaCalistir: (t: string, g: boolean, c: (p: { yapilandirilmisUretim: (g: object) => Promise<unknown> }) => Promise<unknown>) => Promise<{ sonuc: { model: string } }> })
  .taramaCalistir(tenantId, gorsel, (p) => p.yapilandirilmisUretim({ dusunmeKapali: true }));

describe("OCR yedek model", () => {
  it("güçlü model zaman aşımına düşerse ekonomik modelle okunur; sonraki belgede güçlü model atlanır", async () => {
    cagrilar.length = 0;
    expect((await calistir("t1")).sonuc.model).toBe("ekonomik");
    expect(cagrilar).toEqual(["guclu:kapali", "ekonomik:kapali"]);
    cagrilar.length = 0;
    expect((await calistir("t1")).sonuc.model).toBe("ekonomik");
    expect(cagrilar).toEqual(["ekonomik:kapali"]);
  });

  it("güçlü model okuyabiliyorsa yalnız o kullanılır; şema hatası yedeğe düşürmez", async () => {
    gucluDavranis = "basarili";
    cagrilar.length = 0;
    expect((await calistir("t2")).sonuc.model).toBe("guclu");
    expect(cagrilar).toEqual(["guclu:kapali"]);
    gucluDavranis = "zod";
    await expect(calistir("t3")).rejects.toThrow("ZodError");
  });

  it("görselsiz (metin) tarama doğrudan güçlü modelle", async () => {
    gucluDavranis = "zaman_asimi";
    await expect(calistir("t4", false)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
