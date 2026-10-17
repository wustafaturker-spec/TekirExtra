import { cariDavranisAnalizi, fifoKapanislari, type AnalizHareketi } from "./cari-analiz";
import { IPTAL_CIFTI_KAYNAKLARI } from "../fatura/iptal-cifti";

/**
 * CARI-49: tahmini gecikmenin isabeti. Tahmin, faturanın kesinleştiği andaki
 * cari davranış analizidir (tahminiGecikmeGun); gerçekleşen, tahminle aynı
 * FIFO eşleştirmesiyle faturanın borcunun kapandığı gecikmedir. Sapma =
 * gerçekleşen − tahmin (pozitif: tahminden geç ödendi).
 */

export interface KaynakliHareket {
  tip: "borc" | "alacak";
  tutarTry: number;
  tarih: Date;
  vadeTarihi: Date | null;
  kaynakTur: string;
  kaynakRef: string | null;
}

export type Guven = "dusuk" | "orta" | "yuksek";
export type TahminKaynagi = "kesinlesme" | "geriye_donuk";

const faturaKaydi = (h: KaynakliHareket) => Boolean(h.kaynakRef) && IPTAL_CIFTI_KAYNAKLARI.includes(h.kaynakTur);

/**
 * Gerçekleşen için hareketler: her faturanın kayıtları (asıl, iptal, geri alma
 * ve yeniden kesinleşme) tek net harekete iner; iptal edilmiş fatura düşer.
 * Böylece iptal ya da geri alma kaydı başka bir faturayı "ödenmiş" saymaz.
 * Net hareketin tarihi ve vadesi faturanın son asıl kaydından gelir.
 */
export function faturaNetHareketleri(hareketler: KaynakliHareket[], iptaller: Set<string>): AnalizHareketi[] {
  const sonuc: AnalizHareketi[] = [];
  const gruplar = new Map<string, KaynakliHareket[]>();
  for (const h of hareketler) {
    if (!faturaKaydi(h)) { sonuc.push({ tip: h.tip, tutarTry: h.tutarTry, tarih: h.tarih, vadeTarihi: h.vadeTarihi }); continue; }
    if (iptaller.has(h.kaynakRef!)) continue;
    gruplar.set(h.kaynakRef!, [...(gruplar.get(h.kaynakRef!) ?? []), h]);
  }
  for (const [ref, liste] of gruplar) {
    const net = liste.reduce((t, h) => t + (h.tip === "borc" ? h.tutarTry : -h.tutarTry), 0);
    if (Math.abs(net) < 0.005) continue;
    const asillar = liste.filter((h) => h.kaynakTur === "fatura");
    const temsil = (asillar.length ? asillar : liste).reduce((a, b) => (b.tarih.getTime() >= a.tarih.getTime() ? b : a));
    sonuc.push({ tip: net > 0 ? "borc" : "alacak", tutarTry: Math.abs(net), tarih: temsil.tarih, vadeTarihi: temsil.vadeTarihi, ref });
  }
  return sonuc;
}

export interface Gerceklesen {
  /** Faturanın borcu tamamen kapandı mı. */
  kapandi: boolean;
  /** Tutar ağırlıklı gecikme (gün, erken ödeme 0); yalnız kapandıysa. */
  gecikmeGun: number | null;
  kapanisTarihi: Date | null;
}

/** Faturaların gerçekleşen gecikmesi; hareketler `faturaNetHareketleri` çıktısıdır. */
export function gerceklesenGecikmeler(hareketler: AnalizHareketi[]): Map<string, Gerceklesen> {
  const parcalar = new Map<string, { tutar: number; agirlik: number; kapandi: boolean; son: Date }>();
  for (const k of fifoKapanislari(hareketler).kapanislar) {
    if (!k.borcRef) continue;
    const p = parcalar.get(k.borcRef) ?? { tutar: 0, agirlik: 0, kapandi: false, son: k.tarih };
    p.tutar += k.tutar; p.agirlik += k.gecikmeGun * k.tutar; p.kapandi ||= k.borcKapandi;
    if (k.tarih.getTime() > p.son.getTime()) p.son = k.tarih;
    parcalar.set(k.borcRef, p);
  }
  const sonuc = new Map<string, Gerceklesen>();
  for (const [ref, p] of parcalar) {
    sonuc.set(ref, p.kapandi && p.tutar > 0
      ? { kapandi: true, gecikmeGun: Math.round(p.agirlik / p.tutar), kapanisTarihi: p.son }
      : { kapandi: false, gecikmeGun: null, kapanisTarihi: null });
  }
  return sonuc;
}

