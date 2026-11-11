import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

const D = (d: Prisma.Decimal.Value) => new Prisma.Decimal(d);

/**
 * ONY-01: belgenin en yüksek iskonto yüzdesi — satır iskontosu (oran ya da tutarın brüte oranı)
 * ve genel iskonto (oran ya da tutarın satırlar sonrası ara toplama oranı); hangisi büyükse.
 */
export function enYuksekIskonto(b: {
  genelIskontoYuzdesi: Prisma.Decimal.Value; genelIskontoTutari: Prisma.Decimal.Value;
  satirlar: { miktar: Prisma.Decimal.Value; birimFiyat: Prisma.Decimal.Value; iskontoOrani: Prisma.Decimal.Value; iskontoTutari: Prisma.Decimal.Value }[];
}): number {
  let enCok = 0;
  let araToplam = D(0);
  for (const s of b.satirlar) {
    const brut = D(s.miktar).mul(s.birimFiyat);
    const oran = D(s.iskontoOrani).gt(0) ? D(s.iskontoOrani) : brut.gt(0) ? D(s.iskontoTutari).div(brut).mul(100) : D(0);
    enCok = Math.max(enCok, Number(oran));
    const satirIskonto = D(s.iskontoOrani).gt(0) ? brut.mul(s.iskontoOrani).div(100) : D(s.iskontoTutari);
    araToplam = araToplam.add(brut.sub(satirIskonto));
  }
  const genel = D(b.genelIskontoYuzdesi).gt(0) ? D(b.genelIskontoYuzdesi) : araToplam.gt(0) ? D(b.genelIskontoTutari).div(araToplam).mul(100) : D(0);
  return Math.round(Math.max(enCok, Number(genel)) * 100) / 100;
}

/** ONY-03: hedef kaydın sürüm özeti; talep ile yürütme arasında kayıt değiştiyse farklıdır. */
export const kayitOzeti = (k: { updatedAt: Date; durum: string }) => createHash("sha256").update(`${k.updatedAt.toISOString()}|${k.durum}`).digest("hex");
