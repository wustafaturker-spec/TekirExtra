import { mevzuatDegerHatalari, oncekiGun } from "@tekirextra/shared";

/**
 * MVZ-02/05: bir değişikliğin satırlarını yürürlükteki kayıtlara uygulama
 * planı. Veritabanından bağımsızdır; onaya gönderirken (erken hata) ve
 * yayında (asıl uygulama) aynı plan üretilir.
 *
 * Kural: her `(tur, anahtar)` için en çok bir **açık** kayıt (bitişi boş)
 * bulunur. Yeni yürürlük, açık kaydın başlangıcından **sonra** olmalıdır; açık
 * kayıt yeni yürürlükten bir gün önce kapanır. Geçmişe kayıt eklemek (açık
 * kaydın başlangıcından önceye) bu aşamada desteklenmez — tarihçe ilk dolumda
 * tohumdan gelir.
 */

export interface PlanKaydi {
  id: string;
  tur: string;
  anahtar: string;
  yururlukBaslangic: string; // YYYY-MM-DD
  yururlukBitis: string | null;
}

export interface PlanSatiri {
  tur: string;
  anahtar: string;
  islem: "ekle" | "degistir" | "kaldir";
  deger: unknown;
}

export interface YayinPlani {
  kapat: { id: string; yururlukBitis: string }[];
  ekle: { tur: string; anahtar: string; deger: unknown; yururlukBaslangic: string }[];
  hatalar: string[];
}

const ad = (s: { tur: string; anahtar: string }) => `${s.tur}/${s.anahtar}`;

export function yayinPlani(mevcut: PlanKaydi[], satirlar: PlanSatiri[], yururluk: string): YayinPlani {
  const plan: YayinPlani = { kapat: [], ekle: [], hatalar: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yururluk)) plan.hatalar.push(`Yürürlük tarihi geçersiz: ${yururluk}`);
  if (satirlar.length === 0) plan.hatalar.push("Değişiklikte en az bir satır bulunmalıdır");

  const gorulen = new Set<string>();
  for (const satir of satirlar) {
    const etiket = ad(satir);
    if (gorulen.has(etiket)) { plan.hatalar.push(`${etiket} birden çok kez girilmiş`); continue; }
    gorulen.add(etiket);

    if (satir.islem !== "kaldir") {
      for (const h of mevzuatDegerHatalari(satir.tur, satir.anahtar, satir.deger)) plan.hatalar.push(`${etiket}: ${h}`);
    }

    const kayitlar = mevcut.filter((k) => k.tur === satir.tur && k.anahtar === satir.anahtar);
    const acik = kayitlar.find((k) => k.yururlukBitis === null);
    const sonBaslangic = kayitlar.reduce<string | null>((en, k) => (en === null || k.yururlukBaslangic > en ? k.yururlukBaslangic : en), null);
    if (sonBaslangic && sonBaslangic >= yururluk) {
      plan.hatalar.push(`${etiket}: ${sonBaslangic} tarihinden geçerli bir kayıt var; yeni yürürlük bundan sonra olmalıdır`);
      continue;
    }

    if (satir.islem === "ekle") {
      if (acik) { plan.hatalar.push(`${etiket} zaten yürürlükte; "değiştir" kullanın`); continue; }
      plan.ekle.push({ tur: satir.tur, anahtar: satir.anahtar, deger: satir.deger, yururlukBaslangic: yururluk });
    } else {
      if (!acik) { plan.hatalar.push(`${etiket} yürürlükte değil; ${satir.islem === "kaldir" ? "kaldırılamaz" : '"ekle" kullanın'}`); continue; }
      plan.kapat.push({ id: acik.id, yururlukBitis: oncekiGun(yururluk) });
      if (satir.islem === "degistir") plan.ekle.push({ tur: satir.tur, anahtar: satir.anahtar, deger: satir.deger, yururlukBaslangic: yururluk });
    }
  }
  return plan;
}

/** Bir tarihte yürürlükte olan kayıt: başlangıç ≤ tarih ve (bitiş yok ya da tarih ≤ bitiş). */
export function yururluktedir(k: { yururlukBaslangic: string; yururlukBitis: string | null }, tarih: string): boolean {
  return k.yururlukBaslangic <= tarih && (k.yururlukBitis === null || tarih <= k.yururlukBitis);
}
