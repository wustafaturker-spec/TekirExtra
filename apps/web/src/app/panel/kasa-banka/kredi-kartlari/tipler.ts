export type EkstreDurumu = "odendi" | "bekliyor" | "kismi" | "asgari_odendi" | "gecikti" | "birikiyor" | "planli";

export interface DonemOzeti {
  kesimTarihi: string;
  baslangic: string;
  sonOdemeTarihi: string;
  tur: "kesilmis" | "acik" | "gelecek";
  durum: EkstreDurumu;
  kesinlesti: boolean;
  bankaTutari: string | null;
  hesaplananBorc: string;
  devreden: string;
  donemIciOdeme: string;
  harcamalar: string;
  donemBorcu: string;
  asgari: string;
  odenen: string;
  kalan: string;
  asgariKalan: string;
  kalemSayisi: number;
}

export interface Kart {
  id: string;
  ad: string;
  bankaAdi: string;
  sonDortHane: string;
  kartSahibi: string | null;
  limit: string;
  dovizCinsi: string;
  hesapKesimGunu: number;
  sonOdemeGunu: number;
  asgariOdemeOrani: string | null;
  renk: string;
  aktif: boolean;
  borc: string;
  kullanilabilirLimit: string;
  kullanimOrani: string;
  bagliBankaHesap: { id: string; ad: string } | null;
  sonEkstre: DonemOzeti | null;
  acikDonem: DonemOzeti | null;
  gelecekTaksitler: Array<{ kesimTarihi: string; sonOdemeTarihi: string; tutar: string }>;
}

export interface EkstreKalemi {
  id: string;
  kaynak: "taksit" | "hareket";
  hareketId: string;
  tarih: string;
  tutar: string;
  aciklama: string;
  tip: "harcama" | "iade" | "odeme" | "faiz" | "aidat";
  sira: number | null;
  taksitSayisi: number;
  tersKayit: boolean;
}

export interface EkstreHareketi {
  id: string;
  tip: EkstreKalemi["tip"];
  tarih: string;
  tutar: string;
  aciklama: string;
  belgeNo: string | null;
  taksitSayisi: number;
  komisyonTutari: string;
  cariOdemeTutari: string | null;
  geriAlinanHareketId: string | null;
  cari: { id: string; kod: string; unvan: string } | null;
  fatura: { id: string; no: string | null } | null;
  masraf: { id: string; kaynakTur: string; kategori: string } | null;
  ekstresiKesinlesti: boolean;
  geriAlindi: boolean;
}

export interface EkstreAyrintisi extends DonemOzeti {
  kalemler: EkstreKalemi[];
  odemeler: Array<{ hareketId: string; tarih: string; tutar: string; aciklama: string }>;
  hareketler: EkstreHareketi[];
}

export interface Banka { id: string; ad: string; dovizCinsi: string; aktif: boolean }

export const DURUM: Record<EkstreDurumu, { ad: string; ton: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  odendi: { ad: "Ödendi", ton: "success" },
  bekliyor: { ad: "Ödeme bekliyor", ton: "info" },
  kismi: { ad: "Kısmen ödendi", ton: "info" },
  asgari_odendi: { ad: "Asgari ödendi", ton: "warning" },
  gecikti: { ad: "Gecikti", ton: "danger" },
  birikiyor: { ad: "Açık dönem", ton: "neutral" },
  planli: { ad: "Taksit planı", ton: "neutral" },
};

export const TIP_ADI: Record<EkstreKalemi["tip"], string> = { harcama: "Harcama", iade: "İade", odeme: "Ödeme", faiz: "Faiz", aidat: "Aidat" };

export const ayAdi = (gun: string) => new Date(`${gun}T00:00:00Z`).toLocaleDateString("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
