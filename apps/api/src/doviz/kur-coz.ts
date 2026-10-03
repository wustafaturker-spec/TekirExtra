import { BadRequestException } from "@nestjs/common";
import { Prisma, type DovizCinsi } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";

/**
 * DVZ-04: belge tarihinden en fazla bu kadar takvim günü geriye gidilir. En
 * uzun bayram tatili sığar; daha eski kur sessizce kullanılmaz.
 */
export const KUR_GERI_BAKIS_GUN = 10;

export type KurTipi = "alis" | "satis";

export interface CozulenKur {
  alis: Prisma.Decimal;
  satis: Prisma.Decimal;
  kurTarihi: Date;
  /** `ELLE` ya da TCMB kaydının kaynağı (`TCMB_EVDS`, `TCMB_XML`). */
  kaynak: string;
  alindiAt: Date;
}

const gunBasi = (tarih: Date) => new Date(Date.UTC(tarih.getUTCFullYear(), tarih.getUTCMonth(), tarih.getUTCDate()));

/** Geriye bakış penceresinin ilk günü. */
export function kurPenceresiBasi(tarih: Date): Date {
  const bas = gunBasi(tarih);
  bas.setUTCDate(bas.getUTCDate() - KUR_GERI_BAKIS_GUN);
  return bas;
}

/**
 * Kiracının o tarihte geçerli kurları (DVZ-04, DVZ-05), birden çok döviz için
 * tek seferde. Pencere içindeki en yeni günün kuru alınır; aynı gün için
 * kiracının elle kuru varsa o, yoksa ortak TCMB kuru. Penceresinde kuru
 * olmayan döviz sonuçta yer almaz — çağıran 1 ya da sabit bir kur
 * varsaymamalı, işlemi durdurmalıdır.
 */
export async function kurlariBul(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dovizler: readonly string[],
  tarih: Date,
): Promise<Map<string, CozulenKur>> {
  const pencere = { gte: kurPenceresiBasi(tarih), lte: tarih };
  const dovizCinsi = { in: dovizler as DovizCinsi[] };
  const [elleler, tcmbler] = await Promise.all([
    tx.elleKur.findMany({
      where: { tenantId, dovizCinsi, tarih: pencere },
      orderBy: { tarih: "desc" },
      select: { dovizCinsi: true, tarih: true, dovizAlis: true, dovizSatis: true, updatedAt: true },
    }),
    tx.tcmbKuru.findMany({
      where: { dovizCinsi, tarih: pencere },
      orderBy: { tarih: "desc" },
      select: { dovizCinsi: true, tarih: true, dovizAlis: true, dovizSatis: true, kaynak: true, alindiAt: true },
    }),
  ]);
  const sonuc = new Map<string, CozulenKur>();
  for (const doviz of dovizler) {
    const elle = elleler.find((k) => k.dovizCinsi === doviz);
    const tcmb = tcmbler.find((k) => k.dovizCinsi === doviz);
    if (elle && (!tcmb || elle.tarih.getTime() >= tcmb.tarih.getTime())) {
      sonuc.set(doviz, { alis: elle.dovizAlis, satis: elle.dovizSatis, kurTarihi: elle.tarih, kaynak: "ELLE", alindiAt: elle.updatedAt });
    } else if (tcmb) {
      sonuc.set(doviz, { alis: tcmb.dovizAlis, satis: tcmb.dovizSatis, kurTarihi: tcmb.tarih, kaynak: tcmb.kaynak, alindiAt: tcmb.alindiAt });
    }
  }
  return sonuc;
}

/** Tek döviz için `kurlariBul`; penceresinde kur yoksa `null`. */
export async function kurBul(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dovizCinsi: string,
  tarih: Date,
): Promise<CozulenKur | null> {
  return (await kurlariBul(tx, tenantId, [dovizCinsi], tarih)).get(dovizCinsi) ?? null;
}

/**
 * Belgenin TL karşılığı için kur; varsayılan TCMB **döviz satış** kuru, çünkü
 * gider yabancı para satın alınarak ödenir. TRY için 1.
 */
export async function kurCoz(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dovizCinsi: string,
  tarih: Date,
  tip: KurTipi = "satis",
): Promise<Prisma.Decimal | null> {
  if (dovizCinsi === "TRY") return new Prisma.Decimal(1);
  const kur = await kurBul(tx, tenantId, dovizCinsi, tarih);
  if (!kur) return null;
  return tip === "alis" ? kur.alis : kur.satis;
}

/**
 * Kuru bulunamayan işlemi açık bir hatayla durdurur. İstek içindeki servisler
 * içindir; kiracı istek bağlamından okunur.
 */
export async function kurZorunlu(
  tx: Prisma.TransactionClient,
  dovizCinsi: string,
  tarih: Date,
  tip: KurTipi = "satis",
  tenantId: string = aktifBaglam().tenantId,
): Promise<Prisma.Decimal> {
  const kur = await kurCoz(tx, tenantId, dovizCinsi, tarih, tip);
  if (kur) return kur;
  throw new BadRequestException(
    `${dovizCinsi} için ${gunBasi(tarih).toISOString().slice(0, 10)} tarihinde ya da en fazla ${KUR_GERI_BAKIS_GUN} gün öncesinde kur bulunamadı; Ayarlar > Döviz Kurları ekranından çekin ya da elle girin`,
  );
}
