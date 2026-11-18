import { describe, expect, it } from "vitest";
import { cariIletisimDogrula } from "../ai/ai.dogrulama";
import type { CariIletisimCikarim } from "../ai/ai.semalar";
import { belgeYolu, cariBilgisiYeterli, cariOzeti, cariTaslagi, cariTipSorusu, ibandanBankaAdi, sonrakiCariKodu } from "./cari-belge.kurallari";

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
    ["vergi levhası", { yol: "cari" }],
    ["şirket kartı", { yol: "cari" }],
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
    expect(cariOzeti(t)).toBe("AKN BOYA LİMİTED ŞİRKETİ · VKN 7421126013 · ÇEKİRGE VD · Adres: Üçevler Mahallesi Özkan Sokak Polatoğlu Apartmanı No:5/5 NİLÜFER/BURSA · info@aknboya.com · https://aknboya.com");
    // İl/ilçe adreste zaten yazılıysa yinelenmez.
    expect(cariOzeti({ ...t, faturaAdresi: { adres: "Özkan Sk. No:5/5 Nilüfer / Bursa", il: "BURSA", ilce: "NİLÜFER" } })).toContain("Adres: Özkan Sk. No:5/5 Nilüfer / Bursa ·");
    expect(cariTipSorusu(t).secenekler.map((s) => s.kod)).toEqual(["musteri", "tedarikci", "her_ikisi", "panel"]);
  });

  it("IBAN ve e-fatura mükellefiyeti varsa taslağa ve özete yansır", () => {
    expect(ibandanBankaAdi("TR120006200000012345678901")).toBe("Garanti BBVA");
    expect(ibandanBankaAdi("TR120006400000012345678901")).toBe("İş Bankası");
    expect(ibandanBankaAdi("TR120001000000012345678901")).toBe("Ziraat Bankası");
    expect(ibandanBankaAdi("TR129999900000012345678901")).toBe("Banka Hesabı");

    const t = cariTaslagi(
      {
        ...AKN,
        iban: "TR120006200000012345678901",
        bankaAdi: "Garanti BBVA",
        ticaretSicilNo: "12345-BURSA",
      },
      "C-0043",
      "musteri",
    );
    expect(t.bankaHesaplari).toEqual([
      { iban: "TR120006200000012345678901", bankaAdi: "Garanti BBVA", paraBirimi: "TRY" },
    ]);
    expect(t.ticaretSicilNo).toBe("12345-BURSA");

    const ozet = cariOzeti({ ...t, efaturaMukellefi: true });
    expect(ozet).toContain("⚡ e-Fatura Mükellefi");
    expect(ozet).toContain("🏦 Garanti BBVA (TR1200062...)");
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
