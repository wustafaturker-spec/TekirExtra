"use client";

/**
 * SAH-02/05/09: saha ekranlarının cihazdaki deposu (IndexedDB). Her kayıt `sahip` (firma:kullanıcı)
 * taşır; başka kullanıcı girince ya da çıkışta hepsi silinir. Kuyruktaki iş en çok 7 gün tutulur.
 */
const DB_ADI = "tekir-saha";
const SURUM = 1;
export const KUYRUK_OMRU_MS = 7 * 24 * 60 * 60 * 1000;

export type KuyrukTuru = "sayim" | "masraf";
export interface KuyrukIsi {
  id: string;
  sahip: string;
  tur: KuyrukTuru;
  olusturma: number;
  /** Ekranda gösterilecek kısa ad (ör. "Merkez Depo · 12 ürün"). */
  baslik: string;
  durum: "bekliyor" | "hata";
  hata?: string;
  deneme: number;
  /** sayım: POST /stok/sayimlar gövdesi; masraf: fotoğraf ve not. */
  veri: unknown;
}

export interface SahaUrunu { id: string; kod: string; ad: string; anaBirim: string; takipTipi: string; varyantlar: Array<{ id: string; kod: string; ad: string }> }
export interface SahaBarkodu { barkod: string; stokId: string; varyantId: string | null; katsayi: number; birim: string }
export interface UrunListesi { sahip: string; alindi: string; urunler: SahaUrunu[]; barkodlar: SahaBarkodu[] }

function ac(): Promise<IDBDatabase> {
  return new Promise((coz, reddet) => {
    const istek = indexedDB.open(DB_ADI, SURUM);
    istek.onupgradeneeded = () => {
      const db = istek.result;
      if (!db.objectStoreNames.contains("kuyruk")) db.createObjectStore("kuyruk", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    istek.onsuccess = () => coz(istek.result);
    istek.onerror = () => reddet(istek.error ?? new Error("Cihaz deposu açılamadı"));
  });
}

async function islem<T>(depo: "kuyruk" | "kv", kip: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await ac();
  try {
    return await new Promise<T | undefined>((coz, reddet) => {
      const tx = db.transaction(depo, kip);
      const istek = fn(tx.objectStore(depo));
      tx.oncomplete = () => coz(istek ? istek.result : undefined);
      tx.onerror = () => reddet(tx.error ?? new Error("Cihaz deposu hatası"));
      tx.onabort = () => reddet(tx.error ?? new Error("Cihaz deposu işlemi iptal edildi"));
    });
  } finally {
    db.close();
  }
}

export const kvOku = <T>(anahtar: string) => islem<T>("kv", "readonly", (s) => s.get(anahtar) as IDBRequest<T>);
export const kvYaz = (anahtar: string, deger: unknown) => islem("kv", "readwrite", (s) => { s.put(deger, anahtar); });
export const kvSil = (anahtar: string) => islem("kv", "readwrite", (s) => { s.delete(anahtar); });

export async function kuyrukListesi(sahip: string): Promise<KuyrukIsi[]> {
  const hepsi = (await islem<KuyrukIsi[]>("kuyruk", "readonly", (s) => s.getAll() as IDBRequest<KuyrukIsi[]>)) ?? [];
  return hepsi.filter((k) => k.sahip === sahip).sort((a, b) => a.olusturma - b.olusturma);
}
export const kuyrugaEkle = (is: KuyrukIsi) => islem("kuyruk", "readwrite", (s) => { s.put(is); });
export const kuyruktanSil = (id: string) => islem("kuyruk", "readwrite", (s) => { s.delete(id); });

/**
 * SAH-09: depo bu kullanıcıya ait değilse (başka kullanıcı ya da firma) temizlenir; süresi dolan
 * kuyruk işleri silinir. Silinen eski iş sayısı döner.
 */
export async function sahipligiDogrula(sahip: string): Promise<number> {
  const onceki = await kvOku<string>("sahip");
  if (onceki && onceki !== sahip) await hepsiniSil();
  await kvYaz("sahip", sahip);
  const sinir = Date.now() - KUYRUK_OMRU_MS;
  const eskiler = (await kuyrukListesi(sahip)).filter((k) => k.olusturma < sinir);
  for (const k of eskiler) await kuyruktanSil(k.id);
  return eskiler.length;
}

export async function hepsiniSil(): Promise<void> {
  await islem("kuyruk", "readwrite", (s) => { s.clear(); });
  await islem("kv", "readwrite", (s) => { s.clear(); });
}
