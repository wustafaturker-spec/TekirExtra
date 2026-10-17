import { Prisma } from "@prisma/client";
import { iptalCiftiMi, iptalEdilmisFaturalar } from "../fatura/iptal-cifti";
import { guncelKurlar, guncelTlDegeri, type GuncelKurlar } from "./doviz-degerleme";
import { cariTeminatlari } from "./cari-teminat";
import { acikKalemler, bosYaslandirma, yaslandir, YASLANDIRMA_KOVALARI, type YaslandirmaSonucu, type YaslandirmaYonu } from "./yaslandirma";

/**
 * CARI-30 (karar 2026-10-03): müşteri riski kart ile fatura uyarısında aynı
 * fonksiyondan hesaplanır. Risk = açık bakiye (alacaklıysa 0) + tahsil
 * edilmemiş alınan çek/senet: portföyde, tahsile ya da teminata verilmiş;
 * ciro edilmiş olan da vadesinden sonra bu süre dolana kadar (karşılıksız
 * çıkarsa ciro eden olarak geri döner).
 *
 * CARI-33: her dövizin açık bakiyesi ve dövizli çek güncel döviz satış
 * kuruyla TL'ye çevrilir (doviz-degerleme.ts).
 */
export const CIRO_RISK_SURESI_GUN = 30;
const GUN_MS = 86_400_000;
const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

export interface CariRiski {
  /** Güncel kurla TL bakiye (borç − alacak). */
  bakiyeTry: Prisma.Decimal;
  /** Hareketlerin kendi kuruyla TL bakiye; farkı değerlenmemiş kur farkıdır. */
  tarihiBakiyeTry: Prisma.Decimal;
  cekSenetRiski: Prisma.Decimal;
  mevcutRisk: Prisma.Decimal;
  /** CARI-39: geçerli teminatların güncel kurla TL toplamı; risk limitine eklenir. */
  teminatTry: Prisma.Decimal;
  /** Güncel kuru bulunamadığı için tarihî TL ile sayılan dövizler. */
  kurEksik: string[];
}

export async function cariRiskleri(tx: Prisma.TransactionClient, tenantId: string, cariIdler: string[], bugun = new Date()): Promise<Map<string, CariRiski>> {
  if (cariIdler.length === 0) return new Map();
  const ciroSiniri = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth(), bugun.getUTCDate()) - CIRO_RISK_SURESI_GUN * GUN_MS);
  const [bakiyeler, cekler] = await Promise.all([
    tx.cariHareket.groupBy({ by: ["cariId", "dovizCinsi", "tip"], where: { cariId: { in: cariIdler } }, _sum: { tutar: true, tutarTry: true } }),
    tx.cekSenet.groupBy({
      by: ["cariId", "dovizCinsi"],
      where: {
        cariId: { in: cariIdler },
        yon: "alinan",
        OR: [
          { durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi"] } },
          { durum: "ciro_edildi", vadeTarihi: { gte: ciroSiniri } },
        ],
      },
      _sum: { tutar: true, tutarTry: true },
    }),
  ]);
  const kurlar = await guncelKurlar(tx, tenantId, [...bakiyeler, ...cekler].map((g) => g.dovizCinsi), bugun);
  const teminatlar = await cariTeminatlari(tx, tenantId, cariIdler, bugun);

  // Cari × döviz net bakiyesi (döviz cinsinden ve tarihî TL).
  const netler = new Map<string, Map<string, { tutar: Prisma.Decimal; tarihiTry: Prisma.Decimal }>>();
  for (const g of bakiyeler) {
    const cari = netler.get(g.cariId) ?? new Map();
    const n = cari.get(g.dovizCinsi) ?? { tutar: D(0), tarihiTry: D(0) };
    const isaret = g.tip === "borc" ? 1 : -1;
    n.tutar = n.tutar.add(D(g._sum.tutar ?? 0).mul(isaret));
    n.tarihiTry = n.tarihiTry.add(D(g._sum.tutarTry ?? 0).mul(isaret));
    cari.set(g.dovizCinsi, n);
    netler.set(g.cariId, cari);
  }

  const sonuc = new Map<string, CariRiski>(cariIdler.map((id) => [id, { bakiyeTry: D(0), tarihiBakiyeTry: D(0), cekSenetRiski: D(0), mevcutRisk: D(0), teminatTry: D(0), kurEksik: [] }]));
  const eksikEkle = (r: CariRiski, doviz: string) => { if (!r.kurEksik.includes(doviz)) r.kurEksik.push(doviz); };
  for (const [cariId, dovizler] of netler) {
    const r = sonuc.get(cariId)!;
    for (const [doviz, n] of dovizler) {
      const deger = guncelTlDegeri(doviz, n.tutar, n.tarihiTry, kurlar);
      r.bakiyeTry = r.bakiyeTry.add(deger.guncelTry);
      r.tarihiBakiyeTry = r.tarihiBakiyeTry.add(n.tarihiTry);
      if (deger.kurEksik) eksikEkle(r, doviz);
    }
  }
  for (const c of cekler) {
    if (!c.cariId) continue;
    const r = sonuc.get(c.cariId)!;
    const deger = guncelTlDegeri(c.dovizCinsi, D(c._sum.tutar ?? 0), D(c._sum.tutarTry ?? 0), kurlar);
    r.cekSenetRiski = r.cekSenetRiski.add(deger.guncelTry);
    if (deger.kurEksik) eksikEkle(r, c.dovizCinsi);
  }
  for (const [cariId, t] of teminatlar) {
    const r = sonuc.get(cariId)!;
    r.teminatTry = t.teminatTry;
    for (const d of t.kurEksik) eksikEkle(r, d);
  }
  for (const r of sonuc.values()) r.mevcutRisk = Prisma.Decimal.max(r.bakiyeTry, 0).add(r.cekSenetRiski);
  return sonuc;
}

