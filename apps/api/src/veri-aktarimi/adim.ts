import { z } from "zod";

/** VAK-01: sihirbaz adımları (geçiş tarihi ve özet dışında, dosya yüklenen adımlar). */
export const ADIMLAR = ["cari", "stok", "acilis_stok", "kasa_banka", "acik_fatura"] as const;
export type Adim = (typeof ADIMLAR)[number];

export const ADIM_ADLARI: Record<Adim, string> = {
  cari: "Cari kartlar",
  stok: "Stok kartları",
  acilis_stok: "Açılış stoğu",
  kasa_banka: "Kasa/banka açılışları",
  acik_fatura: "Açık faturalar",
};

export const VERI_AKTARIMI_MODULU = "veri_aktarimi";
export const veriAktarimiAyariSemasi = z.object({ gecisTarihi: z.iso.date().nullable() });

export type SatirDurumu = "yeni" | "guncelle" | "degisiklik_yok" | "hatali";

/** Önizlemenin satır sonucu: hangi kayda ne olacağı, hatalar ve uyarılar. */
export interface SatirSonucu {
  satir: number;
  durum: SatirDurumu;
  /** Kayıt kimliği (kod, belge no, hesap adı). */
  etiket: string;
  /** Kısa açıklama (ünvan, ürün adı, tutar). */
  aciklama: string;
  hatalar: string[];
  uyarilar: string[];
}

/** VAK-07: partinin oluşturduğu kayıtlar; geri alma bunlardan yapılır. */
export interface Olusturulanlar {
  cariler: string[];
  stoklar: string[];
  cariHareketler: string[];
  stokHareketleri: string[];
  kasaBankaHareketleri: string[];
}

export const bosOlusturulanlar = (): Olusturulanlar => ({ cariler: [], stoklar: [], cariHareketler: [], stokHareketleri: [], kasaBankaHareketleri: [] });

export function ozetle(satirlar: { durum: SatirDurumu }[]) {
  const say = (d: SatirDurumu) => satirlar.filter((s) => s.durum === d).length;
  return { toplam: satirlar.length, yeni: say("yeni"), guncelle: say("guncelle"), degisiklikYok: say("degisiklik_yok"), hatali: say("hatali") };
}

/** Açık fatura hareketinin açıklaması; aynı cari ve belge no ikinci kez aktarılmasın diye aranır. */
export const acikFaturaAciklamasi = (belgeNo: string) => `Açık fatura ${belgeNo}`;
