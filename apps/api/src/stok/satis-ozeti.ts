/**
 * STK-32: satış kârlılığının ortak kaynağı. Ciro satır matrahı × kurdan,
 * satılan miktar ve maliyet faturanın stok hareketlerinden gelir. Satış
 * iadesi eksi işaretlidir; iptal edilmiş fatura dahil edilmez; taslağa geri
 * alma tersleri (`fatura_geri_alma`) hareket toplamında ilk kesinleştirmeyi
 * sıfırlar, böylece yeniden kesinleşen fatura bir kez sayılır.
 */
import { Prisma } from "@prisma/client";
import { birimKatsayisiBul } from "./birim-cevrim";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface SatisSatiri {
  faturaId: string; faturaNo: string; tarih: Date; cariUnvan: string; tip: "satis" | "satis_iade";
  stokId: string; kod: string; ad: string; mevcutMiktar: Prisma.Decimal;
  /** Kartın tipi (urun, sarf, hizmet…); maliyeti bilinmeyen mal satışını ayırmak için. */
  stokTip: string;
  /** Ana birimde; satış artı, iade eksi. */
  miktar: Prisma.Decimal;
  /** TL ciro; iade eksi. */
  ciro: Prisma.Decimal;
  /** Hareketin kayıtlı (ağırlıklı ortalama) maliyetiyle; iade eksi. */
  maliyet: Prisma.Decimal;
  /** Bu satırın payına düşen stok hareketleri (FIFO dağıtımı için): hareket id → pay oranı. */
  hareketPaylari: { hareketId: string; oran: Prisma.Decimal }[];
}

/** Satış ve satış iadesi satırları; `tarih` Prisma tarih süzgecidir. */
export async function satisSatirlari(tx: Tx, tarih: Prisma.DateTimeFilter = {}): Promise<SatisSatiri[]> {
  const faturalar = await tx.fatura.findMany({
    where: { tip: { in: ["satis", "satis_iade"] }, durum: "kesin", tarih },
    select: {
      id: true, no: true, tarih: true, tip: true, kur: true, cari: { select: { unvan: true } },
      satirlar: { select: { stokId: true, miktar: true, birim: true, matrah: true, stok: { select: { kod: true, ad: true, tip: true, mevcutMiktar: true } } } },
    },
    orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
  });
  if (!faturalar.length) return [];
  const hareketler = await tx.stokHareket.findMany({
    where: { kaynakRef: { in: faturalar.map((f) => f.id) }, kaynakTur: { in: ["fatura", "fatura_geri_alma"] } },
    select: { id: true, kaynakRef: true, stokId: true, miktar: true, maliyet: true },
  });
  const grup = new Map<string, typeof hareketler>();
  for (const h of hareketler) { const a = `${h.kaynakRef}|${h.stokId}`; grup.set(a, [...(grup.get(a) ?? []), h]); }
  const katsayilar = new Map<string, Prisma.Decimal>();
  const katsayi = async (stokId: string, birim: string) => {
    const a = `${stokId}|${birim}`;
    if (!katsayilar.has(a)) katsayilar.set(a, await birimKatsayisiBul(tx, stokId, birim).catch(() => D(1)));
    return katsayilar.get(a)!;
  };

  const sonuc: SatisSatiri[] = [];
  for (const f of faturalar) {
    const isaret = f.tip === "satis" ? 1 : -1;
    const satirlar = await Promise.all(f.satirlar.map(async (s) => ({ s, ana: s.miktar.mul(await katsayi(s.stokId, s.birim)) })));
    for (const { s, ana } of satirlar) {
      const ayniUrun = satirlar.filter((x) => x.s.stokId === s.stokId).reduce((t, x) => t.add(x.ana), D(0));
      const oran = ayniUrun.gt(0) ? ana.div(ayniUrun) : D(0);
      const hs = grup.get(`${f.id}|${s.stokId}`) ?? [];
      // Çıkış eksi işaretli saklanır: satışta değer artı, iadede eksi çıkar.
      const deger = hs.reduce((t, h) => t.sub(h.miktar.mul(h.maliyet)), D(0));
      sonuc.push({
        faturaId: f.id, faturaNo: f.no ?? "", tarih: f.tarih, cariUnvan: f.cari?.unvan ?? "", tip: f.tip as "satis" | "satis_iade",
        stokId: s.stokId, kod: s.stok.kod, ad: s.stok.ad, stokTip: s.stok.tip, mevcutMiktar: s.stok.mevcutMiktar,
        miktar: ana.mul(isaret), ciro: s.matrah.mul(f.kur).mul(isaret).toDecimalPlaces(2), maliyet: deger.mul(oran).toDecimalPlaces(2),
        hareketPaylari: hs.map((h) => ({ hareketId: h.id, oran })),
      });
    }
  }
  return sonuc;
}

export interface UrunSatisOzeti { stokId: string; kod: string; ad: string; mevcutMiktar: Prisma.Decimal; miktar: Prisma.Decimal; ciro: Prisma.Decimal; maliyet: Prisma.Decimal }

/** Satırları ürün başına toplar. */
export function urunBazinda(satirlar: SatisSatiri[]): UrunSatisOzeti[] {
  const m = new Map<string, UrunSatisOzeti>();
  for (const s of satirlar) {
    const g = m.get(s.stokId) ?? { stokId: s.stokId, kod: s.kod, ad: s.ad, mevcutMiktar: s.mevcutMiktar, miktar: D(0), ciro: D(0), maliyet: D(0) };
    g.miktar = g.miktar.add(s.miktar); g.ciro = g.ciro.add(s.ciro); g.maliyet = g.maliyet.add(s.maliyet);
    m.set(s.stokId, g);
  }
  return [...m.values()];
}

/**
 * STK-32 FIFO: ürünün bütün hareketleri tarih sırasıyla işlenir; girişler
 * kendi maliyetleriyle kuyruğa girer, çıkışlar en eskiden tüketir. Dönen
 * harita her çıkış hareketinin FIFO değeridir (pozitif); kuyruk biterse
 * kalan miktar hareketin kayıtlı maliyetiyle değerlenir.
 */
export function fifoDegerleri(hareketler: { id: string; miktar: Prisma.Decimal; maliyet: Prisma.Decimal }[]): Map<string, Prisma.Decimal> {
  const kuyruk: { miktar: Prisma.Decimal; maliyet: Prisma.Decimal }[] = [];
  const degerler = new Map<string, Prisma.Decimal>();
  for (const h of hareketler) {
    if (h.miktar.gt(0)) { kuyruk.push({ miktar: h.miktar, maliyet: h.maliyet }); continue; }
    let kalan = h.miktar.abs(), deger = D(0);
    while (kalan.gt(0) && kuyruk.length) {
      const p = kuyruk[0], al = Prisma.Decimal.min(kalan, p.miktar);
      deger = deger.add(al.mul(p.maliyet)); kalan = kalan.sub(al); p.miktar = p.miktar.sub(al);
      if (p.miktar.isZero()) kuyruk.shift();
    }
    degerler.set(h.id, deger.add(kalan.mul(h.maliyet)));
  }
  return degerler;
}
