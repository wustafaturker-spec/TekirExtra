import { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { FINANS_ROLLERI, registerRapor } from "../core/raporlar/rapor-kayit";
import { bilinenMarj, satisSatirlari, urunBazinda } from "./satis-ozeti";
import { tarihliBakiyeler } from "./tarihli-envanter";
import { iptalCiftiMi, iptalEdilmisFaturalar, iptalleriGoster } from "../fatura/iptal-cifti";

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

/**
 * Hareket türlerinin giriş/çıkış kovaları (STK-19, StokService ile uyumlu).
 * Depolar arası transfer (STK-07) ayrı kovadadır: firma toplamında alım/satım
 * gibi görünmemesi için giriş/çıkışa karışmaz.
 */
const GIRIS_TURLERI = new Set(["giris", "acilis"]);
const CIKIS_TURLERI = new Set(["cikis", "fire", "zayi", "numune", "promosyon"]);
const TRANSFER_TURLERI = new Set(["transfer_giris", "transfer_cikis"]);

/** Bugünden `gun` gün öncesinin YYYY-MM-DD karşılığı. */
const gunOnce = (gun: number): string =>
  new Date(Date.now() - gun * 86_400_000).toISOString().slice(0, 10);

/** STK-32: tarih aralığındaki ürün bazında satış (iade düşülmüş, maliyet hareketlerden). */
const urunSatislari = async (tx: Prisma.TransactionClient, baslangic?: unknown, bitis?: unknown) =>
  urunBazinda(await satisSatirlari(tx, tarihAraligi(baslangic, bitis)));

// ─── Envanter değeri (STK-03) ───────────────────────────────────────────────

registerRapor({
  kod: "stok.envanter",
  modul: "stok",
  ad: "Envanter Değeri",
  aciklama: "Anlık ya da seçilen tarih itibarıyla stok miktarı ve ağırlıklı ortalama maliyetle envanter değeri",
  filtreler: [
    // STK-37: boşsa anlık; doluysa o gün sonu itibarıyla hareketlerden.
    { alan: "tarih", ad: "Tarih itibarıyla", tip: "tarih" },
    { alan: "kritikAlti", ad: "Yalnız kritik altı", tip: "onay" },
    { alan: "depo", ad: "Depo", tip: "depo" },
    // RPR-22 (inceleme P2-7): varyantlı ürün her varyantıyla ayrı satır.
    { alan: "varyantlar", ad: "Varyantları ayrı göster", tip: "onay" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "depo", baslik: "Depo", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "miktar", baslik: "Miktar", tip: "sayi" },
    { alan: "rezerve", baslik: "Rezerve", tip: "sayi" },
    { alan: "kullanilabilir", baslik: "Kullanılabilir", tip: "sayi" },
    { alan: "yoldaki", baslik: "Yoldaki", tip: "sayi" },
    { alan: "ortalamaMaliyet", baslik: "Ort. Maliyet", tip: "para" },
    { alan: "envanterDegeri", baslik: "Envanter Değeri", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const depoId = girdi.filtreler?.depo ? String(girdi.filtreler.depo) : null;
    const tarih = girdi.filtreler?.tarih ? String(girdi.filtreler.tarih) : "";
    const satirlar = tarih
      ? await tarihliEnvanter(tx, tarih, depoId, Boolean(girdi.filtreler?.kritikAlti))
      : await anlikEnvanter(tx, depoId, Boolean(girdi.filtreler?.kritikAlti));
    // RPR-27: stokId satırda kalır (kod sütunu stok kartına bağlantı).
    if (!girdi.filtreler?.varyantlar) return satirlar;
    return varyantKirilimi(satirlar, await varyantMiktarlari(tx, satirlar.map((r) => r.stokId), depoId, tarih));
  },
});

/** Anlık envanter (kart ya da depo bakiyesinden). */
async function anlikEnvanter(tx: Prisma.TransactionClient, depoId: string | null, kritikAlti: boolean): Promise<EnvanterSatiri[]> {
  {
    const kartlar = await tx.stokKart.findMany({
      // STK-33: hizmet stok tutmaz; sarf malzeme değerli stoktur.
      where: { aktif: true, tip: { not: "hizmet" } },
      orderBy: { kod: "asc" },
    });

    // Depo seçiliyse miktarlar o deponun bakiyesinden okunur (STK-07);
    // seçili değilse kart üzerindeki firma toplamı kullanılır.
    const bakiyeler = depoId
      ? new Map(
          (await tx.stokDepoBakiye.findMany({ where: { depoId } })).map((b) => [
            b.stokId,
            b,
          ]),
        )
      : null;
    const depoAd = depoId
      ? ((await tx.depo.findUnique({ where: { id: depoId } }))?.ad ?? "")
      : "Tüm depolar";

    return kartlar
      .map((k) => {
        const b = bakiyeler?.get(k.id);
        const mevcut = bakiyeler ? D(b?.mevcutMiktar ?? 0) : k.mevcutMiktar;
        const rezerve = bakiyeler ? D(b?.rezerveMiktar ?? 0) : k.rezerveMiktar;
        const yoldaki = bakiyeler ? D(b?.yoldakiMiktar ?? 0) : k.yoldakiMiktar;
        return { k, mevcut, rezerve, yoldaki };
      })
      .filter(
        ({ k, mevcut }) =>
          !kritikAlti ||
          (k.kritikSeviye !== null && mevcut.lessThan(k.kritikSeviye)),
      )
      .map(({ k, mevcut, rezerve, yoldaki }) => ({
        kod: k.kod,
        ad: k.ad,
        depo: depoAd,
        birim: k.anaBirim,
        miktar: Number(mevcut),
        rezerve: Number(rezerve),
        kullanilabilir: Number(mevcut.sub(rezerve)),
        yoldaki: Number(yoldaki),
        ortalamaMaliyet: k.ortalamaMaliyet.toFixed(2),
        envanterDegeri: degerle(mevcut, k.ortalamaMaliyet),
        stokId: k.id,
      }));
  }
}

/** RPR-22: eksi stok değerlenmez (panel özetiyle aynı kural, RPR-15); toplam satırına girmez. */
const degerle = (miktar: Prisma.Decimal, ortalama: Prisma.Decimal) => (miktar.lt(0) ? null : miktar.mul(ortalama).toFixed(2));

interface VaryantMiktari { varyantId: string; kod: string; ad: string; miktar: Prisma.Decimal; rezerve: Prisma.Decimal | null; yoldaki: Prisma.Decimal | null }

/** Kartların varyant miktarları: anlık varyant/depo bakiyesinden, tarihli o güne kadarki hareketlerden. */
async function varyantMiktarlari(tx: Prisma.TransactionClient, stokIdler: string[], depoId: string | null, tarih: string): Promise<Map<string, VaryantMiktari[]>> {
  const varyantlar = await tx.stokVaryant.findMany({ where: { stokId: { in: stokIdler } }, select: { id: true, stokId: true, kod: true, ad: true, mevcutMiktar: true, rezerveMiktar: true, yoldakiMiktar: true }, orderBy: { kod: "asc" } });
  if (!varyantlar.length) return new Map();
  let miktarlar: Map<string, { miktar: Prisma.Decimal; rezerve: Prisma.Decimal | null; yoldaki: Prisma.Decimal | null }>;
  if (tarih) {
    const gruplar = await tx.stokHareket.groupBy({ by: ["varyantId"], where: { varyantId: { in: varyantlar.map((v) => v.id) }, tarih: { lte: new Date(tarih) }, ...(depoId ? { depoId } : {}) }, _sum: { miktar: true } });
    miktarlar = new Map(gruplar.map((g) => [g.varyantId!, { miktar: D(g._sum.miktar ?? 0), rezerve: null, yoldaki: null }]));
  } else if (depoId) {
    const b = await tx.stokVaryantDepoBakiye.findMany({ where: { depoId, varyantId: { in: varyantlar.map((v) => v.id) } } });
    miktarlar = new Map(b.map((x) => [x.varyantId, { miktar: x.mevcutMiktar, rezerve: x.rezerveMiktar, yoldaki: x.yoldakiMiktar }]));
  } else {
    miktarlar = new Map(varyantlar.map((v) => [v.id, { miktar: v.mevcutMiktar, rezerve: v.rezerveMiktar, yoldaki: v.yoldakiMiktar }]));
  }
  const sonuc = new Map<string, VaryantMiktari[]>();
  for (const v of varyantlar) {
    const m = miktarlar.get(v.id) ?? { miktar: D(0), rezerve: tarih ? null : D(0), yoldaki: tarih ? null : D(0) };
    sonuc.set(v.stokId, [...(sonuc.get(v.stokId) ?? []), { varyantId: v.id, kod: v.kod, ad: v.ad, ...m }]);
  }
  return sonuc;
}

type EnvanterSatiri = {
  kod: string; ad: string; depo: string; birim: string; miktar: number;
  rezerve: number | null; kullanilabilir: number | null; yoldaki: number | null;
  ortalamaMaliyet: string; envanterDegeri: string | null; stokId: string;
};

/**
 * Varyantlı kartın satırı varyant satırlarına bölünür (maliyet kart düzeyinde
 * tutulduğu için kartın ortalaması); varyantsız kalan miktar ayrı satır olur.
 * Miktarı sıfır varyant yazılmaz.
 */
export function varyantKirilimi(satirlar: EnvanterSatiri[], varyantlar: Map<string, VaryantMiktari[]>) {
  const sayi = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
  return satirlar.flatMap((r) => {
    const liste = (varyantlar.get(r.stokId) ?? []).filter((v) => !v.miktar.isZero());
    if (!liste.length) return [r];
    const ortalama = D(r.ortalamaMaliyet);
    const satir = (kod: string, ad: string, miktar: Prisma.Decimal, rezerve: Prisma.Decimal | null, yoldaki: Prisma.Decimal | null) => ({
      ...r, kod, ad, miktar: Number(miktar), rezerve: sayi(rezerve), yoldaki: sayi(yoldaki),
      kullanilabilir: rezerve === null ? null : Number(miktar.sub(rezerve)), envanterDegeri: degerle(miktar, ortalama),
    });
    const kalan = D(r.miktar).sub(liste.reduce((t, v) => t.add(v.miktar), D(0)));
    return [
      ...liste.map((v) => satir(`${r.kod} / ${v.kod}`, `${r.ad} — ${v.ad}`, v.miktar, v.rezerve, v.yoldaki)),
      ...(kalan.isZero() ? [] : [satir(r.kod, `${r.ad} — varyantsız`, kalan, r.rezerve === null ? null : D(0), r.yoldaki === null ? null : D(0))]),
    ];
  });
}

/**
 * STK-37: tarih itibarıyla envanter. Rezerve ve yoldaki miktar geçmişte
 * tutulmadığı için boş döner. Bugün pasif olan kart o gün stoklu ise listelenir.
 */
async function tarihliEnvanter(tx: Prisma.TransactionClient, tarih: string, depoId: string | null, kritikAlti: boolean): Promise<EnvanterSatiri[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) throw new BadRequestException("Tarih YYYY-AA-GG biçiminde olmalı");
  const hareketler = await tx.stokHareket.findMany({
    where: { tarih: { lte: new Date(tarih) }, stok: { tip: { not: "hizmet" } } },
    orderBy: [{ stokId: "asc" }, { tarih: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, stokId: true, depoId: true, miktar: true, maliyet: true, kaynakTur: true, kaynakRef: true },
  });
  const refler = [...new Set(hareketler.filter((h) => h.kaynakTur === "fatura" && h.kaynakRef && h.miktar.lt(0)).map((h) => h.kaynakRef!))];
  const alisIadeleri = new Set(refler.length
    ? (await tx.fatura.findMany({ where: { id: { in: refler }, tip: "alis_iade" }, select: { id: true } })).map((f) => f.id)
    : []);
  const bakiyeler = tarihliBakiyeler(hareketler, alisIadeleri);
  const kartlar = await tx.stokKart.findMany({ where: { tip: { not: "hizmet" } }, orderBy: { kod: "asc" } });
  const depoAd = depoId ? ((await tx.depo.findUnique({ where: { id: depoId } }))?.ad ?? "") : "Tüm depolar";
  return kartlar.flatMap((k) => {
    const b = bakiyeler.get(k.id);
    const miktar = b ? (depoId ? (b.depoMiktarlari.get(depoId) ?? D(0)) : b.miktar) : D(0);
    if (!k.aktif && miktar.isZero()) return [];
    if (kritikAlti && !(k.kritikSeviye !== null && miktar.lessThan(k.kritikSeviye))) return [];
    const ortalama = b?.ortalama ?? D(0);
    return [{
      kod: k.kod,
      ad: k.ad,
      depo: depoAd,
      birim: k.anaBirim,
      miktar: Number(miktar),
      rezerve: null,
      kullanilabilir: null,
      yoldaki: null,
      ortalamaMaliyet: ortalama.toFixed(2),
      envanterDegeri: degerle(miktar, ortalama),
      stokId: k.id,
    }];
  });
}

// ─── Stok hareket özeti ─────────────────────────────────────────────────────

registerRapor({
  kod: "stok.hareket-ozeti",
  modul: "stok",
  ad: "Stok Hareket Özeti",
  aciklama:
    "Tarih aralığında giriş (açılış dahil) / çıkış (fire, zayi, numune, promosyon dahil) / sayım düzeltme / depo transferi toplamları (ana birim)",
  filtreler: [
    ...TARIH_FILTRELERI,
    { alan: "stok", ad: "Ürün", tip: "stok" },
    { alan: "depo", ad: "Depo", tip: "depo" },
    { alan: "iptaller", ad: "İptalleri de göster", tip: "onay" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "giris", baslik: "Giriş", tip: "sayi" },
    { alan: "cikis", baslik: "Çıkış", tip: "sayi" },
    { alan: "duzeltme", baslik: "Sayım Düzeltme", tip: "sayi" },
    { alan: "transfer", baslik: "Depo Transferi", tip: "sayi" },
    { alan: "net", baslik: "Net Değişim", tip: "sayi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hareketler = await tx.stokHareket.findMany({
      where: {
        tarih: tarihAraligi(f.baslangic, f.bitis),
        ...(f.stok ? { stokId: String(f.stok) } : {}),
        ...(f.depo ? { depoId: String(f.depo) } : {}),
      },
      select: {
        stokId: true,
        tip: true,
        miktar: true,
        kaynakTur: true,
        kaynakRef: true,
        stok: { select: { kod: true, ad: true } },
      },
    });
    // STK-22: iptal edilmiş faturanın hareketleri net değişimi etkilemez ama
    // giriş ve çıkış sütunlarını şişirir; seçenek işaretlenmedikçe sayılmaz.
    const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
    const iptalleriSay = iptalleriGoster(f.iptaller);
    const gruplar = new Map<
      string,
      {
        stokId: string;
        kod: string;
        ad: string;
        giris: number;
        cikis: number;
        duzeltme: number;
        transfer: number;
      }
    >();
    for (const h of hareketler) {
      if (!iptalleriSay && iptalCiftiMi(h, iptaller)) continue;
      const g = gruplar.get(h.stokId) ?? {
        stokId: h.stokId,
        kod: h.stok.kod,
        ad: h.stok.ad,
        giris: 0,
        cikis: 0,
        duzeltme: 0,
        transfer: 0,
      };
      // miktar imzalı saklanır (çıkış türleri negatif). Kovalar işaretle
      // toplanır, mutlak değerle değil: işareti tipine uymayan hareket (fatura
      // iptalinin eskiden yazdığı eksi girişler) mutlak alınınca giriş sayılıp
      // net değişimi stok bakiyesinden saptırıyordu. Doğru veride sonuç aynı.
      const m = Number(h.miktar);
      if (GIRIS_TURLERI.has(h.tip)) g.giris += m;
      else if (CIKIS_TURLERI.has(h.tip)) g.cikis -= m;
      // Transfer imzalı toplanır: depo süzgeci yoksa firma genelinde sıfırlanır
      else if (TRANSFER_TURLERI.has(h.tip)) g.transfer += m;
      else g.duzeltme += m;
      gruplar.set(h.stokId, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => a.kod.localeCompare(b.kod, "tr"))
      .map((g) => ({
        ...g,
        net: g.giris - g.cikis + g.duzeltme + g.transfer,
      }));
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
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "miktar", baslik: "Satılan Miktar", tip: "sayi" },
    { alan: "ciro", baslik: "Ciro (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gruplar = (await urunSatislari(tx, f.baslangic, f.bitis)).map((g) => ({ stokId: g.stokId, kod: g.kod, ad: g.ad, miktar: g.miktar.toNumber(), ciro: g.ciro }));
    const adet = typeof f.adet === "number" && f.adet > 0 ? f.adet : 20;
    const isaret = f.yon === "az" ? 1 : -1;
    return gruplar
      .sort((a, b) => isaret * (a.miktar - b.miktar))
      .slice(0, adet)
      .map((g) => ({
        stokId: g.stokId,
        kod: g.kod,
        ad: g.ad,
        miktar: g.miktar,
        ciro: g.ciro.toFixed(2),
      }));
  },
});

// ─── Stok devir hızı ────────────────────────────────────────────────────────

/**
 * RPR-18 (inceleme P2-3): devir hızı = dönem satış miktarı ÷ ortalama stok
 * ((dönem başı + dönem sonu) / 2), miktarlar ana birimde. Eskiden payda
 * bugünkü stoktu ve yalnız satılan ürünler listeleniyordu; dönmeyen stok
 * (asıl bakılması gereken) görünmüyordu.
 */
export function devirHesabi(satilan: number, donemBasi: number, donemSonu: number, gun: number) {
  const ortalama = (Math.max(donemBasi, 0) + Math.max(donemSonu, 0)) / 2;
  const devir = ortalama > 0 ? Math.round((satilan / ortalama) * 100) / 100 : null;
  return { ortalama, devir, stoktaGun: devir && devir > 0 ? Math.round(gun / devir) : null };
}

registerRapor({
  kod: "stok.devir-hizi",
  modul: "stok",
  ad: "Stok Devir Hızı",
  aciklama:
    "Dönem satışının ortalama stoğa ((dönem başı + dönem sonu) / 2) oranı ve stokta kalma süresi; hiç satılmayan stoklu ürünler de listelenir (devir 0)",
  filtreler: TARIH_FILTRELERI.map((f) => ({ ...f, zorunlu: true })),
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "donemBasi", baslik: "Dönem Başı Stok", tip: "sayi" },
    { alan: "donemSonu", baslik: "Dönem Sonu Stok", tip: "sayi" },
    { alan: "ortalamaStok", baslik: "Ortalama Stok", tip: "sayi" },
    { alan: "satilanMiktar", baslik: "Dönem Satışı", tip: "sayi" },
    { alan: "smm", baslik: "Satılan Malın Maliyeti", tip: "para", toplam: true },
    { alan: "devirHizi", baslik: "Devir Hızı", tip: "sayi" },
    { alan: "stoktaGun", baslik: "Stokta Kalma (gün)", tip: "sayi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const baslangic = new Date(String(f.baslangic)), bitis = new Date(String(f.bitis));
    const gun = Math.round((bitis.getTime() - baslangic.getTime()) / 86_400_000) + 1;
    const bakiye = async (tarih: Prisma.DateTimeFilter) =>
      new Map((await tx.stokHareket.groupBy({ by: ["stokId"], where: { tarih }, _sum: { miktar: true } }))
        .map((g) => [g.stokId, Number(g._sum.miktar ?? 0)]));
    const [basi, sonu, satislar, kartlar] = await Promise.all([
      bakiye({ lt: baslangic }),
      bakiye({ lte: bitis }),
      urunSatislari(tx, f.baslangic, f.bitis),
      tx.stokKart.findMany({ where: { tip: { not: "hizmet" } }, select: { id: true, kod: true, ad: true, anaBirim: true } }),
    ]);
    const satis = new Map(satislar.map((g) => [g.stokId, g]));
    return kartlar
      .map((k) => {
        const s = satis.get(k.id);
        const donemBasi = basi.get(k.id) ?? 0, donemSonu = sonu.get(k.id) ?? 0, satilan = s ? s.miktar.toNumber() : 0;
        const h = devirHesabi(satilan, donemBasi, donemSonu, gun);
        return {
          kod: k.kod, ad: k.ad, birim: k.anaBirim, donemBasi, donemSonu, ortalamaStok: h.ortalama,
          satilanMiktar: satilan, smm: s ? s.maliyet.toFixed(2) : "0.00", devirHizi: satilan > 0 ? h.devir : (h.ortalama > 0 ? 0 : null),
          stoktaGun: h.stoktaGun,
        };
      })
      // Stoğu da satışı da olmayan kart gürültüdür.
      .filter((r) => r.satilanMiktar !== 0 || r.ortalamaStok > 0)
      // Dönmeyen stok önce: devir küçükten büyüğe, devirsizler (stoksuz satış) sonda.
      .sort((a, b) => (a.devirHizi ?? Infinity) - (b.devirHizi ?? Infinity) || b.ortalamaStok - a.ortalamaStok);
  },
});

// ─── Ürün bazlı kârlılık (STK-08 ağırlıklı ortalama maliyet) ────────────────

registerRapor({
  kod: "stok.urun-karlilik",
  modul: "stok",
  ad: "Ürün Bazlı Kârlılık",
  aciklama: "Satış matrahı (TL) ile satış anındaki ağırlıklı ortalama maliyet farkından kâr marjı; satış iadeleri düşülür",
  // RPR-11: kâr bilgisi; satış/depo rolleri görmez.
  roller: [...FINANS_ROLLERI, "maliyet_muhasebesi"],
  filtreler: TARIH_FILTRELERI,
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "satilanMiktar", baslik: "Miktar", tip: "sayi" },
    { alan: "ciro", baslik: "Ciro (TL)", tip: "para", toplam: true },
    { alan: "maliyet", baslik: "Maliyet (TL)", tip: "para", toplam: true },
    { alan: "kar", baslik: "Kâr (TL)", tip: "para", toplam: true },
    { alan: "marj", baslik: "Marj", tip: "yuzde" },
    { alan: "maliyetsizCiro", baslik: "Maliyeti Bilinmeyen Ciro (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gruplar = (await urunSatislari(tx, f.baslangic, f.bitis)).map((g) => ({ stokId: g.stokId, kod: g.kod, ad: g.ad, miktar: g.miktar.toNumber(), ciro: g.ciro, maliyet: g.maliyet, maliyetsizCiro: g.maliyetsizCiro }));
    return gruplar
      .sort((a, b) => a.kod.localeCompare(b.kod, "tr"))
      .map((g) => {
        const kar = g.ciro.sub(g.maliyet);
        return {
          stokId: g.stokId,
          kod: g.kod,
          ad: g.ad,
          satilanMiktar: g.miktar,
          ciro: g.ciro.toFixed(2),
          maliyet: g.maliyet.toFixed(2),
          kar: kar.toFixed(2),
          // RPR-13: maliyeti bilinmeyen satış %100 marj sayılmaz.
          marj: bilinenMarj(g.ciro, g.maliyet, g.maliyetsizCiro),
          maliyetsizCiro: g.maliyetsizCiro.toFixed(2),
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
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "kritikSeviye", baslik: "Kritik Seviye", tip: "sayi" },
    { alan: "eksik", baslik: "Eksik", tip: "sayi" },
  ],
  async calistir(_girdi, { tx }) {
    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, kritikSeviye: { not: null }, tip: { not: "hizmet" } },
      orderBy: { kod: "asc" },
    });
    return kartlar
      .filter((k) => k.kritikSeviye && k.mevcutMiktar.lessThan(k.kritikSeviye))
      .map((k) => ({
        stokId: k.id,
        kod: k.kod,
        ad: k.ad,
        mevcut: Number(k.mevcutMiktar),
        kritikSeviye: Number(k.kritikSeviye),
        eksik: Number(D(k.kritikSeviye ?? 0).sub(k.mevcutMiktar)),
      }));
  },
});

