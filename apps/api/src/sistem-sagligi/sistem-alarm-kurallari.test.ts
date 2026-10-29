import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { NabizLogger, nabizKaydediciAyarla, nabizla, type NabizSonucu } from "../core/nabiz/nabiz";
import { sorunlariBul, type AlarmGirdisi } from "./sistem-alarm-kurallari";

const simdi = new Date("2026-10-29T13:00:00Z");
const once = (dk: number) => new Date(simdi.getTime() - dk * 60_000);
const bos: AlarmGirdisi = { simdi, workerSurecleri: [], oncekiWorkerVar: true, oluIsler: [], kursorler: [], isler: [] };

describe("sistem alarm kuralları (PLT-19)", () => {
  it("sağlıklı sistemde sorun yok", () => {
    expect(sorunlariBul({ ...bos, workerSurecleri: [{ basladiAt: once(300), sonNabizAt: once(2) }], kursorler: [{ tenantId: "t", unvan: "A", sonCekimAt: once(60) }], isler: [{ isAdi: "bildirim", ardisikHata: 2, sonHata: "x" }] })).toEqual([]);
  });

  it("worker nabzı 10 dakikayı geçince", () => {
    expect(sorunlariBul({ ...bos, workerSurecleri: [{ basladiAt: once(300), sonNabizAt: once(11) }] }).map((s) => s.anahtar)).toEqual(["worker:nabiz"]);
  });

  it("bugünkü OOM örüntüsü: 1 saatte 2 yeniden başlama alarm; dağıtım + 1 açılış alarm değil", () => {
    const iki = [{ basladiAt: once(5), sonNabizAt: once(1) }, { basladiAt: once(8), sonNabizAt: once(6) }, { basladiAt: once(55), sonNabizAt: once(9) }];
    expect(sorunlariBul({ ...bos, workerSurecleri: iki, oncekiWorkerVar: false }).map((s) => s.anahtar)).toEqual(["worker:yeniden-baslama"]);
    expect(sorunlariBul({ ...bos, workerSurecleri: [{ basladiAt: once(5), sonNabizAt: once(1) }], oncekiWorkerVar: true })).toEqual([]);
    expect(sorunlariBul({ ...bos, workerSurecleri: iki.slice(0, 2), oncekiWorkerVar: false })).toEqual([]);
  });

  it("kuyruktan düşen her iş, 3 saati aşan ya da hiç tamamlanmamış kursör ve 3 ardışık hata ayrı sorun", () => {
    const s = sorunlariBul({
      ...bos,
      oluIsler: [{ id: "d1", tenantId: "t1", unvan: "DEMO", isTuru: "gelen-belge-cek", hata: "job stalled" }],
      kursorler: [{ tenantId: "t1", unvan: "DEMO ", sonCekimAt: once(400) }, { tenantId: "t2", unvan: "YENİ", sonCekimAt: null }],
      isler: [{ isAdi: "banka-senkron-zamanlayici", ardisikHata: 3, sonHata: "zaman aşımı" }],
    });
    expect(s.map((x) => x.anahtar)).toEqual(["olu-is:d1", "kursor:t1", "kursor:t2", "is:banka-senkron-zamanlayici"]);
    expect(s[1].ozet).toBe("DEMO: gelen e-Fatura taraması 6 saattir başarıyla bitmiyor (son 2026-10-29T06:20:00.000Z).");
    expect(s[2].ozet).toContain("hiç tamamlanmadı");
  });
});

describe("zamanlayıcı nabzı (PLT-16)", () => {
  afterEach(() => nabizKaydediciAyarla(null));

  it("içeride yakalanıp yalnız loglanan hata da çalışmayı hatalı yapar; dışarıdaki log etkilemez", async () => {
    Logger.overrideLogger(new NabizLogger());
    const kayitlar: NabizSonucu[] = [];
    nabizKaydediciAyarla(async (s) => { kayitlar.push(s); });
    const logger = new Logger("Deneme");
    logger.error("bağlam dışı hata");
    await nabizla("deneme", async () => {
      await Promise.resolve();
      try { throw new Error("banka zaman aşımı"); } catch (h) { logger.error(JSON.stringify({ event: "scan_failed", error: (h as Error).message })); }
    });
    await nabizla("deneme", async () => "tamam");
    await nabizla("deneme", async () => { throw new Error("patladı"); });
    expect(kayitlar.map((k) => k.hata)).toEqual([expect.stringContaining("banka zaman aşımı"), null, "patladı"]);
    Logger.overrideLogger(true);
  });
});
