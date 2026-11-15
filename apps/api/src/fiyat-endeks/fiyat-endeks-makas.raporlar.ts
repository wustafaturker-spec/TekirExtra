import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { registerRapor, type RaporSatiri } from "../core/raporlar/rapor-kayit";
import { aktifBaglam } from "../core/istek-baglami";
import { FIYAT_ENDEKS_ROLLERI, fiyatEndeksErisimi, makasEsigi, tarafDenetle } from "./fiyat-endeks-erisim";
import { ayAraligi, ayBasiMetni, ayKaydir, EN_AZ_SATIR, type AylikToplam } from "./fiyat-endeks-hesap";
import { aylikToplamlar, endeksVerisi, ozelPlan } from "./fiyat-endeks-veri";

/**
 * END-13 marj makası ve END-14 tedarikçi zam denetimi. İkisi de alış
 * fiyatı/maliyet tarafını gösterir: alış erişimi zorunludur (END-23);
 * marj makası satış tarafını da ister. Hesap Decimal'dir, çıktı metindir.
 */
type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const YUZ = D(100);
const RAPOR_EN_UZUN_AY = 60;
/** Alışta bir ay tek fatura satırıyla da temsil edilir (tedarikçiden ayda bir alım olağandır). */
const ALIS_EN_AZ_SATIR = 1;

const yuzde = (oran: D) => oran.mul(YUZ).toDecimalPlaces(2).toFixed(2);
const fiyat = (f: D) => f.toDecimalPlaces(4).toFixed(4);
const ay7 = (ay: string) => ay.slice(0, 7);

function donem(f: Record<string, unknown>) {
  const baslangic = ayBasiMetni(String(f.baslangic ?? "")), bitis = ayBasiMetni(String(f.bitis ?? ""));
  if (!baslangic || !bitis) throw new BadRequestException("Başlangıç ve bitiş zorunludur.");
  const aylar = ayAraligi(baslangic, bitis);
  if (aylar.length < 2) throw new BadRequestException("Bitiş, başlangıç ayından sonraki bir ay olmalıdır.");
  if (aylar.length > RAPOR_EN_UZUN_AY) throw new BadRequestException(`Dönem en çok ${RAPOR_EN_UZUN_AY} ay olabilir.`);
  return { baslangic, bitis, aylar };
}

/** Ayın birim fiyatı; eşiğin altında ya da miktarsızsa null. */
export function aylikFiyat(t: AylikToplam | undefined, enAz: number): D | null {
  return t && t.satir >= enAz && t.miktar.gt(0) ? t.tutar.div(t.miktar) : null;
}

/**
 * END-13: iki serinin ortak verili ilk ve son ayı üzerinden satış ve maliyet
 * değişimi, makas (maliyet değişimi − satış değişimi, puan) ve brüt marj
 * değişimi (puan). Ortak iki ay yoksa null.
 */
export function marjMakasi(aylar: string[], satis: (ay: string) => D | null, maliyet: (ay: string) => D | null) {
  const ortak = aylar.filter((ay) => satis(ay) && maliyet(ay));
  if (ortak.length < 2) return null;
  const bazAy = ortak[0], sonAy = ortak[ortak.length - 1];
  const s0 = satis(bazAy)!, s1 = satis(sonAy)!, c0 = maliyet(bazAy)!, c1 = maliyet(sonAy)!;
  const sd = s1.div(s0).sub(1), cd = c1.div(c0).sub(1);
  const m0 = s0.sub(c0).div(s0), m1 = s1.sub(c1).div(s1);
  return {
    bazAy, sonAy, bazSatis: s0, sonSatis: s1, bazMaliyet: c0, sonMaliyet: c1,
    satisDegisim: sd, maliyetDegisim: cd,
    makas: cd.sub(sd).mul(YUZ).toDecimalPlaces(2),
    bazMarj: m0.mul(YUZ).toDecimalPlaces(2), sonMarj: m1.mul(YUZ).toDecimalPlaces(2),
    marjDegisim: m1.sub(m0).mul(YUZ).toDecimalPlaces(2),
  };
}

