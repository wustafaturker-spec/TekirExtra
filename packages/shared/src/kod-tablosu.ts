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

export interface KodTablosu {
  kdvOranlari: KdvOrani[];
  istisna: IstisnaKodu[];
  ozelMatrah: OzelMatrahKodu[];
  ihracKayitli: { kod: string; ad: string }[];
}

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
};

type Kayit = { anahtar: string; deger: unknown };
const ad = (d: unknown) => (d && typeof d === "object" && typeof (d as { ad?: unknown }).ad === "string" ? (d as { ad: string }).ad : "");
const kodSirasi = (a: { kod: string }, b: { kod: string }) => a.kod.localeCompare(b.kod);

/** Merkezi kayıtlardan (belge tarihinde yürürlükteki) kod tablosu. */
export function kodTablosuKur(kayitlar: { kdvOrani: Kayit[]; istisna: Kayit[]; ozelMatrah: Kayit[]; ihracKayitli: Kayit[] }): KodTablosu {
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
  };
}

/** Oran belge tarihindeki listede değilse kullanıcıya gösterilecek mesaj. */
export function kdvOraniHatasi(oran: number | string, oranlar: readonly KdvOrani[]): string | null {
  const o = Number(oran);
  if (oranlar.some((k) => k.oran === o)) return null;
  return `KDV oranı %${o.toLocaleString("tr-TR")} belge tarihinde geçerli değil; geçerli oranlar: ${oranlar.map((k) => `%${k.oran}`).join(", ")}`;
}
