/**
 * KSB-10: kredi kartı dönem ekstresi (saf hesap).
 *
 * Dönem, iki kesim tarihi arasıdır: (önceki kesim, kesim]. Dönem borcu banka
 * mantığıyla yürür: önceki dönem borcu − dönem içinde yapılan ödemeler +
 * döneme düşen kalemler (taksitler, faiz, aidat, iade). Kesinleştirilmiş
 * ekstrede dönem borcu bankanın tutarıdır; sonraki dönemler ondan yürür.
 *
 * Kalemin dönemi doğal olarak tarihini içeren dönemdir. Kesinleşmiş ekstreye
 * damgalanan kalem orada kalır; damgasız kalemin doğal dönemi son kesinleşmiş
 * ekstreye kadarsa (geçmişe geç girilmiş) ilk açık döneme düşer.
 *
 * Ekstre ödemesi önce en eski ekstreyi kapatır: kesimden sonraki ödemeler
 * sıradaki kesime kadar o ekstreye sayılır, kalanı yeni dönem borcuna devreder.
 */
import { Prisma } from "@prisma/client";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const SIFIR = D(0);

/** Limiti bu tutara kadar olan kartta asgari %20, üstünde %40 (BDDK). */
export const ASGARI_LIMIT_ESIGI = 50_000;

// ─── Tarih yardımcıları (YYYY-MM-DD, UTC) ────────────────────────────────────

const gunMetni = (t: Date) => t.toISOString().slice(0, 10);
const aySonuGunu = (yil: number, ay: number) => new Date(Date.UTC(yil, ay + 1, 0)).getUTCDate();
const ayinGunu = (yil: number, ay: number, gun: number) => {
  const tarih = new Date(Date.UTC(yil, ay, 1));
  return gunMetni(new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth(), Math.min(gun, aySonuGunu(tarih.getUTCFullYear(), tarih.getUTCMonth())))));
};
const gunEkle = (gun: string, adet: number) => gunMetni(new Date(Date.parse(`${gun}T00:00:00Z`) + adet * 86_400_000));
const ayAnahtari = (gun: string) => gun.slice(0, 7);

/** Kesim günü kısa ayda ayın son gününe çekilir. */
export function kesimTarihi(yil: number, ay: number, kesimGunu: number): string {
  return ayinGunu(yil, ay, kesimGunu);
}

/**
 * Kesimin son ödeme tarihi: son ödeme günü kesim gününden büyükse aynı ay,
 * değilse sonraki ay. Hafta sonu ya da tam gün resmî tatile denk gelirse ilk
 * iş gününe kayar (yarım gün arife iş günüdür).
 */
export function sonOdemeTarihi(kesim: string, kesimGunu: number, sonOdemeGunu: number, tatiller: ReadonlySet<string>): string {
  const [yil, ay] = kesim.split("-").map(Number);
  let gun = ayinGunu(yil, ay - 1 + (sonOdemeGunu > kesimGunu ? 0 : 1), sonOdemeGunu);
  for (let i = 0; i < 15; i++) {
    const haftaGunu = new Date(`${gun}T00:00:00Z`).getUTCDay();
    if (haftaGunu !== 0 && haftaGunu !== 6 && !tatiller.has(gun)) break;
    gun = gunEkle(gun, 1);
  }
  return gun;
}

// ─── Kalemler ────────────────────────────────────────────────────────────────

export interface KartHareketiGirdisi {
  id: string;
  tip: "harcama" | "iade" | "odeme" | "faiz" | "aidat";
  tarih: Date;
  tutar: Prisma.Decimal.Value;
  aciklama: string;
  taksitSayisi: number;
  geriAlinanHareketId: string | null;
  ekstreId: string | null;
  taksitler: Array<{ id: string; sira: number; vadeTarihi: Date; tutar: Prisma.Decimal.Value; ekstreId: string | null }>;
}

/** Ekstreye giren kalem; tutar işaretlidir (iade ve ters kayıt eksi). */
export interface EkstreKalemi {
  id: string;
  kaynak: "taksit" | "hareket";
  hareketId: string;
  tarih: string;
  tutar: Prisma.Decimal;
  aciklama: string;
  tip: KartHareketiGirdisi["tip"];
  sira: number | null;
  taksitSayisi: number;
  tersKayit: boolean;
  ekstreId: string | null;
}

