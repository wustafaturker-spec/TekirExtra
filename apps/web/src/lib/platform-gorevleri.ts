export type GorevDurumu = "acik" | "devam_ediyor" | "tamamlandi" | "iptal";
export type GorevKapsami = "mevzuat" | "platform";
export type GorevOnceligi = "dusuk" | "normal" | "yuksek";
export const GOREV_DURUMU: Record<GorevDurumu, string> = { acik: "Açık", devam_ediyor: "Devam ediyor", tamamlandi: "Tamamlandı", iptal: "İptal" };
export const GOREV_ONCELIGI: Record<GorevOnceligi, string> = { dusuk: "Düşük", normal: "Normal", yuksek: "Yüksek" };
export interface Gorev {
  id: string; baslik: string; aciklama: string | null; kapsam: GorevKapsami; durum: GorevDurumu; oncelik: GorevOnceligi;
  sonTarih: string | null; sorumluId: string | null; degisiklikId: string | null; surum: number;
  sorumlu: { id: string; adSoyad: string; rol: "yonetici" | "mevzuat_editoru"; aktif: boolean } | null;
  olusturan: { id: string; adSoyad: string };
  degisiklik: { id: string; no: number; baslik: string } | null;
  createdAt: string; updatedAt: string; kapanisAt: string | null;
}
export interface GorevListesi {
  kayitlar: Gorev[]; toplam: number; sayfa: number; sayfaBoyutu: number; bugun: string;
  sayilar: Record<GorevDurumu | "geciken", number>;
}
export const gorevAcik = (g: Pick<Gorev, "durum">) => g.durum === "acik" || g.durum === "devam_ediyor";