// ─── Sipariş önerisi (STK-16, STK-18) ───────────────────────────────────────

registerRapor({
  kod: "stok.siparis-onerisi",
  modul: "stok",
  ad: "Sipariş Önerisi",
  aciklama:
    "Yeniden sipariş noktası (ort. günlük satış × tedarik süresi + güvenlik stoğu) " +
    "altına düşen ürünler; varsayılan tedarikçi bilgisiyle",
  filtreler: [{ alan: "gun", ad: "Satış Ortalaması Dönemi (gün)", tip: "sayi" }],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "gunlukSatis", baslik: "Ort. Günlük Satış", tip: "sayi" },
    { alan: "tedarikSuresi", baslik: "Tedarik Süresi (gün)", tip: "sayi" },
    { alan: "siparisNoktasi", baslik: "Sipariş Noktası", tip: "sayi" },
    { alan: "oneriMiktar", baslik: "Önerilen Miktar", tip: "sayi" },
    { alan: "tedarikci", baslik: "Varsayılan Tedarikçi", tip: "metin" },
    { alan: "alisFiyati", baslik: "Alış Fiyatı", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gun = typeof f.gun === "number" && f.gun > 0 ? f.gun : 90;

    const satislar = new Map((await urunSatislari(tx, gunOnce(gun))).map((g) => [g.stokId, Prisma.Decimal.max(D(0), g.miktar)]));

    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, tip: { in: ["urun", "sarf"] } },
      include: {
        tedarikciler: {
          where: { varsayilan: true },
          take: 1,
          include: { cari: { select: { unvan: true } } },
        },
      },
      orderBy: { kod: "asc" },
    });

    const sonuc = [];
    for (const k of kartlar) {
      const tedarikci = k.tedarikciler[0];
      const gunlukSatis = (satislar.get(k.id) ?? D(0)).div(gun);
      const tedarikSuresi =
        k.tedarikSuresiGun ?? tedarikci?.tedarikSuresiGun ?? 0;
      const guvenlik = D(k.guvenlikStogu ?? 0);
      // Sipariş noktası; minimum stok tanımlıysa alt sınır olarak uygulanır
      let nokta = gunlukSatis.mul(tedarikSuresi).add(guvenlik);
      if (k.minStok && nokta.lt(k.minStok)) nokta = D(k.minStok);
      // FTR-12: karşılaştırma eldeki tahmini üzerinden — rezerve düşülür,
      // açık alış siparişlerinden gelecek (yoldaki) miktar eklenir
      const eldeki = k.mevcutMiktar
        .sub(k.rezerveMiktar)
        .add(k.yoldakiMiktar);
      if (nokta.lte(0) || eldeki.gt(nokta)) continue;

      // Hedef: maksimum stok tanımlıysa oraya, değilse sipariş noktasına tamamla
      const hedef =
        k.maksStok && D(k.maksStok).gt(nokta) ? D(k.maksStok) : nokta;
      sonuc.push({
        stokId: k.id,
        kod: k.kod,
        ad: k.ad,
        mevcut: Number(k.mevcutMiktar),
        gunlukSatis: gunlukSatis.toDecimalPlaces(3).toNumber(),
        tedarikSuresi,
        siparisNoktasi: nokta.toDecimalPlaces(3).toNumber(),
        oneriMiktar: hedef.sub(eldeki).toDecimalPlaces(3).toNumber(),
        tedarikci: tedarikci?.cari.unvan ?? null,
        alisFiyati:
          (tedarikci?.alisFiyati ?? k.alisFiyati)?.toFixed(2) ?? null,
      });
    }
    return sonuc;
  },
});