export function makasDurumu(m: NonNullable<ReturnType<typeof marjMakasi>>, esik: number): string {
  const e = D(esik);
  if (m.maliyetDegisim.mul(YUZ).gte(e) && m.satisDegisim.abs().mul(YUZ).lt(0.5)) return "Maliyet arttı, satış fiyatı güncellenmedi";
  if (m.makas.gte(e)) return "Maliyet satış fiyatından hızlı arttı";
  if (m.makas.lte(e.negated())) return "Satış fiyatı maliyetten hızlı arttı";
  return "Eşik içinde";
}

/** END-13 maliyet kaynağı: alış faturaları ya da stok çıkışlarının ağırlıklı maliyeti. */
async function cikisMaliyetleri(tx: Prisma.TransactionClient, baslangic: string, bitisHaric: string, stokId: string | null) {
  await ozelPlan(tx);
  const satirlar = await tx.$queryRaw<{ stok_id: string; ay: string; tutar: D; miktar: D; satir: number }[]>`
    SELECT stok_id::text AS stok_id, to_char(date_trunc('month', tarih), 'YYYY-MM-01') AS ay,
      SUM(ABS(miktar) * maliyet) AS tutar, SUM(ABS(miktar)) AS miktar, COUNT(*)::int AS satir
    FROM stok_hareketleri
    WHERE tip = 'cikis'::"StokHareketTip" AND maliyet > 0 AND tarih >= ${baslangic}::date AND tarih < ${bitisHaric}::date
      ${stokId ? Prisma.sql`AND stok_id = ${stokId}::uuid` : Prisma.empty}
    GROUP BY 1, 2`;
  return satirlar.map((r) => ({ stokId: r.stok_id, ay: r.ay, toplam: { tutar: D(r.tutar), miktar: D(r.miktar), satir: Number(r.satir) } }));
}

