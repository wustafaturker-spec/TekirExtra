/**
 * e-Belge resmi durum adımları (EBLG-45).
 *
 * Durum geçmişi "ne oldu"yu söyler; bu şerit "neredeyiz"i söyler. Adımlar belge
 * türüne göre değişir, çünkü her akışta her adım yoktur: temel e-Faturada alıcı
 * yanıtı hiç gelmez, e-Arşiv zarfı alıcıya değil GİB'e gider. Olmayan adımı
 * göstermek kullanıcıyı gelmeyecek bir olayı beklemeye iter.
 */

export type AkisTuru = "efatura" | "earsiv" | "eirsaliye" | "gelen_efatura" | "gelen_eirsaliye";
export type AdimDurumu = "tamam" | "suanki" | "bekliyor" | "hata" | "iptal";

export interface AkisGirdisi {
  tur: AkisTuru;
  /** e-Faturada alıcı yanıtı adımı yalnız ticari profilde vardır. */
  profil?: "temel" | "ticari" | null;
  /** Zarf/belge durumu: kuyrukta, iletildi, kabul, kismi_kabul, ret, hata, iptal. */
  durum?: string | null;
  /** Alıcının ticari faturaya verdiği yanıt; zarf kabulünden ayrı eksendir. */
  aliciYaniti?: "kabul" | "ret" | null;
  /**
   * İptal edilen belgenin iptalden önce ulaştığı en ileri zarf durumu. Son
   * durum "iptal" olunca yol bilgisi kaybolur; geçmişten gelen bu değer,
   * belgenin nereye kadar gittiğini şeritte görünür tutar.
   */
  ulasilanDurum?: string | null;
}

export interface Adim {
  anahtar: string;
  baslik: string;
  durum: AdimDurumu;
  /** Zaman damgasının geçmişte aranacağı eksen ve durum. */
  kaynak?: { eksen: string; yeniDurum: string };
  /** Adımın sonucu olumsuzsa gösterilecek not (ret, kısmi kabul). */
  not?: string;
}

/** Zarf durumunun akıştaki sırası; ret ve hata sıralamaya girmez. */
const ZARF_SIRASI = ["kuyrukta", "iletildi", "kabul"];

function zarfIlerlemesi(durum: string | null | undefined): number {
  if (!durum) return -1;
  if (durum === "kismi_kabul" || durum === "ret") return ZARF_SIRASI.indexOf("kabul");
  return ZARF_SIRASI.indexOf(durum);
}

function adimDurumu(sira: number, ilerleme: number, hata: boolean): AdimDurumu {
  if (hata && sira === ilerleme + 1) return "hata";
  if (sira <= ilerleme) return "tamam";
  if (sira === ilerleme + 1) return "suanki";
  return "bekliyor";
}

