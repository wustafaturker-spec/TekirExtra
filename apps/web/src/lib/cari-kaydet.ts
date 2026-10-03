import { api, ApiHata } from "@/lib/api";

/** CARI-35: sunucunun aynı VKN/TCKN için onay istediği yanıtın işareti. */
const MUKERRER_VKN_ISARETI = "aynı kimlikle yine de kaydetmek için onaylayın";

/**
 * Cari oluşturma/güncelleme isteği. VKN/TCKN başka caride kayıtlıysa
 * kullanıcıya sorar; onaylarsa isteği `mukerrerVknOnayi` ile yineler.
 */
export async function cariKaydet<T = unknown>(yol: string, method: "POST" | "PATCH", govde: Record<string, unknown>): Promise<T> {
  const gonder = (onay: boolean) => api<T>(yol, { method, body: JSON.stringify(onay ? { ...govde, mukerrerVknOnayi: true } : govde) });
  try {
    return await gonder(false);
  } catch (h) {
    if (!(h instanceof ApiHata) || h.durum !== 409 || !h.message.includes(MUKERRER_VKN_ISARETI)) throw h;
    const kayitli = h.message.replace(`; ${MUKERRER_VKN_ISARETI}`, "");
    if (!window.confirm(`Bu VKN/TCKN zaten kayıtlı: ${kayitli}.\n\nŞube gibi bilinçli bir ayrım değilse mevcut cariyi kullanın. Yine de kaydedilsin mi?`)) {
      throw new Error("Kaydedilmedi: aynı VKN/TCKN başka caride kayıtlı.");
    }
    return gonder(true);
  }
}
