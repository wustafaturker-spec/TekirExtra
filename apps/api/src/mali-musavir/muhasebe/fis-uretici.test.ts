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

  it("stok maliyetine dağıtılmış hizmet satırı ve masraf 153'e gider (STK-40)", () => {
    const f = fatura({ tip: "alis", cariId: "t", satirlar: [{ matrah: D(600), stokTipi: "urun" }, { matrah: D(400), stokTipi: "hizmet", stokaDagitildi: true }] });
    const masraf = { id: "ms", tarih: "2026-09-11", belgeNo: "N1", aciklama: null, saticiUnvan: "Nakliyeci", kategoriAd: "Nakliye", kategoriKodu: "760.01", cariId: null, matrah: D(100), kdvTutari: D(20), toplam: D(120), stopajTutari: null, kur: D(1), dovizCinsi: "TRY", stokaDagitildi: true };
    const { fisler } = fisleriUret(girdi({ faturalar: [f], masraflar: [masraf], tumMasraflar: new Map([["ms", masraf]]) }));
    expect(ozet(fisler[0]).slice(0, 1)).toEqual(["153 B 1000.00"]);
    expect(ozet(fisler.find((x) => x.kaynak.tur === "masraf")!)[0]).toBe("153 B 100.00");
  });

  it("KDV dışı vergi satırın hesabına, stopaj 360'a (EBLG-120)", () => {
    // Ürün 1000 + ÖTV 250 → 153 1250, KDV 250; hizmet 500 − GV stopajı 50 → 770 500, 360 A 50; cari 1250+250+500+100−50 = 2050.
    const f = fatura({ tip: "alis", cariId: "t", toplamMatrah: D(1500), toplamKdv: D(350), toplamNetKdv: D(350), toplamStopaj: D(50), genelToplam: D(2050),
      satirlar: [{ matrah: D(1000), ekVergi: D(250), stokTipi: "urun" }, { matrah: D(500), stokTipi: "hizmet" }] });
    const { fisler, kontroller } = fisleriUret(girdi({ faturalar: [f] }));
    expect(kontroller).toEqual([]);
    expect(ozet(fisler[0])).toEqual(["153 B 1250.00", "770 B 500.00", "191 B 350.00", "320.05.9 A 2050.00", "360 A 50.00"]);
    expect(dengeli(fisler[0])).toBe(true);
  });

  it("satışta tahsil edilen ek vergi 360'a, alıcının kestiği stopaj 193'e (EBLG-128)", () => {
    // 1000 + ÖTV 100 → KDV 220; kira 500 + KDV 100 − GV stopajı 100 → cari 1920.
    const f = fatura({ toplamMatrah: D(1500), toplamKdv: D(320), toplamNetKdv: D(320), toplamStopaj: D(100), genelToplam: D(1820),
      satirlar: [{ matrah: D(1000), ekVergi: D(100), stokTipi: "urun" }, { matrah: D(500), stokTipi: "hizmet" }] });
    const { fisler, kontroller } = fisleriUret(girdi({ faturalar: [f] }));
    expect(kontroller).toEqual([]);
    expect(ozet(fisler[0])).toEqual(["120.01.M001 B 1820.00", "600 A 1500.00", "391 A 320.00", "360 A 100.00", "193 B 100.00"]);
    expect(dengeli(fisler[0])).toBe(true);
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

  it("elle cari düzeltmesi: borç 120/679, tedarikçide alacak 689/320, karşı hesap seçilebilir (CARI-28)", () => {
    const duz = (ek: Record<string, unknown>) => ({ id: "c", cariId: "m", tip: "borc" as const, tarih: "2026-09-20", tutar: D(100), dovizCinsi: "USD", kur: D(40), tutarTry: D(4000), aciklama: null, karsiHesapKodu: null, ...ek });
    const { fisler, kontroller } = fisleriUret(girdi({ cariDuzeltmeleri: [
      duz({ id: "c1" }),
      duz({ id: "c2", cariId: "t", tip: "alacak", dovizCinsi: "TRY", kur: D(1), tutar: D(250), tutarTry: D(250) }),
      duz({ id: "c3", tutar: D(50), kur: D(1), dovizCinsi: "TRY", tutarTry: D(50), karsiHesapKodu: "659.01" }),
    ] }));
    expect(kontroller).toEqual([]);
    expect(ozet(fisler.find((f) => f.kaynak.id === "c1")!)).toEqual(["120.01.M001 B 4000.00", "679 A 4000.00"]);
    expect(fisler.find((f) => f.kaynak.id === "c1")!.satirlar[0].doviz).toMatchObject({ cins: "USD" });
    expect(ozet(fisler.find((f) => f.kaynak.id === "c2")!)).toEqual(["689 B 250.00", "320.05.9 A 250.00"]);
    expect(ozet(fisler.find((f) => f.kaynak.id === "c3")!)).toEqual(["120.01.M001 B 50.00", "659.01 A 50.00"]);
  });
});

