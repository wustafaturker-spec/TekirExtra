import { Prisma } from "@prisma/client";
import { irsaliyeFaturaSuresi, irsaliyeSevkGunu } from "@tekirextra/shared";
import { stokKartiBul } from "../ebelge/stok-eslesme";
import type { UblIrsaliyeSatir } from "../ebelge/eirsaliye-ubl-oku";

/** Numaralar sağlayıcıya göre boşluk/büyük-küçük harf farkıyla gelebilir. */
export const belgeNoSadelestir = (no: string | null | undefined) => (no ?? "").replace(/\s+/g, "").toLocaleUpperCase("tr-TR");

/**
 * SAT-12: gelen e-İrsaliye satırlarına stok kartı önerisi. Gelen e-Faturadaki
 * sıra kullanılır (`stokKartiBul`); önerilen kartın birimleri de döner ki
 * ekran belgedeki birimin kartta tanımlı olup olmadığını söyleyebilsin.
 */
export async function irsaliyeSatirOnerileri(tx: Prisma.TransactionClient, tenantId: string, satirlar: UblIrsaliyeSatir[], cariId: string | null) {
  const sonuc = [];
  for (const [i, s] of satirlar.entries()) {
    const { stokId, kaynak } = await stokKartiBul(tx, tenantId, { ...s, ad: s.ad }, cariId);
    const stok = stokId
      ? await tx.stokKart.findUnique({ where: { id: stokId }, select: { id: true, kod: true, ad: true, anaBirim: true, birimler: { select: { ad: true } } } })
      : null;
    sonuc.push({
      siraNo: i + 1,
      ad: s.ad,
      saticiUrunKodu: s.saticiUrunKodu ?? null,
      barkod: s.barkod ?? null,
      miktar: s.miktar,
      birim: s.birimAdi || s.birim,
      onerilenStokId: stok?.id ?? null,
      onerilenStok: stok ? { id: stok.id, kod: stok.kod, ad: stok.ad, anaBirim: stok.anaBirim, birimler: stok.birimler.map((b) => b.ad) } : null,
      eslesmeKaynagi: kaynak,
    });
  }
  return sonuc;
}

/**
 * SAT-12: e-İrsaliyede fiyat yoktur. Satıra bu tedarikçinin karttaki fiyatı,
 * yoksa kartın alış fiyatı yazılır; ikisi de TL değilse sıfır kalır (fiyatı
 * fatura getirir, bağlamada fark olarak görünür).
 */
export async function irsaliyeAlisFiyati(tx: Prisma.TransactionClient, stokId: string, cariId: string): Promise<string> {
  const ted = await tx.stokTedarikci.findFirst({
    where: { stokId, cariId, alisFiyati: { not: null }, dovizCinsi: "TRY" },
    orderBy: [{ varsayilan: "desc" }],
    select: { alisFiyati: true },
  });
  if (ted?.alisFiyati) return ted.alisFiyati.toString();
  const kart = await tx.stokKart.findUnique({ where: { id: stokId }, select: { alisFiyati: true, alisFiyatiDoviz: true } });
  return kart?.alisFiyati && kart.alisFiyatiDoviz === "TRY" ? kart.alisFiyati.toString() : "0";
}

/**
 * SAT-13: gelen e-Faturanın `DespatchDocumentReference` numaralarına karşılık
 * gelen alış irsaliyeleri. Eşleşme tedarikçinin irsaliye numarasıyla
 * (`tedarikciBelgeNo`) ya da irsaliyenin kaynağı olan gelen e-İrsaliyenin
 * numarasıyla yapılır; aynı tedarikçi şartı vardır.
 */
export async function faturaIrsaliyeAdaylari(tx: Prisma.TransactionClient, tenantId: string, cariId: string, nolar: string[]) {
  const aranan = [...new Set(nolar.map(belgeNoSadelestir).filter(Boolean))];
  if (aranan.length === 0) return { eslesen: [], bulunamayan: [] as { no: string; durum: "baska_faturada" | "islenmemis_eirsaliye" | "yok" }[] };
  const irsaliyeler = await tx.belge.findMany({
    where: { tenantId, cariId, tur: "irsaliye", yon: "alis", durum: { in: ["onaylandi", "kapandi"] } },
    select: { id: true, no: true, durum: true, faturaId: true, tedarikciBelgeNo: true, gelenEirsaliye: { select: { belgeNo: true } } },
  });
  const eslesen: { id: string; no: string | null; tedarikciNo: string; faturaId: string | null }[] = [];
  const bulunamayan: { no: string; durum: "baska_faturada" | "islenmemis_eirsaliye" | "yok" }[] = [];
  for (const no of aranan) {
    const irs = irsaliyeler.find((b) => belgeNoSadelestir(b.tedarikciBelgeNo) === no || belgeNoSadelestir(b.gelenEirsaliye?.belgeNo) === no);
    if (irs) { eslesen.push({ id: irs.id, no: irs.no, tedarikciNo: no, faturaId: irs.faturaId }); continue; }
    // Bizde irsaliye yok: e-İrsaliye gelmiş ama alış irsaliyesine işlenmemiş olabilir.
    const gelen = await tx.gelenEirsaliye.findFirst({ where: { tenantId, belgeNo: { equals: no, mode: "insensitive" }, alisIrsaliyesi: null }, select: { id: true } });
    bulunamayan.push({ no, durum: gelen ? "islenmemis_eirsaliye" : "yok" });
  }
  return { eslesen, bulunamayan };
}

