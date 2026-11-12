import { readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { raporTanimlari } from "../../core/raporlar/rapor-kayit";
import { AJAN_ARACLARI } from "./araclar";
import { nakitPozisyonunuSuz, TELEGRAM_KAPALI_ARACLAR, TELEGRAM_RAPOR_KARARI, telegramAraclari } from "./telegram-veri-kapisi";

/** Bütün `*.raporlar.ts` dosyaları yüklenir: kayıt defteri uygulamadaki raporların tamamını taşır. */
function raporDosyalari(dizin: string): string[] {
  return readdirSync(dizin, { withFileTypes: true }).flatMap((g) => {
    const yol = join(dizin, g.name);
    return g.isDirectory() ? raporDosyalari(yol) : g.name.endsWith(".raporlar.ts") ? [yol] : [];
  });
}

beforeAll(async () => {
  for (const dosya of raporDosyalari(join(__dirname, "../.."))) await import(dosya);
});

const arac = (ad: string) => telegramAraclari(AJAN_ARACLARI).find((a) => a.ad === ad)!;
const baglam = {} as never;

describe("Telegram veri kapısı (CNL-05)", () => {
  it("her kayıtlı rapor için Telegram kararı verilmiştir; tabloda olmayan rapor kalmaz", () => {
    const kodlar = raporTanimlari().map((r) => r.kod).sort();
    expect(kodlar.length).toBeGreaterThan(20);
    expect(kodlar.filter((k) => !TELEGRAM_RAPOR_KARARI[k])).toEqual([]);
    expect(Object.keys(TELEGRAM_RAPOR_KARARI).filter((k) => !kodlar.includes(k))).toEqual([]);
  });

  it("bordro ve kişiye ödeme döndüren araçlar Telegram'da sunulmaz", () => {
    const adlar = new Set(telegramAraclari(AJAN_ARACLARI).map((a) => a.ad));
    for (const ad of TELEGRAM_KAPALI_ARACLAR) {
      expect(AJAN_ARACLARI.some((a) => a.ad === ad)).toBe(true);
      expect(adlar.has(ad)).toBe(false);
    }
  });

  it("kapalı rapor çalıştırılmaz ve katalogda görünmez", async () => {
    const calistir = arac("rapor_calistir");
    await expect(calistir.calistir(baglam, { kod: "kasa_banka.nakit_akisi" })).rejects.toThrow(/Telegram'da çalıştırılmaz/);
    await expect(calistir.calistir(baglam, { kod: "yok.boyle" })).rejects.toThrow(/Telegram'da çalıştırılmaz/);
    const asil = AJAN_ARACLARI.find((a) => a.ad === "rapor_katalogu")!;
    const sahte = { ...asil, calistir: async () => ({ raporlar: [{ kod: "cari.ekstre" }, { kod: "fatura.satis-kirilimlari" }, { kod: "yeni.rapor" }] }) };
    const sonuc = (await telegramAraclari([sahte])[0].calistir(baglam, {})) as { raporlar: Array<{ kod: string }> };
    expect(sonuc.raporlar.map((r) => r.kod)).toEqual(["fatura.satis-kirilimlari"]);
  });

  it("personel carisi aranmaz, listelenmez, açılmaz", async () => {
    const asilAra = AJAN_ARACLARI.find((a) => a.ad === "cari_ara")!;
    const asilGetir = AJAN_ARACLARI.find((a) => a.ad === "cari_getir")!;
    const [ara] = telegramAraclari([{ ...asilAra, calistir: async () => ({ kayitlar: [{ id: "1", tip: "musteri" }, { id: "2", tip: "personel" }] }) }]);
    const [getir] = telegramAraclari([{ ...asilGetir, calistir: async () => ({ id: "2", tip: "personel", bakiyeler: [] }) }]);
    expect(((await ara.calistir(baglam, {})) as { kayitlar: unknown[] }).kayitlar).toEqual([{ id: "1", tip: "musteri" }]);
    await expect(ara.calistir(baglam, { tip: "personel" })).rejects.toThrow(/Personel carileri/);
    await expect(getir.calistir(baglam, { cariId: "2" })).rejects.toThrow(/Personel carileri/);
  });

  it("nakit pozisyonundan maaş ve bordro yasal kalemleri çıkar, toplamlar kalır", () => {
    const sonuc = nakitPozisyonunuSuz({
      toplamTl: { net: "100" },
      vadeler: { "7": { giris: 10, cikis: 50, net: -40, kaynaklar: [{ ad: "Maaş", cikis: 30 }, { ad: "bordro_yasal", cikis: 5 }, { ad: "Fatura vadeleri", cikis: 15 }], kalemler: [{ kaynak: "Maaş", tutar: 30, aciklama: "Ahmet" }, { kaynak: "Fatura vadeleri", tutar: 15 }] } },
    }) as { vadeler: { "7": { cikis: number; kaynaklar: Array<{ ad: string }>; kalemler: Array<{ kaynak: string }> } }; not?: string };
    expect(sonuc.vadeler["7"].kaynaklar.map((k) => k.ad)).toEqual(["Fatura vadeleri"]);
    expect(sonuc.vadeler["7"].kalemler.map((k) => k.kaynak)).toEqual(["Fatura vadeleri"]);
    expect(sonuc.vadeler["7"].cikis).toBe(50);
    expect(sonuc.not).toMatch(/Maaş/);
    expect(nakitPozisyonunuSuz({ vadeler: null })).toEqual({ vadeler: null });
  });
});