describe("bordro fişleri (PRS-19)", () => {
  const kalem = (tip: "kazanc" | "kesinti", kod: string, tutar: number) => ({ tip, kod, aciklama: kod, tutar: D(tutar) });
  const bordro = {
    id: "br", tarih: "2026-09-30", donem: "2026/09", personelNo: "PRS-000005", adSoyad: "Ali Veli", odenecekTutar: D(26075.5),
    kalemler: [kalem("kazanc", "temel_brut_ucret", 33030), kalem("kesinti", "sgk_isci", 4624.2), kalem("kesinti", "issizlik_isci", 330.3), kalem("kesinti", "gelir_vergisi", 0), kalem("kesinti", "damga_vergisi", 0), kalem("kesinti", "avans_mahsup", 2000)],
    isverenPayi: { sgk: D(7184.03), issizlik: D(660.6) },
  };

  it("tahakkuk: B 770 brüt + işveren payı / A 361, 196, 335 net ödenecek; dengeli", () => {
    const { fisler, kontroller } = fisleriUret(girdi({ bordrolar: [bordro] }));
    expect(kontroller).toEqual([]);
    expect(fisler).toHaveLength(1);
    expect(ozet(fisler[0])).toEqual(["770 B 33030.00", "770 B 7844.63", "361 A 12799.13", "196.01.PRS-000005 A 2000.00", "335.01.PRS-000005 A 26075.50"]);
    expect(dengeli(fisler[0])).toBe(true);
  });

  it("çıkış bordrosu: kıdem/ihbar tazminat giderine, GV/DV 360'a; ödenecekle tutmazsa kontrol", () => {
    const cikis = { ...bordro, odenecekTutar: D(1), kalemler: [...bordro.kalemler, kalem("kazanc", "kidem_tazminati", 100000), kalem("kesinti", "damga_vergisi", 759)] };
    const { fisler, kontroller } = fisleriUret(girdi({ bordrolar: [cikis], hesapKodlari: { tazminat_gideri: "770.10" } }));
    expect(ozet(fisler[0])).toContain("770.10 B 100000.00");
    expect(ozet(fisler[0])).toContain("360 A 759.00");
    expect(dengeli(fisler[0])).toBe(true);
    expect(kontroller[0].mesaj).toMatch(/ödenecek tutarla/);
  });

  it("maaş ödemesi 335'i, avans ödemesi 196'yı personel alt hesabıyla kapatır", () => {
    const personelCarileri = new Map([["pc", "PRS-000005"]]);
    const { fisler } = fisleriUret(girdi({ personelCarileri, hareketler: [
      hareket({ id: "m1", tip: "tediye", tutar: D(26075.5), tutarTry: D(26075.5), kaynakTur: "personel_maas", cariId: "pc" }),
      hareket({ id: "a1", tip: "tediye", tutar: D(2000), tutarTry: D(2000), kaynakTur: "personel_avans", cariId: "pc", hesap: { tur: "banka", id: "b" } }),
    ] }));
    expect(fisler.map(ozet)).toEqual([["335.01.PRS-000005 B 26075.50", "100.01.001 A 26075.50"], ["196.01.PRS-000005 B 2000.00", "102.01.010 A 2000.00"]]);
  });
});

