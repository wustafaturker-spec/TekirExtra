import { describe, expect, it } from "vitest";
import { adBenzerligi, cariyiAdlaBul, karsiTarafAdaylari, kelimeUyar, kendiAdlariniBul, maasOdemesiMi } from "./ekstre-karsi-taraf";

// Biçimler gerçek banka ekstrelerinden; adlar değiştirildi.
const KENDI = "DEMO KİMYASAL ÜRÜNLERİ SANAYİ VE DIŞ TİCARET LİMİTED ŞİRKETİ";
const cari = (id: string, unvan: string) => ({ id, kod: id, unvan });
const CARILER = [
  cari("berk", "BERKAN İŞ GÜVENLİĞİ TEKSTİL ENDÜSTRİYEL ÜRÜNLER SAN. TİC. LTD. ŞTİ."),
  cari("emka", "EMKA MAK.İNŞ.HIR.LTD.ŞTİ."),
  cari("ozd", "ÖZKAN MAK. SAN. DIŞ TİC. LTD. ŞTİ."),
  cari("ozdk", "ÖZKAN MAK. SAN. DIŞ TİC. LTD. ŞTİ.-KRZ"),
  cari("star", "STARVAKS OTOMOTİV - HAKAN BOZDAĞ"),
  cari("hb", "HAKAN BOZDAĞ-KRZ"),
  cari("akc", "AKÇAY ELEKTROSTATİK BOYA / SERKAN AKÇAY"),
  cari("simya", "SİMYA GRUP MAKİNA KİMYASAL ÜRÜNLER İÇ VE DIŞ TİC."),
  cari("boya1", "YILDIZ BOYA SAN. LTD."),
  cari("boya2", "AY BOYA TİC. A.Ş."),
];
const bul = (aciklama: string, giris = true, kendi: string[] = [KENDI]) => cariyiAdlaBul(karsiTarafAdaylari(aciklama, null, giris, kendi), CARILER)?.cari.id ?? null;

describe("ekstre açıklamasından karşı taraf (KSB-17)", () => {
  it("bankanın yarıda kestiği ve kısalttığı unvanı bulur", () => {
    expect(bul(`cari hesaba mahsuben - Gönderen:BERKAN İŞ GÜVENLİĞİ TEKSTİL ENDÜSTRİYEL ÜRÜNLER SANAYİ TİCARET L`)).toBe("berk");
    expect(bul("GELEN HAVALE -EMKAMAK İNŞAAT HIRDAVAT MATBAA SAN -Emkamak cari ödeme")).toBe("emka");
  });

  it("kişi adıyla gönderilen ödemeyi 'FİRMA / KİŞİ' unvanlı cariye bağlar; yazım farkını (W/V, X/KS) tolerans eder", () => {
    expect(bul(`Cari hesaba mahsuben - Gönderen:SERKAN AKÇAY, Alıcı:${KENDI}, FAST Para Transferi`)).toBe("akc");
    expect(bul(`alinan borc iadesi - Para Transferi, Gönderen: HAKAN BOZDAĞ STARWAX OTOMOTİV , Alıcı: ${KENDI}`)).toBe("star");
  });

  it("eksiksiz eşleşen cari, ek kodlu kopya kartın önüne geçer", () => {
    expect(bul(`ön ödeme - Para Transferi, Gönderen: ÖZKAN MAKİNA SANAYİ VE DIŞ TİCARET LİMİTED ŞİRKETİ , Alıcı: ${KENDI}`)).toBe("ozd");
  });

  it("çıkışta alıcıyı, girişte göndereni alır; bitişik yazılmış etiketi okur", () => {
    expect(bul(`C/H MAHSUBEN - Gönderen:${KENDI}, Alıcı:BERKAN İŞ GÜVENLİĞİ TEKSTİL, FAST Para Transferi`, false)).toBe("berk");
    expect(bul(`, Gelen Para Transferi, Açıklama= Mobil EFT FATURA ODEMESİGönderen= SERKAN AKÇAY , Alıcı= DEMO KİMYAS`)).toBe("akc");
  });

  it("firmanın kendi adını ve kendi hesapları arası virmanı cariye bağlamaz", () => {
    // Nakit işlemde "Adı Soyadı" firmanın kendisi; kendi adı bilinmezse ortak kelimeler ("GRUP", "KİMYASAL") yanıltabilirdi.
    expect(bul(`Yetkili: ALİ VELİ, Nakit Ödeme, Adı Soyadı: ${KENDI}`, false)).toBeNull();
    expect(karsiTarafAdaylari(`GARANTİ VİRMAN - Gönderen:${KENDI}, Alıcı:DEMO KİMYASAL ÜRÜNLERİ SANA, FAST Para Transferi`, null, true)).toEqual([]);
  });

  it("yalnız yaygın kelime tutuyorsa ya da iki cari aynı yakınlıktaysa öneri yapmaz", () => {
    expect(bul("Gönderen:BOYA DÜNYASI")).toBeNull();
    expect(bul("Gönderen:VEKTÖR LOJİSTİK")).toBeNull();
  });

  it("kendi adını en az iki satırda tekrarlanan gönderen/alıcıdan öğrenir", () => {
    const satirlar = [
      { aciklama: `KİRA - Gönderen:${KENDI}, Alıcı:ALİ VELİ`, giris: false },
      { aciklama: `MAAŞ - Gönderen:${KENDI}, Alıcı:AYŞE KAYA`, giris: false },
      { aciklama: `Gönderen:BERKAN TEKSTİL, Alıcı:${KENDI}`, giris: true },
      { aciklama: "Gönderen:TEK SEFERLİK FİRMA, Alıcı:BAŞKA", giris: true },
    ];
    expect(kendiAdlariniBul(satirlar)).toEqual([KENDI]);
  });

  it("kelime ve ad benzerliği kuralları", () => {
    expect(kelimeUyar("mak", "makina")).toBe(true);
    expect(kelimeUyar("ma", "makina")).toBe(false);
    expect(kelimeUyar("guvenligi", "guvenlik")).toBe(false);
    expect(kelimeUyar("ozkann", "ozkan")).toBe(true);
    expect(adBenzerligi("DEMO KİMYASAL ÜRÜNLERİ SANAYİ", "DEMO KİM.ÜR.SAN.DIŞ TİC.LTD.ŞTİ.")).toBeGreaterThanOrEqual(0.6);
  });

  it("maaş ödemesini tanır, banka ücretini saymaz (KSB-18)", () => {
    expect(maasOdemesiMi("ŞUBAT 2026 MAAŞ ÖDEMESİ - Para Transferi")).toBe(true);
    expect(maasOdemesiMi("Ekim maaşı")).toBe(true);
    expect(maasOdemesiMi("BORDRO ÖDEMESİ 10/2026")).toBe(true);
    expect(maasOdemesiMi("Ücret ödemesi - AYŞE KAYA")).toBe(true);
    expect(maasOdemesiMi("EFT ÜCRETİ")).toBe(false);
    expect(maasOdemesiMi("KİRA ÖDEMESİ")).toBe(false);
  });
});