export interface TahminKaydi { tahminGun: number | null; guven: Guven | null; kapananBorcSayisi: number }

/**
 * Faturanın kesinleştiği andaki tahmin: ekranın kullandığı analiz, faturanın
 * kendi kaydı hariç o ana kadarki hareketlerle. Geriye dönük üretimde `an`
 * fatura tarihidir; o tarihten sonra yazılan hareketler hesaba girmez.
 */
export function anlikTahmin(hareketler: (KaynakliHareket)[], faturaId: string, an: Date, riskLimiti: number | null): TahminKaydi {
  const onceki = hareketler.filter((h) => h.kaynakRef !== faturaId && h.tarih.getTime() <= an.getTime());
  const a = cariDavranisAnalizi(onceki.map((h) => ({ tip: h.tip, tutarTry: h.tutarTry, tarih: h.tarih, vadeTarihi: h.vadeTarihi })), riskLimiti, an);
  return { tahminGun: a.tahminiGecikmeGun, guven: a.guven, kapananBorcSayisi: a.metrikler.kapananBorcSayisi };
}

export interface IsabetSatiri {
  faturaId: string;
  cariId: string;
  tahminGun: number | null;
  guven: Guven | null;
  kaynak: TahminKaynagi;
  gerceklesen: Gerceklesen | undefined;
}

interface Olcu { ornek: number; ortalamaSapma: number | null; ortalamaMutlakSapma: number | null }
const olc = (sapmalar: number[]): Olcu => sapmalar.length === 0
  ? { ornek: 0, ortalamaSapma: null, ortalamaMutlakSapma: null }
  : {
    ornek: sapmalar.length,
    ortalamaSapma: Math.round((sapmalar.reduce((t, x) => t + x, 0) / sapmalar.length) * 10) / 10,
    ortalamaMutlakSapma: Math.round((sapmalar.reduce((t, x) => t + Math.abs(x), 0) / sapmalar.length) * 10) / 10,
  };

export interface IsabetOzeti extends Olcu {
  /** Kapanmış ama tahmini olmayan (veri yetersiz) faturalar. */
  tahminsiz: number;
  /** Tahmini olan, henüz kapanmamış faturalar. */
  acik: number;
  guven: Record<Guven, Olcu>;
  kaynak: Record<TahminKaynagi, Olcu>;
  aylik: ({ ay: string } & Olcu)[];
}

/** Kapanış tarihi `baslangic`tan önce olan ölçüm dışıdır (rapor son 12 ay). */
export function isabetOzeti(satirlar: IsabetSatiri[], baslangic?: Date): IsabetOzeti {
  type Olcum = { sapma: number; guven: Guven | null; kaynak: TahminKaynagi; ay: string };
  const olcumler: Olcum[] = [];
  let tahminsiz = 0, acik = 0;
  for (const s of satirlar) {
    const g = s.gerceklesen;
    if (!g?.kapandi) { if (s.tahminGun !== null) acik++; continue; }
    if (baslangic && g.kapanisTarihi! < baslangic) continue;
    if (s.tahminGun === null) { tahminsiz++; continue; }
    olcumler.push({ sapma: g.gecikmeGun! - s.tahminGun, guven: s.guven, kaynak: s.kaynak, ay: g.kapanisTarihi!.toISOString().slice(0, 7) });
  }
  const sec = (f: (o: Olcum) => boolean) => olc(olcumler.filter(f).map((o) => o.sapma));
  const aylar = [...new Set(olcumler.map((o) => o.ay))].sort();
  return {
    ...olc(olcumler.map((o) => o.sapma)),
    tahminsiz, acik,
    guven: { dusuk: sec((o) => o.guven === "dusuk"), orta: sec((o) => o.guven === "orta"), yuksek: sec((o) => o.guven === "yuksek") },
    kaynak: { kesinlesme: sec((o) => o.kaynak === "kesinlesme"), geriye_donuk: sec((o) => o.kaynak === "geriye_donuk") },
    aylik: aylar.map((ay) => ({ ay, ...sec((o) => o.ay === ay) })),
  };
}
