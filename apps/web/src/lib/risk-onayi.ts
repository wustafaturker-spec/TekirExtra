import { ApiHata } from "@/lib/api";

/** CARI-32: sunucunun yöneticiden gerekçe istediği risk aşımı yanıtının işareti. */
const GEREKCE_ISTENIYOR = "yönetici onayı gerekir — gerekçe yazın";

/**
 * Risk limiti politikası "yönetici onayı" iken yöneticiye gerekçe sorar ve
 * isteği gerekçeyle yineler. Diğer hatalar (engelle, yönetici olmayan kullanıcı)
 * olduğu gibi döner.
 */
export async function riskOnayiylaGonder<T>(istek: (riskOnayGerekcesi?: string) => Promise<T>): Promise<T> {
  try {
    return await istek();
  } catch (h) {
    if (!(h instanceof ApiHata) || h.durum !== 409 || !h.message.includes(GEREKCE_ISTENIYOR)) throw h;
    const gerekce = window.prompt(`${h.message.replace(` — gerekçe yazın`, "")}.\n\nAşımı onaylamak için gerekçe yazın (denetim izine kaydedilir):`);
    if (!gerekce?.trim()) throw new Error("Risk limiti aşımı onaylanmadı; belge işlenmedi.");
    return istek(gerekce.trim());
  }
}
