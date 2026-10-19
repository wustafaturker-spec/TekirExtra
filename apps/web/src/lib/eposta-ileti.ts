/** E-posta ekranındaki ileti penceresinin başlangıç değerleri (yeni / yanıt / tümünü yanıtla / ilet). */
export type IletiModu = "yeni" | "yanitla" | "tumunu" | "ilet";

export interface IletiKaynagi {
  id: string;
  gonderenAdi: string | null;
  gonderenEposta: string;
  aliciEposta: string;
  konu: string;
  icerikMetin: string | null;
  tarih: string;
}

export interface IletiTaslagi {
  mod: IletiModu;
  kime: string;
  konu: string;
  metin: string;
  /** Yalnız yanıtta: sunucu In-Reply-To/References zincirini bu iletiden kurar. */
  yanitlananId?: string;
}

const ALINTI_SINIRI = 20_000;
const ADRES = /[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g;

/** "Ad <a@b.com>, c@d.com" gibi metinden adresleri sırasıyla, tekrarsız ayıklar. */
export function adresleriAyikla(metin: string): string[] {
  const gorulen = new Set<string>();
  for (const a of metin.match(ADRES) ?? []) gorulen.add(a.toLowerCase());
  return [...gorulen];
}

function onekli(onek: "Ynt" | "İlt", konu: string): string {
  const temiz = konu.trim() || "(Konusuz)";
  const mevcut = onek === "Ynt" ? /^(re|ynt|yan[ıi]t)\s*:/i : /^(fwd?|ilt|i̇lt)\s*:/i;
  return mevcut.test(temiz) ? temiz : `${onek}: ${temiz}`;
}

function tarihMetni(tarih: string): string {
  const t = new Date(tarih);
  return Number.isNaN(t.getTime()) ? tarih : t.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function gonderenMetni(e: IletiKaynagi): string {
  return e.gonderenAdi ? `${e.gonderenAdi} <${e.gonderenEposta}>` : e.gonderenEposta;
}

export function iletiTaslagi(mod: IletiModu, e: IletiKaynagi | null): IletiTaslagi {
  if (mod === "yeni" || !e) return { mod: "yeni", kime: "", konu: "", metin: "" };
  const govde = (e.icerikMetin ?? "").slice(0, ALINTI_SINIRI).trimEnd();
  if (mod === "ilet") {
    return {
      mod,
      kime: "",
      konu: onekli("İlt", e.konu),
      metin: `\n\n---------- İletilen ileti ----------\nKimden: ${gonderenMetni(e)}\nTarih: ${tarihMetni(e.tarih)}\nKonu: ${e.konu}\nKime: ${e.aliciEposta}\n\n${govde}`,
    };
  }
  const kime = mod === "tumunu" ? adresleriAyikla(`${e.gonderenEposta}, ${e.aliciEposta}`) : [e.gonderenEposta.toLowerCase()];
  const alinti = govde.split("\n").map((s) => `> ${s}`).join("\n");
  return {
    mod,
    kime: kime.join(", "),
    konu: onekli("Ynt", e.konu),
    metin: `\n\n${tarihMetni(e.tarih)} tarihinde ${gonderenMetni(e)} yazdı:\n${alinti}`,
    yanitlananId: e.id,
  };
}
