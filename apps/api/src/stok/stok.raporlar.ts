import { Prisma } from "@prisma/client";
import { registerRapor } from "../core/raporlar/rapor-kayit";

/** Stok modülü raporları (STK-13) — RPR-06 araç seti tanımları. */

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);

const tarihAraligi = (baslangic?: unknown, bitis?: unknown) => ({
  ...(baslangic ? { gte: new Date(String(baslangic)) } : {}),
  ...(bitis ? { lte: new Date(String(bitis)) } : {}),
});

const TARIH_FILTRELERI = [
  { alan: "baslangic", ad: "Başlangıç", tip: "tarih" as const },
  { alan: "bitis", ad: "Bitiş", tip: "tarih" as const },
];

/** Tarih aralığındaki kesin satış satırlarını stok bilgisiyle çeker. */
async function satisSatirlari(
  tx: Prisma.TransactionClient,
  baslangic?: unknown,
  bitis?: unknown,
) {
  return tx.faturaSatir.findMany({
    where: {
      fatura: {
        tip: "satis",
        durum: "kesin",
        tarih: tarihAraligi(baslangic, bitis),
      },
    },
    select: {
      stokId: true,
      miktar: true,
      matrah: true,
      fatura: { select: { kur: true } },
      stok: {
        select: {
          kod: true,
          ad: true,
          mevcutMiktar: true,
          ortalamaMaliyet: true,
        },
      },
    },
  });
}

// ─── Envanter değeri (STK-03) ───────────────────────────────────────────────

registerRapor({
  kod: "stok.envanter",
  modul: "stok",
  ad: "Envanter Değeri",
  aciklama: "Anlık stok miktarı ve ağırlıklı ortalama maliyetle envanter değeri",
  filtreler: [{ alan: "kritikAlti", ad: "Yalnız kritik altı", tip: "onay" }],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "miktar", baslik: "Miktar", tip: "sayi" },
    { alan: "ortalamaMaliyet", baslik: "Ort. Maliyet", tip: "para" },
    { alan: "envanterDegeri", baslik: "Envanter Değeri", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, tip: "urun" },
      orderBy: { kod: "asc" },
    });
    return kartlar
      .filter(
        (k) =>
          !girdi.filtreler?.kritikAlti ||
          (k.kritikSeviye !== null && k.mevcutMiktar.lessThan(k.kritikSeviye)),
      )
      .map((k) => ({
        kod: k.kod,
        ad: k.ad,
        birim: k.anaBirim,
        miktar: Number(k.mevcutMiktar),
        ortalamaMaliyet: k.ortalamaMaliyet.toFixed(2),
        envanterDegeri: k.mevcutMiktar.mul(k.ortalamaMaliyet).toFixed(2),
      }));
  },
});

// ─── Stok hareket özeti ─────────────────────────────────────────────────────

registerRapor({
  kod: "stok.hareket-ozeti",
  modul: "stok",
  ad: "Stok Hareket Özeti",
  aciklama: "Tarih aralığında giriş/çıkış/sayım düzeltme toplamları (ana birim)",
  filtreler: [...TARIH_FILTRELERI, { alan: "stok", ad: "Ürün", tip: "stok" }],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "giris", baslik: "Giriş", tip: "sayi" },
    { alan: "cikis", baslik: "Çıkış", tip: "sayi" },
    { alan: "duzeltme", baslik: "Sayım Düzeltme", tip: "sayi" },
    { alan: "net", baslik: "Net Değişim", tip: "sayi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hareketler = await tx.stokHareket.findMany({
      where: {
        tarih: tarihAraligi(f.baslangic, f.bitis),
        ...(f.stok ? { stokId: String(f.stok) } : {}),
      },
      select: {
        stokId: true,
        tip: true,
        miktar: true,
        stok: { select: { kod: true, ad: true } },
      },
    });
    const gruplar = new Map<
      string,
      { kod: string; ad: string; giris: number; cikis: number; duzeltme: number }
    >();
    for (const h of hareketler) {
      const g = gruplar.get(h.stokId) ?? {
        kod: h.stok.kod,
        ad: h.stok.ad,
        giris: 0,
        cikis: 0,
        duzeltme: 0,
      };
      const m = Number(h.miktar);
      if (h.tip === "giris") g.giris += m;
      else if (h.tip === "cikis") g.cikis += m;
      else g.duzeltme += m;
      gruplar.set(h.stokId, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => a.kod.localeCompare(b.kod, "tr"))
      .map((g) => ({ ...g, net: g.giris - g.cikis + g.duzeltme }));
  },
});

// ─── En çok / en az satanlar ────────────────────────────────────────────────

