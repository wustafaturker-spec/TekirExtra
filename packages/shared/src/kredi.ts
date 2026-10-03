/**
 * KRD-02 (karar 2026-10-03): banka kredisi ödeme planı. Faiz bankaların
 * verdiği biçimde **aylık** orandır (%); BSMV ve KKDF faiz üzerinden alınır.
 * Hesap kuruş tamsayısıyla yapılır; yuvarlama farkı son taksite yazılır.
 */
export type KrediTuru = "taksitli" | "spot" | "rotatif";
export type KrediPlanTuru = "esit_taksit" | "esit_anapara";

export interface KrediPlanGirdisi {
  tur: "taksitli" | "spot";
  planTuru?: KrediPlanTuru;
  anapara: number;
  aylikFaiz: number;
  bsmvOrani: number;
  kkdfOrani: number;
  kullanimTarihi: string;
  taksitSayisi?: number;
  ilkTaksitTarihi?: string;
  vadeTarihi?: string;
}

export interface KrediPlanSatiri {
  sira: number;
  vadeTarihi: string;
  anapara: number;
  faiz: number;
  bsmv: number;
  kkdf: number;
  toplam: number;
}

const kurus = (tl: number) => Math.round(tl * 100);
const tl = (k: number) => k / 100;

/** YYYY-AA-GG'ye ay ekler; ayın son gününü aşan gün ay sonuna çekilir (31 Ocak + 1 ay = 28/29 Şubat). */
export function ayEkle(tarih: string, ay: number): string {
  const [y, a, g] = tarih.split("-").map(Number);
  const hedefAy = a - 1 + ay;
  const yil = y + Math.floor(hedefAy / 12);
  const ayNo = ((hedefAy % 12) + 12) % 12;
  const sonGun = new Date(Date.UTC(yil, ayNo + 1, 0)).getUTCDate();
  return `${yil}-${String(ayNo + 1).padStart(2, "0")}-${String(Math.min(g, sonGun)).padStart(2, "0")}`;
}

export function gunFarki(baslangic: string, bitis: string): number {
  return Math.round((Date.parse(`${bitis}T00:00:00Z`) - Date.parse(`${baslangic}T00:00:00Z`)) / 86_400_000);
}

/** Bankaların "yıllık" diye gösterdiği nominal oran ve bileşik (efektif) karşılığı. */
export function yillikFaizKarsiligi(aylikFaiz: number): { nominal: number; efektif: number } {
  const a = aylikFaiz / 100;
  return { nominal: Number((a * 12 * 100).toFixed(2)), efektif: Number(((Math.pow(1 + a, 12) - 1) * 100).toFixed(2)) };
}

function vergiler(faizK: number, bsmvOrani: number, kkdfOrani: number) {
  return { bsmv: Math.round((faizK * bsmvOrani) / 100), kkdf: Math.round((faizK * kkdfOrani) / 100) };
}

export function krediPlaniHesapla(g: KrediPlanGirdisi): KrediPlanSatiri[] {
  const anaparaK = kurus(g.anapara);
  const aylik = g.aylikFaiz / 100;
  if (anaparaK <= 0) return [];

  if (g.tur === "spot") {
    const vade = g.vadeTarihi ?? g.kullanimTarihi;
    const faizK = Math.round(anaparaK * aylik * (Math.max(0, gunFarki(g.kullanimTarihi, vade)) / 30));
    const v = vergiler(faizK, g.bsmvOrani, g.kkdfOrani);
    return [{ sira: 1, vadeTarihi: vade, anapara: tl(anaparaK), faiz: tl(faizK), bsmv: tl(v.bsmv), kkdf: tl(v.kkdf), toplam: tl(anaparaK + faizK + v.bsmv + v.kkdf) }];
  }

  const n = Math.max(1, Math.floor(g.taksitSayisi ?? 1));
  // Vadeler hep aynı çapadan sayılır; ay sonuna kırpılan bir vade sonrakileri kaydırmasın.
  const vade = (i: number) => (g.ilkTaksitTarihi ? ayEkle(g.ilkTaksitTarihi, i - 1) : ayEkle(g.kullanimTarihi, i));
  const efektif = aylik * (1 + (g.bsmvOrani + g.kkdfOrani) / 100);
  // Eşit taksitte toplam taksit (vergiler dahil) sabittir; anüite efektif oranla bulunur.
  const sabitTaksitK = g.planTuru === "esit_anapara"
    ? 0
    : efektif === 0 ? Math.round(anaparaK / n) : Math.round((anaparaK * efektif * Math.pow(1 + efektif, n)) / (Math.pow(1 + efektif, n) - 1));
  const sabitAnaparaK = Math.round(anaparaK / n);

  const satirlar: KrediPlanSatiri[] = [];
  let kalan = anaparaK;
  for (let i = 1; i <= n; i++) {
    const faizK = Math.round(kalan * aylik);
    const v = vergiler(faizK, g.bsmvOrani, g.kkdfOrani);
    let anaparaPayi = g.planTuru === "esit_anapara" ? sabitAnaparaK : sabitTaksitK - faizK - v.bsmv - v.kkdf;
    if (i === n || anaparaPayi > kalan) anaparaPayi = kalan; // yuvarlama farkı son taksitte
    kalan -= anaparaPayi;
    satirlar.push({
      sira: i,
      vadeTarihi: vade(i),
      anapara: tl(anaparaPayi),
      faiz: tl(faizK),
      bsmv: tl(v.bsmv),
      kkdf: tl(v.kkdf),
      toplam: tl(anaparaPayi + faizK + v.bsmv + v.kkdf),
    });
  }
  return satirlar;
}

/**
 * KRD-04: rotatif kredinin dönem faizi önerisi. Kullanılan bakiye her gün
 * için aylık oran / 30 ile faizlenir (bakiye değişimleri tarih sırasıyla).
 */
export function rotatifFaizOnerisi(
  hareketler: Array<{ tarih: string; anaparaDegisimi: number }>,
  baslangic: string,
  bitis: string,
  aylikFaiz: number,
  bsmvOrani: number,
  kkdfOrani: number,
): { faiz: number; bsmv: number; kkdf: number; toplam: number; ortalamaBakiye: number } {
  const sirali = [...hareketler].sort((a, b) => a.tarih.localeCompare(b.tarih));
  let bakiyeK = 0;
  let i = 0;
  while (i < sirali.length && sirali[i].tarih < baslangic) bakiyeK += kurus(sirali[i++].anaparaDegisimi);
  let faizHam = 0;
  let toplamBakiye = 0;
  const gun = Math.max(0, gunFarki(baslangic, bitis));
  for (let d = 0; d < gun; d++) {
    const bugun = new Date(Date.parse(`${baslangic}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    while (i < sirali.length && sirali[i].tarih <= bugun) bakiyeK += kurus(sirali[i++].anaparaDegisimi);
    const b = Math.max(0, bakiyeK);
    faizHam += (b * aylikFaiz) / 100 / 30;
    toplamBakiye += b;
  }
  const faizK = Math.round(faizHam);
  const v = vergiler(faizK, bsmvOrani, kkdfOrani);
  return { faiz: tl(faizK), bsmv: tl(v.bsmv), kkdf: tl(v.kkdf), toplam: tl(faizK + v.bsmv + v.kkdf), ortalamaBakiye: gun ? tl(Math.round(toplamBakiye / gun)) : 0 };
}
