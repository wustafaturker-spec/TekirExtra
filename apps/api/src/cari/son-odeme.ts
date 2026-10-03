import { Prisma } from "@prisma/client";

/**
 * P1-6 (CARI-34): kartın "son tahsilat / son ödeme" tarihi carinin kendi
 * hareketlerinden türetilir; kasa/banka fişi, çek/senet (ciro dahil), POS ve
 * kredi kartı ödemeleri sayılır. Tahsilat = cariye alacak, ödeme = cariye borç.
 * Geri alınmış ödeme ile onun ters kaydı sayılmaz; karşılıksız ya da iade
 * edilen çek tahsilat değildir.
 */
export const ODEME_KAYNAKLARI = ["kasa_banka", "cek_senet", "cek_senet_ciro", "pos_tahsilat", "kredi_karti"] as const;

/** Son tarihi bulmak için bakılan en yeni ödeme hareketi sayısı. */
const BAKILAN_HAREKET = 100;

export interface OdemeHareketi {
  id: string;
  tip: "borc" | "alacak";
  tarih: Date;
  kaynakTur: string;
  kaynakRef: string | null;
}

/** Sayılmayacak hareketlerin kimlikleri: ters kayıtlar ve geri alınmış asılları. */
export async function gecersizOdemeler(tx: Prisma.TransactionClient, cariId: string, hareketler: OdemeHareketi[]): Promise<Set<string>> {
  const refler = (tur: string) => hareketler.filter((h) => h.kaynakTur === tur && h.kaynakRef).map((h) => h.kaynakRef!);
  const kasaRefleri = refler("kasa_banka");
  const kartRefleri = refler("kredi_karti");
  const [kasaTersleri, kasaTersOlanlar, kartTersleri, kartTersOlanlar, cekIptalleri] = await Promise.all([
    // Ters fişe bağlı cari hareketi ters kayıttır; tersi olan fişin hareketi geri alınmıştır.
    kasaRefleri.length ? tx.kasaBankaHareket.findMany({ where: { id: { in: kasaRefleri }, kaynakTur: "ters_kayit" }, select: { id: true } }) : [],
    kasaRefleri.length ? tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: kasaRefleri } }, select: { kaynakRef: true } }) : [],
    kartRefleri.length ? tx.krediKartiHareket.findMany({ where: { id: { in: kartRefleri }, geriAlinanHareketId: { not: null } }, select: { id: true } }) : [],
    kartRefleri.length ? tx.krediKartiHareket.findMany({ where: { geriAlinanHareketId: { in: kartRefleri } }, select: { geriAlinanHareketId: true } }) : [],
    // Çekte geri alma cari hareketine, karşılıksız/iade çek kaydına bağlanır.
    tx.cariHareket.findMany({ where: { cariId, kaynakTur: { in: ["cek_senet_geri_alma", "cek_senet_ters"] } }, select: { kaynakRef: true } }),
  ]);
  const kasaGecersiz = new Set<string>([...kasaTersleri.map((k) => k.id), ...kasaTersOlanlar.map((k) => k.kaynakRef!)]);
  const kartGecersiz = new Set<string>([...kartTersleri.map((k) => k.id), ...kartTersOlanlar.map((k) => k.geriAlinanHareketId!)]);
  const cekGecersiz = new Set(cekIptalleri.map((c) => c.kaynakRef).filter((r): r is string => !!r));
  return new Set(
    hareketler
      .filter((h) =>
        (h.kaynakTur === "kasa_banka" && kasaGecersiz.has(h.kaynakRef ?? "")) ||
        (h.kaynakTur === "kredi_karti" && kartGecersiz.has(h.kaynakRef ?? "")) ||
        (h.kaynakTur.startsWith("cek_senet") && (cekGecersiz.has(h.id) || cekGecersiz.has(h.kaynakRef ?? ""))))
      .map((h) => h.id),
  );
}

/** Saf seçim: en yeni geçerli tahsilat (alacak) ve ödeme (borç) tarihi. */
export function sonTarihler(hareketler: OdemeHareketi[], gecersiz: Set<string>) {
  const gecerli = hareketler.filter((h) => !gecersiz.has(h.id)).sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
  return {
    sonTahsilat: gecerli.find((h) => h.tip === "alacak")?.tarih ?? null,
    sonOdeme: gecerli.find((h) => h.tip === "borc")?.tarih ?? null,
  };
}

export async function sonOdemeTarihleri(tx: Prisma.TransactionClient, cariId: string) {
  const hareketler = await tx.cariHareket.findMany({
    where: { cariId, kaynakTur: { in: [...ODEME_KAYNAKLARI] } },
    orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
    take: BAKILAN_HAREKET,
    select: { id: true, tip: true, tarih: true, kaynakTur: true, kaynakRef: true },
  });
  return sonTarihler(hareketler, await gecersizOdemeler(tx, cariId, hareketler));
}
