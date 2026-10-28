/**
 * KSB-16: carinin vadeye göre denkleştirilmesi (veritabanı tarafı). Elle
 * kapamalar sabittir; otomatik kapamalar her çağrıda baştan hesaplanır. Cari
 * satırı kilitlenir: aynı cariye eşzamanlı iki denkleştirme birbirini ezmez.
 * Hesap `denklestirme-hesap.ts`'te.
 */
import { Prisma } from "@prisma/client";
import { denklestir, type AcikFatura, type FaturaTipi, type OdemeKaynagi, type YeniKapama } from "./denklestirme-hesap";
import { otomatikMahsupUygula } from "./mahsup";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Fatura kapatabilen kasa/banka kaynakları; personel, masraf, kredi, döviz işlemi, açılış kapatmaz. */
export const KAPATAN_KASA_KAYNAKLARI = ["manuel", "fatura_kapama", "pos_tahsilat", "odeme_talimati"];
const FATURA_TIPLERI: FaturaTipi[] = ["satis", "alis", "satis_iade", "alis_iade"];

export interface DenklestirmeSecenegi {
  /** Göç öncesi ödeme/iadeleri de dağıt ("vadeye göre yeniden denkleştir"); başlangıç damgası kalkar. */
  tumu?: boolean;
  /** Yazmadan sonucu döndür. */
  onizleme?: boolean;
}

export interface DenklestirmeSonucu {
  kapamalar: (YeniKapama & { dovizCinsi: string })[];
}

const ekle = (m: Map<string, Prisma.Decimal>, k: string, v: Prisma.Decimal) => m.set(k, (m.get(k) ?? D(0)).add(v));

