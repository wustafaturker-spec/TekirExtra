import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { partiBilgisiSemasi, type PartiGirdisi } from "../belgeler/belgeler.semalar";

/**
 * SAH-06: sahada mal kabul. Kaynak açık alış siparişi ya da gelen e-İrsaliyedir; sahada okutulan
 * miktarlar belge biriminde gönderilir ve sonuç alış irsaliyesi taslağı olur (onay panelde).
 */
export interface MalKabulSatiri {
  /** Sipariş satırı kimliği ya da e-İrsaliye sıra numarası (metin). */
  anahtar: string;
  stokId: string | null;
  varyantId: string | null;
  kod: string | null;
  ad: string;
  birim: string;
  /** Belge biriminden ana birime katsayı; birim kartta tanımlı değilse null (sahada kabul edilemez). */
  katsayi: number | null;
  /** Beklenen miktar (belge biriminde): siparişte kalan, e-İrsaliyede gönderilen. */
  beklenen: number;
  takipTipi: string | null;
}

export interface MalKabulBelgesi {
  tur: "siparis" | "eirsaliye";
  id: string;
  no: string | null;
  tarih: string;
  cariUnvan: string;
  /** e-İrsaliyede tedarikçi carisi yoksa sahada işlenemez (cari panelde açılır). */
  engel: string | null;
  satirlar: MalKabulSatiri[];
}

const miktarSemasi = z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, "Geçersiz miktar").refine((m) => Number(m) > 0, "Miktar pozitif olmalı");
export const siparisKabulSemasi = z.object({
  kalemler: z.array(z.object({ satirId: z.string().uuid(), miktar: miktarSemasi, partiler: z.array(partiBilgisiSemasi).max(500).optional() })).min(1).max(500),
});
export const eirsaliyeKabulSemasi = z.object({
  satirlar: z.array(z.object({
    siraNo: z.number().int().min(1), stokId: z.string().uuid(), varyantId: z.string().uuid().nullish(),
    miktar: miktarSemasi, partiler: z.array(partiBilgisiSemasi).max(500).optional(),
  })).min(1).max(500),
});

/** Lot/seri miktarlarının toplamı satır miktarını tutmalı (fatura stoğu partiden yazar). */
export function partiToplamiDenetle(miktar: string, partiler: PartiGirdisi[] | undefined, ad: string) {
  if (!partiler?.length) return;
  const toplam = partiler.reduce((t, p) => t.add(p.miktar), new Prisma.Decimal(0));
  if (!toplam.equals(new Prisma.Decimal(miktar))) throw new BadRequestException(`${ad}: lot/seri miktarları toplamı (${toplam.toString()}) satır miktarını (${miktar}) tutmuyor`);
}

const sayi = (d: Prisma.Decimal | string | number) => Number(d);
const gun = (d: Date) => d.toISOString().slice(0, 10);

/** Belge birimi → ana birim katsayıları (kartın ana birimi 1). */
async function katsayilar(tx: Prisma.TransactionClient, stokIdler: string[]) {
  const [kartlar, birimler] = await Promise.all([
    tx.stokKart.findMany({ where: { id: { in: stokIdler } }, select: { id: true, kod: true, ad: true, anaBirim: true, takipTipi: true } }),
    tx.stokBirim.findMany({ where: { stokId: { in: stokIdler } }, select: { stokId: true, ad: true, katsayi: true } }),
  ]);
  const kart = new Map(kartlar.map((k) => [k.id, k]));
  const birim = new Map(birimler.map((b) => [`${b.stokId}|${b.ad}`, sayi(b.katsayi)]));
  return {
    kart,
    katsayi(stokId: string, ad: string): number | null {
      const k = kart.get(stokId);
      if (!k) return null;
      if (ad === k.anaBirim) return 1;
      const c = birim.get(`${stokId}|${ad}`);
      return c && c > 0 ? c : null;
    },
  };
}

/** Kabul edilebilecek belgeler: açık alış siparişleri ve işlenmemiş gelen e-İrsaliyeler. */
export async function malKabulKaynaklari(tx: Prisma.TransactionClient) {
  const [siparisler, eirsaliyeler] = await Promise.all([
    tx.belge.findMany({
      where: { tur: "siparis", yon: "alis", durum: { in: ["onaylandi", "kismen_kapandi"] } },
      orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], take: 50,
      select: { id: true, no: true, tarih: true, durum: true, cari: { select: { unvan: true } }, _count: { select: { satirlar: true } } },
    }),
    tx.gelenEirsaliye.findMany({
      where: { durum: { not: "ret" }, kendiSevkimiz: false, alisIrsaliyesi: { is: null } },
      orderBy: [{ tarih: "desc" }], take: 50,
      select: { id: true, belgeNo: true, tarih: true, gonderenUnvan: true },
    }),
  ]);
  return {
    siparisler: siparisler.map((b) => ({ id: b.id, no: b.no, tarih: gun(b.tarih), cariUnvan: b.cari.unvan, kismen: b.durum === "kismen_kapandi", satirSayisi: b._count.satirlar })),
    eirsaliyeler: eirsaliyeler.map((e) => ({ id: e.id, no: e.belgeNo, tarih: gun(e.tarih), cariUnvan: e.gonderenUnvan })),
  };
}

