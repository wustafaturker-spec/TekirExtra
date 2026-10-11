/**
 * RPR-14 (inceleme P1-4): fatura satır pivotu sunucuda, kayıtlı tutarlardan.
 * Eski sayfa son 300 faturayı çekip tutarı tarayıcıda miktar × fiyattan
 * yeniden hesaplıyordu: iptal/taslak dahil, kur yok, genel iskonto, tevkifat
 * ve KDV dışı vergiler yok sayılıyordu. Burada her tutar satırın kayıtlı
 * değeri × fatura kuru (TL), iadeler eksi; iptal edilmiş fatura hiç girmez.
 */
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Gruplanabilen boyutlar: anahtar (gruplama) ve etiket (görünen) SQL'i. */
export const PIVOT_BOYUTLARI = {
  cari: { ad: "Cari", anahtar: "c.id::text", etiket: "c.unvan" },
  urun: { ad: "Ürün / hizmet", anahtar: "s.id::text", etiket: "s.ad" },
  kategori: { ad: "Kategori", anahtar: "coalesce(k.id::text, '')", etiket: "coalesce(k.ad, 'Kategorisiz')" },
  tip: { ad: "Fatura tipi", anahtar: "f.tip::text", etiket: "f.tip::text" },
  durum: { ad: "Durum", anahtar: "f.durum::text", etiket: "f.durum::text" },
  yil: { ad: "Yıl", anahtar: "to_char(f.tarih, 'YYYY')", etiket: "to_char(f.tarih, 'YYYY')" },
  ay: { ad: "Ay", anahtar: "to_char(f.tarih, 'YYYY-MM')", etiket: "to_char(f.tarih, 'YYYY-MM')" },
  depo: { ad: "Depo", anahtar: "coalesce(d.id::text, '')", etiket: "coalesce(d.ad, 'Varsayılan depo')" },
  doviz: { ad: "Belge dövizi", anahtar: "f.doviz_cinsi::text", etiket: "f.doviz_cinsi::text" },
} as const;
export type PivotBoyutu = keyof typeof PIVOT_BOYUTLARI;

/** Enum değerlerinin görünen adları (sütun başlığında ham değer görünmesin). */
export const PIVOT_ETIKETLERI: Record<string, string> = {
  satis: "Satış", satis_iade: "Satış iadesi", alis: "Alış", alis_iade: "Alış iadesi",
  kesin: "Kesin", taslak: "Taslak",
};

const YON_TIPLERI = { satis: ["satis", "satis_iade"], alis: ["alis", "alis_iade"], tum: ["satis", "satis_iade", "alis", "alis_iade"] } as const;
const DURUMLAR = { kesin: ["kesin"], taslak: ["taslak"], kesin_taslak: ["kesin", "taslak"] } as const;
/** Sonuç hücresi sınırı; aşılırsa daha kaba bir boyut ya da dar dönem istenir. */
export const PIVOT_HUCRE_SINIRI = 5_000;
export const PIVOT_DETAY_SINIRI = 500;

export interface PivotSorgusu {
  baslangic: string; bitis: string;
  yon: keyof typeof YON_TIPLERI; durum: keyof typeof DURUMLAR;
  satir: PivotBoyutu; sutun: PivotBoyutu; arama?: string;
}

export interface PivotDegerleri { kalem: number; miktar: number; matrah: number; iskonto: number; kdv: number; toplam: number }
export interface PivotHucresi extends PivotDegerleri { satir: string; sutun: string }
export interface PivotSonucu {
  sorgu: PivotSorgusu;
  satirlar: { anahtar: string; etiket: string }[];
  sutunlar: { anahtar: string; etiket: string }[];
  hucreler: PivotHucresi[];
  /** Kurun 1 olduğu dövizli kesin fatura sayısı; tutarlar kuru eksik olabilir. */
  kursuzDovizli: number;
}

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const sec = <T extends string>(deger: string | undefined, izinli: readonly T[], varsayilan: T): T =>
  deger && (izinli as readonly string[]).includes(deger) ? (deger as T) : varsayilan;

