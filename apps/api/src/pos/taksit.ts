/** KSB-35: POS hesabının taksit tablosu ve tahmini komisyon. */
import { Prisma } from "@prisma/client";
import { posTaksitOrani, type PosTaksitOrani } from "@tekirextra/shared";

/** JSON sütununu güvenle okur; bozuk satırlar atlanır. */
export function taksitTablosu(deger: Prisma.JsonValue | null | undefined): PosTaksitOrani[] {
  if (!Array.isArray(deger)) return [];
  return deger.flatMap((x) => {
    const s = x as { taksit?: unknown; oran?: unknown } | null;
    const taksit = Number(s?.taksit);
    const oran = String(s?.oran ?? "");
    return Number.isInteger(taksit) && taksit >= 2 && taksit <= 12 && /^\d{1,2}(\.\d{1,2})?$/.test(oran) ? [{ taksit, oran }] : [];
  });
}

/** Tahmini komisyon = tutar × taksit oranı ÷ 100 + işlem başı ücret (2 ondalık). */
export function tahminiKomisyon(
  tutar: Prisma.Decimal,
  hesap: { komisyonOrani: Prisma.Decimal | string | number; islemUcreti: Prisma.Decimal | string | number; taksitOranlari: Prisma.JsonValue },
  taksit = 1,
): { oran: Prisma.Decimal; komisyon: Prisma.Decimal } {
  const oran = new Prisma.Decimal(posTaksitOrani({ komisyonOrani: hesap.komisyonOrani.toString(), taksitOranlari: taksitTablosu(hesap.taksitOranlari) }, taksit));
  const komisyon = tutar.mul(oran).div(100).add(new Prisma.Decimal(hesap.islemUcreti)).toDecimalPlaces(2);
  return { oran, komisyon };
}

/** KSB-36: tahsilata yazılan tahmini komisyon alanları; komisyon tahsilat tutarı üzerinden hesaplanır. */
export function tahminiKomisyonAlanlari(
  tutar: Prisma.Decimal,
  hesap: Parameters<typeof tahminiKomisyon>[1],
  taksit = 1,
  odenen?: Prisma.Decimal,
) {
  const t = Number.isInteger(taksit) && taksit >= 1 && taksit <= 12 ? taksit : 1;
  const { oran, komisyon } = tahminiKomisyon(tutar, hesap, t);
  const sinirli = Prisma.Decimal.min(komisyon, tutar);
  return {
    taksitSayisi: t,
    odenenTutar: odenen ?? tutar,
    komisyonOrani: oran,
    komisyonTutari: sinirli,
    netTutar: tutar.sub(sinirli),
    komisyonKaynagi: "tahmin" as const,
  };
}
