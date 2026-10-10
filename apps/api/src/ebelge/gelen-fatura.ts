/**
 * EBLG-115…119: gelen e-Faturadan alış (ya da satış iadesi) faturası girdisi
 * ve tutar kapısı. Girdi belgeden türetilir (özel matrah, tevkifat, kur,
 * belge iskontosu, iade referansları); oluşacak faturanın tutarları belgenin
 * toplamlarıyla karşılaştırılır, tolerans aşılırsa işleme durur.
 */
import { dovizKoduMu, faturaHesapla, kdvOraniHatasi, ozelMatrahKdvsi, ozelMatrahKoduBul, tevkifatKoduBul, tevkifatPayPayda, vergiTuruBul, VARSAYILAN_KOD_TABLOSU, VARSAYILAN_VERGI_TURLERI, type FaturaHesaplaSonuc, type KodTablosu, type TevkifatKodu, type VergiTuru } from "@tekirextra/shared";
import type { UblFatura, UblVergi } from "./ubl-oku";

export type GelenFaturaTipi = "alis" | "satis_iade";
const IADE_TIPLERI = new Set(["IADE", "TEVKIFATIADE"]);

/** EBLG-119: müşterinin bize kestiği iade belgesi bizim satış iademizdir. */
export const gelenFaturaTipi = (ubl: Pick<UblFatura, "faturaTipKodu">): GelenFaturaTipi => (IADE_TIPLERI.has(ubl.faturaTipKodu) ? "satis_iade" : "alis");

/** Belgedeki tevkifat yüzdesi (ör. 70) → sistemin oran biçimi (7/10). */
export const tevkifatOraniMetni = (yuzde: number) => `${Math.round(yuzde / 10)}/10`;

/** MVZ-10: gelen belgede görülen, merkezde karşılığı olmayan kod/oran (kiracı bilgisi taşımaz). */
export interface BilinmeyenMevzuat { tur: string; anahtar: string; aciklama: string }

export interface GelenSatirEslesmesi { stokId: string; varyantId?: string | null }

export interface GelenFaturaGirdisi {
  tip: GelenFaturaTipi;
  dovizCinsi: string;
  kur: string;
  genelIskontoTutari: string;
  ozelMatrahKodu: string | null;
  ozelMatrahTutari: string | null;
  ozelMatrahOrani: string | null;
  satirlar: { siraNo: number; stokId: string; varyantId: string | null; miktar: string; birim: string; birimFiyat: string; iskontoOrani: string; kdvOrani: string; tevkifatKodu: string | null; tevkifatOrani: string | null; ekVergiler: GelenEkVergi[] }[];
}

/** EBLG-120: satıra aktarılan KDV dışı vergi (belge dövizinde). */
export interface GelenEkVergi { kod: string; oran: string | null; matrah: string | null; tutar: string }

const kurus = (v: number) => Math.round(v * 100) / 100;

/**
 * EBLG-120: satır vergileri olduğu gibi; yalnız başlıkta yazılmış bir kod
 * satırlara matrah (LineExtensionAmount) oranında dağıtılır, kuruş farkı son
 * satıra. Aynı kod satırda da varsa başlıktaki tekrar sayılmaz.
 */
export function gelenEkVergileri(ubl: Pick<UblFatura, "satirlar" | "toplamlar">): GelenEkVergi[][] {
  const metin = (v: number | null) => (v === null ? null : String(v));
  const satirlar = ubl.satirlar.map((s) => s.digerVergiler.map((v) => ({ kod: v.kod, oran: metin(v.oran), matrah: metin(v.matrah), tutar: kurus(v.tutar).toFixed(2) })));
  const satirKodlari = new Set(ubl.satirlar.flatMap((s) => s.digerVergiler.map((v) => v.kod)));
  const baslikta = new Map<string, UblVergi[]>();
  for (const v of ubl.toplamlar.digerVergiler.filter((v) => !satirKodlari.has(v.kod))) baslikta.set(v.kod, [...(baslikta.get(v.kod) ?? []), v]);
  const toplamMatrah = ubl.satirlar.reduce((t, s) => t + s.matrah, 0);
  for (const [kod, liste] of baslikta) {
    const tutar = kurus(liste.reduce((t, v) => t + v.tutar, 0));
    if (tutar === 0) continue;
    const oran = liste.length === 1 ? metin(liste[0].oran) : null;
    let dagitilan = 0;
    ubl.satirlar.forEach((s, i) => {
      const pay = i === ubl.satirlar.length - 1 ? kurus(tutar - dagitilan) : toplamMatrah > 0 ? kurus(tutar * s.matrah / toplamMatrah) : 0;
      dagitilan = kurus(dagitilan + pay);
      if (pay !== 0) satirlar[i].push({ kod, oran, matrah: oran === null ? null : String(s.matrah), tutar: pay.toFixed(2) });
    });
  }
  return satirlar;
}

