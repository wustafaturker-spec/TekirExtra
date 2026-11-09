import type { Prisma } from "@prisma/client";
import { vergiDonemAylari, VERGI_TAKVIMI_TURU, vergiTakvimAnahtari, type VergiYukumlulugu } from "@tekirextra/shared";
import { kdvBeyanFaturalari, kdvBeyanSatirlari, kdvBeyanToplami } from "../fatura/kdv-beyan";
import { vergiKalemleri } from "../fatura/vergi.raporlar";
import { bordroYasalTutarlari } from "../nakit-akisi/nakit-akisi.hesap";
import { ONAYLI_BORDRO_DURUMLARI } from "../personel/sgk-dokum";
import { bosDonem, donemAnahtari, donemCoz, kdvAdimi, kurus, takvimSatiri, type DonemGirdisi, type VergiOdemeOzeti, type VergiTakvimSatiri } from "./vergi-takvimi.hesap";

const gun = (d: Date) => d.toISOString().slice(0, 10);
const ayBasi = (a: number) => { const { yil, ay } = donemCoz(a); return new Date(Date.UTC(yil, ay - 1, 1)); };
const aySonu = (a: number) => { const { yil, ay } = donemCoz(a); return new Date(Date.UTC(yil, ay, 0, 23, 59, 59, 999)); };
const tarihDonemi = (d: Date) => donemAnahtari(d.getUTCFullYear(), d.getUTCMonth() + 1);

export interface TakvimAraligi { ilk: { yil: number; ay: number }; son: { yil: number; ay: number }; bugun: string }

export interface TakvimSonucu {
  ayar: { baslangicYil: number; baslangicAy: number; devredenKdv: number; muhtasarDonemi: string } | null;
  satirlar: VergiTakvimSatiri[];
}

/** VTK-06: yürürlükteki son tarih ve varsa uzatmadan önceki tarih. */
async function sonTarihler(tx: Prisma.TransactionClient, anahtarlar: string[], bugun: string) {
  const kayitlar = anahtarlar.length ? await tx.mevzuatKayit.findMany({
    where: { tur: VERGI_TAKVIMI_TURU, anahtar: { in: anahtarlar }, yururlukBaslangic: { lte: new Date(`${bugun}T00:00:00Z`) } },
    orderBy: { yururlukBaslangic: "asc" },
    select: { anahtar: true, deger: true, yururlukBitis: true },
  }) : [];
  const harita = new Map<string, { sonTarih: string; onceki: string | null }>();
  const tarihOf = (d: unknown) => (d as { sonTarih?: string } | null)?.sonTarih ?? null;
  const gecmis = new Map<string, string[]>();
  for (const k of kayitlar) {
    const t = tarihOf(k.deger);
    if (!t) continue;
    const liste = gecmis.get(k.anahtar) ?? [];
    liste.push(t); gecmis.set(k.anahtar, liste);
    // Yayından kaldırılan kaydın bitişi geçmiştir; o anahtar yayınlanmamış sayılır.
    if (k.yururlukBitis && gun(k.yururlukBitis) < bugun) { harita.delete(k.anahtar); continue; }
    const onceki = [...liste].reverse().find((x) => x !== t) ?? null;
    harita.set(k.anahtar, { sonTarih: t, onceki });
  }
  return harita;
}

/**
 * VTK-02…05: dönem aralığının takvim satırları. Yalnız okur; ekran, nakit akışı ve
 * bildirim aynı hesabı kullanır. Devreden KDV zinciri firmanın başlangıç döneminden kurulur.
 */
