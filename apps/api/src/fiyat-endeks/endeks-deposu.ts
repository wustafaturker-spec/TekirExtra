import { Prisma, type PrismaClient } from "@prisma/client";
import type { EvdsDegeri } from "./evds-istemci";

/**
 * END-01/04: ortak endeks deposuna yazma ve okuma. Yazan taraf ya worker'ın
 * uygulama bağlantısı (tekir_app: değer + çekim durumu) ya da platform
 * bağlantısıdır (tekir_platform); ikisi de aynı kurallarla yazar.
 */
type Db = PrismaClient;
type Okuyucu = Pick<Prisma.TransactionClient, "endeksSerisi" | "endeksDegeri">;

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const donemTarihi = (donem: string) => new Date(`${donem}T00:00:00.000Z`);
export const donemMetni = (t: Date) => t.toISOString().slice(0, 10);

export interface YazimSonucu { yeni: number; revize: number; elleUyusmaz: number }

/**
 * Değerleri yazar. Aynı dönem farklı gelirse (TÜİK revizyonu ya da elle
 * girilmiş değerin EVDS'deki karşılığı) eski değer revizyon tablosuna düşer.
 */
export async function degerleriYaz(db: Db, seriKodu: string, degerler: EvdsDegeri[], kaynak: "evds" | "elle", kismiDonem?: string | null, aciklama?: string | null): Promise<YazimSonucu> {
  // END-05: dayanak açıklaması yalnız elle girilen değerde tutulur; EVDS değeri yazılınca boşalır.
  const not = kaynak === "elle" ? aciklama ?? null : null;
  const sonuc: YazimSonucu = { yeni: 0, revize: 0, elleUyusmaz: 0 };
  if (!degerler.length) return sonuc;
  const mevcut = new Map(
    (await db.endeksDegeri.findMany({ where: { seriKodu, donem: { in: degerler.map((d) => donemTarihi(d.donem)) } } }))
      .map((d) => [donemMetni(d.donem), d]),
  );
  const yeniler: Prisma.EndeksDegeriCreateManyInput[] = [];
  const islemler: Prisma.PrismaPromise<unknown>[] = [];
  const simdi = new Date();
  for (const d of degerler) {
    const eski = mevcut.get(d.donem);
    const deger = D(d.deger);
    if (!eski) { yeniler.push({ seriKodu, donem: donemTarihi(d.donem), deger, kaynak, aciklama: not, alindiAt: simdi }); continue; }
    if (eski.deger.equals(deger)) {
      // Elle girilmiş değer EVDS'de aynı geldiyse kaynak EVDS olur; revizyon değildir.
      if (eski.kaynak !== kaynak && kaynak === "evds") islemler.push(db.endeksDegeri.update({ where: { seriKodu_donem: { seriKodu, donem: eski.donem } }, data: { kaynak, aciklama: null, alindiAt: simdi } }));
      else if (kaynak === "elle" && eski.kaynak === "elle" && (eski.aciklama ?? null) !== not) islemler.push(db.endeksDegeri.update({ where: { seriKodu_donem: { seriKodu, donem: eski.donem } }, data: { aciklama: not } }));
      continue;
    }
    // Kur serisinde içinde bulunulan ay ay başından bugüne ortalamadır; her çekimde değişir, revizyon sayılmaz.
    if (kismiDonem && d.donem === kismiDonem && eski.kaynak === kaynak) {
      islemler.push(db.endeksDegeri.update({ where: { seriKodu_donem: { seriKodu, donem: eski.donem } }, data: { deger, alindiAt: simdi } }));
      continue;
    }
    if (eski.kaynak === "elle" && kaynak === "evds") sonuc.elleUyusmaz++;
    sonuc.revize++;
    islemler.push(
      db.endeksDegerRevizyonu.create({ data: { seriKodu, donem: eski.donem, eskiDeger: eski.deger, yeniDeger: deger, eskiKaynak: eski.kaynak, yeniKaynak: kaynak,
        // Platform yöneticisinin kendi düzeltmesi uyarı üretmez; EVDS'den gelen fark görülene kadar uyarıdır.
        gorulduAt: kaynak === "elle" ? simdi : null } }),
      db.endeksDegeri.update({ where: { seriKodu_donem: { seriKodu, donem: eski.donem } }, data: { deger, kaynak, aciklama: not, alindiAt: simdi } }),
    );
  }
  if (yeniler.length) islemler.unshift(db.endeksDegeri.createMany({ data: yeniler, skipDuplicates: true }));
  sonuc.yeni = yeniler.length;
  if (islemler.length) await db.$transaction(islemler);
  return sonuc;
}

