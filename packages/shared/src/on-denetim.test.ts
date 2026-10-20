import { describe, expect, it } from "vitest";
import { onDenetimYap, onKati, ortanca, unvanlarUyumlu, type OnDenetimGirdisi, type OnDenetimSatiri } from "./on-denetim";

const satir = (s: Partial<OnDenetimSatiri> = {}): OnDenetimSatiri => ({
  sira: 1, stokId: "s1", stokAd: "Vana", stokTip: "urun", birim: "adet", miktar: 10,
  birimFiyat: 100, netBirimFiyat: 100, kdvOrani: 20, kartKdvOrani: 20, tevkifatKodu: null, istisnaKodu: null,
  birimMaliyet: null, listeFiyati: null, gecmisFiyatlar: [], gecmisKdvOranlari: [], cariGecmisTevkifat: [], cariGecmisMiktarlar: [],
  ...s,
});

const girdi = (g: Partial<OnDenetimGirdisi> = {}): OnDenetimGirdisi => ({
  fatura: { senaryo: "satis", doviz: "TRY", kur: 1, yurtDisi: false },
  cari: { id: "c1", unvan: "Kaya Makina San. ve Tic. Ltd. Şti.", vknTckn: "1234567890", vergiDairesi: "Kozyatağı" },
  mukellef: null, gecmisSenaryolar: [], satirlar: [satir()], mukerrerAdaylari: [], gunKuru: null,
  ...g,
});

const kodlar = (g: OnDenetimGirdisi) => onDenetimYap(g).map((b) => b.kod);

describe("ön denetçi yardımcıları", () => {
  it("unvanları şirket ekleri olmadan karşılaştırır", () => {
    expect(unvanlarUyumlu("KAYA MAKİNA SANAYİ VE TİCARET LİMİTED ŞİRKETİ", "Kaya Makina San. Tic. Ltd. Şti.")).toBe(true);
    expect(unvanlarUyumlu("Kaya Makina A.Ş.", "KAYA MAKİNA ANONİM ŞİRKETİ")).toBe(true);
    expect(unvanlarUyumlu("Kaya Makina Ltd. Şti.", "Deniz Gıda A.Ş.")).toBe(false);
    expect(unvanlarUyumlu("Ltd. Şti.", "Deniz Gıda")).toBe(true);
  });

  it("ortanca ve on kat", () => {
    expect(ortanca([3, 1, 2])).toBe(2);
    expect(ortanca([4, 1, 2, 3])).toBe(2.5);
    expect(ortanca([0, -1])).toBeNull();
    expect(onKati(10)).toBe(10);
    expect(onKati(0.001)).toBe(-1000);
    expect(onKati(1.5)).toBeNull();
    expect(onKati(101)).toBe(100);
  });
});

