import {
  YOLCU_BERABER_FATURA_TIPI,
  YOLCU_BERABER_ISTISNA_ACIKLAMASI,
  YOLCU_BERABER_ISTISNA_KODU,
  YOLCU_BERABER_PROFILI,
  idisBelgesiMi,
  ytbBelgesiMi,
  ytbHarcamaTipiBul,
  ytbNormalize,
  idisNormalize,
  ihracKayitliKoduBul,
  ilaveFaturaTipiBul,
  SARJ_TURU_ADLARI,
  ozelMatrahKdvsi,
  ozelMatrahKoduBul,
  type KodTablosu,
  senaryoUblKodu,
  ulkeAdi,
  type AraciKurum,
  type FaturaSenaryosu,
  type SarjTuru,
  type YolcuBilgisi,
  ilgiliKisiMetni,
  belgeDiliNormalize,
  ciftDilGecerli,
  TESLIM_SARTLARI,
  type BelgeDili,
} from "@tekirextra/shared";
import { kacis, paraBicim, sayiBicim, tarihBicim, tlKarsiligi, type FirmaIletisimi } from "../core/pdf/pdf-sablon";
import { type TicariBelgeModeli, type TicariBelgeOrtami, type TicariBelgeToplami, bicimleyiciler, ticariBelgeHtml, vergiDairesiMetni } from "../core/pdf/ticari-belge";
import { cevir, type EtiketAnahtari, tasimaSekliMetni, teslimSekliMetni } from "../core/pdf/belge-sozlugu";

/** Fatura PDF şablonu (FTR-07, T-02 altyapısı). */


export interface FaturaPdfSatiri {
  stokKod: string;
  stokAd: string;
  /** Varyantlı satırda varyant kodu/adı ve nitelikleri; yoksa ana kart. */
  satirKod?: string;
  satirAd?: string;
  satirAciklama?: string;
  miktar: string;
  birim: string;
  birimFiyat: string;
  iskontoOrani: string;
  matrah: string;
  kdvOrani: string;
  kdvTutari: string;
  toplamTutar: string;
  /** FTR-11: satır bazlı GİB istisna kodu (ör. 301). */
  gibIstisnaKodu?: string | null;
  /** EBLG-128: satırın KDV dışı vergileri (ad ve tutar). */
  ekVergiler?: { kod?: string; ad: string; tutar: string; stopaj: boolean; kdvMatrahinaDahil?: boolean }[];
  /** EBLG-78: yatırım teşvik harcama tipi ve makine kimlikleri. */
  ytbHarcamaTipi?: string | null;
  ytbMakineAdi?: string | null;
  ytbMakineId?: string | null;
  ytbMakineSiraNo?: string | null;
  /** EBLG-72: İDİS etiket numarası. */
  idisEtiketNo?: string | null;
  /** STK-41: kartın belge dilindeki adı ve açıklaması. */
  yabanciAd?: string | null;
  yabanciAciklama?: string | null;
  /** FTR-39: proforma/ihracat bilgisi — kart menşei, GTİP ve satırın kap bilgisi. */
  mensei?: string | null;
  gtipKodu?: string | null;
  ihracatKapCinsi?: string | null;
  ihracatKapNo?: string | null;
  ihracatKapAdet?: number | null;
  /** EBLG-71: SARJANLIK faturasında ünitenin seri numarası. */
  sarjUniteSeriNo?: string | null;
}