export async function cariDenklestir(tx: Tx, tenantId: string, cariId: string, secenek: DenklestirmeSecenegi = {}): Promise<DenklestirmeSonucu> {
  await tx.$queryRaw`SELECT id FROM cari_hesaplar WHERE id = ${cariId}::uuid FOR UPDATE`;
  const cari = await tx.cariHesap.findUnique({ where: { id: cariId }, select: { denklestirmeBaslangic: true, otomatikMahsup: true } });
  if (!cari) return { kapamalar: [] };
  const baslangic = secenek.tumu ? null : cari.denklestirmeBaslangic;
  const uygun = (createdAt: Date) => !baslangic || createdAt >= baslangic;

  const [faturalar, elle, kasaHareketleri, kartHareketleri, cekler] = await Promise.all([
    tx.fatura.findMany({
      where: { cariId, durum: "kesin", tip: { in: FATURA_TIPLERI } },
      select: { id: true, no: true, tip: true, tarih: true, vadeTarihi: true, createdAt: true, dovizCinsi: true, genelToplam: true },
    }),
    tx.faturaKapama.findMany({ where: { cariId, otomatik: false } }),
    tx.kasaBankaHareket.findMany({
      where: { cariId, tip: { in: ["tahsilat", "tediye"] }, kaynakTur: { in: KAPATAN_KASA_KAYNAKLARI } },
      select: { id: true, tip: true, tutar: true, dovizCinsi: true, tarih: true, createdAt: true, faturaId: true, fatura: { select: { dovizCinsi: true } } },
    }),
    tx.krediKartiHareket.findMany({
      where: { cariId, tip: "harcama", geriAlinanHareketId: null },
      select: { id: true, tutar: true, cariOdemeTutari: true, tarih: true, createdAt: true, krediKarti: { select: { dovizCinsi: true } } },
    }),
    tx.cekSenet.findMany({
      where: { OR: [{ cariId }, { ciroCariId: cariId, durum: "ciro_edildi" }], durum: { notIn: ["karsiliksiz", "iade_edildi"] } },
      select: { id: true, yon: true, cariId: true, ciroCariId: true, durum: true, tutar: true, dovizCinsi: true, islemTarihi: true, createdAt: true },
    }),
  ]);

  // Kaynakları düşenler: ters kayıt ve POS iadesi (kasa/banka), geri alınan kart harcaması.
  const kasaIdleri = kasaHareketleri.map((h) => h.id);
  const [tersler, posTahsilatlari, kartGeriAlmalari] = await Promise.all([
    kasaIdleri.length ? tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: kasaIdleri } }, select: { kaynakRef: true, tutar: true } }) : [],
    kasaIdleri.length ? tx.posTahsilat.findMany({ where: { hareketId: { in: kasaIdleri } }, select: { id: true, hareketId: true } }) : [],
    kartHareketleri.length ? tx.krediKartiHareket.findMany({ where: { geriAlinanHareketId: { in: kartHareketleri.map((h) => h.id) } }, select: { geriAlinanHareketId: true } }) : [],
  ]);
  const posIadeleri = posTahsilatlari.length
    ? await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "pos_iade", kaynakRef: { in: posTahsilatlari.map((p) => p.id) } }, select: { kaynakRef: true, tutar: true } })
    : [];
  const dusulen = new Map<string, Prisma.Decimal>();
  for (const t of tersler) if (t.kaynakRef) ekle(dusulen, t.kaynakRef, t.tutar);
  const posHareketi = new Map(posTahsilatlari.map((p) => [p.id, p.hareketId]));
  for (const i of posIadeleri) { const h = i.kaynakRef && posHareketi.get(i.kaynakRef); if (h) ekle(dusulen, h, i.tutar); }
  const geriAlinanKart = new Set(kartGeriAlmalari.map((g) => g.geriAlinanHareketId));

  // Elle kapamaların faturadan ve kaynaktan düştüğü tutarlar.
  const faturaKapanan = new Map<string, Prisma.Decimal>();
  const kaynakKullanilan = new Map<string, Prisma.Decimal>();
  for (const k of elle) {
    ekle(faturaKapanan, k.faturaId, k.tutar);
    if (k.iadeFaturaId) ekle(faturaKapanan, k.iadeFaturaId, k.tutar);
    const kaynak = k.kasaBankaHareketId ?? k.krediKartiHareketId ?? k.cekSenetId;
    // KSB-20: farklı dövizli bağlamada kaynaktan kendi dövizindeki tutar düşer.
    if (kaynak) ekle(kaynakKullanilan, kaynak, k.kaynakTutari ?? k.tutar);
  }

  const kaynaklar: (OdemeKaynagi & { dovizCinsi: string })[] = [];
  const kalanTutar = (id: string, brut: Prisma.Decimal) => brut.sub(dusulen.get(id) ?? 0).sub(kaynakKullanilan.get(id) ?? 0);
  for (const h of kasaHareketleri) {
    // Farklı dövizli faturaya elle bağlanan ödeme karşılığıyla kapatır; artanı elle kalır.
    if (h.faturaId && h.fatura && h.fatura.dovizCinsi !== h.dovizCinsi) continue;
    // Göç öncesi ödemenin elle bağlanmamış artığı otomatik dağıtılmaz.
    if (!uygun(h.createdAt)) continue;
    kaynaklar.push({ tur: "kasa_banka", id: h.id, yon: h.tip === "tahsilat" ? "A" : "B", tarih: h.tarih, createdAt: h.createdAt, tutar: kalanTutar(h.id, h.tutar), dovizCinsi: h.dovizCinsi });
  }
  for (const h of kartHareketleri) {
    if (geriAlinanKart.has(h.id) || !uygun(h.createdAt)) continue;
    kaynaklar.push({ tur: "kredi_karti", id: h.id, yon: "B", tarih: h.tarih, createdAt: h.createdAt, tutar: kalanTutar(h.id, h.cariOdemeTutari ?? h.tutar), dovizCinsi: h.krediKarti.dovizCinsi });
  }
  for (const c of cekler) {
    if (!uygun(c.createdAt)) continue;
    // Alınan çek vereninin tahsilatı; verilen çek ve bu cariye ciro edilen çek ödemedir.
    const yon = c.ciroCariId === cariId && c.durum === "ciro_edildi" ? "B" : c.yon === "alinan" ? "A" : "B";
    kaynaklar.push({ tur: "cek_senet", id: c.id, yon, tarih: c.islemTarihi, createdAt: c.createdAt, tutar: kalanTutar(c.id, c.tutar), dovizCinsi: c.dovizCinsi });
  }

  const sonuc: DenklestirmeSonucu["kapamalar"] = [];
  for (const doviz of new Set([...faturalar.map((f) => f.dovizCinsi), ...kaynaklar.map((k) => k.dovizCinsi)])) {
    const acik: AcikFatura[] = faturalar.filter((f) => f.dovizCinsi === doviz).map((f) => ({
      id: f.id, no: f.no, tip: f.tip as FaturaTipi, tarih: f.tarih, vadeTarihi: f.vadeTarihi, createdAt: f.createdAt,
      kalan: Prisma.Decimal.max(f.genelToplam.sub(faturaKapanan.get(f.id) ?? 0), 0),
      kaynakOlabilir: uygun(f.createdAt),
    }));
    for (const k of denklestir(acik, kaynaklar.filter((k) => k.dovizCinsi === doviz))) sonuc.push({ ...k, dovizCinsi: doviz });
  }
  if (secenek.onizleme) return { kapamalar: sonuc };

  await tx.faturaKapama.deleteMany({ where: { cariId, otomatik: true } });
  if (sonuc.length) {
    await tx.faturaKapama.createMany({
      data: sonuc.map((k) => ({
        tenantId, cariId, faturaId: k.faturaId, tutar: k.tutar, otomatik: true,
        ...(k.kaynakTur === "kasa_banka" ? { kasaBankaHareketId: k.kaynakId }
          : k.kaynakTur === "kredi_karti" ? { krediKartiHareketId: k.kaynakId }
          : k.kaynakTur === "cek_senet" ? { cekSenetId: k.kaynakId }
          : { iadeFaturaId: k.kaynakId }),
      })),
    });
  }
  if (secenek.tumu && cari.denklestirmeBaslangic) await tx.cariHesap.update({ where: { id: cariId }, data: { denklestirmeBaslangic: null } });
  // KSB-25: ödemelerden sonra kalan açık alış ve satış faturaları birbirine karşı kapanır.
  if (cari.otomatikMahsup) await otomatikMahsupUygula(tx, tenantId, cariId);
  return { kapamalar: sonuc };
}

