/**
 * RPR-12 (2026-10-11, rapor incelemesi P0-2/P1-1): şirketin tek kâr tanımı.
 *
 *   Net satış   = ticari satış − satış iadeleri (KDV hariç, TL)
 *   Brüt kâr    = net satış − satılan malın maliyeti (stok hareketlerinden)
 *   Net kâr     = brüt kâr + diğer gelirler − faaliyet giderleri
 *
 * Faaliyet giderleri: hizmet alışları, masraflar, bordro (işveren maliyeti).
 * Mal alışı gider değildir — stoğa girer, satıldığında SMM olarak düşer;
 * alış iadesi de stok maliyetini düşürür, gelir sayılmaz. Nakit ödemeler
 * (tediye) kâra hiç girmez: eski Kâr/Zarar Özeti tedarikçi ödemelerini de
 * düşüp alışı iki kez sayıyordu.
 *
 * Kaynaklar Gelir-Gider ile aynıdır (`tahakkuk.ts`) ve SMM ekranıyla aynıdır
 * (`satis-ozeti.ts`), böylece üç ekran aynı rakamı verir.
 */
import type { Prisma } from "@prisma/client";
import { maliyetBilinmiyor, satisSatirlari, type SatisSatiri } from "../stok/satis-ozeti";
import { tahakkukOku, type TahakkukKalemi } from "./tahakkuk";

export interface KarZarar {
  netSatis: number;
  smm: number;
  brutKar: number;
  digerGelirler: number;
  hizmetAlislari: number;
  masraflar: number;
  personel: number;
  /** DMR-13: kesin yıl sonu amortismanı (faaliyet gideri). */
  amortisman: number;
  faaliyetGiderleri: number;
  /** DMR-13: demirbaş satış ve hurda zararı (faaliyet dışı). */
  digerGiderler: number;
  netKar: number;
  /** Maliyeti sıfır görünen mal satışları: brüt kâr bu tutar kadar şişkin olabilir. */
  maliyetsizSatis: { satir: number; ciro: number };
}

const kurus = (n: number) => Math.round(n * 100) / 100;

export function karZararHesapla(kalemler: TahakkukKalemi[], satirlar: SatisSatiri[]): KarZarar {
  const topla = (kosul: (k: TahakkukKalemi) => boolean) => kalemler.filter(kosul).reduce((t, k) => t + k.tutarTry, 0);
  const netSatis = kurus(topla((k) => k.anahtar === "satis:ticari_satis") - topla((k) => k.anahtar === "satis_iadesi"));
  const digerGelirler = kurus(topla((k) => (k.anahtar.startsWith("satis:") && k.anahtar !== "satis:ticari_satis") || k.anahtar.startsWith("gelir_kategori:")));
  const hizmetAlislari = kurus(topla((k) => k.anahtar === "hizmet_alis"));
  const masraflar = kurus(topla((k) => k.anahtar.startsWith("masraf_kategori:")));
  const personel = kurus(topla((k) => k.anahtar === "personel"));
  const amortisman = kurus(topla((k) => k.anahtar === "amortisman"));
  const digerGiderler = kurus(topla((k) => k.anahtar === "demirbas_cikis_zarari"));
  const smm = kurus(satirlar.reduce((t, s) => t + Number(s.maliyet), 0));
  const maliyetsiz = satirlar.filter(maliyetBilinmiyor);
  const brutKar = kurus(netSatis - smm);
  const faaliyetGiderleri = kurus(hizmetAlislari + masraflar + personel + amortisman);
  return {
    netSatis, smm, brutKar, digerGelirler, hizmetAlislari, masraflar, personel, amortisman, faaliyetGiderleri, digerGiderler,
    netKar: kurus(brutKar + digerGelirler - faaliyetGiderleri - digerGiderler),
    maliyetsizSatis: { satir: maliyetsiz.length, ciro: kurus(maliyetsiz.reduce((t, s) => t + Number(s.ciro), 0)) },
  };
}

/** Tarih aralığındaki tahakkuk kalemleri ve satış satırları (aynı süzgeçle). */
export async function karZararVerisi(tx: Prisma.TransactionClient, tenantId: string, baslangic: Date, bitis: Date) {
  const [{ kalemler, uyarilar }, satirlar] = await Promise.all([
    tahakkukOku(tx, tenantId, baslangic, bitis),
    satisSatirlari(tx, { gte: baslangic, lte: bitis }),
  ]);
  return { kalemler, satirlar, uyarilar };
}
