import { createHash } from "node:crypto";

export const HAZIRLIK_TURLERI = [
  "fatura_stok_esleme",
  "banka_ekstre_esleme",
  "vadesi_gecen_hatirlatma",
  "kritik_stok_talep",
  "ay_sonu_kapanis",
] as const;

export type HazirlikTuru = (typeof HAZIRLIK_TURLERI)[number];

export const HAZIRLIK_DURUMLARI = [
  "hazir",
  "onaylandi",
  "reddedildi",
  "suresi_doldu",
  "hedef_degisti",
  "hata",
] as const;

export type HazirlikDurumu = (typeof HAZIRLIK_DURUMLARI)[number];

export const TUR_METINLERI: Record<HazirlikTuru, { baslik: string; kisaAd: string; aciklama: string }> = {
  fatura_stok_esleme: {
    baslik: "Gelen Fatura Stok Eşleştirmesi",
    kisaAd: "Stok Eşleme",
    aciklama: "Gelen faturadaki satırlar için önerilen stok ve varyant eşleşmesi.",
  },
  banka_ekstre_esleme: {
    baslik: "Banka Ekstresi Eşleştirmesi",
    kisaAd: "Banka Eşleme",
    aciklama: "Ekstre satırının cari, fatura veya virman ile eşleştirilme önerisi.",
  },
  vadesi_gecen_hatirlatma: {
    baslik: "Vadesi Geçen Alacak Hatırlatması",
    kisaAd: "Vade Hatırlatma",
    aciklama: "Ödeme vadesi geçmiş cariler için hazırlanan bilgilendirme ve hatırlatma taslağı.",
  },
  kritik_stok_talep: {
    baslik: "Kritik Stok Satın Alma Talebi",
    kisaAd: "Kritik Stok",
    aciklama: "Asgari stok seviyesinin altına düşen ürünler için taslak sipariş/satın alma talebi.",
  },
  ay_sonu_kapanis: {
    baslik: "Ay Sonu Kapanış Kontrol Listesi",
    kisaAd: "Ay Sonu Kapanış",
    aciklama: "Açık ekstreler, taslak faturalar ve mutabakat bekleyen işlemlerin kontrol özeti.",
  },
};

/** Hazırlık öğesi varsayılan olarak 48 saat geçerlidir; onaylanmazsa süresi dolar. */
export const HAZIRLIK_GECERLILIK_SURESI_MS = 48 * 60 * 60 * 1000;

/** P-11: Kaynak kaydın o anki durumunun deterministik SHA-256 özeti. */
export function hedefOzetiHesapla(veri: unknown): string {
  if (veri === null || veri === undefined) return "";
  const metin = typeof veri === "string" ? veri : JSON.stringify(veri, Object.keys(veri as object).sort());
  return createHash("sha256").update(metin).digest("hex").slice(0, 32);
}

/** Öğenin onaylanabilir durumda ve süresinin dolmamış olup olmadığını denetler. */
export function hazirlikGecerliMi(h: { durum: string; gecerlilikBitisAt: Date }): boolean {
  if (h.durum !== "hazir") return false;
  return new Date(h.gecerlilikBitisAt).getTime() >= Date.now();
}