registerRapor({
  kod: "stok.en-cok-satanlar",
  modul: "stok",
  ad: "En Çok / En Az Satanlar",
  aciklama: "Kesin satış faturalarına göre miktar ve ciro sıralaması",
  filtreler: [
    ...TARIH_FILTRELERI,
    {
      alan: "yon",
      ad: "Sıralama",
      tip: "secim",
      secenekler: [
        { deger: "cok", ad: "En çok satan" },
        { deger: "az", ad: "En az satan" },
      ],
    },
    { alan: "adet", ad: "Kayıt Sayısı", tip: "sayi" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "miktar", baslik: "Satılan Miktar", tip: "sayi" },
    { alan: "ciro", baslik: "Ciro (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await satisSatirlari(tx, f.baslangic, f.bitis);
    const gruplar = new Map<
      string,
      { kod: string; ad: string; miktar: number; ciro: Prisma.Decimal }
    >();
    for (const s of satirlar) {
      const g = gruplar.get(s.stokId) ?? {
        kod: s.stok.kod,
        ad: s.stok.ad,
        miktar: 0,
        ciro: D(0),
      };
      g.miktar += Number(s.miktar);
      g.ciro = g.ciro.add(s.matrah.mul(s.fatura.kur));
      gruplar.set(s.stokId, g);
    }
    const adet = typeof f.adet === "number" && f.adet > 0 ? f.adet : 20;
    const isaret = f.yon === "az" ? 1 : -1;
    return [...gruplar.values()]
      .sort((a, b) => isaret * (a.miktar - b.miktar))
      .slice(0, adet)
      .map((g) => ({
        kod: g.kod,
        ad: g.ad,
        miktar: g.miktar,
        ciro: g.ciro.toFixed(2),
      }));
  },
});

// ─── Stok devir hızı ────────────────────────────────────────────────────────

registerRapor({
  kod: "stok.devir-hizi",
  modul: "stok",
  ad: "Stok Devir Hızı",
  aciklama:
    "Dönem satış miktarının mevcut stoğa oranı; stok tükenme süresi tahmini",
  filtreler: TARIH_FILTRELERI,
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "satilanMiktar", baslik: "Dönem Satışı", tip: "sayi" },
    { alan: "mevcutMiktar", baslik: "Mevcut Stok", tip: "sayi" },
    { alan: "devirHizi", baslik: "Devir Hızı", tip: "sayi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await satisSatirlari(tx, f.baslangic, f.bitis);
    const gruplar = new Map<
      string,
      { kod: string; ad: string; satilan: number; mevcut: number }
    >();
    for (const s of satirlar) {
      const g = gruplar.get(s.stokId) ?? {
        kod: s.stok.kod,
        ad: s.stok.ad,
        satilan: 0,
        mevcut: Number(s.stok.mevcutMiktar),
      };
      g.satilan += Number(s.miktar);
      gruplar.set(s.stokId, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => b.satilan - a.satilan)
      .map((g) => ({
        kod: g.kod,
        ad: g.ad,
        satilanMiktar: g.satilan,
        mevcutMiktar: g.mevcut,
        devirHizi:
          g.mevcut > 0 ? Math.round((g.satilan / g.mevcut) * 100) / 100 : null,
      }));
  },
});

// ─── Ürün bazlı kârlılık (STK-08 ağırlıklı ortalama maliyet) ────────────────

registerRapor({
  kod: "stok.urun-karlilik",
  modul: "stok",
  ad: "Ürün Bazlı Kârlılık",
  aciklama: "Satış matrahı ile ağırlıklı ortalama maliyet farkından kâr marjı",
  filtreler: TARIH_FILTRELERI,
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "satilanMiktar", baslik: "Miktar", tip: "sayi" },
    { alan: "ciro", baslik: "Ciro (TL)", tip: "para" },
    { alan: "maliyet", baslik: "Maliyet (TL)", tip: "para" },
    { alan: "kar", baslik: "Kâr (TL)", tip: "para" },
    { alan: "marj", baslik: "Marj", tip: "yuzde" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await satisSatirlari(tx, f.baslangic, f.bitis);
    const gruplar = new Map<
      string,
      { kod: string; ad: string; miktar: number; ciro: Prisma.Decimal; maliyet: Prisma.Decimal }
    >();
    for (const s of satirlar) {
      const g = gruplar.get(s.stokId) ?? {
        kod: s.stok.kod,
        ad: s.stok.ad,
        miktar: 0,
        ciro: D(0),
        maliyet: D(0),
      };
      g.miktar += Number(s.miktar);
      g.ciro = g.ciro.add(s.matrah.mul(s.fatura.kur));
      g.maliyet = g.maliyet.add(s.stok.ortalamaMaliyet.mul(s.miktar));
      gruplar.set(s.stokId, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => a.kod.localeCompare(b.kod, "tr"))
      .map((g) => {
        const kar = g.ciro.sub(g.maliyet);
        return {
          kod: g.kod,
          ad: g.ad,
          satilanMiktar: g.miktar,
          ciro: g.ciro.toFixed(2),
          maliyet: g.maliyet.toFixed(2),
          kar: kar.toFixed(2),
          marj: g.ciro.greaterThan(0)
            ? kar.div(g.ciro).mul(100).toDecimalPlaces(2).toNumber()
            : null,
        };
      });
  },
});

// ─── Kritik stok listesi (STK-04) ───────────────────────────────────────────

registerRapor({
  kod: "stok.kritik-stok",
  modul: "stok",
  ad: "Kritik Stok Listesi",
  aciklama: "Mevcut miktarı kritik seviyenin altına düşen ürünler",
  filtreler: [],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "kritikSeviye", baslik: "Kritik Seviye", tip: "sayi" },
    { alan: "eksik", baslik: "Eksik", tip: "sayi" },
  ],
  async calistir(_girdi, { tx }) {
    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, kritikSeviye: { not: null } },
      orderBy: { kod: "asc" },
    });
    return kartlar
      .filter((k) => k.kritikSeviye && k.mevcutMiktar.lessThan(k.kritikSeviye))
      .map((k) => ({
        kod: k.kod,
        ad: k.ad,
        mevcut: Number(k.mevcutMiktar),
        kritikSeviye: Number(k.kritikSeviye),
        eksik: Number(D(k.kritikSeviye ?? 0).sub(k.mevcutMiktar)),
      }));
  },
});
