/**
 * RPR-25: karşılaştırmalı dönem. Rapor iki dönem için çalışır; toplanabilir
 * sütunlar toplam düzeyinde her zaman, zaman dışı kırılımlarda satır
 * düzeyinde de karşılaştırılır.
 */
import type { RaporKolon, RaporSatiri } from "./rapor-kayit";

export type KarsilastirmaTuru = "onceki" | "gecen_yil" | "elle";
export interface KarsilastirmaGirdisi { tur: KarsilastirmaTuru; baslangic?: string; bitis?: string }

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const gun = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ayinSonGunu = (yil: number, ay: number) => new Date(Date.UTC(yil, ay + 1, 0)).getUTCDate();

/** Karşılaştırılacak dönem; geçersiz girdide null. */
export function karsilastirmaDonemi(baslangic: string, bitis: string, k: KarsilastirmaGirdisi): { baslangic: string; bitis: string } | null {
  if (!TARIH.test(baslangic) || !TARIH.test(bitis) || baslangic > bitis) return null;
  if (k.tur === "elle") {
    return k.baslangic && k.bitis && TARIH.test(k.baslangic) && TARIH.test(k.bitis) && k.baslangic <= k.bitis ? { baslangic: k.baslangic, bitis: k.bitis } : null;
  }
  const b = gun(baslangic), s = gun(bitis);
  if (k.tur === "gecen_yil") {
    // 29 Şubat bir önceki yılda yoksa 28 Şubat'a düşer.
    const geri = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), Math.min(d.getUTCDate(), ayinSonGunu(d.getUTCFullYear() - 1, d.getUTCMonth()))));
    return { baslangic: iso(geri(b)), bitis: iso(geri(s)) };
  }
  // Tam ay(lar): önceki aynı sayıda tam ay.
  const tamAy = b.getUTCDate() === 1 && s.getUTCDate() === ayinSonGunu(s.getUTCFullYear(), s.getUTCMonth());
  if (tamAy) {
    const aySayisi = (s.getUTCFullYear() - b.getUTCFullYear()) * 12 + s.getUTCMonth() - b.getUTCMonth() + 1;
    return { baslangic: iso(new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() - aySayisi, 1))), bitis: iso(new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0))) };
  }
  const uzunluk = Math.round((s.getTime() - b.getTime()) / 86_400_000) + 1;
  return { baslangic: iso(new Date(b.getTime() - uzunluk * 86_400_000)), bitis: iso(new Date(b.getTime() - 86_400_000)) };
}

export interface ToplamKarsilastirmasi { alan: string; baslik: string; tip: RaporKolon["tip"]; doviz?: string; bu: number; onceki: number; fark: number; yuzde: number | null }

/** Değişim yüzdesi; önceki 0 ise tanımsız (null). */
export const degisimYuzdesi = (bu: number, onceki: number) => (onceki === 0 ? null : Math.round(((bu - onceki) / Math.abs(onceki)) * 10_000) / 100);

const ZAMAN_DEGERI = /^\d{4}(-\d{2}(-\d{2})?|-W\d{1,2}|-Q\d)?$|^\d{2}\.\d{2}\.\d{4}$/;
const ONCEKI = "__onceki", DEGISIM = "__degisim";

/**
 * İki dönemin sonucunu birleştirir. Satır karşılaştırması tarih sütunu ya
 * da zaman biçimli anahtar (2026-10, 2026-10-05…) yoksa yapılır; anahtar
 * sayısal olmayan sütunların değerleridir.
 */
