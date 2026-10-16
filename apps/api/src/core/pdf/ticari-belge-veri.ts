/**
 * FTR-38/39/41: ticari belge basımının belge dışından gelen verisi — alıcının
 * adresi ve vergi dairesi, ürün kartlarının yabancı adları/menşei/GTİP'i ve
 * "faturada göster" işaretli banka hesapları. Teklif/sipariş/irsaliye ve
 * fatura/proforma aynı kuralla okur.
 */
import { type Prisma } from "@prisma/client";
import { type BelgeDili, yabanciAdlarNormalize } from "@tekirextra/shared";

export interface TicariBelgeEkVerisi {
  firma: {
    unvan: string; vkn: string; vergiDairesi: string | null; adres: string | null; ilce: string | null; il: string | null;
    postaKodu: string | null; telefon: string | null; eposta: string | null; webSitesi: string | null; mersisNo: string | null; ticaretSicilNo: string | null;
  } | null;
  cari: { vergiDairesi: string | null; adres: { adres: string; il: string | null; ilce: string | null; postaKodu: string | null; ulke: string } | null };
  /** Kart kimliğine göre: belge dilindeki ad/açıklama, menşe, GTİP. */
  stoklar: Map<string, { yabanciAd: string | null; yabanciAciklama: string | null; mensei: string | null; gtipKodu: string | null }>;
  /** Belge dövizindeki hesaplar önce. */
  bankalar: { bankaAdi: string; sube: string | null; iban: string; swift: string | null; doviz: string }[];
}

export async function ticariBelgeEkVerisi(
  tx: Prisma.TransactionClient,
  girdi: { tenantId: string; cariId: string; stokIds: string[]; dil: BelgeDili; doviz: string },
): Promise<TicariBelgeEkVerisi> {
  const [firma, cari, stoklar, bankalar] = await Promise.all([
    tx.tenant.findUnique({
      where: { id: girdi.tenantId },
      select: { unvan: true, vkn: true, vergiDairesi: true, adres: true, ilce: true, il: true, postaKodu: true, telefon: true, eposta: true, webSitesi: true, mersisNo: true, ticaretSicilNo: true },
    }),
    tx.cariHesap.findUnique({
      where: { id: girdi.cariId },
      select: { vergiDairesi: true, adresler: { select: { tip: true, adres: true, il: true, ilce: true, postaKodu: true, ulke: true } } },
    }),
    tx.stokKart.findMany({ where: { id: { in: [...new Set(girdi.stokIds)] } }, select: { id: true, yabanciAdlar: true, mensei: true, gtipKodu: true } }),
    tx.bankaHesap.findMany({
      where: { aktif: true, faturadaGoster: true, iban: { not: null } },
      select: { bankaAdi: true, sube: true, iban: true, swift: true, dovizCinsi: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  // Fatura adresi, yoksa merkez, yoksa ilk adres (cari ekstresiyle aynı sıra).
  const adresler = cari?.adresler ?? [];
  const adres = adresler.find((a) => a.tip === "fatura") ?? adresler.find((a) => a.tip === "merkez") ?? adresler[0] ?? null;
  return {
    firma,
    cari: { vergiDairesi: cari?.vergiDairesi ?? null, adres: adres && { adres: adres.adres, il: adres.il, ilce: adres.ilce, postaKodu: adres.postaKodu, ulke: adres.ulke } },
    stoklar: new Map(stoklar.map((s) => {
      const ceviri = girdi.dil === "tr" ? undefined : yabanciAdlarNormalize(s.yabanciAdlar)?.[girdi.dil];
      return [s.id, { yabanciAd: ceviri?.ad ?? null, yabanciAciklama: ceviri?.aciklama ?? null, mensei: s.mensei, gtipKodu: s.gtipKodu }];
    })),
    bankalar: bankalar
      .map((h) => ({ bankaAdi: h.bankaAdi, sube: h.sube, iban: h.iban!, swift: h.swift, doviz: h.dovizCinsi as string }))
      .sort((a, b) => Number(b.doviz === girdi.doviz) - Number(a.doviz === girdi.doviz)),
  };
}
