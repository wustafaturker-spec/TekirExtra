import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { fisleriUret, HesapCozucu, type Fis, type FaturaGirdisi, type HareketGirdisi, type UreticiGirdisi } from "./fis-uretici";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

function girdi(ek: Partial<UreticiGirdisi> = {}): UreticiGirdisi {
  return {
    hesapKodlari: {},
    cariler: new Map([
      ["m", { id: "m", kod: "M001", unvan: "Müşteri A.Ş.", tip: "musteri", muhasebeKodu: null }],
      ["t", { id: "t", kod: "T001", unvan: "Tedarikçi Ltd.", tip: "tedarikci", muhasebeKodu: "320.05.9" }],
    ]),
    hesaplar: new Map([
      ["kasa:k", { tur: "kasa", id: "k", ad: "Merkez Kasa", dovizCinsi: "TRY", sira: 1, muhasebeKodu: null }],
      ["banka:b", { tur: "banka", id: "b", ad: "Ziraat", dovizCinsi: "TRY", sira: 1, muhasebeKodu: "102.01.010" }],
      ["banka:u", { tur: "banka", id: "u", ad: "Ziraat USD", dovizCinsi: "USD", sira: 2, muhasebeKodu: null }],
      ["kredi:kr", { tur: "kredi", id: "kr", ad: "Ticari kredi", dovizCinsi: "TRY", sira: 1, muhasebeKodu: null }],
    ]),
    faturalar: [], hareketler: [], ekHareketler: new Map(), masraflar: [], tumMasraflar: new Map(), gelirler: [], tumGelirler: new Map(),
    cekler: [], tumCekler: new Map(), kartHareketleri: [], ekKartHareketleri: new Map(), dovizIslemleri: [],
    baslangic: "2026-09-01", bitis: "2026-09-30",
    ...ek,
  };
}

const fatura = (ek: Partial<FaturaGirdisi>): FaturaGirdisi => ({
  id: "f", no: "SNC1", tip: "satis", tarih: "2026-09-10", cariId: "m", dovizCinsi: "TRY", kur: D(1),
  toplamMatrah: D(1000), toplamKdv: D(200), toplamNetKdv: D(200), toplamTevkifat: D(0), genelToplam: D(1200),
  ihracat: false, ihracKayitli: false, kurFarki: false, satirlar: [{ matrah: D(1000), stokTipi: "urun" }], ...ek,
});

const hareket = (ek: Partial<HareketGirdisi>): HareketGirdisi => ({
  id: "h", tip: "tahsilat", tarih: "2026-09-12", tutar: D(1200), tutarTry: D(1200), dovizCinsi: "TRY", kur: D(1), aciklama: null, makbuzNo: "TM1",
  kaynakTur: "manuel", kaynakRef: null, hesap: { tur: "kasa", id: "k" }, karsiHareketId: null, cariId: null, faturaId: null, faturaTipi: null,
  faturaKarsiligi: null, faturaDovizi: null, masrafId: null, gelirId: null, kartId: null, ...ek,
});

const ozet = (f: Fis) => f.satirlar.map((s) => `${s.hesapKodu} ${s.borc.gt(0) ? "B" : "A"} ${s.borc.add(s.alacak).toFixed(2)}`);
const dengeli = (f: Fis) => f.satirlar.reduce((t, s) => t.add(s.borc).sub(s.alacak), D(0)).isZero();

