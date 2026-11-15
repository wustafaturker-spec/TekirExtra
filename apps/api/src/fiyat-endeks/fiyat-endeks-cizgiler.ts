import { Prisma } from "@prisma/client";
import { ayKaydir } from "./fiyat-endeks-hesap";
import { ozelPlan } from "./fiyat-endeks-veri";

/**
 * END-07: grafiğe eklenen diğer fiyat çizgileri. Faturadan gelen gerçekleşen
 * fiyatla aynı ölçekte (baz aydaki gerçekleşen fiyat = 100) çizilir; tabloda
 * TL değerleri gösterilir. Her çizgi kaynağını açıklamasında taşır.
 */
type Tx = Prisma.TransactionClient;
type D = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const YUZ = D(100);

export const EK_CIZGILER = ["liste", "maliyet", "sonAlis"] as const;
export type EkCizgiTuru = (typeof EK_CIZGILER)[number];

export interface EkCizgi {
  anahtar: string;
  tur: EkCizgiTuru;
  ad: string;
  /** Ekranda çizginin altında yazan kaynak açıklaması. */
  kaynak: string;
  /** Yatay referans (geçmişi olmayan güncel fiyat) ya da aylık değer. */
  yatay: boolean;
  degerler: { ay: string; fiyat: string | null; normal: string | null }[];
}

const fiyatMetni = (f: D) => f.toDecimalPlaces(4).toFixed(4);

/** Ay sonu itibarıyla geçerli değer: o ay biten ya da önceki son değişiklik. */
export function aySonuDegeri(degisimler: { at: Date; eski: D | null; yeni: D }[], ay: string): D | null {
  const sinir = new Date(`${ayKaydir(ay, 1)}T00:00:00.000+03:00`);
  let deger: D | null = null;
  for (const d of degisimler) { if (d.at < sinir) deger = d.yeni; else break; }
  // İlk değişiklikten önceki aylar: kaydedilen eski fiyat (varsa).
  if (deger === null && degisimler.length && degisimler[0].eski !== null && degisimler[0].at >= sinir) deger = degisimler[0].eski;
  return deger;
}

export function cizgiOlcekle(aylar: string[], fiyatlar: Map<string, D>, bazFiyat: D | null): EkCizgi["degerler"] {
  return aylar.map((ay) => {
    const f = fiyatlar.get(ay);
    return { ay, fiyat: f ? fiyatMetni(f) : null, normal: f && bazFiyat && bazFiyat.gt(0) ? f.div(bazFiyat).mul(YUZ).toDecimalPlaces(2).toFixed(2) : null };
  });
}

/**
 * Liste fiyatı: seçili listelerin (ya da kapsam "tüm satışlar" ise stok
 * kartının) fiyatı. Liste kaleminde END-27 ile birikmeye başlayan fiyat
 * geçmişi varsa ay sonu fiyatı, yoksa güncel fiyat yatay çizgi olur.
 * Karşılaştırma TL'dir; dövizli liste ve dövizli kart fiyatı çizilmez.
 */
