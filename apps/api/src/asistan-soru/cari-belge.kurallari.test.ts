import { describe, expect, it } from "vitest";
import { cariIletisimDogrula } from "../ai/ai.dogrulama";
import type { CariIletisimCikarim } from "../ai/ai.semalar";
import { belgeYolu, cariBilgisiYeterli, cariOzeti, cariTaslagi, cariTipSorusu, sonrakiCariKodu } from "./cari-belge.kurallari";

/** Kullanıcının Telegram'dan gönderdiği cari bilgi kartı (CNL-23 kabul örneği). */
const AKN: CariIletisimCikarim = {
  unvan: "AKN BOYA LİMİTED ŞİRKETİ", kisiTipi: "tuzel", vknTckn: "742 112 60 13", vergiDairesi: "ÇEKİRGE",
  eposta: "Info@aknboya.com", webSitesi: "aknboya.com", adres: "Üçevler Mahallesi Özkan Sokak Polatoğlu Apartmanı No:5/5",
  il: "BURSA", ilce: "NİLÜFER", guvenSkoru: 0.9,
};

describe("CNL-23 Telegram görsel yolu", () => {
  it.each([
    ["cari aç", { yol: "cari" }],
    ["Bu müşteri kartını ekle", { yol: "cari", tip: "musteri" }],
    ["yeni tedarikçi", { yol: "cari", tip: "tedarikci" }],
    ["hem müşteri hem tedarikçi carisi", { yol: "cari", tip: "her_ikisi" }],
    ["kartvizit", { yol: "cari" }],
    ["CARİ AÇ", { yol: "cari" }],
    ["benzin fişi", { yol: "masraf" }],
    ["", { yol: "masraf" }],
    [null, { yol: "masraf" }],
    ["kariyer", { yol: "masraf" }],
  ])("%s → %j", (aciklama, beklenen) => expect(belgeYolu(aciklama)).toEqual(beklenen));
});

describe("CNL-23 cari bilgisi", () => {
  it("boşluklu VKN rakamlara indirgenir, e-posta küçülür, web sitesi tam adres olur", () => {
    const d = cariIletisimDogrula(AKN);
    expect(d.veri).toMatchObject({ vknTckn: "7421126013", eposta: "info@aknboya.com", webSitesi: "https://aknboya.com" });
    expect(d.uyarilar).toEqual([]);
  });
  it("kontrol hanesi ya da uzunluğu tutmayan kimlik boş bırakılır ve uyarılır", () => {
    const bozuk = cariIletisimDogrula({ ...AKN, vknTckn: "742 112 60 14" });
    expect(bozuk.veri.vknTckn).toBeNull();
    expect(bozuk.uyarilar.join(" ")).toContain("kontrol hanesi tutmuyor");
    expect(cariIletisimDogrula({ ...AKN, vknTckn: "12345" }).veri.vknTckn).toBeNull();
  });
  it("unvan ile VKN, vergi dairesi ya da e-postadan biri yeterlidir", () => {
    expect(cariBilgisiYeterli({ unvan: "AKN", vknTckn: null, vergiDairesi: null, eposta: "a@b.co" })).toBe(true);
    expect(cariBilgisiYeterli({ unvan: "AKN", vknTckn: null, vergiDairesi: "  ", eposta: null })).toBe(false);
    expect(cariBilgisiYeterli({ unvan: " ", vknTckn: "7421126013", vergiDairesi: null, eposta: null })).toBe(false);
  });
  it("taslak bütün okunan alanları taşır; adres fatura adresi olur", () => {
    const t = cariTaslagi(cariIletisimDogrula(AKN).veri, "C-0042", "musteri");
    expect(t).toEqual({
      kod: "C-0042", unvan: "AKN BOYA LİMİTED ŞİRKETİ", tip: "musteri", kisiTipi: "tuzel", vknTckn: "7421126013", vergiDairesi: "ÇEKİRGE",
      eposta: "info@aknboya.com", webSitesi: "https://aknboya.com",
      faturaAdresi: { adres: "Üçevler Mahallesi Özkan Sokak Polatoğlu Apartmanı No:5/5", il: "BURSA", ilce: "NİLÜFER" },
    });
    expect(cariOzeti(t)).toBe("AKN BOYA LİMİTED ŞİRKETİ · VKN 7421126013 · ÇEKİRGE VD · NİLÜFER/BURSA · info@aknboya.com · https://aknboya.com");
    expect(cariTipSorusu(t).secenekler.map((s) => s.kod)).toEqual(["musteri", "tedarikci", "her_ikisi", "panel"]);
  });
});

describe("CNL-23 cari kodu önerisi", () => {
  it("en çok kullanılan kalıpta sıradaki kod, aynı genişlikte", () => {
    expect(sonrakiCariKodu(["C-0001", "C-0041", "C-0007", "TED-9"])).toBe("C-0042");
    expect(sonrakiCariKodu(["120.01.001", "120.01.002"])).toBe("120.01.003");
  });
  it("kalıp yoksa CARI-001; kullanılan kod atlanır", () => {
    expect(sonrakiCariKodu([])).toBe("CARI-001");
    expect(sonrakiCariKodu(["ABC"])).toBe("CARI-001");
    expect(sonrakiCariKodu(["M1", "M2", "M3", "X-M4"])).toBe("M4");
  });
});