export interface FaturaPdfVerisi {
  /** MVZ-11: belge tarihindeki merkezi kod listesi; kod açıklamaları buradan (yoksa varsayılan liste). */
  kodTablosu?: KodTablosu;
  tip: string;
  durum: string;
  no: string | null;
  tarih: string | Date;
  vadeTarihi: string | Date | null;
  /** Sipariş referansı (EBLG-73); e-Belgede `OrderReference` olarak gider. */
  siparisNo?: string | null;
  siparisTarihi?: string | Date | null;
  /** FTR-31: müşterinin talep referansı. */
  talepNo?: string | null;
  talepTarihi?: string | Date | null;
  /** FTR-32: müşteri tarafında ilgili kişi. */
  ilgiliKisi?: string | null;
  ilgiliKisiGorevi?: string | null;
  /** FTR-30: teslim yeri; e-Belgede `cac:Delivery/cac:DeliveryAddress`. */
  teslimatAdres?: string | null;
  teslimatIl?: string | null;
  teslimatIlce?: string | null;
  teslimatPostaKodu?: string | null;
  dovizCinsi: string;
  kur: string;
  toplamBrut: string;
  toplamSatirIskontosu: string;
  genelIskontoToplam: string;
  toplamMatrah: string;
  toplamKdv: string;
  /** EBLG-60: ihraç kayıtlı kodu; doluysa KDV gösterilir ama tahsil edilmez. */
  ihracKayitliKodu?: string | null;
  toplamTevkifat: string;
  /** EBLG-120: bedele eklenen KDV dışı vergiler ve kesilen stopaj. */
  toplamEkVergi?: string;
  toplamStopaj?: string;
  genelToplam: string;
  aciklama: string | null;
  cari: {
    kod: string;
    unvan: string;
    vknTckn: string | null;
    vergiDairesi?: string | null;
    adres?: { adres: string; il?: string | null; ilce?: string | null; postaKodu?: string | null; ulke?: string | null } | null;
  };
  satirlar: FaturaPdfSatiri[];
  /** FTR-40: basım dili; çift dilde Türkçe + bu dil. */
  belgeDili?: string;
  ciftDil?: boolean;
  /** FTR-39: ihracat koşulları (EBLG-53/54). */
  ihracatTeslimSarti?: string | null;
  ihracatTasimaSekli?: string | null;
  gumrukBeyannameNo?: string | null;
  gumrukBeyannameTarihi?: string | null;
  /** FTR-39: "faturada göster" işaretli banka hesapları; belge dövizindekiler önce. */
  bankalar?: { bankaAdi: string; sube?: string | null; iban: string; swift?: string | null; doviz: string }[];
  /** Faturanın e-belge kanalı; gönderilmemişse yok (EBLG-26). */
  ebelge?: { tur: string } | null;
  earsivGonderimSekli?: string;
  /** EBLG-30: belgenin ETTN'i — UBL'de UUID olarak giden değerin aynısı. */
  id?: string;
  /** EBLG-30: satırlardan türetilen GİB senaryosu (FTR-16). */
  senaryo?: string;
  /** EBLG-30: e-Fatura profili; e-Arşiv'de kanal profili yazar. */
  efaturaProfili?: string;
  /** KAMU senaryosu: yalnız sihirbaz alıcıyı kamu idaresi bulduğunda dolar. */
  kamuHarcamaBirimiVkn?: string | null;
  kamuHarcamaBirimiAdi?: string | null;
  kamuIban?: string | null;
  /** Özel matrah (KDV K. 23): kod, matrah ve oran; KDV belge düzeyindedir. */
  ozelMatrahKodu?: string | null;
  ozelMatrahTutari?: string | null;
  ozelMatrahOrani?: string | null;
  /** SGK faturası: grup, Kurum'daki kod/ad, dosya no ve dönem (EBLG-70). */
  sgkIlaveFaturaTipi?: string | null;
  sgkMukellefKodu?: string | null;
  sgkMukellefAdi?: string | null;
  sgkDosyaNo?: string | null;
  sgkDonemBaslangic?: string | null;
  sgkDonemBitis?: string | null;
  /** Yolcu beraberi (tax-free): yolcu ve aracı kurum; boşsa değildir. */
  yolcuBeraberi?: { yolcu?: YolcuBilgisi | null; araciKurum?: AraciKurum | null } | null;
  /** Şarj faturası (EBLG-71): plaka, şarj süresi ve ESU raporları. */
  sarjPlaka?: string | null;
  sarjBaslangic?: string | Date | null;
  sarjBitis?: string | Date | null;
  sarjEsuRaporlari?: { raporId: string; tarih: string }[] | null;
  /** İDİS (EBLG-72): sevkiyat numarası; doluysa belge İDİS kapsamındadır. */
  idisSevkiyatNo?: string | null;
  /** Yatırım teşvik (EBLG-78): belge no doluysa fatura YTB kapsamındadır. */
  ytbNo?: string | null;
  ytbTarihi?: string | null;
}

