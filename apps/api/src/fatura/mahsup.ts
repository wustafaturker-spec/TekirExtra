/**
 * KSB-25: alış–satış faturası mahsubu (veritabanı tarafı). Mahsup kaydı aynı
 * carinin satış tarafını (satış, alış iadesi) ve alış tarafını (alış, satış
 * iadesi) aynı tutarla kapatır; kapamalar elle kapama (otomatik = false)
 * olarak yazılır, böylece denkleştirme onları sabit sayar ve kapanan fatura
 * ödemeyle kapanmış gibi iptal edilemez. Cari bakiyesi değişmez.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MAHSUP_ALIS_TARAFI, MAHSUP_SATIS_TARAFI, mahsupEsle, type AcikFatura, type FaturaTipi } from "./denklestirme-hesap";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const MAHSUP_TIPLERI: FaturaTipi[] = [...MAHSUP_SATIS_TARAFI, ...MAHSUP_ALIS_TARAFI];

export type MahsupTarafi = "satis" | "alis";
export const mahsupTarafi = (tip: string): MahsupTarafi | null =>
  (MAHSUP_SATIS_TARAFI as readonly string[]).includes(tip) ? "satis" : (MAHSUP_ALIS_TARAFI as readonly string[]).includes(tip) ? "alis" : null;

export interface MahsupAdayi {
  id: string; no: string | null; tip: FaturaTipi; taraf: MahsupTarafi;
  tarih: Date; vadeTarihi: Date | null; createdAt: Date; dovizCinsi: string; genelToplam: Prisma.Decimal;
  /** Bütün kapamalar düşülmüş, ekranda görünen açık tutar. */
  acik: Prisma.Decimal;
  /** Yalnız elle kapamalar düşülmüş; mahsubun üst sınırı (otomatik kapamalar yeniden dağılır). */
  mahsupEdilebilir: Prisma.Decimal;
}

/** Carinin mahsuba girebilecek kesin faturaları ve açık tutarları. */
export async function mahsupAdaylari(tx: Tx, cariId: string): Promise<MahsupAdayi[]> {
  const faturalar = await tx.fatura.findMany({
    where: { cariId, durum: "kesin", tip: { in: MAHSUP_TIPLERI } },
    select: {
      id: true, no: true, tip: true, tarih: true, vadeTarihi: true, createdAt: true, dovizCinsi: true, genelToplam: true,
      kapamalar: { select: { tutar: true, otomatik: true } },
      iadeKapamalari: { select: { tutar: true, otomatik: true } },
    },
  });
  const topla = (l: { tutar: Prisma.Decimal }[]) => l.reduce((t, k) => t.add(k.tutar), D(0));
  return faturalar.map((f) => {
    const tumu = [...f.kapamalar, ...f.iadeKapamalari];
    return {
      id: f.id, no: f.no, tip: f.tip as FaturaTipi, taraf: mahsupTarafi(f.tip)!, tarih: f.tarih, vadeTarihi: f.vadeTarihi, createdAt: f.createdAt,
      dovizCinsi: f.dovizCinsi, genelToplam: f.genelToplam,
      acik: Prisma.Decimal.max(f.genelToplam.sub(topla(tumu)), 0),
      mahsupEdilebilir: Prisma.Decimal.max(f.genelToplam.sub(topla(tumu.filter((k) => !k.otomatik))), 0),
    };
  });
}

export interface MahsupSatirGirdisi {
  faturaId: string;
  /** Fatura dövizinde kapanan tutar. */
  tutar: Prisma.Decimal;
  /** Mahsup dövizinde karşılığı; fatura dövizi mahsup dövizinden farklıysa zorunlu (KSB-20). */
  karsilik?: Prisma.Decimal;
}

export interface MahsupGirdisi {
  tenantId: string; cariId: string; userId: string | null;
  tarih: Date; dovizCinsi: string; aciklama: string | null; otomatik: boolean;
  satirlar: MahsupSatirGirdisi[];
}

/**
 * Doğrular ve yazar (denkleştirmeyi çağırmaz). Her iki tarafta en az bir
 * fatura; tarafların mahsup dövizindeki toplamı eşit; her satır faturanın
 * mahsup edilebilir tutarını aşamaz.
 */