registerRapor({
  kod: "stok.marj_makasi",
  modul: "stok",
  ad: "Marj Makası",
  aciklama: "Maliyeti satış fiyatından hızlı artan ürünler: dönemin ilk ve son ortak ayında satış fiyatı ve maliyet değişimi, aradaki makas (puan) ve brüt marj değişimi. Eşik Modül Ayarları › Fiyat ve Endeks Analizi'ndedir.",
  roller: FIYAT_ENDEKS_ROLLERI,
  filtreler: [
    { alan: "baslangic", ad: "Başlangıç", tip: "tarih", zorunlu: true },
    { alan: "bitis", ad: "Bitiş", tip: "tarih", zorunlu: true },
    { alan: "maliyetKaynagi", ad: "Maliyet kaynağı (boşsa alış faturaları)", tip: "secim", secenekler: [{ deger: "alis", ad: "Alış faturaları (gerçekleşen alış fiyatı)" }, { deger: "cikis", ad: "Stok çıkış maliyeti (ağırlıklı ortalama)" }] },
    { alan: "yalnizEsikUstu", ad: "Yalnız eşiği aşanlar", tip: "onay" },
    { alan: "stok", ad: "Ürün", tip: "stok" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "bazAy", baslik: "İlk ay", tip: "metin" },
    { alan: "sonAy", baslik: "Son ay", tip: "metin" },
    { alan: "bazSatis", baslik: "İlk satış fiyatı", tip: "para" },
    { alan: "sonSatis", baslik: "Son satış fiyatı", tip: "para" },
    { alan: "bazMaliyet", baslik: "İlk maliyet", tip: "para" },
    { alan: "sonMaliyet", baslik: "Son maliyet", tip: "para" },
    { alan: "satisDegisim", baslik: "Satış değişimi", tip: "yuzde" },
    { alan: "maliyetDegisim", baslik: "Maliyet değişimi", tip: "yuzde" },
    { alan: "makas", baslik: "Makas (puan)", tip: "sayi" },
    { alan: "bazMarj", baslik: "İlk brüt marj", tip: "yuzde" },
    { alan: "sonMarj", baslik: "Son brüt marj", tip: "yuzde" },
    { alan: "marjDegisim", baslik: "Marj değişimi (puan)", tip: "sayi" },
    { alan: "durum", baslik: "Durum", tip: "metin" },
  ],
  async calistir(girdi, { tenantId, tx }) {
    const f = girdi.filtreler ?? {};
    const { baslangic, bitis, aylar } = donem(f);
    const erisim = await fiyatEndeksErisimi(tx, tenantId, aktifBaglam().rol);
    tarafDenetle(erisim, "satis");
    tarafDenetle(erisim, "alis");
    const esik = await makasEsigi(tx, tenantId);
    const stokId = typeof f.stok === "string" && f.stok ? f.stok : null;
    const bitisHaric = ayKaydir(bitis, 1);
    const cikis = f.maliyetKaynagi === "cikis";
    const [satislar, maliyetler] = await Promise.all([
      aylikToplamlar(tx, { taraf: "satis", baslangic, bitisHaric, stokIdler: stokId ? [stokId] : null }),
      cikis ? cikisMaliyetleri(tx, baslangic, bitisHaric, stokId) : aylikToplamlar(tx, { taraf: "alis", baslangic, bitisHaric, stokIdler: stokId ? [stokId] : null }),
    ]);
    const grupla = (r: { stokId: string; ay: string; toplam: AylikToplam }[]) => {
      const m = new Map<string, Map<string, AylikToplam>>();
      for (const x of r) { const a = m.get(x.stokId) ?? new Map(); a.set(x.ay, x.toplam); m.set(x.stokId, a); }
      return m;
    };
    const S = grupla(satislar), C = grupla(maliyetler);
    const ortakStok = [...S.keys()].filter((id) => C.has(id));
    const kartlar = new Map((await tx.stokKart.findMany({ where: { id: { in: ortakStok } }, select: { id: true, kod: true, ad: true, anaBirim: true } })).map((k) => [k.id, k]));
    const maliyetEnAz = cikis ? 1 : ALIS_EN_AZ_SATIR;

    const satirlar: (RaporSatiri & { _sira: number })[] = [];
    for (const id of ortakStok) {
      const kart = kartlar.get(id);
      if (!kart) continue;
      const m = marjMakasi(aylar, (ay) => aylikFiyat(S.get(id)!.get(ay), EN_AZ_SATIR), (ay) => aylikFiyat(C.get(id)!.get(ay), maliyetEnAz));
      if (!m) continue;
      const durum = makasDurumu(m, esik);
      if (f.yalnizEsikUstu === true && !m.makas.gte(esik)) continue;
      satirlar.push({
        stokId: id, kod: kart.kod, ad: kart.ad, birim: kart.anaBirim,
        bazAy: ay7(m.bazAy), sonAy: ay7(m.sonAy),
        bazSatis: fiyat(m.bazSatis), sonSatis: fiyat(m.sonSatis), bazMaliyet: fiyat(m.bazMaliyet), sonMaliyet: fiyat(m.sonMaliyet),
        satisDegisim: yuzde(m.satisDegisim), maliyetDegisim: yuzde(m.maliyetDegisim), makas: m.makas.toFixed(2),
        bazMarj: m.bazMarj.toFixed(2), sonMarj: m.sonMarj.toFixed(2), marjDegisim: m.marjDegisim.toFixed(2),
        durum: `${durum} (eşik ${esik} puan)`,
        _sira: m.makas.toNumber(),
      });
    }
    return satirlar.sort((a, b) => b._sira - a._sira || String(a.kod).localeCompare(String(b.kod), "tr")).map(({ _sira, ...r }) => r);
  },
});

/** END-14: tedarikçi × ürün × belge dövizi aylık alış toplamları. */
async function tedarikciToplamlari(tx: Prisma.TransactionClient, g: { baslangic: string; bitisHaric: string; cariId: string | null; stokId: string | null }) {
  await ozelPlan(tx);
  const satirlar = await tx.$queryRaw<{ cari_id: string; stok_id: string; doviz: string; ay: string; tl: D; dvz: D; miktar: D; satir: number }[]>`
    SELECT f.cari_id::text AS cari_id, fs.stok_id::text AS stok_id, f.doviz_cinsi::text AS doviz,
      to_char(date_trunc('month', f.tarih), 'YYYY-MM-01') AS ay,
      SUM(fs.matrah * f.kur) AS tl, SUM(fs.matrah) AS dvz, SUM(fs.miktar * k.katsayi) AS miktar, COUNT(*)::int AS satir
    FROM fatura_satirlari fs
    JOIN faturalar f ON f.id = fs.fatura_id
    JOIN stok_kartlari s ON s.id = fs.stok_id
    JOIN LATERAL (
      SELECT CASE WHEN fs.birim = s.ana_birim THEN 1::numeric
        ELSE (SELECT sb.katsayi FROM stok_birimleri sb WHERE sb.stok_id = fs.stok_id AND sb.ad = fs.birim LIMIT 1) END AS katsayi
    ) k ON k.katsayi IS NOT NULL
    WHERE f.durum = 'kesin' AND f.tip = 'alis'::"FaturaTip" AND fs.miktar > 0 AND fs.matrah > 0
      AND f.tarih >= ${g.baslangic}::date AND f.tarih < ${g.bitisHaric}::date
      ${g.cariId ? Prisma.sql`AND f.cari_id = ${g.cariId}::uuid` : Prisma.empty}
      ${g.stokId ? Prisma.sql`AND fs.stok_id = ${g.stokId}::uuid` : Prisma.empty}
    GROUP BY 1, 2, 3, 4`;
  return satirlar.map((r) => ({ cariId: r.cari_id, stokId: r.stok_id, doviz: r.doviz, ay: r.ay, tl: D(r.tl), dvz: D(r.dvz), miktar: D(r.miktar), satir: Number(r.satir) }));
}

