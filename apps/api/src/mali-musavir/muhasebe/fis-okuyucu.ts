import { Prisma } from "@prisma/client";
import type { MuhasebeHesapAnahtari } from "@tekirextra/shared";
import type {
  BordroGirdisi,
  CariBilgi,
  CariDuzeltmeGirdisi,
  CekGirdisi,
  DovizIslemGirdisi,
  FaturaGirdisi,
  GelirGirdisi,
  HareketGirdisi,
  HesapBilgi,
  KartGirdisi,
  MasrafGirdisi,
  UreticiGirdisi,
} from "./fis-uretici";

/**
 * MUH-04: dönemin kaynak kayıtlarını fiş üreticinin düz girdisine çevirir.
 * Dönem içindeki kayıtların yanında, karşı hesabı belirlemek için gereken
 * dönem dışı bağlar da okunur (virmanın öbür bacağı, ters kaydın aslı,
 * ödemesi bu dönemde olan eski masraf, tahsili bu dönemde olan eski çek).
 */

const gun = (t: Date) => t.toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Maaş bordro programından gelir; açılış fişi muhasebede ayrıca açılır (MUH-01). */
/** PRS-19: maaş ve avans hareketleri artık fişlenir (335/196); yalnız açılış kapsam dışı. */
const KAPSAM_DISI_HAREKET = ["acilis"];

type Tx = Prisma.TransactionClient;
type HesapRef = { tur: "kasa" | "banka" | "pos"; id: string } | null;
const hesapRef = (h: { kasaId: string | null; bankaHesapId: string | null; posHesapId: string | null }): HesapRef =>
  h.kasaId ? { tur: "kasa", id: h.kasaId } : h.bankaHesapId ? { tur: "banka", id: h.bankaHesapId } : h.posHesapId ? { tur: "pos", id: h.posHesapId } : null;

const HAREKET_SECIMI = {
  id: true, tip: true, tarih: true, tutar: true, tutarTry: true, dovizCinsi: true, kur: true, aciklama: true, makbuzNo: true,
  kaynakTur: true, kaynakRef: true, kasaId: true, bankaHesapId: true, posHesapId: true, karsiHareketId: true,
  cariId: true, faturaId: true, faturaKarsiligi: true,
  fatura: { select: { tip: true, dovizCinsi: true } },
  masraf: { select: { id: true } },
  gelirKaydi: { select: { id: true } },
} satisfies Prisma.KasaBankaHareketSelect;

type HamHareket = Prisma.KasaBankaHareketGetPayload<{ select: typeof HAREKET_SECIMI }>;

