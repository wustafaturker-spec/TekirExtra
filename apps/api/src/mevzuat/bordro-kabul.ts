import { z } from "zod";
import { bordroHesapla } from "../personel/bordro-hesaplama";
import { bordroParametreleri } from "../personel/bordro-mevzuati";
import { bordroHesaplamaSemasi } from "../personel/mevzuat.semalar";

/**
 * MVZ-14: bordro parametresi değişikliğinin kabul senaryoları. Platform ekibi
 * resmî kaynaktan bilinen sonuçları (ör. asgari ücretin neti) girer; senaryo
 * değişiklikteki yeni değerle hesaplanır ve tolerans içinde tutmalıdır.
 */

const ornek = bordroHesapla(bordroParametreleri({ asgariUcretBrut: 1, sgkTavan: 1, gelirVergisiDilimleri: [{ ustSinir: null, oran: 15 }] }), { brutUcret: 1, primGunu: 30, oncekiKumulatifMatrah: 0, oncekiAsgariKumulatifMatrah: 0 });
/** Beklenen değer girilebilecek sayısal sonuç alanları. */
export const KABUL_SONUC_ALANLARI = Object.entries(ornek).filter(([, v]) => typeof v === "string" && v !== "" && Number.isFinite(Number(v))).map(([k]) => k);

export const kabulSenaryosuSemasi = z.object({
  ad: z.string().trim().min(3).max(120),
  girdiler: bordroHesaplamaSemasi.omit({ yil: true, ay: true }),
  beklenen: z.record(z.string(), z.coerce.number().min(0)).superRefine((b, ctx) => {
    if (!Object.keys(b).length) ctx.addIssue({ code: "custom", message: "En az bir beklenen sonuç girilmelidir" });
    for (const k of Object.keys(b)) if (!KABUL_SONUC_ALANLARI.includes(k)) ctx.addIssue({ code: "custom", path: [k], message: `Bilinmeyen sonuç alanı: ${k}` });
  }),
  tolerans: z.coerce.number().min(0).max(10).default(0.01),
});
export const kabulSenaryolariSemasi = z.object({ senaryolar: z.array(kabulSenaryosuSemasi).max(30) });
export type KabulSenaryosuGirdisi = z.infer<typeof kabulSenaryosuSemasi>;

export interface KabulSonucu {
  basarili: boolean;
  /** Beklenen her alan için hesaplanan değer ve fark. */
  alanlar: Record<string, { beklenen: number; hesaplanan: number; fark: number }>;
}

export function kabulCalistir(deger: unknown, s: { girdiler: unknown; beklenen: unknown; tolerans: number | { toNumber(): number } }): KabulSonucu {
  const tolerans = typeof s.tolerans === "number" ? s.tolerans : s.tolerans.toNumber();
  const girdiler = bordroHesaplamaSemasi.omit({ yil: true, ay: true }).parse(s.girdiler);
  const sonuc = bordroHesapla(bordroParametreleri(deger), girdiler) as unknown as Record<string, unknown>;
  const alanlar: KabulSonucu["alanlar"] = {};
  for (const [k, v] of Object.entries(s.beklenen as Record<string, number>)) {
    const hesaplanan = Number(sonuc[k]);
    alanlar[k] = { beklenen: v, hesaplanan, fark: Math.round(Math.abs(hesaplanan - v) * 100) / 100 };
  }
  const basarili = Object.values(alanlar).every((a) => Number.isFinite(a.hesaplanan) && a.fark <= tolerans);
  return { basarili, alanlar };
}
