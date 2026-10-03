import { Prisma } from "@prisma/client";
import { kurlariBul, type CozulenKur } from "../doviz/kur-coz";

/**
 * CARI-33 (karar 2026-10-03): dövizli cari bakiyesi, risk ve yaşlandırma
 * **güncel TCMB döviz satış kuruyla** TL'ye çevrilir; tarihî TL (hareketlerin
 * kendi kuruyla) ayrıca tutulur, aradaki fark değerlenmemiş kur farkıdır.
 * Penceresinde kur bulunamayan dövizde tarihî TL kullanılır ve döviz
 * `kurEksik` listesine yazılır — kart ve risk boş kalmasın, ama sessiz de olmasın.
 */
export type GuncelKurlar = Map<string, CozulenKur>;

export async function guncelKurlar(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dovizler: Iterable<string>,
  bugun = new Date(),
): Promise<GuncelKurlar> {
  const yabanci = [...new Set(dovizler)].filter((d) => d !== "TRY");
  return yabanci.length ? kurlariBul(tx, tenantId, yabanci, bugun) : new Map();
}

export interface DovizDegeri {
  /** Güncel satış kuru; TRY'de 1, kur bulunamadıysa null. */
  kur: Prisma.Decimal | null;
  guncelTry: Prisma.Decimal;
  kurEksik: boolean;
}

/** Döviz cinsinden tutarın güncel TL değeri; kur yoksa `yedekTry` (tarihî TL). */
export function guncelTlDegeri(
  dovizCinsi: string,
  tutar: Prisma.Decimal,
  yedekTry: Prisma.Decimal,
  kurlar: GuncelKurlar,
): DovizDegeri {
  if (dovizCinsi === "TRY") return { kur: new Prisma.Decimal(1), guncelTry: tutar, kurEksik: false };
  const kur = kurlar.get(dovizCinsi)?.satis ?? null;
  if (!kur) return { kur: null, guncelTry: yedekTry, kurEksik: true };
  return { kur, guncelTry: tutar.mul(kur).toDecimalPlaces(2), kurEksik: false };
}

/**
 * Tek belge tutarının güncel TL karşılığı (risk denetiminde sipariş tutarı);
 * kur bulunamazsa belgenin kendi kuru kullanılır.
 */
export async function belgeGuncelTry(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tutar: Prisma.Decimal,
  dovizCinsi: string,
  belgeKuru: Prisma.Decimal,
): Promise<Prisma.Decimal> {
  const kurlar = await guncelKurlar(tx, tenantId, [dovizCinsi]);
  return guncelTlDegeri(dovizCinsi, tutar, tutar.mul(belgeKuru).toDecimalPlaces(2), kurlar).guncelTry;
}
