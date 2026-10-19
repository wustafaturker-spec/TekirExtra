import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Satir = Prisma.FaturaSatirGetPayload<{ select: typeof satirSecimi }>;
const satirSecimi = { id: true, stokId: true, toplamTutar: true, kaynakBelgeSatirId: true } satisfies Prisma.FaturaSatirSelect;
const hamSatirSecimi = { ...satirSecimi, faturaId: true, matrah: true } satisfies Prisma.FaturaSatirSelect;
const belgeSatirSecimi = { id: true, belgeId: true, stokId: true, kaynakSatirId: true, belge: { select: { id: true, tur: true, durum: true, kaynakBelgeId: true, faturaId: true, dovizCinsi: true } } } satisfies Prisma.BelgeSatirSelect;
type KaynakSatir = Prisma.BelgeSatirGetPayload<{ select: typeof belgeSatirSecimi }>;

function sinir(adet: number) {
  if (adet > 5000) throw new ConflictException("Fatura kaynak zinciri 5000 kayıt sınırını aşıyor; kısmi sahiplik gösterilmedi");
}

/** Birden fazla kesin satış faturasının fırsat sahipliğini ortak ve sınırlı sorgularla çözer. */
export async function faturaSatirSahiplikleriniOku(tx: Tx, tenantId: string, cariId: string, faturaIdleri: string[]) {
  const ids = [...new Set(faturaIdleri)].sort();
  if (!ids.length) return new Map<string, {
    f: { id: string; dovizCinsi: string; durum: string };
    lines: Satir[];
    path: KaynakSatir[];
    links: { id: string; belgeId: string; firsatId: string }[];
    satirSahipleri: { satirId: string; firsatId: string | null; matrah: Prisma.Decimal }[];
  }>();
  sinir(ids.length);

  const faturalar = await tx.fatura.findMany({ where: { tenantId, cariId, tip: "satis", id: { in: ids } }, select: { id: true, dovizCinsi: true, durum: true } });
  const faturaMap = new Map(faturalar.map(f => [f.id, f]));
  const hamSatirlar = await tx.faturaSatir.findMany({ where: { tenantId, faturaId: { in: ids } }, select: hamSatirSecimi, orderBy: [{ faturaId: "asc" }, { id: "asc" }], take: 5001 });
  sinir(hamSatirlar.length);
  const satirlar = new Map<string, Satir[]>();
  const matrahMap = new Map<string, Prisma.Decimal>();
  for (const row of hamSatirlar) {
    const { faturaId, matrah, ...satir } = row;
    matrahMap.set(satir.id, matrah);
    const liste = satirlar.get(faturaId) ?? [];
    liste.push(satir);
    satirlar.set(faturaId, liste);
  }

  const path = new Map<string, KaynakSatir>();
  const ilgiliPath = new Map(ids.map(id => [id, new Set<string>()]));
  let sonraki = new Map(ids.map(id => [id, new Set((satirlar.get(id) ?? []).flatMap(s => s.kaynakBelgeSatirId ? [s.kaynakBelgeSatirId] : []))]));
  for (let depth = 0; depth < 3 && [...sonraki.values()].some(s => s.size); depth++) {
    const aranan = [...new Set([...sonraki.values()].flatMap(s => [...s]))].filter(id => !path.has(id)).sort();
    sinir(path.size + aranan.length);
    const bulunan = aranan.length ? await tx.belgeSatir.findMany({ where: { tenantId, id: { in: aranan }, belge: { tenantId, cariId, yon: "satis" } }, select: belgeSatirSecimi, orderBy: { id: "asc" }, take: 5001 }) : [];
    sinir(path.size + bulunan.length);
    const bulunanMap = new Map(bulunan.map(row => [row.id, row]));
    for (const row of bulunan) path.set(row.id, row);
    const yeni = new Map<string, Set<string>>();
    for (const id of ids) {
      const buFatura = new Set<string>();
      for (const kaynakId of sonraki.get(id) ?? []) {
        if (!bulunanMap.has(kaynakId)) continue;
        ilgiliPath.get(id)!.add(kaynakId);
        const parent = bulunanMap.get(kaynakId)?.kaynakSatirId;
        if (parent && !path.has(parent)) buFatura.add(parent);
      }
      yeni.set(id, buFatura);
    }
    sonraki = yeni;
  }

  const teklifIds = [...new Set([...path.values()].filter(s => s.belge.tur === "teklif").map(s => s.belgeId))].sort();
  const links = teklifIds.length ? await tx.firsatBelgeBagi.findMany({ where: { tenantId, cariId, belgeId: { in: teklifIds }, cozulduAt: null }, select: { id: true, belgeId: true, firsatId: true }, orderBy: { id: "asc" }, take: 5001 }) : [];
  sinir(links.length);
  const owner = new Map(links.map(link => [link.belgeId, link.firsatId]));
  const linksByBelge = new Map<string, typeof links>();
  for (const link of links) {
    const bucket = linksByBelge.get(link.belgeId) ?? [];
    bucket.push(link);
    linksByBelge.set(link.belgeId, bucket);
  }
  const sonuc = new Map<string, {
    f: { id: string; dovizCinsi: string; durum: string };
    lines: Satir[];
    path: KaynakSatir[];
    links: typeof links;
    satirSahipleri: { satirId: string; firsatId: string | null; matrah: Prisma.Decimal }[];
  }>();
  for (const id of ids) {
    const f = faturaMap.get(id);
    if (!f) continue;
    const ownPath = new Map([...ilgiliPath.get(id)!].flatMap(pathId => path.has(pathId) ? [[pathId, path.get(pathId)!] as const] : []));
    const rootIds = new Set([...ownPath.values()].filter(s => s.belge.tur === "teklif").map(s => s.belgeId));
    const ownLinks = [...rootIds].flatMap(belgeId => linksByBelge.get(belgeId) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const sahip = (row: Satir): string | null => {
      let kaynak = row.kaynakBelgeSatirId ? ownPath.get(row.kaynakBelgeSatirId) : undefined;
      if (!kaynak || kaynak.belge.faturaId !== id || kaynak.belge.dovizCinsi !== f.dovizCinsi || !["siparis", "irsaliye"].includes(kaynak.belge.tur)) return null;
      for (let depth = 0; kaynak && depth < 3; depth++) {
        if (kaynak.stokId !== row.stokId || kaynak.belge.durum === "iptal") return null;
        if (kaynak.belge.tur === "teklif") return owner.get(kaynak.belgeId) ?? null;
        const parentSatir: KaynakSatir | undefined = kaynak.kaynakSatirId ? ownPath.get(kaynak.kaynakSatirId) : undefined;
        if (!parentSatir || parentSatir.belgeId !== kaynak.belge.kaynakBelgeId || !(kaynak.belge.tur === "irsaliye" && parentSatir.belge.tur === "siparis" || kaynak.belge.tur === "siparis" && parentSatir.belge.tur === "teklif")) return null;
        kaynak = parentSatir;
      }
      return null;
    };
    const lines = satirlar.get(id) ?? [];
    sonuc.set(id, { f, lines, path: [...ownPath.values()].sort((a, b) => a.id.localeCompare(b.id)), links: ownLinks, satirSahipleri: lines.map(row => ({ satirId: row.id, firsatId: row.kaynakBelgeSatirId ? sahip(row) : null, matrah: matrahMap.get(row.id)! })) });
  }
  return sonuc;
}