/** EBLG-30: PDF'te gösterilen profil adı; UBL'deki ProfileID ile aynı ayrımdır. */
export function profilAdi(f: Pick<FaturaPdfVerisi, "ebelge" | "efaturaProfili" | "kamuIban" | "yolcuBeraberi">): string | null {
  if (!f.ebelge) return null;
  if (f.ebelge.tur === "earsiv") return "EARSIVFATURA";
  if (f.yolcuBeraberi?.yolcu) return YOLCU_BERABER_PROFILI;
  // KAMU bilgisi yalnız KAMU senaryosuyla giden belgede yazılır; UBL'de de
  // profil seçimini ezer.
  if (f.kamuIban) return "KAMU";
  return f.efaturaProfili === "ticari" ? "TICARIFATURA" : "TEMELFATURA";
}

/** IBAN'ı okunur biçimde dörderli gruplar: TR33 0006 1005 … */
const ibanBicim = (iban: string): string => iban.replace(/\s/g, "").replace(/(.{4})(?=.)/g, "$1 ");

/**
 * KAMU senaryosu (belge altı): ödemeyi yapacak harcama birimi ve ödemenin
 * yapılacağı IBAN — UBL'deki `BuyerCustomerParty` ve `PaymentMeans` karşılığı.
 */
function kamuBilgisi(f: FaturaPdfVerisi): string {
  if (!f.kamuIban) return "";
  const birim = f.kamuHarcamaBirimiAdi
    ? `${f.kamuHarcamaBirimiAdi}${f.kamuHarcamaBirimiVkn ? ` (VKN ${f.kamuHarcamaBirimiVkn})` : ""}`
    : f.kamuHarcamaBirimiVkn ?? "";
  return `<p>${birim ? `Ödemeyi yapacak harcama birimi: <strong>${kacis(birim)}</strong><br>` : ""}Ödemenin yapılacağı IBAN: <strong>${kacis(ibanBicim(f.kamuIban))}</strong></p>`;
}

/**
 * Özel matrah belge altı bilgisi: KDV satış bedeline dahildir ve yalnız özel
 * matrah üzerinden hesaplanır — alıcı bunu belgede görmelidir.
 */
function ozelMatrahBilgisi(f: FaturaPdfVerisi): string {
  const tanim = ozelMatrahKoduBul(f.ozelMatrahKodu, f.kodTablosu?.ozelMatrah);
  if (!tanim) return "";
  const kdv = ozelMatrahKdvsi(f.ozelMatrahTutari, f.ozelMatrahOrani);
  const paraBirimi = f.dovizCinsi === "TRY" ? "TL" : f.dovizCinsi;
  return `<p>Özel matrah (KDV Kanunu 23): <strong>${kacis(`${tanim.kod} — ${tanim.ad}`)}</strong><br>`
    + `KDV, satış bedelinin tamamı üzerinden değil özel matrah üzerinden hesaplanmıştır: matrah ${paraBicim(f.ozelMatrahTutari ?? "0")} ${paraBirimi}, oran %${sayiBicim(f.ozelMatrahOrani ?? "0")}, hesaplanan KDV ${paraBicim(kdv)} ${paraBirimi}.</p>`;
}

/**
 * SGK belge altı bilgisi: Kurum faturayı bu alanlarla eşleştirir, alıcı da
 * belgede görebilmelidir (SGK e-Fatura Teknik Doküman §3).
 */
