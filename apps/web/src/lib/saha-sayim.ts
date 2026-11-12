import type { SahaBarkodu, SahaUrunu } from "./saha-depo";

/**
 * SAH-03: sayım satırları (saf işlevler). Ürün varyantıyla birlikte bir satırdır; lot/seri takipli
 * üründe satır parti parti tutulur (seri: her seri 1 adet). Barkod katsayısı (koli 12 gibi) miktara
 * ana birimde eklenir.
 */
export interface SayimParti { lotNo: string; seriNo: string | null; miktar: number }
export interface SayimSatiri {
  anahtar: string;
  stokId: string;
  varyantId: string | null;
  kod: string;
  ad: string;
  birim: string;
  takipTipi: string;
  miktar: number;
  partiler: SayimParti[];
  sonOkutma: number;
}

export type OkutmaSonucu =
  | { tur: "bulundu"; urun: SahaUrunu; varyantId: string | null; katsayi: number }
  | { tur: "varyant_sec"; urun: SahaUrunu; katsayi: number }
  | { tur: "bulunamadi"; kod: string };

const yuvarla = (n: number) => Math.round(n * 1000) / 1000;

/** Okutulan barkod ya da elle yazılan ürün kodu → ürün. Varyantlı üründe kart barkodu varyant sordurur. */
export function okutulaniCoz(girdi: string, urunler: SahaUrunu[], barkodlar: SahaBarkodu[]): OkutmaSonucu {
  const kod = girdi.trim();
  if (!kod) return { tur: "bulunamadi", kod };
  const b = barkodlar.find((x) => x.barkod === kod);
  const urunMap = new Map(urunler.map((u) => [u.id, u]));
  if (b) {
    const urun = urunMap.get(b.stokId);
    if (urun) {
      if (!b.varyantId && urun.varyantlar.length) return { tur: "varyant_sec", urun, katsayi: b.katsayi };
      return { tur: "bulundu", urun, varyantId: b.varyantId, katsayi: b.katsayi };
    }
  }
  const kucuk = kod.toLocaleUpperCase("tr-TR");
  for (const u of urunler) {
    const v = u.varyantlar.find((x) => x.kod.toLocaleUpperCase("tr-TR") === kucuk);
    if (v) return { tur: "bulundu", urun: u, varyantId: v.id, katsayi: 1 };
    if (u.kod.toLocaleUpperCase("tr-TR") === kucuk) return u.varyantlar.length ? { tur: "varyant_sec", urun: u, katsayi: 1 } : { tur: "bulundu", urun: u, varyantId: null, katsayi: 1 };
  }
  return { tur: "bulunamadi", kod };
}

export const satirAnahtari = (stokId: string, varyantId: string | null) => `${stokId}|${varyantId ?? ""}`;

/** Satıra miktar ekler (yoksa açar). Lot/seri takipli üründe parti bilgisi zorunludur. */
export function miktarEkle(satirlar: SayimSatiri[], urun: SahaUrunu, varyantId: string | null, miktar: number, parti?: { lotNo?: string | null; seriNo?: string | null }, an = Date.now()): SayimSatiri[] {
  const anahtar = satirAnahtari(urun.id, varyantId);
  const varyant = urun.varyantlar.find((v) => v.id === varyantId);
  const mevcut = satirlar.find((s) => s.anahtar === anahtar);
  const satir: SayimSatiri = mevcut ? { ...mevcut, partiler: [...mevcut.partiler] } : {
    anahtar, stokId: urun.id, varyantId, kod: varyant?.kod ?? urun.kod, ad: varyant ? `${urun.ad} · ${varyant.ad}` : urun.ad,
    birim: urun.anaBirim, takipTipi: urun.takipTipi, miktar: 0, partiler: [], sonOkutma: an,
  };
  if (urun.takipTipi === "seri") {
    // STK-31: seri takipli üründe de parti lot numarasıyla tutulur; her seri 1 adettir.
    const seriNo = parti?.seriNo?.trim();
    const lotNo = parti?.lotNo?.trim();
    if (!seriNo || !lotNo) throw new Error(`${urun.ad} seri takipli; lot ve seri numarasını girin.`);
    if (satir.partiler.some((p) => p.seriNo === seriNo)) throw new Error(`${seriNo} seri numarası bu sayımda zaten var.`);
    satir.partiler.push({ lotNo, seriNo, miktar: 1 });
  } else if (urun.takipTipi !== "yok") {
    const lotNo = parti?.lotNo?.trim();
    if (!lotNo) throw new Error(`${urun.ad} lot takipli; lot numarasını girin.`);
    const p = satir.partiler.find((x) => x.lotNo === lotNo);
    if (p) p.miktar = yuvarla(p.miktar + miktar);
    else satir.partiler.push({ lotNo, seriNo: null, miktar: yuvarla(miktar) });
  }
  satir.miktar = satir.partiler.length ? yuvarla(satir.partiler.reduce((t, p) => t + p.miktar, 0)) : yuvarla(satir.miktar + miktar);
  satir.sonOkutma = an;
  return [satir, ...satirlar.filter((s) => s.anahtar !== anahtar)];
}

/** Takipsiz satırın miktarını elle değiştirir; 0 ve altı satırı kaldırır (0 sayılan ürün için `sifirla` kullanılır). */
export function miktarYaz(satirlar: SayimSatiri[], anahtar: string, miktar: number): SayimSatiri[] {
  return satirlar.flatMap((s) => (s.anahtar !== anahtar ? [s] : s.partiler.length ? [s] : miktar > 0 ? [{ ...s, miktar: yuvarla(miktar) }] : []));
}

export function partiSil(satirlar: SayimSatiri[], anahtar: string, indeks: number): SayimSatiri[] {
  return satirlar.flatMap((s) => {
    if (s.anahtar !== anahtar) return [s];
    const partiler = s.partiler.filter((_, i) => i !== indeks);
    return partiler.length ? [{ ...s, partiler, miktar: yuvarla(partiler.reduce((t, p) => t + p.miktar, 0)) }] : [];
  });
}

/** `POST /stok/sayimlar` gövdesi (STK-29…31). */
export function sayimGovdesi(depoId: string | null, tarih: string, satirlar: SayimSatiri[], aciklama: string) {
  return {
    depoId, tarih, aciklama: aciklama || "Saha sayımı",
    kalemler: satirlar.map((s) => ({
      stokId: s.stokId, varyantId: s.varyantId, fiiliMiktar: String(s.miktar),
      ...(s.partiler.length ? { partiler: s.partiler.map((p) => ({ lotNo: p.lotNo, seriNo: p.seriNo, fiiliMiktar: String(p.miktar) })) } : {}),
    })),
  };
}
