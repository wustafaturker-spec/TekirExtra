import { satirAnahtari, type SayimSatiri } from "./saha-sayim";

/**
 * SAH-06: mal kabul (saf işlevler). Okutulan miktarlar ana birimde birikir (sayımla aynı satır yapısı);
 * gönderimde belge satırlarına sırayla dağıtılır ve belge birimine çevrilir. Satırın beklenen miktarını
 * aşan kısım "fazla" olarak gösterilir, gönderilmez; belgede olmayan ürün "beklenmeyen" olur.
 */
export interface MalKabulSatiri {
  anahtar: string;
  stokId: string | null;
  varyantId: string | null;
  kod: string | null;
  ad: string;
  birim: string;
  katsayi: number | null;
  beklenen: number;
  takipTipi: string | null;
}
export interface MalKabulBelgesi {
  tur: "siparis" | "eirsaliye";
  id: string;
  no: string | null;
  tarih: string;
  cariUnvan: string;
  engel: string | null;
  satirlar: MalKabulSatiri[];
}

export interface KabulParti { lotNo: string; seriNo?: string | null; miktar: string }
export interface KabulKalemi { anahtar: string; stokId: string; varyantId: string | null; miktar: string; partiler?: KabulParti[] }
export interface SatirDurumu { satir: MalKabulSatiri; okunan: number; fark: number; kabulEdilemez: string | null }
export interface KabulPlani {
  kalemler: KabulKalemi[];
  durumlar: SatirDurumu[];
  /** Beklenenden fazla okunan (ana birimde). */
  fazla: Array<{ ad: string; miktar: number; birim: string }>;
  beklenmeyen: Array<{ ad: string; miktar: number; birim: string }>;
}

/** Binde bir hassasiyet (belge satırı 3 ondalık). */
const B = 1000;
const binde = (n: number) => Math.round(n * B);
const metin = (b: number) => (b / B).toFixed(3).replace(/\.?0+$/, "");

/** Okutulanları belge satırlarına dağıtır. */
export function kabulPlani(belge: MalKabulBelgesi, okunan: SayimSatiri[]): KabulPlani {
  const kalan = new Map(okunan.map((s) => [s.anahtar, { satir: s, miktar: binde(s.miktar), partiler: s.partiler.map((p) => ({ ...p, b: binde(p.miktar) })) }]));
  const kalemler: KabulKalemi[] = [];
  const durumlar: SatirDurumu[] = [];
  for (const satir of belge.satirlar) {
    const kabulEdilemez = !satir.stokId ? "Ürün eşleşmedi; panelde işlenir." : !satir.katsayi ? `${satir.birim} birimi ürün kartında yok; panelde işlenir.` : null;
    const k = satir.stokId ? kalan.get(satirAnahtari(satir.stokId, satir.varyantId)) : undefined;
    if (kabulEdilemez || !k || !satir.katsayi || k.miktar <= 0) {
      durumlar.push({ satir, okunan: 0, fark: -satir.beklenen, kabulEdilemez });
      continue;
    }
    // Ana birimde kapasite ve alınan; belge birimine çevrilen miktar binde bire yuvarlanır.
    const kapasite = binde(satir.beklenen * satir.katsayi);
    const alinan = Math.min(k.miktar, kapasite);
    k.miktar -= alinan;
    const belgeMiktari = binde(alinan / B / satir.katsayi);
    let partiler: KabulParti[] | undefined;
    if (k.partiler.length) {
      partiler = [];
      let kalanAna = alinan;
      for (const p of k.partiler) {
        if (kalanAna <= 0) break;
        const al = Math.min(p.b, kalanAna);
        if (al <= 0) continue;
        p.b -= al; kalanAna -= al;
        partiler.push({ lotNo: p.lotNo, ...(p.seriNo ? { seriNo: p.seriNo } : {}), miktar: String(binde(al / B / satir.katsayi)) });
      }
      // Yuvarlama farkı son partiye: toplam satır miktarını tam tutmalı.
      const toplam = partiler.reduce((t, p) => t + Number(p.miktar), 0);
      const son = partiler[partiler.length - 1];
      if (son) son.miktar = String(Number(son.miktar) + belgeMiktari - toplam);
      partiler = partiler.filter((p) => Number(p.miktar) > 0).map((p) => ({ ...p, miktar: metin(Number(p.miktar)) }));
    }
    if (belgeMiktari > 0) kalemler.push({ anahtar: satir.anahtar, stokId: satir.stokId!, varyantId: satir.varyantId, miktar: metin(belgeMiktari), ...(partiler?.length ? { partiler } : {}) });
    const okunanBelge = belgeMiktari / B;
    durumlar.push({ satir, okunan: okunanBelge, fark: Math.round((okunanBelge - satir.beklenen) * B) / B, kabulEdilemez: null });
  }
  const fazla: KabulPlani["fazla"] = [];
  const beklenmeyen: KabulPlani["beklenmeyen"] = [];
  const belgedeki = new Set(belge.satirlar.filter((s) => s.stokId).map((s) => satirAnahtari(s.stokId!, s.varyantId)));
  for (const k of kalan.values()) {
    if (k.miktar <= 0) continue;
    const kayit = { ad: k.satir.ad, miktar: k.miktar / B, birim: k.satir.birim };
    (belgedeki.has(k.satir.anahtar) ? fazla : beklenmeyen).push(kayit);
  }
  return { kalemler, durumlar, fazla, beklenmeyen };
}

/** Gönderim gövdesi: siparişte satır kimliği, e-İrsaliyede sıra numarası ve eşleşen ürün. */
export function kabulGovdesi(belge: MalKabulBelgesi, kalemler: KabulKalemi[]) {
  if (belge.tur === "siparis") return { kalemler: kalemler.map((k) => ({ satirId: k.anahtar, miktar: k.miktar, ...(k.partiler ? { partiler: k.partiler } : {}) })) };
  return { satirlar: kalemler.map((k) => ({ siraNo: Number(k.anahtar), stokId: k.stokId, varyantId: k.varyantId, miktar: k.miktar, ...(k.partiler ? { partiler: k.partiler } : {}) })) };
}
