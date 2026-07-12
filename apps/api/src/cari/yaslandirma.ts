/**
 * Yaşlandırma (CARI-06): açık borç bakiyesi, FIFO varsayımıyla vadesi en
 * eski borç hareketlerine dağıtılır; alacaklar en eski borçları kapatır.
 * Saf fonksiyon — birim testi kolay olsun diye Prisma'dan bağımsız.
 */
export interface YaslandirmaHareketi {
  tip: "borc" | "alacak";
  tutarTry: number;
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

export function yaslandir(
  hareketler: YaslandirmaHareketi[],
  bugun: Date,
): YaslandirmaSonucu {
  // Alacak toplamı en eski borçlardan düşülür (FIFO)
  let kalanAlacak = hareketler
    .filter((h) => h.tip === "alacak")
    .reduce((t, h) => t + h.tutarTry, 0);

  const acikBorclar = hareketler
    .filter((h) => h.tip === "borc")
    .sort(
      (a, b) =>
        (a.vadeTarihi ?? a.tarih).getTime() - (b.vadeTarihi ?? b.tarih).getTime(),
    )
    .map((h) => {
      const kapatilan = Math.min(kalanAlacak, h.tutarTry);
      kalanAlacak -= kapatilan;
      return { ...h, acik: h.tutarTry - kapatilan };
    })
    .filter((h) => h.acik > 0.005);

  const sonuc: YaslandirmaSonucu = {
    guncel: 0,
    gun0_30: 0,
    gun31_60: 0,
    gun61_90: 0,
    gun90Ustu: 0,
    toplam: 0,
  };
  const GUN_MS = 24 * 60 * 60 * 1000;

  for (const borc of acikBorclar) {
    const vade = borc.vadeTarihi ?? borc.tarih;
    const gecikmeGun = Math.floor((bugun.getTime() - vade.getTime()) / GUN_MS);
    if (gecikmeGun <= 0) sonuc.guncel += borc.acik;
    else if (gecikmeGun <= 30) sonuc.gun0_30 += borc.acik;
    else if (gecikmeGun <= 60) sonuc.gun31_60 += borc.acik;
    else if (gecikmeGun <= 90) sonuc.gun61_90 += borc.acik;
    else sonuc.gun90Ustu += borc.acik;
    sonuc.toplam += borc.acik;
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