/** Giden belgenin zarf adımları; başlıklar akışa göre adlandırılır. */
function gidenAdimlar(girdi: AkisGirdisi): Adim[] {
  const eksen = girdi.tur === "eirsaliye" ? "eirsaliye" : "ebelge";
  const hata = girdi.durum === "hata";
  const iptal = girdi.durum === "iptal";
  const ilerleme = zarfIlerlemesi(iptal ? girdi.ulasilanDurum : girdi.durum);
  // e-Arşiv'in zarfı alıcıya değil GİB'e gider; "alıcıya ulaştı" demek yanıltır.
  const ucuncuBaslik = girdi.tur === "earsiv" ? "GİB'e işlendi" : "Alıcıya ulaştı";
  const adimlar: Adim[] = [
    { anahtar: "gonderildi", baslik: "Belge gönderildi", durum: adimDurumu(0, ilerleme, hata), kaynak: { eksen, yeniDurum: "kuyrukta" } },
    { anahtar: "gib", baslik: "Maliyeye iletildi", durum: adimDurumu(1, ilerleme, hata), kaynak: { eksen, yeniDurum: "iletildi" } },
    { anahtar: "ulasti", baslik: ucuncuBaslik, durum: adimDurumu(2, ilerleme, hata), kaynak: { eksen, yeniDurum: "kabul" } },
  ];

  if (girdi.durum === "ret") {
    adimlar[2] = { ...adimlar[2], durum: "hata", baslik: ucuncuBaslik, not: "Zarf reddedildi" };
  }

  // e-İrsaliyede alıcı kararı zarfla aynı eksende taşınır; e-Faturada ayrı.
  if (girdi.tur === "eirsaliye") {
    const sonuc = girdi.durum === "kabul" ? "kabul" : girdi.durum === "kismi_kabul" ? "kismi_kabul" : girdi.durum === "ret" ? "ret" : null;
    adimlar[2] = { ...adimlar[2], baslik: "Alıcıya ulaştı", durum: adimDurumu(2, ilerleme, hata) };
    adimlar.push({
      anahtar: "yanit",
      baslik: sonuc === "ret" ? "Alıcı reddetti" : sonuc === "kismi_kabul" ? "Alıcı kısmen kabul etti" : "Alıcı kabul etti",
      durum: sonuc === null ? (ilerleme >= 2 ? "suanki" : "bekliyor") : sonuc === "ret" ? "hata" : "tamam",
      kaynak: sonuc ? { eksen: "eirsaliye", yeniDurum: sonuc } : undefined,
      not: sonuc === "kismi_kabul" ? "Bir kısmı reddedildi" : undefined,
    });
  } else if (girdi.tur === "efatura" && girdi.profil === "ticari") {
    // Temel faturada bu adım hiç gelmez, bu yüzden yalnız ticari profilde eklenir.
    adimlar.push({
      anahtar: "yanit",
      baslik: girdi.aliciYaniti === "ret" ? "Alıcı reddetti" : "Alıcı kabul etti",
      durum: girdi.aliciYaniti === "ret" ? "hata" : girdi.aliciYaniti === "kabul" ? "tamam" : ilerleme >= 2 ? "suanki" : "bekliyor",
      kaynak: girdi.aliciYaniti ? { eksen: "alici_yaniti", yeniDurum: girdi.aliciYaniti } : undefined,
    });
  }

  if (iptal) {
    // Tamamlanan adımlar olduğu gibi kalır: belge oraya kadar gerçekten gitti.
    let ilkIptal = true;
    return adimlar.map((a) => {
      if (a.durum === "tamam") return a;
      const not = ilkIptal ? "Belge iptal edildi" : undefined;
      ilkIptal = false;
      return { ...a, durum: "iptal" as const, not: a.not ?? not };
    });
  }
  return adimlar;
}

/** Gelen belgede akış terstir: belge bize ulaşır, yanıtı biz veririz. */
function gelenAdimlar(girdi: AkisGirdisi): Adim[] {
  const yanitlandi = girdi.tur === "gelen_efatura"
    ? girdi.durum === "islendi" || girdi.durum === "reddedildi"
    : girdi.durum === "kabul" || girdi.durum === "ret";
  const reddedildi = girdi.durum === "reddedildi" || girdi.durum === "ret";
  return [
    { anahtar: "geldi", baslik: "Belge bize ulaştı", durum: "tamam" },
    {
      anahtar: "yanit",
      baslik: reddedildi ? "Reddedildi" : yanitlandi ? (girdi.tur === "gelen_efatura" ? "İşlendi" : "Kabul edildi") : "Yanıt bekliyor",
      durum: reddedildi ? "hata" : yanitlandi ? "tamam" : "suanki",
    },
  ];
}

export function ebelgeAdimlari(girdi: AkisGirdisi): Adim[] {
  return girdi.tur === "gelen_efatura" || girdi.tur === "gelen_eirsaliye" ? gelenAdimlar(girdi) : gidenAdimlar(girdi);
}
