/**
 * Yaşlandırma (CARI-06): açık bakiye, FIFO varsayımıyla vadesi en eski
 * hareketlere dağıtılır; karşı yöndeki hareketler en eski açıkları kapatır.
 * Saf fonksiyon — birim testi kolay olsun diye Prisma'dan bağımsız.
 *
 * CARI-33: tutar hareketin kendi dövizindedir; dövizler birbirine karışmasın
 * diye çağıran her dövizi ayrı yaşlandırır. Yön:
 * - `alacaklarimiz`: cariye borç yazılanlar (satış) açık kalem, alacaklar kapatır.
 * - `borclarimiz`: cariye alacak yazılanlar (alış) açık kalem, borçlar kapatır.
 */
export type YaslandirmaYonu = "alacaklarimiz" | "borclarimiz";

export interface YaslandirmaHareketi {
  tip: "borc" | "alacak";
  tutar: number;
  vadeTarihi: Date | null;
  tarih: Date;
}

export interface YaslandirmaSonucu {
  guncel: number; // vadesi gelmemiş
  gun0_30: number;
  gun31_60: number;
  gun61_90: number;
  gun90Ustu: number;
  toplam: number;
}

export const YASLANDIRMA_KOVALARI = ["guncel", "gun0_30", "gun31_60", "gun61_90", "gun90Ustu"] as const;

export const bosYaslandirma = (): YaslandirmaSonucu => ({ guncel: 0, gun0_30: 0, gun31_60: 0, gun61_90: 0, gun90Ustu: 0, toplam: 0 });

/**
 * FIFO sonrası açık kalan kalemler (vadesi en eskiden), her biri kendi açık
 * tutarıyla. Girdi nesnesinin diğer alanları (ör. kaynak belge) korunur;
 * vade hatırlatmasındaki fatura listesi bunu kullanır (CARI-38).
 */
export function acikKalemler<T extends YaslandirmaHareketi>(hareketler: T[], yon: YaslandirmaYonu = "alacaklarimiz"): (T & { acik: number })[] {
  const acikTip = yon === "alacaklarimiz" ? "borc" : "alacak";
  // Karşı yön toplamı en eski açık kalemlerden düşülür (FIFO)
  let kalanKapatan = hareketler
    .filter((h) => h.tip !== acikTip)
    .reduce((t, h) => t + h.tutar, 0);
  return hareketler
    .filter((h) => h.tip === acikTip)
    .sort(
      (a, b) =>
        (a.vadeTarihi ?? a.tarih).getTime() - (b.vadeTarihi ?? b.tarih).getTime(),
    )
    .map((h) => {
      const kapatilan = Math.min(kalanKapatan, h.tutar);
      kalanKapatan -= kapatilan;
      return { ...h, acik: h.tutar - kapatilan };
    })
    .filter((h) => h.acik > 0.005);
}

export function yaslandir(
  hareketler: YaslandirmaHareketi[],
  bugun: Date,
  yon: YaslandirmaYonu = "alacaklarimiz",
): YaslandirmaSonucu {
  const acikKalemlerListesi = acikKalemler(hareketler, yon);

  const sonuc = bosYaslandirma();
  const GUN_MS = 24 * 60 * 60 * 1000;

  for (const kalem of acikKalemlerListesi) {
    const vade = kalem.vadeTarihi ?? kalem.tarih;
    const gecikmeGun = Math.floor((bugun.getTime() - vade.getTime()) / GUN_MS);
    if (gecikmeGun <= 0) sonuc.guncel += kalem.acik;
    else if (gecikmeGun <= 30) sonuc.gun0_30 += kalem.acik;
    else if (gecikmeGun <= 60) sonuc.gun31_60 += kalem.acik;
    else if (gecikmeGun <= 90) sonuc.gun61_90 += kalem.acik;
    else sonuc.gun90Ustu += kalem.acik;
    sonuc.toplam += kalem.acik;
  }
  const y = (n: number): number => Math.round(n * 100) / 100;
  return {
    guncel: y(sonuc.guncel),
    gun0_30: y(sonuc.gun0_30),
    gun31_60: y(sonuc.gun31_60),
    gun61_90: y(sonuc.gun61_90),
    gun90Ustu: y(sonuc.gun90Ustu),
    toplam: y(sonuc.toplam),
  };
}