/**
 * Fatura girdisi + işlemeyi durduran engeller. Engelden dönen girdi yine
 * hesaplanır ki onay ekranı farkı gösterebilsin.
 */
export function gelenFaturaGirdisi(
  ubl: UblFatura,
  eslesme: (siraNo: number) => GelenSatirEslesmesi | undefined,
  /** MVZ-12: belge tarihindeki merkezi tevkifat tablosu; verilmezse varsayılan. */
  tevkifatTablosu?: readonly TevkifatKodu[],
  /** MVZ-11: belge tarihindeki KDV oranları ve kodları; verilmezse varsayılan. */
  kodTablosu: KodTablosu = VARSAYILAN_KOD_TABLOSU,
): { girdi: GelenFaturaGirdisi; engeller: string[]; bilinmeyenler: BilinmeyenMevzuat[] } {
  const engeller: string[] = [];
  const bilinmeyenler: BilinmeyenMevzuat[] = [];
  const doviz = ubl.dovizCinsi !== "TRY";
  if (!dovizKoduMu(ubl.dovizCinsi)) engeller.push(`Belge dövizi (${ubl.dovizCinsi}) sistemde tanımlı değil`);
  if (doviz && !(ubl.kur && ubl.kur > 0)) engeller.push(`Dövizli (${ubl.dovizCinsi}) belgede kur yok; TL karşılığı bilinmeden işlenemez`);
  if (ubl.toplamlar.belgeArtirimi > 0) engeller.push(`Belge düzeyinde ${ubl.toplamlar.belgeArtirimi.toFixed(2)} ${ubl.dovizCinsi} artırım (masraf) var; aktarılamıyor`);
  // EBLG-120: KDV dışı vergiler alış faturasına aktarılır; kod merkezde tanımlı olmalı.
  const ekVergiler = gelenEkVergileri(ubl);
  const vergiKodlari = new Map([...ubl.toplamlar.digerVergiler, ...ubl.satirlar.flatMap((s) => s.digerVergiler)].map((v) => [v.kod, v.ad] as const));
  for (const [kod, ad] of vergiKodlari) {
    if (!vergiTuruBul(kod, kodTablosu.vergiTurleri)) {
      engeller.push(`Vergi türü ${kod}${ad ? ` (${ad})` : ""} belge tarihinde tanımlı değil (Mevzuat Merkezi ekibine iletildi)`);
      bilinmeyenler.push({ tur: "vergi_turu_kodu", anahtar: kod, aciklama: `Gelen e-Faturada tanınmayan vergi türü ${kod}${ad ? ` (${ad})` : ""}, belge tarihi ${ubl.tarih}` });
    }
  }
  if (vergiKodlari.size && gelenFaturaTipi(ubl) !== "alis") engeller.push(`KDV dışı vergili iade belgesi aktarılamıyor (${[...vergiKodlari.values()].filter(Boolean).join(", ") || [...vergiKodlari.keys()].join(", ")}); faturayı elle girin`);

  const ozelMatrah = ubl.faturaTipKodu === "OZELMATRAH";
  const ozelMatrahKodlari = ubl.istisnaKodlari.filter((k) => ozelMatrahKoduBul(k, kodTablosu.ozelMatrah));
  if (ozelMatrah && ozelMatrahKodlari.length > 1) engeller.push(`Belgede birden çok özel matrah kodu var (${ozelMatrahKodlari.join(", ")}); fatura tek kod taşır`);
  else if (ozelMatrah && !ozelMatrahKoduBul(ubl.toplamlar.ozelMatrahKodu, kodTablosu.ozelMatrah)) {
    engeller.push(`Özel matrah kodu tanınmıyor: ${ubl.toplamlar.ozelMatrahKodu ?? "yok"}`);
    if (ubl.toplamlar.ozelMatrahKodu) bilinmeyenler.push({ tur: "ozel_matrah_kodu", anahtar: ubl.toplamlar.ozelMatrahKodu, aciklama: `Gelen e-Faturada tanınmayan özel matrah kodu ${ubl.toplamlar.ozelMatrahKodu}, belge tarihi ${ubl.tarih}` });
  }

  // MVZ-11: satır KDV oranı belge tarihindeki merkezi listede olmalı (özel matrahta satırlar KDV'sizdir).
  if (!ozelMatrah) {
    for (const oran of new Set(ubl.satirlar.map((s) => Math.max(0, s.kdvOrani)))) {
      if (kdvOraniHatasi(oran, kodTablosu.kdvOranlari)) {
        engeller.push(`KDV oranı %${oran} belge tarihinde (${ubl.tarih}) geçerli değil (Mevzuat Merkezi ekibine iletildi)`);
        bilinmeyenler.push({ tur: "kdv_orani", anahtar: String(oran), aciklama: `Gelen e-Faturada %${oran} KDV oranı görüldü; belge tarihinde (${ubl.tarih}) merkezde yok` });
      }
    }
  }

  // EBLG-117: tevkifatı yalnız başlıkta yazan belgede tek kod KDV'li her
  // satıra uygulanır; birden çok kod satırlara dağıtılamaz.
  const satirdaTevkifatVar = ubl.satirlar.some((s) => s.tevkifat);
  const baslikKodlari = [...new Map(ubl.toplamlar.tevkifatKodlari.map((t) => [`${t.kod}/${t.oran}`, t])).values()];
  const baslikTevkifati = !satirdaTevkifatVar && baslikKodlari.length === 1 ? baslikKodlari[0] : undefined;
  if (!satirdaTevkifatVar && baslikKodlari.length > 1) engeller.push(`Tevkifat yalnız başlıkta ve birden çok kodla yazılmış (${baslikKodlari.map((t) => t.kod).join(", ")}); satırlara dağıtılamıyor`);

  const satirlar = ubl.satirlar.map((s) => {
    const e = eslesme(s.siraNo);
    let tevkifatKodu: string | null = null, tevkifatOrani: string | null = null;
    const tevkifat = s.tevkifat ?? (baslikTevkifati && s.kdvOrani > 0 ? baslikTevkifati : undefined);
    if (tevkifat) {
      const kod = tevkifatKoduBul(tevkifat.kod, tevkifatTablosu);
      if (!kod) {
        engeller.push(`${s.siraNo}. satırın tevkifat kodu tanınmıyor: ${tevkifat.kod}`);
        bilinmeyenler.push({ tur: "tevkifat_kodu", anahtar: tevkifat.kod, aciklama: `Gelen e-Faturada tanınmayan tevkifat kodu ${tevkifat.kod} (%${tevkifat.oran}), belge tarihi ${ubl.tarih}` });
      }
      else {
        tevkifatKodu = kod.kod;
        const oran = tevkifatOraniMetni(tevkifat.oran);
        if (kod.oranlar.length > 1) {
          if (!kod.oranlar.includes(oran)) {
            engeller.push(`${s.siraNo}. satırın tevkifat oranı (%${tevkifat.oran}) ${kod.kod} koduna uymuyor`);
            bilinmeyenler.push({ tur: "tevkifat_kodu", anahtar: kod.kod, aciklama: `Gelen e-Faturada ${kod.kod} kodu %${tevkifat.oran} oranla görüldü (merkezde ${kod.oranlar.join(", ")}), belge tarihi ${ubl.tarih}` });
          }
          tevkifatOrani = oran;
        } else if (kod.oranlar[0] !== oran) {
          engeller.push(`${s.siraNo}. satırda ${kod.kod} kodu %${tevkifat.oran} oranla yazılmış; belge tarihinde merkezi oran ${kod.oranlar[0]} (Mevzuat Merkezi ekibine iletildi)`);
          bilinmeyenler.push({ tur: "tevkifat_kodu", anahtar: kod.kod, aciklama: `Gelen e-Faturada ${kod.kod} kodu %${tevkifat.oran} oranla görüldü (merkezde ${kod.oranlar[0]}), belge tarihi ${ubl.tarih}` });
        }
      }
    }
    return {
      siraNo: s.siraNo, stokId: e?.stokId ?? "", varyantId: e?.varyantId ?? null,
      miktar: s.miktar.toFixed(3), birim: s.birim, birimFiyat: s.birimFiyat.toFixed(4),
      iskontoOrani: Math.max(0, s.iskontoOrani).toFixed(2),
      // EBLG-116: özel matrahta KDV satırdan değil özel matrahtan doğar.
      kdvOrani: ozelMatrah ? "0" : Math.max(0, s.kdvOrani).toFixed(2),
      tevkifatKodu, tevkifatOrani,
      ekVergiler: ekVergiler[ubl.satirlar.indexOf(s)] ?? [],
    };
  });

  return {
    engeller,
    bilinmeyenler,
    girdi: {
      tip: gelenFaturaTipi(ubl),
      dovizCinsi: ubl.dovizCinsi,
      kur: doviz ? (ubl.kur ?? 0).toFixed(6) : "1",
      genelIskontoTutari: ubl.toplamlar.belgeIskontosu.toFixed(2),
      ozelMatrahKodu: ozelMatrah ? ubl.toplamlar.ozelMatrahKodu ?? null : null,
      ozelMatrahTutari: ozelMatrah ? (ubl.toplamlar.ozelMatrah ?? 0).toFixed(2) : null,
      ozelMatrahOrani: ozelMatrah ? String(ubl.toplamlar.ozelMatrahOrani ?? 0) : null,
      satirlar,
    },
  };
}

