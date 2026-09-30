import { Prisma } from "@prisma/client";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

/** Üretim günü 08:00'de başlar; gün içindeki planlanan dakikalar buradan sayılır. */
const GUN_BASLANGIC_SAATI = 8;

/** Günün çalışma katsayısı: hafta içi tam, cumartesi yarım, pazar yok. */
export function gunKatsayisi(gun: Date): number {
  const haftaGunu = gun.getDay();
  return haftaGunu === 0 ? 0 : haftaGunu === 6 ? 0.5 : 1;
}

/** Aralıktaki çalışma günü sayısı (kapasite hesabı). */
export function kapasiteGunu(ilk: Date, son: Date): Prisma.Decimal {
  let toplam = D(0);
  for (let gun = new Date(ilk); gun <= son; gun = new Date(gun.getTime() + 86400000)) toplam = toplam.add(gunKatsayisi(gun));
  return toplam;
}

const gunBasi = (an: Date) => { const gun = new Date(an); gun.setHours(GUN_BASLANGIC_SAATI, 0, 0, 0); return gun; };
const sonrakiGunBasi = (an: Date) => { const gun = gunBasi(an); gun.setDate(gun.getDate() + 1); return gun; };

/**
 * Operasyonları sırayla iş merkezlerinin takvimine yerleştirir. Her gün
 * 08:00'den itibaren merkezin etkin günlük kapasitesi (günlük dakika ×
 * verimlilik; cumartesi yarısı) kadar çalışılır, pazar atlanır; sığmayan
 * süre sonraki iş gününe taşar. Bir operasyon öncekinin bittiği anda başlar.
 */
export function operasyonlariPlanla<T extends { dakika: Prisma.Decimal; gunlukKapasiteDakika: number; verimlilikYuzdesi: Prisma.Decimal | number }>(
  baslangicGunu: Date,
  operasyonlar: T[],
): (T & { baslangic: Date; bitis: Date })[] {
  let imlec = gunBasi(baslangicGunu);
  return operasyonlar.map((operasyon) => {
    const gunlukDakika = D(operasyon.gunlukKapasiteDakika).mul(operasyon.verimlilikYuzdesi).div(100).toNumber();
    const gunKapasitesi = (an: Date) => gunlukDakika * gunKatsayisi(an);
    const kullanilan = (an: Date) => (an.getTime() - gunBasi(an).getTime()) / 60000;
    // Kapasitesi olmayan merkezde süre yerleştirilemez; sonsuz döngüye girmeden öncekinin bitişine yazılır.
    if (gunlukDakika <= 0) return { ...operasyon, baslangic: imlec, bitis: imlec };
    // Başlangıç: çalışılabilir ve kapasitesi dolmamış ilk an.
    while (gunKapasitesi(imlec) <= 0 || kullanilan(imlec) >= gunKapasitesi(imlec)) imlec = sonrakiGunBasi(imlec);
    const baslangic = imlec;
    let kalan = operasyon.dakika.toNumber();
    while (kalan > 0) {
      if (gunKapasitesi(imlec) <= 0 || kullanilan(imlec) >= gunKapasitesi(imlec)) { imlec = sonrakiGunBasi(imlec); continue; }
      const bugun = Math.min(kalan, gunKapasitesi(imlec) - kullanilan(imlec));
      imlec = new Date(imlec.getTime() + bugun * 60000);
      kalan -= bugun;
    }
    return { ...operasyon, baslangic, bitis: imlec };
  });
}
