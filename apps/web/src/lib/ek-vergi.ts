/**
 * EBLG-120/125/132: satır KDV dışı vergileri — fatura ve teklif/sipariş/
 * irsaliye formu aynı yardımcıları kullanır. Davranış (stopaj, KDV matrahına
 * dahil) sunucuda merkezden yeniden çözülür; burada yalnız ekran hesabı içindir.
 */
import type { EkVergiHesapGirdisi, VergiTuru } from "@tekirextra/shared";

/** Satırın KDV dışı vergisi (sunucunun döndürdüğü çözülmüş hâli). */
export interface EkVergiSatiri { kod: string; ad: string; hesap?: "oran" | "birim" | null; oran: string | null; birimTutar?: string | null; matrah: string | null; tutar: string; stopaj: boolean; kdvMatrahinaDahil: boolean }

/** Ürün kartındaki vergi tanımı. */
export type KartEkVergisi = { kod: string; hesap: "oran" | "birim"; deger: string };

/** EBLG-125: ürün kartının vergisi → satır vergisi (ad ve davranış belge tarihindeki merkezi listeden). */
export function karttanEkVergiler(vergiler: KartEkVergisi[] | undefined, turler: readonly VergiTuru[]): EkVergiSatiri[] {
  return (vergiler ?? []).flatMap((v) => {
    const tur = turler.find((t) => t.kod === v.kod);
    return tur ? [{ kod: v.kod, ad: tur.ad, hesap: v.hesap, oran: v.hesap === "oran" ? v.deger : null, birimTutar: v.hesap === "birim" ? v.deger : null, matrah: null, tutar: "0", stopaj: tur.stopaj, kdvMatrahinaDahil: tur.kdvMatrahinaDahil }] : [];
  });
}

/**
 * faturaHesapla girdisi. EBLG-131: maktu vergi ana birim başınadır; ek birimli
 * satırda (koli) `katsayi` ile ölçeklenir.
 */
export function ekVergiHesapGirdileri(vergiler: EkVergiSatiri[] | null | undefined, katsayi: number): EkVergiHesapGirdisi[] {
  return (vergiler ?? []).map((v) => ({ tutar: Number(v.tutar), stopaj: v.stopaj, kdvMatrahinaDahil: v.kdvMatrahinaDahil, hesap: v.hesap ?? null, oran: Number(v.oran ?? 0), birimTutar: Number(v.birimTutar ?? 0) * (v.hesap === "birim" ? katsayi : 1) }));
}

/** Sunucuya giden biçim: hesaplı vergide oran/birim tutar, belgedekinde tutar. */
export function ekVergiGovdesi(vergiler: EkVergiSatiri[]) {
  return vergiler.map((v) => (v.hesap ? { kod: v.kod, hesap: v.hesap, oran: v.oran, birimTutar: v.birimTutar } : { kod: v.kod, oran: v.oran, matrah: v.matrah, tutar: v.tutar }));
}

/** Özet kutusu için vergi türü başına toplam; tutar hesaptan (oran/birim) ya da belgeden. */
export function ekVergiOzeti(satirlar: { ekVergiler?: EkVergiSatiri[] | null }[], tutarlar: number[][]) {
  const harita = new Map<string, { kod: string; ad: string; stopaj: boolean; kdvMatrahinaDahil: boolean; tutar: number }>();
  satirlar.forEach((s, i) => (s.ekVergiler ?? []).forEach((v, j) => {
    const m = harita.get(v.kod) ?? { kod: v.kod, ad: v.ad, stopaj: v.stopaj, kdvMatrahinaDahil: v.kdvMatrahinaDahil && !v.stopaj, tutar: 0 };
    m.tutar = Math.round((m.tutar + (tutarlar[i]?.[j] ?? Number(v.tutar))) * 100) / 100;
    harita.set(v.kod, m);
  }));
  return [...harita.values()];
}