/** Fatura servisinin kesinleştirmede yapacağı hesabın aynısı. */
export function gelenFaturaHesabi(girdi: GelenFaturaGirdisi, kdvTahsilEdilmez: boolean, tevkifatTablosu?: readonly TevkifatKodu[], vergiTurleri: readonly VergiTuru[] = VARSAYILAN_VERGI_TURLERI): FaturaHesaplaSonuc {
  return faturaHesapla({
    satirlar: girdi.satirlar.map((s) => {
      const oran = tevkifatPayPayda(s.tevkifatKodu, s.tevkifatOrani, tevkifatTablosu);
      // EBLG-120: tanınmayan kod engel üretir; hesapta bedele eklenen vergi sayılır.
      const ekVergiler = s.ekVergiler.map((v) => {
        const tur = vergiTuruBul(v.kod, vergiTurleri);
        return { tutar: Number(v.tutar), stopaj: tur?.stopaj ?? false, kdvMatrahinaDahil: tur?.kdvMatrahinaDahil ?? false };
      });
      return { stokId: s.stokId, miktar: Number(s.miktar), birimFiyat: Number(s.birimFiyat), iskontoOrani: Number(s.iskontoOrani), kdvOrani: Number(s.kdvOrani), tevkifatPay: oran?.pay, tevkifatPayda: oran?.payda, ekVergiler };
    }),
    genelIskontoTutari: Number(girdi.genelIskontoTutari),
    kdvTahsilEdilmez,
    ozelMatrahKdvsi: girdi.ozelMatrahKodu ? ozelMatrahKdvsi(girdi.ozelMatrahTutari, girdi.ozelMatrahOrani) : 0,
  });
}

