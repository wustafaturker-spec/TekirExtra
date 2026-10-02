export type TalimatDurumu = "onay_bekliyor" | "onaylandi" | "gonderildi" | "gerceklesti" | "basarisiz" | "iptal";

export interface Banka { id: string; ad: string; bankaAdi: string; dovizCinsi: string; aktif: boolean; iban?: string | null }

export interface Talimat {
  id: string;
  no: string | null;
  aliciUnvan: string;
  aliciIban: string;
  tutar: string;
  dovizCinsi: string;
  aciklama: string;
  durum: TalimatDurumu;
  odemeTarihi: string;
  gerceklesmeTarihi: string | null;
  hataMesaji: string | null;
  createdAt: string;
  bankaHesap: { id: string; ad: string; bankaAdi: string };
  cari: { id: string; kod: string; unvan: string } | null;
  olusturan: { id: string; adSoyad: string };
  onaylayan: { id: string; adSoyad: string } | null;
  paket: { id: string; no: string } | null;
  faturalar: Array<{ tutar: string; fatura: { id: string; no: string | null; tarih: string; vadeTarihi: string | null; tip: string } }>;
}

export const DURUM: Record<TalimatDurumu, { ad: string; ton: "warning" | "info" | "accent" | "success" | "danger" | "neutral" }> = {
  onay_bekliyor: { ad: "Onay bekliyor", ton: "warning" },
  onaylandi: { ad: "Onaylı · planlı", ton: "info" },
  gonderildi: { ad: "Bankaya gönderildi", ton: "accent" },
  gerceklesti: { ad: "Gerçekleşti", ton: "success" },
  basarisiz: { ad: "Başarısız", ton: "danger" },
  iptal: { ad: "İptal", ton: "neutral" },
};

export const ibanBicimle = (iban: string) => iban.replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
