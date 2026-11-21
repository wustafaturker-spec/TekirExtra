import { type DovizCinsi, Prisma } from "@prisma/client";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { bankaOnerisiUret, type BankaOneriGirdisi, type BankaOneriSonucu } from "./banka-oneri-motoru";
import { kendiAdlariniBul } from "./ekstre-karsi-taraf";
import { ettnleriBul, faturaNumaralariniBul } from "./fatura-referansi";

/**
 * AI-119: öneri motorunun girdisi. Eskiden en çok 300 cari ve 300 fatura (sırasız; ödenmiş
 * faturalar dahil) veriliyordu; büyük firmada doğru cari aday listesine hiç girmiyordu.
 * Şimdi:
 * - bütün aktif cariler unvan/VKN/IBAN sinyali için taranır (alanlar dar seçilir);
 * - IBAN, carinin ek banka hesaplarında doğrudan sorgulanır;
 * - faturalar iki aşamada: önce sinyal toplayan cariler bulunur (açıklamada geçen faturalar
 *   dahil), sonra yalnız bu carilerin, açıklamada geçen ve tutarı birebir tutan açık faturalar
 *   okunur ve motor ikinci kez çalışır.
 * Saf okuma yapar; satıra yazmaz.
 */
export interface OneriSatiri {
  id: string;
  tarih: Date;
  tutar: Prisma.Decimal;
  aciklama: string;
  karsiIban: string | null;
  karsiUnvan: string | null;
  dekontNo?: string | null;
  bankaHesapId: string;
}

export async function bankaOnerisiHesapla(
  tx: Prisma.TransactionClient,
  tenantId: string,
  satir: OneriSatiri,
  doviz: DovizCinsi,
  ek: Pick<BankaOneriGirdisi, "kurallar" | "odemeTalimatlari" | "kendiAdlari"> = {},
): Promise<BankaOneriSonucu> {
  const giris = !satir.tutar.isNegative();
  const mutlak = satir.tutar.abs();
  const metin = `${satir.aciklama} ${satir.karsiUnvan ?? ""}`;
  const temizIban = satir.karsiIban ? satir.karsiIban.replace(/\s+/g, "").toUpperCase() : null;
  const numaralar = faturaNumaralariniBul(metin, satir.tarih).slice(0, 10);
  const ettnler = ettnleriBul(metin).slice(0, 10);
  const tipler = giris ? ["satis", "alis_iade"] : ["alis", "satis_iade"];

  const [cariler, ekHesaplar, kendiAdlari] = await Promise.all([
    tx.cariHesap.findMany({ where: { tenantId, aktif: true }, select: { id: true, kod: true, unvan: true, vknTckn: true, iban: true, tip: true }, orderBy: { id: "asc" } }),
    temizIban ? tx.cariBankaHesap.findMany({ where: { tenantId, iban: temizIban }, select: { cariId: true, iban: true } }) : Promise.resolve([]),
    ek.kendiAdlari ? Promise.resolve(ek.kendiAdlari) : tx.bankaEkstreSatir
      .findMany({ where: { tenantId }, orderBy: { tarih: "desc" }, take: 100, select: { aciklama: true, tutar: true } })
      .then((x) => kendiAdlariniBul(x.map((y) => ({ aciklama: y.aciklama, giris: !y.tutar.isNegative() })))),
  ]);
  const ekIbanlar = new Map<string, Array<{ iban: string }>>();
  for (const h of ekHesaplar) ekIbanlar.set(h.cariId, [...(ekIbanlar.get(h.cariId) ?? []), { iban: h.iban }]);

  const faturaOku = async (where: Prisma.FaturaWhereInput) => (await tx.fatura.findMany({
    where: { tenantId, durum: "kesin", dovizCinsi: doviz, tip: { in: tipler as never }, ...where },
    select: { id: true, no: true, durum: true, tarih: true, vadeTarihi: true, dovizCinsi: true, genelToplam: true, cariId: true, ...FATURA_ODEME_SECIMI },
    orderBy: { tarih: "desc" },
    take: 2000,
  })).flatMap((f) => {
    const kalan = faturaOdemeDurumu(f).kalan;
    return kalan.gt(0) ? [{
      id: f.id, no: f.no, cariId: f.cariId, dovizCinsi: f.dovizCinsi,
      tarih: f.tarih.toISOString().slice(0, 10), vadeTarihi: f.vadeTarihi?.toISOString().slice(0, 10) ?? null,
      kalan: kalan.toFixed(2), genelToplam: f.genelToplam.toFixed(2),
    }] : [];
  });

  const girdi: BankaOneriGirdisi = {
    satir: { ...satir, dovizCinsi: doviz },
    kurallar: ek.kurallar,
    odemeTalimatlari: ek.odemeTalimatlari,
    kendiAdlari,
    cariler: cariler.map((c) => ({ ...c, ...(ekIbanlar.has(c.id) ? { ekBankaHesaplari: ekIbanlar.get(c.id) } : {}) })),
    faturalar: numaralar.length || ettnler.length ? await faturaOku({ OR: [...(numaralar.length ? [{ no: { in: numaralar } }] : []), ...(ettnler.length ? [{ id: { in: ettnler } }] : [])] }) : [],
  };
  const ilk = bankaOnerisiUret(girdi);
  // Talimat ve kayıtlı kural cariden bağımsızdır; ikinci aşamaya gerek yok.
  if (ilk.onerilenTur !== "cari") return sonucuTemizle(ilk);
  const adaylar = ilk.adayCariIdleri ?? [];
  const faturalar = await faturaOku({ OR: [
    ...(adaylar.length ? [{ cariId: { in: adaylar } }] : []),
    { genelToplam: mutlak },
    ...(numaralar.length ? [{ no: { in: numaralar } }] : []),
    ...(ettnler.length ? [{ id: { in: ettnler } }] : []),
  ] });
  return sonucuTemizle(bankaOnerisiUret({ ...girdi, faturalar }));
}

function sonucuTemizle(s: BankaOneriSonucu): BankaOneriSonucu {
  const { adayCariIdleri: _a, ...kalan } = s;
  return kalan;
}