export interface GrupRiski {
  uyeSayisi: number;
  bakiyeTry: Prisma.Decimal;
  cekSenetRiski: Prisma.Decimal;
  /** Üyelerin mevcut risklerinin toplamı (alacaklı olduğumuz üye diğerini kapatmaz). */
  mevcutRisk: Prisma.Decimal;
  /** Üyelerin geçerli teminatları; grup limitine eklenir. */
  teminatTry: Prisma.Decimal;
  kurEksik: string[];
}

/**
 * CARI-41 (karar 2026-10-04): grup riski üyelerin `cariRiskleri` sonuçlarının
 * toplamıdır; kart, grup sayfası ve belge denetimi bunu kullanır.
 */
export async function grupRiskleri(tx: Prisma.TransactionClient, tenantId: string, grupIdler: string[], bugun = new Date()): Promise<Map<string, GrupRiski>> {
  if (grupIdler.length === 0) return new Map();
  const uyeler = await tx.cariHesap.findMany({ where: { grupId: { in: grupIdler } }, select: { id: true, grupId: true } });
  const riskler = await cariRiskleri(tx, tenantId, uyeler.map((u) => u.id), bugun);
  const sonuc = new Map<string, GrupRiski>(grupIdler.map((id) => [id, { uyeSayisi: 0, bakiyeTry: D(0), cekSenetRiski: D(0), mevcutRisk: D(0), teminatTry: D(0), kurEksik: [] }]));
  for (const u of uyeler) {
    const g = sonuc.get(u.grupId!)!;
    const r = riskler.get(u.id)!;
    g.uyeSayisi += 1;
    g.bakiyeTry = g.bakiyeTry.add(r.bakiyeTry);
    g.cekSenetRiski = g.cekSenetRiski.add(r.cekSenetRiski);
    g.mevcutRisk = g.mevcutRisk.add(r.mevcutRisk);
    g.teminatTry = g.teminatTry.add(r.teminatTry);
    for (const d of r.kurEksik) if (!g.kurEksik.includes(d)) g.kurEksik.push(d);
  }
  return sonuc;
}

/** CARI-39: kullanılabilir limit = risk limiti + geçerli teminat; limit yoksa denetim yok. */
export function toplamLimit(risk: Pick<CariRiski, "teminatTry">, riskLimiti: Prisma.Decimal | null): Prisma.Decimal | null {
  return riskLimiti === null ? null : riskLimiti.add(risk.teminatTry);
}

/** Kartın risk özeti: limit tanımlıysa kalan limit ve aşım. */
/** Kart ve grup özeti; grup riskinde de aynı alanlar vardır (CARI-41). */
export function riskOzetiGorunumu(risk: Pick<CariRiski, "cekSenetRiski" | "mevcutRisk" | "teminatTry" | "kurEksik">, riskLimiti: Prisma.Decimal | null) {
  const limit = toplamLimit(risk, riskLimiti);
  return {
    cekSenetRiski: risk.cekSenetRiski.toFixed(2),
    mevcutRisk: risk.mevcutRisk.toFixed(2),
    limit: riskLimiti?.toFixed(2) ?? null,
    teminat: risk.teminatTry.toFixed(2),
    /** Risk limiti + geçerli teminat. */
    kullanilabilirLimit: limit?.toFixed(2) ?? null,
    kalanLimit: limit ? limit.sub(risk.mevcutRisk).toFixed(2) : null,
    asim: limit !== null && risk.mevcutRisk.greaterThan(limit),
    kurEksik: risk.kurEksik,
  };
}

export interface DovizYaslandirmasi extends YaslandirmaSonucu {
  dovizCinsi: string;
  /** TL'ye çevirmede kullanılan kur; kur yoksa tarihî ortalama (kurEksik). */
  kur: number;
  kurEksik: boolean;
}

/** TL toplamları güncel kurla; `dovizler` her dövizin kendi cinsinden kovaları. */
export interface CariYaslandirma extends YaslandirmaSonucu {
  dovizler: DovizYaslandirmasi[];
  kurEksik: string[];
  /** CARI-43: vadesi geçmiş en eski açık kalemin gecikme günü; yoksa null. */
  enEskiGecikmeGun: number | null;
  /** CARI-44: vadesi bugün ile 7 gün sonrası arasında olan açık tutar (TL, güncel kurla). */
  yakinVadeTry: number;
}

