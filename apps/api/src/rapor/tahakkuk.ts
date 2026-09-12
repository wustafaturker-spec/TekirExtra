import type { Prisma } from "@prisma/client";

/**
 * Tahakkuk esaslı gelir-gider hesabı (BUT-01…BUT-04).
 *
 * Gelir-gider raporu ve bütçenin gerçekleşeni bu tek hesabı kullanır; ikisi
 * aynı dönem için farklı rakam veremez. Yalnız belgelerden oluşur: kesin
 * faturalar, onaylı masraflar, faaliyet dışı gelir kayıtları ve bordro.
 * Tutarlar KDV hariçtir. Belgesiz kasa/banka hareketleri (virman, çek/senet,
 * POS, bordro ödemesi, gelir tahsilatı) sayılmaz: bunların çoğu zaten sayılmış
 * bir belgenin nakit tarafıdır ve eski rapor onları ikinci kez sayıyordu.
 * Mevcut stok değeri de burada yoktur; o bir varlıktır, dönem geliri değil.
 */

export type TahakkukTur = "gelir" | "gider";

export interface TahakkukKalemi {
  id: string;
  tarih: string;
  tur: TahakkukTur;
  /** Bütçe satırının anahtarı (BUT-05). */
  anahtar: string;
  anaKategori: string;
  altKategori: string;
  belgeNo: string;
  cariUnvan: string;
  aciklama: string;
  tutarTry: number;
  dovizCinsi: string;
  tutar: number;
}

type Sayi = number | { toString(): string };
const sayi = (v: Sayi | null | undefined) => Number(v ?? 0);
const kurus = (tl: number) => Math.round(tl * 100) / 100;
const isoGun = (d: Date) => d.toISOString().slice(0, 10);

interface Kategori {
  id: string;
  ad: string;
  ust: { id: string; ad: string } | null;
}

export interface TahakkukVerisi {
  faturalar: {
    id: string;
    no: string | null;
    tip: string;
    tarih: Date;
    toplamMatrah: Sayi;
    kur: Sayi;
    dovizCinsi: string;
    aciklama: string | null;
    gelirTuru: string | null;
    cari: { unvan: string };
    satirlar: { matrah: Sayi; stok: { tip: string } | null }[];
  }[];
  masraflar: {
    id: string;
    belgeNo: string | null;
    tarih: Date;
    matrah: Sayi;
    kur: Sayi;
    dovizCinsi: string;
    aciklama: string | null;
    saticiUnvan: string | null;
    kategori: Kategori;
    cari: { unvan: string } | null;
  }[];
  gelirKayitlari: {
    id: string;
    belgeNo: string | null;
    tarih: Date;
    brutTutar: Sayi;
    kur: Sayi;
    dovizCinsi: string;
    aciklama: string | null;
    kategori: Kategori;
    cari: { unvan: string } | null;
  }[];
  bordrolar: {
    id: string;
    donemYil: number;
    donemAy: number;
    odenecekTutar: Sayi;
    personel: { ad: string; soyad: string };
  }[];
}

/** Belge dışında hiçbir veriye dayanmayan sabit kalemler. */
export const SABIT_KALEMLER: { anahtar: string; tur: TahakkukTur; anaKategori: string; altKategori: string }[] = [
  { anahtar: "satis:ticari_satis", tur: "gelir", anaKategori: "Esas Faaliyet Gelirleri", altKategori: "Satış Hasılatı" },
  { anahtar: "satis:kira_geliri", tur: "gelir", anaKategori: "Faaliyet Dışı Gelirler", altKategori: "Kira Geliri" },
  { anahtar: "satis:varlik_satisi", tur: "gelir", anaKategori: "Faaliyet Dışı Gelirler", altKategori: "Varlık / Demirbaş Satışı" },
  { anahtar: "satis:yansitma", tur: "gelir", anaKategori: "Faaliyet Dışı Gelirler", altKategori: "Yansıtma Gelirleri" },
  { anahtar: "satis:hizmet_diger", tur: "gelir", anaKategori: "Faaliyet Dışı Gelirler", altKategori: "Diğer Faaliyet Dışı Gelirler" },
  { anahtar: "alis_iadesi", tur: "gelir", anaKategori: "Faaliyet Gelirleri", altKategori: "Alış İadeleri" },
  { anahtar: "mal_alis", tur: "gider", anaKategori: "Mal Alış Maliyetleri", altKategori: "Mal Alış Maliyeti" },
  { anahtar: "hizmet_alis", tur: "gider", anaKategori: "Hizmet Alış Giderleri", altKategori: "Hizmet Alışları" },
  { anahtar: "satis_iadesi", tur: "gider", anaKategori: "Satış İadeleri", altKategori: "Satış İadesi" },
  { anahtar: "personel", tur: "gider", anaKategori: "Personel Giderleri", altKategori: "Bordro (net ödenecek)" },
];
const SABIT = new Map(SABIT_KALEMLER.map((k) => [k.anahtar, k]));

