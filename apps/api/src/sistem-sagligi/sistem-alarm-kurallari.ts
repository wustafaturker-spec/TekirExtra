/**
 * PLT-19: alarm kuralları — saf işlev; veri toplamadan ve e-postadan ayrı
 * tutulur ki eşikler birim testle sınansın.
 */
export const ESIK = {
  /** Worker nabzı bu kadar dakikadır gelmiyorsa. */
  workerNabizDk: 10,
  /** Son 1 saatte bu kadar ya da daha çok yeniden başlama. */
  saatlikYenidenBaslama: 2,
  /** Gelen tarama kursörü bu kadar saattir ilerlemiyorsa. */
  kursorSaat: 3,
  /** Zamanlayıcı art arda bu kadar kez hata verdiyse. */
  ardisikHata: 3,
} as const;

export interface AlarmGirdisi {
  simdi: Date;
  /** En yeni önce; yalnız worker süreçleri. */
  workerSurecleri: { basladiAt: Date; sonNabizAt: Date }[];
  /** Son 1 saatten önce de bir worker açılışı var mı; yoksa penceredeki ilk açılış yeniden başlama sayılmaz. */
  oncekiWorkerVar: boolean;
  oluIsler: { id: string; tenantId: string; unvan?: string; isTuru: string; hata: string }[];
  kursorler: { tenantId: string; unvan: string; sonCekimAt: Date | null }[];
  isler: { isAdi: string; ardisikHata: number; sonHata: string | null }[];
}

export interface Sorun { anahtar: string; tur: string; ozet: string }

const dk = (ms: number) => Math.round(ms / 60_000);

export function sorunlariBul(g: AlarmGirdisi): Sorun[] {
  const t = g.simdi.getTime();
  const sorunlar: Sorun[] = [];
  const son = g.workerSurecleri[0];
  if (son && t - son.sonNabizAt.getTime() > ESIK.workerNabizDk * 60_000) {
    sorunlar.push({ anahtar: "worker:nabiz", tur: "worker_nabiz", ozet: `Worker nabzı ${dk(t - son.sonNabizAt.getTime())} dakikadır gelmiyor (son nabız ${son.sonNabizAt.toISOString()}).` });
  }
  const saatlik = g.workerSurecleri.filter((s) => t - s.basladiAt.getTime() <= 3_600_000);
  const yenidenBaslama = Math.max(0, saatlik.length - (g.oncekiWorkerVar ? 0 : 1));
  if (yenidenBaslama >= ESIK.saatlikYenidenBaslama) {
    sorunlar.push({ anahtar: "worker:yeniden-baslama", tur: "worker_yeniden_baslama", ozet: `Worker son 1 saatte ${yenidenBaslama} kez yeniden başladı (bellek taşması ya da çökme olabilir).` });
  }
  for (const o of g.oluIsler) {
    sorunlar.push({ anahtar: `olu-is:${o.id}`, tur: "olu_is", ozet: `Kuyruktan düşen iş: ${o.isTuru} — ${o.unvan ?? o.tenantId}: ${o.hata}`.slice(0, 1000) });
  }
  for (const k of g.kursorler) {
    if (k.sonCekimAt && t - k.sonCekimAt.getTime() <= ESIK.kursorSaat * 3_600_000) continue;
    sorunlar.push({
      anahtar: `kursor:${k.tenantId}`, tur: "gelen_kursor",
      ozet: k.sonCekimAt
        ? `${k.unvan.trim()}: gelen e-Fatura taraması ${Math.floor((t - k.sonCekimAt.getTime()) / 3_600_000)} saattir başarıyla bitmiyor (son ${k.sonCekimAt.toISOString()}).`
        : `${k.unvan.trim()}: gelen e-Fatura taraması hiç tamamlanmadı.`,
    });
  }
  for (const i of g.isler) {
    if (i.ardisikHata >= ESIK.ardisikHata) sorunlar.push({ anahtar: `is:${i.isAdi}`, tur: "zamanlayici", ozet: `${i.isAdi} art arda ${i.ardisikHata} kez hata verdi: ${i.sonHata ?? ""}`.slice(0, 1000) });
  }
  return sorunlar;
}
