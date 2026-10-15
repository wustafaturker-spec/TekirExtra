import { Prisma } from "@prisma/client";
import { birimCoz } from "@tekirextra/shared";

const D = Prisma.Decimal;
export interface FiyatGozlemi {
  faturaId: string; no: string | null; tarih: string; cariId: string; unvan: string;
  miktar: string; matrah: string; birim: string; doviz: string; kayitAt?: string;
}
export const fiyatBirimi = (birim: string) => birimCoz(birim) ?? birim.trim().toLocaleLowerCase("tr-TR");
/** UTC belge günü; artık yıl sonunda aynı takvim gününe mümkün olduğunca yakın. */
export function yilOnce(tarih: string, yil = 1): string {
  const d = new Date(`${tarih}T00:00:00Z`);
  const ay = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() - yil);
  if (d.getUTCMonth() !== ay) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
export function fiyatKarsilastir(girdi: {
  tarih: string; birim: string; doviz: string; miktar: string; matrah: string;
  cariId: string | null; gecmis: FiyatGozlemi[]; kesildi: boolean;
}) {
  const uyarilar: string[] = [];
  const net = new D(girdi.matrah).div(girdi.miktar);
  const birim = fiyatBirimi(girdi.birim);
  const baslangic = yilOnce(girdi.tarih, 2), orta = yilOnce(girdi.tarih);
  const uygun = girdi.gecmis.filter((g) => g.tarih >= baslangic && g.tarih < girdi.tarih &&
    g.doviz === girdi.doviz && fiyatBirimi(g.birim) === birim &&
    new D(g.miktar).isFinite() && new D(g.matrah).isFinite() && new D(g.miktar).greaterThan(0) && new D(g.matrah).greaterThan(0))
    .sort((a, b) => b.tarih.localeCompare(a.tarih) || (b.kayitAt ?? "").localeCompare(a.kayitAt ?? "") || a.faturaId.localeCompare(b.faturaId));
  const fark = (fiyat: Prisma.Decimal) => fiyat.greaterThan(0) ? net.minus(fiyat).div(fiyat).mul(100).toFixed(2) : null;
  const kaynak = (g: FiyatGozlemi) => ({ ...g, netBirimFiyat: new D(g.matrah).div(g.miktar).toFixed(6),
    farkYuzde: fark(new D(g.matrah).div(g.miktar)) });
  const sonAlis = uygun.find((g) => g.cariId === girdi.cariId);
  const sinir = new Date(`${girdi.tarih}T00:00:00Z`);
  sinir.setUTCDate(sinir.getUTCDate() - 90);
  // Her tedarikçinin en son faturasındaki aynı ürün satırları birlikte ağırlıklandırılır.
  const tedarikciGruplari = new Map<string, FiyatGozlemi[]>();
  for (const g of uygun.filter((g) => g.tarih >= sinir.toISOString().slice(0, 10))) {
    const grup = tedarikciGruplari.get(g.cariId);
    if (!grup) tedarikciGruplari.set(g.cariId, [g]);
    else if (grup[0].faturaId === g.faturaId) grup.push(g);
  }
  const ortalama = (liste: FiyatGozlemi[]) => {
    const miktar = liste.reduce((t, g) => t.plus(g.miktar), new D(0));
    const tutar = liste.reduce((t, g) => t.plus(g.matrah), new D(0));
    return miktar.greaterThan(0) ? tutar.div(miktar) : null;
  };
  const siraliTedarikciler = [...tedarikciGruplari.values()].map((liste) => {
    const fiyat = ortalama(liste)!;
    return { ...kaynak(liste[0]), miktar: liste.reduce((t, g) => t.plus(g.miktar), new D(0)).toFixed(3),
      matrah: liste.reduce((t, g) => t.plus(g.matrah), new D(0)).toFixed(2),
      netBirimFiyat: fiyat.toFixed(6), farkYuzde: fark(fiyat) };
  }).sort((a, b) => new D(a.netBirimFiyat).comparedTo(b.netBirimFiyat));
  const enDusuk = siraliTedarikciler[0] && new D(siraliTedarikciler[0].netBirimFiyat);
  const tedarikciler = siraliTedarikciler.map((t) => ({ ...t, enDusugeGoreFarkYuzde: enDusuk?.greaterThan(0)
    ? new D(t.netBirimFiyat).minus(enDusuk).div(enDusuk).mul(100).toFixed(2) : null }));
  const sonGrup = sonAlis ? uygun.filter((g) => g.faturaId === sonAlis.faturaId && g.cariId === sonAlis.cariId) : [];
  const sonFiyat = ortalama(sonGrup);
  const donem = (bas: string, bit: string, cariId: string | null | undefined) => {
    const liste = uygun.filter((g) => g.tarih >= bas && g.tarih < bit && (cariId === undefined || g.cariId === cariId));
    return { baslangic: bas, bitisHaric: bit, satirSayisi: liste.length,
      faturaSayisi: new Set(liste.map((g) => g.faturaId)).size,
      ortalama: ortalama(liste)?.toFixed(6) ?? null };
  };
  const yillik = (cariId: string | null | undefined) => {
    const onceki = donem(baslangic, orta, cariId), son = donem(orta, girdi.tarih, cariId);
    const eski = ortalama(uygun.filter((g) => g.tarih >= baslangic && g.tarih < orta && (cariId === undefined || g.cariId === cariId)));
    const yeni = ortalama(uygun.filter((g) => g.tarih >= orta && (cariId === undefined || g.cariId === cariId)));
    return { onceki, son, artisYuzde: !girdi.kesildi && eski && yeni ? yeni.minus(eski).div(eski).mul(100).toFixed(2) : null };
  };
  if (girdi.kesildi) uyarilar.push("Geçmiş 2.000 satırla sınırlı; yıllık artış hesaplanmadı, son alış ve tedarikçi listesi eksik olabilir.");
  if (!uygun.length) uyarilar.push("Aynı ürün/varyant, birim ve dövizde karşılaştırılabilir geçmiş alış yok.");
  if (uygun.length !== girdi.gecmis.length) uyarilar.push("Farklı birim/döviz veya geçersiz miktar/tutar içeren alışlar karşılaştırılmadı.");
  if (!girdi.cariId) uyarilar.push("Gönderen cari kesin eşleşmedi; aynı tedarikçinin son alış karşılaştırması yapılamadı.");
  uyarilar.push("KDV ve ek vergiler hariç, iskontolar sonrası net fiyat. Miktar, vade, kalite ve teslim şartları farklı olabilir; geçmiş alış güncel teklif değildir.");
  return { netBirimFiyat: net.toFixed(6), birim, doviz: girdi.doviz,
    sonAlis: sonAlis && sonFiyat ? { ...kaynak(sonAlis),
      miktar: sonGrup.reduce((t, g) => t.plus(g.miktar), new D(0)).toFixed(3),
      matrah: sonGrup.reduce((t, g) => t.plus(g.matrah), new D(0)).toFixed(2),
      netBirimFiyat: sonFiyat.toFixed(6), farkYuzde: fark(sonFiyat) } : null, tedarikciler,
    yillik: yillik(undefined), tedarikciYillik: girdi.cariId ? yillik(girdi.cariId) : null,
    uyarilar };
}

/** UBL LineExtensionAmount satır iskontosunu zaten içerir; başlık iskontosu yalnız bir kez dağıtılır. */
export function belgeNetMatrahlari(matrahlar: number[], iskonto: number): string[] {
  const toplam = matrahlar.reduce((t, v) => t.plus(String(v)), new D(0));
  let dagitilan = new D(0);
  return matrahlar.map((v, i) => {
    const pay = i === matrahlar.length - 1 ? new D(String(iskonto)).minus(dagitilan) :
      toplam.greaterThan(0) ? new D(String(iskonto)).mul(String(v)).div(toplam).toDecimalPlaces(2) : new D(0);
    dagitilan = dagitilan.plus(pay);
    return new D(String(v)).minus(pay).toFixed(2);
  });
}
