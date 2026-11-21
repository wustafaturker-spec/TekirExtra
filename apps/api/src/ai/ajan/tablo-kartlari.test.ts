import { describe, expect, it } from "vitest";
import { KART_SATIR_SINIRI, tabloKartlariCikar } from "./tablo-kartlari";

const rapor = (satirlar: unknown[], ek: Record<string, unknown> = {}) => JSON.stringify({
  ad: "Satışlar (cari bazında)",
  kolonlar: [{ alan: "cari", baslik: "Cari", tip: "metin" }, { alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "doviz" }, { alan: "adet", baslik: "Adet", tip: "sayi" }, { alan: "doviz", baslik: "Döviz", tip: "metin" }],
  satirlar, satirSayisi: satirlar.length, toplamlar: {}, adres: "/panel/raporlar?rapor=satis-cari", ...ek,
});

describe("AI-117 tablo kartları", () => {
  it("rapor hücrelerini araç çıktısıyla birebir taşır", () => {
    const [k] = tabloKartlariCikar("rapor_calistir", rapor([
      { cari: "Deneme A.Ş.", tutar: "125430.55", adet: 12, doviz: "TRY", gizli: "x" },
      { cari: "Örnek Ltd.", tutar: 9999999999999999.99, adet: "3.5", doviz: "TRY" },
    ]));
    expect(k.baslik).toBe("Satışlar (cari bazında)");
    expect(k.adres).toBe("/panel/raporlar?rapor=satis-cari");
    expect(k.satirlar[0]).toEqual({ cari: "Deneme A.Ş.", tutar: "125430.55", doviz: "TRY", adet: "12" });
    expect(k.satirlar[1].tutar).toBe(String(9999999999999999.99));
    expect(k.satirlar[1].adet).toBe("3.5");
    expect(k.kolonlar.find(c => c.alan === "tutar")).toEqual({ alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "doviz" });
    expect(k.grafik).toEqual({ tur: "cubuk", etiketAlani: "cari", seriler: [{ alan: "tutar", baslik: "Tutar" }], paraBirimi: "TRY" });
  });

  it("ilk 20 satırı gösterir, toplam satır sayısını korur", () => {
    const satirlar = Array.from({ length: 30 }, (_, i) => ({ cari: `Cari ${i}`, tutar: `${i}.00`, doviz: "TRY" }));
    const [k] = tabloKartlariCikar("rapor_calistir", rapor(satirlar, { satirSayisi: 145 }));
    expect(k.satirlar).toHaveLength(KART_SATIR_SINIRI);
    expect(k.satirSayisi).toBe(145);
  });

  it("karışık para biriminde ya da tekrar eden etikette grafik çizmez", () => {
    const [karisik] = tabloKartlariCikar("rapor_calistir", rapor([{ cari: "A", tutar: "1", doviz: "TRY" }, { cari: "B", tutar: "2", doviz: "USD" }]));
    expect(karisik.grafik).toBeUndefined();
    const [tekrar] = tabloKartlariCikar("rapor_calistir", rapor([{ cari: "A", tutar: "1", doviz: "TRY" }, { cari: "A", tutar: "2", doviz: "TRY" }]));
    expect(tekrar.grafik).toBeUndefined();
  });

  it("tarih etiketli seride çizgi grafik seçer", () => {
    const [k] = tabloKartlariCikar("rapor_calistir", JSON.stringify({
      ad: "Aylık satış", kolonlar: [{ alan: "ay", baslik: "Ay", tip: "tarih" }, { alan: "tutar", baslik: "Tutar", tip: "para" }],
      satirlar: [{ ay: "2026-09-01", tutar: "10" }, { ay: "2026-10-01", tutar: "20" }], adres: "/panel/raporlar?rapor=x",
    }));
    expect(k.grafik?.tur).toBe("cizgi");
    expect(k.kolonlar[1].paraBirimi).toBe("TRY");
  });

  it("panel dışı adresi kabul etmez, sayı biçimi dışı değeri boş bırakır", () => {
    const [k] = tabloKartlariCikar("rapor_calistir", rapor([{ cari: "A", tutar: "12abc", doviz: "TRY" }], { adres: "https://kotu.example/panel" }));
    expect(k.adres).toBe("/panel/raporlar");
    expect(k.satirlar[0].tutar).toBeNull();
    const [p] = tabloKartlariCikar("rapor_calistir", rapor([{ cari: "A", tutar: "1", doviz: "TRY" }], { adres: "//kotu.example" }));
    expect(p.adres).toBe("/panel/raporlar");
  });

  it("vadesi geçenlerde alacak ve borç ayrı kart, sayı kaynaktaki toplam sayıdır", () => {
    const kartlar = tabloKartlariCikar("vadesi_gecen_alacaklar", JSON.stringify({
      toplamAlacakTry: "500.00", alacakSayisi: 37, toplamBorcTry: "0", borcSayisi: 0,
      enEskiAlacaklar: [{ faturaId: "f", no: "SF1", cariId: "c", cariUnvan: "Deneme", vadeTarihi: "2026-10-01", gecikmeGun: 51, kalanTry: "500.00", tip: "satis" }],
      enEskiBorclar: [],
    }));
    expect(kartlar).toHaveLength(1);
    expect(kartlar[0].satirSayisi).toBe(37);
    expect(kartlar[0].satirlar[0]).toEqual({ cariUnvan: "Deneme", no: "SF1", vadeTarihi: "2026-10-01", gecikmeGun: "51", kalanTry: "500.00" });
    expect(kartlar[0].grafik).toBeUndefined();
  });

  it("nakit pozisyonu: hesaplar tablosu ve 30 günlük kaynak grafiği", () => {
    const kartlar = tabloKartlariCikar("nakit_pozisyonu", JSON.stringify({
      veri: {
        varliklar: [{ tur: "banka", ad: "Banka · Vadesiz", dovizCinsi: "USD", tutar: "1000.00", tl: "34000.00" }],
        borclar: [{ tur: "kart", ad: "Kart •••• 1234", dovizCinsi: "TRY", tutar: "200.00", tl: "200.00" }],
        kurEksik: [], vadeler: { "30": { kaynaklar: [{ ad: "Fatura vadeleri", giris: 1500.5, cikis: 0 }, { ad: "Maaş", giris: 0, cikis: 900 }] } },
      },
      adres: "/panel/nakit-akisi",
    }));
    expect(kartlar.map(k => k.baslik)).toEqual(["Nakit pozisyonu", "Beklenen giriş ve çıkış (30 gün)"]);
    expect(kartlar[0].satirlar[0]).toEqual({ yon: "Varlık", ad: "Banka · Vadesiz", tutar: "1000.00", dovizCinsi: "USD", tl: "34000.00" });
    expect(kartlar[0].satirlar[1].yon).toBe("Borç");
    expect(kartlar[1].grafik?.seriler.map(s => s.alan)).toEqual(["giris", "cikis"]);
    expect(kartlar[1].satirlar[0].giris).toBe("1500.5");
  });

  it("bütçe: iç içe toplam alanları ve kalem etiketi", () => {
    const [k] = tabloKartlariCikar("butce_karsilastirma", JSON.stringify({
      veri: { yil: 2026, satirlar: [
        { tur: "gider", anaKategori: "Personel", altKategori: "Maaş", toplam: { planBugune: 1000, gerceklesen: 1200.5, fark: 200.5, oran: 120.1, durum: "asim" } },
        { tur: "gelir", anaKategori: "Satış", altKategori: "", toplam: { planBugune: 5000, gerceklesen: 4000, fark: -1000, oran: 80, durum: "eksik" } },
      ] },
      adres: "/panel/butce?yil=2026",
    }));
    expect(k.baslik).toBe("Bütçe karşılaştırması 2026");
    expect(k.satirlar[0]).toMatchObject({ tur: "Gider", kalem: "Personel / Maaş", "toplam.gerceklesen": "1200.5", "toplam.oran": "120.1", "toplam.durum": "asim" });
    expect(k.satirlar[1].kalem).toBe("Satış");
    expect(k.grafik?.tur).toBe("cubuk");
  });

  it("tahsilat öncelikleri ve gider kırılımı", () => {
    const [t] = tabloKartlariCikar("tahsilat_oncelikleri", JSON.stringify({ oncelikler: [{ cariId: "c1", cariUnvan: "A", kalanTry: 10, enEskiGecikmeGun: 3, faturaSayisi: 1, risk: "yuksek", puan: 42.5 }, { cariId: "c2", cariUnvan: "B", kalanTry: 5, enEskiGecikmeGun: -2, faturaSayisi: 2, risk: "orta", puan: 5 }], ekran: "/panel/cari/vade-hatirlatma" }));
    expect(t.satirlar[1].enEskiGecikmeGun).toBe("-2");
    expect(t.grafik?.seriler).toEqual([{ alan: "kalanTry", baslik: "Kalan" }]);
    const [g] = tabloKartlariCikar("gelir_gider", JSON.stringify({ giderKategorileri: [{ anaKategori: "Kira", altKategori: "Ofis", tutar: "15000.00" }], adres: "/panel/raporlar/gelir-gider?baslangic=2026-11-01&bitis=2026-11-21" }));
    expect(g.satirlar[0]).toEqual({ kategori: "Kira / Ofis", tutar: "15000.00" });
    expect(g.grafik).toBeUndefined();
  });

  it("kartsız araçta, bozuk JSON'da ve boş listede kart üretmez", () => {
    expect(tabloKartlariCikar("cari_ara", "{}")).toEqual([]);
    expect(tabloKartlariCikar("rapor_calistir", "bozuk")).toEqual([]);
    expect(tabloKartlariCikar("tahsilat_oncelikleri", JSON.stringify({ oncelikler: [] }))).toEqual([]);
  });
});