export function karsilastir(kolonlar: RaporKolon[], bu: RaporSatiri[], onceki: RaporSatiri[]) {
  const toplanan = kolonlar.filter((k) => k.toplam);
  const anahtarKolonlar = kolonlar.filter((k) => k.tip === "metin");
  const anahtar = (s: RaporSatiri) => JSON.stringify(anahtarKolonlar.map((k) => s[k.alan] ?? null));
  const zamanli = kolonlar.some((k) => k.tip === "tarih")
    || [...bu, ...onceki].some((s) => anahtarKolonlar.some((k) => ZAMAN_DEGERI.test(String(s[k.alan] ?? ""))));
  const satirKarsilastirmasi = Boolean(toplanan.length && anahtarKolonlar.length && !zamanli);

  // Toplamlar ekrandaki kuralla: karışık dövizli sütun toplanmaz.
  const topla = (k: RaporKolon, satirlar: RaporSatiri[]) => {
    const dovizler = new Set(k.dovizAlani ? satirlar.map((x) => String(x[k.dovizAlani!] ?? "TRY")) : []);
    if (dovizler.size > 1) return null;
    return { deger: Math.round(satirlar.reduce((t, x) => t + (Number(x[k.alan]) || 0), 0) * 100) / 100, doviz: [...dovizler][0] };
  };
  const toplamlar: ToplamKarsilastirmasi[] = toplanan.flatMap((k) => {
    const a = topla(k, bu), b = topla(k, onceki);
    if (!a || !b || (a.doviz && b.doviz && a.doviz !== b.doviz)) return [];
    return [{ alan: k.alan, baslik: k.baslik, tip: k.tip, doviz: a.doviz ?? b.doviz, bu: a.deger, onceki: b.deger, fark: Math.round((a.deger - b.deger) * 100) / 100, yuzde: degisimYuzdesi(a.deger, b.deger) }];
  });

  if (!satirKarsilastirmasi) return { kolonlar, satirlar: bu, satirKarsilastirmasi, toplamlar };

  const ekKolonlar: RaporKolon[] = kolonlar.flatMap((k) => (k.toplam ? [
    k,
    { alan: `${k.alan}${ONCEKI}`, baslik: `${k.baslik} (önceki)`, tip: k.tip, dovizAlani: k.dovizAlani, toplam: true },
    { alan: `${k.alan}${DEGISIM}`, baslik: `${k.baslik} Δ %`, tip: "yuzde" as const },
  ] : [k]));
  const oncekiMap = new Map(onceki.map((s) => [anahtar(s), s]));
  const gorulen = new Set<string>();
  const sayi = (v: unknown) => Number(v ?? 0) || 0;
  const ekle = (r: RaporSatiri, buSatir: RaporSatiri | undefined, oncekiSatir: RaporSatiri | undefined) => {
    for (const k of toplanan) {
      r[`${k.alan}${ONCEKI}`] = sayi(oncekiSatir?.[k.alan]);
      r[`${k.alan}${DEGISIM}`] = degisimYuzdesi(sayi(buSatir?.[k.alan]), sayi(oncekiSatir?.[k.alan]));
    }
    return r;
  };
  const satirlar = bu.map((s) => { const a = anahtar(s); gorulen.add(a); return ekle({ ...s }, s, oncekiMap.get(a)); });
  for (const o of onceki) {
    if (gorulen.has(anahtar(o))) continue;
    // Yalnız önceki dönemde olan satır: anahtar ve döviz önceki satırdan, bu dönem 0, diğer sayılar boş.
    const r: RaporSatiri = {};
    for (const k of kolonlar) r[k.alan] = k.tip === "metin" ? o[k.alan] ?? null : k.toplam ? 0 : null;
    for (const k of kolonlar) if (k.dovizAlani) r[k.dovizAlani] = o[k.dovizAlani] ?? null;
    satirlar.push(ekle(r, undefined, o));
  }
  return { kolonlar: ekKolonlar, satirlar, satirKarsilastirmasi, toplamlar };
}

const sayi = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dışa aktarım ve e-posta için toplam karşılaştırma satırları. */
export function toplamKarsilastirmaMetni(toplamlar: ToplamKarsilastirmasi[]): string[] {
  return toplamlar.map((t) => {
    const birim = t.tip === "para" ? ` ${t.doviz && t.doviz !== "TRY" ? t.doviz : "TL"}` : "";
    const yuzde = t.yuzde === null ? "" : ` (${t.yuzde > 0 ? "+" : ""}${t.yuzde.toLocaleString("tr-TR")} %)`;
    return `${t.baslik}: ${sayi(t.bu)}${birim} ← ${sayi(t.onceki)}${birim}${yuzde}`;
  });
}
