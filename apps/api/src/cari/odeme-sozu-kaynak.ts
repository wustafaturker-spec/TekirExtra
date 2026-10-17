import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { KAPATAN_KASA_KAYNAKLARI } from "../fatura/denklestirme";
import { odemeSozleriniUzlastir, type OdemeSozuUzlastirmaGirdisi } from "./odeme-sozu-uzlastirma";
import { odemeSozuGorunumu } from "./odeme-sozu-gorunumu";

type Tx = Prisma.TransactionClient;
function sinir(kayitlar: unknown[], adet: number) {
  if (kayitlar.length > adet) throw new BadRequestException("Ödeme sözü kaynak sınırı aşıldı; kısmi sonuç üretilemez");
}

/** Yalnız güncel DB snapshot'ı; geçmiş kapama olayları biriktirilmez. */
export async function odemeSozuKaynaklariniOku(tx: Tx, tenantId: string, cariId: string) {
  const cari = await tx.cariHesap.findFirst({ where: { id: cariId, tenantId }, select: { id: true, unvan: true } });
  if (!cari) throw new NotFoundException("Cari bulunamadı");
  // Gerçekleşmiş görünen mantıksal aktif sözler de havuz tüketir: filtreleme yok.
  const sozler = await tx.odemeSozu.findMany({ where: { tenantId, cariId }, orderBy: [{ verildigiZaman: "asc" }, { id: "asc" }], take: 1001 });
  sinir(sozler, 1000);
  const faturaIdleri = [...new Set(sozler.map((s) => s.faturaId))];
  const faturalar = await tx.fatura.findMany({ where: { tenantId, cariId, id: { in: faturaIdleri } }, select: { id: true, tenantId: true, cariId: true, dovizCinsi: true, durum: true, tip: true, no: true } });
  if (faturalar.length !== faturaIdleri.length) throw new ConflictException("Söz hedefinin cari kapsamı değişmiş; kaynak incelenmeli");
  if (faturalar.some((f) => f.tip !== "satis") || sozler.some((s) => faturalar.find((f) => f.id === s.faturaId)?.dovizCinsi !== s.dovizCinsi)) throw new ConflictException("Söz hedefinin tipi veya dövizi değişmiş; kaynak incelenmeli");
  const kapamalar = await tx.faturaKapama.findMany({
    where: { tenantId, cariId, faturaId: { in: faturaIdleri }, kasaBankaHareketId: { not: null } }, take: 5001,
    select: { id: true, tenantId: true, cariId: true, faturaId: true, tutar: true, kasaBankaHareket: { select: { id: true, tenantId: true, cariId: true, tip: true, kaynakTur: true, dovizCinsi: true, tutar: true, tarih: true, createdAt: true } } },
  });
  sinir(kapamalar, 5000);
  const hareketler = new Map(kapamalar.flatMap((k) => k.kasaBankaHareket ? [[k.kasaBankaHareket.id, k.kasaBankaHareket] as const] : []));
  const ids = [...hareketler.keys()];
  // Aynı kaynağın başka faturaya dağıtılmış payını da görmeden kapasite ispatlanamaz.
  const tumPaylar = ids.length ? await tx.faturaKapama.findMany({
    where: { tenantId, kasaBankaHareketId: { in: ids } }, take: 5001,
    select: { kasaBankaHareketId: true, cariId: true, tutar: true, fatura: { select: { dovizCinsi: true } } },
  }) : [];
  sinir(tumPaylar, 5000);
  const tersler = ids.length ? await tx.kasaBankaHareket.findMany({ where: { tenantId, kaynakTur: "ters_kayit", kaynakRef: { in: ids } }, select: { kaynakRef: true, tutar: true, dovizCinsi: true }, take: 5001 }) : [];
  const poslar = ids.length ? await tx.posTahsilat.findMany({ where: { tenantId, hareketId: { in: ids } }, select: { id: true, hareketId: true, durum: true, cariId: true, dovizCinsi: true }, take: 5001 }) : [];
  sinir(tersler, 5000); sinir(poslar, 5000);
  const posHarita = new Map(poslar.map((p) => [p.id, p.hareketId]));
  const iadeler = poslar.length ? await tx.kasaBankaHareket.findMany({ where: { tenantId, kaynakTur: "pos_iade", kaynakRef: { in: [...posHarita.keys()] } }, select: { kaynakRef: true, tutar: true, dovizCinsi: true }, take: 5001 }) : [];
  sinir(iadeler, 5000);
  const dusumler = new Map<string, Prisma.Decimal>();
  const ekle = (kaynakId: string | null | undefined, tutar: Prisma.Decimal, doviz: string) => {
    if (!kaynakId || hareketler.get(kaynakId)?.dovizCinsi !== doviz || !tutar.gt(0)) throw new ConflictException("Ödeme geri alma kaynağı tutarsız");
    dusumler.set(kaynakId, (dusumler.get(kaynakId) ?? new Prisma.Decimal(0)).add(tutar));
  };
  for (const t of tersler) ekle(t.kaynakRef, t.tutar, t.dovizCinsi);
  for (const i of iadeler) ekle(i.kaynakRef ? posHarita.get(i.kaynakRef) : null, i.tutar, i.dovizCinsi);
  const paylar = new Map<string, Prisma.Decimal>();
  const farkliDoviz = new Set<string>();
  for (const p of tumPaylar) {
    const h = hareketler.get(p.kasaBankaHareketId!)!;
    if (p.cariId !== cariId || h.tenantId !== tenantId || h.cariId !== cariId || !p.tutar.gt(0)) throw new ConflictException("Kapama kaynak kapsamı tutarsız");
    if (p.fatura.dovizCinsi !== h.dovizCinsi) farkliDoviz.add(h.id);
    paylar.set(h.id, (paylar.get(h.id) ?? new Prisma.Decimal(0)).add(p.tutar));
  }
  for (const h of hareketler.values()) {
    if (h.kaynakTur === "pos_tahsilat" && !poslar.some((p) => p.hareketId === h.id && p.durum === "odendi" && p.cariId === cariId && p.dovizCinsi === h.dovizCinsi)) throw new ConflictException("POS ödeme kaynağı doğrulanamadı");
    if (farkliDoviz.has(h.id)) continue; // Kur dönüşümlü kaynak ilk dilimde sayılmaz.
    if ((paylar.get(h.id) ?? new Prisma.Decimal(0)).gt(Prisma.Decimal.max(h.tutar.sub(dusumler.get(h.id) ?? 0), 0))) {
      throw new ConflictException("Güncel kapamalar net ödeme kapasitesini aşıyor; denkleştirme incelenmeli");
    }
  }
  const faturaHarita = new Map(faturalar.map((f) => [f.id, f]));
  const kaynaklar: OdemeSozuUzlastirmaGirdisi["kapamalar"] = kapamalar.flatMap((k) => {
    const h = k.kasaBankaHareket, f = faturaHarita.get(k.faturaId);
    if (!h || !f || farkliDoviz.has(h.id) || h.tip !== "tahsilat" || !KAPATAN_KASA_KAYNAKLARI.includes(h.kaynakTur) || f.dovizCinsi !== h.dovizCinsi) return [];
    return [{ id: k.id, tenantId: k.tenantId, cariId: k.cariId, faturaId: k.faturaId, dovizCinsi: f.dovizCinsi, tutar: k.tutar.toFixed(2), kaynakId: h.id, kaynakTuru: "kasa_banka" as const, kaynakYon: "tahsilat" as const, islemZamani: h.tarih.toISOString(), islemZamaniHassasiyeti: "gun" as const, kaynakKayitZamani: h.createdAt.toISOString() }];
  });
  const [saat] = await tx.$queryRaw<{ zaman: Date }[]>`SELECT clock_timestamp() AS zaman`;
  const sonuc = odemeSozleriniUzlastir({
    tenantId, simdi: saat.zaman.toISOString(),
    faturalar: faturalar.map((f) => ({ id: f.id, tenantId: f.tenantId, cariId: f.cariId, dovizCinsi: f.dovizCinsi, durum: f.durum, tip: "satis" as const })),
    sozler: sozler.map((s) => ({ id: s.id, tenantId: s.tenantId, cariId: s.cariId, faturaId: s.faturaId, dovizCinsi: s.dovizCinsi, tutar: s.tutar.toFixed(2), verildigiZaman: s.verildigiZaman.toISOString(), sozTarihi: s.sozTarihi.toISOString().slice(0, 10), kayitDurumu: s.kayitDurumu as "aktif" | "iptal" | "revize" })), kapamalar: kaynaklar,
  });
  const sonucHarita = new Map(sonuc.map((s) => [s.sozId, s]));
  return { cari, alindigiZaman: saat.zaman.toISOString(), zamanHassasiyeti: "gun" as const,
    uyari: "Aynı gün verilen söz ve ödemenin sırası kanıtlanamaz; bu tahsilatlar otomatik gerçekleşme sayılmaz.",
    sozler: sozler.map((s) => ({ ...odemeSozuGorunumu(s), gerceklesme: sonucHarita.get(s.id), faturaNo: faturaHarita.get(s.faturaId)?.no ?? null })),
  };
}
