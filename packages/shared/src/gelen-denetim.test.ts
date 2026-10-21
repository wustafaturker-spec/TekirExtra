import { describe, expect, it } from "vitest";
import { gelenDenetimYap, ibanGecerli, yerAdiSadelestir, type GelenDenetimGirdisi, type GelenDenetimSatiri } from "./gelen-denetim";

const IBAN = "TR330006100519786457841326";
const IBAN2 = "TR320010009999901234567890";

const satir = (s: Partial<GelenDenetimSatiri> = {}): GelenDenetimSatiri => ({
  sira: 1, ad: "Vana 1/2", stok: { id: "s1", ad: "Vana", tip: "urun", kdvOrani: 20 }, miktar: 10, birim: "adet",
  netBirimFiyat: 100, kdvOrani: 20, tevkifatKodu: null, referans: { fiyat: 100, kaynak: "tedarikci", faturaId: "f0", faturaNo: "ABC2026000000001" },
  siparis: null, gecmisKdvOranlari: [],
  ...s,
});

const girdi = (g: Partial<GelenDenetimGirdisi> = {}): GelenDenetimGirdisi => ({
  belge: { no: "ABC2026000000002", tarih: "2026-10-20", tip: "alis", doviz: "TRY", kdvKarsilastirilmaz: false, vadeGun: 30, kdvDahilTl: 1200, tevkifatli: false, kismiTevkifatli: false },
  cari: { id: "c1", unvan: "Kaya Makina", vadeGun: 30 },
  firma: { unvan: "Tekir Ektra Ön Muhasebe Ltd. Şti.", vergiDairesi: "Kozyatağı", il: "İstanbul" },
  alici: { unvan: "TEKİR EKTRA ÖN MUHASEBE LİMİTED ŞİRKETİ", vergiDairesi: "KOZYATAĞI V.D.", il: "ISTANBUL" },
  odeme: { hesaplar: [IBAN], bilinenler: [IBAN], oncekiBelgeVar: true },
  gecmisTevkifat: [], tevkifatAltSiniri: 12000, satirlar: [satir()], mukerrerAdaylari: [],
  esikler: { fiyatYuzde: 25, siparisToleransYuzde: 1 },
  ...g,
});

const kodlar = (g: GelenDenetimGirdisi) => gelenDenetimYap(g).map((b) => b.kod);

describe("gelen alış denetçisi yardımcıları", () => {
  it("IBAN denetim basamağını doğrular", () => {
    expect(ibanGecerli(IBAN)).toBe(true);
    expect(ibanGecerli("TR33 0006 1005 1978 6457 8413 26")).toBe(true);
    expect(ibanGecerli("TR330006100519786457841327")).toBe(false);
    expect(ibanGecerli("TR3300061005197864578413")).toBe(false);
    expect(ibanGecerli("DE89370400440532013000")).toBe(true);
  });

  it("vergi dairesi ve il yazımını sadeleştirir", () => {
    expect(yerAdiSadelestir("Kozyatağı V.D.")).toBe(yerAdiSadelestir("KOZYATAĞI VERGİ DAİRESİ"));
    expect(yerAdiSadelestir("İstanbul")).toBe(yerAdiSadelestir("ISTANBUL"));
    expect(yerAdiSadelestir("Kadıköy")).not.toBe(yerAdiSadelestir("Kozyatağı"));
  });
});

