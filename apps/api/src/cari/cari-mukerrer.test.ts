import { describe, expect, it } from "vitest";
import { ciftAnahtari, mukerrerGruplari, unvanBenzerligi, unvanKelimeleri, type MukerrerKart } from "./cari-mukerrer";

const kart = (id: string, unvan: string, ek: Partial<MukerrerKart> = {}): MukerrerKart => ({
  id, unvan, vknTckn: null, iban: null, eposta: null, telefon: null, personel: false, ...ek,
});
const turu = (gruplar: ReturnType<typeof mukerrerGruplari>, id: string) => gruplar.find((g) => g.kartIdleri.includes(id));

describe("mükerrer cari şüphesi (CARI-56…58)", () => {
  it("aynı VKN ve benzer unvan güçlü şüphedir", () => {
    const g = mukerrerGruplari([
      kart("a", "DUNKA GIDA DIŞ TİC SAN LTD ŞTİ", { vknTckn: "3000048938" }),
      kart("b", "DÜNKA GIDA DIŞ TİÇ. LTD.ŞTİ.", { vknTckn: "3000048938" }),
      kart("c", "BAŞKA FİRMA"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ tur: "ayni_kimlik", kartIdleri: ["a", "b"] });
    expect(g[0].nedenler[0]).toBe("Aynı VKN: 3000048938");
  });

  it("aynı VKN'li ama unvanı benzemeyen kartlar ayrı uyarıdır (hatalı VKN)", () => {
    const g = mukerrerGruplari([kart("m", "MAN TÜRKİYE A.Ş.", { vknTckn: "6110048927" }), kart("b", "MERCEDES BENZ A.Ş.", { vknTckn: "6110048927" })]);
    expect(g[0].tur).toBe("kimlik_farkli_unvan");
    expect(g[0].nedenler[0]).toContain("VKN yanlış girilmiş olabilir");
  });

  it("-KRZ eki kopya işaretidir; unvan kapsaması da şüphedir", () => {
    expect(unvanKelimeleri("BEKİR UZUN-KRZ").kelimeler).toEqual(["bekir", "uzun"]);
    expect(unvanKelimeleri("ÖZDEMİR MAK. SAN. DIŞ TİC. LTD. ŞTİ.-KRZ").kelimeler).toEqual(["ozdemir", "mak"]);
    expect(unvanBenzerligi(unvanKelimeleri("ÖZDEMİR MAK. LTD."), unvanKelimeleri("ÖZDEMİR MAKİNA LTD"))).toBe(1);
    expect(unvanBenzerligi(unvanKelimeleri("ÖZDEMİR MAK LTD"), unvanKelimeleri("ÖZDEMİR MAKARNA"))).toBeLessThan(0.8);
    expect(unvanBenzerligi(unvanKelimeleri("KARDEŞ BOYA"), unvanKelimeleri("KARDEŞLER BOYA"))).toBe(1);
    const g = mukerrerGruplari([
      kart("k", "HÜSEYİN BOZKURT-KRZ"),
      kart("s", "STARVAKS OTOMOTİV - HÜSEYİN BOZKURT"),
      kart("c1", "CİHAN BOYA PAZARLAMA SAN. VE TİC.LTD.ŞTİ."),
      kart("c2", "CİHAN BOYA-KRZ"),
    ]);
    expect(turu(g, "k")?.kartIdleri.sort()).toEqual(["k", "s"]);
    expect(turu(g, "c1")).toMatchObject({ tur: "unvan" });
    expect(turu(g, "c1")?.kartIdleri.sort()).toEqual(["c1", "c2"]);
  });

  it("tek ortak kelime ya da tek kelimelik kapsama şüphe değildir", () => {
    expect(unvanBenzerligi(unvanKelimeleri("KAYA METAL"), unvanKelimeleri("KAYA GIDA"))).toBeLessThan(0.8);
    expect(unvanBenzerligi(unvanKelimeleri("BOYA"), unvanKelimeleri("CİHAN BOYA"))).toBeLessThan(0.8);
    expect(mukerrerGruplari([kart("a", "KAYA METAL"), kart("b", "KAYA GIDA")])).toEqual([]);
    // Demo verisinden: kapsamada kısaltma/tek harf farkı sayılmaz.
    expect(mukerrerGruplari([
      kart("a", "DERİVA DERİ SAN. VE TİCARET A.Ş."), kart("b", "ÇETİNKAYA KÜRK DERİ KONF. TAR.SAN. VE TİC.LTD.ŞTI"),
      kart("c", "TEKİN BOYA SANAYİ LİMİTED ŞİRKETİ"), kart("d", "TEKİNEL BOYA END.MAL.SAN.LTD.ŞTİ."),
      kart("e", "Tezel Otomotiv San.Tic.Ltd.Şti."), kart("f", "MEHMET TEMEL BOYA KİMYA OTOMOTİV SANAYİ"),
      kart("i", "DERİMSAN DERİ İMALAT SAN TİC LTD ŞTİ"), kart("j", "RULMAK HIRDAVAT TİCARET LTD. ŞTİ."), kart("k", "Mt Rulman Hırdavat ve Dış Ticaret. Ltd. Şti."),
    ])).toEqual([]);
  });

  it("ortak GİB kimlikleri (nihai tüketici, yurt dışı, muhtelif) mükerrer sayılmaz", () => {
    expect(mukerrerGruplari([
      kart("a", "Doğukan Olçay", { vknTckn: "11111111111" }), kart("b", "Emine Şirin", { vknTckn: "11111111111" }),
      kart("c", "ACME GMBH", { vknTckn: "2222222222" }), kart("d", "GLOBEX LLC", { vknTckn: "2222222222" }),
    ])).toEqual([]);
  });

  it("personel kartı birleştirmeye girmez; aynı kişinin öbür kartıyla 'farklı rol' bilgisidir", () => {
    const g = mukerrerGruplari([
      kart("mus", "MELEK TÜRKER", { vknTckn: "21125695124" }),
      kart("prs", "MELEK TÜRKER", { vknTckn: "21125695124", personel: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ tur: "farkli_rol", kartIdleri: ["prs", "mus"] });
  });

  it("aynı IBAN tek başına şüphedir; e-posta/telefon yalnız gerekçeye eklenir", () => {
    const g = mukerrerGruplari([
      kart("a", "ALFA LTD", { iban: "TR12 0006 2000 0000 0000 0000 01", telefon: "0532 111 22 33" }),
      kart("b", "BETA AŞ", { iban: "TR120006200000000000000001", telefon: "+90 532 111 2233" }),
      kart("c", "GAMA", { eposta: "muhasebe@x.com" }), kart("d", "DELTA", { eposta: "MUHASEBE@x.com" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ tur: "iban", kartIdleri: ["a", "b"] });
    expect(g[0].nedenler).toEqual(["Aynı IBAN", "Aynı telefon"]);
  });

  it("'aynı değil' işaretli çift raporda çıkmaz, gruptaki öbür kenarlar kalır", () => {
    const kartlar = [kart("a", "TANATAR KALIP PRES", { vknTckn: "8190026863" }), kart("b", "TANATAR KALIP PRES İŞLERİ", { vknTckn: "8190026863" }), kart("c", "TANATAR KALIP PRES SAN.")];
    expect(mukerrerGruplari(kartlar)[0].kartIdleri.sort()).toEqual(["a", "b", "c"]);
    const istisna = new Set([ciftAnahtari("a", "b"), ciftAnahtari("a", "c"), ciftAnahtari("b", "c")]);
    expect(mukerrerGruplari(kartlar, istisna)).toEqual([]);
    const kalan = mukerrerGruplari(kartlar, new Set([ciftAnahtari("a", "c"), ciftAnahtari("b", "c")]));
    expect(kalan).toHaveLength(1);
    expect(kalan[0].kartIdleri.sort()).toEqual(["a", "b"]);
  });
});
