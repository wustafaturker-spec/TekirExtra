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
    /**
     * DMR-13: `demirbas` — demirbaşa bağlı alış satırı (varlıktır, gider değil);
     * `demirbasCikisTl` — satılan demirbaşa bağlanan TL tutarı (satış geliri değil).
     */
    satirlar: { matrah: Sayi; stok: { tip: string } | null; demirbas?: boolean; demirbasCikisTl?: Sayi }[];
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
    /** PRS-05: personel gideri; mevzuatlıda işveren maliyeti, değilse kazanç toplamı. Yoksa ödenecek. */
    giderTutari?: Sayi;
    personel: { ad: string; soyad: string };
  }[];
  /** DMR-13: kesin yıl sonu amortismanı (31.12), kart başına. */
  amortismanlar?: { id: string; yil: number; kod: string; ad: string; tutar: Sayi }[];
  /** DMR-13: elden çıkış; fark = satış bedeli − net defter değeri (kâr pozitif). */
  demirbasCikislari?: { id: string; tarih: Date; kod: string; ad: string; tur: string; fark: Sayi }[];
}

/**
 * PRS-05 (P1-4): personel gideri işveren maliyetidir (brüt + işveren SGK ve
 * işsizlik − teşvik, hesap özetinden). Mevzuatsız (net ücretli) bordroda vergi
 * ve SGK hesaplanmadığı için kazanç kalemlerinin toplamı alınır; avans mahsubu
 * gideri azaltmaz.
 */