describe("gelen alış denetçisi kuralları", () => {
  it("temiz belgede bulgu yok", () => {
    expect(kodlar(girdi())).toEqual([]);
  });

  it("fiyat sapması ve kat hatası", () => {
    expect(kodlar(girdi({ satirlar: [satir({ netBirimFiyat: 130 })] }))).toContain("GELEN_FIYAT_SAPMA");
    expect(kodlar(girdi({ satirlar: [satir({ netBirimFiyat: 120 })] }))).not.toContain("GELEN_FIYAT_SAPMA");
    const kat = gelenDenetimYap(girdi({ satirlar: [satir({ netBirimFiyat: 1050 })] }));
    expect(kat.map((b) => b.kod)).toEqual(["GELEN_FIYAT_KAT_HATASI"]);
    expect(kat[0].mesaj).toContain("10 kat fazla");
    expect(kodlar(girdi({ esikler: { fiyatYuzde: 50, siparisToleransYuzde: 1 }, satirlar: [satir({ netBirimFiyat: 130 })] }))).toEqual([]);
  });

  it("sipariş fiyatı toleransı", () => {
    const s = satir({ netBirimFiyat: 102, siparis: { fiyat: 100, belgeNo: "SAS2026000001", belgeId: "b1" } });
    expect(kodlar(girdi({ satirlar: [s] }))).toEqual(["GELEN_SIPARIS_FIYATI"]);
    expect(kodlar(girdi({ satirlar: [{ ...s, netBirimFiyat: 100.5 }] }))).toEqual([]);
  });

  it("eşleşmeyen ve geçmişi olmayan satırlar tek bilgide toplanır", () => {
    const b = gelenDenetimYap(girdi({ satirlar: [satir({ sira: 1, stok: null }), satir({ sira: 2, stok: null }), satir({ sira: 3, referans: null })] }));
    expect(b.map((x) => [x.kod, x.duzey])).toEqual([["GELEN_URUN_ESLESMEDI", "bilgi"], ["GELEN_FIYAT_GECMISI_YOK", "bilgi"]]);
    expect(b[0].mesaj).toMatch(/^1, 2\. satırlar/);
  });

  it("bedelsiz satır karşılaştırılmaz", () => {
    expect(kodlar(girdi({ satirlar: [satir({ netBirimFiyat: 0, stok: null })] }))).toEqual([]);
  });

  it("mükerrer: belge başına tek uyarı, en güçlü neden önce", () => {
    const aday = { tur: "gelen" as const, id: "g1", no: "ABC2026000000009", tarih: "2026-10-19", ayniNo: false, ayniToplam: true, ayniSatirlar: false };
    const b = gelenDenetimYap(girdi({ mukerrerAdaylari: [aday, { ...aday, tur: "fatura", id: "f9", no: "ABC2026000000002", tarih: "2026-10-18", ayniNo: true, ayniToplam: false }, { ...aday, id: "g8", ayniToplam: false }] }));
    expect(b.map((x) => x.kod)).toEqual(["GELEN_MUKERRER"]);
    expect(b[0].baglanti).toEqual({ tur: "fatura", id: "f9", etiket: "ABC2026000000002" });
    expect(b[0].mesaj).toMatch(/aynı numarayla elle kaydedilmiş; .*e-Fatura aynı tutarla gelmiş\./);
    expect(b[0].duzey).toBe("uyari");
    const cok = Array.from({ length: 5 }, (_, i) => ({ ...aday, id: `g${i}` }));
    expect(gelenDenetimYap(girdi({ mukerrerAdaylari: cok }))[0].mesaj).toContain("ve 2 kayıt daha");
  });

  it("mükerrer: yalnız 7 gün içindeki benzerlik bilgidir, aynı gün uyarıdır", () => {
    const aday = { tur: "gelen" as const, id: "g1", no: "ABC2026000000009", tarih: "2026-10-19", ayniNo: false, ayniToplam: true, ayniSatirlar: true };
    expect(gelenDenetimYap(girdi({ mukerrerAdaylari: [aday] })).map((b) => b.duzey)).toEqual(["bilgi"]);
    expect(gelenDenetimYap(girdi({ mukerrerAdaylari: [{ ...aday, tarih: "2026-10-20" }] })).map((b) => b.duzey)).toEqual(["uyari"]);
  });

  it("ödeme hesabı: değişmiş, geçersiz, ilk belge", () => {
    expect(kodlar(girdi({ odeme: { hesaplar: [IBAN2], bilinenler: [IBAN], oncekiBelgeVar: true } }))).toEqual(["GELEN_IBAN_DEGISTI"]);
    expect(kodlar(girdi({ odeme: { hesaplar: [IBAN2], bilinenler: [], oncekiBelgeVar: true } }))).toEqual(["GELEN_IBAN_DEGISTI"]);
    expect(kodlar(girdi({ odeme: { hesaplar: ["TR330006100519786457841327"], bilinenler: [], oncekiBelgeVar: true } }))).toEqual(["GELEN_IBAN_GECERSIZ"]);
    const ilk = gelenDenetimYap(girdi({ odeme: { hesaplar: [IBAN2], bilinenler: [], oncekiBelgeVar: false } }));
    expect(ilk.map((x) => [x.kod, x.duzey])).toEqual([["GELEN_IBAN_ILK", "bilgi"]]);
  });

  it("KDV karttan ve geçmişten farklı; kart eskiyse geçmiş esas", () => {
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 10 })] }))).toEqual(["GELEN_KDV_KARTTAN_FARKLI"]);
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 10, gecmisKdvOranlari: [10, 10, 10] })] }))).toEqual([]);
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 20, gecmisKdvOranlari: [10, 10, 10] })] }))).toEqual(["GELEN_KDV_GECMISTEN_FARKLI"]);
    expect(kodlar(girdi({ belge: { ...girdi().belge, kdvKarsilastirilmaz: true }, satirlar: [satir({ kdvOrani: 0 })] }))).toEqual([]);
  });

  it("tevkifat alışkanlığı ve alt sınır", () => {
    expect(kodlar(girdi({ gecmisTevkifat: [true, true, true] }))).toEqual(["GELEN_TEVKIFAT_ALISKANLIK"]);
    expect(kodlar(girdi({ gecmisTevkifat: [true, false, true] }))).toEqual([]);
    expect(kodlar(girdi({ belge: { ...girdi().belge, tevkifatli: true, kismiTevkifatli: true, kdvDahilTl: 5000 } }))).toEqual(["GELEN_TEVKIFAT_ALT_SINIR"]);
    // Tam tevkifatta alt sınır aranmaz.
    expect(kodlar(girdi({ belge: { ...girdi().belge, tevkifatli: true, kdvDahilTl: 5000 } }))).toEqual([]);
    const hizmet = satir({ stok: { id: "s2", ad: "Danışmanlık", tip: "hizmet", kdvOrani: 20 } });
    expect(gelenDenetimYap(girdi({ belge: { ...girdi().belge, kdvDahilTl: 24000 }, satirlar: [hizmet] })).map((b) => [b.kod, b.duzey]))
      .toEqual([["GELEN_TEVKIFAT_OLABILIR", "bilgi"]]);
    expect(kodlar(girdi({ tevkifatAltSiniri: null, belge: { ...girdi().belge, tevkifatli: true, kismiTevkifatli: true, kdvDahilTl: 5000 } }))).toEqual([]);
  });

  it("firma bilgileri ve vade", () => {
    const b = gelenDenetimYap(girdi({ alici: { unvan: "Deniz Gıda A.Ş.", vergiDairesi: "Kadıköy", il: "İstanbul" } }));
    expect(b.map((x) => x.kod)).toEqual(["GELEN_ALICI_BILGISI"]);
    expect(b[0].mesaj).toContain("unvan");
    expect(b[0].mesaj).toContain("vergi dairesi");
    // Test ortamında portal alıcıyı "TEST KURUM" yazar.
    expect(kodlar(girdi({ testOrtami: true, alici: { unvan: "TEST KURUM", vergiDairesi: "Test" } }))).toEqual([]);
    const temiz = { alici: { unvan: "Tekir Ektra", vergiDairesi: "Kozyatağı", il: "İstanbul" } };
    expect(kodlar(girdi({ ...temiz, belge: { ...girdi().belge, vadeGun: 20 } }))).toEqual(["GELEN_VADE_KISA"]);
    expect(kodlar(girdi({ ...temiz, belge: { ...girdi().belge, vadeGun: 26 } }))).toEqual([]);
    expect(gelenDenetimYap(girdi({ ...temiz, belge: { ...girdi().belge, vadeGun: null } })).map((x) => [x.kod, x.duzey])).toEqual([["GELEN_VADE_YOK", "bilgi"]]);
  });

  it("iade belgesinde yalnız mükerrer ve firma bilgileri", () => {
    const g = girdi({ belge: { ...girdi().belge, tip: "satis_iade", vadeGun: null }, satirlar: [satir({ netBirimFiyat: 500 })],
      odeme: { hesaplar: [IBAN2], bilinenler: [IBAN], oncekiBelgeVar: true }, alici: { unvan: "Deniz Gıda" } });
    expect(kodlar(g)).toEqual(["GELEN_ALICI_BILGISI"]);
  });
});