registerRapor({
  kod: "stok.tedarikci_zam",
  modul: "stok",
  ad: "Tedarikçi Zam Denetimi",
  aciklama: "Tedarikçi ve ürün bazında alış fiyatı değişiminin seçilen endeksle (varsayılan Yİ-ÜFE) karşılaştırması; dövizli alışta belge dövizindeki fiyat değişimi ve kur değişimi ayrı gösterilir ki kur etkisi zamdan ayrılsın.",
  roller: FIYAT_ENDEKS_ROLLERI,
  filtreler: [
    { alan: "baslangic", ad: "Başlangıç", tip: "tarih", zorunlu: true },
    { alan: "bitis", ad: "Bitiş", tip: "tarih", zorunlu: true },
    { alan: "endeks", ad: "Endeks (boşsa Yİ-ÜFE)", tip: "secim", secenekler: [{ deger: "YIUFE", ad: "Yİ-ÜFE" }, { deger: "TUFE", ad: "TÜFE" }] },
    { alan: "yalnizUstunde", ad: "Yalnız endeksin üzerinde zam", tip: "onay" },
    { alan: "cari", ad: "Tedarikçi", tip: "cari" },
    { alan: "stok", ad: "Ürün", tip: "stok" },
  ],
  kolonlar: [
    { alan: "tedarikci", baslik: "Tedarikçi", tip: "metin", kayit: { tur: "cari", idAlani: "cariId" } },
    { alan: "kod", baslik: "Kod", tip: "metin", kayit: { tur: "stok", idAlani: "stokId" } },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Belge dövizi", tip: "metin" },
    { alan: "bazAy", baslik: "İlk ay", tip: "metin" },
    { alan: "sonAy", baslik: "Son ay", tip: "metin" },
    { alan: "bazFiyat", baslik: "İlk fiyat (TL)", tip: "para" },
    { alan: "sonFiyat", baslik: "Son fiyat (TL)", tip: "para" },
    { alan: "tlDegisim", baslik: "TL fiyat değişimi", tip: "yuzde" },
    { alan: "endeksDegisim", baslik: "Endeks değişimi", tip: "yuzde" },
    { alan: "endeksFarki", baslik: "Endeksin üzerinde (puan)", tip: "sayi" },
    { alan: "dovizDegisim", baslik: "Belge dövizinde değişim", tip: "yuzde" },
    { alan: "kurDegisim", baslik: "Kur değişimi", tip: "yuzde" },
    { alan: "durum", baslik: "Durum", tip: "metin" },
  ],
  async calistir(girdi, { tenantId, tx }) {
    const f = girdi.filtreler ?? {};
    const { baslangic, bitis, aylar } = donem(f);
    const erisim = await fiyatEndeksErisimi(tx, tenantId, aktifBaglam().rol);
    tarafDenetle(erisim, "alis");
    const endeksKodu = f.endeks === "TUFE" ? "TUFE" : "YIUFE";
    const toplamlar = await tedarikciToplamlari(tx, {
      baslangic, bitisHaric: ayKaydir(bitis, 1),
      cariId: typeof f.cari === "string" && f.cari ? f.cari : null,
      stokId: typeof f.stok === "string" && f.stok ? f.stok : null,
    });
    const gruplar = new Map<string, Map<string, (typeof toplamlar)[number]>>();
    for (const t of toplamlar) {
      const anahtar = `${t.cariId}|${t.stokId}|${t.doviz}`;
      const m = gruplar.get(anahtar) ?? new Map();
      m.set(t.ay, t);
      gruplar.set(anahtar, m);
    }
    const dovizler = [...new Set(toplamlar.map((t) => t.doviz).filter((d) => d !== "TRY"))];
    const [endeks, ...kurlar] = await Promise.all([
      endeksVerisi(tx, endeksKodu, baslangic, bitis),
      ...dovizler.map((d) => (d === "USD" || d === "EUR" ? endeksVerisi(tx, d, baslangic, bitis) : Promise.resolve(null))),
    ]);
    const kurHaritasi = new Map(dovizler.map((d, i) => [d, kurlar[i]?.degerler ?? null]));
    const [kartlar, cariler] = await Promise.all([
      tx.stokKart.findMany({ where: { id: { in: [...new Set(toplamlar.map((t) => t.stokId))] } }, select: { id: true, kod: true, ad: true, anaBirim: true } }),
      tx.cariHesap.findMany({ where: { id: { in: [...new Set(toplamlar.map((t) => t.cariId))] } }, select: { id: true, unvan: true } }),
    ]);
    const kart = new Map(kartlar.map((k) => [k.id, k])), cari = new Map(cariler.map((c) => [c.id, c]));

    const satirlar: (RaporSatiri & { _sira: number })[] = [];
    for (const [anahtar, aylik] of gruplar) {
      const [cariId, stokId, doviz] = anahtar.split("|");
      const k = kart.get(stokId), c = cari.get(cariId);
      if (!k || !c) continue;
      // İlk ve son ay: alış verisi ve endeks değeri olan aylar (endeks açıklanmamış ay karşılaştırılmaz).
      const verili = aylar.filter((ay) => { const t = aylik.get(ay); return t && t.satir >= ALIS_EN_AZ_SATIR && t.miktar.gt(0) && endeks.degerler.has(ay); });
      if (verili.length < 2) continue;
      const bazAy = verili[0], sonAy = verili[verili.length - 1];
      const t0 = aylik.get(bazAy)!, t1 = aylik.get(sonAy)!;
      const f0 = t0.tl.div(t0.miktar), f1 = t1.tl.div(t1.miktar);
      const tlDeg = f1.div(f0).sub(1);
      const endDeg = endeks.degerler.get(sonAy)!.div(endeks.degerler.get(bazAy)!).sub(1);
      const fark = tlDeg.sub(endDeg).mul(YUZ).toDecimalPlaces(2);
      let dovizDeg: D | null = null, kurDeg: D | null = null;
      if (doviz !== "TRY") {
        dovizDeg = t1.dvz.div(t1.miktar).div(t0.dvz.div(t0.miktar)).sub(1);
        const kur = kurHaritasi.get(doviz);
        const k0 = kur?.get(bazAy), k1 = kur?.get(sonAy);
        // Katalogda kuru olmayan dövizde belge kurlarının ortalaması kullanılır.
        kurDeg = k0 && k1 ? k1.div(k0).sub(1) : t1.tl.div(t1.dvz).div(t0.tl.div(t0.dvz)).sub(1);
      }
      const ustunde = fark.gt(0);
      if (f.yalnizUstunde === true && !ustunde) continue;
      const durum = doviz !== "TRY" && dovizDeg !== null && dovizDeg.abs().mul(YUZ).lt(0.5) && ustunde
        ? "Dövizde fiyat sabit; TL artışı kur etkisi"
        : ustunde ? "Endeksin üzerinde zam" : "Endeks içinde";
      satirlar.push({
        cariId, stokId, tedarikci: c.unvan, kod: k.kod, ad: k.ad, birim: k.anaBirim, dovizCinsi: doviz,
        bazAy: ay7(bazAy), sonAy: ay7(sonAy), bazFiyat: fiyat(f0), sonFiyat: fiyat(f1),
        tlDegisim: yuzde(tlDeg), endeksDegisim: yuzde(endDeg), endeksFarki: fark.toFixed(2),
        dovizDegisim: dovizDeg ? yuzde(dovizDeg) : null, kurDegisim: kurDeg ? yuzde(kurDeg) : null,
        durum, _sira: fark.toNumber(),
      });
    }
    return satirlar.sort((a, b) => b._sira - a._sira || String(a.tedarikci).localeCompare(String(b.tedarikci), "tr")).map(({ _sira, ...r }) => r);
  },
});