/** SAT-14 raporunun süzgeci: tarih aralığı belge tarihine uygulanır. */
export interface EslesmeRaporuSuzgeci {
  baslangic: string;
  bitis: string;
  cariId?: string;
}

/**
 * SAT-14: eşleşmeyen alış belgeleri. (1) faturası gelmemiş alış irsaliyeleri,
 * (2) alış irsaliyesine işlenmemiş gelen e-İrsaliyeler, (3) irsaliyesi
 * olmayan, mal içeren alış faturaları.
 */
export async function eslesmeRaporu(tx: Prisma.TransactionClient, tenantId: string, suzgec: EslesmeRaporuSuzgeci, gunSayisi: number, bugun: string) {
  const tarih = { gte: new Date(suzgec.baslangic), lte: new Date(suzgec.bitis) };
  const cari = suzgec.cariId ? { cariId: suzgec.cariId } : {};

  const irsaliyeler = await tx.belge.findMany({
    where: { tenantId, tur: "irsaliye", yon: "alis", durum: "onaylandi", faturaId: null, tarih, ...cari },
    orderBy: [{ tarih: "asc" }, { no: "asc" }],
    select: { id: true, no: true, tarih: true, fiiliSevkZamani: true, tedarikciBelgeNo: true, genelToplam: true, cari: { select: { id: true, unvan: true } }, gelenEirsaliye: { select: { belgeNo: true } } },
  });

  const vkn = suzgec.cariId ? (await tx.cariHesap.findUnique({ where: { id: suzgec.cariId }, select: { vknTckn: true } }))?.vknTckn : undefined;
  const gelenler = suzgec.cariId && !vkn ? [] : await tx.gelenEirsaliye.findMany({
    where: { tenantId, kendiSevkimiz: false, durum: { not: "ret" }, alisIrsaliyesi: null, tarih, ...(vkn ? { gonderenVkn: vkn } : {}) },
    orderBy: [{ tarih: "asc" }, { belgeNo: "asc" }],
    select: { id: true, belgeNo: true, tarih: true, sevkTarihi: true, gonderenUnvan: true, gonderenVkn: true, durum: true },
  });

  const faturalar = await tx.fatura.findMany({
    where: {
      tenantId, tip: "alis", durum: { in: ["taslak", "kesin"] }, tarih, ...cari,
      zincirBelgeleri: { none: { tur: "irsaliye" } },
      satirlar: { some: { stok: { tip: { not: "hizmet" } } } },
    },
    orderBy: [{ tarih: "asc" }, { no: "asc" }],
    select: { id: true, no: true, tarih: true, durum: true, genelToplam: true, dovizCinsi: true, cari: { select: { id: true, unvan: true } } },
  });

  return {
    faturasiGelmemisIrsaliyeler: irsaliyeler.map((b) => {
      const sure = irsaliyeFaturaSuresi({ sevkGunu: irsaliyeSevkGunu(b), bugun, gunSayisi });
      return {
        id: b.id, no: b.no, tedarikciBelgeNo: b.tedarikciBelgeNo ?? b.gelenEirsaliye?.belgeNo ?? null, tarih: b.tarih.toISOString().slice(0, 10),
        cari: b.cari, tutar: b.genelToplam.toFixed(2), sonGun: sure.sonGun, kalanGun: sure.kalanGun, gecti: sure.gecti,
      };
    }),
    islenmemisEirsaliyeler: gelenler.map((g) => ({
      id: g.id, belgeNo: g.belgeNo, tarih: g.tarih.toISOString().slice(0, 10), sevkTarihi: g.sevkTarihi.toISOString().slice(0, 10),
      gonderenUnvan: g.gonderenUnvan, gonderenVkn: g.gonderenVkn, yanit: g.durum,
    })),
    irsaliyesizFaturalar: faturalar.map((f) => ({
      id: f.id, no: f.no, tarih: f.tarih.toISOString().slice(0, 10), durum: f.durum, cari: f.cari, genelToplam: f.genelToplam.toFixed(2), dovizCinsi: f.dovizCinsi,
    })),
    faturalamaGunSayisi: gunSayisi,
  };
}
