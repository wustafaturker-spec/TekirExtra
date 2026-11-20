import * as ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { LISTE_DOSYASI_ARACI, LISTE_SATIR_SINIRI } from "./liste-dosyasi";
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
    expect(r.not).toContain(String(LISTE_SATIR_SINIRI));
    expect(cagir.mock.calls.length).toBe(Math.ceil((LISTE_SATIR_SINIRI + 1) / 200));
  });

  it("Telegram'da hareket ve cari listesi dosya olarak verilmez", async () => {
    const [arac] = telegramAraclari([{ ...LISTE_DOSYASI_ARACI, calistir: async () => ({ basarili: true }) }]);
    await expect(arac!.calistir({} as never, { ekran: "kasa_banka_hareketleri" })).rejects.toThrow(/Telegram'da/);
    await expect(arac!.calistir({} as never, { ekran: "cariler" })).rejects.toThrow(/Telegram'da/);
    await expect(arac!.calistir({} as never, { ekran: "faturalar" })).resolves.toEqual({ basarili: true });
  });
});