export async function vergiTakvimiOku(tx: Prisma.TransactionClient, tenantId: string, a: TakvimAraligi): Promise<TakvimSonucu> {
  // Birim testlerinin sahte işlemlerinde tablo yoktur; gerçek bağlantıda her zaman vardır (kanuniDegerOku ile aynı).
  if (!tx?.vergiTakvimiAyari) return { ayar: null, satirlar: [] };
  const ayarKaydi = await tx.vergiTakvimiAyari.findUnique({ where: { tenantId } });
  const ayar = ayarKaydi ? { baslangicYil: ayarKaydi.baslangicYil, baslangicAy: ayarKaydi.baslangicAy, devredenKdv: Number(ayarKaydi.devredenKdv), muhtasarDonemi: ayarKaydi.muhtasarDonemi } : null;
  const baslangic = ayar ? donemAnahtari(ayar.baslangicYil, ayar.baslangicAy) : null;
  const istenenIlk = donemAnahtari(a.ilk.yil, a.ilk.ay);
  const ilk = baslangic === null ? istenenIlk : Math.max(istenenIlk, baslangic);
  const son = donemAnahtari(a.son.yil, a.son.ay);
  if (ilk > son) return { ayar, satirlar: [] };
  // Zincir istenen aralıktan önce başlamış olabilir; okuma başlangıçtan yapılır.
  const okumaIlk = baslangic ?? ilk;
  // Üç aylık kalem çeyreğin ilk aylarını da toplar.
  const veriIlk = Math.min(okumaIlk, ilk - 2);
  const bas = ayBasi(veriIlk), bit = aySonu(son);

  const [faturalar, bordrolar, stopajlar, masraflar, taslakFaturalar, kayitlar] = await Promise.all([
    kdvBeyanFaturalari(tx, { gte: ayBasi(okumaIlk), lte: bit }),
    tx.personelBordro.findMany({
      where: { tenantId, durum: { notIn: ["reddedildi", "iptal"] }, OR: yilAralik(veriIlk, son) },
      select: { donemYil: true, donemAy: true, durum: true, hesapOzeti: true },
    }),
    vergiKalemleri({ baslangic: gun(bas), bitis: gun(bit), kova: "kestigimiz_stopaj" }, tx),
    tx.masraf.findMany({
      where: { durum: { in: ["onaylandi", "taslak"] }, OR: [{ tarih: { gte: bas, lte: bit } }, { kiraDonemi: { gte: bas, lte: bit } }] },
      select: { tarih: true, kiraDonemi: true, durum: true, stopajTutari: true, kur: true },
    }),
    tx.fatura.findMany({ where: { durum: "taslak", tip: { in: ["satis", "alis", "satis_iade", "alis_iade"] }, tarih: { gte: bas, lte: bit } }, select: { tarih: true } }),
    tx.vergiYukumlulukKaydi.findMany({
      where: { OR: yilAralik(okumaIlk, son).map((o) => ({ yil: o.donemYil, ay: o.donemAy })) },
      include: { odemeler: { orderBy: { tarih: "asc" }, include: { hareket: { select: { aciklama: true } } } } },
    }),
  ]);

  const donemler = new Map<number, DonemGirdisi>();
  const dg = (k: number) => { let d = donemler.get(k); if (!d) { d = bosDonem(); donemler.set(k, d); } return d; };

  // KDV ay bazında; tarih seçimi kdvBeyanFaturalari'ndadır.
  const kdvGruplari = new Map<number, typeof faturalar>();
  for (const f of faturalar) { const k = tarihDonemi(f.tarih); kdvGruplari.set(k, [...(kdvGruplari.get(k) ?? []), f]); }
  for (const [k, liste] of kdvGruplari) {
    const s = kdvBeyanSatirlari(liste);
    const t = (y: Parameters<typeof kdvBeyanToplami>[1]) => kdvBeyanToplami(s, y);
    dg(k).kdvNet = kurus(t("hesaplanan_satis") + t("hesaplanan_alis_iade") - t("indirilecek_alis") - t("indirilecek_satis_iade"));
    dg(k).kdv2 = kurus(t("kdv2_tevkifat"));
  }

  for (const b of bordrolar) {
    const d = dg(donemAnahtari(b.donemYil, b.donemAy));
    if (!(ONAYLI_BORDRO_DURUMLARI as readonly string[]).includes(b.durum)) { d.onaysizBordro += 1; continue; }
    const t = bordroYasalTutarlari(b.hesapOzeti);
    if (!t) { d.izsizBordro += 1; continue; }
    d.gvDamga = kurus(d.gvDamga + t.vergi); d.sgk = kurus(d.sgk + t.sgk);
  }
  for (const k of stopajlar) { const d = dg(tarihDonemi(new Date(`${k.tarih}T00:00:00Z`))); d.stopaj = kurus(d.stopaj + k.tutar.mul(k.kur).toNumber()); }
  for (const m of masraflar) {
    const kira = m.kiraDonemi ?? m.tarih;
    if (m.durum === "taslak") { dg(tarihDonemi(m.tarih)).taslakMasraf += 1; continue; }
    if (m.stopajTutari && m.stopajTutari.gt(0)) { const d = dg(tarihDonemi(kira)); d.stopaj = kurus(d.stopaj + m.stopajTutari.mul(m.kur).toNumber()); }
  }
  for (const f of taslakFaturalar) dg(tarihDonemi(f.tarih)).taslakFatura += 1;

  const kayit = new Map(kayitlar.map((k) => [`${k.yukumluluk}:${k.yil}-${k.ay}`, k]));
  const kayitOf = (y: VergiYukumlulugu, yil: number, ay: number) => kayit.get(`${y}:${yil}-${ay}`);
  const para = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));
  const odemelerOf = (r: ReturnType<typeof kayitOf>): VergiOdemeOzeti[] => (r?.odemeler ?? []).map((o) => ({ id: o.id, tarih: gun(o.tarih), tutar: Number(o.tutar), not: o.not, hareketId: o.kasaBankaHareketId, hareketAciklama: o.hareket?.aciklama ?? null }));

  // Üç aylık seçilmişse muhtasar çeyrek kalemiyle gelir, aylık kalem üretilmez.
  const ucAylik = ayar?.muhtasarDonemi === "uc_aylik";
  const yukumlulukler: VergiYukumlulugu[] = ["kdv1", "kdv2", ucAylik ? "muhtasar3" : "muhtasar", "sgk"];
  const istenen: { y: VergiYukumlulugu; k: number; yil: number; ay: number }[] = [];
  for (let k = ilk; k <= son; k += 1) {
    const { yil, ay } = donemCoz(k);
    for (const y of yukumlulukler) if (vergiDonemAylari(y).includes(ay)) istenen.push({ y, k, yil, ay });
  }
  const tarihler = await sonTarihler(tx, istenen.map((i) => vergiTakvimAnahtari(i.y, i.yil, i.ay)), a.bugun);

  // KDV zinciri: başlangıçtan ileri yürür, istenen dönemlerin adımı saklanır.
  const kdvAdimlari = new Map<number, ReturnType<typeof kdvAdimi>>();
  let devreden = baslangic === null ? 0 : ayar!.devredenKdv;
  for (let k = okumaIlk; k <= son; k += 1) {
    const { yil, ay } = donemCoz(k);
    const r = kayitOf("kdv1", yil, ay);
    const adim = kdvAdimi(donemler.get(k)?.kdvNet ?? 0, devreden, para(r?.beyanDevreden));
    kdvAdimlari.set(k, adim);
    devreden = adim.devredenCikan;
  }

  const satirlar = istenen.map(({ y, k, yil, ay }) => {
    const r = kayitOf(y, yil, ay);
    const t = tarihler.get(vergiTakvimAnahtari(y, yil, ay));
    const aralik = y === "muhtasar3" ? [k - 2, k - 1, k] : [k];
    const eksikler = aralik.reduce((top, m) => {
      const d = donemler.get(m) ?? bosDonem();
      return { onaysizBordro: top.onaysizBordro + d.onaysizBordro, izsizBordro: top.izsizBordro + d.izsizBordro, taslakFatura: top.taslakFatura + d.taslakFatura, taslakMasraf: top.taslakMasraf + d.taslakMasraf };
    }, { onaysizBordro: 0, izsizBordro: 0, taslakFatura: 0, taslakMasraf: 0 });
    const topla = (f: (d: DonemGirdisi) => number) => aralik.reduce((top, m) => top + f(donemler.get(m) ?? bosDonem()), 0);
    const kdv = kdvAdimlari.get(k)!;
    const hesaplanan = y === "kdv1" ? kdv.hesaplanan : y === "kdv2" ? topla((d) => d.kdv2) : y === "sgk" ? topla((d) => d.sgk) : topla((d) => d.gvDamga + d.stopaj);
    return takvimSatiri({
      yukumluluk: y, yil, ay, bugun: a.bugun, sonTarih: t?.sonTarih ?? null, oncekiSonTarih: t?.onceki ?? null,
      hesaplanan, beyanTutari: para(r?.beyanTutari), beyanDevreden: para(r?.beyanDevreden), beyanNotu: r?.beyanNotu ?? null,
      odemeler: odemelerOf(r), eksikler, takipBasladi: ayar !== null,
      ...(y === "kdv1" ? { devredenGiren: kdv.devredenGiren, devredenCikan: kdv.devredenCikan } : {}),
    });
  });
  return { ayar, satirlar };
}

/** Dönem aralığını bordro tablosunun yıl/ay koşullarına çevirir. */
function yilAralik(ilk: number, son: number): { donemYil: number; donemAy: number }[] {
  const liste: { donemYil: number; donemAy: number }[] = [];
  for (let k = ilk; k <= son; k += 1) { const { yil, ay } = donemCoz(k); liste.push({ donemYil: yil, donemAy: ay }); }
  return liste;
}