describe("demirbaş fişleri (DMR-02/08/09)", () => {
  it("demirbaşa bağlı alış satırı stok/gider yerine kartın hesabına", () => {
    const f = fatura({ tip: "alis", cariId: "t", satirlar: [{ matrah: D(800), stokTipi: "hizmet", demirbas: { sinif: "demirbas", hesapKodu: null } }, { matrah: D(200), stokTipi: "hizmet" }] });
    const { fisler } = fisleriUret(girdi({ faturalar: [f] }));
    expect(ozet(fisler[0])).toEqual(["255 B 800.00", "770 B 200.00", "191 B 200.00", "320.05.9 A 1200.00"]);
  });

  it("kartın kendi hesap kodu sınıf hesabından önce gelir", () => {
    const f = fatura({ tip: "alis", cariId: "t", satirlar: [{ matrah: D(1000), stokTipi: "hizmet", demirbas: { sinif: "tasit", hesapKodu: "254.01.003" } }] });
    expect(ozet(fisleriUret(girdi({ faturalar: [f] })).fisler[0])[0]).toBe("254.01.003 B 1000.00");
  });

  it("satılan demirbaşın satırı gelir yerine varlık hesabına; çıkış fişi birikmişi kapatır, fark 679", () => {
    const f = fatura({ satirlar: [{ matrah: D(1000), stokTipi: "hizmet", demirbasCikis: { sinif: "demirbas", hesapKodu: null, tl: D(1000) } }] });
    const cikis = { id: "d1", kod: "DMR-000001", ad: "Forklift", sinif: "demirbas", hesapKodu: null, tarih: "2026-09-10", tur: "satis", bedel: D(5000), birikmis: D(4500), satisTl: D(1000) };
    const { fisler, kontroller } = fisleriUret(girdi({ faturalar: [f], demirbasCikislari: [cikis] }));
    expect(kontroller).toEqual([]);
    expect(ozet(fisler[0])).toEqual(["120.01.M001 B 1200.00", "255 A 1000.00", "391 A 200.00"]);
    // Net değer 500, satış 1000 → kâr 500; 255'in kalan 4000'i kapanır.
    expect(ozet(fisler[1])).toEqual(["257 B 4500.00", "255 A 4000.00", "679 A 500.00"]);
    expect(fisler.every(dengeli)).toBe(true);
  });

  it("hurdada net değer zarar olarak 689'a", () => {
    const cikis = { id: "d2", kod: "DMR-000002", ad: "Yazılım", sinif: "hak", hesapKodu: null, tarih: "2026-09-20", tur: "hurda", bedel: D(3000), birikmis: D(2000), satisTl: D(0) };
    const { fisler } = fisleriUret(girdi({ demirbasCikislari: [cikis] }));
    expect(ozet(fisler[0])).toEqual(["268 B 2000.00", "260 A 3000.00", "689 B 1000.00"]);
    expect(dengeli(fisler[0])).toBe(true);
  });

  it("yıl sonu amortismanı: kart başına gider, hesap başına birikmiş", () => {
    const a = { id: "a", yil: 2026, tarih: "2026-12-31", satirlar: [
      { kod: "DMR-1", ad: "Bilgisayar", sinif: "demirbas", hesapKodu: null, giderHesapKodu: null, tutar: D(1000) },
      { kod: "DMR-2", ad: "Kamyonet", sinif: "tasit", hesapKodu: null, giderHesapKodu: "760.01", tutar: D(5000) },
      { kod: "DMR-3", ad: "Lisans", sinif: "hak", hesapKodu: null, giderHesapKodu: null, tutar: D(300) },
    ] };
    const { fisler } = fisleriUret(girdi({ baslangic: "2026-12-01", bitis: "2026-12-31", amortismanlar: [a] }));
    expect(ozet(fisler[0])).toEqual(["770 B 1000.00", "760.01 B 5000.00", "770 B 300.00", "257 A 6000.00", "268 A 300.00"]);
    expect(fisler[0].tarih).toBe("2026-12-31");
  });
});

describe("alış–satış mahsubu fişi (KSB-25)", () => {
  const mahsup = { id: "mh", cariId: "m", tarih: "2026-09-20", dovizCinsi: "TRY", tutar: D(500), satisTry: D(500), alisTry: D(500), faturaNolari: ["SNC1", "ALS1"] };

  it("TL mahsup: 320 borç / 120 alacak (cari alt hesabı iki tarafta), fiş dengeli", () => {
    const { fisler } = fisleriUret(girdi({ cariMahsuplari: [mahsup] }));
    expect(fisler).toHaveLength(1);
    expect(fisler[0].tur).toBe("mahsup");
    expect(ozet(fisler[0])).toEqual(["320.01.M001 B 500.00", "120.01.M001 A 500.00"]);
    expect(dengeli(fisler[0])).toBe(true);
  });

  it("dövizli mahsupta tarafların kur farkı 646/656'ya gider", () => {
    const usd = { ...mahsup, dovizCinsi: "USD", tutar: D(100), satisTry: D(3900), alisTry: D(4000) };
    const { fisler } = fisleriUret(girdi({ cariMahsuplari: [usd] }));
    expect(ozet(fisler[0])).toEqual(["320.01.M001 B 4000.00", "120.01.M001 A 3900.00", "646 A 100.00"]);
    expect(dengeli(fisler[0])).toBe(true);
    const ters = fisleriUret(girdi({ cariMahsuplari: [{ ...usd, satisTry: D(4100) }] })).fisler[0];
    expect(ozet(ters)).toEqual(["320.01.M001 B 4000.00", "120.01.M001 A 4100.00", "656 B 100.00"]);
    expect(dengeli(ters)).toBe(true);
  });
});
