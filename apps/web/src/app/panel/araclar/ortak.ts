/** ARC (§3.21): araç ekranlarının ortak adları ve tipleri. */
export const TURLER = { binek: "Binek", hafif_ticari: "Hafif ticari", agir_vasita: "Ağır vasıta", motosiklet: "Motosiklet", is_makinesi: "İş makinesi", diger: "Diğer" } as const;
export const MULKIYETLER = { oz: "Öz mal", kiralik: "Kiralık", diger: "Diğer" } as const;
export const YAKITLAR = { benzin: "Benzin", dizel: "Dizel", lpg: "LPG", elektrik: "Elektrik", hibrit: "Hibrit", diger: "Diğer" } as const;
export const YUKUMLULUKLER = { muayene: "Muayene", trafik_sigortasi: "Trafik sigortası", kasko: "Kasko", mtv: "MTV", egzoz: "Egzoz emisyon", takograf: "Takograf", diger: "Diğer" } as const;
export const KATEGORILER = { akaryakit: "Akaryakıt", bakim: "Bakım-onarım", lastik: "Lastik", hgs: "HGS/OGS", otopark: "Otopark", sigorta: "Sigorta", mtv: "MTV", ceza: "Ceza", kira: "Kira", diger: "Diğer" } as const;
export type Kategori = keyof typeof KATEGORILER;

export interface BakimDurumu { tarih: string | null; km: number | null; kalanGun: number | null; kalanKm: number | null; gecikti: boolean; yaklasiyor: boolean }

export interface AracOzeti {
  id: string; plaka: string; marka: string | null; model: string | null; modelYili: number | null; tur: keyof typeof TURLER | null; mulkiyet: keyof typeof MULKIYETLER | null;
  aktif: boolean; km: number | null; sorumlu: string | null;
  enYakinYukumluluk: { tur: keyof typeof YUKUMLULUKLER; bitis: string; kalanGun: number; esik: "doldu" | "7" | "30" | null } | null;
  bakim: BakimDurumu | null;
}

export const sayi = (v: string) => {
  const s = String(v).trim();
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0;
};

export function kalanMetni(gun: number | null | undefined): string {
  if (gun == null) return "";
  if (gun < 0) return `${-gun} gün geçti`;
  if (gun === 0) return "bugün";
  return `${gun} gün kaldı`;
}
