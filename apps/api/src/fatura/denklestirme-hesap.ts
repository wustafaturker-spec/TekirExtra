/**
 * KSB-16: vadeye göre denkleştirmenin saf hesabı (veritabanı yok). Girdi bir
 * carinin tek dövizdeki açık kalemleridir; çıktı yeni otomatik kapamalardır.
 *
 * İki yön bağımsızdır:
 *   A — tahsilatla kapanan: satış ve alış iadesi faturaları; kaynak tahsilat,
 *       alınan çek ve (satış faturasına karşı) satış iadesi faturası.
 *   B — ödemeyle kapanan: alış ve satış iadesi faturaları; kaynak tediye,
 *       kredi kartı, verilen/ciro çek ve (alış faturasına karşı) alış iadesi.
 * Sıra: önce iade faturaları karşı türdeki faturaları kapatır, sonra
 * ödemeler kalanları. Bir yöndeki ödemenin o yöndeki faturaları aşan kısmı
 * cariye geri ödemedir (ör. müşteriye avans iadesi): karşı yönün
 * kaynaklarından, en eskisinden başlayarak düşülür; böylece kapanan tutar
 * carinin bakiyesini aşmaz. Faturalar vadeye (yoksa fatura tarihine), sonra
 * fatura tarihine ve numaraya göre; kaynaklar tarih ve kayıt sırasıyla.
 */
import { Prisma } from "@prisma/client";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type FaturaTipi = "satis" | "alis" | "satis_iade" | "alis_iade";
export type KaynakTuru = "kasa_banka" | "kredi_karti" | "cek_senet" | "iade_fatura";

export interface AcikFatura {
  id: string; no: string | null; tip: FaturaTipi;
  tarih: Date; vadeTarihi: Date | null; createdAt: Date;
  /** Elle kapamalar düşülmüş kalan (fatura dövizinde). */
  kalan: Prisma.Decimal;
  /** İade faturasında: kaynak olarak kullanılabilir mi (denkleştirme başlangıcından sonra mı). */
  kaynakOlabilir?: boolean;
}

export interface OdemeKaynagi {
  tur: Exclude<KaynakTuru, "iade_fatura">;
  id: string;
  /** A: tahsilat yönü, B: ödeme yönü. */
  yon: "A" | "B";
  tarih: Date; createdAt: Date;
  /** Elle kapamalar ve iadeler/ters kayıtlar düşülmüş kullanılabilir tutar. */
  tutar: Prisma.Decimal;
}

export interface YeniKapama { faturaId: string; tutar: Prisma.Decimal; kaynakTur: KaynakTuru; kaynakId: string }

const vade = (f: AcikFatura) => (f.vadeTarihi ?? f.tarih).getTime();
export function faturaSirasi(a: AcikFatura, b: AcikFatura) {
  return vade(a) - vade(b) || a.tarih.getTime() - b.tarih.getTime()
    || (a.no ?? "￿").localeCompare(b.no ?? "￿") || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}
const kaynakSirasi = (a: { tarih: Date; createdAt: Date; id: string }, b: { tarih: Date; createdAt: Date; id: string }) =>
  a.tarih.getTime() - b.tarih.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/** Kaynakları sırayla en erken vadeli açık faturalara dağıtır; faturaların kalanını yerinde azaltır. */
function dagit(kaynaklar: { tur: KaynakTuru; id: string; tutar: Prisma.Decimal }[], faturalar: AcikFatura[], sonuc: YeniKapama[], kaynakKalani?: Map<string, Prisma.Decimal>) {
  for (const k of kaynaklar) {
    let kalan = k.tutar;
    for (const f of faturalar) {
      if (!kalan.gt(0)) break;
      if (!f.kalan.gt(0)) continue;
      const tutar = Prisma.Decimal.min(kalan, f.kalan);
      sonuc.push({ faturaId: f.id, tutar, kaynakTur: k.tur, kaynakId: k.id });
      f.kalan = f.kalan.sub(tutar);
      kalan = kalan.sub(tutar);
    }
    kaynakKalani?.set(k.id, kalan);
  }
}

export function denklestir(faturalar: AcikFatura[], odemeler: OdemeKaynagi[]): YeniKapama[] {
  const sonuc: YeniKapama[] = [];
  const kopya = faturalar.map((f) => ({ ...f, kalan: D(f.kalan) })).sort(faturaSirasi);
  const tip = (t: FaturaTipi) => kopya.filter((f) => f.tip === t);

  // 1. İadeler karşı türdeki faturaları kapatır (iadenin kendi kalanı da düşer).
  for (const [iadeTipi, hedefTipi] of [["satis_iade", "satis"], ["alis_iade", "alis"]] as const) {
    const iadeler = tip(iadeTipi).filter((f) => f.kaynakOlabilir !== false && f.kalan.gt(0)).sort((a, b) => kaynakSirasi(a, b));
    const kaynakKalani = new Map<string, Prisma.Decimal>();
    dagit(iadeler.map((f) => ({ tur: "iade_fatura" as const, id: f.id, tutar: f.kalan })), tip(hedefTipi), sonuc, kaynakKalani);
    for (const f of iadeler) f.kalan = kaynakKalani.get(f.id) ?? f.kalan;
  }

  // 2. Ödemeler kalanları vade sırasıyla kapatır; karşı yöne geri ödenen fazla önce düşülür.
  const yonA = kopya.filter((f) => f.tip === "satis" || f.tip === "alis_iade");
  const yonB = kopya.filter((f) => f.tip === "alis" || f.tip === "satis_iade");
  const sirali = [...odemeler].filter((o) => o.tutar.gt(0)).sort(kaynakSirasi);
  const a = sirali.filter((o) => o.yon === "A");
  const b = sirali.filter((o) => o.yon === "B");
  const fazla = (kaynaklar: OdemeKaynagi[], faturalar: AcikFatura[]) =>
    Prisma.Decimal.max(toplam(kaynaklar.map((k) => k.tutar)).sub(toplam(faturalar.map((f) => f.kalan))), 0);
  const [fazlaA, fazlaB] = [fazla(a, yonA), fazla(b, yonB)];
  dagit(kirp(a, fazlaB), yonA, sonuc);
  dagit(kirp(b, fazlaA), yonB, sonuc);
  return sonuc;
}

const toplam = (tutarlar: Prisma.Decimal[]) => tutarlar.reduce((t, x) => t.add(x), D(0));

/** Kaynakların toplamından `miktar` kadarını en eskiden başlayarak düşer. */
function kirp(kaynaklar: OdemeKaynagi[], miktar: Prisma.Decimal): OdemeKaynagi[] {
  let kalan = miktar;
  return kaynaklar.map((k) => {
    const dus = Prisma.Decimal.min(k.tutar, kalan);
    kalan = kalan.sub(dus);
    return { ...k, tutar: k.tutar.sub(dus) };
  });
}
