import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { carileriDenklestir } from "../fatura/denklestirme";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { kurZorunlu } from "../doviz/kur-coz";
import { hakedisOnerisi } from "./hakedis-hesap";

/**
 * PZR-13: pazaryeri hakedişi. Nest bağımlılığı yoktur; hem pazaryeri hem banka
 * ekstresi (eşleşmeyi geri alma) aynı işlem içinden çağırır.
 *
 * Kayıt (tek işlem, kullanıcı kararları 2026-11-07):
 *  (a) banka tahsilatı = ekstre tutarı, pazaryeri carisi alacak;
 *  (b) son müşteriye kesilmiş her sipariş faturası için cari aktarımı: müşteri
 *      alacak (fatura elle kapamayla kapanır) ↔ pazaryeri borç;
 *  (c) hakedişe giren stopaj pazaryeri carisinden 193'e mahsup (banka yok);
 *  (d) komisyon faturası ve kesinti masrafı pazaryeri carisinde netleşir;
 *  (e) fark hakedişte ve pazaryeri carisinde görünür.
 */
type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const HAKEDIS_KAYNAK = "pazaryeri_hakedis";

/** Hakedişe girebilecek kesinti: faturalı (bekleyen/eşleşmiş), bekleyen stopaj, masrafa dönmüş faturasız. */
const KESINTI_KOSULU: Prisma.PazaryeriKesintiWhereInput = {
  hakedisId: null, hareketId: null,
  OR: [
    { sinif: "faturali", durum: { in: ["bekliyor", "faturayla_eslesti"] } },
    { sinif: "stopaj", durum: "bekliyor" },
    { sinif: { in: ["ceza", "diger_faturasiz"] }, durum: "masrafa_donustu" },
  ],
};

const SIPARIS_SECIMI = {
  id: true, siparisNo: true, dovizCinsi: true, faturaId: true,
  fatura: { select: { id: true, no: true, tarih: true, durum: true, genelToplam: true, dovizCinsi: true, kur: true, cariId: true, cari: { select: { unvan: true } }, ...FATURA_ODEME_SECIMI } },
} satisfies Prisma.PazaryeriSiparisSelect;

async function satirOku(tx: Tx, ekstreSatirId: string) {
  const satir = await tx.bankaEkstreSatir.findUnique({ where: { id: ekstreSatirId }, include: { bankaHesap: { select: { id: true, ad: true, dovizCinsi: true } } } });
  if (!satir) throw new NotFoundException("Ekstre satırı bulunamadı");
  return satir;
}

