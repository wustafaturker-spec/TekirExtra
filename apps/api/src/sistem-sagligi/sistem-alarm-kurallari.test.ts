import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { NabizLogger, nabizKaydediciAyarla, nabizla, type NabizSonucu } from "../core/nabiz/nabiz";
import { saatlikAtlama, sorunlariBul, type AlarmGirdisi } from "./sistem-alarm-kurallari";

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

  it("BLD-12: art arda 2 uzun tur ya da son 1 saatte atlanan tur alarm; tek uzun tur, eski atlama ve aralıksız iş alarm değil", () => {
    const is = { isAdi: "bildirim-zamanlayici", ardisikHata: 0, sonHata: null, aralikMs: 300_000, sonSureMs: 260_000 };
    expect(sorunlariBul({ ...bos, isler: [{ ...is, ardisikUzun: 1 }] })).toEqual([]);
    expect(sorunlariBul({ ...bos, isler: [{ ...is, ardisikUzun: 5, aralikMs: null }] })).toEqual([]);
    expect(sorunlariBul({ ...bos, isler: [{ ...is, ardisikUzun: 0, sonAtlamaAt: once(61) }] })).toEqual([]);
    const uzun = sorunlariBul({ ...bos, isler: [{ ...is, ardisikUzun: 2 }] });
    expect(uzun).toEqual([{ anahtar: "is-asim:bildirim-zamanlayici", tur: "zamanlayici_asim", ozet: "bildirim-zamanlayici kendi aralığına sığmıyor (aralık 5 dk): art arda 2 turda süre aralığın %80'ini aştı (son tur 4.3 dk)." }]);
    const atlama = sorunlariBul({ ...bos, isler: [{ ...is, ardisikUzun: 0, sonAtlamaAt: once(10), atlamaPencereAt: once(40), pencereAtlama: 3 }] });
    expect(atlama[0].ozet).toContain("son 1 saatte 3 tur atlandı");
  });

  it("BLD-12: saatlik atlama sayısı penceresi eskiyse en az son atlamayı sayar", () => {
    const t = simdi.getTime();
    expect(saatlikAtlama({ sonAtlamaAt: once(5), atlamaPencereAt: once(70), pencereAtlama: 9 }, t)).toBe(1);
    expect(saatlikAtlama({ sonAtlamaAt: once(5), atlamaPencereAt: once(30), pencereAtlama: 4 }, t)).toBe(4);
    expect(saatlikAtlama({ sonAtlamaAt: once(90), atlamaPencereAt: once(95), pencereAtlama: 4 }, t)).toBe(0);
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

  it("BLD-12: önceki tur sürerken gelen tetik işi çalıştırmaz, atlandı diye ve aralıkla kaydedilir", async () => {
    const kayitlar: NabizSonucu[] = [];
    nabizKaydediciAyarla(async (s) => { kayitlar.push(s); });
    let bitir!: () => void;
    let calisma = 0;
    const is = () => { calisma++; return new Promise<void>((r) => { bitir = r; }); };
    const ilk = nabizla("uzun", is, 300_000);
    await nabizla("uzun", is, 300_000);
    await nabizla("baska", async () => undefined, 60_000);
    bitir();
    await ilk;
    await nabizla("uzun", async () => { calisma++; }, 300_000);
    expect(calisma).toBe(2);
    expect(kayitlar.map((k) => [k.ad, k.atlandi ?? false, k.aralikMs])).toEqual([["uzun", true, 300_000], ["baska", false, 60_000], ["uzun", false, 300_000], ["uzun", false, 300_000]]);
  });
});