function sgkBilgisi(f: FaturaPdfVerisi): string {
  const tip = ilaveFaturaTipiBul(f.sgkIlaveFaturaTipi);
  if (!tip) return "";
  const satirlar = [
    `İlave fatura tipi: <strong>${kacis(`${tip.kod} — ${tip.ad}`)}</strong>`,
    tip.mukellefKoduEtiketi && f.sgkMukellefKodu ? `${kacis(tip.mukellefKoduEtiketi)}: <strong>${kacis(f.sgkMukellefKodu)}</strong>` : "",
    tip.mukellefAdiEtiketi && f.sgkMukellefAdi ? `${kacis(tip.mukellefAdiEtiketi)}: <strong>${kacis(f.sgkMukellefAdi)}</strong>` : "",
    tip.dosyaNoEtiketi && f.sgkDosyaNo ? `${kacis(tip.dosyaNoEtiketi)}: <strong>${kacis(f.sgkDosyaNo)}</strong>` : "",
    tip.donem && f.sgkDonemBaslangic && f.sgkDonemBitis
      ? `Dönem: <strong>${tarihBicim(f.sgkDonemBaslangic)} – ${tarihBicim(f.sgkDonemBitis)}</strong>` : "",
  ].filter(Boolean);
  return `<p>SGK faturası<br>${satirlar.join("<br>")}</p>`;
}

/**
 * Şarj belge altı bilgisi (14.09.2026 şematronu §1): aracın plakası, şarjın
 * süresi ve ESU raporları — alıcı belgede görebilmelidir.
 */
function sarjBilgisi(f: FaturaPdfVerisi): string {
  const turu = f.senaryo === "sarj" || f.senaryo === "sarjanlik" ? (f.senaryo as SarjTuru) : null;
  if (!turu) return "";
  const an = (deger: string | Date | null | undefined) => {
    if (!deger) return "";
    const metin = typeof deger === "string" ? deger : deger.toISOString();
    return `${tarihBicim(metin.slice(0, 10))} ${metin.slice(11, 16)}`;
  };
  const raporlar = (f.sarjEsuRaporlari ?? []).map((rapor) => rapor.raporId).filter(Boolean);
  const satirlar = [
    f.sarjPlaka ? `Şarj edilen araç: <strong>${kacis(f.sarjPlaka)}</strong>` : "",
    f.sarjBaslangic && f.sarjBitis ? `Şarj süresi: <strong>${an(f.sarjBaslangic)} – ${an(f.sarjBitis)}</strong>` : "",
    raporlar.length ? `ESU rapor kimliği: ${kacis(raporlar.join(", "))}` : "",
    turu === "sarjanlik"
      ? f.satirlar.map((satir, index) => satir.sarjUniteSeriNo ? `${index + 1}. satır ünite seri no: ${kacis(satir.sarjUniteSeriNo)}` : "").filter(Boolean).join("<br>")
      : "",
  ].filter(Boolean);
  if (!satirlar.length) return "";
  return `<p>${kacis(SARJ_TURU_ADLARI[turu])}<br>${satirlar.join("<br>")}</p>`;
}

/**
 * İDİS belge altı bilgisi (GİB İDİS Teknik Kılavuzu v1.0): sevkiyat numarası
 * belge başına, etiket numarası satır başınadır.
 */
function idisBilgisi(f: FaturaPdfVerisi): string {
  if (!idisBelgesiMi(f.idisSevkiyatNo)) return "";
  const etiketler = f.satirlar
    .map((satir, index) => satir.idisEtiketNo ? `${index + 1}. satır: ${kacis(idisNormalize(satir.idisEtiketNo))}` : "")
    .filter(Boolean);
  return `<p>İDİS kapsamında teslim<br>Sevkiyat no: <strong>${kacis(idisNormalize(f.idisSevkiyatNo))}</strong>`
    + `${etiketler.length ? `<br>Etiket numaraları: ${etiketler.join(", ")}` : ""}</p>`;
}

/**
 * Yatırım teşvik belge altı bilgisi (GİB YTB Fatura Teknik Kılavuzu v1.2):
 * teşvik belgesi belge başına, harcama tipi ve makine kimlikleri satır
 * başınadır. Kendi çıktımız bunları basar; e-belgede aynı alanlar UBL'de
 * taşınır.
 */
