import type { Prisma } from "@prisma/client";

/**
 * PRS-02 (P0-3/P0-4, karar 2026-10-04): tahakkuk ve puantaj kapsamı istihdam
 * dönemlerinden belirlenir; durum yalnız "taslak"ı dışarıda bırakır (askıda ve
 * uzun süreli izindeki personel tahakkuka girer, puantajla düşülür).
 *
 * Gün kuralı: ayın tamamında istihdam edilen 30 gün; ay içi giriş/çıkışta
 * istihdamın o aydaki takvim günü (en çok 30). Çıkış tarihi son çalışılan
 * gündür, dahildir. Ücret = aylık ücret / 30 × gün.
 */

export interface IstihdamAraligi { baslangicTarihi: Date; bitisTarihi: Date | null }

const GUN_MS = 86_400_000;
const utcGun = (t: Date) => Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());

export function donemSinirlari(yil: number, ay: number) {
  return { baslangic: new Date(Date.UTC(yil, ay - 1, 1)), son: new Date(Date.UTC(yil, ay, 0)) };
}

/** Dönemle kesişen istihdamı olan, taslak olmayan personel. */
export function tahakkukKapsamiKosulu(tenantId: string, yil: number, ay: number): Prisma.PersonelWhereInput {
  const { baslangic, son } = donemSinirlari(yil, ay);
  return {
    tenantId,
    durum: { not: "taslak" },
    istihdamDonemleri: { some: { baslangicTarihi: { lte: son }, OR: [{ bitisTarihi: null }, { bitisTarihi: { gte: baslangic } }] } },
  };
}

/** Dönemdeki istihdam günü (0–30). */
export function istihdamGunu(donemler: IstihdamAraligi[], yil: number, ay: number): number {
  const { baslangic, son } = donemSinirlari(yil, ay);
  const ayBas = utcGun(baslangic), aySon = utcGun(son);
  const ayGunu = Math.round((aySon - ayBas) / GUN_MS) + 1;
  let gun = 0;
  for (const d of donemler) {
    const bas = Math.max(ayBas, utcGun(d.baslangicTarihi));
    const bit = Math.min(aySon, d.bitisTarihi ? utcGun(d.bitisTarihi) : aySon);
    if (bit >= bas) gun += Math.round((bit - bas) / GUN_MS) + 1;
  }
  return gun >= ayGunu ? 30 : Math.min(30, gun);
}

export interface UcretsizIzin { baslangicTarihi: Date; bitisTarihi: Date; turKod: string }

/**
 * PRS-09 (P1-8): onaylı ücretsiz izinlerin dönemdeki takvim günü (istihdam
 * içinde kalan kısmı) ve önerilen eksik gün nedeni. Prim günü önerisi =
 * istihdam günü − ücretsiz izin günü (en az 0); puantaj elle girilmişse o geçer.
 */
export function izinliPrimGunu(istihdamlar: IstihdamAraligi[], izinler: UcretsizIzin[], yil: number, ay: number): { istihdamGunu: number; ucretsizIzinGunu: number; primGunu: number; eksikGunNedeni: "istirahat" | "ucretsiz_izin" | null } {
  const tam = istihdamGunu(istihdamlar, yil, ay);
  const { baslangic, son } = donemSinirlari(yil, ay);
  const ayBas = utcGun(baslangic), aySon = utcGun(son);
  const gunler = new Set<number>();
  let hastalik = 0, diger = 0;
  for (const iz of izinler) {
    for (let g = Math.max(ayBas, utcGun(iz.baslangicTarihi)); g <= Math.min(aySon, utcGun(iz.bitisTarihi)); g += GUN_MS) {
      const istihdamda = istihdamlar.some((d) => utcGun(d.baslangicTarihi) <= g && (!d.bitisTarihi || utcGun(d.bitisTarihi) >= g));
      if (!istihdamda || gunler.has(g)) continue;
      gunler.add(g);
      if (iz.turKod === "hastalik") hastalik += 1; else diger += 1;
    }
  }
  const izinGunu = Math.min(gunler.size, tam);
  return {
    istihdamGunu: tam,
    ucretsizIzinGunu: izinGunu,
    primGunu: Math.max(0, tam - izinGunu),
    eksikGunNedeni: izinGunu === 0 ? null : hastalik > diger ? "istirahat" : "ucretsiz_izin",
  };
}
