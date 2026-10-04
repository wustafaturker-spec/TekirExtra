/**
 * PRS-08 (P1-7): yıllık ücretli izin hakkı, İş Kanunu m.53.
 * Kıdem 1–5 yıl (5 dahil) 14 gün, 5'ten fazla 15'ten az 20 gün, 15 ve üstü 26
 * gün; 18 yaş ve altı ile 50 yaş ve üstünde en az 20 gün. Hak, her hizmet yılı
 * dolduğunda doğar; aynı işverendeki kesintili çalışmalar birleştirilir.
 */

export interface IstihdamDonemi { baslangicTarihi: Date; bitisTarihi: Date | null }

const GUN_MS = 86_400_000;
const utc = (t: Date) => Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());

export function yillikIzinGunu(kidemYili: number, yas: number | null): number {
  const kidem = kidemYili <= 5 ? 14 : kidemYili < 15 ? 20 : 26;
  return yas !== null && (yas <= 18 || yas >= 50) ? Math.max(kidem, 20) : kidem;
}

export function yasHesapla(dogum: Date, tarih: Date): number {
  let yas = tarih.getUTCFullYear() - dogum.getUTCFullYear();
  if (tarih.getUTCMonth() < dogum.getUTCMonth() || (tarih.getUTCMonth() === dogum.getUTCMonth() && tarih.getUTCDate() < dogum.getUTCDate())) yas -= 1;
  return yas;
}

/**
 * Bugüne kadar dolan hizmet yıllarının tarihleri (1., 2., … yıl). Tek ve
 * kesintisiz dönemde takvim yıl dönümü; birden çok dönemde toplam hizmet günü
 * 365'in katına ulaştığı gün.
 */
export function hizmetYildonumleri(donemler: IstihdamDonemi[], bugun: Date): Date[] {
  const sirali = [...donemler].sort((a, b) => utc(a.baslangicTarihi) - utc(b.baslangicTarihi));
  const son = utc(bugun);
  const sonuc: Date[] = [];
  if (sirali.length === 1) {
    const d = sirali[0];
    const bitis = Math.min(son, d.bitisTarihi ? utc(d.bitisTarihi) : son);
    for (let n = 1; n < 80; n += 1) {
      const t = new Date(Date.UTC(d.baslangicTarihi.getUTCFullYear() + n, d.baslangicTarihi.getUTCMonth(), d.baslangicTarihi.getUTCDate()));
      if (utc(t) > bitis) break;
      sonuc.push(t);
    }
    return sonuc;
  }
  let birikmis = 0;
  let hedef = 365;
  for (const d of sirali) {
    const bas = utc(d.baslangicTarihi);
    const bit = Math.min(son, d.bitisTarihi ? utc(d.bitisTarihi) : son);
    if (bit < bas) continue;
    const gun = Math.round((bit - bas) / GUN_MS) + 1;
    while (birikmis + gun >= hedef) {
      sonuc.push(new Date(bas + (hedef - birikmis - 1) * GUN_MS));
      hedef += 365;
    }
    birikmis += gun;
  }
  return sonuc;
}

/**
 * İşlenecek hak edişler. Daha önce hiç otomatik hak ediş yazılmamışsa yalnız
 * son dolan yıl yazılır (geçmiş yıllarda kullanılan izinler sistemde
 * olmadığından eski hakların tamamı bakiyeyi şişirir; gerekirse devir girilir).
 */
export function islenecekHakEdisler(yildonumleri: Date[], islenmisYillar: number[]): number[] {
  const dolan = yildonumleri.length;
  if (!dolan) return [];
  if (!islenmisYillar.length) return [dolan];
  const enBuyuk = Math.max(...islenmisYillar);
  return Array.from({ length: Math.max(0, dolan - enBuyuk) }, (_, i) => enBuyuk + i + 1);
}