function ytbBilgisi(f: FaturaPdfVerisi): string {
  if (!ytbBelgesiMi(f.ytbNo)) return "";
  const satirlar = f.satirlar
    .map((satir, index) => {
      const harcama = ytbHarcamaTipiBul(satir.ytbHarcamaTipi);
      if (!harcama) return "";
      const makine = [satir.ytbMakineAdi, satir.ytbMakineId ? `ID ${satir.ytbMakineId}` : "", satir.ytbMakineSiraNo ? `sıra ${satir.ytbMakineSiraNo}` : ""]
        .filter(Boolean)
        .join(", ");
      return `${index + 1}. satır: ${kacis(`${harcama.kod} — ${harcama.ad}`)}${makine ? ` (${kacis(makine)})` : ""}`;
    })
    .filter(Boolean);
  return `<p>Yatırım teşvik belgesi kapsamında teslim<br>`
    + `Teşvik belge no: <strong>${kacis(ytbNormalize(f.ytbNo))}</strong>${f.ytbTarihi ? ` (${tarihBicim(f.ytbTarihi)})` : ""}`
    + `${satirlar.length ? `<br>${satirlar.join("<br>")}` : ""}</p>`;
}

/**
 * Yolcu beraberi (tax-free) belge altı bilgisi: yolcunun kimliği ve KDV
 * iadesini yapacak aracı kurum — UBL'deki `BuyerCustomerParty` ve
 * `TaxRepresentativeParty` karşılığı. Mağaza çıktıyı yolcuya verir.
 */
function yolcuBeraberiBilgisi(f: FaturaPdfVerisi): string {
  const yolcu = f.yolcuBeraberi?.yolcu;
  if (!yolcu) return "";
  const araci = f.yolcuBeraberi?.araciKurum;
  const satirlar = [
    `Yolcu: <strong>${kacis(`${yolcu.ad ?? ""} ${yolcu.soyad ?? ""}`.trim())}</strong>`,
    yolcu.pasaportNo ? `Pasaport no: ${kacis(yolcu.pasaportNo)}` : "",
    yolcu.uyruk ? `Uyruğu: ${kacis(ulkeAdi(yolcu.uyruk) ?? yolcu.uyruk)}` : "",
    yolcu.sehir || yolcu.ulke ? `İkamet: ${kacis([yolcu.sehir, ulkeAdi(yolcu.ulke) ?? yolcu.ulke].filter(Boolean).join(" / "))}` : "",
    araci?.unvan ? `KDV iadesini yapacak aracı kurum: ${kacis(araci.unvan)}${araci.vkn ? ` (VKN ${kacis(araci.vkn)})` : ""}` : "",
  ].filter(Boolean);
  return `<p>${satirlar.join("<br>")}<br>${kacis(YOLCU_BERABER_ISTISNA_ACIKLAMASI)} (${YOLCU_BERABER_ISTISNA_KODU}); KDV, gümrük çıkış onayından sonra aracı kurumca iade edilir.</p>`;
}

/**
 * Elektronik ortamda iletilen e-Arşiv faturada bulunması gereken ibare
 * (EBLG-26). Kâğıt olarak teslim edilen e-Arşivde yer almaz.
 */
export const EARSIV_ELEKTRONIK_IBARESI = "e-Arşiv izni kapsamında elektronik ortamda iletilmiştir.";

/**
 * İhraç kayıtlı satışın belge altı ibaresi (EBLG-60). Metin kod listesindeki
 * addan gelir; kullanıcının kabul edilmiş belgesindeki açıklamayla aynı anlamı taşır.
 */
function ihracKayitliIbaresi(kod: string | null | undefined, tablo?: KodTablosu): string {
  const tanim = ihracKayitliKoduBul(kod, tablo?.ihracKayitli);
  return tanim
    ? `<p>${kacis(`${tanim.kod} — ${tanim.ad}: ihraç edilmek şartıyla teslim edildiğinden KDV tahsil edilmemiştir.`)}</p>`
    : "";
}