// ─── Fire / zayi (STK-19) ───────────────────────────────────────────────────

registerRapor({
  kod: "stok.fire-zayi",
  modul: "stok",
  ad: "Fire / Zayi",
  aciklama:
    "Tarih aralığındaki fire ve zayi çıkışları; hareket anındaki ortalama maliyetle tutar",
  filtreler: [
    ...TARIH_FILTRELERI,
    {
      alan: "tur",
      ad: "Tür",
      tip: "secim",
      secenekler: [
        { deger: "fire", ad: "Fire" },
        { deger: "zayi", ad: "Zayi" },
      ],
    },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "tur", baslik: "Tür", tip: "metin" },
    { alan: "miktar", baslik: "Miktar", tip: "sayi" },
    { alan: "tutar", baslik: "Tutar (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hareketler = await tx.stokHareket.findMany({
      where: {
        tip: f.tur ? (f.tur as "fire" | "zayi") : { in: ["fire", "zayi"] },
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      select: {
        stokId: true,
        tip: true,
        miktar: true,
        maliyet: true,
        stok: { select: { kod: true, ad: true } },
      },
    });
    const gruplar = new Map<
      string,
      { stokId: string; kod: string; ad: string; tur: string; miktar: Prisma.Decimal; tutar: Prisma.Decimal }
    >();
    for (const h of hareketler) {
      const anahtar = `${h.stokId}:${h.tip}`;
      const g = gruplar.get(anahtar) ?? {
        stokId: h.stokId,
        kod: h.stok.kod,
        ad: h.stok.ad,
        tur: h.tip === "fire" ? "Fire" : "Zayi",
        miktar: D(0),
        tutar: D(0),
      };
      const miktar = h.miktar.abs(); // çıkış türleri negatif saklanır
      g.miktar = g.miktar.add(miktar);
      g.tutar = g.tutar.add(miktar.mul(h.maliyet));
      gruplar.set(anahtar, g);
    }
    return [...gruplar.values()]
      .sort(
        (a, b) => a.kod.localeCompare(b.kod, "tr") || a.tur.localeCompare(b.tur, "tr"),
      )
      .map((g) => ({
        stokId: g.stokId,
        kod: g.kod,
        ad: g.ad,
        tur: g.tur,
        miktar: Number(g.miktar),
        tutar: g.tutar.toFixed(2),
      }));
  },
});

