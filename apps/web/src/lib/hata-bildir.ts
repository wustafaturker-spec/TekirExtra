import { ApiHata, arkaPlanIstegi } from "./api";

/**
 * PLT-119: tarayıcı hataları sunucudaki gruplu hata kaydına gönderilir. Aynı hata kısa
 * sürede bir kez, sayfa başına en fazla `SAYFA_SINIRI` kez bildirilir; döngüye giren bir
 * ekran isteği boğmasın. Sorgu dizesi gönderilmez.
 */
const SAYFA_SINIRI = 10;
const TEKRAR_ARALIGI_MS = 60_000;
const sonBildirim = new Map<string, number>();
let gonderilen = 0;

/** Bildirilmeyecek gürültü: tarayıcı eklentileri, iptal edilen istekler, bağlantı kopması. */
const YOKSAY = [/ResizeObserver loop/i, /AbortError/i, /The user aborted/i, /Sunucuya bağlanılamadı/, /Load failed/i, /Failed to fetch/i, /^Script error\.?$/i, /chrome-extension:|moz-extension:/i];

export function hataBildir(hata: unknown, kaynak = "pencere"): void {
  if (typeof window === "undefined" || gonderilen >= SAYFA_SINIRI) return;
  const e = hata instanceof Error ? hata : null;
  const mesaj = (e?.message ?? (typeof hata === "string" ? hata : (() => { try { return JSON.stringify(hata); } catch { return String(hata); } })())).slice(0, 1000);
  const yigin = e?.stack?.slice(0, 4000);
  if (!mesaj.trim() || YOKSAY.some((d) => d.test(mesaj) || (yigin ? d.test(yigin) : false))) return;
  // ApiHata, sunucunun zaten bildiği (4xx) ya da kaydettiği (5xx) yanıttır; ikinci kez bildirilmez.
  if (hata instanceof ApiHata) return;
  const anahtar = `${e?.name ?? kaynak}|${mesaj.slice(0, 200)}`;
  const simdi = Date.now();
  if ((sonBildirim.get(anahtar) ?? 0) > simdi - TEKRAR_ARALIGI_MS) return;
  sonBildirim.set(anahtar, simdi);
  gonderilen += 1;
  arkaPlanIstegi("/istemci-hata", { ad: (e?.name ?? kaynak).slice(0, 200), mesaj, yigin, sayfa: window.location.pathname });
}
