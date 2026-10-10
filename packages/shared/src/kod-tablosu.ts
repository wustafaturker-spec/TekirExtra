/**
 * Belge tarihindeki KDV kod tablosu (MVZ-11, karar 2026-10-09).
 *
 * KDV oranları, istisna, özel matrah ve ihraç kayıtlı kodları Mevzuat
 * Merkezi'nde yürürlük tarihli tutulur; belge kendi tarihindeki listeyle
 * doğrulanır (ör. 10.07.2023 öncesi %8/%18, sonrası %10/%20 — CK 7346).
 * Sabit listeler (`KDV_ISTISNA_KODLARI` vb.) yalnız merkezin ilk dolumu ve
 * merkez okunamayan ortamlar (birim testleri) içindir.
 */
import { IHRAC_KAYITLI_KODLARI, KDV_ISTISNA_KODLARI, OZEL_MATRAH_KODLARI, type IstisnaKodu, type IstisnaTuru, type OzelMatrahKodu } from "./gib-kodlari";

export interface KdvOrani {
  oran: number;
  aciklama?: string;
}

/**
 * EBLG-120: KDV dışı vergi türü (UBL TaxTypeCode). Stopaj alıcı tarafından
 * kesilir ve ödenecekten düşer; diğerleri bedele eklenir. KDV matrahına
 * dahil olanlar (ÖTV, ÖİV…) KDV'yi de artırır.
 */
export interface VergiTuru {
  kod: string;
  ad: string;
  stopaj: boolean;
  kdvMatrahinaDahil: boolean;
}

export interface KodTablosu {
  kdvOranlari: KdvOrani[];
  istisna: IstisnaKodu[];
  ozelMatrah: OzelMatrahKodu[];
  ihracKayitli: { kod: string; ad: string }[];
  vergiTurleri: VergiTuru[];
}

/** Merkezdeki ilk dolumla aynı liste (göç 20261011090000_kdv_disi_vergiler); merkeze erişilemeyen yerde varsayılan. */
export const VARSAYILAN_VERGI_TURLERI: readonly VergiTuru[] = [
  { kod: "0003", ad: "Gelir Vergisi Stopajı", stopaj: true, kdvMatrahinaDahil: false },
  { kod: "0011", ad: "Kurumlar Vergisi Stopajı", stopaj: true, kdvMatrahinaDahil: false },
  { kod: "0021", ad: "Banka Muameleleri Vergisi", stopaj: false, kdvMatrahinaDahil: false },
  { kod: "0022", ad: "Sigorta Muameleleri Vergisi", stopaj: false, kdvMatrahinaDahil: false },
  { kod: "0059", ad: "Konaklama Vergisi", stopaj: false, kdvMatrahinaDahil: false },
  { kod: "0061", ad: "Kaynak Kullanımını Destekleme Fonu Kesintisi", stopaj: false, kdvMatrahinaDahil: true },
  { kod: "0071", ad: "ÖTV I. Liste (petrol ve doğalgaz ürünleri)", stopaj: false, kdvMatrahinaDahil: true },
  { kod: "0073", ad: "ÖTV III. Liste (kolalı gazoz, alkollü içki, tütün)", stopaj: false, kdvMatrahinaDahil: true },
  { kod: "0074", ad: "ÖTV IV. Liste (dayanıklı tüketim ve diğer mallar)", stopaj: false, kdvMatrahinaDahil: true },
  { kod: "4080", ad: "Özel İletişim Vergisi", stopaj: false, kdvMatrahinaDahil: false },
  { kod: "8001", ad: "Borsa Tescil Ücreti", stopaj: false, kdvMatrahinaDahil: false },
  { kod: "8005", ad: "Elektrik Tüketim Vergisi", stopaj: false, kdvMatrahinaDahil: true },
  { kod: "9021", ad: "4961 Banka Sigorta Muameleleri Vergisi", stopaj: false, kdvMatrahinaDahil: false },
  { kod: "9077", ad: "ÖTV II. Liste (motorlu taşıtlar)", stopaj: false, kdvMatrahinaDahil: true },
];

export const vergiTuruBul = (kod: string | null | undefined, liste: readonly VergiTuru[] = VARSAYILAN_VERGI_TURLERI) =>
  kod ? liste.find((v) => v.kod === kod) : undefined;

/** Bugünkü oranlar; %0 istisna kodu ister. */
export const VARSAYILAN_KDV_ORANLARI: readonly KdvOrani[] = [
  { oran: 0, aciklama: "KDV'siz — istisna kodu gerekir" },
  { oran: 1, aciklama: "İndirimli oran" },
  { oran: 10, aciklama: "İndirimli oran" },
  { oran: 20, aciklama: "Genel oran" },
];

export const VARSAYILAN_KOD_TABLOSU: KodTablosu = {
  kdvOranlari: [...VARSAYILAN_KDV_ORANLARI],
  istisna: [...KDV_ISTISNA_KODLARI],
  ozelMatrah: [...OZEL_MATRAH_KODLARI],
  ihracKayitli: [...IHRAC_KAYITLI_KODLARI],
  vergiTurleri: [...VARSAYILAN_VERGI_TURLERI],
};

type Kayit = { anahtar: string; deger: unknown };
const ad = (d: unknown) => (d && typeof d === "object" && typeof (d as { ad?: unknown }).ad === "string" ? (d as { ad: string }).ad : "");
const kodSirasi = (a: { kod: string }, b: { kod: string }) => a.kod.localeCompare(b.kod);

/** Merkezi kayıtlardan (belge tarihinde yürürlükteki) kod tablosu. */
export function kodTablosuKur(kayitlar: { kdvOrani: Kayit[]; istisna: Kayit[]; ozelMatrah: Kayit[]; ihracKayitli: Kayit[]; vergiTuru?: Kayit[] }): KodTablosu {
  return {
    kdvOranlari: kayitlar.kdvOrani
      .map((k) => ({ oran: Number(k.anahtar), aciklama: (k.deger as { aciklama?: string } | null)?.aciklama || undefined }))
      .filter((k) => Number.isFinite(k.oran))
      .sort((a, b) => a.oran - b.oran),
    istisna: kayitlar.istisna
      .map((k) => ({ kod: k.anahtar, ad: ad(k.deger), tur: ((k.deger as { istisnaTuru?: IstisnaTuru } | null)?.istisnaTuru ?? "tam") as IstisnaTuru }))
      .sort(kodSirasi),
    ozelMatrah: kayitlar.ozelMatrah.map((k) => ({ kod: k.anahtar, ad: ad(k.deger) })).sort(kodSirasi),
    ihracKayitli: kayitlar.ihracKayitli.map((k) => ({ kod: k.anahtar, ad: ad(k.deger) })).sort(kodSirasi),
    vergiTurleri: (kayitlar.vergiTuru ?? []).map((k) => {
      const d = (k.deger ?? {}) as { davranis?: string; kdvMatrahi?: string };
      return { kod: k.anahtar, ad: ad(k.deger), stopaj: d.davranis === "stopaj", kdvMatrahinaDahil: d.kdvMatrahi === "dahil" };
    }).sort(kodSirasi),
  };
}

/** Oran belge tarihindeki listede değilse kullanıcıya gösterilecek mesaj. */
export function kdvOraniHatasi(oran: number | string, oranlar: readonly KdvOrani[]): string | null {
  const o = Number(oran);
  if (oranlar.some((k) => k.oran === o)) return null;
  return `KDV oranı %${o.toLocaleString("tr-TR")} belge tarihinde geçerli değil; geçerli oranlar: ${oranlar.map((k) => `%${k.oran}`).join(", ")}`;
}
