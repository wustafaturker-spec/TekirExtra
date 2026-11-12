/**
 * KSB-06: banka bakiyesi mutabakatı. Ekstredeki bakiye sütunundan her günün
 * banka gün sonu bakiyesi çıkarılır ve sistemdeki hesap bakiyesiyle
 * karşılaştırılır.
 *
 * Bankalar aynı gün içindeki satırları farklı sırada verebilir (artan, azalan,
 * işlem saatine göre); bu yüzden gün sonu bakiyesi satır sırasına güvenmeden
 * bulunur: satırın bakiyesinden kendi tutarı düşülünce gün başı adayı çıkar,
 * gün başı + günün toplamı başka bir satırın bakiyesine eşitse o gün sonudur.
 */
import { Prisma } from "@prisma/client";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

export interface MutabakatSatiri {
  tarih: Date;
  tutar: Prisma.Decimal;
  bakiye: Prisma.Decimal | null;
  durum: "beklemede" | "eslesti" | "yoksayildi";
}

export interface MutabakatHareketi {
  tarih: Date;
  tip: string;
  tutar: Prisma.Decimal;
}

export interface MutabakatGunu {
  tarih: string;
  banka: string;
  sistem: string;
  fark: string;
  /** O güne kadar onay bekleyen ve yoksayılan satırların toplamı (farkın açıklanan kısmı). */
  bekleyen: string;
  yoksayilan: string;
}

const gun = (t: Date) => t.toISOString().slice(0, 10);
const giris = (tip: string) => tip === "tahsilat" || tip === "virman_gelis";

/** Günün satırlarından gün sonu bakiyesi; bulunamazsa null. */
export function gunSonuBakiyesi(satirlar: MutabakatSatiri[]): Prisma.Decimal | null {
  const bakiyeli = satirlar.filter((s) => s.bakiye !== null);
  if (bakiyeli.length === 0) return null;
  const gunToplami = satirlar.reduce((t, s) => t.add(s.tutar), D(0));
  const bakiyeler = bakiyeli.map((s) => s.bakiye!);
  for (const s of bakiyeli) {
    const gunSonu = s.bakiye!.sub(s.tutar).add(gunToplami);
    if (bakiyeler.some((b) => b.equals(gunSonu))) return gunSonu;
  }
  // Tutarlı bir zincir yoksa (eksik satır) dosyadaki son satırın bakiyesi.
  return bakiyeler[bakiyeler.length - 1];
}

/** Bir ekstre gününün özeti: gün sonu bakiyesi (bakiye sütunu yoksa null) ve o günün bekleyen/yoksayılan toplamı. */
export interface MutabakatGunOzeti {
  tarih: string;
  banka: Prisma.Decimal | null;
  bekleyen: Prisma.Decimal;
  yoksayilan: Prisma.Decimal;
}

/** Satırlardan gün özetleri (bellekte); veritabanı karşılığı `gunlukEkstreOzetleri`. */
export function gunOzetleri(satirlar: MutabakatSatiri[]): MutabakatGunOzeti[] {
  const gunler = new Map<string, MutabakatSatiri[]>();
  for (const s of satirlar) gunler.set(gun(s.tarih), [...(gunler.get(gun(s.tarih)) ?? []), s]);
  return [...gunler.keys()].sort().map((g) => {
    const l = gunler.get(g)!;
    const topla = (durum: MutabakatSatiri["durum"]) => l.filter((s) => s.durum === durum).reduce((t, s) => t.add(s.tutar), D(0));
    return { tarih: g, banka: gunSonuBakiyesi(l), bekleyen: topla("beklemede"), yoksayilan: topla("yoksayildi") };
  });
}

export function mutabakatHesapla(satirlar: MutabakatSatiri[], hareketler: MutabakatHareketi[]) {
  return mutabakatGunlerden(gunOzetleri(satirlar), hareketler);
}

export function mutabakatGunlerden(gunler: MutabakatGunOzeti[], hareketler: MutabakatHareketi[]) {
  const hareketSirali = [...hareketler].sort((a, b) => a.tarih.getTime() - b.tarih.getTime());

  const sonuc: MutabakatGunu[] = [];
  let sistem = D(0);
  let h = 0;
  let bekleyen = D(0);
  let yoksayilan = D(0);
  for (const g of gunler) {
    while (h < hareketSirali.length && gun(hareketSirali[h].tarih) <= g.tarih) {
      const x = hareketSirali[h++];
      sistem = giris(x.tip) ? sistem.add(x.tutar) : sistem.sub(x.tutar);
    }
    bekleyen = bekleyen.add(g.bekleyen);
    yoksayilan = yoksayilan.add(g.yoksayilan);
    const banka = g.banka;
    if (!banka) continue;
    sonuc.push({ tarih: g.tarih, banka: banka.toFixed(2), sistem: sistem.toFixed(2), fark: banka.sub(sistem).toFixed(2), bekleyen: bekleyen.toFixed(2), yoksayilan: yoksayilan.toFixed(2) });
  }

  const son = sonuc.at(-1) ?? null;
  // Farkın başladığı gün: son eşit günden sonraki ilk farklı gün; hiç eşit gün
  // yoksa fark ekstrenin ilk gününden beri vardır (null).
  let sonEsit = -1;
  sonuc.forEach((x, i) => { if (D(x.fark).isZero()) sonEsit = i; });
  const farkBaslangici = son && !D(son.fark).isZero() && sonEsit >= 0 ? sonuc[sonEsit + 1]?.tarih ?? null : null;
  // Bekleyen/yoksayılan satırlarla açıklanamayan fark ilk günden beri hiç değişmediyse
  // büyük olasılıkla hesabın açılış bakiyesi girilmemiştir.
  const aciklanamayan = (x: MutabakatGunu) => D(x.fark).sub(x.bekleyen).sub(x.yoksayilan);
  const sabitFark = sonuc.length > 0 && sonEsit === -1 && !aciklanamayan(sonuc[0]).isZero()
    && sonuc.every((x) => aciklanamayan(x).equals(aciklanamayan(sonuc[0])));
  const aciklanmayan = son ? D(son.fark).sub(son.bekleyen).sub(son.yoksayilan) : D(0);
  return {
    son,
    farkBaslangici,
    acilisBakiyesiEksikOlabilir: sabitFark,
    aciklanmayanFark: aciklanmayan.toFixed(2),
    gunler: sonuc.slice(-60),
  };
}