describe("muhasebe fiş üretici (MUH-04)", () => {
  it("dövizli satış faturası TL'ye kuruyla çevrilir, cari satırı dövizini taşır", () => {
    const { fisler, kontroller } = fisleriUret(girdi({ faturalar: [fatura({ dovizCinsi: "USD", kur: D("40.1234"), toplamMatrah: D("1000"), toplamKdv: D("200"), toplamNetKdv: D("200"), genelToplam: D("1200") })] }));
    expect(kontroller).toEqual([]);
    expect(ozet(fisler[0])).toEqual(["120.01.M001 B 48148.08", "600 A 40123.40", "391 A 8024.68"]);
    expect(fisler[0].satirlar[0].doviz).toMatchObject({ cins: "USD" });
    expect(dengeli(fisler[0])).toBe(true);
  });

  it("tevkifatlı alışta 191 tamamı, cariye net, tevkifat 360; hizmet satırı 770", () => {
    const f = fatura({ tip: "alis", cariId: "t", toplamMatrah: D(1000), toplamKdv: D(200), toplamTevkifat: D(100), genelToplam: D(1100), satirlar: [{ matrah: D(600), stokTipi: "urun" }, { matrah: D(400), stokTipi: "hizmet" }] });
    const { fisler } = fisleriUret(girdi({ faturalar: [f] }));
    // Cari kodu 320.05.9 olarak kayıtlı; alış tarafında olduğu gibi kullanılır.
    expect(ozet(fisler[0])).toEqual(["153 B 600.00", "770 B 400.00", "191 B 200.00", "320.05.9 A 1100.00", "360 A 100.00"]);
  });

  it("satış iadesi 610 ve 391 borç, cari alacak; firmanın kod düzeltmesi uygulanır", () => {
    const { fisler } = fisleriUret(girdi({ hesapKodlari: { satis_iade: "610.01" }, faturalar: [fatura({ tip: "satis_iade" })] }));
    expect(ozet(fisler[0])).toEqual(["120.01.M001 A 1200.00", "610.01 B 1000.00", "391 B 200.00"]);
  });

  it("cari alt hesabı öbür tarafta ana hesabı değiştirilerek kullanılır", () => {
    const c = new HesapCozucu(girdi());
    expect(c.cari("t", "satici")).toBe("320.05.9");
    expect(c.cari("t", "alici")).toBe("120.05.9");
    expect(c.hesap("kasa", "k")).toBe("100.01.001");
    expect(c.hesap("banka", "b")).toBe("102.01.010");
  });

  it("faturaya bağlı tahsilat carinin alıcı hesabını kapatır; kasa fişi tahsil türündedir", () => {
    const { fisler } = fisleriUret(girdi({ hareketler: [hareket({ cariId: "t", faturaId: "f", faturaTipi: "satis" })] }));
    expect(fisler[0].tur).toBe("tahsil");
    expect(ozet(fisler[0])).toEqual(["100.01.001 B 1200.00", "120.05.9 A 1200.00"]);
  });

  it("farklı dövizle kapamada cari satırı faturanın dövizindeki karşılığı taşır", () => {
    const h = hareket({ hesap: { tur: "banka", id: "b" }, cariId: "m", faturaTipi: "satis", tutar: D(49200), tutarTry: D(49200), faturaKarsiligi: D(1200), faturaDovizi: "USD" });
    const { fisler } = fisleriUret(girdi({ hareketler: [h] }));
    expect(fisler[0].satirlar[1].doviz).toMatchObject({ cins: "USD", tutar: D(1200), kur: D(41) });
  });

  it("stopajlı masraf 360'a, ödemesi aynı karşı hesabı (329) kapatır", () => {
    const m = { id: "ms", tarih: "2026-09-05", belgeNo: "K1", aciklama: null, saticiUnvan: "Ev sahibi", kategoriAd: "Kira", kategoriKodu: "770.10", cariId: null, matrah: D(10000), kdvTutari: D(0), toplam: D(10000), stopajTutari: D(2000), kur: D(1), dovizCinsi: "TRY" };
    const odeme = hareket({ id: "o", tip: "tediye", tutar: D(8000), tutarTry: D(8000), masrafId: "ms", kaynakTur: "masraf" });
    const { fisler, kontroller } = fisleriUret(girdi({ masraflar: [m], tumMasraflar: new Map([["ms", m]]), hareketler: [odeme] }));
    expect(kontroller).toEqual([]);
    const [masraf, odemeFisi] = [fisler.find((f) => f.kaynak.tur === "masraf")!, fisler.find((f) => f.kaynak.tur === "hareket")!];
    expect(ozet(masraf)).toEqual(["770.10 B 10000.00", "329 A 8000.00", "360 A 2000.00"]);
    expect(ozet(odemeFisi)).toEqual(["329 B 8000.00", "100.01.001 A 8000.00"]);
  });

  it("virman tek fiş; ters kayıt asıl fişin aynasıdır", () => {
    const gidis = hareket({ id: "v1", tip: "virman_gidis", tutar: D(500), tutarTry: D(500), karsiHareketId: "v2", makbuzNo: null });
    const gelis = hareket({ id: "v2", tip: "virman_gelis", tutar: D(500), tutarTry: D(500), hesap: { tur: "banka", id: "b" }, karsiHareketId: "v1", makbuzNo: null });
    const asil = hareket({ id: "a", cariId: "m", tarih: "2026-08-20" });
    const ters = hareket({ id: "tk", tip: "tediye", kaynakTur: "ters_kayit", kaynakRef: "a", tarih: "2026-09-20", makbuzNo: null });
    const { fisler } = fisleriUret(girdi({ hareketler: [gidis, gelis, ters], ekHareketler: new Map([["v1", gidis], ["v2", gelis], ["a", asil]]) }));
    expect(fisler).toHaveLength(2);
    expect(ozet(fisler.find((f) => f.kaynak.id === "v1")!)).toEqual(["102.01.010 B 500.00", "100.01.001 A 500.00"]);
    const tersFis = fisler.find((f) => f.kaynak.id === "tk")!;
    expect(tersFis.tarih).toBe("2026-09-20");
    expect(ozet(tersFis)).toEqual(["100.01.001 A 1200.00", "120.01.M001 B 1200.00"]);
  });

  it("alınan çek girişi 101'i, cirosu satıcıyı borçlandırır; geri alınan olay ve tahsil fişlenmez", () => {
    const cek = {
      id: "c", tur: "cek" as const, yon: "alinan" as const, portfoyNo: "P1", cekNo: "123", tutar: D(5000), tutarTry: D(5000), kur: D(1), dovizCinsi: "TRY", cariId: "m", ciroCariId: "t",
      olaylar: [
        { id: "o1", oncekiDurum: null, yeniDurum: "portfoyde", tarih: "2026-09-01", gecerli: true },
        { id: "o2", oncekiDurum: "portfoyde", yeniDurum: "karsiliksiz", tarih: "2026-09-02", gecerli: false },
        { id: "o3", oncekiDurum: "portfoyde", yeniDurum: "ciro_edildi", tarih: "2026-09-03", gecerli: true },
      ],
    };
    const { fisler } = fisleriUret(girdi({ cekler: [cek], tumCekler: new Map([["c", cek]]) }));
    expect(fisler.map(ozet)).toEqual([["101 B 5000.00", "120.01.M001 A 5000.00"], ["320.05.9 B 5000.00", "101 A 5000.00"]]);
  });

  it("carisi ve bağı olmayan elle fiş kontrol listesine düşer", () => {
    const { fisler, kontroller } = fisleriUret(girdi({ hareketler: [hareket({})] }));
    expect(fisler[0].satirlar[1].hesapKodu).toBe("");
    expect(kontroller.map((k) => k.mesaj)).toContain("Carisi ve bağlı kaydı olmayan fişin karşı hesabı belirlenemedi");
  });

  it("döviz alım/satımında fark kambiyo kârı olarak 646'ya gider", () => {
    const d = {
      id: "d", tarih: "2026-09-15", aciklama: null,
      cikan: { hesap: { tur: "banka" as const, id: "u" }, tutar: D(100), doviz: "USD", kur: D(40), tl: D(4000) },
      giren: { hesap: { tur: "banka" as const, id: "b" }, tutar: D(4100), doviz: "TRY", kur: D(1), tl: D(4100) },
    };
    const { fisler } = fisleriUret(girdi({ dovizIslemleri: [d] }));
    expect(ozet(fisler[0])).toEqual(["102.01.010 B 4100.00", "102.01.002 A 4000.00", "646 A 100.00"]);
  });

  it("kredi kullanımı 300/400'e ayrışır, tahsis ücreti 329; taksit anapara + faiz", () => {
    const kullanim = hareket({ id: "ku", hesap: { tur: "banka", id: "b" }, tutar: D(99000), tutarTry: D(99000), kaynakTur: "banka_kredisi", kaynakRef: "kr", makbuzNo: null,
      kredi: { id: "kr", tip: "kullanim", anapara: D(100000), uzunVadeli: D(40000), masraf: D(1000), finansman: D(0) } });
    const taksit = hareket({ id: "ta", tip: "tediye", hesap: { tur: "banka", id: "b" }, tutar: D(9450), tutarTry: D(9450), kaynakTur: "banka_kredisi", kaynakRef: "kr", makbuzNo: null,
      kredi: { id: "kr", tip: "taksit", anapara: D(6300), uzunVadeli: D(0), masraf: D(0), finansman: D(3150) } });
    const { fisler, kontroller } = fisleriUret(girdi({ hareketler: [kullanim, taksit] }));
    expect(kontroller).toEqual([]);
    expect(ozet(fisler.find((f) => f.kaynak.id === "ku")!)).toEqual(["102.01.010 B 99000.00", "329 B 1000.00", "300.01.001 A 60000.00", "400.01.001 A 40000.00"]);
    expect(ozet(fisler.find((f) => f.kaynak.id === "ta")!)).toEqual(["300.01.001 B 6300.00", "329 B 3150.00", "102.01.010 A 9450.00"]);
  });
});
