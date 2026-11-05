export interface Metrikler { etkinFirma: number | null; etkinKullanici: number | null; giris: number | null; islem: number | null }
export interface GunlukIstatistik extends Metrikler { gun: string }
export interface BuyumeDonemi {
  tam: boolean;
  baslangicFirma: number | null; bitisFirma: number | null; yeniFirma: number | null;
  silinenFirma: number | null; netDegisim: number | null; iptalFirma: number | null;
  deneme: { baslayan: number | null; olgunlasan: number | null; donusen: number | null; bekleyen: number | null; oran: number | null };
}
export interface BuyumeRaporu {
  olcumBaslangici: string; hesaplandiAt: string; pencereGun: number;
  donem: BuyumeDonemi; onceki: BuyumeDonemi;
}
export type BaslamaDurumu = "baslamayan" | "baslayan" | "belirsiz";
export interface BaslamaRaporu {
  kesimGunu: string; hazir: boolean; olcumBaslangici: string; sonUretim: string | null;
  sayilar: Record<BaslamaDurumu, number | null>;
  durum: BaslamaDurumu; sayfa: number; sayfaBoyutu: number; toplam: number | null;
  kayitlar: { tenantId: string; unvan: string | null; planKodu: string; kayitGunu: string | null; sonEtkinGun: string | null }[];
}
export type OperasyonTuru = "hepsi" | "gorev" | "fatura" | "iade";
export interface OperasyonSayilari {
  firma: number; aktif: number; deneme: number; askida: number; iptal: number;
  geciken: number; yaklasan: number; baglantiHatali: number;
  gorev: number; fatura: number; iade: number; hatali: number; toplam: number;
}
export interface OperasyonGecmisi {
  olcumBaslangici: string | null; oncekiBitis: string;
  donemSonu: OperasyonSayilari | null; oncekiDonemSonu: OperasyonSayilari | null;
  gunler: { gun: string; hazir: boolean; gecici: boolean; gozlemAt: string | null; sayilar: OperasyonSayilari | null }[];
  detay: {
    gun: string; hazir: boolean; gozlemAt: string | null; sayilar: OperasyonSayilari | null;
    toplam: number | null; sayfa: number; sayfaBoyutu: number;
    kayitlar: { tenantId: string; unvan: string | null; planKodu: string; durum: string;
      geciken: boolean; yaklasan: boolean; baglantiHatali: boolean; gorev: number; fatura: number; iade: number; hatali: number; toplam: number }[];
  };
}
export interface OperasyonRaporu {
  zaman: string; tur: OperasyonTuru; sayfa: number; sayfaBoyutu: number;
  sayilar: { toplam: number; gorev: number; fatura: number; iade: number; hatali: number };
  filtreliIs: number; firmaToplam: number;
  kayitlar: { tenantId: string; unvan: string; toplam: number; gorev: number; fatura: number; iade: number; hatali: number }[];
}
export interface FirmaIstatistikRaporu {
  aralik: { baslangic: string; bitis: string; oncekiBaslangic: string; oncekiBitis: string };
  olcum: { baslangic: string; gunSayisi: number; olculenGun: number; eksikGunler: string[]; bugunDahil: boolean; sonGuncelleme: string | null };
  donem: Metrikler; onceki: Metrikler; gunler: GunlukIstatistik[];
  moduller: { kod: string; adet: number }[];
  odeme?: { sayilar: { basarisiz: number; sonuclanmadi: number } };
  buyume: BuyumeRaporu;
  baslama: BaslamaRaporu; operasyon: OperasyonRaporu;
  operasyonGecmisi?: OperasyonGecmisi;
  guncel: { zaman: string; toplam: number; aktif: number; deneme: number; askida: number; iptal: number; geciken: number; talep: number; yaklasan: number; baglantiHatali: number; basarisizOdeme7Gun: number; planlar: { kod: string; adet: number }[] };
  firmalar: { kayitlar: { tenantId: string; unvan: string | null; etkinGun: number; giris: number; islem: number; etkinKullanici: number }[]; toplam: number; sayfa: number; sayfaBoyutu: number };
}
export const MODUL_ADI: Record<string, string> = { fatura: "Fatura", cari: "Cari", stok: "Stok", depo: "Depo", "kasa-banka": "Kasa ve banka", pos: "POS", personel: "İnsan kaynakları", uretim: "Üretim", projeler: "Projeler", ai: "Yapay zekâ", baglantilar: "Bağlantılar", rapor: "Raporlar", belgeler: "Belgeler", "satin-alma": "Satın alma", satis: "Satış" };
export function donemFarki(simdi: number | null, onceki: number | null, devamEdiyor: boolean) {
  if (simdi === null || onceki === null) return "Karşılaştırma için ölçüm eksik";
  if (devamEdiyor) return "Bugün devam ettiği için yüzde karşılaştırması yok";
  if (onceki === 0) return simdi === 0 ? "Önceki dönemle aynı" : "Önceki dönemde kayıt yok";
  const fark = (simdi - onceki) / onceki * 100;
  return `${fark > 0 ? "+" : ""}${fark.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}% · önceki dönem ${onceki.toLocaleString("tr-TR")}`;
}
