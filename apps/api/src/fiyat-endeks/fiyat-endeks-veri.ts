import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { seriOku } from "./endeks-deposu";
import type { AylikToplam } from "./fiyat-endeks-hesap";
import type { FiyatTarafi } from "./fiyat-endeks-erisim";

type Tx = Prisma.TransactionClient;

/** END-02: kur karşılaştırması TCMB günlük kurlarının aylık ortalamasıdır (alış); kopyalanmaz. */
export const KUR_ENDEKSLERI = { USD: "ABD doları (TCMB döviz alış, aylık ortalama)", EUR: "Euro (TCMB döviz alış, aylık ortalama)" } as const;
export type KurEndeksi = keyof typeof KUR_ENDEKSLERI;
export const kurEndeksiMi = (kod: string): kod is KurEndeksi => kod in KUR_ENDEKSLERI;

export interface ToplamSatiri {
  stokId: string;
  /** "tum" ya da fiyat listesi kimliği. */
  grup: string;
  ay: string;
  toplam: AylikToplam;
  /** Ana birime çevrilemediği için dışarıda kalan satır. */
  birimsiz: number;
  /** Faturada liste izi olmadığından carinin bugünkü listesine göre sayılan satır (END-27). */
  bugunkuListe: number;
}

/**
 * END-06: kesin faturalardan aylık gerçekleşen fiyat toplamları. Satır
 * matrahı (KDV hariç, satır ve genel iskonto düşülmüş) × belge kuru = TL;
 * miktar ana birime çevrilir. İade, proforma, taslak ve iptal girmez;
 * bedelsiz (matrahı sıfır) satır fiyat değildir, girmez.
 */
export async function aylikToplamlar(tx: Tx, g: {
  taraf: FiyatTarafi;
  baslangic: string;
  /** Hariç: bu ayın ilk günü. */
  bitisHaric: string;
  stokIdler?: string[] | null;
  varyantId?: string | null;
  /** Doluysa yalnız bu listelere bağlı satışlar ve satır grubu liste kimliğidir. */
  listeler?: string[] | null;
}): Promise<ToplamSatiri[]> {
  const listeli = Boolean(g.listeler?.length);
  const satirlar = await tx.$queryRaw<{ stok_id: string; grup: string | null; ay: string; tutar: Prisma.Decimal; miktar: Prisma.Decimal; satir: number; birimsiz: number; bugunku_liste: number }[]>`
    SELECT fs.stok_id::text AS stok_id,
      ${listeli ? Prisma.sql`COALESCE(f.fiyat_listesi_id, c.fiyat_listesi_id)::text` : Prisma.sql`'tum'`} AS grup,
      to_char(date_trunc('month', f.tarih), 'YYYY-MM-01') AS ay,
      COALESCE(SUM(fs.matrah * f.kur) FILTER (WHERE k.katsayi IS NOT NULL), 0) AS tutar,
      COALESCE(SUM(fs.miktar * k.katsayi) FILTER (WHERE k.katsayi IS NOT NULL), 0) AS miktar,
      (COUNT(*) FILTER (WHERE k.katsayi IS NOT NULL))::int AS satir,
      (COUNT(*) FILTER (WHERE k.katsayi IS NULL))::int AS birimsiz,
      (COUNT(*) FILTER (WHERE f.fiyat_listesi_id IS NULL))::int AS bugunku_liste
    FROM fatura_satirlari fs
    JOIN faturalar f ON f.id = fs.fatura_id
    JOIN stok_kartlari s ON s.id = fs.stok_id
    LEFT JOIN cari_hesaplar c ON c.id = f.cari_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN fs.birim = s.ana_birim THEN 1::numeric
        ELSE (SELECT sb.katsayi FROM stok_birimleri sb WHERE sb.stok_id = fs.stok_id AND sb.ad = fs.birim LIMIT 1) END AS katsayi
    ) k ON true
    WHERE f.durum = 'kesin' AND f.tip = ${g.taraf}::"FaturaTip"
      AND fs.miktar > 0 AND fs.matrah > 0
      AND f.tarih >= ${g.baslangic}::date AND f.tarih < ${g.bitisHaric}::date
      ${g.stokIdler ? Prisma.sql`AND fs.stok_id = ANY(${g.stokIdler}::uuid[])` : Prisma.empty}
      ${g.varyantId ? Prisma.sql`AND fs.varyant_id = ${g.varyantId}::uuid` : Prisma.empty}
      ${listeli ? Prisma.sql`AND COALESCE(f.fiyat_listesi_id, c.fiyat_listesi_id) = ANY(${g.listeler}::uuid[])` : Prisma.empty}
    GROUP BY 1, 2, 3`;
  return satirlar.map((r) => ({
    stokId: r.stok_id,
    grup: r.grup ?? "tum",
    ay: r.ay,
    toplam: { tutar: new Prisma.Decimal(r.tutar), miktar: new Prisma.Decimal(r.miktar), satir: Number(r.satir) },
    birimsiz: Number(r.birimsiz),
    bugunkuListe: listeli ? Number(r.bugunku_liste) : 0,
  }));
}

export interface EndeksVerisi {
  kod: string;
  ad: string;
  tur: "endeks" | "kur";
  bazYili: string | null;
  /** Kaynağın açıkladığı son ay (aylık endeks) ya da son kur günü. */
  sonDonem: string | null;
  degerler: Map<string, Prisma.Decimal>;
  zincirlenenDonemSayisi: number;
}

/** Endeks ya da kur serisinin aralıktaki aylık değerleri. Bilinmeyen kod 400. */
export async function endeksVerisi(tx: Tx, kod: string, baslangic: string, bitis: string): Promise<EndeksVerisi> {
  if (kurEndeksiMi(kod)) {
    const sonrakiAy = new Date(`${bitis}T00:00:00.000Z`);
    sonrakiAy.setUTCMonth(sonrakiAy.getUTCMonth() + 1);
    const satirlar = await tx.$queryRaw<{ ay: string; deger: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc('month', tarih), 'YYYY-MM-01') AS ay, AVG(doviz_alis) AS deger
      FROM tcmb_kurlari
      WHERE doviz_cinsi = ${kod}::"DovizCinsi" AND tarih >= ${baslangic}::date AND tarih < ${sonrakiAy.toISOString().slice(0, 10)}::date
      GROUP BY 1`;
    const son = await tx.tcmbKuru.findFirst({ where: { dovizCinsi: kod }, orderBy: { tarih: "desc" }, select: { tarih: true } });
    return {
      kod, ad: KUR_ENDEKSLERI[kod], tur: "kur", bazYili: null,
      sonDonem: son ? son.tarih.toISOString().slice(0, 10) : null,
      degerler: new Map(satirlar.map((s) => [s.ay, new Prisma.Decimal(s.deger).toDecimalPlaces(6)])),
      zincirlenenDonemSayisi: 0,
    };
  }
  const seri = await seriOku(tx, kod, baslangic, bitis);
  if (!seri) throw new BadRequestException(`Bilinmeyen endeks: ${kod}`);
  return { ...seri, tur: "endeks" };
}
