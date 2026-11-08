import { Prisma } from "@prisma/client";
import type { EkVergi } from "../fatura/ek-vergi";

/**
 * GLR-06: bizden kesilen stopajın üç kaynağı. Kümeler muhasebe fişinin 193'e
 * yazdıklarıyla aynıdır (fis-uretici): stopajlı faaliyet dışı gelir, kesin
 * satış faturası, kaydedilmiş pazaryeri stopajı. İptal edilen fatura, silinen
 * gelir ve geri alınan kesinti kümeden çıkar; hakedişte netleşen eksi tutarlı
 * pazaryeri düzeltmesi eksi satır olarak kalır.
 */
export type PesinVergiKaynak = "gelir" | "fatura" | "pazaryeri";

export interface PesinVergiSatiri {
  kaynakTur: PesinVergiKaynak;
  kaynakId: string;
  tarih: string;
  belgeNo: string | null;
  cariId: string | null;
  cari: string | null;
  /** Kırılım başlığı: gelir kategorisi, vergi adı ya da pazaryeri. */
  tur: string;
  /** Pazaryeri stopajının matrahı kayıtlarda yoktur. */
  matrah: Prisma.Decimal | null;
  oran: string | null;
  tutar: Prisma.Decimal;
  dovizCinsi: string;
  kur: Prisma.Decimal;
  tutarTry: Prisma.Decimal;
  yol: string;
}

export interface TarihAraligi {
  baslangic?: string;
  bitis?: string;
}

const D = (deger: string | number | Prisma.Decimal) => new Prisma.Decimal(deger);
const gun = (t: Date) => t.toISOString().slice(0, 10);
const TL = (tutar: Prisma.Decimal, kur: Prisma.Decimal) => tutar.mul(kur).toDecimalPlaces(2);

function tarihKosulu(a: TarihAraligi): Prisma.DateTimeFilter | undefined {
  if (!a.baslangic && !a.bitis) return undefined;
  return {
    ...(a.baslangic ? { gte: new Date(a.baslangic) } : {}),
    ...(a.bitis ? { lte: new Date(`${a.bitis}T23:59:59.999Z`) } : {}),
  };
}

export async function gelirStopajlari(tx: Prisma.TransactionClient, a: TarihAraligi, cariId?: string): Promise<PesinVergiSatiri[]> {
  const tarih = tarihKosulu(a);
  const kayitlar = await tx.gelirKaydi.findMany({
    where: { stopajTutari: { gt: 0 }, ...(tarih ? { tarih } : {}), ...(cariId ? { cariId } : {}) },
    select: {
      id: true, tarih: true, belgeNo: true, brutTutar: true, stopajOrani: true, stopajTutari: true, dovizCinsi: true, kur: true,
      kategori: { select: { ad: true } }, cari: { select: { id: true, unvan: true } },
    },
  });
  return kayitlar.map((g) => ({
    kaynakTur: "gelir",
    kaynakId: g.id,
    tarih: gun(g.tarih),
    belgeNo: g.belgeNo,
    cariId: g.cari?.id ?? null,
    cari: g.cari?.unvan ?? null,
    tur: g.kategori.ad,
    matrah: g.brutTutar,
    oran: g.stopajOrani.toString(),
    tutar: g.stopajTutari,
    dovizCinsi: String(g.dovizCinsi),
    kur: g.kur,
    tutarTry: TL(g.stopajTutari, g.kur),
    yol: "/panel/gelirler",
  }));
}

