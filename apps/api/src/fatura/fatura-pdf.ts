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
  senaryoUblKodu,
  ulkeAdi,
  type AraciKurum,
  type FaturaSenaryosu,
  type SarjTuru,
  type YolcuBilgisi,
  ilgiliKisiMetni,
} from "@tekirextra/shared";
import {
  kacis,
  kurBicim,
  paraBicim,
  sayfaSablonu,
  sayiBicim,
  tarihBicim,
  tlKarsiligi,
  firmaIletisimSatirlari,
  type FirmaIletisimi,
} from "../core/pdf/pdf-sablon";
import type { BelgeTemasi } from "../core/pdf/belge-temasi";

/** Fatura PDF şablonu (FTR-07, T-02 altyapısı). */

const TIP_BASLIKLARI: Record<string, string> = {
  satis: "SATIŞ FATURASI",
  alis: "ALIŞ FATURASI",
  satis_iade: "SATIŞ İADE FATURASI",
  alis_iade: "ALIŞ İADE FATURASI",
  proforma: "PROFORMA FATURA",
};

export interface FaturaPdfSatiri {
  stokKod: string;
  stokAd: string;
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
  /** EBLG-78: yatırım teşvik harcama tipi ve makine kimlikleri. */
  ytbHarcamaTipi?: string | null;
  ytbMakineAdi?: string | null;
  ytbMakineId?: string | null;
  ytbMakineSiraNo?: string | null;
  /** EBLG-72: İDİS etiket numarası. */
  idisEtiketNo?: string | null;
  /** EBLG-71: SARJANLIK faturasında ünitenin seri numarası. */
  sarjUniteSeriNo?: string | null;
}

export interface FaturaPdfVerisi {
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
  genelToplam: string;
  aciklama: string | null;
  cari: { kod: string; unvan: string; vknTckn: string | null };
  satirlar: FaturaPdfSatiri[];
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
  return `<p style="margin-top:10px;font-size:9pt">${birim ? `Ödemeyi yapacak harcama birimi: <strong>${kacis(birim)}</strong><br>` : ""}Ödemenin yapılacağı IBAN: <strong>${kacis(ibanBicim(f.kamuIban))}</strong></p>`;
}

/**
 * Özel matrah belge altı bilgisi: KDV satış bedeline dahildir ve yalnız özel
 * matrah üzerinden hesaplanır — alıcı bunu belgede görmelidir.
 */
function ozelMatrahBilgisi(f: FaturaPdfVerisi): string {
  const tanim = ozelMatrahKoduBul(f.ozelMatrahKodu);
  if (!tanim) return "";
  const kdv = ozelMatrahKdvsi(f.ozelMatrahTutari, f.ozelMatrahOrani);
  const paraBirimi = f.dovizCinsi === "TRY" ? "TL" : f.dovizCinsi;
  return `<p style="margin-top:10px;font-size:9pt">Özel matrah (KDV Kanunu 23): <strong>${kacis(`${tanim.kod} — ${tanim.ad}`)}</strong><br>`
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
  return `<p style="margin-top:10px;font-size:9pt">SGK faturası<br>${satirlar.join("<br>")}</p>`;
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
  return `<p style="margin-top:10px;font-size:9pt">${kacis(SARJ_TURU_ADLARI[turu])}<br>${satirlar.join("<br>")}</p>`;
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
  return `<p style="margin-top:10px;font-size:9pt">İDİS kapsamında teslim<br>Sevkiyat no: <strong>${kacis(idisNormalize(f.idisSevkiyatNo))}</strong>`
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
  return `<p style="margin-top:10px;font-size:9pt">Yatırım teşvik belgesi kapsamında teslim<br>`
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
  return `<p style="margin-top:10px;font-size:9pt">${satirlar.join("<br>")}<br>${kacis(YOLCU_BERABER_ISTISNA_ACIKLAMASI)} (${YOLCU_BERABER_ISTISNA_KODU}); KDV, gümrük çıkış onayından sonra aracı kurumca iade edilir.</p>`;
}

/**
 * Elektronik ortamda iletilen e-Arşiv faturada bulunması gereken ibare
 * (EBLG-26). Kâğıt olarak teslim edilen e-Arşivde yer almaz.
 */
export const EARSIV_ELEKTRONIK_IBARESI = "e-Arşiv izni kapsamında elektronik ortamda iletilmiştir.";

export interface FirmaBilgisi extends FirmaIletisimi {
  unvan: string;
  vkn: string;
  vergiDairesi: string | null;
  /** KLN-03: firma logosu, data URI olarak gömülür. */
  tema?: BelgeTemasi;
}

/**
 * İhraç kayıtlı satışın belge altı ibaresi (EBLG-60). Metin kod listesindeki
 * addan gelir; kullanıcının kabul edilmiş belgesindeki açıklamayla aynı anlamı taşır.
 */