/** Sorgu parametrelerini doğrular; dönem zorunlu ve en çok iki yıl. */
export function pivotSorgusuCoz(q: Record<string, string | undefined>): PivotSorgusu {
  if (!q.baslangic || !q.bitis || !TARIH.test(q.baslangic) || !TARIH.test(q.bitis)) throw new BadRequestException("Başlangıç ve bitiş tarihi (YYYY-AA-GG) zorunlu");
  if (q.baslangic > q.bitis) throw new BadRequestException("Başlangıç tarihi bitişten sonra olamaz");
  const gun = (Date.parse(q.bitis) - Date.parse(q.baslangic)) / 86_400_000;
  if (gun > 731) throw new BadRequestException("Dönem en çok iki yıl olabilir");
  const boyutlar = Object.keys(PIVOT_BOYUTLARI) as PivotBoyutu[];
  const satir = sec(q.satir, boyutlar, "cari");
  const sutun = sec(q.sutun, boyutlar, "ay");
  const arama = q.arama?.trim().slice(0, 100) || undefined;
  return {
    baslangic: q.baslangic, bitis: q.bitis,
    yon: sec(q.yon, ["tum", "satis", "alis"] as const, "satis"),
    durum: sec(q.durum, ["kesin", "taslak", "kesin_taslak"] as const, "kesin"),
    satir, sutun: sutun === satir ? (satir === "ay" ? "tip" : "ay") : sutun, arama,
  };
}

/** İade faturası toplamı düşürür. */
const ISARET = Prisma.raw("(CASE WHEN f.tip IN ('satis_iade', 'alis_iade') THEN -1 ELSE 1 END)");
const KAYNAK = Prisma.raw(`
  FROM fatura_satirlari fs
  JOIN faturalar f ON f.id = fs.fatura_id
  JOIN cari_hesaplar c ON c.id = f.cari_id
  JOIN stok_kartlari s ON s.id = fs.stok_id
  LEFT JOIN stok_kategorileri k ON k.id = s.kategori_id
  LEFT JOIN depolar d ON d.id = f.depo_id`);

