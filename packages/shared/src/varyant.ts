/**
 * Stok varyantlarının adlandırma kuralları. Belge satırı, PDF ve UBL aynı
 * biçimi kullanır: ad "Tişört — Siyah / M", açıklama "Renk: Siyah, Beden: M",
 * kod varyant kodu.
 */
export interface VaryantOzet {
  kod: string;
  ad: string;
  nitelikler?: Record<string, string> | unknown;
}

const nitelikKayitlari = (nitelikler: unknown): [string, string][] =>
  nitelikler && typeof nitelikler === "object" && !Array.isArray(nitelikler)
    ? Object.entries(nitelikler as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v)])
    : [];

/** Satırda görünen ad: varyant varsa "Ana ad — Varyant adı". */
export function varyantliAd(stokAd: string, varyant?: VaryantOzet | null): string {
  return varyant ? `${stokAd} — ${varyant.ad}` : stokAd;
}

/** Satır kodu: varyant varsa varyant kodu (satılan kalemin kendisi). */
export function varyantliKod(stokKod: string, varyant?: VaryantOzet | null): string {
  return varyant?.kod || stokKod;
}

/** Nitelik açıklaması: "Renk: Siyah, Beden: M"; nitelik yoksa boş. */
export function varyantAciklamasi(varyant?: VaryantOzet | null): string {
  return varyant ? nitelikKayitlari(varyant.nitelikler).map(([k, v]) => `${k}: ${v}`).join(", ") : "";
}

/** Kod parçası: Türkçe harfler sadeleşir, büyük harf, harf/rakam dışı tire olur. */
export function kodParcasi(deger: string): string {
  const harita: Record<string, string> = { ç: "C", Ç: "C", ğ: "G", Ğ: "G", ı: "I", I: "I", İ: "I", i: "I", ö: "O", Ö: "O", ş: "S", Ş: "S", ü: "U", Ü: "U" };
  return deger.trim().replace(/[çÇğĞıIİiöÖşŞüÜ]/g, (h) => harita[h] ?? h).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface NitelikTanimi {
  ad: string;
  degerler: string[];
}

export interface VaryantOnerisi {
  kod: string;
  ad: string;
  nitelikler: Record<string, string>;
}

/**
 * Niteliklerin tüm kombinasyonları: Renk [Siyah, Beyaz] × Beden [S, M] → 4
 * varyant. Kod ANAKOD-SIYAH-S, ad "Siyah / S". Boş nitelik ve tekrarlı
 * değerler atlanır.
 */
export function varyantKombinasyonlari(anaKod: string, tanimlar: NitelikTanimi[]): VaryantOnerisi[] {
  const temiz = tanimlar
    .map((t) => ({ ad: t.ad.trim(), degerler: [...new Set(t.degerler.map((d) => d.trim()).filter(Boolean))] }))
    .filter((t) => t.ad && t.degerler.length);
  if (!temiz.length) return [];
  let kombinasyonlar: Record<string, string>[] = [{}];
  for (const t of temiz) kombinasyonlar = kombinasyonlar.flatMap((k) => t.degerler.map((d) => ({ ...k, [t.ad]: d })));
  return kombinasyonlar.map((nitelikler) => {
    const degerler = temiz.map((t) => nitelikler[t.ad]);
    return { kod: [kodParcasi(anaKod), ...degerler.map(kodParcasi)].filter(Boolean).join("-"), ad: degerler.join(" / "), nitelikler };
  });
}