export interface TutarFarki { alan: "matrah" | "kdv" | "tevkifat" | "ek_vergi" | "stopaj" | "odenecek"; ad: string; belge: number; sistem: number; fark: number }
export interface TutarDenetimi {
  tolerans: number; satirlar: TutarFarki[]; asanlar: TutarFarki[]; gecerli: boolean;
  /** Farkın ya da belge kartı ile tablo arasındaki ayrımın bilinen nedenleri (ekranda gösterilir). */
  aciklamalar: string[];
}

/**
 * EBLG-115: belge dövizinde karşılaştırma; tolerans satır sayısı × 0,01 (en
 * az 0,05). Vergi toplamı belge dövizinde yazılmamışsa KDV satırı atlanır,
 * ödenecek tutar zaten kapsar. İhraç kayıtlı belgede KDV ödenmediği için
 * ödenecek yerine vergi dahil toplam karşılaştırılır.
 */
export function tutarDenetimi(ubl: UblFatura, hesap: FaturaHesaplaSonuc, ihracKayitli: boolean, vergiTurleri: readonly VergiTuru[] = VARSAYILAN_VERGI_TURLERI): TutarDenetimi {
  const t = ubl.toplamlar;
  // EBLG-120: belgedeki KDV dışı vergiler davranışına göre (başlık yoksa satırlardan).
  const belgeVergileri = t.digerVergiler.length ? t.digerVergiler : ubl.satirlar.flatMap((s) => s.digerVergiler);
  const stopajMi = (v: UblVergi) => vergiTuruBul(v.kod, vergiTurleri)?.stopaj ?? false;
  const belgeEkVergi = belgeVergileri.filter((v) => !stopajMi(v)).reduce((s, v) => s + v.tutar, 0);
  const belgeStopaj = belgeVergileri.filter(stopajMi).reduce((s, v) => s + v.tutar, 0);
  const tolerans = Math.max(0.05, ubl.satirlar.length * 0.01);
  const satir = (alan: TutarFarki["alan"], ad: string, belge: number, sistem: number): TutarFarki => ({ alan, ad, belge: yuvarla(belge), sistem: yuvarla(sistem), fark: yuvarla(sistem - belge) });
  const satirlar = [
    satir("matrah", "Matrah", t.matrah, hesap.toplamMatrah),
    ...(t.vergiParaBirimi === ubl.dovizCinsi ? [satir("kdv", "KDV", t.kdvSaf, hesap.toplamKdv)] : []),
    satir("tevkifat", "Tevkifat", t.tevkifat, hesap.toplamTevkifat),
    ...(belgeEkVergi || hesap.toplamEkVergi ? [satir("ek_vergi", "KDV dışı vergiler", belgeEkVergi, hesap.toplamEkVergi)] : []),
    ...(belgeStopaj || hesap.toplamStopaj ? [satir("stopaj", "Stopaj", belgeStopaj, hesap.toplamStopaj)] : []),
    ihracKayitli
      ? satir("odenecek", "Vergiler dahil toplam", t.vergiDahil || t.genelToplam, hesap.genelToplam + hesap.toplamKdv)
      : satir("odenecek", "Ödenecek tutar", t.odenecek || t.genelToplam, hesap.genelToplam),
  ];
  const asanlar = satirlar.filter((s) => Math.abs(s.fark) > tolerans + 1e-9);
  const tl = (v: number) => `${v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ubl.dovizCinsi}`;
  const aciklamalar: string[] = [];
  if (t.kdvIcindeTevkifat > 0 && t.tevkifat === 0) {
    aciklamalar.push(`Belgedeki ${tl(t.kdvIcindeTevkifat)} tevkifat (9015) standart tevkifat alanına değil KDV toplamının içine yazılmış; sistem bunu tevkifat olarak okuyamadığı için ödenecek tutar tutmuyor. Gönderenden belgeyi düzeltmesini isteyin ya da faturayı elle girin.`);
  }
  if (belgeStopaj) aciklamalar.push(`Belgede ${tl(belgeStopaj)} stopaj var; ödenecek tutardan düşülür, muhasebede 360'a alacak yazılır.`);
  if (Math.abs(t.kdv - t.kdvSaf) > tolerans) aciklamalar.push(`Üstteki KDV kartı belgenin vergi toplamıdır (${tl(t.kdv)}); tablodaki KDV yalnız KDV alt toplamlarıdır (${tl(t.kdvSaf)}).`);
  return { tolerans, satirlar, asanlar, gecerli: asanlar.length === 0, aciklamalar };
}

const yuvarla = (v: number) => Math.round(v * 100) / 100;
