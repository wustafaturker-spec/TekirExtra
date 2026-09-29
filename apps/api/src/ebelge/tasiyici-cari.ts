import { Prisma } from "@prisma/client";
import { belgeAdresiSec } from "@tekirextra/shared";
import type { InternetSatisOzeti } from "./internet-satis-bilgisi";

/**
 * EBLG-113: internet satışında kargo firmasının adresi cari kartından gelir.
 * Faturada yalnız unvan ve VKN tutulur; VKN aktif bir cari kartıyla eşleşirse
 * o kartın adresi `CarrierParty`'ye yazılır, eşleşmezse boş il/ilçe kalır.
 * Aynı VKN'li birden çok kart varsa kod sırasıyla ilki alınır. Sihirbazın
 * ipucu, önizleme ve gönderim aynı işlevi çağırır.
 */
export async function tasiyiciCariBul(tx: Prisma.TransactionClient, vkn: string | null | undefined) {
  const aranan = vkn?.trim();
  if (!aranan) return null;
  const cari = await tx.cariHesap.findFirst({
    where: { vknTckn: aranan, aktif: true },
    orderBy: { kod: "asc" },
    select: { id: true, kod: true, unvan: true, adresler: { select: { tip: true, adres: true, il: true, ilce: true, postaKodu: true, ulke: true } } },
  });
  if (!cari) return null;
  const adres = belgeAdresiSec(cari.adresler);
  return { id: cari.id, kod: cari.kod, unvan: cari.unvan, adresler: cari.adresler, il: adres?.il ?? null, ilce: adres?.ilce ?? null };
}

/** Gönderilecek internet satışı bilgisine eşleşen kartın adreslerini ekler. */
export async function tasiyiciAdresiniBagla(tx: Prisma.TransactionClient, internet: InternetSatisOzeti) {
  const ubl = internet.ublBilgisi;
  if (!ubl?.tasiyiciUnvan || !ubl.tasiyiciVkn) return;
  const cari = await tasiyiciCariBul(tx, ubl.tasiyiciVkn);
  if (cari?.adresler.length) ubl.tasiyiciAdresleri = cari.adresler;
}

/** Sihirbazın ipucu için kartın kimliği ve il/ilçesi; adres listesi dönmez. */
export function tasiyiciCariOzeti(cari: Awaited<ReturnType<typeof tasiyiciCariBul>>) {
  return cari ? { id: cari.id, kod: cari.kod, unvan: cari.unvan, il: cari.il, ilce: cari.ilce } : null;
}
