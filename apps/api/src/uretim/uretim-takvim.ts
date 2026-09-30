import { Prisma } from "@prisma/client";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

/** Günün tatil katsayısı (tam gün 0, arife 0,5); anahtar YYYY-MM-DD. */
export type TatilHaritasi = Map<string, number>;

export interface TakvimAyari {
  /** Üretim gününün başladığı saat (SS:DD); varsayılan 08:00. */
  baslangicSaati?: string;
  tatiller?: TatilHaritasi;
}

/** Yerel takvim günü anahtarı; tatiller tabloda gün olarak saklanır. */
const gunAnahtari = (gun: Date) => `${gun.getFullYear()}-${String(gun.getMonth() + 1).padStart(2, "0")}-${String(gun.getDate()).padStart(2, "0")}`;

/**
 * Günün çalışma katsayısı: hafta içi tam, cumartesi yarım, pazar yok; tatil
 * günü 0, arife yarım. Cumartesiye denk gelen arife yine yarım gündür.
 */
export function gunKatsayisi(gun: Date, tatiller?: TatilHaritasi): number {
  const haftaGunu = gun.getDay();
  const hafta = haftaGunu === 0 ? 0 : haftaGunu === 6 ? 0.5 : 1;
  const tatil = tatiller?.get(gunAnahtari(gun));
  return tatil === undefined ? hafta : Math.min(hafta, tatil);
}

/** Aralıktaki çalışma günü sayısı (kapasite hesabı). */
export function kapasiteGunu(ilk: Date, son: Date, tatiller?: TatilHaritasi): Prisma.Decimal {
  let toplam = D(0);
  for (let gun = new Date(ilk); gun <= son; gun = new Date(gun.getTime() + 86400000)) toplam = toplam.add(gunKatsayisi(gun, tatiller));
  return toplam;
}

/**
 * Operasyonları sırayla iş merkezlerinin takvimine yerleştirir. Her gün
 * ayardaki başlangıç saatinden itibaren merkezin etkin günlük kapasitesi
 * (günlük dakika × verimlilik × gün katsayısı) kadar çalışılır; pazar ve tam
 * gün tatiller atlanır, sığmayan süre sonraki iş gününe taşar. Bir operasyon
 * öncekinin bittiği anda başlar.
 */
export function operasyonlariPlanla<T extends { dakika: Prisma.Decimal; gunlukKapasiteDakika: number; verimlilikYuzdesi: Prisma.Decimal | number }>(
  baslangicGunu: Date,
  operasyonlar: T[],
  ayar: TakvimAyari = {},
): (T & { baslangic: Date; bitis: Date })[] {
  const [saat, dakika] = (ayar.baslangicSaati ?? "08:00").split(":").map(Number);
  // Takvim durumu: içinde bulunulan iş günü (başlangıç anı) ve o gün harcanan
  // dakika. Gün, anın kendisinden türetilmez; geç başlayan gün gece yarısını
  // aşsa da aynı iş günü sayılır.
  let gun = new Date(baslangicGunu); gun.setHours(saat, dakika, 0, 0);
  let kullanilan = 0;
  const sonrakiGun = () => { const yeni = new Date(gun); yeni.setDate(yeni.getDate() + 1); yeni.setHours(saat, dakika, 0, 0); gun = yeni; kullanilan = 0; };
  const an = () => new Date(gun.getTime() + kullanilan * 60000);
  // Yanlışlıkla her gün tatil girilse bile döngü biter: en fazla iki yıl ileriye bakılır.
  const sinir = new Date(gun.getTime() + 730 * 86400000);
  return operasyonlar.map((operasyon) => {
    const gunlukDakika = D(operasyon.gunlukKapasiteDakika).mul(operasyon.verimlilikYuzdesi).div(100).toNumber();
    // Kapasitesi olmayan merkezde süre yerleştirilemez; öncekinin bitişine yazılır.
    if (gunlukDakika <= 0) return { ...operasyon, baslangic: an(), bitis: an() };
    const bosDakika = () => gunlukDakika * gunKatsayisi(gun, ayar.tatiller) - kullanilan;
    while (bosDakika() <= 0 && gun < sinir) sonrakiGun();
    const baslangic = an();
    let kalan = operasyon.dakika.toNumber();
    while (kalan > 0 && gun < sinir) {
      if (bosDakika() <= 0) { sonrakiGun(); continue; }
      const bugun = Math.min(kalan, bosDakika());
      kullanilan += bugun;
      kalan -= bugun;
    }
    return { ...operasyon, baslangic, bitis: an() };
  });
}