describe("ön denetçi kuralları", () => {
  it("temiz belgede bulgu yok", () => {
    expect(onDenetimYap(girdi())).toEqual([]);
  });

  it("GİB unvanı, vergi dairesi ve yeni posta kutusu (yalnız e-Fatura mükellefinde)", () => {
    const g = girdi({
      cari: { id: "c1", unvan: "Kaya Makina Ltd. Şti.", vknTckn: "1234567890", vergiDairesi: " " },
      mukellef: { efaturaMukellefi: true, unvan: "DENİZ GIDA ANONİM ŞİRKETİ", yeniKutular: ["urn:mail:yeni@x"] },
    });
    expect(kodlar(g)).toEqual(["CARI_UNVAN_FARKLI", "CARI_VERGI_DAIRESI_YOK", "POSTA_KUTUSU_YENI"]);
    expect(kodlar({ ...g, mukellef: { efaturaMukellefi: false, unvan: null, yeniKutular: [] } })).toEqual([]);
    const kutular = ["a", "b", "c", "d", "e"].map((x) => `urn:mail:${x}`);
    expect(onDenetimYap({ ...g, mukellef: { efaturaMukellefi: true, unvan: null, yeniKutular: kutular } }).find((b) => b.kod === "POSTA_KUTUSU_YENI")!.mesaj)
      .toContain("urn:mail:a, urn:mail:b, urn:mail:c ve 2 kutu daha");
    // TCKN'li alıcıda vergi dairesi aranmaz.
    expect(kodlar({ ...g, cari: { ...g.cari, vknTckn: "12345678901" }, mukellef: { efaturaMukellefi: true, unvan: null, yeniKutular: [] } })).toEqual([]);
  });

  it("senaryo alışkanlığı en az 3 tek düze kayıt ister", () => {
    expect(kodlar(girdi({ gecmisSenaryolar: ["tevkifat", "tevkifat", "tevkifat"] }))).toEqual(["SENARYO_ALISKANLIK"]);
    expect(kodlar(girdi({ gecmisSenaryolar: ["tevkifat", "tevkifat"] }))).toEqual([]);
    expect(kodlar(girdi({ gecmisSenaryolar: ["tevkifat", "satis", "tevkifat"] }))).toEqual([]);
    expect(kodlar(girdi({ gecmisSenaryolar: ["satis", "satis", "satis"] }))).toEqual([]);
    // Yalnız son 5 kayda bakılır.
    expect(kodlar(girdi({ gecmisSenaryolar: ["tevkifat", "tevkifat", "tevkifat", "tevkifat", "tevkifat", "satis"] }))).toEqual(["SENARYO_ALISKANLIK"]);
  });

  it("KDV önce kartla, kart tutuyorsa geçmişle karşılaştırılır", () => {
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 10 })] }))).toEqual(["KDV_KARTTAN_FARKLI"]);
    expect(kodlar(girdi({ satirlar: [satir({ gecmisKdvOranlari: [10, 10, 10] })] }))).toEqual(["KDV_GECMISTEN_FARKLI"]);
    // İstisnalı satırda ve istisna senaryosunda kart karşılaştırılmaz.
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 0, istisnaKodu: "301" })] }))).toEqual([]);
    expect(kodlar(girdi({ fatura: { senaryo: "ihrackayitli", doviz: "TRY", kur: 1, yurtDisi: false }, satirlar: [satir({ kdvOrani: 0 })] }))).toEqual([]);
    expect(kodlar(girdi({ fatura: { senaryo: "satis", doviz: "TRY", kur: 1, yurtDisi: true }, satirlar: [satir({ kdvOrani: 0 })] }))).toEqual([]);
  });

  it("tevkifat alışkanlığı iki yönde", () => {
    expect(kodlar(girdi({ satirlar: [satir({ cariGecmisTevkifat: ["603", "603", "603"] })] }))).toEqual(["TEVKIFAT_ALISKANLIK"]);
    expect(kodlar(girdi({ satirlar: [satir({ tevkifatKodu: "603", cariGecmisTevkifat: [null, null, null] })] }))).toEqual(["TEVKIFAT_ALISKANLIK"]);
    expect(kodlar(girdi({ satirlar: [satir({ tevkifatKodu: "603", cariGecmisTevkifat: ["603", "603", "603"] })] }))).toEqual([]);
  });

  it("301/302 mal-hizmet uyumu", () => {
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 0, istisnaKodu: "301", stokTip: "hizmet" })] }))).toEqual(["ISTISNA_MAL_HIZMET"]);
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 0, istisnaKodu: "302", stokTip: "urun" })] }))).toEqual(["ISTISNA_MAL_HIZMET"]);
    expect(kodlar(girdi({ satirlar: [satir({ kdvOrani: 0, istisnaKodu: "302", stokTip: "hizmet" })] }))).toEqual([]);
  });

  it("fiyat sapması önce aynı cariye, yoksa tüm carilere bakar", () => {
    const ayni = [{ fiyat: 100, ayniCari: true }, { fiyat: 100, ayniCari: true }];
    expect(kodlar(girdi({ satirlar: [satir({ netBirimFiyat: 130, gecmisFiyatlar: ayni })] }))).toEqual(["FIYAT_SAPMA"]);
    expect(kodlar(girdi({ satirlar: [satir({ netBirimFiyat: 120, gecmisFiyatlar: ayni })] }))).toEqual([]);
    // Aynı cari varken başka carilerin fiyatı referans olmaz.
    expect(kodlar(girdi({ satirlar: [satir({ netBirimFiyat: 100, gecmisFiyatlar: [{ fiyat: 50, ayniCari: false }, ...ayni] })] }))).toEqual([]);
    expect(kodlar(girdi({ satirlar: [satir({ netBirimFiyat: 100, gecmisFiyatlar: [{ fiyat: 50, ayniCari: false }] })] }))).toEqual(["FIYAT_SAPMA"]);
    // Eşik ayardan değişir.
    expect(kodlar(girdi({ esikler: { fiyatYuzde: 10 }, satirlar: [satir({ netBirimFiyat: 120, gecmisFiyatlar: ayni })] }))).toEqual(["FIYAT_SAPMA"]);
  });

  it("10/100/1000 kat fiyat ve miktar hatasını ayrıca adlandırır", () => {
    const b = onDenetimYap(girdi({ satirlar: [satir({ netBirimFiyat: 10, gecmisFiyatlar: [{ fiyat: 100, ayniCari: true }] })] }));
    expect(b.map((x) => x.kod)).toEqual(["FIYAT_KAT_HATASI"]);
    expect(b[0].mesaj).toContain("10 kat az");
    expect(kodlar(girdi({ satirlar: [satir({ miktar: 1000, cariGecmisMiktarlar: [10, 10, 10] })] }))).toEqual(["MIKTAR_KAT_HATASI"]);
    expect(kodlar(girdi({ satirlar: [satir({ miktar: 25, cariGecmisMiktarlar: [10, 10, 10] })] }))).toEqual([]);
  });

  it("maliyet altı ve fiyat listesi", () => {
    expect(kodlar(girdi({ satirlar: [satir({ birimMaliyet: 120 })] }))).toEqual(["MALIYET_ALTI"]);
    expect(kodlar(girdi({ satirlar: [satir({ birimMaliyet: 80 })] }))).toEqual([]);
    expect(kodlar(girdi({ satirlar: [satir({ listeFiyati: 200 })] }))).toEqual(["LISTE_FIYATI_FARKLI"]);
    expect(kodlar(girdi({ satirlar: [satir({ listeFiyati: 110 })] }))).toEqual([]);
  });

  it("mükerrer şüphesi ve kaynak aşımı", () => {
    const b = onDenetimYap(girdi({
      mukerrerAdaylari: [
        { id: "f2", no: "SAT2026000000012", tarih: "2026-10-18", ayniToplam: true, ayniSatirlar: false },
        { id: "f3", no: null, tarih: "2026-10-19", ayniToplam: false, ayniSatirlar: false },
      ],
      satirlar: [satir({ kaynakAsimi: { belgeNo: "SIP-7", kaynakMiktar: 10, toplamFaturalanan: 20 } })],
    }));
    expect(b.map((x) => x.kod)).toEqual(["MUKERRER_SUPHESI", "KAYNAK_ASIMI"]);
    expect(b[0].mesaj).toContain("18.10.2026");
    expect(b[0].baglanti).toEqual({ tur: "fatura", id: "f2", etiket: "SAT2026000000012" });
    expect(b[0].mesaj).toContain("SAT2026000000012 numaralı bir fatura aynı toplamla");
  });

  it("kur: TCMB aralığının ±%3 dışı uyarı, kur yoksa bilgi", () => {
    const usd = (kur: number) => ({ senaryo: "satis", doviz: "USD", kur, yurtDisi: false });
    const gunKuru = { alis: 40, satis: 40.2 };
    expect(kodlar(girdi({ fatura: usd(40.1), gunKuru }))).toEqual([]);
    expect(kodlar(girdi({ fatura: usd(41.3), gunKuru }))).toEqual([]);
    expect(kodlar(girdi({ fatura: usd(42), gunKuru }))).toEqual(["KUR_SAPMA"]);
    expect(kodlar(girdi({ fatura: usd(4.01), gunKuru }))).toEqual(["KUR_SAPMA"]);
    expect(onDenetimYap(girdi({ fatura: usd(40) }))).toMatchObject([{ kod: "KUR_BULUNAMADI", duzey: "bilgi" }]);
  });
});
