import * as ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { ARKA_PLAN_SATIR_SINIRI, LISTE_DOSYASI_ARACI, LISTE_SATIR_SINIRI } from "./liste-dosyasi";
import { telegramAraclari } from "../telegram-veri-kapisi";

const HESAP = "ad4e5162-7e8f-4091-b2a3-b4c53d4e5f60";

function baglam(sayfalar: Array<{ kayitlar: unknown[]; sonrakiImlec: string | null }>) {
  let i = 0;
  const cagir = vi.fn(async () => sayfalar[Math.min(i++, sayfalar.length - 1)]);
  return { b: { uc: { cagir } as never, kaynak: "asistan" as const, arac: "liste_dosyasi" }, cagir };
}

describe("liste dosyası (AI-118)", () => {
  it("fatura listesini süzgeçlerle imleç imleç okur ve Excel yazar; içerik modele gitmez", async () => {
    const f = (no: string) => ({ id: no, no, tarih: "2026-11-05T00:00:00.000Z", tip: "satis", durum: "kesin", genelToplam: "1250.50", dovizCinsi: "TRY", cari: { unvan: "Deneme A.Ş." } });
    const { b, cagir } = baglam([{ kayitlar: [f("F1"), f("F2")], sonrakiImlec: "F2" }, { kayitlar: [f("F3")], sonrakiImlec: null }]);
    const r = (await LISTE_DOSYASI_ARACI.calistir(b, { ekran: "faturalar", suzgecler: { yon: "satis", durum: "kesin" } })) as Record<string, any>;
    expect(cagir).toHaveBeenCalledTimes(2);
    expect(cagir.mock.calls[0]![1]).toEqual([undefined, undefined, "kesin", undefined, "200", "satis", undefined, undefined, undefined, undefined, undefined]);
    expect((cagir.mock.calls[1]![1] as unknown[])[3]).toBe("F2");
    expect(r).toMatchObject({ basarili: true, satirSayisi: 3 });
    expect(JSON.stringify({ ...r, _dosya: undefined })).not.toContain("Deneme");
    const kitap = new ExcelJS.Workbook();
    await kitap.xlsx.load(r._dosya.tampon);
    const metin = JSON.stringify(kitap.worksheets[0]!.getSheetValues());
    expect(metin).toContain("F3");
    expect(metin).toContain("Deneme A.Ş.");
  });

  it("hesap süzgeci kasa/banka kimliğine çevrilir", async () => {
    const { b, cagir } = baglam([{ kayitlar: [], sonrakiImlec: null }]);
    await LISTE_DOSYASI_ARACI.calistir(b, { ekran: "kasa_banka_hareketleri", suzgecler: { hesap: `banka:${HESAP}`, baslangic: "2026-10-01" } });
    expect(cagir.mock.calls[0]![1]).toEqual([{ bankaHesapId: HESAP, baslangic: "2026-10-01", bitis: undefined, tur: undefined, arama: undefined, imlec: undefined, adet: "200" }]);
  });

  it("satır sınırı aşılırsa dosya hazırlanmaz, daraltma istenir", async () => {
    const dolu = { kayitlar: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })), sonrakiImlec: "x" };
    const { b, cagir } = baglam([dolu]);
    const r = (await LISTE_DOSYASI_ARACI.calistir(b, { ekran: "masraflar" })) as Record<string, any>;
    expect(r._dosya).toBeUndefined();
    expect(r.not).toContain(LISTE_SATIR_SINIRI.toLocaleString("tr-TR"));
    expect(r.not).toContain("Arka planda");
    expect(cagir.mock.calls.length).toBe(Math.ceil((LISTE_SATIR_SINIRI + 1) / 200));
  });

  it("arka plan görevinde sınır 50.000: 5.000'i aşan liste dosyaya yazılır", async () => {
    const sayfa = (n: number, son: boolean) => ({ kayitlar: Array.from({ length: n }, (_, i) => ({ id: String(i), toplam: "1.00", dovizCinsi: "TRY" })), sonrakiImlec: son ? null : "x" });
    const sayfalar = [...Array.from({ length: 30 }, () => sayfa(200, false)), sayfa(10, true)];
    const { b, cagir } = baglam(sayfalar);
    const r = (await LISTE_DOSYASI_ARACI.calistir({ ...b, arkaPlan: true }, { ekran: "masraflar" })) as Record<string, any>;
    expect(cagir).toHaveBeenCalledTimes(31);
    expect(r).toMatchObject({ basarili: true, satirSayisi: 6010 });
    expect(ARKA_PLAN_SATIR_SINIRI).toBe(50_000);
  });

  it("Telegram'da büyük liste notu 'Arka planda' önermez", async () => {
    const [arac] = telegramAraclari([{ ...LISTE_DOSYASI_ARACI, calistir: async () => ({ basarili: false, not: 'Liste 5.000 satırı aşıyor; dosya hazırlanmadı. Kullanıcıya iki yol söyle: süzgeci daraltmak veya "Arka planda" ile göndermek.' }) }]);
    const r = (await arac!.calistir({} as never, { ekran: "masraflar" })) as { not: string };
    expect(r.not).not.toContain("Arka planda");
    expect(r.not).toContain("daraltmasını iste");
  });

  it("gelen e-Fatura kutusu imleçle okunur, ekranın süzgeç adlarıyla", async () => {
    const g = { id: "g1", belgeNo: "ABC2026000000001", tarih: "2026-11-03", gonderenUnvan: "Tedarikçi Ltd.", gonderenVkn: "1234567890", profilId: "TICARIFATURA", durum: "beklemede", yanit: null, fatura: null, genelToplam: "980.00", dovizCinsi: "TRY" };
    const { b, cagir } = baglam([{ kayitlar: [g], sonrakiImlec: null }]);
    const r = (await LISTE_DOSYASI_ARACI.calistir(b, { ekran: "gelen_efatura", suzgecler: { durum: "beklemede", arama: "tedarik" } })) as Record<string, any>;
    expect(cagir.mock.calls[0]![1]).toEqual([{ durum: "beklemede", arama: "tedarik", adet: "200" }]);
    expect(r).toMatchObject({ basarili: true, satirSayisi: 1 });
    const kitap = new ExcelJS.Workbook();
    await kitap.xlsx.load(r._dosya.tampon);
    expect(JSON.stringify(kitap.worksheets[0]!.getSheetValues())).toContain("ABC2026000000001");
  });

  it("banka ekstresi dizi döndüren uçtan okunur; ekran sınırında kesildiği dosyada ve mesajda yazılır", async () => {
    const satir = (i: number) => ({ id: String(i), tarih: "2026-11-02", tutar: "-150.00", yon: "tediye", aciklama: `EFT ${i}`, karsiUnvan: "Kira", dekontNo: null, durum: "beklemede", cari: null, bankaHesap: { ad: "Vadesiz", dovizCinsi: "TRY" } });
    const cagir = vi.fn(async () => Array.from({ length: 1000 }, (_, i) => satir(i)));
    const b = { uc: { cagir } as never, kaynak: "asistan" as const, arac: "liste_dosyasi" };
    const r = (await LISTE_DOSYASI_ARACI.calistir(b, { ekran: "banka_ekstresi", suzgecler: { bankaHesabi: HESAP, yon: "tediye", baslangic: "2026-11-01" } })) as Record<string, any>;
    expect(cagir).toHaveBeenCalledTimes(1);
    expect(cagir.mock.calls[0]![1]).toEqual([undefined, HESAP, undefined, "2026-11-01", undefined, "tediye"]);
    expect(r.satirSayisi).toBe(1000);
    expect(r.mesaj).toContain("en çok 1000 satır");
    const kitap = new ExcelJS.Workbook();
    await kitap.xlsx.load(r._dosya.tampon);
    const metin = JSON.stringify(kitap.worksheets[0]!.getSheetValues());
    expect(metin).toContain("EFT 999");
    expect(metin).toContain("en çok 1000 satır");
  });

  it("Telegram'da hareket ve cari listesi dosya olarak verilmez", async () => {
    const [arac] = telegramAraclari([{ ...LISTE_DOSYASI_ARACI, calistir: async () => ({ basarili: true }) }]);
    await expect(arac!.calistir({} as never, { ekran: "kasa_banka_hareketleri" })).rejects.toThrow(/Telegram'da/);
    await expect(arac!.calistir({} as never, { ekran: "cariler" })).rejects.toThrow(/Telegram'da/);
    await expect(arac!.calistir({} as never, { ekran: "banka_ekstresi" })).rejects.toThrow(/Telegram'da/);
    await expect(arac!.calistir({} as never, { ekran: "faturalar" })).resolves.toEqual({ basarili: true });
  });
});