/** Birden çok cariyi (ör. bir işlemin dokunduğu) sırayla denkleştirir; boş ve tekrarlanan kimlikler atlanır. */
export async function carileriDenklestir(tx: Tx, tenantId: string, cariIdler: (string | null | undefined)[]) {
  for (const id of [...new Set(cariIdler.filter((x): x is string => Boolean(x)))].sort()) await cariDenklestir(tx, tenantId, id);
}

/** Elle kapamanın kaynağı (tam olarak biri). */
export type KapamaKaynagi = { kasaBankaHareketId: string } | { krediKartiHareketId: string };

/**
 * Ödeme bir faturaya elle bağlandığında kapamayı yazar ya da tutarını
 * günceller (POS iadesi düşürür); tutar sıfırsa kapama kalkar.
 */
export async function elleKapamaYaz(tx: Tx, girdi: { tenantId: string; cariId: string; faturaId: string; tutar: Prisma.Decimal; kaynak: KapamaKaynagi }) {
  await tx.faturaKapama.deleteMany({ where: { ...girdi.kaynak, faturaId: girdi.faturaId, otomatik: false } });
  if (!girdi.tutar.gt(0)) return;
  await tx.faturaKapama.create({ data: { tenantId: girdi.tenantId, cariId: girdi.cariId, faturaId: girdi.faturaId, tutar: girdi.tutar.toDecimalPlaces(2), otomatik: false, ...girdi.kaynak } });
}

/** Geri alınan/ters kaydedilen ödemenin bütün kapamaları (elle dahil) çözülür. */
export async function kaynakKapamalariniCoz(tx: Tx, kaynak: { kasaBankaHareketIdler?: string[]; krediKartiHareketIdler?: string[] }) {
  const kosul: Prisma.FaturaKapamaWhereInput[] = [];
  if (kaynak.kasaBankaHareketIdler?.length) kosul.push({ kasaBankaHareketId: { in: kaynak.kasaBankaHareketIdler } });
  if (kaynak.krediKartiHareketIdler?.length) kosul.push({ krediKartiHareketId: { in: kaynak.krediKartiHareketIdler } });
  if (kosul.length) await tx.faturaKapama.deleteMany({ where: { OR: kosul } });
}

/** İptal edilen ya da taslağa dönen faturanın kapattığı ve (iadeyse) kapattırdığı bütün kapamalar çözülür. */
export async function faturaKapamalariniCoz(tx: Tx, faturaId: string) {
  await tx.faturaKapama.deleteMany({ where: { OR: [{ faturaId }, { iadeFaturaId: faturaId }] } });
}