export async function faturaStopajlari(tx: Prisma.TransactionClient, a: TarihAraligi): Promise<PesinVergiSatiri[]> {
  const tarih = tarihKosulu(a);
  const satirlar = await tx.faturaSatir.findMany({
    where: { stopajTutari: { gt: 0 }, fatura: { durum: "kesin", tip: "satis", ...(tarih ? { tarih } : {}) } },
    select: {
      matrah: true, ekVergiler: true,
      fatura: { select: { id: true, no: true, tarih: true, kur: true, dovizCinsi: true, cari: { select: { id: true, unvan: true } } } },
    },
  });
  type Toplam = { fatura: (typeof satirlar)[number]["fatura"]; adlar: Set<string>; oranlar: Set<string>; matrah: Prisma.Decimal; tutar: Prisma.Decimal };
  const faturalar = new Map<string, Toplam>();
  for (const s of satirlar) {
    for (const v of Array.isArray(s.ekVergiler) ? (s.ekVergiler as unknown as EkVergi[]) : []) {
      if (!v.stopaj) continue;
      const t = faturalar.get(s.fatura.id) ?? { fatura: s.fatura, adlar: new Set<string>(), oranlar: new Set<string>(), matrah: D(0), tutar: D(0) };
      t.adlar.add(v.ad);
      if (v.oran) t.oranlar.add(v.oran);
      t.matrah = t.matrah.add(D(v.matrah ?? s.matrah));
      t.tutar = t.tutar.add(D(v.tutar));
      faturalar.set(s.fatura.id, t);
    }
  }
  return [...faturalar.values()].map((t) => ({
    kaynakTur: "fatura",
    kaynakId: t.fatura.id,
    tarih: gun(t.fatura.tarih),
    belgeNo: t.fatura.no ?? "Numarasız",
    cariId: t.fatura.cari.id,
    cari: t.fatura.cari.unvan,
    tur: [...t.adlar].sort((x, y) => x.localeCompare(y, "tr")).join(", "),
    matrah: t.matrah,
    oran: t.oranlar.size === 1 ? [...t.oranlar][0] : null,
    tutar: t.tutar,
    dovizCinsi: String(t.fatura.dovizCinsi),
    kur: t.fatura.kur,
    tutarTry: TL(t.tutar, t.fatura.kur),
    yol: `/panel/fatura/yeni?ac=${t.fatura.id}`,
  }));
}

export async function pazaryeriStopajlari(tx: Prisma.TransactionClient, a: TarihAraligi, cariId?: string): Promise<PesinVergiSatiri[]> {
  const tarih = tarihKosulu(a);
  const kesintiler = await tx.pazaryeriKesinti.findMany({
    where: {
      sinif: "stopaj", durum: { in: ["giderlesti", "hakediste_kaydedildi"] }, ...(tarih ? { tarih } : {}),
      ...(cariId ? { baglanti: { pazaryeriCariId: cariId } } : {}),
    },
    select: {
      id: true, tarih: true, tutar: true, dovizCinsi: true, siparisNo: true,
      baglanti: { select: { saglayici: true, pazaryeriCari: { select: { id: true, unvan: true } } } },
      hareket: { select: { kur: true } },
      hakedis: { select: { bankaHareketi: { select: { kur: true } } } },
    },
  });
  return kesintiler.map((k) => {
    const kur = k.hareket?.kur ?? k.hakedis?.bankaHareketi.kur ?? D(1);
    return {
      kaynakTur: "pazaryeri",
      kaynakId: k.id,
      tarih: gun(k.tarih),
      belgeNo: k.siparisNo,
      cariId: k.baglanti.pazaryeriCari?.id ?? null,
      cari: k.baglanti.pazaryeriCari?.unvan ?? null,
      tur: `E-ticaret stopajı · ${k.baglanti.saglayici}`,
      matrah: null,
      oran: null,
      tutar: k.tutar,
      dovizCinsi: String(k.dovizCinsi),
      kur,
      tutarTry: TL(k.tutar, kur),
      yol: "/panel/pazaryeri/kesintiler",
    };
  });
}

/** Üç kaynak birlikte, en yeni belge başta. */
export async function pesinVergiSatirlari(tx: Prisma.TransactionClient, a: TarihAraligi = {}): Promise<PesinVergiSatiri[]> {
  const gruplar = await Promise.all([gelirStopajlari(tx, a), faturaStopajlari(tx, a), pazaryeriStopajlari(tx, a)]);
  return gruplar.flat().sort((x, y) => y.tarih.localeCompare(x.tarih) || x.kaynakId.localeCompare(y.kaynakId));
}
