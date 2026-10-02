/**
 * KSB-11: çek/senet bordrosunun saf hesapları.
 */
import { Prisma } from "@prisma/client";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const GUN_MS = 86_400_000;
const gunSayisi = (gun: string) => Math.round(Date.parse(`${gun}T00:00:00Z`) / GUN_MS);

/**
 * Tutar ağırlıklı ortalama vade: Σ(tutar × vade günü) / Σ tutar, en yakın
 * güne yuvarlanır. Bordro tarihinden bağımsızdır; vadesi geçmiş evrak da sayılır.
 */
export function ortalamaVade(evraklar: Array<{ vadeTarihi: string; tutar: Prisma.Decimal.Value }>): string {
  if (!evraklar.length) throw new Error("Ortalama vade için en az bir evrak gerekir");
  const toplam = evraklar.reduce((t, e) => t.add(D(e.tutar)), D(0));
  if (toplam.lte(0)) return evraklar[0].vadeTarihi;
  const agirlikli = evraklar.reduce((t, e) => t.add(D(e.tutar).mul(gunSayisi(e.vadeTarihi))), D(0));
  const gun = agirlikli.div(toplam).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  return new Date(gun * GUN_MS).toISOString().slice(0, 10);
}

/** Bordro numarası: BRD2026-000001 (yıl başına sıra). */
export const bordroNoBicimle = (yil: number, sira: number) => `BRD${yil}-${String(sira).padStart(6, "0")}`;

/**
 * Otomatik portföy numaraları: yalnız rakamdan oluşan mevcut numaraların
 * en büyüğünden devam eder (elle verilmiş harfli numaralar sırayı bozmaz).
 */
export function siradakiPortfoyNolari(mevcut: string[], adet: number): string[] {
  const enBuyuk = mevcut.filter((n) => /^\d{1,12}$/.test(n)).reduce((m, n) => Math.max(m, Number(n)), 0);
  const genislik = Math.max(4, ...mevcut.filter((n) => /^\d{1,12}$/.test(n)).map((n) => n.length));
  return Array.from({ length: adet }, (_, i) => String(enBuyuk + i + 1).padStart(genislik, "0"));
}

export const BORDRO_BASLIGI: Record<string, string> = {
  giris: "ÇEK/SENET GİRİŞ BORDROSU",
  ciro: "ÇEK/SENET CİRO BORDROSU",
  tahsile: "BANKAYA TAHSİLE VERME BORDROSU",
  teminata: "BANKAYA TEMİNATA VERME BORDROSU",
  borc_cikis: "BORÇ ÇEKİ/SENEDİ ÇIKIŞ BORDROSU",
};
