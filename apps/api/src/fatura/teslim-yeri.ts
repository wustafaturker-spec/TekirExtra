import { Prisma } from "@prisma/client";
import { irsaliyeTeslimatAdresi } from "../ebelge/eirsaliye-engeller";

/** FTR-30: faturanın teslim yeri alanları. */
export interface TeslimYeri {
  teslimatAdres?: string | null;
  teslimatIl?: string | null;
  teslimatIlce?: string | null;
  teslimatPostaKodu?: string | null;
}

const temiz = (x?: string | null) => x?.trim() || null;

/** Kayda yazılacak hâli: boş alanlar null. */
export function teslimYeriVerisi(girdi: TeslimYeri) {
  return {
    teslimatAdres: temiz(girdi.teslimatAdres),
    teslimatIl: temiz(girdi.teslimatIl),
    teslimatIlce: temiz(girdi.teslimatIlce),
    teslimatPostaKodu: temiz(girdi.teslimatPostaKodu),
  };
}

/** Belgeye yazılabilir teslim yeri: adres, il ve ilçe dolu; yoksa undefined. */
export function faturaTeslimYeri(f: TeslimYeri) {
  const v = teslimYeriVerisi(f);
  return v.teslimatAdres && v.teslimatIl && v.teslimatIlce
    ? { adres: v.teslimatAdres, il: v.teslimatIl, ilce: v.teslimatIlce, postaKodu: v.teslimatPostaKodu }
    : undefined;
}

/**
 * Elle girilen teslim yerini carinin sevk adreslerine ekler (kullanıcı
 * isterse). Aynı adres zaten kayıtlıysa ikinci kez eklenmez.
 */
export async function teslimYeriniCariyeKaydet(tx: Prisma.TransactionClient, tenantId: string, cariId: string, girdi: TeslimYeri): Promise<void> {
  const t = faturaTeslimYeri(girdi);
  if (!t) return;
  const sadelestir = (x?: string | null) => (x ?? "").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
  const mevcut = await tx.cariAdres.findMany({ where: { cariId }, select: { adres: true, il: true, ilce: true } });
  if (mevcut.some((a) => sadelestir(a.adres) === sadelestir(t.adres) && sadelestir(a.il) === sadelestir(t.il) && sadelestir(a.ilce) === sadelestir(t.ilce))) return;
  await tx.cariAdres.create({
    data: { tenantId, cariId, tip: "sevk", baslik: `Teslim yeri — ${t.ilce}/${t.il}`, adres: t.adres, il: t.il, ilce: t.ilce, postaKodu: t.postaKodu, ulke: "TR" },
  });
}

/**
 * FTR-30: faturaya bağlı (ya da bağlanacak) satış irsaliyelerinin teslim
 * yerleri, belge sırasıyla. e-İrsaliyeye fiilen yazılan adres esas alınır:
 * irsaliyeye girilen yer, yoksa carinin sevk/merkez adresi (EBLG-84 kuralı).
 */
export async function irsaliyeTeslimYerleri(
  tx: Prisma.TransactionClient,
  where: Prisma.BelgeWhereInput,
): Promise<{ no: string | null; yer: { adres: string; il: string; ilce: string; postaKodu: string | null } }[]> {
  const belgeler = await tx.belge.findMany({
    where: { ...where, tur: "irsaliye", yon: "satis" },
    orderBy: [{ tarih: "asc" }, { no: "asc" }],
    select: {
      no: true, teslimatAdres: true, teslimatIl: true, teslimatIlce: true, teslimatPostaKodu: true, gumrukDepoSevki: true,
      depo: { select: { adres: true, il: true, ilce: true, postaKodu: true } },
      cari: { select: { vknTckn: true, adresler: { select: { tip: true, adres: true, il: true, ilce: true, postaKodu: true, ulke: true } } } },
    },
  });
  return belgeler.flatMap((b) => {
    const yer = irsaliyeTeslimatAdresi(b);
    return yer?.adres && yer.il && yer.ilce ? [{ no: b.no, yer: { adres: yer.adres, il: yer.il, ilce: yer.ilce, postaKodu: yer.postaKodu ?? null } }] : [];
  });
}

const ayniYer = (a: TeslimYeri, b: TeslimYeri) => {
  const s = (x?: string | null) => (x ?? "").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
  return s(a.teslimatAdres) === s(b.teslimatAdres) && s(a.teslimatIl) === s(b.teslimatIl) && s(a.teslimatIlce) === s(b.teslimatIlce);
};

/**
 * Faturanın teslim yeri boşsa ilk irsaliyenin teslim yerini yazar. Elle
 * girilmiş yer ezilmez; fark `teslimYeriUyarisi` ile ekranda söylenir.
 */
export async function teslimYeriniIrsaliyedenDoldur(tx: Prisma.TransactionClient, faturaId: string): Promise<void> {
  const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { teslimatAdres: true, teslimatIl: true, teslimatIlce: true } });
  if (!fatura || fatura.teslimatAdres || fatura.teslimatIl || fatura.teslimatIlce) return;
  const [ilk] = await irsaliyeTeslimYerleri(tx, { faturaId });
  if (!ilk) return;
  await tx.fatura.update({
    where: { id: faturaId },
    data: { teslimatAdres: ilk.yer.adres, teslimatIl: ilk.yer.il, teslimatIlce: ilk.yer.ilce, teslimatPostaKodu: ilk.yer.postaKodu },
  });
}

/**
 * Bağlı irsaliyelerin teslim yerleri birbirinden ya da faturadakinden
 * farklıysa kullanıcıya söylenecek metin; yoksa null.
 */
export async function teslimYeriUyarisi(tx: Prisma.TransactionClient, fatura: TeslimYeri & { id: string }): Promise<string | null> {
  const yerler = await irsaliyeTeslimYerleri(tx, { faturaId: fatura.id });
  if (yerler.length === 0) return null;
  const hepsi = yerler.map((y) => ({ no: y.no, t: { teslimatAdres: y.yer.adres, teslimatIl: y.yer.il, teslimatIlce: y.yer.ilce } }));
  const farkli = hepsi.filter((y) => !ayniYer(y.t, hepsi[0].t));
  if (farkli.length > 0) {
    return `Bağlı irsaliyelerin teslim yerleri farklı (${hepsi.map((y) => `${y.no ?? "irsaliye"}: ${y.t.teslimatIlce}/${y.t.teslimatIl}`).join(", ")}); faturaya ilk irsaliyeninki yazıldı, gerekirse değiştirin.`;
  }
  if (faturaTeslimYeri(fatura) && !ayniYer(fatura, hepsi[0].t)) {
    return `Faturadaki teslim yeri bağlı irsaliyedekinden (${hepsi[0].no ?? "irsaliye"}: ${hepsi[0].t.teslimatIlce}/${hepsi[0].t.teslimatIl}) farklı.`;
  }
  return null;
}
