export interface DuyuruIcerigi { baslik: string; icerik: string; butonMetni: string | null; butonUrl: string | null }
export interface DuyuruHedefi {
  kapsam: "tum" | "secili"; firmaIds: string[]; haricFirmaIds: string[]; paketIds: string[];
  durumlar: ("deneme" | "aktif" | "askida" | "iptal")[]; roller: string[]; yeniUygunlar: "katilmaz";
  gosterimYerleri: ("merkez" | "ust_bant" | "popup" | "modul_karti")[];
  modulYollari: ("genel" | "finans" | "satis" | "satin_alma" | "stok" | "uretim" | "raporlar" | "ayarlar" | "ebelge" | "cari" | "personel" | "crm")[];
  tekrarPolitikasi: "her_zaman" | "bir_kez" | "gunde_bir" | "haftada_bir";
  popupOnceligi: number; popupTuru: "normal" | "kritik"; ertelemeDakika: 60 | 1440 | 10080;
}
export interface Duyuru extends DuyuruIcerigi {
  id: string; durum: "taslak" | "arsiv" | "yayinlandi" | "durduruldu"; surum: number; createdAt: string; updatedAt: string;
  hedef: DuyuruHedefi | null; baslangic: string | null; bitis: string | null; yayinSurumu: number | null;
  icerikHtml: string;
}
export const DUYURU_DURUMU = { taslak: "Taslak", arsiv: "Arşiv", yayinlandi: "Yayınlandı", durduruldu: "Durduruldu" };
export function duyuruDurumu(d: Pick<Duyuru, "durum" | "baslangic" | "bitis">) {
  if (d.durum !== "yayinlandi") return DUYURU_DURUMU[d.durum];
  if (d.baslangic && new Date(d.baslangic).getTime() > Date.now()) return "Planlı";
  if (d.bitis && new Date(d.bitis).getTime() <= Date.now()) return "Sona erdi";
  return "Yayında";
}
export interface DuyuruListesi { kayitlar: Duyuru[]; toplam: number; sayfa: number; sayfaBoyutu: number }
