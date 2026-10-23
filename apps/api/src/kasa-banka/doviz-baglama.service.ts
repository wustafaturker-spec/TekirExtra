import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DovizCinsi, Prisma } from "@prisma/client";
import { hareketKurTipi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { kurZorunlu } from "../doviz/kur-coz";
import { cariDenklestir } from "../fatura/denklestirme";
import { beklenenOdemeTipi, faturaKilitleVeKalaniGetir } from "../fatura/odeme-durumu";
import { baglanmamisFisler } from "./baglanmamis-odeme";

type Tx = Prisma.TransactionClient;
const D = (x: Prisma.Decimal.Value) => new Prisma.Decimal(x);

/** Bağlamanın cari düzeltme hareketleri (kaynakRef = kapama). */
export const DOVIZ_BAGLAMA = "doviz_baglama";
export const DOVIZ_BAGLAMA_IPTAL = "doviz_baglama_iptal";

export interface BaglamaSatiri {
  faturaId: string;
  /** Fişin dövizinde bağlanan tutar. */
  tutar: string;
  /** Faturanın dövizinde karşılık (bankanın uyguladığı); boşsa fiş tarihinin kuruyla hesaplanır. */
  karsilik?: string | null;
}

const fisSecimi = {
  id: true, tenantId: true, tip: true, tarih: true, tutar: true, dovizCinsi: true, kur: true, tutarTry: true, cariId: true, faturaId: true, kaynakTur: true, aciklama: true, makbuzNo: true,
  cari: { select: { id: true, kod: true, unvan: true } },
} as const satisfies Prisma.KasaBankaHareketSelect;

/**
 * KSB-19…24: faturasız girilmiş tahsilat/ödeme fişinin sonradan, elle,
 * açık faturalara bağlanması. Fatura başka dövizdeyse karşılık fiş tarihinin
 * kuruyla (ya da bankanın uyguladığı karşılıkla) hesaplanır ve fişin cari
 * hareketi o kısım için fatura dövizine taşınır: kendi dövizinde ters,
 * fatura dövizinde aynı TL değerli hareket. Otomatik denkleştirme (KSB-16)
 * çapraz dövize yayılmaz; bu yalnız elle yapılır (karar 2026-10-23).
 */
@Injectable()
export class DovizBaglamaService {
  constructor(private readonly prisma: PrismaService, private readonly donemKilidi: DonemKilidiService) {}

  /** Fişin bağlanmamış tutarı, mevcut elle bağları ve carinin bu yöndeki açık faturaları. */
  async onizle(hareketId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fis = await fisOku(tx, hareketId);
      const bosta = await bostaTutar(tx, fis);
      const faturaTipleri = fis.tip === "tahsilat" ? ["satis", "alis_iade"] : ["alis", "satis_iade"];
      const faturalar = await tx.fatura.findMany({
        where: { cariId: fis.cariId!, durum: "kesin", tip: { in: faturaTipleri as never } },
        orderBy: [{ vadeTarihi: "asc" }, { tarih: "asc" }],
        take: 300,
        select: { id: true, no: true, tip: true, tarih: true, vadeTarihi: true, dovizCinsi: true, kur: true, genelToplam: true, kapamalar: { select: { tutar: true } }, iadeKapamalari: { select: { tutar: true } } },
      });
      const kurlar = new Map<string, Prisma.Decimal | null>();
      const acik = [];
      for (const f of faturalar) {
        const odenen = [...f.kapamalar, ...f.iadeKapamalari].reduce((t, k) => t.add(k.tutar), D(0));
        const kalan = Prisma.Decimal.max(f.genelToplam.sub(odenen), 0);
        if (!kalan.gt(0)) continue;
        if (!kurlar.has(f.dovizCinsi)) kurlar.set(f.dovizCinsi, await capraz(tx, fis, f.dovizCinsi).catch(() => null));
        acik.push({
          id: f.id, no: f.no, tip: f.tip, tarih: gun(f.tarih), vadeTarihi: f.vadeTarihi ? gun(f.vadeTarihi) : null, dovizCinsi: f.dovizCinsi,
          genelToplam: f.genelToplam.toFixed(2), kalan: kalan.toFixed(2),
          /** 1 fatura dövizi kaç fiş dövizi (fiş tarihinin kuru); aynı dövizde 1. */
          kur: kurlar.get(f.dovizCinsi)?.toFixed(6) ?? null,
        });
      }
      const baglar = await tx.faturaKapama.findMany({
        where: { kasaBankaHareketId: fis.id, otomatik: false },
        select: { id: true, tutar: true, kaynakTutari: true, kurFarkiFaturaId: true, fatura: { select: { id: true, no: true, dovizCinsi: true } } },
        orderBy: { createdAt: "asc" },
      });
      return {
        fis: { id: fis.id, tip: fis.tip, tarih: gun(fis.tarih), tutar: fis.tutar.toFixed(2), dovizCinsi: fis.dovizCinsi, makbuzNo: fis.makbuzNo, aciklama: fis.aciklama, cari: fis.cari, bosta: bosta.toFixed(2) },
        kapaliDonem: await this.donemKapali(tx, tenantId, fis.tarih),
        faturalar: acik,
        baglar: baglar.map((b) => ({
          id: b.id, fatura: b.fatura, karsilik: b.tutar.toFixed(2), tutar: (b.kaynakTutari ?? b.tutar).toFixed(2),
          kurFarkiFaturali: Boolean(b.kurFarkiFaturaId),
        })),
      };
    });
  }

  /** KSB-23: carinin faturaya bağlanmamış kısmı kalan tahsilat/ödeme fişleri. */
  async baglanmamislar(cariId: string) {
    const { tenantId } = aktifBaglam();
    const fisler = await this.prisma.tenantIslem(tenantId, (tx) => baglanmamisFisler(tx, [cariId]));
    return fisler.map((f) => ({
      id: f.id, tarih: gun(f.tarih), tip: f.tip, dovizCinsi: f.dovizCinsi, tutar: f.tutar.toFixed(2), kalan: f.kalan.toFixed(2), kalanTry: f.kalanTry.toFixed(2),
      makbuzNo: f.makbuzNo, aciklama: f.aciklama,
    }));
  }

  async bagla(hareketId: string, satirlar: BaglamaSatiri[]) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM kasa_banka_hareketleri WHERE id = ${hareketId}::uuid FOR UPDATE`;
      const fis = await fisOku(tx, hareketId);
      await this.donemKilidi.tarihDogrula(tenantId, gun(fis.tarih), "ödemeyi faturaya bağlama", tx);
      const baglar = await baglaTx(tx, tenantId, fis, satirlar);
      await tx.auditLog.create({ data: { tenantId, userId, islem: "odeme_faturaya_baglandi", varlik: "kasa_banka_hareketi", varlikId: fis.id, detay: { baglar } } });
      return { baglar };
    }, { timeout: 30_000 });
  }

  /** KSB-24: elle bağlamayı çözer; çapraz dövizde cari düzeltmesi de silinir. Kapalı dönemde çözülemez. */
  async coz(kapamaId: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const k = await tx.faturaKapama.findUnique({
        where: { id: kapamaId },
        select: { id: true, cariId: true, otomatik: true, tutar: true, kaynakTutari: true, kurFarkiFaturaId: true, kasaBankaHareketId: true, kasaBankaHareket: { select: { tarih: true, faturaId: true } }, fatura: { select: { id: true, no: true } } },
      });
      if (!k || !k.kasaBankaHareketId || k.otomatik) throw new NotFoundException("Elle bağlama bulunamadı");
      if (k.kasaBankaHareket!.faturaId === k.fatura.id) throw new BadRequestException("Fiş bu faturaya girişte bağlandı; bağı çözmek için fişi geri alın");
      if (await kurFarkiFaturali(tx, [k.kurFarkiFaturaId])) throw new BadRequestException("Bu bağlamanın kur farkı faturalandı; önce kur farkı faturasını iptal edin");
      await this.donemKilidi.tarihDogrula(tenantId, gun(k.kasaBankaHareket!.tarih), "faturaya bağlamayı çözme", tx);
      await tx.cariHareket.deleteMany({ where: { kaynakTur: DOVIZ_BAGLAMA, kaynakRef: k.id } });
      await tx.faturaKapama.delete({ where: { id: k.id } });
      await cariDenklestir(tx, tenantId, k.cariId);
      await tx.auditLog.create({ data: { tenantId, userId, islem: "odeme_fatura_bagi_cozuldu", varlik: "kasa_banka_hareketi", varlikId: k.kasaBankaHareketId, detay: { faturaId: k.fatura.id, no: k.fatura.no, karsilik: k.tutar.toFixed(2), tutar: (k.kaynakTutari ?? k.tutar).toFixed(2) } } });
      return { cozuldu: true };
    });
  }

  private async donemKapali(tx: Tx, tenantId: string, tarih: Date) {
    try {
      await this.donemKilidi.tarihDogrula(tenantId, tarih, "faturaya bağlama", tx);
      return false;
    } catch (hata) {
      if (hata instanceof ConflictException) return true;
      throw hata;
    }
  }
}

const gun = (d: Date) => d.toISOString().slice(0, 10);

/** Kur farkı iptal edilmemiş bir faturayla faturalanmış mı (KSB-22). */
async function kurFarkiFaturali(tx: Tx, faturaIdleri: (string | null)[]) {
  const idler = faturaIdleri.filter((x): x is string => Boolean(x));
  return idler.length > 0 && (await tx.fatura.count({ where: { id: { in: idler }, durum: { not: "iptal" } } })) > 0;
}

export async function fisOku(tx: Tx, hareketId: string) {
  const fis = await tx.kasaBankaHareket.findUnique({ where: { id: hareketId }, select: fisSecimi });
  if (!fis) throw new NotFoundException("Kasa/banka fişi bulunamadı");
  if (fis.tip !== "tahsilat" && fis.tip !== "tediye") throw new BadRequestException("Yalnız tahsilat ve ödeme fişi faturaya bağlanır");
  if (!fis.cariId) throw new BadRequestException("Fiş bir cariye bağlı değil; önce cariye işleyin");
  if (fis.faturaId) throw new BadRequestException("Fiş girişte bir faturaya bağlandı; artanı o faturanın dövizinde avanstır");
  if (fis.kaynakTur === "ters_kayit" || fis.kaynakTur === "acilis") throw new BadRequestException("Bu fiş faturaya bağlanamaz");
  if (await tx.kasaBankaHareket.findFirst({ where: { kaynakTur: "ters_kayit", kaynakRef: fis.id }, select: { id: true } })) throw new ConflictException("Fiş geri alınmış");
  return fis;
}

/**
 * Bağlamanın çekirdeği (işlem içinde, dönem denetimi çağıranda): her fatura için
 * elle kapama; fatura başka dövizdeyse karşılık ve cari hareketinin fatura
 * dövizine taşınması. Sonunda carinin aynı dövizli kalanı vadeye göre dağılır.
 */
export async function baglaTx(tx: Tx, tenantId: string, fis: Awaited<ReturnType<typeof fisOku>>, satirlar: BaglamaSatiri[]) {
  if (!satirlar.length) throw new BadRequestException("Bağlanacak fatura seçin");
  if (new Set(satirlar.map((s) => s.faturaId)).size !== satirlar.length) throw new BadRequestException("Aynı fatura iki kez seçilmiş");
  const bosta = await bostaTutar(tx, fis);
  const toplam = satirlar.reduce((t, s) => t.add(pozitif(s.tutar, "Bağlanan tutar")), D(0));
  if (toplam.gt(bosta)) throw new BadRequestException(`Bağlanan ${toplam.toFixed(2)} ${fis.dovizCinsi}, fişin faturaya bağlanmamış ${bosta.toFixed(2)} ${fis.dovizCinsi} tutarını aşıyor`);
  const sonuc = [];
  // Kilit sırası sabit: eşzamanlı iki bağlama aynı faturaları ters sırayla kilitleyip kilitlenmez.
  for (const s of [...satirlar].sort((a, b) => a.faturaId.localeCompare(b.faturaId))) {
    const f = await faturaKilitleVeKalaniGetir(tx, s.faturaId);
    const ad = f.no ?? "Numarasız fatura";
    if (f.durum !== "kesin") throw new BadRequestException(`${ad} kesinleşmemiş`);
    if (f.cariId !== fis.cariId) throw new BadRequestException(`${ad} bu fişin carisine ait değil`);
    if (beklenenOdemeTipi(f.tip) !== fis.tip) throw new BadRequestException(`${ad} için ${beklenenOdemeTipi(f.tip) === "tahsilat" ? "tahsilat" : "ödeme"} fişi gerekir`);
    const tutar = pozitif(s.tutar, "Bağlanan tutar").toDecimalPlaces(2);
    const ayni = f.dovizCinsi === fis.dovizCinsi;
    const karsilik = ayni ? tutar
      : s.karsilik ? pozitif(s.karsilik, "Karşılık").toDecimalPlaces(2)
      : tutar.div(await capraz(tx, fis, f.dovizCinsi)).toDecimalPlaces(2);
    if (karsilik.gt(f.kalan)) throw new BadRequestException(`${ad} için karşılık ${karsilik.toFixed(2)} ${f.dovizCinsi}, kalanı (${f.kalan.toFixed(2)}) aşıyor`);
    const kaynakTry = fis.dovizCinsi === "TRY" ? tutar : tutar.mul(fis.kur).toDecimalPlaces(2);
    const kapama = await tx.faturaKapama.create({
      data: {
        tenantId, cariId: fis.cariId!, faturaId: f.id, tutar: karsilik, otomatik: false, kasaBankaHareketId: fis.id,
        ...(ayni ? {} : { kaynakTutari: tutar, kaynakTutariTry: kaynakTry }),
      },
    });
    if (!ayni) {
      // Fişin cari hareketi bu kısım için fatura dövizine taşınır: kendi dövizinde ters, fatura dövizinde aynı TL değeriyle.
      const fisYonu = fis.tip === "tahsilat" ? "alacak" as const : "borc" as const;
      const ters = fisYonu === "alacak" ? "borc" as const : "alacak" as const;
      const aciklama = `${ad} faturasına bağlama: ${tutar.toFixed(2)} ${fis.dovizCinsi} → ${karsilik.toFixed(2)} ${f.dovizCinsi}`;
      await tx.cariHareket.createMany({
        data: [
          { tenantId, cariId: fis.cariId!, tip: ters, tutar, dovizCinsi: fis.dovizCinsi, kur: fis.dovizCinsi === "TRY" ? D(1) : fis.kur, tutarTry: kaynakTry, tarih: fis.tarih, aciklama, kaynakTur: DOVIZ_BAGLAMA, kaynakRef: kapama.id },
          { tenantId, cariId: fis.cariId!, tip: fisYonu, tutar: karsilik, dovizCinsi: f.dovizCinsi as DovizCinsi, kur: f.dovizCinsi === "TRY" ? D(1) : kaynakTry.div(karsilik).toDecimalPlaces(6), tutarTry: kaynakTry, tarih: fis.tarih, aciklama, kaynakTur: DOVIZ_BAGLAMA, kaynakRef: kapama.id },
        ],
      });
    }
    sonuc.push({ kapamaId: kapama.id, faturaId: f.id, no: f.no, tutar: tutar.toFixed(2), karsilik: karsilik.toFixed(2), dovizCinsi: f.dovizCinsi });
  }
  // Kalan aynı dövizli kısım vadeye göre yeniden dağılır.
  await cariDenklestir(tx, tenantId, fis.cariId!);
  const sira = new Map(satirlar.map((s, i) => [s.faturaId, i]));
  return sonuc.sort((a, b) => sira.get(a.faturaId)! - sira.get(b.faturaId)!);
}


function pozitif(deger: string, ad: string) {
  const d = (() => { try { return D(deger); } catch { return D(NaN); } })();
  if (!d.isFinite() || !d.gt(0)) throw new BadRequestException(`${ad} sıfırdan büyük olmalı`);
  return d;
}

/** 1 birim fatura dövizinin fiş dövizindeki değeri, fiş tarihinin kuruyla (DVZ-09: tahsilatta alış, ödemede satış). */
async function capraz(tx: Tx, fis: { dovizCinsi: string; tarih: Date; tip: string; kur: Prisma.Decimal }, faturaDovizi: string) {
  if (faturaDovizi === fis.dovizCinsi) return D(1);
  const tip = hareketKurTipi(fis.tip);
  const faturaKuru = faturaDovizi === "TRY" ? D(1) : await kurZorunlu(tx, faturaDovizi as DovizCinsi, fis.tarih, tip);
  const fisKuru = fis.dovizCinsi === "TRY" ? D(1) : fis.kur;
  return faturaKuru.div(fisKuru);
}

/**
 * Fişin henüz elle bağlanmamış tutarı (kendi dövizinde): tutar − ters kayıtlar
 * − elle kapamaların kaynaktan düştüğü. Otomatik kapamalar sayılmaz; elle
 * bağlama onların önüne geçer, artan vadeye göre yeniden dağılır.
 */
export async function bostaTutar(tx: Tx, fis: { id: string; tutar: Prisma.Decimal }) {
  const [elle, tersler] = await Promise.all([
    tx.faturaKapama.findMany({ where: { kasaBankaHareketId: fis.id, otomatik: false }, select: { tutar: true, kaynakTutari: true } }),
    tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: fis.id }, select: { tutar: true } }),
  ]);
  const kullanilan = elle.reduce((t, k) => t.add(k.kaynakTutari ?? k.tutar), D(0));
  const dusen = tersler.reduce((t, h) => t.add(h.tutar), D(0));
  return Prisma.Decimal.max(fis.tutar.sub(dusen).sub(kullanilan), 0);
}

/**
 * Geri alınan fişlerin çapraz dövizli bağlamaları: açık dönemde fişle birlikte
 * silinen cari düzeltmeleri silinir; kapalı dönemde (fişe bugün tarihli ters
 * kayıt atılırken) düzeltmenin tersi bugün tarihiyle yazılır.
 */
export async function bagDuzeltmeleriniGeriAl(tx: Tx, tenantId: string, hareketIdler: string[], yontem: { sil: true } | { tarih: string }) {
  const kapamalar = await tx.faturaKapama.findMany({ where: { kasaBankaHareketId: { in: hareketIdler }, kaynakTutari: { not: null } }, select: { id: true, kurFarkiFaturaId: true } });
  if (!kapamalar.length) return;
  if (await kurFarkiFaturali(tx, kapamalar.map((k) => k.kurFarkiFaturaId))) throw new BadRequestException("Fişin bir fatura bağlamasının kur farkı faturalandı; önce kur farkı faturasını iptal edin");
  const idler = kapamalar.map((k) => k.id);
  if ("sil" in yontem) {
    await tx.cariHareket.deleteMany({ where: { kaynakTur: DOVIZ_BAGLAMA, kaynakRef: { in: idler } } });
    return;
  }
  const duzeltmeler = await tx.cariHareket.findMany({ where: { kaynakTur: DOVIZ_BAGLAMA, kaynakRef: { in: idler } } });
  await tx.cariHareket.createMany({
    data: duzeltmeler.map((h) => ({
      tenantId, cariId: h.cariId, tip: h.tip === "borc" ? "alacak" as const : "borc" as const, tutar: h.tutar, dovizCinsi: h.dovizCinsi, kur: h.kur, tutarTry: h.tutarTry,
      tarih: new Date(yontem.tarih), aciklama: `Ters kayıt: ${h.aciklama ?? "faturaya bağlama"}`.slice(0, 500), kaynakTur: DOVIZ_BAGLAMA_IPTAL, kaynakRef: h.kaynakRef,
    })),
  });
}