/** Ekstre ödemesi; ters kaydı eksi tutarlıdır. */
export interface EkstreOdemesi {
  hareketId: string;
  tarih: string;
  tutar: Prisma.Decimal;
  aciklama: string;
}

/**
 * Kart hareketlerini ekstre kalemlerine ve ödemelere ayırır. Taksitli
 * harcama taksitleriyle girer. Ters kayıtlar asıl hareketin türüne göre
 * çözülür: ödemenin tersi eksi ödeme; harcamanın tersi (kapalı dönemde vadesi
 * gelmemiş taksitler plandan düştüğü için) yalnız kalan taksitler kadar alacak.
 */
export function kalemleriAyir(hareketler: KartHareketiGirdisi[]): { kalemler: EkstreKalemi[]; odemeler: EkstreOdemesi[] } {
  const kimlikle = new Map(hareketler.map((h) => [h.id, h]));
  const kalemler: EkstreKalemi[] = [];
  const odemeler: EkstreOdemesi[] = [];
  const hareketKalemi = (h: KartHareketiGirdisi, tutar: Prisma.Decimal, tersKayit: boolean): EkstreKalemi => ({
    id: h.id, kaynak: "hareket", hareketId: h.id, tarih: gunMetni(h.tarih), tutar, aciklama: h.aciklama, tip: h.tip,
    sira: null, taksitSayisi: 1, tersKayit, ekstreId: h.ekstreId,
  });

  for (const h of hareketler) {
    const tutar = D(h.tutar);
    if (h.geriAlinanHareketId) {
      const asil = kimlikle.get(h.geriAlinanHareketId);
      if (asil?.tip === "odeme") odemeler.push({ hareketId: h.id, tarih: gunMetni(h.tarih), tutar: tutar.negated(), aciklama: h.aciklama });
      else if (asil?.tip === "iade") kalemler.push(hareketKalemi(h, tutar, true));
      else if (asil?.tip === "harcama") {
        const kalan = asil.taksitler.length ? asil.taksitler.reduce((t, x) => t.add(D(x.tutar)), SIFIR) : D(asil.tutar);
        kalemler.push(hareketKalemi(h, kalan.negated(), true));
      } else kalemler.push(hareketKalemi(h, tutar.negated(), true));
      continue;
    }
    if (h.tip === "odeme") odemeler.push({ hareketId: h.id, tarih: gunMetni(h.tarih), tutar, aciklama: h.aciklama });
    else if (h.tip === "iade") kalemler.push(hareketKalemi(h, tutar.negated(), false));
    else if (h.tip === "harcama" && h.taksitler.length) {
      for (const t of h.taksitler) {
        kalemler.push({
          id: t.id, kaynak: "taksit", hareketId: h.id, tarih: gunMetni(t.vadeTarihi), tutar: D(t.tutar), aciklama: h.aciklama, tip: h.tip,
          sira: t.sira, taksitSayisi: h.taksitSayisi, tersKayit: false, ekstreId: t.ekstreId,
        });
      }
    } else kalemler.push(hareketKalemi(h, tutar, false));
  }
  return { kalemler, odemeler };
}

// ─── Dönemler ────────────────────────────────────────────────────────────────

export interface KartTanimi {
  hesapKesimGunu: number;
  sonOdemeGunu: number;
  limit: Prisma.Decimal.Value;
  asgariOdemeOrani: Prisma.Decimal.Value | null;
}

export interface KesinlesmisEkstre {
  id: string;
  kesimTarihi: string;
  sonOdemeTarihi: string;
  hesaplananTutar: Prisma.Decimal.Value;
  bankaTutari: Prisma.Decimal.Value;
  bankaAsgariTutari: Prisma.Decimal.Value | null;
}

export type DonemTuru = "kesilmis" | "acik" | "gelecek";
export type EkstreDurumu = "odendi" | "bekliyor" | "kismi" | "asgari_odendi" | "gecikti" | "birikiyor" | "planli";