function ihracKayitliIbaresi(kod: string | null | undefined): string {
  const tanim = ihracKayitliKoduBul(kod);
  return tanim
    ? `<p style="margin-top:10px;font-size:9pt">${kacis(`${tanim.kod} — ${tanim.ad}: ihraç edilmek şartıyla teslim edildiğinden KDV tahsil edilmemiştir.`)}</p>`
    : "";
}

export function faturaPdfHtml(f: FaturaPdfVerisi, firma: FirmaBilgisi): string {
  const baslik = TIP_BASLIKLARI[f.tip] ?? "FATURA";
  const paraBirimi = f.dovizCinsi === "TRY" ? "TL" : f.dovizCinsi;

  const satirlar = f.satirlar
    .map(
      (s, i) => `<tr>
  <td class="orta">${i + 1}</td>
  <td>${kacis(s.stokKod)}</td>
  <td>${kacis(s.stokAd)}${
    s.gibIstisnaKodu
      ? `<br><span style="color:#6b7280;font-size:8pt">KDV istisna kodu: ${kacis(s.gibIstisnaKodu)}</span>`
      : ""
  }</td>
  <td class="sag">${sayiBicim(s.miktar)} ${kacis(s.birim)}</td>
  <td class="sag">${paraBicim(s.birimFiyat)}</td>
  <td class="sag">${Number(s.iskontoOrani) > 0 ? `%${sayiBicim(s.iskontoOrani)}` : ""}</td>
  <td class="sag">${paraBicim(s.matrah)}</td>
  <td class="sag">%${sayiBicim(s.kdvOrani)}</td>
  <td class="sag">${paraBicim(s.kdvTutari)}</td>
  <td class="sag">${paraBicim(s.toplamTutar)}</td>
</tr>`,
    )
    .join("\n");

  const toplamSatiri = (etiket: string, deger: string | number, kalin = false, birim = paraBirimi) =>
    `<tr${kalin ? ' style="font-weight:bold"' : ""}>
      <td style="padding:3px 8px">${etiket}</td>
      <td class="sag" style="padding:3px 8px">${paraBicim(deger)} ${birim}</td>
    </tr>`;

  /*
   * Özel matrah faturasında satırlar KDV'siz olduğu için "KDV Matrahı" etiketi
   * satır toplamını gösterirken belgenin KDV matrahı bambaşkaydı (kâr farkı).
   * Saha örneğindeki gibi satır toplamı "Mal/Hizmet Toplamı" olur, KDV ise
   * özel matrah üzerinden hesaplanıp toplama eklenir.
   */
  const ozelMatrah = ozelMatrahKoduBul(f.ozelMatrahKodu);

  const kalemler: { etiket: string; deger: string | number; kalin?: boolean }[] = [
    { etiket: "Brüt Toplam", deger: f.toplamBrut },
    ...(Number(f.toplamSatirIskontosu) > 0 ? [{ etiket: "Satır İskontoları", deger: `-${f.toplamSatirIskontosu}` }] : []),
    ...(Number(f.genelIskontoToplam) > 0 ? [{ etiket: "Genel İskonto", deger: `-${f.genelIskontoToplam}` }] : []),
    { etiket: ozelMatrah ? "Mal/Hizmet Toplamı" : "KDV Matrahı", deger: f.toplamMatrah },
    ozelMatrah
      ? { etiket: `Hesaplanan KDV (özel matrah %${sayiBicim(f.ozelMatrahOrani ?? "0")})`, deger: f.toplamKdv }
      : { etiket: f.ihracKayitliKodu ? `Hesaplanan KDV (tahsil edilmez — ${kacis(f.ihracKayitliKodu)})` : "Hesaplanan KDV", deger: f.toplamKdv },
    ...(Number(f.toplamTevkifat) > 0 ? [{ etiket: "KDV Tevkifatı", deger: `-${f.toplamTevkifat}` }] : []),
    { etiket: "Genel Toplam", deger: f.genelToplam, kalin: true },
  ];
  // EBLG-57: dövizli faturada toplamların TL karşılığı da gösterilir; ihracat
  // faturasının resmî görünümü de kur satırının altında aynı toplamları TL verir.
  const dovizli = f.dovizCinsi !== "TRY";
  const toplamlar = [
    ...kalemler.map((k) => toplamSatiri(k.etiket, k.deger, k.kalin)),
    ...(dovizli
      ? [
          `<tr><td style="padding:3px 8px;border-top:1px solid #e5e7eb">Döviz Kuru (1 ${kacis(f.dovizCinsi)})</td><td class="sag" style="padding:3px 8px;border-top:1px solid #e5e7eb">${kurBicim(f.kur)} TL</td></tr>`,
          ...kalemler.map((k) => toplamSatiri(`${k.etiket} (TL)`, tlKarsiligi(k.deger, f.kur), k.kalin, "TL")),
        ]
      : []),
  ].join("");

  // EBLG-30: belge gönderildiyse kimliği çıktıda yer alır; taslakta ETTN'in
  // bir anlamı yoktur, gösterilmez.
  const profil = profilAdi(f);
  const ebelgeKimligi = profil
    ? `<br>ETTN: ${kacis(f.id ?? "")}<br>Senaryo: ${kacis(f.yolcuBeraberi?.yolcu ? YOLCU_BERABER_FATURA_TIPI : (f.senaryo && senaryoUblKodu(f.senaryo as FaturaSenaryosu)) || f.senaryo || "")} &nbsp;•&nbsp; Profil: ${kacis(profil)}`
    : "";

  const icerik = `
<table style="width:100%;margin-bottom:12px;font-size:9pt">
  <tr>
    <td style="vertical-align:top;width:50%">
      <div class="kutu">
        <strong>${kacis(firma.unvan)}</strong><br>
        VKN: ${kacis(firma.vkn)}${firma.vergiDairesi ? ` — ${kacis(firma.vergiDairesi)}` : ""}${firmaIletisimSatirlari(firma)}
      </div>
    </td>
    <td style="width:4%"></td>
    <td style="vertical-align:top;width:46%">
      <div class="kutu">
        <strong>Sayın ${kacis(f.cari.unvan)}</strong> (${kacis(f.cari.kod)})<br>
        ${ilgiliKisiMetni(f) ? `İlgili: ${kacis(ilgiliKisiMetni(f)!)}<br>` : ""}
        ${f.cari.vknTckn ? `VKN/TCKN: ${kacis(f.cari.vknTckn)}<br>` : ""}
        Fatura No: <strong>${kacis(f.no ?? "— TASLAK —")}</strong><br>
        Tarih: ${tarihBicim(f.tarih)}${
          f.vadeTarihi ? ` &nbsp;•&nbsp; Vade: ${tarihBicim(f.vadeTarihi)}` : ""
        }${
          /* EBLG-73: sipariş referansı e-Belgeye yazılıyor, kendi çıktımızda da görünmeliydi. */
          f.siparisNo ? `<br>Sipariş No: ${kacis(f.siparisNo)}${f.siparisTarihi ? ` (${tarihBicim(f.siparisTarihi)})` : ""}` : ""
        }${
          f.talepNo ? `<br>Talep Ref.: ${kacis(f.talepNo)}${f.talepTarihi ? ` (${tarihBicim(f.talepTarihi)})` : ""}` : ""
        }${
          f.teslimatAdres && f.teslimatIl && f.teslimatIlce
            ? `<br>Teslim Yeri: ${kacis(f.teslimatAdres)} ${f.teslimatPostaKodu ? `${kacis(f.teslimatPostaKodu)} ` : ""}${kacis(f.teslimatIlce)}/${kacis(f.teslimatIl)}`
            : ""
        }${
          f.dovizCinsi !== "TRY"
            ? `<br>Döviz: ${kacis(f.dovizCinsi)} (kur ${kurBicim(f.kur)})`
            : ""
        }${ebelgeKimligi}
      </div>
    </td>
  </tr>
</table>
<table class="veri">
  <thead><tr>
    <th>#</th><th>Kod</th><th>Ürün / Hizmet</th>
    <th class="sag">Miktar</th><th class="sag">Birim Fiyat</th>
    <th class="sag">İsk.</th><th class="sag">Matrah</th>
    <th class="sag">KDV %</th><th class="sag">KDV</th><th class="sag">Tutar</th>
  </tr></thead>
  <tbody>${satirlar}</tbody>
</table>
<table style="margin-top:12px;margin-left:auto;border:1px solid #e5e7eb;border-radius:4px;font-size:9pt">
  ${toplamlar}
</table>
${f.aciklama ? `<p style="margin-top:10px;color:#6b7280">${kacis(f.aciklama)}</p>` : ""}
${f.ebelge?.tur === "earsiv" && f.earsivGonderimSekli !== "kagit" ? `<p style="margin-top:10px;font-size:9pt">${EARSIV_ELEKTRONIK_IBARESI}</p>` : ""}
${ihracKayitliIbaresi(f.ihracKayitliKodu)}
${kamuBilgisi(f)}
${ozelMatrahBilgisi(f)}
${sgkBilgisi(f)}
${sarjBilgisi(f)}
${idisBilgisi(f)}
${ytbBilgisi(f)}
${yolcuBeraberiBilgisi(f)}`;

  return sayfaSablonu({
    baslik: f.durum === "taslak" ? `${baslik} (TASLAK)` : baslik,
    icerik,
    tema: firma.tema,
  });
}
