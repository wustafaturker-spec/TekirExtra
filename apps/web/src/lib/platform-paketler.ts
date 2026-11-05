import type { PaketKapsamSozlesmesi } from "@tekirextra/shared";
export interface PaketFiyatlandirmasi {
  paraBirimi: "TRY"; vergiDahil: false; kdvOrani: string; gecerlilikTarihi: string;
  donemler: { aySayisi: 1 | 3 | 6 | 12; matrah: string }[];
}
export interface PaketIcerigi { ad: string; aciklama: string; ozellikler: string[]; siralama: number; fiyatlandirma?: PaketFiyatlandirmasi | null; kapsamSozlesmesi?: PaketKapsamSozlesmesi | null; denemeGunSayisi?: number }
export interface PaketSurumu extends PaketIcerigi {
  id: string; paketId: string; surumNo: number; kilitSurumu: number; durum: "taslak" | "yayinlandi" | "arsiv";
  createdAt: string; yayinlandiAt: string | null; arsivlendiAt: string | null;
}
export interface PaketListesi {
  kayitlar: { id: string; kod: string; eskiPlanKodu: string | null; satisAcik?: boolean; satisSurumId?: string | null; sonSurum: Pick<PaketSurumu, "id" | "surumNo" | "ad" | "durum" | "siralama"> }[];
  toplam: number; sayfa: number; sayfaBoyutu: number; satisEntegrasyonu: boolean;
}
export interface PaketDetayi {
  paket: { id: string; kod: string; eskiPlanKodu: string | null; createdAt: string };
  surumler: PaketSurumu[]; toplam: number; sayfa: number; sayfaBoyutu: number; taslakVar: boolean; satisEntegrasyonu: boolean;
  mevcutKosullar: { planKodu: string; aylikFiyat: number | null; limitler: Record<string, number | null>; paraBirimi: string; kdvOrani: number } | null;
}
export const PAKET_DURUMU = { taslak: "Taslak", yayinlandi: "Yayınlandı", arsiv: "Arşiv" };
export interface PaketSatisDurumu {
  acik: boolean; kilitSurumu: number; surum: PaketSurumu | null;
  kayitlar: { id: string; kilitSurumu: number; neden: string; kullanici: { adSoyad: string }; createdAt: string;
    onceki: { acik: boolean; surumId: string | null }; yeni: { acik: boolean; surumId: string | null; surumNo: number | null; ad: string | null } }[];
  toplam: number; sayfa: number; sayfaBoyutu: number; satisEntegrasyonu: boolean;
}
export const KATALOG_KAPSAMI = "Bu katalog paket tanımlarını ve sürüm fiyatlarını yönetir. Katalogda yayınlama veya arşivleme, müşterilerin paketini, ödeme tutarını ve erişim limitlerini değiştirmez. Firma koşullarının ve paketinin değişmesi ayrı firma seçimi, etki önizlemesi ve onay gerektirir. Yeni firma kayıtlarında satışa açık seçili sürümün fiyat, kapsam ve deneme süresi kullanılır.";
export interface PaketGecisRaporu {
  toplam: number; bagli: number; bilinmeyenPlan: number; sayfa: number; sayfaBoyutu: number;
  kayitlar: {
    tenantId: string; unvan: string; planKodu: string; paketSurumId: string | null;
    durum: "bagli" | "bilinmeyen_plan"; kaynak: string | null; kosullarEsit: boolean | null;
    oncekiLimitler: Record<string, number | null> | null; sonrakiLimitler: Record<string, number | null> | null;
    donemler: { aySayisi: number; once: { matrah: string; kdv: string; toplam: string } | null; sonra: { matrah: string; kdv: string; toplam: string } | null; esit: boolean }[];
  }[];
}
export interface PaketFiyatEtkiRaporu {
  toplam: number; sayfa: number; sayfaBoyutu: number;
  hedefSurumId: string; hedefSurumNo: number; hedefPaketAdi: string;
  gecerlilikTarihi: string; uygulamaTarihi: null; atamaYapildi: false; kapsam: string;
  hedefKapsamVar?: boolean;
  kayitlar: {
    tenantId: string; unvan: string; planKodu: string; kaynakSurumId: string | null;
    karsilastirilabilir: boolean; neden: "farkli_veya_eslenmeyen_plan" | "kayitli_kosul_yok" | null;
    donemler: { aySayisi: number; once: PaketEtkiTutari | null; sonra: PaketEtkiTutari | null; fark: PaketEtkiTutari | null }[];
  }[];
}
interface PaketEtkiTutari { matrah: string; kdv: string; toplam: string }
export interface PaketAtamaOnizlemesi {
  id: string; uygulamaTarihi: string; sonOnayAt: string; neden: string; hedefSurumId: string;
  hedefPaketAdi: string; hedefSurumNo: number;
  uygulamaTuru?: "bugun" | "tarih" | "donem_sonu"; uygulanacakAt?: string | null;
  atamaKapsami?: "fiyat" | "kapsam";
  kayitlar: { tenantId: string; unvan: string; kaynakSurumId: string; donemler: PaketFiyatEtkiRaporu["kayitlar"][number]["donemler"];
    oncekiLimitler: Record<string, number | null>; sonrakiLimitler: Record<string, number | null>;
    oncekiDepolama?: { sinirBayt: string | null; uyariYuzdesi: number } | null; sonrakiDepolama?: { sinirBayt: string | null; uyariYuzdesi: number } | null;
    kullanim?: Record<string, number> | null; oncekiModuller?: string[]; sonrakiModuller?: string[]; kapananModuller?: string[]; acilanModuller?: string[] }[];
}
export interface PlanliPaketAtamaListesi {
  toplam: number; sayfa: number; sayfaBoyutu: number;
  kayitlar: { id: string; hedefSurumId: string; hedefPaketAdi: string; hedefSurumNo: number;
    uygulamaTuru: "tarih" | "donem_sonu"; uygulanacakAt: string; neden: string;
    atamaKapsami?: "fiyat" | "kapsam";
    durum: "planlandi" | "uygulandi" | "iptal" | "inceleme"; engelNedeni: string | null; iptalNedeni: string | null;
    firmalar: { tenantId: string; unvan: string }[] }[];
}
