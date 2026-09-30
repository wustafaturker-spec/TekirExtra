import type { AramaSecenegi } from "@/components/arama-secici";

/** Stok listesinin taşıdığı aktif varyant özeti (GET /stok). */
export interface ListeVaryanti {
  id: string;
  kod: string;
  ad: string;
  barkod?: string | null;
  nitelikler?: Record<string, string> | unknown;
  mevcutMiktar: string;
  aktif?: boolean;
}

const AYRAC = "::";

/**
 * Belge satırı aramasında varyantlar ayrı seçenektir: varyant kodu, barkodu
 * ya da nitelik değeri yazılınca satır doğrudan o varyantla gelir. Değer
 * "stokId::varyantId" biçimindedir; `varyantDegeriCoz` ile ayrılır.
 */
export function varyantSecenekleri(stoklar: { id: string; ad: string; varyantlar?: ListeVaryanti[] }[]): AramaSecenegi[] {
  return stoklar.flatMap((stok) => (stok.varyantlar ?? []).map((v) => {
    const nitelikler = v.nitelikler && typeof v.nitelikler === "object" ? Object.values(v.nitelikler as Record<string, string>) : [];
    return {
      deger: `${stok.id}${AYRAC}${v.id}`,
      baslik: `${stok.ad} — ${v.ad}`,
      aciklama: [v.kod, v.barkod && `Barkod: ${v.barkod}`, `Stok: ${Number(v.mevcutMiktar).toLocaleString("tr-TR")}`].filter(Boolean).join(" · "),
      aramaMetni: [v.kod, v.barkod, ...nitelikler].filter(Boolean).join(" "),
    };
  }));
}

/** Arama değerini ürün ve (varsa) varyant kimliğine ayırır. */
export function varyantDegeriCoz(deger: string): { stokId: string; varyantId?: string } {
  const [stokId, varyantId] = deger.split(AYRAC);
  return varyantId ? { stokId, varyantId } : { stokId };
}