export async function listeFiyatCizgileri(tx: Tx, g: { stokId: string; aylar: string[]; listeIdleri: string[] | null; bazFiyat: D | null }): Promise<{ cizgiler: EkCizgi[]; uyarilar: string[] }> {
  const uyarilar: string[] = [];
  const cizgiler: EkCizgi[] = [];
  if (!g.listeIdleri) {
    const kart = await tx.stokKart.findFirst({ where: { id: g.stokId }, select: { satisFiyati: true, satisFiyatiDoviz: true } });
    if (!kart?.satisFiyati) uyarilar.push("Stok kartında satış fiyatı tanımlı olmadığı için liste fiyatı çizgisi çizilmedi.");
    else if (kart.satisFiyatiDoviz !== "TRY") uyarilar.push(`Kart satış fiyatı ${kart.satisFiyatiDoviz} cinsinden olduğu için TL karşılaştırmasına çizilmedi.`);
    else cizgiler.push({ anahtar: "liste:kart", tur: "liste", ad: "Kart satış fiyatı (güncel)", kaynak: "Stok kartındaki satış fiyatı (KDV hariç varsayılır); kartta fiyat geçmişi tutulmadığı için yatay referans çizgisidir.", yatay: true, degerler: cizgiOlcekle(g.aylar, new Map(g.aylar.map((a) => [a, kart.satisFiyati!])), g.bazFiyat) });
    return { cizgiler, uyarilar };
  }
  const [listeler, kalemler, gecmis] = await Promise.all([
    tx.fiyatListesi.findMany({ where: { id: { in: g.listeIdleri } }, select: { id: true, ad: true, dovizCinsi: true } }),
    tx.fiyatListesiKalem.findMany({ where: { stokId: g.stokId, listeId: { in: g.listeIdleri } }, select: { listeId: true, fiyat: true } }),
    tx.fiyatListesiFiyatGecmisi.findMany({ where: { stokId: g.stokId, listeId: { in: g.listeIdleri } }, orderBy: { degistiAt: "asc" }, select: { listeId: true, eskiFiyat: true, yeniFiyat: true, degistiAt: true } }),
  ]);
  for (const l of listeler) {
    if (l.dovizCinsi !== "TRY") { uyarilar.push(`${l.ad} listesi ${l.dovizCinsi} cinsinden olduğu için liste fiyatı çizgisi çizilmedi.`); continue; }
    const kalem = kalemler.find((k) => k.listeId === l.id);
    if (!kalem) { uyarilar.push(`${l.ad} listesinde bu ürünün fiyatı yok.`); continue; }
    const degisimler = gecmis.filter((h) => h.listeId === l.id).map((h) => ({ at: h.degistiAt, eski: h.eskiFiyat, yeni: h.yeniFiyat }));
    if (!degisimler.length) {
      cizgiler.push({ anahtar: `liste:${l.id}`, tur: "liste", ad: `Liste fiyatı — ${l.ad} (güncel)`, kaynak: `${l.ad} listesindeki güncel fiyat; bu kalemde fiyat geçmişi henüz yok, yatay referans çizgisidir.`, yatay: true, degerler: cizgiOlcekle(g.aylar, new Map(g.aylar.map((a) => [a, kalem.fiyat])), g.bazFiyat) });
      continue;
    }
    const fiyatlar = new Map<string, D>();
    for (const ay of g.aylar) { const d = aySonuDegeri(degisimler, ay); if (d) fiyatlar.set(ay, d); }
    cizgiler.push({ anahtar: `liste:${l.id}`, tur: "liste", ad: `Liste fiyatı — ${l.ad}`, kaynak: `${l.ad} listesindeki fiyatın ay sonu değeri; fiyat geçmişi ${degisimler[0].at.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })} tarihinden beri tutuluyor, öncesi boş.`, yatay: false, degerler: cizgiOlcekle(g.aylar, fiyatlar, g.bazFiyat) });
  }
  return { cizgiler, uyarilar };
}

/**
 * Ağırlıklı ortalama maliyet: ay içindeki stok çıkışlarının (satış dahil)
 * kayıtlı birim maliyetlerinin miktar ağırlıklı ortalaması. Çıkış maliyeti
 * hareket anındaki ağırlıklı ortalama maliyettir (STK-08); çıkışı olmayan ay boş.
 */
