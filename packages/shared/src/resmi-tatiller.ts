/**
 * Türkiye resmî tatilleri (2429 sayılı Kanun). Sabit günler her yıl için
 * hesaplanır; dinî bayramlar ay takvimine bağlı olduğundan yalnız Diyanet'in
 * açıkladığı yıllar için tanımlıdır. Arife günleri öğleden sonra tatildir
 * (yarım gün).
 */
export interface ResmiTatil {
  tarih: string; // YYYY-MM-DD
  ad: string;
  yarimGun: boolean;
}

const SABIT_TATILLER: { ay: number; gun: number; ad: string; yarimGun?: boolean }[] = [
  { ay: 1, gun: 1, ad: "Yılbaşı" },
  { ay: 4, gun: 23, ad: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { ay: 5, gun: 1, ad: "Emek ve Dayanışma Günü" },
  { ay: 5, gun: 19, ad: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { ay: 7, gun: 15, ad: "Demokrasi ve Millî Birlik Günü" },
  { ay: 8, gun: 30, ad: "Zafer Bayramı" },
  { ay: 10, gun: 28, ad: "Cumhuriyet Bayramı arifesi", yarimGun: true },
  { ay: 10, gun: 29, ad: "Cumhuriyet Bayramı" },
];

/** Dinî bayramlar: arife tarihi + bayram gün sayısı (Diyanet takvimi). */
const DINI_BAYRAMLAR: Record<number, { ad: string; arife: string; gunSayisi: number }[]> = {
  2026: [
    { ad: "Ramazan Bayramı", arife: "2026-03-19", gunSayisi: 3 },
    { ad: "Kurban Bayramı", arife: "2026-05-26", gunSayisi: 4 },
  ],
  2027: [
    { ad: "Ramazan Bayramı", arife: "2027-03-08", gunSayisi: 3 },
    { ad: "Kurban Bayramı", arife: "2027-05-15", gunSayisi: 4 },
  ],
};

/** Dinî bayram tarihleri yerleşik olan yıllar. */
export const DINI_BAYRAM_YILLARI = Object.keys(DINI_BAYRAMLAR).map(Number);

const iki = (n: number) => String(n).padStart(2, "0");
const gunEkle = (tarih: string, gun: number) => new Date(Date.parse(`${tarih}T00:00:00Z`) + gun * 86400000).toISOString().slice(0, 10);

/** Yılın resmî tatilleri, tarih sırasıyla; dinî bayramı tanımsız yılda yalnız sabit günler. */
export function resmiTatiller(yil: number): ResmiTatil[] {
  const liste: ResmiTatil[] = SABIT_TATILLER.map((t) => ({ tarih: `${yil}-${iki(t.ay)}-${iki(t.gun)}`, ad: t.ad, yarimGun: t.yarimGun ?? false }));
  for (const bayram of DINI_BAYRAMLAR[yil] ?? []) {
    liste.push({ tarih: bayram.arife, ad: `${bayram.ad} arifesi`, yarimGun: true });
    for (let i = 1; i <= bayram.gunSayisi; i++) liste.push({ tarih: gunEkle(bayram.arife, i), ad: `${bayram.ad} ${i}. gün`, yarimGun: false });
  }
  // Aynı güne düşen iki tatil (ör. 19 Mayıs 2027 = Kurban 4. gün) tek kayıt olur; tam gün yarım günü örter.
  const gunler = new Map<string, ResmiTatil>();
  for (const t of liste) {
    const onceki = gunler.get(t.tarih);
    gunler.set(t.tarih, onceki ? { tarih: t.tarih, ad: `${onceki.ad} / ${t.ad}`, yarimGun: onceki.yarimGun && t.yarimGun } : t);
  }
  return [...gunler.values()].sort((a, b) => a.tarih.localeCompare(b.tarih));
}