const YAKIN_VADE_GUN = 7;

type YaslandirmaKaydi = { cariId: string; tip: "borc" | "alacak"; dovizCinsi: string; tutar: Prisma.Decimal; tutarTry: Prisma.Decimal; vadeTarihi: Date | null; tarih: Date };

/**
 * Bir carinin hareketlerini döviz başına FIFO ile yaşlandırır ve kovaları güncel
 * kurla TL'ye çevirir (CARI-06/33). Kuru bulunamayan dövizde o dövizin
 * hareketlerinden çıkan ortalama tarihî kur kullanılır.
 */
export function dovizBazliYaslandir(hareketler: YaslandirmaKaydi[], kurlar: GuncelKurlar, bugun: Date, yon: YaslandirmaYonu): CariYaslandirma {
  const dovizGruplari = new Map<string, YaslandirmaKaydi[]>();
  for (const h of hareketler) dovizGruplari.set(h.dovizCinsi, [...(dovizGruplari.get(h.dovizCinsi) ?? []), h]);
  const sonuc: CariYaslandirma = { ...bosYaslandirma(), dovizler: [], kurEksik: [], enEskiGecikmeGun: null, yakinVadeTry: 0 };
  for (const [doviz, liste] of dovizGruplari) {
    const kalemler = liste.map((h) => ({ tip: h.tip, tutar: Number(h.tutar), vadeTarihi: h.vadeTarihi, tarih: h.tarih }));
    const y = yaslandir(kalemler, bugun, yon);
    if (y.toplam === 0) continue;
    const guncel = doviz === "TRY" ? 1 : kurlar.get(doviz)?.satis.toNumber() ?? null;
    const toplamDoviz = liste.reduce((t, h) => t + Number(h.tutar), 0);
    const kur = guncel ?? (toplamDoviz ? liste.reduce((t, h) => t + Number(h.tutarTry), 0) / toplamDoviz : 1);
    sonuc.dovizler.push({ dovizCinsi: doviz, kur, kurEksik: guncel === null, ...y });
    if (guncel === null) sonuc.kurEksik.push(doviz);
    for (const kova of YASLANDIRMA_KOVALARI) sonuc[kova] = Math.round((sonuc[kova] + y[kova] * kur) * 100) / 100;
    for (const kalem of acikKalemler(kalemler, yon)) {
      const gecikme = Math.floor((bugun.getTime() - (kalem.vadeTarihi ?? kalem.tarih).getTime()) / GUN_MS);
      if (gecikme > 0) sonuc.enEskiGecikmeGun = Math.max(sonuc.enEskiGecikmeGun ?? 0, gecikme);
      else if (gecikme >= -YAKIN_VADE_GUN) sonuc.yakinVadeTry = Math.round((sonuc.yakinVadeTry + kalem.acik * kur) * 100) / 100;
    }
  }
  sonuc.toplam = Math.round(YASLANDIRMA_KOVALARI.reduce((t, k) => t + sonuc[k], 0) * 100) / 100;
  return sonuc;
}

/**
 * Cari başına döviz bazlı FIFO yaşlandırma (CARI-06/18/33). İptal edilen
 * faturanın hareket çifti önce düşülür; yoksa iptalin ters hareketi en eski
 * borcu kapatıp vadesi geçmiş tutarı kaydırırdı. Kartın "vadesi geçmiş"
 * bilgisi, listenin "gecikmiş" süzgeci ve yaşlandırma raporu bunu kullanır.
 */
export async function cariYaslandirmalari(
  tx: Prisma.TransactionClient,
  tenantId: string,
  cariIdler: string[],
  secenekler: { bugun?: Date; yon?: YaslandirmaYonu } = {},
): Promise<Map<string, CariYaslandirma>> {
  if (cariIdler.length === 0) return new Map();
  const bugun = secenekler.bugun ?? new Date();
  const hareketler = await tx.cariHareket.findMany({
    where: { cariId: { in: cariIdler } },
    select: { cariId: true, tip: true, dovizCinsi: true, tutar: true, tutarTry: true, vadeTarihi: true, tarih: true, kaynakTur: true, kaynakRef: true },
  });
  const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
  const kurlar = await guncelKurlar(tx, tenantId, hareketler.map((h) => h.dovizCinsi), bugun);
  const gruplar = new Map<string, typeof hareketler>();
  for (const h of hareketler) {
    if (iptalCiftiMi(h, iptaller)) continue;
    const liste = gruplar.get(h.cariId) ?? [];
    liste.push(h);
    gruplar.set(h.cariId, liste);
  }
  return new Map(cariIdler.map((id) => [id, dovizBazliYaslandir(gruplar.get(id) ?? [], kurlar, bugun, secenekler.yon ?? "alacaklarimiz")]));
}

/** Vadesi geçmiş açık tutar (yaşlandırmanın güncel dışı kısmı, TL). */
export const vadesiGecmis = (y: YaslandirmaSonucu) => Math.round((y.toplam - y.guncel) * 100) / 100;