export async function maliyetCizgisi(tx: Tx, g: { stokId: string; varyantId: string | null; aylar: string[]; bazFiyat: D | null }): Promise<EkCizgi> {
  const bas = g.aylar[0], sonHaric = ayKaydir(g.aylar[g.aylar.length - 1], 1);
  await ozelPlan(tx);
  const satirlar = await tx.$queryRaw<{ ay: string; deger: Prisma.Decimal | null }[]>`
    SELECT to_char(date_trunc('month', tarih), 'YYYY-MM-01') AS ay,
      SUM(ABS(miktar) * maliyet) / NULLIF(SUM(ABS(miktar)), 0) AS deger
    FROM stok_hareketleri
    WHERE stok_id = ${g.stokId}::uuid AND tip = 'cikis'::"StokHareketTip" AND maliyet > 0
      AND tarih >= ${bas}::date AND tarih < ${sonHaric}::date
      ${g.varyantId ? Prisma.sql`AND varyant_id = ${g.varyantId}::uuid` : Prisma.empty}
    GROUP BY 1`;
  const fiyatlar = new Map(satirlar.filter((s) => s.deger !== null).map((s) => [s.ay, D(s.deger!)]));
  return { anahtar: "maliyet", tur: "maliyet", ad: "Ağırlıklı ortalama maliyet", kaynak: "Ay içindeki stok çıkışlarının kayıtlı birim maliyetlerinin miktar ağırlıklı ortalaması (çıkış anındaki ağırlıklı ortalama maliyet); çıkışı olmayan ay boş.", yatay: false, degerler: cizgiOlcekle(g.aylar, fiyatlar, g.bazFiyat) };
}

/**
 * Son alış fiyatı: ay sonuna kadarki son kesin alış faturası satırının ana
 * birim başına TL fiyatı (matrah × kur ÷ ana birim miktarı); sonraki aylara
 * yeni alış gelene kadar taşınır. Dönem öncesindeki son alış da başlangıç değeridir.
 */
export async function sonAlisCizgisi(tx: Tx, g: { stokId: string; varyantId: string | null; aylar: string[]; bazFiyat: D | null }): Promise<EkCizgi> {
  const sonHaric = ayKaydir(g.aylar[g.aylar.length - 1], 1);
  await ozelPlan(tx);
  const satirlar = await tx.$queryRaw<{ ay: string; fiyat: Prisma.Decimal }[]>`
    WITH alislar AS (
      SELECT f.tarih, f.created_at, fs.matrah * f.kur / NULLIF(fs.miktar * k.katsayi, 0) AS fiyat
      FROM fatura_satirlari fs
      JOIN faturalar f ON f.id = fs.fatura_id
      JOIN stok_kartlari s ON s.id = fs.stok_id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN fs.birim = s.ana_birim THEN 1::numeric
          ELSE (SELECT sb.katsayi FROM stok_birimleri sb WHERE sb.stok_id = fs.stok_id AND sb.ad = fs.birim LIMIT 1) END AS katsayi
      ) k ON true
      WHERE f.durum = 'kesin' AND f.tip = 'alis'::"FaturaTip" AND fs.stok_id = ${g.stokId}::uuid
        AND fs.miktar > 0 AND fs.matrah > 0 AND k.katsayi IS NOT NULL AND f.tarih < ${sonHaric}::date
        ${g.varyantId ? Prisma.sql`AND fs.varyant_id = ${g.varyantId}::uuid` : Prisma.empty}
    )
    SELECT DISTINCT ON (ay) ay, fiyat FROM (
      SELECT CASE WHEN tarih < ${g.aylar[0]}::date THEN 'once' ELSE to_char(date_trunc('month', tarih), 'YYYY-MM-01') END AS ay, tarih, created_at, fiyat FROM alislar
    ) x
    ORDER BY ay, tarih DESC, created_at DESC`;
  const ayinSonu = new Map(satirlar.map((r) => [r.ay, D(r.fiyat)]));
  const fiyatlar = new Map<string, D>();
  let son = ayinSonu.get("once") ?? null;
  for (const ay of g.aylar) { son = ayinSonu.get(ay) ?? son; if (son) fiyatlar.set(ay, son); }
  return { anahtar: "sonAlis", tur: "sonAlis", ad: "Son alış fiyatı", kaynak: "Ay sonuna kadarki son kesin alış faturası satırının ana birim başına TL fiyatı (KDV hariç, iskontolar düşülmüş, belge kuruyla); yeni alış gelene kadar sonraki aylara taşınır.", yatay: false, degerler: cizgiOlcekle(g.aylar, fiyatlar, g.bazFiyat) };
}