/** Ekstre satırı için aday siparişler, kesintiler, öneri ve uyarılar. */
export async function hakedisAdaylari(tx: Tx, ekstreSatirId: string, baglantiId: string) {
  const satir = await satirOku(tx, ekstreSatirId);
  const baglanti = await tx.baglanti.findFirst({ where: { id: baglantiId, aile: "pazaryeri" }, select: { id: true, saglayici: true, pazaryeriCariId: true } });
  if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
  const doviz = satir.bankaHesap.dovizCinsi;
  const [siparisler, kesintiler, siniflanmamis, masrafsiz, giderlesmis] = await Promise.all([
    tx.pazaryeriSiparis.findMany({ where: { baglantiId, durum: "faturalandi", hakedisId: null, faturaId: { not: null }, fatura: { durum: "kesin", tarih: { lte: satir.tarih } } }, select: SIPARIS_SECIMI, take: 5_000 }),
    tx.pazaryeriKesinti.findMany({ where: { baglantiId, tarih: { lte: satir.tarih }, ...KESINTI_KOSULU }, select: { id: true, tur: true, sinif: true, durum: true, tarih: true, tutar: true, dovizCinsi: true, siparisNo: true }, orderBy: { tarih: "asc" }, take: 5_000 }),
    tx.pazaryeriKesinti.count({ where: { baglantiId, tarih: { lte: satir.tarih }, hakedisId: null, sinif: "siniflandirilmamis" } }),
    tx.pazaryeriKesinti.count({ where: { baglantiId, tarih: { lte: satir.tarih }, hakedisId: null, sinif: { in: ["ceza", "diger_faturasiz"] }, durum: "faturasiz" } }),
    tx.pazaryeriKesinti.count({ where: { baglantiId, tarih: { lte: satir.tarih }, hakedisId: null, hareketId: { not: null } } }),
  ]);
  const dovizUygun = siparisler.filter((s) => s.fatura && s.fatura.dovizCinsi === doviz);
  // Tahsil edilmiş faturanın aktarılacak alacağı kalmamıştır (çift alacak olmasın).
  const uygunSiparis = dovizUygun.filter((s) => faturaOdemeDurumu(s.fatura!).kalan.gt(0));
  const odenmis = dovizUygun.length - uygunSiparis.length;
  const uygunKesinti = kesintiler.filter((k) => k.dovizCinsi === doviz);
  const uyarilar: string[] = [];
  if (!baglanti.pazaryeriCariId) uyarilar.push("Bağlantının pazaryeri carisi seçilmemiş; hakediş kaydı için gereklidir.");
  if (siniflanmamis) uyarilar.push(`${siniflanmamis} kesinti sınıflandırılmamış; hakedişe giremez, önce sınıfını seçin.`);
  if (masrafsiz) uyarilar.push(`${masrafsiz} faturasız kesinti henüz masrafa dönüşmemiş; hakedişe giremez.`);
  if (giderlesmis) uyarilar.push(`${giderlesmis} kesinti eski kurala göre kasa/bankaya giderleştirilmiş; hakedişe giremez (gerekirse PZR-11 taramasından geri alın).`);
  if (odenmis) uyarilar.push(`${odenmis} siparişin faturası başka bir tahsilatla kapanmış; hakedişe alınmadı.`);
  if (siparisler.length !== dovizUygun.length || kesintiler.length !== uygunKesinti.length) uyarilar.push(`Banka hesabının dövizi (${doviz}) dışındaki sipariş ve kesintiler gösterilmedi.`);
  const oneri = hakedisOnerisi(
    uygunSiparis.map((s) => ({ id: s.id, tarih: s.fatura!.tarih, tutar: faturaOdemeDurumu(s.fatura!).kalan })),
    uygunKesinti.map((k) => ({ id: k.id, tarih: k.tarih, tutar: k.tutar })),
    satir.tutar,
  );
  return {
    satir: { id: satir.id, tarih: satir.tarih, tutar: satir.tutar.toFixed(2), aciklama: satir.aciklama, karsiUnvan: satir.karsiUnvan, dovizCinsi: doviz, bankaHesap: satir.bankaHesap.ad, durum: satir.durum },
    baglanti,
    siparisler: uygunSiparis.map((s) => ({ id: s.id, siparisNo: s.siparisNo, faturaNo: s.fatura!.no, tarih: s.fatura!.tarih, tutar: faturaOdemeDurumu(s.fatura!).kalan.toFixed(2), faturaToplami: s.fatura!.genelToplam.toFixed(2), cari: s.fatura!.cari.unvan })),
    kesintiler: uygunKesinti.map((k) => ({ ...k, tutar: k.tutar.toFixed(2) })),
    oneri, uyarilar,
  };
}