/**
 * Sistem tarafı gün başına net tutar olarak veritabanında toplanır: mutabakat yalnız her ekstre
 * gününe kadarki birikimli bakiyeyi kullanır, hesabın bütün hareketlerini belleğe almaya gerek
 * yoktur. Giriş tipleri `giris` ile aynıdır. Dönen satırlar `mutabakatHesapla`ya hareket olarak verilir.
 */
export async function gunlukHareketNetleri(tx: Prisma.TransactionClient, tenantId: string, bankaHesapId: string): Promise<MutabakatHareketi[]> {
  const satirlar = await tx.$queryRaw<{ tarih: Date; net: string }[]>`
    SELECT tarih, sum(CASE WHEN tip::text IN ('tahsilat', 'virman_gelis') THEN tutar ELSE -tutar END)::text AS net
    FROM kasa_banka_hareketleri
    WHERE tenant_id = ${tenantId}::uuid AND banka_hesap_id = ${bankaHesapId}::uuid
    GROUP BY tarih`;
  return satirlar.map((s) => {
    const net = D(s.net);
    return { tarih: s.tarih, tip: net.isNegative() ? "tediye" : "tahsilat", tutar: net.abs() };
  });
}

/**
 * V-2: gün özetleri veritabanında çıkarılır (ekstrenin bütün satırları belleğe alınmaz). Gün sonu
 * kuralı `gunSonuBakiyesi` ile aynıdır: satırlar (oluşturulma, kimlik) sırasıyla denenir; satırın
 * bakiyesi − tutarı + günün toplamı günün başka bir bakiyesine eşitse gün sonu odur; yoksa son bakiye.
 */
export async function gunlukEkstreOzetleri(tx: Prisma.TransactionClient, tenantId: string, bankaHesapId: string): Promise<MutabakatGunOzeti[]> {
  const satirlar = await tx.$queryRaw<Array<{ tarih: Date; banka: string | null; bekleyen: string; yoksayilan: string }>>`
    WITH s AS (
      SELECT tarih, tutar, bakiye, durum::text AS durum,
             row_number() OVER (PARTITION BY tarih ORDER BY created_at, id) AS sira,
             sum(tutar) OVER (PARTITION BY tarih) AS gun_toplami
      FROM banka_ekstre_satirlari
      WHERE tenant_id = ${tenantId}::uuid AND banka_hesap_id = ${bankaHesapId}::uuid
    ), aday AS (
      SELECT DISTINCT ON (a.tarih) a.tarih, a.bakiye - a.tutar + a.gun_toplami AS gun_sonu
      FROM s a
      WHERE a.bakiye IS NOT NULL AND EXISTS (SELECT 1 FROM s b WHERE b.tarih = a.tarih AND b.bakiye = a.bakiye - a.tutar + a.gun_toplami)
      ORDER BY a.tarih, a.sira
    ), son AS (
      SELECT DISTINCT ON (tarih) tarih, bakiye FROM s WHERE bakiye IS NOT NULL ORDER BY tarih, sira DESC
    ), gunler AS (
      SELECT tarih,
             coalesce(sum(tutar) FILTER (WHERE durum = 'beklemede'), 0) AS bekleyen,
             coalesce(sum(tutar) FILTER (WHERE durum = 'yoksayildi'), 0) AS yoksayilan
      FROM s GROUP BY tarih
    )
    SELECT g.tarih, coalesce(aday.gun_sonu, son.bakiye)::text AS banka, g.bekleyen::text AS bekleyen, g.yoksayilan::text AS yoksayilan
    FROM gunler g LEFT JOIN aday USING (tarih) LEFT JOIN son USING (tarih)
    ORDER BY g.tarih`;
  return satirlar.map((r) => ({ tarih: gun(r.tarih), banka: r.banka === null ? null : D(r.banka), bekleyen: D(r.bekleyen), yoksayilan: D(r.yoksayilan) }));
}

/** Hesabın mutabakatı; ekstre ve hareket tarafı gün başına veritabanında toplanır. */
export async function mutabakatOku(tx: Prisma.TransactionClient, tenantId: string, bankaHesapId: string) {
  const [gunler, hareketler] = await Promise.all([gunlukEkstreOzetleri(tx, tenantId, bankaHesapId), gunlukHareketNetleri(tx, tenantId, bankaHesapId)]);
  return { ...mutabakatGunlerden(gunler, hareketler), bakiyeSutunuVar: gunler.some((g) => g.banka !== null) };
}

