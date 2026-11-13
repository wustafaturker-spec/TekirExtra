import { afterEach, describe, expect, it, vi } from "vitest";
import { nabizla, NabizLogger } from "../nabiz/nabiz";
import type { HataGirdisi } from "./hata-kayit";
import { gunlukGirdisi, gunlukHatasiniKaydet, surecHataKaydediciAyarla, yakalanmamisHatalariDinle } from "./surec-hatalari";

vi.mock("../redis-kilit", () => ({ pencereIsareti: vi.fn(async () => true), uzayanKilitle: vi.fn(async () => async () => undefined) }));

function kur(kaynak: HataGirdisi["kaynak"] = "worker", yalnizArkaPlan = false) {
  const kayitlar: HataGirdisi[] = [];
  surecHataKaydediciAyarla({ kaynak, yalnizArkaPlan, kaydet: async (g) => { kayitlar.push(g); } });
  return kayitlar;
}

afterEach(() => surecHataKaydediciAyarla(null));

describe("süreç hataları (PLT-123)", () => {
  it("Nest günlük satırından ad, yığın ve bağlam çıkarılır", () => {
    const yigin = "TypeError: x is undefined\n    at Foo.bar (/app/dist/foo.js:1:2)";
    expect(gunlukGirdisi("worker", "Tarama düştü", [yigin, "PosService"], null)).toMatchObject({ kaynak: "worker", ad: "TypeError", mesaj: "Tarama düştü", yigin, konum: "log:PosService" });
    const e = new RangeError("taşma");
    expect(gunlukGirdisi("telegram", e, ["TelegramService"], "telegram-bildirim")).toMatchObject({ ad: "RangeError", mesaj: "taşma", yigin: e.stack, konum: "is:telegram-bildirim" });
    expect(gunlukGirdisi("worker", { kod: 1 }, [], null)).toMatchObject({ ad: "Hata", mesaj: '{"kod":1}', konum: "log" });
  });

  it("API sürecinde yalnız arka plan işindeki hata alınır (HTTP hatası filtrede kaydedilir)", () => {
    const k = kur("api", true);
    gunlukHatasiniKaydet("istek hatası", ["FaturaController"], null);
    gunlukHatasiniKaydet("zamanlayıcı hatası", ["AlarmService"], "sistem-sagligi");
    expect(k.map((g) => g.konum)).toEqual(["is:sistem-sagligi"]);
  });

  it("kaydedici yoksa bir şey yapılmaz; dakikada en çok 60 kayıt", () => {
    gunlukHatasiniKaydet("x", [], null);
    const k = kur();
    for (let i = 0; i < 70; i++) gunlukHatasiniKaydet(`hata ${i}`, [], null);
    expect(k.length).toBeLessThanOrEqual(60);
  });

  it("nabız işinde günlüğe yazılan ve fırlatılan hata iş adıyla kaydedilir", async () => {
    const k = kur();
    const logger = new NabizLogger();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await nabizla("deneme-isi", async () => { logger.error("bağlantı koptu", "DenemeService"); });
    await nabizla("firlatan-is", async () => { throw new Error("çöktü"); });
    expect(k.map((g) => [g.konum, g.mesaj])).toEqual(expect.arrayContaining([["is:deneme-isi", "bağlantı koptu"], ["is:firlatan-is", "çöktü"]]));
    vi.restoreAllMocks();
  });
});

describe("yakalanmamış hatalar (PLT-124)", () => {
  it("söz reddi kaydedilir ve süreç sürer; istisna kaydedilip süreç kapanır", async () => {
    const onceki = { r: process.listeners("unhandledRejection"), e: process.listeners("uncaughtException") };
    const cikis = vi.fn();
    const k = kur("worker");
    yakalanmamisHatalariDinle(cikis);
    const yeniR = process.listeners("unhandledRejection").filter((l) => !onceki.r.includes(l));
    const yeniE = process.listeners("uncaughtException").filter((l) => !onceki.e.includes(l));
    try {
      (yeniR[0] as (n: unknown) => void)(new TypeError("bekleyen söz"));
      expect(k[0]).toMatchObject({ ad: "UnhandledRejection:TypeError", konum: "surec:unhandledRejection", mesaj: "bekleyen söz" });
      expect(cikis).not.toHaveBeenCalled();
      (yeniE[0] as (h: Error) => void)(new Error("patladı"));
      await vi.waitFor(() => expect(cikis).toHaveBeenCalledWith(1));
      expect(k[1]).toMatchObject({ ad: "UncaughtException:Error", konum: "surec:uncaughtException" });
    } finally {
      for (const l of yeniR) process.off("unhandledRejection", l as never);
      for (const l of yeniE) process.off("uncaughtException", l as never);
    }
  });
});

describe("kaynak kısıtı (PLT-123)", () => {
  it("veritabanındaki son kaynak CHECK'i koddaki kaynaklarla aynı", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { HATA_KAYNAKLARI } = await import("./hata-kayit");
    const kok = join(__dirname, "../../../prisma/migrations");
    const son = readdirSync(kok).sort().map((d) => { try { return readFileSync(join(kok, d, "migration.sql"), "utf8"); } catch { return ""; } })
      .flatMap((sql) => [...sql.matchAll(/kaynak"?\s+IN\s*\(([^)]*)\)/gi)].map((m) => m[1])).at(-1) ?? "";
    expect(son.match(/'([a-z]+)'/g)?.map((x) => x.replace(/'/g, "")).sort()).toEqual([...HATA_KAYNAKLARI].sort());
  });
});