/** Kategori ağacındaki yer: ana = üst kategori, alt = kendisi; üstsüzse kendisi ana. */
function kategoriYeri(kategori: Kategori, varsayilanAlt: string) {
  return kategori.ust
    ? { anaKategori: kategori.ust.ad, altKategori: kategori.ad }
    : { anaKategori: kategori.ad, altKategori: varsayilanAlt };
}

function ayinSonGunu(yil: number, ay: number): string {
  return isoGun(new Date(Date.UTC(yil, ay, 0)));
}

/**
 * Belgeleri tahakkuk kalemlerine çevirir (BUT-01: TL karşılık belge kurundan).
 * Kuru girilmemiş dövizli masraf (kur 1) sayılmaz ve `cevrilemeyen` ile
 * bildirilir; TL sanılıp toplama katılması sessiz bir hata olurdu.
 */
export function tahakkukSiniflandir(veri: TahakkukVerisi): { kalemler: TahakkukKalemi[]; cevrilemeyen: number } {
  const kalemler: TahakkukKalemi[] = [];
  let cevrilemeyen = 0;
  const sabit = (anahtar: string) => SABIT.get(anahtar)!;

  for (const f of veri.faturalar) {
    const kur = sayi(f.kur) || 1;
    const matrah = sayi(f.toplamMatrah);
    const ortak = { tarih: isoGun(f.tarih), belgeNo: f.no || "(numarasız)", cariUnvan: f.cari.unvan, dovizCinsi: f.dovizCinsi };
    const ekle = (id: string, anahtar: string, dovizTutar: number, aciklama: string) => {
      const k = sabit(anahtar);
      kalemler.push({ id, ...ortak, tur: k.tur, anahtar, anaKategori: k.anaKategori, altKategori: k.altKategori, aciklama, tutar: kurus(dovizTutar), tutarTry: kurus(dovizTutar * kur) });
    };

    if (f.tip === "satis") {
      const tur = f.gelirTuru && SABIT.has(`satis:${f.gelirTuru}`) ? f.gelirTuru : "ticari_satis";
      ekle(f.id, `satis:${tur}`, matrah, f.aciklama || "Satış faturası");
    } else if (f.tip === "satis_iade") {
      ekle(f.id, "satis_iadesi", matrah, f.aciklama || "Satış iade faturası");
    } else if (f.tip === "alis_iade") {
      ekle(f.id, "alis_iadesi", matrah, f.aciklama || "Alış iade faturası");
    } else if (f.tip === "alis") {
      // Hizmet/mal ayrımı satır matrahlarının oranıyla faturanın toplam
      // matrahına ölçeklenir; genel iskonto toplamı kaydırmasın.
      const satirToplam = f.satirlar.reduce((t, s) => t + sayi(s.matrah), 0);
      const hizmetSatir = f.satirlar.filter((s) => s.stok?.tip === "hizmet").reduce((t, s) => t + sayi(s.matrah), 0);
      const hizmet = satirToplam > 0 ? kurus((matrah * hizmetSatir) / satirToplam) : 0;
      const mal = kurus(matrah - hizmet);
      if (hizmet > 0) ekle(`${f.id}:hizmet`, "hizmet_alis", hizmet, f.aciklama ? `${f.aciklama} (hizmet)` : "Alış faturası (hizmet)");
      if (mal > 0) ekle(`${f.id}:mal`, "mal_alis", mal, f.aciklama || "Alış faturası (mal)");
    }
  }

  for (const m of veri.masraflar) {
    const kur = sayi(m.kur) || 1;
    if (m.dovizCinsi !== "TRY" && kur === 1) { cevrilemeyen += 1; continue; }
    const matrah = sayi(m.matrah);
    kalemler.push({
      id: m.id, tarih: isoGun(m.tarih), tur: "gider", anahtar: `masraf_kategori:${m.kategori.id}`,
      ...kategoriYeri(m.kategori, "Genel Masraf"),
      belgeNo: m.belgeNo || "Masraf", cariUnvan: m.cari?.unvan ?? m.saticiUnvan ?? "—",
      aciklama: m.aciklama || m.kategori.ad, dovizCinsi: m.dovizCinsi, tutar: kurus(matrah), tutarTry: kurus(matrah * kur),
    });
  }

  for (const g of veri.gelirKayitlari) {
    const kur = sayi(g.kur) || 1;
    const brut = sayi(g.brutTutar);
    kalemler.push({
      id: g.id, tarih: isoGun(g.tarih), tur: "gelir", anahtar: `gelir_kategori:${g.kategori.id}`,
      ...kategoriYeri(g.kategori, "Genel"),
      belgeNo: g.belgeNo || "Gelir kaydı", cariUnvan: g.cari?.unvan ?? "—",
      aciklama: g.aciklama || g.kategori.ad, dovizCinsi: g.dovizCinsi, tutar: kurus(brut), tutarTry: kurus(brut * kur),
    });
  }

  const personel = sabit("personel");
  for (const b of veri.bordrolar) {
    const tutar = kurus(sayi(b.odenecekTutar));
    kalemler.push({
      id: b.id, tarih: ayinSonGunu(b.donemYil, b.donemAy), tur: "gider", anahtar: "personel",
      anaKategori: personel.anaKategori, altKategori: personel.altKategori,
      belgeNo: `BRD-${b.donemYil}-${String(b.donemAy).padStart(2, "0")}`, cariUnvan: `${b.personel.ad} ${b.personel.soyad}`,
      aciklama: `${String(b.donemAy).padStart(2, "0")}.${b.donemYil} bordrosu`, dovizCinsi: "TRY", tutar, tutarTry: tutar,
    });
  }

  kalemler.sort((a, b) => b.tarih.localeCompare(a.tarih));
  return { kalemler, cevrilemeyen };
}