export async function mahsupYaz(tx: Tx, g: MahsupGirdisi) {
  const adaylar = new Map((await mahsupAdaylari(tx, g.cariId)).map((a) => [a.id, a]));
  const toplam: Record<MahsupTarafi, Prisma.Decimal> = { satis: D(0), alis: D(0) };
  const satirlar = g.satirlar.filter((s) => s.tutar.gt(0)).map((s) => {
    const f = adaylar.get(s.faturaId);
    if (!f) throw new BadRequestException("Mahsuba yalnız bu carinin kesinleşmiş satış, alış ve iade faturaları girebilir");
    const tutar = s.tutar.toDecimalPlaces(2);
    if (tutar.gt(f.mahsupEdilebilir)) throw new BadRequestException(`${f.no ?? "Fatura"} için en çok ${f.mahsupEdilebilir.toFixed(2)} ${f.dovizCinsi} mahsup edilebilir`);
    const capraz = f.dovizCinsi !== g.dovizCinsi;
    if (capraz && !s.karsilik?.gt(0)) throw new BadRequestException(`${f.no ?? "Fatura"} ${f.dovizCinsi}; mahsup ${g.dovizCinsi} — karşılık tutarını girin`);
    const karsilik = capraz ? s.karsilik!.toDecimalPlaces(2) : tutar;
    toplam[f.taraf] = toplam[f.taraf].add(karsilik);
    return { f, tutar, karsilik, capraz };
  });
  if (!satirlar.some((s) => s.f.taraf === "satis") || !satirlar.some((s) => s.f.taraf === "alis")) {
    throw new BadRequestException("Mahsup için en az bir satış tarafı (satış faturası ya da alış iadesi) ve bir alış tarafı (alış faturası ya da satış iadesi) seçin");
  }
  if (!toplam.satis.eq(toplam.alis)) {
    throw new BadRequestException(`İki taraf eşit olmalı: satış tarafı ${toplam.satis.toFixed(2)}, alış tarafı ${toplam.alis.toFixed(2)} ${g.dovizCinsi}`);
  }
  const mahsup = await tx.cariMahsup.create({
    data: { tenantId: g.tenantId, cariId: g.cariId, tarih: g.tarih, dovizCinsi: g.dovizCinsi, tutar: toplam.satis, aciklama: g.aciklama, otomatik: g.otomatik, olusturanUserId: g.userId },
  });
  await tx.faturaKapama.createMany({
    data: satirlar.map((s) => ({
      tenantId: g.tenantId, cariId: g.cariId, faturaId: s.f.id, tutar: s.tutar, otomatik: false, mahsupId: mahsup.id,
      ...(s.capraz ? { kaynakTutari: s.karsilik, ...(g.dovizCinsi === "TRY" ? { kaynakTutariTry: s.karsilik } : {}) } : {}),
    })),
  });
  await tx.auditLog.create({
    data: {
      tenantId: g.tenantId, userId: g.userId, islem: g.otomatik ? "cari_mahsup_otomatik" : "cari_mahsup_yapildi", varlik: "cari_mahsup", varlikId: mahsup.id,
      detay: { cariId: g.cariId, tutar: mahsup.tutar.toFixed(2), dovizCinsi: g.dovizCinsi, faturalar: satirlar.map((s) => ({ no: s.f.no, taraf: s.f.taraf, tutar: s.tutar.toFixed(2) })) },
    },
  });
  return mahsup;
}

/**
 * Otomatik mahsup (cari kartında açıksa): denkleştirmeden sonra kalan açık
 * satış ve alış faturaları vade sırasıyla, döviz başına birbirine karşı
 * kapatılır. Kayıt kalıcıdır; sonraki denkleştirmeler onu elle kapama sayar.
 */
export async function otomatikMahsupUygula(tx: Tx, tenantId: string, cariId: string) {
  const adaylar = await mahsupAdaylari(tx, cariId);
  const bugun = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  for (const doviz of new Set(adaylar.map((a) => a.dovizCinsi))) {
    const acik: AcikFatura[] = adaylar.filter((a) => a.dovizCinsi === doviz).map((a) => ({ id: a.id, no: a.no, tip: a.tip, tarih: a.tarih, vadeTarihi: a.vadeTarihi, createdAt: a.createdAt, kalan: a.acik }));
    const e = mahsupEsle(acik);
    if (!e.tutar.gt(0)) continue;
    await mahsupYaz(tx, {
      tenantId, cariId, userId: null, tarih: bugun, dovizCinsi: doviz, aciklama: "Otomatik alış–satış mahsubu", otomatik: true,
      satirlar: [...e.satis, ...e.alis].map((s) => ({ faturaId: s.faturaId, tutar: s.tutar })),
    });
  }
}

/** Mahsubun kapamaları çözülür; kayıt iz için kalır. Denkleştirmeyi çağıran yapar. */
export async function mahsupGeriAlYaz(tx: Tx, tenantId: string, mahsupId: string, userId: string) {
  const m = await tx.cariMahsup.findUnique({ where: { id: mahsupId } });
  if (!m) throw new NotFoundException("Mahsup bulunamadı");
  if (m.geriAlindiAt) throw new BadRequestException("Mahsup zaten geri alınmış");
  await tx.faturaKapama.deleteMany({ where: { mahsupId } });
  await tx.cariMahsup.update({ where: { id: mahsupId }, data: { geriAlindiAt: new Date(), geriAlanUserId: userId } });
  await tx.auditLog.create({ data: { tenantId, userId, islem: "cari_mahsup_geri_alindi", varlik: "cari_mahsup", varlikId: mahsupId, detay: { cariId: m.cariId, tutar: m.tutar.toFixed(2), dovizCinsi: m.dovizCinsi } } });
  return m;
}
