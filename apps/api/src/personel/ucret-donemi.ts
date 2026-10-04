import { BadRequestException } from "@nestjs/common";
import { bordroHesapla, type BordroHesaplamaGirdisi, type BordroMevzuatParametreleri } from "./bordro-hesaplama";
import { donemSinirlari, type IstihdamAraligi } from "./tahakkuk-kapsami";

/**
 * PRS-06 (P1-1/P1-6, karar 2026-10-04 "rapordaki öneriler"): dönemin ücreti
 * yürürlük tarihli ücret geçmişinden alınır. Ay içinde değişiklik varsa her
 * ücret, o ücretin geçerli olduğu istihdam günleriyle ağırlıklandırılır ve aylık
 * eşdeğer bulunur (tahakkuk bunu prim günü / 30 ile çarpar). Bir ay içinde net
 * ile brüt arasında geçiş yapılamaz.
 */

export type UcretTipi = "net" | "brut";
export interface UcretKaydi { yururlukTarihi: Date; tip: string; tutar: { toString(): string } | number }

const GUN_MS = 86_400_000;
const utcGun = (t: Date) => Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());

export function donemUcreti(ucretler: UcretKaydi[], istihdamlar: IstihdamAraligi[], yil: number, ay: number): { tip: UcretTipi; aylik: number } {
  const { baslangic, son } = donemSinirlari(yil, ay);
  const sirali = [...ucretler].sort((a, b) => utcGun(a.yururlukTarihi) - utcGun(b.yururlukTarihi));
  const ayBas = utcGun(baslangic), aySon = utcGun(son);
  // Ayın başında geçerli olan + ay içinde başlayanlar.
  const ilk = sirali.filter((u) => utcGun(u.yururlukTarihi) <= ayBas).at(-1);
  const icerde = sirali.filter((u) => utcGun(u.yururlukTarihi) > ayBas && utcGun(u.yururlukTarihi) <= aySon);
  const parcalar = [...(ilk ? [ilk] : []), ...icerde];
  if (!parcalar.length) throw new BadRequestException(`${yil}/${String(ay).padStart(2, "0")} dönemi için ücret kaydı yok; ücret geçmişine kayıt ekleyin`);
  const tipler = new Set(parcalar.map((p) => p.tip));
  if (tipler.size > 1) throw new BadRequestException(`${yil}/${String(ay).padStart(2, "0")} içinde net ve brüt ücret birlikte olamaz; ücret tipini ay başından geçerli değiştirin`);
  const tip = parcalar[0].tip as UcretTipi;
  if (parcalar.length === 1) return { tip, aylik: Number(parcalar[0].tutar.toString()) };

  let agirlik = 0, toplam = 0;
  parcalar.forEach((p, i) => {
    const bas = Math.max(ayBas, utcGun(p.yururlukTarihi));
    const bit = i + 1 < parcalar.length ? utcGun(parcalar[i + 1].yururlukTarihi) - GUN_MS : aySon;
    const gun = istihdamGunuAraliginda(istihdamlar, bas, bit);
    agirlik += gun; toplam += gun * Number(p.tutar.toString());
  });
  // İstihdam yoksa (tamamen dışarıda) son ücret.
  return { tip, aylik: agirlik ? Math.round((toplam / agirlik) * 100) / 100 : Number(parcalar.at(-1)!.tutar.toString()) };
}

function istihdamGunuAraliginda(istihdamlar: IstihdamAraligi[], bas: number, bit: number): number {
  let gun = 0;
  for (const d of istihdamlar) {
    const b = Math.max(bas, utcGun(d.baslangicTarihi));
    const e = Math.min(bit, d.bitisTarihi ? utcGun(d.bitisTarihi) : bit);
    if (e >= b) gun += Math.round((e - b) / GUN_MS) + 1;
  }
  return gun;
}

/**
 * Net anlaşılan ücret: hedef nete ulaşan temel brüt (ikiye bölme; net brütle
 * tekdüze artar). Gönüllü kesintiler (şahıs/hayat sigortası, sendika) ve ücret
 * dışı ödemeler hedefe dahil edilmez; onlar bulunan brütün üstüne hesaplanır.
 */
export function nettenBrute(p: BordroMevzuatParametreleri, hedefNet: number, g: Omit<BordroHesaplamaGirdisi, "brutUcret">): number {
  const sade = { ...g, ucretDisiOdeme: 0, nakitYemekYardimi: 0, sahisSigortaPrimi: 0, hayatSigortaPrimi: 0, sendikaAidati: 0, sgkMatrahDevirleri: [] };
  const net = (brut: number) => Number(bordroHesapla(p, { ...sade, brutUcret: brut }).netUcret);
  let alt = hedefNet, ust = Math.max(hedefNet * 2, 1);
  while (net(ust) < hedefNet) ust *= 2;
  for (let i = 0; i < 80 && ust - alt > 0.001; i += 1) {
    const orta = (alt + ust) / 2;
    if (net(orta) < hedefNet) alt = orta; else ust = orta;
  }
  // Kuruşa yuvarla, net hedefi tutana kadar bir kuruş oynat.
  let brut = Math.round(ust * 100) / 100;
  for (let i = 0; i < 5 && net(brut) < hedefNet; i += 1) brut = Math.round((brut + 0.01) * 100) / 100;
  for (let i = 0; i < 5 && net(Math.round((brut - 0.01) * 100) / 100) >= hedefNet; i += 1) brut = Math.round((brut - 0.01) * 100) / 100;
  return brut;
}