// ─── Hareketsiz stok ────────────────────────────────────────────────────────

registerRapor({
  kod: "stok.hareketsiz",
  modul: "stok",
  ad: "Hareketsiz Stok",
  aciklama:
    "Belirtilen gün sayısı boyunca hiç hareket görmemiş, stoğu bulunan ürünler",
  filtreler: [{ alan: "gun", ad: "Gün", tip: "sayi" }],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "envanterDegeri", baslik: "Envanter Değeri", tip: "para", toplam: true },
    { alan: "sonHareket", baslik: "Son Hareket", tip: "tarih" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gun = typeof f.gun === "number" && f.gun > 0 ? f.gun : 90;
    const sinir = new Date(gunOnce(gun));

    const sonHareketler = await tx.stokHareket.groupBy({
      by: ["stokId"],
      _max: { tarih: true },
    });
    const sonTarih = new Map(
      sonHareketler.map((h) => [h.stokId, h._max.tarih]),
    );

    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, tip: { in: ["urun", "sarf"] }, mevcutMiktar: { gt: 0 } },
      orderBy: { kod: "asc" },
    });
    return kartlar
      .filter((k) => {
        const son = sonTarih.get(k.id);
        return !son || son < sinir;
      })
      .map((k) => ({
        stokId: k.id,
        kod: k.kod,
        ad: k.ad,
        mevcut: Number(k.mevcutMiktar),
        envanterDegeri: k.mevcutMiktar.mul(k.ortalamaMaliyet).toFixed(2),
        sonHareket:
          sonTarih.get(k.id)?.toISOString().slice(0, 10) ?? null,
      }));
  },
});

