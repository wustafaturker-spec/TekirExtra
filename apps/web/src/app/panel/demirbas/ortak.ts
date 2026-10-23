/** DMR (§3.20): demirbaş ekranlarının ortak tipleri ve adları. */
export const SINIFLAR = {
  bina: "Bina", tesis_makine: "Tesis, makine ve cihaz", tasit: "Taşıt", demirbas: "Demirbaş", hak: "Hak", ozel_maliyet: "Özel maliyet",
} as const;
export type Sinif = keyof typeof SINIFLAR;

export const CIKIS_TURLERI = { satis: "Satış", hurda: "Hurdaya ayırma", kayip: "Kayıp", bagis: "Bağış" } as const;
export type CikisTuru = keyof typeof CIKIS_TURLERI;

export const YONTEMLER = { normal: "Normal", azalan: "Azalan bakiyeler" } as const;

export interface ListeKalemi { kod: string; ad: string; omur: number; sinif: Sinif; binekOto?: boolean; teblig: string }

export interface KartOzeti {
  id: string; kod: string; ad: string; sinif: Sinif; edinmeTarihi: string; bedel: string; birikmis: string; netDeger: string; buYil: string;
  faydaliOmur: number; yontem: "normal" | "azalan"; durum: "kullanimda" | "elden_cikti"; acilis: boolean;
  konum: string | null; zimmetli: string | null; cikisTuru: CikisTuru | null; cikisTarihi: string | null;
}

export interface FaturaSatirSecenegi {
  id: string; no: string | null; tarih: string; cari: string | null; dovizCinsi: string;
  satirlar: Array<{ id: string; stokAdi: string; stokTipi: string; miktar: string; birim: string; tutarTl: string; belgeTutari: string; bagliKartlar: Array<{ id: string; kod: string; ad: string; cikisBedeli?: string | null }> }>;
}

export const sayi = (v: string) => {
  const s = String(v).trim();
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) || 0;
};