function kosul(tenantId: string, q: PivotSorgusu): Prisma.Sql {
  const parcalar = [
    Prisma.sql`f.tenant_id = ${tenantId}::uuid`,
    Prisma.sql`f.tarih BETWEEN ${q.baslangic}::date AND ${q.bitis}::date`,
    Prisma.sql`f.tip::text IN (${Prisma.join([...YON_TIPLERI[q.yon]])})`,
    Prisma.sql`f.durum::text IN (${Prisma.join([...DURUMLAR[q.durum]])})`,
  ];
  if (q.arama) {
    const desen = `%${q.arama.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    parcalar.push(Prisma.sql`(coalesce(f.no, '') ILIKE ${desen} OR c.unvan ILIKE ${desen} OR s.ad ILIKE ${desen} OR s.kod ILIKE ${desen})`);
  }
  return Prisma.join(parcalar, " AND ");
}

const etiket = (boyut: PivotBoyutu, deger: string) =>
  ["tip", "durum"].includes(boyut) ? (PIVOT_ETIKETLERI[deger] ?? deger) : deger;

export async function faturaPivotu(tx: Tx, tenantId: string, q: PivotSorgusu): Promise<PivotSonucu> {
  const sb = PIVOT_BOYUTLARI[q.satir], kb = PIVOT_BOYUTLARI[q.sutun];
  const satirlar = await tx.$queryRaw<{ sa: string; se: string; ka: string; ke: string; kalem: number; miktar: string; matrah: string; iskonto: string; kdv: string; toplam: string }[]>`
    SELECT ${Prisma.raw(sb.anahtar)} AS sa, ${Prisma.raw(sb.etiket)} AS se,
           ${Prisma.raw(kb.anahtar)} AS ka, ${Prisma.raw(kb.etiket)} AS ke,
           count(*)::int AS kalem,
           sum(fs.miktar * ${ISARET})::text AS miktar,
           round(sum(fs.matrah * f.kur * ${ISARET}), 2)::text AS matrah,
           round(sum((fs.iskonto_tutari + fs.genel_iskonto_payi) * f.kur * ${ISARET}), 2)::text AS iskonto,
           round(sum(fs.kdv_tutari * f.kur * ${ISARET}), 2)::text AS kdv,
           round(sum(fs.toplam_tutar * f.kur * ${ISARET}), 2)::text AS toplam
    ${KAYNAK}
    WHERE ${kosul(tenantId, q)}
    GROUP BY 1, 2, 3, 4
    LIMIT ${PIVOT_HUCRE_SINIRI + 1}`;
  if (satirlar.length > PIVOT_HUCRE_SINIRI) {
    throw new BadRequestException(`Sonuç ${PIVOT_HUCRE_SINIRI} hücreyi aşıyor; dönemi daraltın ya da daha kaba bir boyut seçin`);
  }
  const [kursuz] = await tx.$queryRaw<{ sayi: number }[]>`
    SELECT count(DISTINCT f.id)::int AS sayi ${KAYNAK}
    WHERE ${kosul(tenantId, q)} AND f.doviz_cinsi::text <> 'TRY' AND f.kur = 1`;

  const satirMap = new Map<string, string>(), sutunMap = new Map<string, string>();
  const hucreler = satirlar.map((r) => {
    satirMap.set(r.sa, etiket(q.satir, r.se));
    sutunMap.set(r.ka, etiket(q.sutun, r.ke));
    return {
      satir: r.sa, sutun: r.ka, kalem: r.kalem, miktar: Number(r.miktar), matrah: Number(r.matrah),
      iskonto: Number(r.iskonto), kdv: Number(r.kdv), toplam: Number(r.toplam),
    };
  });
  const sirala = (m: Map<string, string>) =>
    [...m].map(([anahtar, etiket]) => ({ anahtar, etiket })).sort((a, b) => a.etiket.localeCompare(b.etiket, "tr"));
  return { sorgu: q, satirlar: sirala(satirMap), sutunlar: sirala(sutunMap), hucreler, kursuzDovizli: kursuz?.sayi ?? 0 };
}

export interface PivotDetaySatiri {
  faturaId: string; faturaNo: string | null; tarih: string; tip: string; durum: string; dovizCinsi: string;
  cariUnvan: string; stokKod: string; stokAd: string; miktar: number; birim: string; matrah: number; kdv: number; toplam: number;
}

/** Bir pivot satırının (ve isteğe bağlı sütununun) kalemleri; en yeni önce, sınırlı. */
export async function faturaPivotDetayi(tx: Tx, tenantId: string, q: PivotSorgusu, satirAnahtari: string, sutunAnahtari?: string) {
  const ek = [Prisma.sql`${Prisma.raw(PIVOT_BOYUTLARI[q.satir].anahtar)} = ${satirAnahtari}`];
  if (sutunAnahtari !== undefined) ek.push(Prisma.sql`${Prisma.raw(PIVOT_BOYUTLARI[q.sutun].anahtar)} = ${sutunAnahtari}`);
  const satirlar = await tx.$queryRaw<(Omit<PivotDetaySatiri, "miktar" | "matrah" | "kdv" | "toplam"> & { miktar: string; matrah: string; kdv: string; toplam: string })[]>`
    SELECT f.id AS "faturaId", f.no AS "faturaNo", to_char(f.tarih, 'YYYY-MM-DD') AS tarih, f.tip::text AS tip, f.durum::text AS durum,
           f.doviz_cinsi::text AS "dovizCinsi", c.unvan AS "cariUnvan", s.kod AS "stokKod", s.ad AS "stokAd", fs.birim,
           (fs.miktar * ${ISARET})::text AS miktar,
           round(fs.matrah * f.kur * ${ISARET}, 2)::text AS matrah,
           round(fs.kdv_tutari * f.kur * ${ISARET}, 2)::text AS kdv,
           round(fs.toplam_tutar * f.kur * ${ISARET}, 2)::text AS toplam
    ${KAYNAK}
    WHERE ${kosul(tenantId, q)} AND ${Prisma.join(ek, " AND ")}
    ORDER BY f.tarih DESC, f.created_at DESC
    LIMIT ${PIVOT_DETAY_SINIRI + 1}`;
  return {
    satirlar: satirlar.slice(0, PIVOT_DETAY_SINIRI).map((r) => ({
      ...r, miktar: Number(r.miktar), matrah: Number(r.matrah), kdv: Number(r.kdv), toplam: Number(r.toplam),
    })) as PivotDetaySatiri[],
    kesildi: satirlar.length > PIVOT_DETAY_SINIRI,
  };
}