/** Hakedişi kaydeder; fark engel değildir (kullanıcı kararı), döner. */
export async function hakedisKaydet(tx: Tx, tenantId: string, girdi: { ekstreSatirId: string; baglantiId: string; siparisIds: string[]; kesintiIds: string[] }) {
  const satir = await satirOku(tx, girdi.ekstreSatirId);
  if (satir.durum !== "beklemede") throw new BadRequestException("Ekstre satırı bekleyen durumda değil");
  if (!satir.tutar.gt(0)) throw new BadRequestException("Hakediş yalnız banka girişi (pozitif tutar) satırıyla eşleşir");
  const baglanti = await tx.baglanti.findFirst({ where: { id: girdi.baglantiId, aile: "pazaryeri" }, select: { id: true, saglayici: true, pazaryeriCariId: true, pazaryeriCari: { select: { unvan: true } } } });
  if (!baglanti) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
  if (!baglanti.pazaryeriCariId) throw new BadRequestException("Önce bağlantının pazaryeri carisini seçin");
  const pazaryeriCariId = baglanti.pazaryeriCariId;
  const doviz = satir.bankaHesap.dovizCinsi;

  const siparisler = girdi.siparisIds.length ? await tx.pazaryeriSiparis.findMany({ where: { id: { in: girdi.siparisIds }, baglantiId: baglanti.id, durum: "faturalandi", hakedisId: null }, select: SIPARIS_SECIMI }) : [];
  if (siparisler.length !== girdi.siparisIds.length || siparisler.some((s) => !s.fatura || s.fatura.durum !== "kesin")) throw new BadRequestException("Siparişlerden biri bu bağlantının faturalanmış ve hakedişe girmemiş siparişi değil");
  const kesintiler = girdi.kesintiIds.length ? await tx.pazaryeriKesinti.findMany({ where: { id: { in: girdi.kesintiIds }, baglantiId: baglanti.id, ...KESINTI_KOSULU }, include: { gelenEbelge: { select: { faturaId: true } } } }) : [];
  if (kesintiler.length !== girdi.kesintiIds.length) throw new BadRequestException("Kesintilerden biri hakedişe giremez (başka hakedişte, giderleştirilmiş, sınıflandırılmamış ya da masrafa dönmemiş)");
  if (siparisler.some((s) => s.fatura!.dovizCinsi !== doviz) || kesintiler.some((k) => k.dovizCinsi !== doviz)) throw new BadRequestException(`Sipariş ve kesintiler banka hesabının dövizinde (${doviz}) olmalıdır`);
  if (!siparisler.length && !kesintiler.length) throw new BadRequestException("Hakedişe en az bir sipariş ya da kesinti seçin");

  const kur = doviz === "TRY" ? D(1) : await kurZorunlu(tx, doviz, satir.tarih);
  // Aktarılan alacak faturanın kalanıdır; tamamı tahsil edilmiş fatura hakedişe giremez.
  const kalanlar = new Map(siparisler.map((s) => [s.id, faturaOdemeDurumu(s.fatura!).kalan]));
  if ([...kalanlar.values()].some((k) => !k.gt(0))) throw new BadRequestException("Siparişlerden birinin faturası başka bir tahsilatla kapanmış; hakedişten çıkarın");
  const siparisToplami = [...kalanlar.values()].reduce((t, k) => t.add(k), D(0));
  const kesintiToplami = kesintiler.reduce((t, k) => t.add(k.tutar), D(0));
  const stopajlar = kesintiler.filter((k) => k.sinif === "stopaj");
  const stopajToplami = stopajlar.reduce((t, k) => t.add(k.tutar), D(0));
  if (stopajToplami.lt(0)) throw new BadRequestException("Seçilen stopaj kesintilerinin toplamı eksi (yalnız iptal seçilmiş); iptal edilen stopajı da seçin");
  const fark = siparisToplami.sub(kesintiToplami).sub(satir.tutar);
  const hakedisId = randomUUID();
  const etiket = `${baglanti.saglayici} hakedişi ${satir.tarih.toISOString().slice(0, 10)}`;
  const tl = (t: Prisma.Decimal) => t.mul(kur).toDecimalPlaces(2);

  // (a) banka tahsilatı → pazaryeri carisi alacak (kasa_banka kaynaklı cari hareketi, KSB-02 ile aynı)
  const banka = await tx.kasaBankaHareket.create({ data: {
    tenantId, bankaHesapId: satir.bankaHesapId, tip: "tahsilat", tutar: satir.tutar, dovizCinsi: doviz, kur, tutarTry: tl(satir.tutar), tarih: satir.tarih,
    aciklama: `Pazaryeri hakedişi · ${satir.aciklama}`.slice(0, 500), cariId: pazaryeriCariId, kaynakTur: HAKEDIS_KAYNAK, kaynakRef: hakedisId, ekstreSatirId: satir.id,
  } });
  await tx.cariHareket.create({ data: { tenantId, cariId: pazaryeriCariId, tip: "alacak", tutar: satir.tutar, dovizCinsi: doviz, kur, tutarTry: tl(satir.tutar), tarih: satir.tarih, aciklama: `${etiket} — banka tahsilatı`, kaynakTur: "kasa_banka", kaynakRef: banka.id } });
  await tx.pazaryeriHakedis.create({ data: {
    id: hakedisId, tenantId, baglantiId: baglanti.id, ekstreSatirId: satir.id, bankaHareketId: banka.id, pazaryeriCariId, tarih: satir.tarih, dovizCinsi: doviz,
    bankaTutari: satir.tutar, siparisToplami, kesintiToplami, stopajToplami, fark,
  } });

  // (b) sipariş alacağının aktarımı
  const cariHareket = (cariId: string, tip: "borc" | "alacak", tutar: Prisma.Decimal, aciklama: string) => tx.cariHareket.create({ data: {
    tenantId, cariId, tip, tutar, dovizCinsi: doviz, kur, tutarTry: tl(tutar), tarih: satir.tarih, aciklama: aciklama.slice(0, 500), kaynakTur: HAKEDIS_KAYNAK, kaynakRef: hakedisId,
  } });
  let netlestirmeKaynagi: string | null = null;
  const musteriler: string[] = [];
  for (const s of siparisler) {
    const f = s.fatura!;
    const kalan = kalanlar.get(s.id)!;
    if (f.cariId === pazaryeriCariId) {
      // Doğrudan pazaryeri carisine kesilmiş fatura banka tahsilatıyla kapanır.
      await tx.faturaKapama.create({ data: { tenantId, cariId: f.cariId, faturaId: f.id, tutar: kalan, otomatik: false, kasaBankaHareketId: banka.id } });
      continue;
    }
    const musteri = await cariHareket(f.cariId, "alacak", kalan, `${etiket}: ${s.siparisNo} / ${f.no ?? "fatura"} alacağı ${baglanti.pazaryeriCari?.unvan ?? "pazaryeri"} carisine aktarıldı`);
    const pazaryeri = await cariHareket(pazaryeriCariId, "borc", kalan, `${etiket}: ${f.cari.unvan} · ${s.siparisNo} / ${f.no ?? "fatura"} alacağı devralındı`);
    netlestirmeKaynagi ??= pazaryeri.id;
    await tx.faturaKapama.create({ data: { tenantId, cariId: f.cariId, faturaId: f.id, tutar: kalan, otomatik: false, cariHareketId: musteri.id } });
    musteriler.push(f.cariId);
  }

  // (c) stopaj: 193 / pazaryeri carisi (banka hareketi yok)
  if (stopajToplami.gt(0)) {
    const h = await cariHareket(pazaryeriCariId, "alacak", stopajToplami, `${etiket}: e-ticaret stopajı mahsup edildi (193)`);
    netlestirmeKaynagi ??= h.id;
    await tx.pazaryeriKesinti.updateMany({ where: { id: { in: stopajlar.map((k) => k.id) } }, data: { durum: "hakediste_kaydedildi" } });
  }

  // (d) netleşen kesintiler: kesinti masrafı ödenmiş sayılır; komisyon alış faturası kapanır.
  for (const k of kesintiler.filter((x) => x.masrafId)) {
    const m = await tx.masraf.findUnique({ where: { id: k.masrafId! }, select: { toplam: true, stopajTutari: true } });
    if (m) await tx.masraf.update({ where: { id: k.masrafId! }, data: { odemeDurumu: "odendi", odenenTutar: m.toplam.sub(m.stopajTutari ?? 0), odemeTarihi: satir.tarih } });
  }
  const alisToplamlari = new Map<string, Prisma.Decimal>();
  for (const k of kesintiler) if (k.sinif === "faturali" && k.gelenEbelge?.faturaId) alisToplamlari.set(k.gelenEbelge.faturaId, D(alisToplamlari.get(k.gelenEbelge.faturaId)).add(k.tutar));
  if (netlestirmeKaynagi) {
    for (const [faturaId, toplam] of alisToplamlari) {
      const f = await tx.fatura.findUnique({ where: { id: faturaId }, select: { id: true, cariId: true, durum: true, genelToplam: true, ...FATURA_ODEME_SECIMI } });
      if (!f || f.cariId !== pazaryeriCariId) continue;
      const tutar = Prisma.Decimal.min(toplam, faturaOdemeDurumu(f).kalan);
      if (tutar.gt(0)) await tx.faturaKapama.create({ data: { tenantId, cariId: f.cariId, faturaId: f.id, tutar, otomatik: false, cariHareketId: netlestirmeKaynagi } });
    }
  }

  if (siparisler.length) await tx.pazaryeriSiparis.updateMany({ where: { id: { in: siparisler.map((s) => s.id) } }, data: { hakedisId } });
  if (kesintiler.length) await tx.pazaryeriKesinti.updateMany({ where: { id: { in: kesintiler.map((k) => k.id) } }, data: { hakedisId } });
  const { count } = await tx.bankaEkstreSatir.updateMany({ where: { id: satir.id, durum: "beklemede" }, data: { durum: "eslesti", eslesmeTuru: "pazaryeri_hakedis", cariId: pazaryeriCariId, faturaId: null } });
  if (count !== 1) throw new BadRequestException("Ekstre satırı bu sırada değişti; yeniden deneyin");
  await carileriDenklestir(tx, tenantId, [pazaryeriCariId, ...musteriler]);
  return { hakedisId, siparisToplami: siparisToplami.toFixed(2), kesintiToplami: kesintiToplami.toFixed(2), stopajToplami: stopajToplami.toFixed(2), bankaTutari: satir.tutar.toFixed(2), fark: fark.toFixed(2) };
}

