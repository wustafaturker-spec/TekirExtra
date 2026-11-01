/**
 * P1-6: POS hesabından bankaya geçecek tutarların planı.
 *
 * Bankaya geçecek tutar POS hesabının bakiyesidir (tahsilat − iade −
 * aktarım − komisyon). Bakiye en yeni ödemeden geriye doğru tahsilatlara
 * dağıtılır: eski ödemeler daha önce (elle, ekstreden ya da bu listeden)
 * aktarılmış sayılır. Böylece aktarım hangi yoldan yapılmış olursa olsun plan
 * kayıtla tutarlı kalır ve tahsilata ayrıca "aktarıldı" damgası gerekmez.
 * Her tahsilatın valör tarihi = ödeme günü (İstanbul) + hesabın valör günü.
 */
import { Prisma } from "@prisma/client";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);
const ISTANBUL_FARKI_MS = 3 * 60 * 60 * 1000;
const GUN_MS = 24 * 60 * 60 * 1000;

/** Ödeme anının İstanbul tarihine valör günü eklenir (YYYY-AA-GG). */
export function valorTarihi(odemeTarihi: Date, valorGun: number): string {
  const istanbul = new Date(odemeTarihi.getTime() + ISTANBUL_FARKI_MS);
  const gun = Date.UTC(istanbul.getUTCFullYear(), istanbul.getUTCMonth(), istanbul.getUTCDate());
  return new Date(gun + valorGun * GUN_MS).toISOString().slice(0, 10);
}

export interface PlanTahsilati {
  id: string;
  odemeTarihi: Date;
  /** Tahsilat tutarı eksi iadeleri. */
  net: Prisma.Decimal;
  /** KSB-36: tahsilata yazılmış komisyon; boşsa (eski kayıt) hesabın oranı kullanılır. */
  komisyon?: Prisma.Decimal | null;
}

export interface AktarimGrubu {
  valorTarihi: string;
  vadesiGeldi: boolean;
  adet: number;
  brut: string;
  onerilenKomisyon: string;
  net: string;
  tahsilatIdleri: string[];
}

export function aktarimPlani(
  bakiye: Prisma.Decimal,
  tahsilatlar: PlanTahsilati[],
  hesap: { valorGun: number; komisyonOrani: Prisma.Decimal | string | number; islemUcreti?: Prisma.Decimal | string | number },
  bugun: string,
): { gruplar: AktarimGrubu[]; dagitilamayan: string } {
  let kalan = bakiye.gt(0) ? bakiye : D(0);
  const paylar: { id: string; valor: string; tutar: Prisma.Decimal; komisyon: Prisma.Decimal | null }[] = [];
  for (const t of [...tahsilatlar].sort((a, b) => b.odemeTarihi.getTime() - a.odemeTarihi.getTime())) {
    if (!kalan.gt(0)) break;
    if (!t.net.gt(0)) continue;
    const pay = Prisma.Decimal.min(t.net, kalan);
    // Tahsilatın bir kısmı önceden aktarılmışsa komisyonu da o oranda kalır.
    const komisyon = t.komisyon ? t.komisyon.mul(pay).div(t.net).toDecimalPlaces(2) : null;
    paylar.push({ id: t.id, valor: valorTarihi(t.odemeTarihi, hesap.valorGun), tutar: pay, komisyon });
    kalan = kalan.sub(pay);
  }
  const oran = D(hesap.komisyonOrani);
  // KSB-35: işlem başı ücret tahsilat başına eklenir.
  const ucret = D(hesap.islemUcreti ?? 0);
  const gruplar = new Map<string, { tutar: Prisma.Decimal; komisyon: Prisma.Decimal; idler: string[] }>();
  for (const p of paylar) {
    const g = gruplar.get(p.valor) ?? { tutar: D(0), komisyon: D(0), idler: [] };
    g.tutar = g.tutar.add(p.tutar);
    g.komisyon = g.komisyon.add(p.komisyon ?? p.tutar.mul(oran).div(100).add(ucret));
    g.idler.push(p.id);
    gruplar.set(p.valor, g);
  }
  return {
    gruplar: [...gruplar.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([valor, g]) => {
      const komisyon = Prisma.Decimal.min(g.komisyon.toDecimalPlaces(2), g.tutar);
      return {
        valorTarihi: valor,
        vadesiGeldi: valor <= bugun,
        adet: g.idler.length,
        brut: g.tutar.toFixed(2),
        onerilenKomisyon: komisyon.toFixed(2),
        net: g.tutar.sub(komisyon).toFixed(2),
        tahsilatIdleri: g.idler,
      };
    }),
    // Tahsilata bağlanamayan bakiye (ör. elle girilmiş POS fişi).
    dagitilamayan: kalan.toFixed(2),
  };
}