export interface EkstreDonemi {
  kesimTarihi: string;
  /** Dönemin ilk günü (önceki kesimin ertesi). */
  baslangic: string;
  sonOdemeTarihi: string;
  tur: DonemTuru;
  kesin: KesinlesmisEkstre | null;
  devreden: Prisma.Decimal;
  donemIciOdeme: Prisma.Decimal;
  /** Döneme düşen kalemlerin toplamı (iade eksi). */
  harcamalar: Prisma.Decimal;
  /** Hareketlerden hesaplanan dönem borcu. */
  hesaplananBorc: Prisma.Decimal;
  /** Geçerli dönem borcu: kesinleşmişte bankanın tutarı. */
  donemBorcu: Prisma.Decimal;
  asgari: Prisma.Decimal;
  /** Kesimden sonra bu ekstreye sayılan ödemeler. */
  odenen: Prisma.Decimal;
  kalan: Prisma.Decimal;
  asgariKalan: Prisma.Decimal;
  durum: EkstreDurumu;
  kalemler: EkstreKalemi[];
  odemeler: EkstreOdemesi[];
}

export function asgariOran(kart: KartTanimi): Prisma.Decimal {
  if (kart.asgariOdemeOrani != null) return D(kart.asgariOdemeOrani);
  return D(kart.limit).lte(ASGARI_LIMIT_ESIGI) ? D(20) : D(40);
}

/** Verilen aralığı kapsayan kesim tarihleri; kesinleşmiş ekstrenin tarihi o ayın üretilenine baskın gelir. */
function kesimTarihleri(kart: KartTanimi, kesinler: KesinlesmisEkstre[], ilk: string, son: string): string[] {
  const sakli = new Map(kesinler.map((k) => [ayAnahtari(k.kesimTarihi), k.kesimTarihi]));
  const tarihler: string[] = [];
  let [yil, ay] = ilk.split("-").map(Number);
  ay -= 2; // ilk günü içeren dönemin başlangıcı için bir ay geriden başla
  for (let i = 0; i < 600; i++) {
    const k = kesimTarihi(yil, ay, kart.hesapKesimGunu);
    tarihler.push(sakli.get(ayAnahtari(k)) ?? k);
    if (k >= son && tarihler.length > 1) break;
    ay += 1;
  }
  const sirali = [...new Set(tarihler)].sort();
  // İlk günden önce biten dönemler atılır; ilk günü içeren dönemden başlanır.
  const ilkIndis = Math.max(0, sirali.findIndex((k) => k >= ilk));
  return sirali.slice(Math.max(0, ilkIndis - 1));
}