/**
 * Hakedişin bütün kayıtlarını geri alır (ekstre satırı çağıran tarafından
 * sıfırlanır). Dönem kilidi çağıran tarafından denetlenir.
 */
export async function hakedisGeriAlTx(tx: Tx, tenantId: string, hakedisId: string) {
  const h = await tx.pazaryeriHakedis.findUnique({ where: { id: hakedisId }, include: { kesintiler: { select: { id: true, sinif: true, masrafId: true } } } });
  if (!h) throw new NotFoundException("Hakediş bulunamadı");
  const cariHareketleri = await tx.cariHareket.findMany({ where: { kaynakTur: HAKEDIS_KAYNAK, kaynakRef: h.id }, select: { id: true, cariId: true } });
  const ids = cariHareketleri.map((c) => c.id);
  await tx.faturaKapama.deleteMany({ where: { OR: [{ cariHareketId: { in: ids } }, { kasaBankaHareketId: h.bankaHareketId }] } });
  await tx.cariHareket.deleteMany({ where: { id: { in: ids } } });
  await tx.cariHareket.deleteMany({ where: { kaynakTur: "kasa_banka", kaynakRef: h.bankaHareketId } });
  await tx.pazaryeriKesinti.updateMany({ where: { hakedisId: h.id, durum: "hakediste_kaydedildi" }, data: { durum: "bekliyor" } });
  const masrafIdleri = h.kesintiler.map((k) => k.masrafId).filter((x): x is string => Boolean(x));
  if (masrafIdleri.length) await tx.masraf.updateMany({ where: { id: { in: masrafIdleri } }, data: { odemeDurumu: "odenmedi", odenenTutar: 0, odemeTarihi: null } });
  await tx.pazaryeriSiparis.updateMany({ where: { hakedisId: h.id }, data: { hakedisId: null } });
  await tx.pazaryeriKesinti.updateMany({ where: { hakedisId: h.id }, data: { hakedisId: null } });
  await tx.pazaryeriHakedis.delete({ where: { id: h.id } });
  await tx.kasaBankaHareket.delete({ where: { id: h.bankaHareketId } });
  await carileriDenklestir(tx, tenantId, [h.pazaryeriCariId, ...cariHareketleri.map((c) => c.cariId)]);
  return { ekstreSatirId: h.ekstreSatirId };
}
