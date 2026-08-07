import { api, tokenAl } from "./api";

export type KullanimOlayi = "fatura_form_acildi" | "fatura_tamamlandi" | "fatura_dogrulama_hatasi" | "fatura_form_terk" | "gorunum_kaydedildi" | "gorunum_kullanildi" | "belgeler_csv_indirildi";

export function kullanimOlayi(olay: KullanimOlayi, sureMs?: number): void {
  if (!tokenAl()) return;
  void api("/kullanim/olay", { method: "POST", body: JSON.stringify({ olay, ...(sureMs === undefined ? {} : { sureMs: Math.max(0, Math.round(sureMs)) }) }) }).catch(() => undefined);
}