/** Siparişin teslim bekleyen satırları (kalan > 0). */
export async function siparisKabulBelgesi(tx: Prisma.TransactionClient, id: string): Promise<MalKabulBelgesi> {
  const belge = await tx.belge.findUnique({
    where: { id },
    select: {
      id: true, tur: true, yon: true, durum: true, no: true, tarih: true, cari: { select: { unvan: true } },
      satirlar: { select: { id: true, stokId: true, varyantId: true, birim: true, miktar: true, teslimEdilenMiktar: true, varyant: { select: { kod: true, ad: true } } } },
    },
  });
  if (!belge || belge.tur !== "siparis" || belge.yon !== "alis") throw new NotFoundException("Alış siparişi bulunamadı");
  if (!["onaylandi", "kismen_kapandi"].includes(belge.durum)) throw new BadRequestException("Sipariş teslim almaya açık değil (onaylı ya da kısmen teslim alınmış olmalı)");
  const k = await katsayilar(tx, [...new Set(belge.satirlar.map((s) => s.stokId))]);
  const satirlar: MalKabulSatiri[] = [];
  for (const s of belge.satirlar) {
    const kalan = sayi(s.miktar.sub(s.teslimEdilenMiktar));
    if (!(kalan > 0)) continue;
    const kart = k.kart.get(s.stokId);
    satirlar.push({
      anahtar: s.id, stokId: s.stokId, varyantId: s.varyantId,
      kod: s.varyant?.kod ?? kart?.kod ?? null,
      ad: kart ? (s.varyant ? `${kart.ad} · ${s.varyant.ad}` : kart.ad) : "Ürün",
      birim: s.birim, katsayi: k.katsayi(s.stokId, s.birim), beklenen: kalan, takipTipi: kart?.takipTipi ?? null,
    });
  }
  return { tur: "siparis", id: belge.id, no: belge.no, tarih: gun(belge.tarih), cariUnvan: belge.cari.unvan, engel: null, satirlar };
}

/** e-İrsaliye satırları, SAT-12 eşleşme önerisiyle; eşleşmeyen satır sahada kabul edilemez. */
export async function eirsaliyeKabulBelgesi(
  tx: Prisma.TransactionClient,
  eslesme: { id: string; belgeNo: string; tarih: string; gonderenUnvan: string; yanit: string; kendiSevkimiz: boolean; cari: { id: string } | null; cariUyarisi?: string | null; alisIrsaliyesi: unknown; satirlar: Array<{ siraNo: number; ad: string; miktar: string; birim: string; onerilenStokId: string | null; onerilenVaryantId: string | null }> },
): Promise<MalKabulBelgesi> {
  const engel = eslesme.alisIrsaliyesi ? "Bu e-İrsaliyeden zaten alış irsaliyesi oluşturulmuş."
    : eslesme.yanit === "ret" ? "Reddedilen e-İrsaliye kabul edilemez."
    : eslesme.kendiSevkimiz ? "Firmanın kendi sevk irsaliyesi."
    : !eslesme.cari ? `${eslesme.gonderenUnvan} cari olarak kayıtlı değil; cari panelde açılınca kabul edilir.`
    // Aynı VKN birden çok caride: hangi tedarikçi olduğuna sahada karar verilmez.
    : eslesme.cariUyarisi ? "Gönderenin VKN'si birden çok caride kayıtlı; panelde işlenir."
    : null;
  const stokIdler = [...new Set(eslesme.satirlar.map((s) => s.onerilenStokId).filter((x): x is string => Boolean(x)))];
  const k = await katsayilar(tx, stokIdler);
  return {
    tur: "eirsaliye", id: eslesme.id, no: eslesme.belgeNo, tarih: eslesme.tarih, cariUnvan: eslesme.gonderenUnvan, engel,
    satirlar: eslesme.satirlar.map((s) => {
      const kart = s.onerilenStokId ? k.kart.get(s.onerilenStokId) : undefined;
      return {
        anahtar: String(s.siraNo), stokId: kart?.id ?? null, varyantId: kart ? s.onerilenVaryantId : null, kod: kart?.kod ?? null,
        ad: s.ad, birim: s.birim, katsayi: kart ? k.katsayi(kart.id, s.birim) : null, beklenen: Number(s.miktar) || 0, takipTipi: kart?.takipTipi ?? null,
      };
    }),
  };
}
