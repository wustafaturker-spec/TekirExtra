import { z } from "zod";
import type { AiAracTanimi } from "../../saglayici/ai-provider.interface";
import { jsonSemaSadelestir } from "../../saglayici/aracli-ortak";
import type { AjanAraci } from "./arac";
import { OKUMA_ARACLARI } from "./okuma";
import { ONAYLI_ARACLAR } from "./onayli";
import { TASLAK_ARACLARI } from "./taslak";
import { MODUL_ARACLARI } from "./moduller";
import { FIYAT_ENDEKS_ARACLARI } from "./fiyat-endeks";
import { DOSYA_ARACLARI } from "./dosya";
import { LISTE_DOSYASI_ARACI } from "./liste-dosyasi";
import { ARAYUZ_ARACLARI } from "../arayuz-eylemleri";
import { CRM_ARACLARI, PERSONEL_ARACLARI, URETIM_ARACLARI } from "./uretim-personel-crm";

export type { AjanAraci, AracBaglami, AracSinifi } from "./arac";

/** AI-06: ilk araç seti. Silme aracı bilerek yoktur (AI-03). */
export const AJAN_ARACLARI: AjanAraci[] = [...OKUMA_ARACLARI, ...TASLAK_ARACLARI, ...ONAYLI_ARACLAR, ...MODUL_ARACLARI, ...CRM_ARACLARI, ...URETIM_ARACLARI, ...PERSONEL_ARACLARI, ...FIYAT_ENDEKS_ARACLARI, ...DOSYA_ARACLARI, LISTE_DOSYASI_ARACI, ...ARAYUZ_ARACLARI];

const ARAC_HARITASI = new Map(AJAN_ARACLARI.map((a) => [a.ad, a]));

export function aracBul(ad: string): AjanAraci | undefined {
  return ARAC_HARITASI.get(ad);
}

const SINIF_NOTU: Record<string, string> = {
  okuma: "",
  taslak: " [Taslak açar; onaylamaz.]",
  onay: " [ONAY GEREKİR: işlem yapılmaz, kullanıcıya onay talebi düşer.]",
};

/** Modele sunulan tanım; sınıf açıklamaya yazılır ki model onay gerektiğini söylesin. */
export function aracTanimi(a: AjanAraci): AiAracTanimi {
  return {
    ad: a.ad,
    aciklama: a.aciklama + SINIF_NOTU[a.sinif],
    girdiSemasi: jsonSemaSadelestir(z.toJSONSchema(a.girdi, { io: "input", unrepresentable: "any" })),
  };
}