// ─── Eksi stok (STK-17) ─────────────────────────────────────────────────────

registerRapor({
  kod: "stok.eksi-stok",
  modul: "stok",
  ad: "Eksi Stok",
  aciklama: "Mevcut miktarı eksiye düşmüş ürünler (eksi stok politikası takibi)",
  filtreler: [],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "sonHareket", baslik: "Son Hareket", tip: "tarih" },
  ],
  async calistir(_girdi, { tx }) {
    const kartlar = await tx.stokKart.findMany({
      where: { mevcutMiktar: { lt: 0 }, tip: { not: "hizmet" } },
      orderBy: { kod: "asc" },
    });
    if (kartlar.length === 0) return [];
    const sonHareketler = await tx.stokHareket.groupBy({
      by: ["stokId"],
      where: { stokId: { in: kartlar.map((k) => k.id) } },
      _max: { tarih: true },
    });
    const sonTarih = new Map(
      sonHareketler.map((h) => [h.stokId, h._max.tarih]),
    );
    return kartlar.map((k) => ({
      stokId: k.id,
      kod: k.kod,
      ad: k.ad,
      birim: k.anaBirim,
      mevcut: Number(k.mevcutMiktar),
      sonHareket: sonTarih.get(k.id)?.toISOString().slice(0, 10) ?? null,
    }));
  },
});