export function ekstreleriHesapla(girdi: {
  kart: KartTanimi;
  kesinler: KesinlesmisEkstre[];
  kalemler: EkstreKalemi[];
  odemeler: EkstreOdemesi[];
  bugun: string;
  tatiller: ReadonlySet<string>;
}): EkstreDonemi[] {
  const { kart, kalemler, odemeler, bugun, tatiller } = girdi;
  const kesinler = [...girdi.kesinler].sort((a, b) => a.kesimTarihi.localeCompare(b.kesimTarihi));
  const tumTarihler = [bugun, ...kalemler.map((k) => k.tarih), ...odemeler.map((o) => o.tarih), ...kesinler.map((k) => k.kesimTarihi)];
  const ilk = tumTarihler.reduce((a, b) => (b < a ? b : a));
  const son = tumTarihler.reduce((a, b) => (b > a ? b : a));
  const kesimler = kesimTarihleri(kart, kesinler, ilk, son);
  // İlk kesim yalnız başlangıç sınırıdır; dönemler ondan sonrakilerdir.
  const donemSonlari = kesimler.slice(1);
  const kesinTarihle = new Map(kesinler.map((k) => [k.kesimTarihi, k]));
  const kesinKimlikle = new Map(kesinler.map((k) => [k.id, k.kesimTarihi]));
  const sonKesin = kesinler.at(-1)?.kesimTarihi ?? null;

  const donemKalemleri = new Map<string, EkstreKalemi[]>(donemSonlari.map((k) => [k, []]));
  for (const kalem of kalemler) {
    let hedef = kalem.ekstreId ? kesinKimlikle.get(kalem.ekstreId) : undefined;
    if (!hedef) {
      hedef = donemSonlari.find((k) => k >= kalem.tarih)!;
      if (sonKesin && hedef <= sonKesin) hedef = donemSonlari.find((k) => k > sonKesin)!;
    }
    donemKalemleri.get(hedef)?.push(kalem);
  }

  const oran = asgariOran(kart).div(100);
  const aralikta = (bas: string, bit: string) => odemeler.filter((o) => o.tarih > bas && o.tarih <= bit);
  const topla = (liste: Array<{ tutar: Prisma.Decimal }>) => liste.reduce((t, x) => t.add(x.tutar), SIFIR);

  const donemler: EkstreDonemi[] = [];
  let oncekiBorc = SIFIR;
  for (let i = 0; i < donemSonlari.length; i++) {
    const kesim = donemSonlari[i];
    const onceki = kesimler[i];
    const sonraki = donemSonlari[i + 1] ?? null;
    const kesin = kesinTarihle.get(kesim) ?? null;
    const sonOdeme = kesin?.sonOdemeTarihi ?? sonOdemeTarihi(kesim, kart.hesapKesimGunu, kart.sonOdemeGunu, tatiller);
    const donemOdemeleri = aralikta(onceki, kesim);
    const kalemlerim = (donemKalemleri.get(kesim) ?? []).sort((a, b) => a.tarih.localeCompare(b.tarih));
    const harcamalar = topla(kalemlerim);
    const donemIciOdeme = topla(donemOdemeleri);
    const hesaplananBorc = oncekiBorc.sub(donemIciOdeme).add(harcamalar);
    const donemBorcu = kesin ? D(kesin.bankaTutari) : hesaplananBorc;
    const tur: DonemTuru = kesim < bugun ? "kesilmis" : onceki < bugun ? "acik" : "gelecek";

    let odenen = SIFIR;
    let kalan = Prisma.Decimal.max(0, donemBorcu);
    let asgari = SIFIR;
    let asgariKalan = SIFIR;
    let durum: EkstreDurumu = tur === "acik" ? "birikiyor" : "planli";
    if (tur === "kesilmis") {
      const sinir = sonraki && sonraki < bugun ? sonraki : bugun;
      odenen = topla(aralikta(kesim, sinir));
      const sonOdemeyeKadar = topla(aralikta(kesim, sonOdeme < sinir ? sonOdeme : sinir));
      asgari = kesin?.bankaAsgariTutari != null ? D(kesin.bankaAsgariTutari) : Prisma.Decimal.max(0, donemBorcu).mul(oran).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      kalan = Prisma.Decimal.max(0, donemBorcu.sub(odenen));
      asgariKalan = Prisma.Decimal.max(0, asgari.sub(sonOdemeyeKadar));
      if (kalan.isZero()) durum = "odendi";
      else if (bugun <= sonOdeme) durum = odenen.gt(0) ? "kismi" : "bekliyor";
      else durum = asgariKalan.isZero() ? "asgari_odendi" : "gecikti";
    }

    donemler.push({
      kesimTarihi: kesim, baslangic: gunEkle(onceki, 1), sonOdemeTarihi: sonOdeme, tur, kesin,
      devreden: oncekiBorc, donemIciOdeme, harcamalar, hesaplananBorc, donemBorcu, asgari, odenen, kalan, asgariKalan, durum,
      kalemler: kalemlerim, odemeler: donemOdemeleri,
    });
    oncekiBorc = donemBorcu;
  }
  return donemler;
}

/** Ekranın ve bildirimlerin baktığı özet: son kesilen ekstre ve açık dönem. */
export function ekstreOzeti(donemler: EkstreDonemi[]) {
  const sonKesilen = [...donemler].reverse().find((d) => d.tur === "kesilmis") ?? null;
  const acik = donemler.find((d) => d.tur === "acik") ?? null;
  const gelecek = donemler.filter((d) => d.tur === "gelecek" && !d.harcamalar.isZero());
  return { sonKesilen, acik, gelecek };
}