/** Kalemleri ana/alt kategoriye göre toplar (raporun kırılım tabloları). */
export function kategoriOzeti(kalemler: TahakkukKalemi[], tur: TahakkukTur) {
  const gruplar = new Map<string, { anaKategori: string; altKategori: string; kurus: number }>();
  for (const k of kalemler) {
    if (k.tur !== tur) continue;
    const anahtar = `${k.anaKategori}::${k.altKategori}`;
    const g = gruplar.get(anahtar) ?? { anaKategori: k.anaKategori, altKategori: k.altKategori, kurus: 0 };
    g.kurus += Math.round(k.tutarTry * 100);
    gruplar.set(anahtar, g);
  }
  return [...gruplar.values()]
    .map((g) => ({ anaKategori: g.anaKategori, altKategori: g.altKategori, tutar: (g.kurus / 100).toFixed(2) }))
    .sort((a, b) => Number(b.tutar) - Number(a.tutar));
}

/** Tutarları kuruş cinsinden toplar. */
export function toplam(kalemler: TahakkukKalemi[], suzgec: (k: TahakkukKalemi) => boolean): number {
  return kalemler.filter(suzgec).reduce((t, k) => t + Math.round(k.tutarTry * 100), 0) / 100;
}

/** Tarih aralığındaki belgeleri okuyup sınıflandırır (BUT-01). */
export async function tahakkukOku(tx: Prisma.TransactionClient, tenantId: string, baslangic: Date, bitis: Date) {
  const faturalar = await tx.fatura.findMany({
    where: { tenantId, durum: "kesin", tip: { in: ["satis", "alis", "satis_iade", "alis_iade"] }, tarih: { gte: baslangic, lte: bitis } },
    select: {
      id: true, no: true, tip: true, tarih: true, toplamMatrah: true, kur: true, dovizCinsi: true, aciklama: true, gelirTuru: true,
      cari: { select: { unvan: true } },
      satirlar: { select: { matrah: true, stok: { select: { tip: true } } } },
    },
  });
  const masraflar = await tx.masraf.findMany({
    where: { tenantId, durum: "onaylandi", tarih: { gte: baslangic, lte: bitis } },
    select: {
      id: true, belgeNo: true, tarih: true, matrah: true, kur: true, dovizCinsi: true, aciklama: true, saticiUnvan: true,
      kategori: { select: { id: true, ad: true, ust: { select: { id: true, ad: true } } } },
      cari: { select: { unvan: true } },
    },
  });
  const gelirKayitlari = await tx.gelirKaydi.findMany({
    where: { tenantId, tarih: { gte: baslangic, lte: bitis } },
    select: {
      id: true, belgeNo: true, tarih: true, brutTutar: true, kur: true, dovizCinsi: true, aciklama: true,
      kategori: { select: { id: true, ad: true, ust: { select: { id: true, ad: true } } } },
      cari: { select: { unvan: true } },
    },
  });
  // Bordro dönemin son günü tahakkuk eder; aralığa ay sonu düşen dönemler alınır.
  const ilkYil = baslangic.getUTCFullYear();
  const sonYil = bitis.getUTCFullYear();
  const bordrolar = (
    await tx.personelBordro.findMany({
      where: { tenantId, donemYil: { gte: ilkYil, lte: sonYil }, durum: { notIn: ["reddedildi", "iptal"] } },
      select: { id: true, donemYil: true, donemAy: true, odenecekTutar: true, personel: { select: { ad: true, soyad: true } } },
    })
  ).filter((b) => {
    const aySonu = new Date(Date.UTC(b.donemYil, b.donemAy, 0));
    return aySonu >= baslangic && aySonu <= bitis;
  });

  const { kalemler, cevrilemeyen } = tahakkukSiniflandir({ faturalar, masraflar, gelirKayitlari, bordrolar });
  const uyarilar = cevrilemeyen ? [`${cevrilemeyen} dövizli masraf, kuru kayıtlı olmadığı için sayılmadı.`] : [];
  return { kalemler, uyarilar };
}
