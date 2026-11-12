"use client";

import { api, ApiHata } from "./api";
import { kuyrukListesi, kuyrugaEkle, kuyruktanSil, type KuyrukIsi } from "./saha-depo";

/** SAH-08: kuyruktaki masraf fişi (fotoğraf Blob olarak saklanır). */
export interface MasrafKuyrukVerisi { foto: Blob; dosyaAdi: string; not: string }
export interface SoruOzeti { id: string; soru: string; secenekler: Array<{ kod: string; etiket: string }>; serbestYanit: boolean }
export interface MasrafSonucu { sonuc: string; masrafId?: string; talepId?: string; soru?: SoruOzeti }

export type GonderimSonucu =
  | { tur: "sayim"; is: KuyrukIsi; sayimId: string }
  | { tur: "masraf"; is: KuyrukIsi; sonuc: MasrafSonucu };

/** Bağlantı ya da sunucu geçici hatası mı (yeniden denenir), yoksa kalıcı ret mi (kullanıcı görür)? */
export function geciciHataMi(hata: unknown): boolean {
  if (!(hata instanceof ApiHata)) return true;
  return hata.durum === 0 || hata.durum === 408 || hata.durum === 409 || hata.durum === 429 || hata.durum >= 500;
}

/** Tek işi gönderir; tekrar koruması iş kimliğiyle (aynı iş iki kez kayıt açmaz). */
async function gonder(is: KuyrukIsi): Promise<GonderimSonucu> {
  const headers = { "Idempotency-Key": `saha:${is.id}` };
  if (is.tur === "sayim") {
    const sayim = await api<{ id: string }>("/stok/sayimlar", { method: "POST", headers, body: JSON.stringify(is.veri) });
    return { tur: "sayim", is, sayimId: sayim.id };
  }
  const v = is.veri as MasrafKuyrukVerisi;
  const form = new FormData();
  form.append("dosya", new File([v.foto], v.dosyaAdi, { type: v.foto.type || "image/jpeg" }));
  if (v.not) form.append("not", v.not);
  const sonuc = await api<MasrafSonucu>("/saha/ai-fis", { method: "POST", headers, body: form });
  return { tur: "masraf", is, sonuc };
}

let calisiyor = false;

/**
 * SAH-02: bekleyen işleri sırayla gönderir. Başarılı iş silinir; kalıcı ret (ör. yetki, geçersiz
 * veri) "hata" olarak kalır ve kullanıcı yeniden dener ya da siler; geçici hata kuyrukta bekler.
 */
export async function kuyruguIsle(sahip: string, yalniz?: string): Promise<{ sonuclar: GonderimSonucu[]; kalan: number }> {
  if (calisiyor) return { sonuclar: [], kalan: (await kuyrukListesi(sahip)).length };
  calisiyor = true;
  const sonuclar: GonderimSonucu[] = [];
  try {
    for (const is of await kuyrukListesi(sahip)) {
      if (yalniz && is.id !== yalniz) continue;
      if (!yalniz && is.durum === "hata") continue;
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      try {
        sonuclar.push(await gonder(is));
        await kuyruktanSil(is.id);
      } catch (hata) {
        if (geciciHataMi(hata)) {
          await kuyrugaEkle({ ...is, deneme: is.deneme + 1 });
          break;
        }
        await kuyrugaEkle({ ...is, durum: "hata", hata: hata instanceof Error ? hata.message : "Gönderilemedi", deneme: is.deneme + 1 });
      }
    }
  } finally {
    calisiyor = false;
  }
  return { sonuclar, kalan: (await kuyrukListesi(sahip)).length };
}