/** Çekim sonucunu seri kaydına yazar (uygulama rolünün yazabildiği sütunlar). */
export async function cekimDurumuYaz(db: Db, kod: string, d: { hata: string | null; sonDonem?: string | null }) {
  const simdi = new Date();
  await db.endeksSerisi.update({
    where: { kod },
    data: d.hata
      ? { sonCekimAt: simdi, sonHata: d.hata.slice(0, 500) }
      : { sonCekimAt: simdi, sonBasariliAt: simdi, sonHata: null, ...(d.sonDonem ? { sonDonem: donemTarihi(d.sonDonem) } : {}) },
  });
}

/**
 * END-04: baz yılı değişen seri eskisine zincirlenir. Katsayı, iki serinin
 * ortak olduğu ilk dönemde yeni / eski oranıdır; o dönemden önceki aylar eski
 * seriden katsayıyla taşınır. Ortak dönem yoksa zincir kurulmaz.
 */
export async function zincirKatsayisiGuncelle(db: Db, kod: string): Promise<{ katsayi: string; donem: string } | null> {
  const seri = await db.endeksSerisi.findUnique({ where: { kod }, select: { oncekiSeriKodu: true } });
  if (!seri?.oncekiSeriKodu) {
    await db.endeksSerisi.update({ where: { kod }, data: { zincirKatsayisi: null, zincirDonemi: null } });
    return null;
  }
  const ortak = await db.$queryRaw<{ donem: Date; yeni: Prisma.Decimal; eski: Prisma.Decimal }[]>`
    SELECT y.donem, y.deger AS yeni, e.deger AS eski
    FROM endeks_degerleri y JOIN endeks_degerleri e ON e.donem = y.donem AND e.seri_kodu = ${seri.oncekiSeriKodu}
    WHERE y.seri_kodu = ${kod}
    ORDER BY y.donem ASC LIMIT 1`;
  const ilk = ortak[0];
  const katsayi = ilk ? D(ilk.yeni).div(ilk.eski).toDecimalPlaces(12) : null;
  await db.endeksSerisi.update({ where: { kod }, data: { zincirKatsayisi: katsayi, zincirDonemi: ilk?.donem ?? null } });
  return ilk && katsayi ? { katsayi: katsayi.toString(), donem: donemMetni(ilk.donem) } : null;
}

export interface SeriOkumasi {
  kod: string;
  ad: string;
  tur: "endeks" | "kur";
  bazYili: string | null;
  sonDonem: string | null;
  /** dönem (YYYY-MM-01) → değer; zincirlenen aylar dahil. */
  degerler: Map<string, Prisma.Decimal>;
  zincirlenenDonemSayisi: number;
}

/** Serinin aralıktaki aylık değerleri; zincir varsa önceki seriden taşınan aylar dahil (tek kademe). */
export async function seriOku(db: Okuyucu, kod: string, baslangic: string, bitis: string): Promise<SeriOkumasi | null> {
  const seri = await db.endeksSerisi.findUnique({ where: { kod } });
  if (!seri) return null;
  const aralik = { gte: donemTarihi(baslangic), lte: donemTarihi(bitis) };
  const degerler = new Map(
    (await db.endeksDegeri.findMany({ where: { seriKodu: kod, donem: aralik }, select: { donem: true, deger: true } }))
      .map((d) => [donemMetni(d.donem), d.deger]),
  );
  let zincirlenenDonemSayisi = 0;
  if (seri.oncekiSeriKodu && seri.zincirKatsayisi && seri.zincirDonemi && donemTarihi(baslangic) < seri.zincirDonemi) {
    const eskiler = await db.endeksDegeri.findMany({ where: { seriKodu: seri.oncekiSeriKodu, donem: { gte: aralik.gte, lt: seri.zincirDonemi } }, select: { donem: true, deger: true } });
    for (const e of eskiler) {
      const ay = donemMetni(e.donem);
      if (degerler.has(ay)) continue;
      degerler.set(ay, e.deger.mul(seri.zincirKatsayisi).toDecimalPlaces(6));
      zincirlenenDonemSayisi++;
    }
  }
  return { kod: seri.kod, ad: seri.ad, tur: seri.tur === "kur" ? "kur" : "endeks", bazYili: seri.bazYili, sonDonem: seri.sonDonem ? donemMetni(seri.sonDonem) : null, degerler, zincirlenenDonemSayisi };
}
