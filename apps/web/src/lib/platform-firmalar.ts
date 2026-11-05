export interface Firma {
  tenantId: string; unvan: string; vkn: string; kayitTarihi: string;
  planKodu: string; planAdi: string; durum: string; donemSonu: string | null; iptalTarihi: string | null;
  aktifKullanici: number; sonGiris: string | null; ebelgeSaglayici: string | null;
  bekleyenTalep: { id: string; istenenPlan: string; istenenPlanAdi: string } | null;
  /** PLT-09: dönem sonundan 15 gün geçti, ödeme işaretlenmedi (otomatik askı yok). */
  askiyaAlinacak?: boolean;
  baglantiHatali?: boolean;
  takip?: { durum: string; sonrakiGorusme: string | null; sorumluAdi: string | null; sorumluUygun: boolean | null } | null;
  sonOdemeAt?: string | null;
  /** PLT-10: firma KLN-24 ile destek izni verdiyse. */
  destek?: { izinBitis: string; acikOturum: { id: string; bitis: string; kisi: string } | null } | null;
}
export interface Gecmis {
  degisiklikler: { zaman: string; oncekiPlan: string | null; yeniPlan: string; oncekiDurum: string | null; yeniDurum: string; neden: string | null }[];
  talepler: { id: string; zaman: string; mevcutPlan: string; istenenPlan: string; durum: string; aciklama: string | null; kararNotu: string | null }[];
  /** PLT-15: elle (PLT-09) ve sağlayıcıyla alınan ödemeler, başarısız denemeler. */
  odemeler?: { id?: string; zaman: string; aySayisi: number; tutar: number; kdv: number | null; kaynak?: "elle" | "saglayici"; saglayici?: string | null; not: string | null; yeniDonemSonu: string; fatura?: AbonelikFaturasi | null; iadeler?: OdemeIadesi[] }[];
  basarisizDenemeler?: { zaman: string; saglayici: string; kaynak: string; aySayisi: number; toplam: number; hata: string | null }[];
  askiNedeni?: "odeme" | "diger" | null;
  /** PLT-14: otomatik yenileme kartı (anahtarlar dönmez). */
  kart?: { saglayici: string; son4: string | null; kartMarkasi: string | null; otomatikYenileme: boolean; aySayisi: number; denemeSayisi: number; sonDeneme: string | null; sonHata: string | null } | null;
}
/** PLT-46: ödemenin platformdan iadeleri. */
export interface OdemeIadesi { id: string; zaman: string; tutar: number; neden: string; saglayiciyaGonderildi: boolean; ref: string | null; kaydeden: string | null; faturalayanDurumu: "bekliyor" | "yazildi" | "gerekmiyor" | "hata"; faturalayanHata: string | null }
export const FATURALAYAN_DURUMU: Record<OdemeIadesi["faturalayanDurumu"], string> = { bekliyor: "faturalayan kaydı bekliyor", yazildi: "faturalayana işlendi", gerekmiyor: "fatura yoktu", hata: "faturalayan kaydı yazılamadı" };
/** PLT-23: ödemenin faturalayan firmadaki faturası. */
export interface AbonelikFaturasi { no: string | null; durum: "bekliyor" | "taslak" | "kesinlesti" | "tahsil_edildi" | "hata"; hata: string | null }
export const FATURA_DURUMU: Record<AbonelikFaturasi["durum"], { ad: string; ton: "success" | "danger" | "neutral" | "warning" }> = {
  bekliyor: { ad: "Fatura bekliyor", ton: "warning" }, taslak: { ad: "Taslak", ton: "neutral" }, kesinlesti: { ad: "Kesin, tahsilat yok", ton: "warning" },
  tahsil_edildi: { ad: "Kesin, tahsil edildi", ton: "success" }, hata: { ad: "Fatura açılamadı", ton: "danger" },
};
export const GORUNUMLER = {
  hepsi: "Tüm firmalar", talep: "Bekleyen plan talebi", askiyaAlinacak: "Ödemesi 15+ gün gecikenler",
  askida: "Askıda", iptal: "İptal", aktif: "Aboneliği aktif", deneme: "Deneme",
  hicGirmeyen: "Hiç giriş yapmayan", uzunSuredirGirmeyen: "30 gündür giriş yapmayan",
  yenilenecek: "7 gün içinde yenilenecek", denemesiBitecek: "7 gün içinde denemesi bitecek",
  baglantiHatali: "Bağlantı hatası olan", takibiGeciken: "Takip tarihi geçen", sorumluUygunDegil: "Sorumlusu pasif veya yetkisi değişen",
};
export type Suzgec = keyof typeof GORUNUMLER;
export interface FirmaListesi {
  kayitlar: Firma[]; toplam: number; sayfa: number; sayfaBoyutu: number;
  sayilar: { toplam: number; talep: number; askiyaAlinacak: number; askida: number; iptal: number };
}
export const ODEME_SURELERI = [1, 3, 6, 12] as const;

export const PLANLAR = [{ kod: "baslangic", ad: "Başlangıç" }, { kod: "profesyonel", ad: "Profesyonel" }, { kod: "kurumsal", ad: "Kurumsal" }];
export const DURUM: Record<string, { ad: string; ton: "success" | "danger" | "neutral" | "warning" }> = {
  aktif: { ad: "Aktif", ton: "success" }, deneme: { ad: "Deneme", ton: "neutral" }, askida: { ad: "Askıda", ton: "danger" }, iptal: { ad: "İptal", ton: "warning" },
};
export const TALEP_DURUMU: Record<string, string> = { bekliyor: "Bekliyor", onaylandi: "Onaylandı", reddedildi: "Reddedildi", geri_cekildi: "Geri çekildi" };

export const tarih = (s: string | null) => (s ? new Date(s).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "—");
export const tl = (x: number | string) => Number(x).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