export async function uretimGirdisiOku(tx: Tx, tenantId: string, baslangic: string, bitis: string): Promise<UreticiGirdisi> {
  const aralik = { gte: new Date(`${baslangic}T00:00:00.000Z`), lte: new Date(`${bitis}T00:00:00.000Z`) };

  const [ayar, cariler, kasalar, bankalar, poslar, kartlar, krediler, dovizIslemleri] = await Promise.all([
    tx.muhasebeAyari.findUnique({ where: { tenantId } }),
    tx.cariHesap.findMany({ select: { id: true, kod: true, unvan: true, tip: true, muhasebeKodu: true } }),
    tx.kasa.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, ad: true, dovizCinsi: true, muhasebeKodu: true } }),
    tx.bankaHesap.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, ad: true, dovizCinsi: true, muhasebeKodu: true } }),
    tx.posHesap.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, ad: true, dovizCinsi: true, muhasebeKodu: true } }),
    tx.krediKarti.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, ad: true, dovizCinsi: true, muhasebeKodu: true } }),
    tx.bankaKredisi.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, ad: true, dovizCinsi: true, muhasebeKodu: true } }),
    tx.dovizIslemi.findMany({ where: { tarih: aralik } }),
  ]);
  // CARI-28: elle cari düzeltmesi fişlenir; açılış bakiyesi (acilis) fişlenmez.
  const cariDuzeltmeleri = await tx.cariHareket.findMany({ where: { tarih: aralik, kaynakTur: "manuel" }, orderBy: { tarih: "asc" } });
  // PRS-19: onaylı bordrolar (tahakkuk tarihi dönem sonu) ve personel carileri.
  const personeller = await tx.personel.findMany({ select: { personelNo: true, cariId: true } });
  const donemler: Array<{ donemYil: number; donemAy: number }> = [];
  for (let t = new Date(Date.UTC(aralik.gte.getUTCFullYear(), aralik.gte.getUTCMonth(), 1)); t <= aralik.lte; t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1))) {
    const son = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
    if (son >= aralik.gte && son <= aralik.lte) donemler.push({ donemYil: t.getUTCFullYear(), donemAy: t.getUTCMonth() + 1 });
  }
  const bordrolar = donemler.length ? await tx.personelBordro.findMany({
    where: { durum: { in: ["onaylandi", "kismen_odendi", "odendi"] }, OR: donemler },
    select: { id: true, donemYil: true, donemAy: true, odenecekTutar: true, hesapOzeti: true, personel: { select: { personelNo: true, ad: true, soyad: true } }, kalemler: { select: { tip: true, kod: true, aciklama: true, tutar: true } } },
  }) : [];

  const hesaplar = new Map<string, HesapBilgi>();
  const hesapEkle = (tur: HesapBilgi["tur"], liste: Array<{ id: string; ad: string; dovizCinsi: string; muhasebeKodu: string | null }>) =>
    liste.forEach((h, i) => hesaplar.set(`${tur}:${h.id}`, { tur, id: h.id, ad: h.ad, dovizCinsi: h.dovizCinsi, sira: i + 1, muhasebeKodu: h.muhasebeKodu }));
  hesapEkle("kasa", kasalar);
  hesapEkle("banka", bankalar);
  hesapEkle("pos", poslar);
  hesapEkle("kart", kartlar);
  hesapEkle("kredi", krediler);

  // Döviz alım/satımının kambiyo kaydı işlemin kendi fişindedir; ayrıca fişlenmez.
  const kambiyoMasraflari = new Set(dovizIslemleri.map((d) => d.kambiyoMasrafId).filter((x): x is string => Boolean(x)));
  const kambiyoGelirleri = new Set(dovizIslemleri.map((d) => d.kambiyoGelirId).filter((x): x is string => Boolean(x)));
  const bacaklar = await tx.kasaBankaHareket.findMany({
    where: { id: { in: dovizIslemleri.flatMap((d) => [d.gidisHareketId, d.gelisHareketId]) } },
    select: { id: true, kasaId: true, bankaHesapId: true, posHesapId: true },
  });
  const bacak = (id: string) => hesapRef(bacaklar.find((b) => b.id === id) ?? { kasaId: null, bankaHesapId: null, posHesapId: null });

  const [faturalar, kurFarkiBaglari, hamHareketler, masraflar, gelirler, kartHareketleri, cekOlaylari] = await Promise.all([
    tx.fatura.findMany({
      where: { durum: "kesin", tip: { in: ["satis", "alis", "satis_iade", "alis_iade"] }, tarih: aralik },
      select: {
        id: true, no: true, tip: true, tarih: true, cariId: true, dovizCinsi: true, kur: true,
        toplamMatrah: true, toplamKdv: true, toplamNetKdv: true, toplamTevkifat: true, genelToplam: true,
        ihracatTeslimSarti: true, ihracKayitliKodu: true,
        satirlar: { select: { matrah: true, stok: { select: { tip: true } }, maliyetDagitimlari: { where: { durum: "aktif" }, select: { id: true } } } },
      },
    }),
    tx.kasaBankaHareket.findMany({ where: { kurFarkiFaturaId: { not: null } }, select: { kurFarkiFaturaId: true } }),
    tx.kasaBankaHareket.findMany({ where: { tarih: aralik, kaynakTur: { notIn: KAPSAM_DISI_HAREKET } }, select: HAREKET_SECIMI }),
    tx.masraf.findMany({ where: { durum: "onaylandi", tarih: aralik, id: { notIn: [...kambiyoMasraflari] } }, include: { kategori: { select: { ad: true, muhasebeKodu: true } }, maliyetDagitimlari: { where: { durum: "aktif" }, select: { id: true } } } }),
    tx.gelirKaydi.findMany({ where: { tarih: aralik, id: { notIn: [...kambiyoGelirleri] } }, include: { kategori: { select: { ad: true, muhasebeKodu: true } } } }),
    tx.krediKartiHareket.findMany({ where: { tarih: aralik } }),
    tx.cekSenetOlay.findMany({ where: { islemTarihi: aralik }, select: { cekSenetId: true } }),
  ]);
  const kurFarkiFaturalari = new Set(kurFarkiBaglari.map((b) => b.kurFarkiFaturaId));

  // Dövizli alım/satımın iki bacağı işlemin fişindedir; masraf ödemesi gibi diğer kayıtları kalır.
  const hareketlerHam = hamHareketler.filter((h) => !(h.kaynakTur === "doviz_islem" && (h.tip === "virman_gidis" || h.tip === "virman_gelis")));
  const ekIdler = new Set<string>();
  for (const h of hareketlerHam) {
    if (h.karsiHareketId) ekIdler.add(h.karsiHareketId);
    if (h.kaynakTur === "ters_kayit" && h.kaynakRef && UUID.test(h.kaynakRef)) ekIdler.add(h.kaynakRef);
  }
  const ekHam = ekIdler.size ? await tx.kasaBankaHareket.findMany({ where: { id: { in: [...ekIdler] } }, select: HAREKET_SECIMI }) : [];
  const tumHamHareketler = [...hareketlerHam, ...ekHam];
  const hareketIdleri = tumHamHareketler.map((h) => h.id);

  const kartIdleri = [...new Set(kartHareketleri.map((k) => k.geriAlinanHareketId).filter((x): x is string => Boolean(x)))];
  const ekKartHam = kartIdleri.length ? await tx.krediKartiHareket.findMany({ where: { id: { in: kartIdleri } } }) : [];
  const tumKartHam = [...kartHareketleri, ...ekKartHam];

  const krediIslemleri = await tx.bankaKrediIslemi.findMany({ where: { hareketId: { in: hareketIdleri } } });
  const krediHareketten = new Map(krediIslemleri.map((i) => [i.hareketId, i]));
  const [masrafOdemeleri, kartOdemeleri] = await Promise.all([
    tx.masrafOdeme.findMany({
      where: { OR: [{ hareketId: { in: hareketIdleri } }, { krediKartiHareketId: { in: tumKartHam.map((k) => k.id) } }] },
      select: { masrafId: true, hareketId: true, krediKartiHareketId: true },
    }),
    tx.krediKartiHareket.findMany({ where: { bankaHareketId: { in: hareketIdleri } }, select: { krediKartiId: true, bankaHareketId: true } }),
  ]);
  const masrafHareketten = new Map(masrafOdemeleri.filter((o) => o.hareketId).map((o) => [o.hareketId!, o.masrafId]));
  const masrafKarttan = new Map(masrafOdemeleri.filter((o) => o.krediKartiHareketId).map((o) => [o.krediKartiHareketId!, o.masrafId]));
  const kartHareketten = new Map(kartOdemeleri.map((k) => [k.bankaHareketId!, k.krediKartiId]));

  // Karşı hesap için dönem dışı masraf, gelir ve çek de gerekir.
  const masrafIdleri = new Set([...masraflar.map((m) => m.id), ...tumHamHareketler.map((h) => h.masraf?.id ?? masrafHareketten.get(h.id)).filter((x): x is string => Boolean(x)), ...masrafKarttan.values()]);
  const gelirIdleri = new Set([...gelirler.map((g) => g.id), ...tumHamHareketler.map((h) => h.gelirKaydi?.id).filter((x): x is string => Boolean(x))]);
  const cekIdleri = new Set([...cekOlaylari.map((o) => o.cekSenetId), ...tumHamHareketler.filter((h) => h.kaynakTur === "cek_senet" && h.kaynakRef && UUID.test(h.kaynakRef)).map((h) => h.kaynakRef!)]);
  const [tumMasrafHam, tumGelirHam, cekler] = await Promise.all([
    tx.masraf.findMany({ where: { id: { in: [...masrafIdleri] } }, include: { kategori: { select: { ad: true, muhasebeKodu: true } }, maliyetDagitimlari: { where: { durum: "aktif" }, select: { id: true } } } }),
    tx.gelirKaydi.findMany({ where: { id: { in: [...gelirIdleri] } }, include: { kategori: { select: { ad: true, muhasebeKodu: true } } } }),
    tx.cekSenet.findMany({ where: { id: { in: [...cekIdleri] } }, include: { olaylar: { orderBy: { createdAt: "asc" } } } }),
  ]);

  const masrafGirdisi = (m: (typeof tumMasrafHam)[number]): MasrafGirdisi => ({
    id: m.id, tarih: gun(m.tarih), belgeNo: m.belgeNo, aciklama: m.aciklama, saticiUnvan: m.saticiUnvan, kategoriAd: m.kategori.ad, kategoriKodu: m.kategori.muhasebeKodu,
    cariId: m.cariId, matrah: m.matrah, kdvTutari: m.kdvTutari, toplam: m.toplam, stopajTutari: m.stopajTutari, kur: m.kur, dovizCinsi: m.dovizCinsi,
    stokaDagitildi: m.maliyetDagitimlari.length > 0,
  });
  const gelirGirdisi = (g: (typeof tumGelirHam)[number]): GelirGirdisi => ({
    id: g.id, tarih: gun(g.tarih), belgeNo: g.belgeNo, aciklama: g.aciklama, kategoriAd: g.kategori.ad, kategoriKodu: g.kategori.muhasebeKodu, cariId: g.cariId,
    brutTutar: g.brutTutar, kdvTutari: g.kdvTutari, stopajTutari: g.stopajTutari, kur: g.kur, dovizCinsi: g.dovizCinsi,
  });
  const hareketGirdisi = (h: HamHareket): HareketGirdisi => ({
    id: h.id, tip: h.tip, tarih: gun(h.tarih), tutar: h.tutar, tutarTry: h.tutarTry, dovizCinsi: h.dovizCinsi, kur: h.kur, aciklama: h.aciklama, makbuzNo: h.makbuzNo,
    kaynakTur: h.kaynakTur, kaynakRef: h.kaynakRef, hesap: hesapRef(h), karsiHareketId: h.karsiHareketId,
    cariId: h.cariId, faturaId: h.faturaId, faturaTipi: h.fatura?.tip ?? null, faturaKarsiligi: h.faturaKarsiligi, faturaDovizi: h.fatura?.dovizCinsi ?? null,
    masrafId: h.masraf?.id ?? masrafHareketten.get(h.id) ?? null, gelirId: h.gelirKaydi?.id ?? null, kartId: kartHareketten.get(h.id) ?? null,
    kredi: (() => {
      const i = krediHareketten.get(h.id);
      return i ? { id: i.krediId, tip: i.tip, anapara: i.anapara, uzunVadeli: i.uzunVadeliAnapara, masraf: i.masraf, finansman: i.faiz.add(i.bsmv).add(i.kkdf) } : null;
    })(),
  });
  const kartDovizi = new Map(kartlar.map((k) => [k.id, k.dovizCinsi]));
  const kartGirdisi = (k: (typeof tumKartHam)[number]): KartGirdisi => ({
    id: k.id, kartId: k.krediKartiId, tip: k.tip, tarih: gun(k.tarih), aciklama: k.aciklama, tutar: k.tutar, cariOdemeTutari: k.cariOdemeTutari,
    cariId: k.cariId, masrafId: masrafKarttan.get(k.id) ?? null, belgeNo: k.belgeNo, geriAlinanHareketId: k.geriAlinanHareketId, kartDovizi: kartDovizi.get(k.krediKartiId) ?? "TRY",
  });
  const cekGirdisi = (c: (typeof cekler)[number]): CekGirdisi => ({
    id: c.id, tur: c.tur, yon: c.yon, portfoyNo: c.portfoyNo, cekNo: c.cekNo, tutar: c.tutar, tutarTry: c.tutarTry, kur: c.kur, dovizCinsi: c.dovizCinsi,
    cariId: c.cariId, ciroCariId: c.ciroCariId,
    olaylar: c.olaylar.map((o) => ({ id: o.id, oncekiDurum: o.oncekiDurum, yeniDurum: o.yeniDurum, tarih: gun(o.islemTarihi), gecerli: !o.geriAlindi && !o.geriAlma })),
  });

  const faturaGirdileri: FaturaGirdisi[] = faturalar.map((f) => ({
    id: f.id, no: f.no, tip: f.tip, tarih: gun(f.tarih), cariId: f.cariId, dovizCinsi: f.dovizCinsi, kur: f.kur,
    toplamMatrah: f.toplamMatrah, toplamKdv: f.toplamKdv, toplamNetKdv: f.toplamNetKdv, toplamTevkifat: f.toplamTevkifat, genelToplam: f.genelToplam,
    ihracat: Boolean(f.ihracatTeslimSarti), ihracKayitli: Boolean(f.ihracKayitliKodu), kurFarki: kurFarkiFaturalari.has(f.id),
    satirlar: f.satirlar.map((s) => ({ matrah: s.matrah, stokTipi: s.stok?.tip ?? null, stokaDagitildi: s.maliyetDagitimlari.length > 0 })),
  }));

  const dovizGirdileri: DovizIslemGirdisi[] = dovizIslemleri.flatMap((d) => {
    const cikan = bacak(d.gidisHareketId);
    const giren = bacak(d.gelisHareketId);
    if (!cikan || !giren) return [];
    return [{
      id: d.id, tarih: gun(d.tarih), aciklama: d.aciklama,
      cikan: { hesap: cikan, tutar: d.cikanTutar, doviz: d.cikanDoviz, kur: d.cikanKur, tl: d.cikanTry },
      giren: { hesap: giren, tutar: d.girenTutar, doviz: d.girenDoviz, kur: d.girenKur, tl: d.girenTry },
    }];
  });

  const masrafHaritasi = new Map(tumMasrafHam.map((m) => [m.id, masrafGirdisi(m)]));
  const gelirHaritasi = new Map(tumGelirHam.map((g) => [g.id, gelirGirdisi(g)]));
  const cekHaritasi = new Map(cekler.map((c) => [c.id, cekGirdisi(c)]));

  return {
    hesapKodlari: (ayar?.hesapKodlari ?? {}) as Partial<Record<MuhasebeHesapAnahtari, string>>,
    cariler: new Map<string, CariBilgi>(cariler.map((c) => [c.id, c])),
    hesaplar,
    faturalar: faturaGirdileri,
    hareketler: hareketlerHam.map(hareketGirdisi),
    ekHareketler: new Map(tumHamHareketler.map((h) => [h.id, hareketGirdisi(h)])),
    masraflar: masraflar.map((m) => masrafHaritasi.get(m.id)!),
    tumMasraflar: masrafHaritasi,
    gelirler: gelirler.map((g) => gelirHaritasi.get(g.id)!),
    tumGelirler: gelirHaritasi,
    cekler: cekler.filter((c) => c.olaylar.some((o) => o.islemTarihi >= aralik.gte && o.islemTarihi <= aralik.lte)).map((c) => cekHaritasi.get(c.id)!),
    tumCekler: cekHaritasi,
    kartHareketleri: kartHareketleri.map(kartGirdisi),
    ekKartHareketleri: new Map(tumKartHam.map((k) => [k.id, kartGirdisi(k)])),
    dovizIslemleri: dovizGirdileri,
    cariDuzeltmeleri: cariDuzeltmeleri.map((h): CariDuzeltmeGirdisi => ({
      id: h.id, cariId: h.cariId, tip: h.tip, tarih: gun(h.tarih), tutar: h.tutar, dovizCinsi: h.dovizCinsi, kur: h.kur, tutarTry: h.tutarTry,
      aciklama: h.aciklama, karsiHesapKodu: h.karsiHesapKodu,
    })),
    bordrolar: bordrolar.map((b): BordroGirdisi => {
      const ozet = b.hesapOzeti && typeof b.hesapOzeti === "object" && !Array.isArray(b.hesapOzeti) ? (b.hesapOzeti as Record<string, unknown>) : null;
      return {
        id: b.id, tarih: gun(new Date(Date.UTC(b.donemYil, b.donemAy, 0))), donem: `${b.donemYil}/${String(b.donemAy).padStart(2, "0")}`,
        personelNo: b.personel.personelNo, adSoyad: `${b.personel.ad} ${b.personel.soyad}`, odenecekTutar: b.odenecekTutar,
        kalemler: b.kalemler.map((k) => ({ tip: k.tip as "kazanc" | "kesinti", kod: k.kod, aciklama: k.aciklama, tutar: k.tutar })),
        isverenPayi: ozet ? { sgk: new Prisma.Decimal(String(ozet.isverenSgkNet ?? 0)), issizlik: new Prisma.Decimal(String(ozet.isverenIssizlik ?? 0)) } : null,
      };
    }),
    personelCarileri: new Map(personeller.filter((p) => p.cariId).map((p) => [p.cariId!, p.personelNo])),
    baslangic,
    bitis,
  };
}