/** FTR-37/40: faturanın (proforma dahil) ortak kurumsal düzendeki modeli. */
export function faturaPdfModeli(f: FaturaPdfVerisi, kopya = false): TicariBelgeModeli {
  const dil = belgeDiliNormalize(f.belgeDili);
  const ciftDil = ciftDilGecerli(dil, f.ciftDil);
  const degerDili: BelgeDili = ciftDil ? "tr" : dil;
  const bic = bicimleyiciler(dil, ciftDil);
  const etiket = (k: EtiketAnahtari) => ciftDil ? `${cevir(k, "tr")} / ${cevir(k, dil)}` : cevir(k, dil);
  const ikiDilde = (uret: (d: BelgeDili) => string) => ciftDil ? `${uret("tr")} / ${uret(dil)}` : uret(dil);
  const proforma = f.tip === "proforma";
  const alis = f.tip === "alis" || f.tip === "alis_iade";
  const ozelMatrah = ozelMatrahKoduBul(f.ozelMatrahKodu, f.kodTablosu?.ozelMatrah);

  // EBLG-130: KDV dışı vergiler türüne göre toplanır; KDV matrahına dahil olanlar
  // (ÖTV…) KDV matrahından önce gelir ve matraha eklenir, diğerleri KDV'den sonra.
  const vergiTurleri = new Map<string, { ad: string; stopaj: boolean; dahil: boolean; tutar: number }>();
  for (const v of f.satirlar.flatMap((s) => s.ekVergiler ?? [])) {
    const anahtar = v.kod ?? v.ad;
    const m = vergiTurleri.get(anahtar) ?? { ad: v.ad, stopaj: v.stopaj, dahil: v.kdvMatrahinaDahil === true && !v.stopaj, tutar: 0 };
    m.tutar = Math.round((m.tutar + Number(v.tutar)) * 100) / 100;
    vergiTurleri.set(anahtar, m);
  }
  const vergiKalemleri = (dahil: boolean): TicariBelgeToplami[] => [...vergiTurleri.values()].filter((v) => v.dahil === dahil && v.tutar > 0)
    .map((v) => ({ etiket: { metin: v.ad }, ek: v.stopaj ? cevir("stopaj", degerDili) : undefined, deger: v.tutar, eksi: v.stopaj }));
  const dahilToplam = [...vergiTurleri.values()].filter((v) => v.dahil).reduce((t, v) => t + v.tutar, 0);
  // Satır bazında vergi bilgisi olmayan eski kayıt: toplam tek satırda kalır.
  const vergiDokumu = vergiTurleri.size > 0;
  const iskonto = Number(f.toplamSatirIskontosu) + Number(f.genelIskontoToplam);
  const oranlar = [...new Set(f.satirlar.map((s) => Number(s.kdvOrani)))];

  const toplamlar: TicariBelgeToplami[] = [
    ...(iskonto > 0 ? [{ etiket: "araToplam" as const, deger: f.toplamBrut }, { etiket: "iskonto" as const, deger: iskonto, eksi: true }] : []),
    // Özel matrahta satır toplamı "Mal/Hizmet Toplamı"dır; KDV özel matrahtan hesaplanır.
    ...(dahilToplam > 0 && !ozelMatrah
      ? [{ etiket: "malHizmetToplami" as const, deger: f.toplamMatrah }, ...vergiKalemleri(true), { etiket: "kdvMatrahi" as const, deger: (Number(f.toplamMatrah) + dahilToplam).toFixed(2) }]
      : [{ etiket: (ozelMatrah ? "malHizmetToplami" : "kdvMatrahi") as EtiketAnahtari, deger: f.toplamMatrah }, ...(ozelMatrah ? vergiKalemleri(true) : [])]),
    {
      etiket: "hesaplananKdv",
      ek: ozelMatrah ? `özel matrah %${bic.sayi(f.ozelMatrahOrani ?? "0")}`
        : f.ihracKayitliKodu ? `tahsil edilmez — ${f.ihracKayitliKodu}`
        : oranlar.length === 1 ? `%${oranlar[0]}` : undefined,
      deger: f.toplamKdv,
    },
    ...(Number(f.toplamTevkifat) > 0 ? [{ etiket: "tevkifat" as const, deger: f.toplamTevkifat, eksi: true }] : []),
    ...(vergiDokumu
      ? vergiKalemleri(false)
      : [
          ...(Number(f.toplamEkVergi ?? 0) > 0 ? [{ etiket: { metin: "KDV Dışı Vergiler" }, deger: f.toplamEkVergi! }] : []),
          ...(Number(f.toplamStopaj ?? 0) > 0 ? [{ etiket: { metin: cevir("stopaj", degerDili) }, deger: f.toplamStopaj!, eksi: true }] : []),
        ]),
  ];
  // EBLG-57: dövizli faturada toplamların TL karşılığı da basılır.
  const dovizKarsiligi = f.dovizCinsi !== "TRY" && !proforma
    ? { kur: f.kur, satirlar: [...toplamlar, { etiket: "genelToplam" as const, deger: f.genelToplam }].map((t) => ({ ...t, ek: undefined, deger: tlKarsiligi(t.deger, f.kur) })) }
    : undefined;

  const adres = f.cari.adres;
  const adresSatiri = adres
    ? [adres.adres, [adres.postaKodu, [adres.ilce, adres.il].filter(Boolean).join(" / ")].filter(Boolean).join(" "), adres.ulke && adres.ulke !== "TR" ? (ulkeAdi(adres.ulke) ?? adres.ulke) : null].filter(Boolean).join(", ")
    : "";
  const teslimYeri = f.teslimatAdres && f.teslimatIl && f.teslimatIlce
    ? `${f.teslimatAdres} ${f.teslimatPostaKodu ? `${f.teslimatPostaKodu} ` : ""}${f.teslimatIlce}/${f.teslimatIl}`
    : "";
  const trTeslimAdi = TESLIM_SARTLARI.find((t) => t.kod === f.ihracatTeslimSarti)?.ad;
  const teslimSekli = f.ihracatTeslimSarti
    ? ikiDilde((d) => d === "tr" || !ciftDil ? teslimSekliMetni(f.ihracatTeslimSarti!, d, trTeslimAdi) : teslimSekliMetni(f.ihracatTeslimSarti!, d, trTeslimAdi).replace(`${f.ihracatTeslimSarti} — `, ""))
    : "";
  // EBLG-30: gönderilmiş e-belgenin kimliği; taslakta anlamı yoktur.
  const profil = profilAdi(f);
  const senaryo = profil ? `${(f.yolcuBeraberi?.yolcu ? YOLCU_BERABER_FATURA_TIPI : (f.senaryo && senaryoUblKodu(f.senaryo as FaturaSenaryosu)) || f.senaryo || "")} / ${profil}` : "";

  const kalemler = f.satirlar.map((s) => {
    const ihracat = [
      s.mensei ? `${etiket("mense")}: ${s.mensei}` : "",
      s.gtipKodu && (proforma || f.ihracatTeslimSarti) ? `${etiket("gtip")}: ${s.gtipKodu}` : "",
      s.ihracatKapAdet ? `${etiket("kap")}: ${s.ihracatKapAdet}${s.ihracatKapCinsi ? ` × ${s.ihracatKapCinsi}` : ""}${s.ihracatKapNo ? ` (${s.ihracatKapNo})` : ""}` : "",
    ].filter(Boolean).join(" · ");
    const vergiNotu = [
      s.ekVergiler?.length ? s.ekVergiler.map((v) => `${v.ad}${v.stopaj ? ` (${cevir("stopaj", degerDili)})` : ""}: ${bic.para(v.tutar)}`).join(" · ") : "",
      s.gibIstisnaKodu ? `${etiket("istisnaKodu")}: ${s.gibIstisnaKodu}` : "",
    ].filter(Boolean).join(" · ");
    return {
      kod: s.satirKod ?? s.stokKod,
      ad: s.satirAd ?? s.stokAd,
      yabanciAd: dil === "tr" ? null : s.yabanciAd,
      aciklama: [s.satirAciklama, dil === "tr" ? null : s.yabanciAciklama, ihracat].filter(Boolean).join(" · ") || null,
      ekBilgi: vergiNotu || null,
      miktar: s.miktar,
      birim: s.birim,
      birimFiyat: s.birimFiyat,
      iskontoOrani: s.iskontoOrani,
      kdvOrani: s.kdvOrani,
      tutar: s.toplamTutar,
    };
  });

  const yasal = [
    f.ebelge?.tur === "earsiv" && f.earsivGonderimSekli !== "kagit" ? `<p>${EARSIV_ELEKTRONIK_IBARESI}</p>` : "",
    ihracKayitliIbaresi(f.ihracKayitliKodu, f.kodTablosu),
    kamuBilgisi(f), ozelMatrahBilgisi(f), sgkBilgisi(f), sarjBilgisi(f), idisBilgisi(f), ytbBilgisi(f), yolcuBeraberiBilgisi(f),
  ].filter(Boolean).join("");

  return {
    tur: proforma ? "proforma" : "fatura",
    baslik: proforma ? "baslik.proforma" : (`baslik.fatura.${f.tip}` as EtiketAnahtari),
    dil,
    ciftDil,
    taslak: f.durum === "taslak",
    kopya,
    belgeNo: f.no ?? cevir("taslakNo", degerDili),
    kunye: [
      { etiket: "tarih", deger: bic.tarih(f.tarih instanceof Date ? f.tarih.toISOString().slice(0, 10) : String(f.tarih).slice(0, 10)) },
      ...(f.vadeTarihi ? [{ etiket: "vade" as const, deger: bic.tarih(f.vadeTarihi instanceof Date ? f.vadeTarihi.toISOString().slice(0, 10) : String(f.vadeTarihi).slice(0, 10)) }] : []),
    ],
    taraf: {
      etiket: alis ? "tedarikci" : "sayin",
      unvan: f.cari.unvan,
      satirlar: [
        adresSatiri,
        f.cari.vknTckn ? `${etiket("vkn")}: ${f.cari.vknTckn}${f.cari.vergiDairesi ? ` · ${vergiDairesiMetni(f.cari.vergiDairesi, etiket("vergiDairesi"))}` : ""}` : "",
      ],
    },
    bilgiler: [
      { etiket: "ilgili", deger: ilgiliKisiMetni(f) ?? "" },
      { etiket: "talepRef", deger: f.talepNo ? `${f.talepNo}${f.talepTarihi ? ` (${bic.tarih(String(f.talepTarihi).slice(0, 10))})` : ""}` : "" },
      { etiket: "siparisRef", deger: f.siparisNo ? `${f.siparisNo}${f.siparisTarihi ? ` (${bic.tarih(String(f.siparisTarihi instanceof Date ? f.siparisTarihi.toISOString() : f.siparisTarihi).slice(0, 10))})` : ""}` : "" },
      { etiket: "doviz", deger: f.dovizCinsi === "TRY" ? "TL" : `${f.dovizCinsi} · ${bic.fiyat(f.kur)}` },
      { etiket: "teslimSekli", deger: teslimSekli },
      { etiket: "tasimaSekli", deger: f.ihracatTasimaSekli ? ikiDilde((d) => tasimaSekliMetni(f.ihracatTasimaSekli!, d)) : "" },
      { etiket: "teslimYeri", deger: teslimYeri },
      { etiket: "gumrukBeyanname", deger: f.gumrukBeyannameNo ? `${f.gumrukBeyannameNo}${f.gumrukBeyannameTarihi ? ` (${bic.tarih(String(f.gumrukBeyannameTarihi).slice(0, 10))})` : ""}` : "" },
      { etiket: "senaryo", deger: senaryo },
      { etiket: "ettn", deger: profil ? (f.id ?? "") : "", mono: true },
    ],
    doviz: f.dovizCinsi,
    kalemler,
    toplamlar,
    genelToplam: f.genelToplam,
    notlar: f.aciklama ? [f.aciklama] : [],
    bankalar: alis ? [] : (f.bankalar ?? []),
    imzalar: proforma ? ["imza.hazirlayan", "imza.kase", "imza.musteriOnayi"] : ["imza.teslimEden", "imza.teslimAlan"],
    ekBolum: yasal ? `<div class="yasal">${yasal}</div>` : undefined,
    dovizKarsiligi,
  };
}

/** Faturanın HTML'i ve PDF motoruna verilecek sayfa altı. */
export function faturaPdfHtml(f: FaturaPdfVerisi, ortam: TicariBelgeOrtami, kopya = false): { html: string; altBilgi: string } {
  return ticariBelgeHtml(faturaPdfModeli(f, kopya), ortam);
}