/** Kapamanın ekranda gösterilen kaynağı (fatura detayı). */
export function kapamaKaynagi(k: {
  kasaBankaHareket: { id: string; tip: string; tarih: Date; aciklama: string | null; makbuzNo: string | null } | null;
  krediKartiHareket: { id: string; tarih: Date; aciklama: string } | null;
  cekSenet: { id: string; tur: string; portfoyNo: string; islemTarihi: Date } | null;
  iadeFatura: { id: string; no: string | null; tarih: Date } | null;
  mahsup?: { id: string; tarih: Date; otomatik: boolean } | null;
}) {
  const gun = (d: Date) => d.toISOString().slice(0, 10);
  if (k.kasaBankaHareket) return { kaynakTur: "kasa_banka" as const, kaynakId: k.kasaBankaHareket.id, tarih: gun(k.kasaBankaHareket.tarih), etiket: k.kasaBankaHareket.makbuzNo ?? k.kasaBankaHareket.aciklama ?? (k.kasaBankaHareket.tip === "tahsilat" ? "Tahsilat" : "Tediye") };
  if (k.krediKartiHareket) return { kaynakTur: "kredi_karti" as const, kaynakId: k.krediKartiHareket.id, tarih: gun(k.krediKartiHareket.tarih), etiket: k.krediKartiHareket.aciklama };
  if (k.cekSenet) return { kaynakTur: "cek_senet" as const, kaynakId: k.cekSenet.id, tarih: gun(k.cekSenet.islemTarihi), etiket: `${k.cekSenet.tur === "cek" ? "Çek" : "Senet"} ${k.cekSenet.portfoyNo}` };
  if (k.mahsup) return { kaynakTur: "mahsup" as const, kaynakId: k.mahsup.id, tarih: gun(k.mahsup.tarih), etiket: k.mahsup.otomatik ? "Otomatik alış–satış mahsubu" : "Alış–satış mahsubu" };
  if (k.iadeFatura) return { kaynakTur: "iade_fatura" as const, kaynakId: k.iadeFatura.id, tarih: gun(k.iadeFatura.tarih), etiket: k.iadeFatura.no ?? "İade faturası" };
  return { kaynakTur: "bilinmiyor" as const, kaynakId: null, tarih: null, etiket: "—" };
}

/**
 * Cari kartındaki "Vadeye göre yeniden denkleştir" (KSB-16): göç öncesi
 * ödeme ve iadeler de dahil bütün kaynaklar vadeye göre dağıtılır. Önizlemede
 * yazılmaz; her açık faturanın önceki ve sonraki kalanı döner.
 */
export async function yenidenDenklestir(tx: Tx, tenantId: string, cariId: string, uygula: boolean) {
  const cari = await tx.cariHesap.findUnique({ where: { id: cariId }, select: { denklestirmeBaslangic: true } });
  if (!cari) return null;
  const once = await tx.fatura.findMany({
    where: { cariId, durum: "kesin", tip: { in: FATURA_TIPLERI } },
    select: { id: true, no: true, tip: true, tarih: true, vadeTarihi: true, dovizCinsi: true, genelToplam: true, kapamalar: { select: { tutar: true, otomatik: true } }, iadeKapamalari: { select: { tutar: true, otomatik: true } } },
  });
  const { kapamalar } = await cariDenklestir(tx, tenantId, cariId, { tumu: true, onizleme: !uygula });
  const yeni = new Map<string, Prisma.Decimal>();
  for (const k of kapamalar) {
    ekle(yeni, k.faturaId, k.tutar);
    if (k.kaynakTur === "iade_fatura") ekle(yeni, k.kaynakId, k.tutar);
  }
  const toplam = (liste: { tutar: Prisma.Decimal }[]) => liste.reduce((t, k) => t.add(k.tutar), D(0));
  const faturalar = once.map((f) => {
    const tumu = [...f.kapamalar, ...f.iadeKapamalari];
    const kalanOnce = Prisma.Decimal.max(f.genelToplam.sub(toplam(tumu)), 0);
    const kalanSonra = Prisma.Decimal.max(f.genelToplam.sub(toplam(tumu.filter((k) => !k.otomatik))).sub(yeni.get(f.id) ?? 0), 0);
    return { id: f.id, no: f.no, tip: f.tip, tarih: f.tarih.toISOString().slice(0, 10), vadeTarihi: f.vadeTarihi?.toISOString().slice(0, 10) ?? null, dovizCinsi: f.dovizCinsi, genelToplam: f.genelToplam.toFixed(2), kalanOnce: kalanOnce.toFixed(2), kalanSonra: kalanSonra.toFixed(2) };
  }).filter((f) => f.kalanOnce !== f.kalanSonra || f.kalanSonra !== "0.00")
    .sort((a, b) => (a.vadeTarihi ?? a.tarih).localeCompare(b.vadeTarihi ?? b.tarih));
  return { bekleyenGecmisVar: Boolean(cari.denklestirmeBaslangic), degisenFatura: faturalar.filter((f) => f.kalanOnce !== f.kalanSonra).length, faturalar, uygulandi: uygula };
}
