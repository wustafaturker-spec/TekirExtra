/**
 * KSB-29: kur farkı faturası ödenmez. Dövizli ödemenin TL farkı carinin döviz
 * bakiyesinde görünmediği için kur farkı faturası tek başına sahte bir açık
 * alacak/borç doğururdu. Fatura kesinleşince (gelen faturada eşleşince) aynı
 * tutarda ters yönlü "kur farkı karşılığı" cari hareketi yazılır ve fatura bu
 * hareketle kapanır: TL bakiyesi, risk, vadesi geçenler etkilenmez. Cari
 * hareketleri yalnız eklenir; geri almada ters kayıt yazılır.
 */
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export const KUR_FARKI_KARSILIGI = "kur_farki_karsiligi";
export const KUR_FARKI_KARSILIGI_IPTAL = "kur_farki_karsiligi_iptal";

/** Faturaya bağlı kur farkı kalemi var mı (bizim kestiğimiz ya da eşleşen gelen fatura). */
export async function kurFarkiFaturasiMi(tx: Tx, faturaId: string): Promise<boolean> {
  const [kapama, hareket] = await Promise.all([
    tx.faturaKapama.count({ where: { kurFarkiFaturaId: faturaId } }),
    tx.kasaBankaHareket.count({ where: { kurFarkiFaturaId: faturaId } }),
  ]);
  return kapama + hareket > 0;
}

/** Kesin, TL ve kur farkı kalemine bağlı faturaya karşılık hareketi ve kapamasını yazar (zaten varsa dokunmaz). */
export async function kurFarkiKarsiligiYaz(tx: Tx, tenantId: string, faturaId: string): Promise<boolean> {
  const f = await tx.fatura.findUnique({ where: { id: faturaId }, select: { id: true, no: true, tip: true, durum: true, dovizCinsi: true, cariId: true, tarih: true, genelToplam: true } });
  if (!f || f.durum !== "kesin" || f.dovizCinsi !== "TRY" || !["satis", "alis"].includes(f.tip) || !f.genelToplam.gt(0)) return false;
  if (!(await kurFarkiFaturasiMi(tx, faturaId))) return false;
  if (await tx.faturaKapama.count({ where: { faturaId, cariHareketId: { not: null } } })) return false;
  // Satış faturası cariyi borçlandırır; karşılığı alacak. Alış tersi.
  const hareket = await tx.cariHareket.create({
    data: {
      tenantId, cariId: f.cariId, tip: f.tip === "satis" ? "alacak" : "borc", tutar: f.genelToplam, dovizCinsi: "TRY", kur: 1, tutarTry: f.genelToplam,
      tarih: f.tarih, aciklama: `Kur farkı karşılığı — ${f.no ?? "kur farkı faturası"} (ödenmez, dövizli ödemenin TL farkını kapatır)`,
      kaynakTur: KUR_FARKI_KARSILIGI, kaynakRef: f.id,
    },
  });
  await tx.faturaKapama.create({ data: { tenantId, cariId: f.cariId, faturaId, tutar: f.genelToplam, otomatik: false, cariHareketId: hareket.id } });
  return true;
}

/** Fatura iptal/taslağa geri alınırken ya da eşleşme çözülürken: kapama silinir, karşılık hareketi ters kayıtla kapanır. */
export async function kurFarkiKarsiliginiCoz(tx: Tx, tenantId: string, faturaId: string): Promise<void> {
  const kapamalar = await tx.faturaKapama.findMany({ where: { faturaId, cariHareketId: { not: null } }, include: { cariHareket: true } });
  for (const k of kapamalar) {
    const h = k.cariHareket!;
    await tx.faturaKapama.delete({ where: { id: k.id } });
    await tx.cariHareket.create({
      data: {
        tenantId, cariId: h.cariId, tip: h.tip === "borc" ? "alacak" : "borc", tutar: h.tutar, dovizCinsi: h.dovizCinsi, kur: h.kur, tutarTry: h.tutarTry,
        tarih: h.tarih, aciklama: `${h.aciklama ?? "Kur farkı karşılığı"} — geri alındı`, kaynakTur: KUR_FARKI_KARSILIGI_IPTAL, kaynakRef: faturaId,
      },
    });
  }
}
