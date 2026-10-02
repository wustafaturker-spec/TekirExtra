/**
 * KSB-10: kart ekstrelerini veritabanından okuyup hesaplar. Kart ekranı,
 * nakit akışı ve bildirim taraması aynı hesabı buradan kullanır.
 */
import type { Prisma } from "@prisma/client";
import { ekstreleriHesapla, kalemleriAyir, type EkstreDonemi } from "./kart-ekstre";

const gunMetni = (t: Date) => t.toISOString().slice(0, 10);

const KART_SECIMI = {
  id: true, ad: true, sonDortHane: true, dovizCinsi: true, limit: true, hesapKesimGunu: true, sonOdemeGunu: true, asgariOdemeOrani: true, aktif: true,
  hareketler: {
    select: {
      id: true, tip: true, tarih: true, tutar: true, aciklama: true, taksitSayisi: true, geriAlinanHareketId: true, ekstreId: true,
      taksitler: { select: { id: true, sira: true, vadeTarihi: true, tutar: true, ekstreId: true }, orderBy: { sira: "asc" } },
    },
  },
  ekstreler: { orderBy: { kesimTarihi: "asc" } },
} satisfies Prisma.KrediKartiSelect;

export type OkunanKart = Prisma.KrediKartiGetPayload<{ select: typeof KART_SECIMI }>;

/** Tam gün tatiller (yarım gün arife iş günüdür); son ödeme günü kaydırması için. */
async function tatiller(tx: Prisma.TransactionClient, bugun: string): Promise<Set<string>> {
  const yil = Number(bugun.slice(0, 4));
  const gunler = await tx.personelTatilGunu.findMany({
    where: { yarimGun: false, tarih: { gte: new Date(`${yil - 2}-01-01`), lte: new Date(`${yil + 4}-12-31`) } },
    select: { tarih: true },
  });
  return new Set(gunler.map((g) => gunMetni(g.tarih)));
}

export function kartDonemleri(kart: OkunanKart, bugun: string, tatilGunleri: ReadonlySet<string>): EkstreDonemi[] {
  return ekstreleriHesapla({
    kart,
    kesinler: kart.ekstreler.map((e) => ({ ...e, kesimTarihi: gunMetni(e.kesimTarihi), sonOdemeTarihi: gunMetni(e.sonOdemeTarihi) })),
    ...kalemleriAyir(kart.hareketler),
    bugun,
    tatiller: tatilGunleri,
  });
}

export async function kartEkstreleriniOku(tx: Prisma.TransactionClient, bugun: string, kartId?: string) {
  const [kartlar, tatilGunleri] = await Promise.all([
    tx.krediKarti.findMany({ where: kartId ? { id: kartId } : {}, select: KART_SECIMI, orderBy: [{ aktif: "desc" }, { ad: "asc" }] }),
    tatiller(tx, bugun),
  ]);
  return kartlar.map((kart) => ({ kart, donemler: kartDonemleri(kart, bugun, tatilGunleri) }));
}
