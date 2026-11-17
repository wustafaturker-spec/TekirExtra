import type { CariIletisimCikarim } from "../ai/ai.semalar";
import { PANEL_SECENEGI, type Secenek } from "./asistan-soru.kurallari";

/** CNL-23: belgeden açılabilecek cari türleri (personel/ortak bu yoldan açılmaz). */
export type CariBelgeTipi = "musteri" | "tedarikci" | "her_ikisi";
export const CARI_TIP_ADLARI: Record<CariBelgeTipi, string> = { musteri: "Müşteri", tedarikci: "Tedarikçi", her_ikisi: "Her ikisi" };

// \b Türkçe harflerde çalışmaz; kelime sınırı harf olmayan karakterle aranır.
const kelime = (k: string) => new RegExp(`(?<!\\p{L})(${k})`, "iu");
const CARI_KELIMELERI = kelime("cari|müşteri|musteri|tedarikçi|tedarikci|kartvizit|firma kartı|firma karti");
const HER_IKISI = kelime("her ikisi|her_ikisi|ikisi de|hem müşteri|hem musteri");
const MUSTERI = kelime("müşteri|musteri|alıcı|alici");
const TEDARIKCI = kelime("tedarikçi|tedarikci|satıcı|satici");

/**
 * CNL-23: Telegram görselinin açıklamasından yol. Cari sözcükleri varsa cari akışı (ve varsa tür);
 * yoksa bugünkü masraf akışı.
 */
export function belgeYolu(aciklama: string | null | undefined): { yol: "cari" | "masraf"; tip?: CariBelgeTipi } {
  const m = (aciklama ?? "").toLocaleLowerCase("tr");
  if (!CARI_KELIMELERI.test(m)) return { yol: "masraf" };
  const tip: CariBelgeTipi | undefined = HER_IKISI.test(m) ? "her_ikisi" : MUSTERI.test(m) && TEDARIKCI.test(m) ? "her_ikisi" : MUSTERI.test(m) ? "musteri" : TEDARIKCI.test(m) ? "tedarikci" : undefined;
  return { yol: "cari", ...(tip ? { tip } : {}) };
}

/** Açıklamasız görselde cari yoluna geçmek için unvan ve en az bir kimlik/iletişim bilgisi gerekir. */
export function cariBilgisiYeterli(v: Pick<CariIletisimCikarim, "unvan" | "vknTckn" | "vergiDairesi" | "eposta">): boolean {
  return (v.unvan ?? "").trim().length >= 2 && !!(v.vknTckn || v.vergiDairesi?.trim() || v.eposta);
}

/**
 * Firmanın kod düzenine göre sıradaki kod: en çok kullanılan "önek + sayı" kalıbında en büyük
 * sayının bir fazlası, aynı basamak genişliğiyle. Kalıp yoksa CARI-001.
 */
export function sonrakiCariKodu(kodlar: string[]): string {
  const kalip = new Map<string, { adet: number; enBuyuk: number; genislik: number }>();
  for (const kod of kodlar) {
    const e = /^(.*?)(\d+)$/.exec(kod);
    if (!e || e[2].length > 9) continue;
    const k = kalip.get(e[1]) ?? { adet: 0, enBuyuk: 0, genislik: 0 };
    kalip.set(e[1], { adet: k.adet + 1, enBuyuk: Math.max(k.enBuyuk, Number(e[2])), genislik: Math.max(k.genislik, e[2].length) });
  }
  const [onek, k] = [...kalip.entries()].sort((a, b) => b[1].adet - a[1].adet)[0] ?? ["CARI-", { enBuyuk: 0, genislik: 3 }];
  const kullanilan = new Set(kodlar);
  let n = k.enBuyuk;
  let aday: string;
  do { n += 1; aday = `${onek}${String(n).padStart(k.genislik, "0")}`; } while (kullanilan.has(aday));
  return aday.slice(0, 32);
}

export interface CariTaslagi {
  kod: string; unvan: string; tip: CariBelgeTipi; kisiTipi: "gercek" | "tuzel";
  vknTckn?: string; vergiDairesi?: string; eposta?: string; telefon?: string; webSitesi?: string;
  faturaAdresi?: { adres: string; il?: string; ilce?: string; postaKodu?: string };
}

const kirp = (s: string | null | undefined, n: number) => { const t = s?.replace(/\s+/g, " ").trim(); return t ? t.slice(0, n) : undefined; };

/** Okunan bilgiden cari_olustur girdisi; boş alan yazılmaz. */
export function cariTaslagi(v: CariIletisimCikarim, kod: string, tip: CariBelgeTipi): CariTaslagi {
  const adres = kirp(v.adres, 500);
  const t: CariTaslagi = {
    kod, unvan: kirp(v.unvan, 255)!, tip, kisiTipi: v.kisiTipi === "gercek" ? "gercek" : "tuzel",
    vknTckn: v.vknTckn ?? undefined, vergiDairesi: kirp(v.vergiDairesi, 120), eposta: kirp(v.eposta, 255),
    telefon: kirp(v.telefon, 32), webSitesi: kirp(v.webSitesi, 255),
    ...(adres && adres.length >= 2 ? { faturaAdresi: { adres, il: kirp(v.il, 60), ilce: kirp(v.ilce, 60), postaKodu: kirp(v.postaKodu, 10) } } : {}),
  };
  return Object.fromEntries(Object.entries(t).filter(([, x]) => x !== undefined)) as unknown as CariTaslagi;
}

/** Okunanların kullanıcıya özeti (tek satır). */
export function cariOzeti(t: Omit<CariTaslagi, "kod" | "tip">): string {
  const yer = t.faturaAdresi ? [t.faturaAdresi.ilce, t.faturaAdresi.il].filter(Boolean).join("/") : "";
  return [t.unvan, t.vknTckn ? `VKN ${t.vknTckn}` : null, t.vergiDairesi ? `${t.vergiDairesi} VD` : null, yer || null, t.eposta ?? null, t.webSitesi ?? null].filter(Boolean).join(" · ");
}

export function cariTipSorusu(t: Omit<CariTaslagi, "kod" | "tip">): { soru: string; secenekler: Secenek[] } {
  return {
    soru: `Görselden cari bilgisi okudum: ${cariOzeti(t)}.\nBu cari kartını hangi türle açayım?`,
    secenekler: [...(Object.keys(CARI_TIP_ADLARI) as CariBelgeTipi[]).map((k) => ({ kod: k, etiket: CARI_TIP_ADLARI[k] })), PANEL_SECENEGI],
  };
}