export function bordroGideri(hesapOzeti: unknown, kalemler: { tip: string; tutar: Sayi }[]): number {
  const ozet = hesapOzeti && typeof hesapOzeti === "object" ? (hesapOzeti as Record<string, unknown>).isverenMaliyeti : undefined;
  if (typeof ozet === "string" || typeof ozet === "number") return Number(ozet);
  return kalemler.filter((k) => k.tip === "kazanc").reduce((t, k) => t + sayi(k.tutar), 0);
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
  { anahtar: "personel", tur: "gider", anaKategori: "Personel Giderleri", altKategori: "Bordro (işveren maliyeti)" },
  // DMR-13: demirbaş alışı gider değildir; gideri yıl sonu amortismanıdır. Çıkışta yalnız kâr/zarar.
  { anahtar: "amortisman", tur: "gider", anaKategori: "Amortisman Giderleri", altKategori: "Amortisman" },
  { anahtar: "demirbas_cikis_zarari", tur: "gider", anaKategori: "Faaliyet Dışı Giderler", altKategori: "Demirbaş Satış ve Hurda Zararı" },
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
      // DMR-13: satılan demirbaşa bağlanan tutar gelir değil; kâr/zararı çıkış kaydından gelir.
      const dmr = f.satirlar.reduce((t, s) => t + sayi(s.demirbasCikisTl), 0) / kur;
      const gelir = kurus(matrah - dmr);
      if (gelir > 0 || dmr === 0) ekle(f.id, `satis:${tur}`, gelir, f.aciklama || "Satış faturası");
    } else if (f.tip === "satis_iade") {
      ekle(f.id, "satis_iadesi", matrah, f.aciklama || "Satış iade faturası");
    } else if (f.tip === "alis_iade") {
      ekle(f.id, "alis_iadesi", matrah, f.aciklama || "Alış iade faturası");
    } else if (f.tip === "alis") {
      // Hizmet/mal ayrımı satır matrahlarının oranıyla faturanın toplam
      // matrahına ölçeklenir; genel iskonto toplamı kaydırmasın.
      // DMR-13: demirbaşa bağlı satırlar gider değildir, payları düşülür.
      const satirToplam = f.satirlar.reduce((t, s) => t + sayi(s.matrah), 0);
      const hizmetSatir = f.satirlar.filter((s) => !s.demirbas && s.stok?.tip === "hizmet").reduce((t, s) => t + sayi(s.matrah), 0);
      const demirbasSatir = f.satirlar.filter((s) => s.demirbas).reduce((t, s) => t + sayi(s.matrah), 0);
      const hizmet = satirToplam > 0 ? kurus((matrah * hizmetSatir) / satirToplam) : 0;
      const demirbas = satirToplam > 0 ? kurus((matrah * demirbasSatir) / satirToplam) : 0;
      const mal = kurus(matrah - hizmet - demirbas);
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
    const tutar = kurus(sayi(b.giderTutari ?? b.odenecekTutar));
    kalemler.push({
      id: b.id, tarih: ayinSonGunu(b.donemYil, b.donemAy), tur: "gider", anahtar: "personel",
      anaKategori: personel.anaKategori, altKategori: personel.altKategori,
      belgeNo: `BRD-${b.donemYil}-${String(b.donemAy).padStart(2, "0")}`, cariUnvan: `${b.personel.ad} ${b.personel.soyad}`,
      aciklama: `${String(b.donemAy).padStart(2, "0")}.${b.donemYil} bordrosu`, dovizCinsi: "TRY", tutar, tutarTry: tutar,
    });
  }

  const amortisman = sabit("amortisman");
  for (const a of veri.amortismanlar ?? []) {
    const tutar = kurus(sayi(a.tutar));
    kalemler.push({
      id: a.id, tarih: `${a.yil}-12-31`, tur: "gider", anahtar: "amortisman", anaKategori: amortisman.anaKategori, altKategori: amortisman.altKategori,
      belgeNo: a.kod, cariUnvan: "—", aciklama: `${a.ad} ${a.yil} amortismanı`, dovizCinsi: "TRY", tutar, tutarTry: tutar,
    });
  }
  for (const c of veri.demirbasCikislari ?? []) {
    const fark = kurus(sayi(c.fark));
    if (fark === 0) continue;
    const k = sabit(fark > 0 ? "satis:varlik_satisi" : "demirbas_cikis_zarari");
    kalemler.push({
      id: c.id, tarih: isoGun(c.tarih), tur: k.tur, anahtar: fark > 0 ? "satis:varlik_satisi" : "demirbas_cikis_zarari", anaKategori: k.anaKategori, altKategori: k.altKategori,
      belgeNo: c.kod, cariUnvan: "—", aciklama: `${c.ad} elden çıkışı (${fark > 0 ? "kâr" : "zarar"})`, dovizCinsi: "TRY", tutar: Math.abs(fark), tutarTry: Math.abs(fark),
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
      satirlar: { select: { id: true, matrah: true, stok: { select: { tip: true } } } },
    },
  });
  // DMR-13: demirbaşa bağlı satırlar, kesin amortisman ve elden çıkışlar.
  const satirIdleri = faturalar.flatMap((f) => f.satirlar.map((s) => s.id));
  const yillar = Array.from({ length: bitis.getUTCFullYear() - baslangic.getUTCFullYear() + 1 }, (_, i) => baslangic.getUTCFullYear() + i)
    .filter((y) => { const d = new Date(Date.UTC(y, 11, 31)); return d >= baslangic && d <= bitis; });
  const [dmrGiris, dmrIlave, dmrCikisSatir, amortismanSatirlari, cikislar] = await Promise.all([
    tx.demirbas.findMany({ where: { tenantId, faturaSatirId: { in: satirIdleri } }, select: { faturaSatirId: true } }),
    tx.demirbasIlaveBedel.findMany({ where: { tenantId, faturaSatirId: { in: satirIdleri } }, select: { faturaSatirId: true } }),
    tx.demirbas.findMany({ where: { tenantId, cikisFaturaSatirId: { in: satirIdleri } }, select: { cikisFaturaSatirId: true, cikisBedeli: true } }),
    yillar.length ? tx.amortismanSatiri.findMany({ where: { tenantId, yil: { in: yillar }, donem: { durum: "kesin" } }, select: { id: true, yil: true, tutar: true, demirbas: { select: { kod: true, ad: true } } } }) : [],
    tx.demirbas.findMany({ where: { tenantId, cikisTarihi: { gte: baslangic, lte: bitis } }, select: { id: true, kod: true, ad: true, cikisTarihi: true, cikisTuru: true, cikisBedeli: true, cikisBirikmis: true, edinmeBedeli: true, ilaveBedeller: { select: { tutar: true } } } }),
  ]);
  const demirbasSatirlari = new Set([...dmrGiris, ...dmrIlave].map((d) => d.faturaSatirId));
  const cikisTl = new Map<string, number>();
  for (const d of dmrCikisSatir) cikisTl.set(d.cikisFaturaSatirId!, (cikisTl.get(d.cikisFaturaSatirId!) ?? 0) + sayi(d.cikisBedeli));
  const faturaVerisi = faturalar.map((f) => ({ ...f, satirlar: f.satirlar.map((s) => ({ ...s, demirbas: demirbasSatirlari.has(s.id), demirbasCikisTl: cikisTl.get(s.id) ?? 0 })) }));
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
      select: { id: true, donemYil: true, donemAy: true, odenecekTutar: true, hesapOzeti: true, kalemler: { select: { tip: true, tutar: true } }, personel: { select: { ad: true, soyad: true } } },
    })
  ).filter((b) => {
    const aySonu = new Date(Date.UTC(b.donemYil, b.donemAy, 0));
    return aySonu >= baslangic && aySonu <= bitis;
  }).map(({ hesapOzeti, kalemler, ...b }) => ({ ...b, giderTutari: bordroGideri(hesapOzeti, kalemler) }));

  const { kalemler, cevrilemeyen } = tahakkukSiniflandir({
    faturalar: faturaVerisi, masraflar, gelirKayitlari, bordrolar,
    amortismanlar: amortismanSatirlari.map((a) => ({ id: a.id, yil: a.yil, kod: a.demirbas.kod, ad: a.demirbas.ad, tutar: a.tutar })),
    demirbasCikislari: cikislar.map((c) => {
      const bedel = c.ilaveBedeller.reduce((t, i) => t + sayi(i.tutar), sayi(c.edinmeBedeli));
      return { id: c.id, tarih: c.cikisTarihi!, kod: c.kod, ad: c.ad, tur: c.cikisTuru ?? "", fark: sayi(c.cikisBedeli) - (bedel - sayi(c.cikisBirikmis)) };
    }),
  });
  const uyarilar = cevrilemeyen ? [`${cevrilemeyen} dövizli masraf, kuru kayıtlı olmadığı için sayılmadı.`] : [];
  return { kalemler, uyarilar };
}
