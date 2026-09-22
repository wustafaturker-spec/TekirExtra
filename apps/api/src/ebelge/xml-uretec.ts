import { Fatura, FaturaSatir, CariHesap } from "@prisma/client";
import {
  GUMRUK_BAKANLIGI_IL,
  GUMRUK_BAKANLIGI_UNVAN,
  GUMRUK_BAKANLIGI_VKN,
  IHRACAT_ALICI_PARTY_TIPI,
  IHRACAT_FATURA_TIPI,
  IHRACAT_PROFILI,
  IHRACAT_VERGI_PARA_BIRIMI,
  IADE_BELGE_TUR_KODU,
  KAMU_ODEME_KODU,
  ozelMatrahKdvsi,
  ozelMatrahKoduBul,
  ozelMatrahSatirPaylari,
  sgkBelgeAlanlari,
  SGK_FATURA_TIPI,
  sarjPlakaNormalize,
  SARJ_PROFILI,
  idisNormalize,
  IDIS_PROFILI,
  idisBelgesiMi,
  irsaliyeYerineIbaresi,
  VAZGECILEN_KDV_SIRA_NO,
  vazgecilenKdv,
  YTB_MAKINE_HARCAMA_TIPI,
  YTB_PROFILI,
  ytbBelgesiMi,
  ytbFaturaTipi,
  ytbHarcamaTipiBul,
  ytbNormalize,
  KAMU_PROFILI,
  PASAPORT_TARIHI_BILINMIYOR,
  YOLCU_BERABER_FATURA_TIPI,
  YOLCU_BERABER_ISTISNA_ACIKLAMASI,
  YOLCU_BERABER_ISTISNA_KODU,
  YOLCU_BERABER_PARTY_TIPI,
  YOLCU_BERABER_PROFILI,
  type YolcuBeraberiBilgisi,
  ibanNormalize,
  type FirmaEbelgeBilgisi,
  birimUblKodu,
  gtipNormalize,
  ihracatIstisnaAciklamasi,
  ihracatIstisnaKodu,
  ihracatIstisnaKoduMu,
  ihracKayitliKoduBul,
  istisnaKoduBul,
  senaryoUblKodu,
  tevkifatKoduBul,
  odemeSekliUblKodu,
  ublAdresi,
  ulkeAdi,
  ulkeKoduCoz,
} from "@tekirextra/shared";
import { adSoyadCoz } from "../cari/ad-soyad";

/*
 * Giden belgeye görünüm (XSLT) gömülmez — karar 2026-09-17, EBLG-31 iptal.
 * Portal denemesi gösterdi ki entegratör belgeyi kendi tasarımıyla basıyor ve
 * gömülü görünümü kullanmıyor; her faturaya ~80 KB ölü yük ekliyorduk. Kendi
 * çıktılarımızın görünümü `belge-temasi.ts`'ten gelmeyi sürdürür (FTR-22…24).
 * Gelen belgelerde gönderenin gömülü görünümünü okumaya devam ederiz (EBLG-28).
 */

export interface IhracatUblBilgisi {
  /** Alıcının ISO 3166-1 alpha-2 ülke kodu; TR olamaz. */
  ulkeKodu: string;
  /** Fiili ihracat tarihi. */
  teslimTarihi?: Date | null;
  /** Incoterms kodu (EXW, FOB, CIF…). */
  teslimSarti?: string | null;
  /** UN/ECE Rec. 19 taşıma şekli kodu. */
  tasimaSekli?: string | null;
  /** Gümrük beyanname numarası; gönderimden önce biliniyorsa belgeye yazılır. */
  beyannameNo?: string | null;
}

export interface InternetSatisUblBilgisi {
  webAdresi?: string | null;
  odemeSekli?: string | null;
  odemeTarihi?: Date | null;
  odemeAracisi?: string | null;
  tasiyiciUnvan?: string | null;
  tasiyiciVkn?: string | null;
  gonderiTarihi?: Date | null;
  /** Malın gönderildiği adres; cari kartının sevk adresidir. */
  teslimatAdresi?: { adres?: string | null; il?: string | null; ilce?: string | null; postaKodu?: string | null; ulke?: string | null };
}

/** KAMU senaryosu: ödemeyi yapacak harcama birimi ve ödemenin yapılacağı IBAN. */
export interface KamuUblBilgisi {
  harcamaBirimiVkn: string;
  harcamaBirimiAdi: string;
  iban: string;
}

export function faturaUblUret(
  fatura: Fatura & {
    satirlar: (FaturaSatir & {
      stok: { kod: string; ad: string; tip?: string | null; gtipKodu?: string | null; mensei?: string | null; kdvOrani?: unknown };
    })[];
    /**
     * EBLG-55: alıcı adresi karttan gelir. Adresler okunmadan üretilen belgede
     * adres "-" gider; sabit bir şehir yazmaktansa eksikliği görünsün.
     */
    cari: CariHesap & { adresler?: { tip: string; adres: string | null; il: string | null; ilce: string | null; postaKodu: string | null; ulke: string | null }[] };
  },
  /** Satıcı: firma kartı (EBLG-62). Adres eksikse gönderim daha önce durur. */
  supplier: { unvan: string; vkn: string } & FirmaEbelgeBilgisi,
  secenekler: {
    tur?: "efatura" | "earsiv";
    ihracat?: IhracatUblBilgisi;
    internetSatisi?: InternetSatisUblBilgisi;
    /** EBLG-58: iade faturasında iade edilen faturalar; sırasıyla yazılır. */
    iadeReferanslari?: { belgeNo: string; tarih: Date }[];
    irsaliyeReferanslari?: { no: string; tarih: Date }[];
    /** Alıcı kamu idaresiyse; profil KAMU olur (SATIS ve IADE tiplerinde). */
    kamu?: KamuUblBilgisi;
    /** Yolcu beraberi (tax-free) satışı: yolcu ve aracı kurum. */
    yolcuBeraberi?: YolcuBeraberiBilgisi;
  } = {},
): string {
  // e-Arşiv, e-Fatura'dan üç noktada ayrılır: profil `EARSIVFATURA`, alıcı
  // etiketi yoktur ve gönderim şekli UBL içinde bildirilir.
  const earsiv = secenekler.tur === "earsiv";
  /*
   * İhracat, e-Fatura kanalının bir senaryosudur: profil `IHRACAT`, alıcı
   * kimliği yurt dışı alıcı sabiti, KDV istisnalı ve gümrük alanları dolu.
   * Karar sihirbazda verilmez, alıcının ülkesinden gelir (tasarım belgesi §3.1).
   */
  const ihracat = secenekler.ihracat;
  /*
   * Yolcu beraberi (GİB Gümrük İşlemleri Kılavuzu §4, resmî `YOLCUBERABER.xml`):
   * e-Fatura kanalında, profil YOLCUBERABERFATURA, tip ISTISNA. Alıcı ihracatta
   * olduğu gibi Gümrük Bakanlığı'dır; yolcu `BuyerCustomerParty`, aracı kurum
   * `TaxRepresentativeParty` içinde durur. KDV hesaplanır ve tahsil edilir,
   * belge düzeyindeki vergi alt toplamı 501 koduyla işaretlenir.
   */
  const yolcu = earsiv || ihracat ? undefined : secenekler.yolcuBeraberi;
  const gtbAlici = Boolean(ihracat || yolcu);
  /**
   * Alıcı adresi (EBLG-55). Belgede tek bir adres görünür; hangisi olduğu
   * `belgeAdresiSec` kuralına göre seçilir ve ihracat kanalı kararı da aynı
   * adresin ülkesinden gelir.
   */
  const aliciAdres = ublAdresi(fatura.cari.adresler);
  /**
   * Menşei ülkesinin adı. UBL-TR `cac:OriginCountry` içinde **`cbc:Name` arar**;
   * yalnız kod yazılan belge şemadan döner (NES, 2026-09-18:
   * `FAILED_XML_SCHEMA_CHECK … OriginCountry … expected 'Name'`). Adı
   * bilinmeyen ülkede blok hiç yazılmaz.
   */
  const menseiAdi = (mensei: string | null | undefined) => ulkeAdi(ulkeKoduCoz(mensei));
  /**
   * İnternet satışı alan grubu (EBLG-56). Yalnız e-Arşiv kanalında istenir;
   * e-Fatura mükellefine kesilen belgede grup yazılmaz.
   */
  const internet = earsiv ? secenekler.internetSatisi : undefined;
  const teslimatAdresi = internet?.teslimatAdresi
    ? ublAdresi([{ tip: "sevk", ...internet.teslimatAdresi }])
    : undefined;
  // ISO Tarihleri
  const tarihStr = fatura.tarih.toISOString().slice(0, 10);
  const saatStr = "12:00:00";
  /** Belge metinlerinde okunur gün: 20.09.2026. Tarih kolonları UTC gün başıdır. */
  const gunBicim = (gun: Date) => gun.toISOString().slice(0, 10).split("-").reverse().join(".");

  // XML Karakter kaçırma yardımcısı
  const escape = (str?: string | null) => {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  };

  /*
   * Şematron: "Fatura tipi IADE iken fatura profili sadece TEMELFATURA,
   * EARSIVFATURA, … olabilir" (NES önizlemesi, 2026-09-19). İadeye alıcının
   * kabul/ret yanıtı yoktur; carinin ticari profili iadede yok sayılır (EBLG-58).
   */
  const iadeSenaryosu = fatura.senaryo === "iade" || fatura.senaryo === "tevkifatiade";
  /*
   * EBLG-61: tevkifatlı faturanın iadesi tevkifatsız düzenlenir — belgede
   * yalnız satıcıya fiilen ödenmiş (tevkif dışı) KDV görünür, oran aynı kalır
   * (100 + %20 KDV, 9/10 tevkifat → 100 + 2). Şematron bu tipte tevkifat
   * bloğunu reddeder. Faturanın kendi hesabı zaten net KDV'yi taşır.
   */
  const tevkifatIade = fatura.senaryo === "tevkifatiade";
  const belgeKdvi = (satir: { kdvTutari: unknown; netKdvTutari?: unknown }) =>
    Number(tevkifatIade ? satir.netKdvTutari ?? satir.kdvTutari : satir.kdvTutari);
  /*
   * Satıcı adresi firma kartından gelir (EBLG-62); önceden sabit
   * "Merkez/Istanbul" yazılıyordu. İmza tarafında da aynı adres durur.
   */
  const saticiAdresi = `      <cac:PostalAddress>${supplier.adres ? `
        <cbc:StreetName>${escape(supplier.adres)}</cbc:StreetName>` : ""}
        <cbc:CitySubdivisionName>${escape(supplier.ilce) || "-"}</cbc:CitySubdivisionName>
        <cbc:CityName>${escape(supplier.il) || "-"}</cbc:CityName>${supplier.postaKodu ? `
        <cbc:PostalZone>${escape(supplier.postaKodu)}</cbc:PostalZone>` : ""}
        <cac:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>`;
  const uuid = fatura.id;
  const no = fatura.no || "TASLAK";

  /**
   * Satırın KDV istisna kodu. İhracatta kod kullanıcıdan değil satırın
   * malından/hizmetinden türer (301/302); kullanıcı ihracata uyan başka bir tam
   * istisna kodu seçtiyse (ör. 316 serbest bölge fason) o korunur.
   */
  const satirIstisnaKodu = (satir: { gibIstisnaKodu: string | null; stok: { tip?: string | null } }): string | null => {
    if (!ihracat) return satir.gibIstisnaKodu;
    return ihracatIstisnaKoduMu(satir.gibIstisnaKodu) ? satir.gibIstisnaKodu : ihracatIstisnaKodu(satir.stok.tip);
  };

  /**
   * Belge düzeyinde bildirilen ihracat istisnası. Resmî örnekte kod ve açıklama
   * fatura `TaxTotal`'ındadır; satırlarda tekrar edilmez.
   */
  const ihracatIstisnasi = ihracat ? satirIstisnaKodu(fatura.satirlar[0]) : null;

  /** İstisna kodunun belgeye yazılan açıklaması; şematron boş bırakılmasına izin vermez. */
  const istisnaAciklamasi = (kod: string) =>
    // Entegratör görünümü kodu zaten "812-" diye yazıyor; açıklamada kodu
    // tekrarlamak "812-812 …" çıkarıyordu.
    ozelMatrahKoduBul(kod) ? ozelMatrahKoduBul(kod)!.ad
    : yolcu && kod === YOLCU_BERABER_ISTISNA_KODU ? YOLCU_BERABER_ISTISNA_ACIKLAMASI
    : ihracatIstisnasi ? ihracatIstisnaAciklamasi(kod) : `${kod} ${(istisnaKoduBul(kod) ?? ihracKayitliKoduBul(kod))?.ad ?? ""}`.trim();

  /*
   * İhraç kayıtlı satış (EBLG-60): KDV hesaplanıp gösterilir ama tahsil
   * edilmez. Kod KDV'li alt toplamlara yazılır; kullanıcının kabul edilmiş
   * örneği (M012026000000078) kodu %10'luk alt toplamda taşıyor. Sıfır KDV'li
   * satır kendi istisna kodunu korur.
   */
  const ihracKayitliKodu = fatura.senaryo === "ihrackayitli" ? fatura.ihracKayitliKodu : null;
  /*
   * Özel matrah (KDV K. 23, resmî `OZELMATRAH.xml`): satış bedeli KDV'yi zaten
   * içerir, satırlarda vergi bloğu yoktur ve belge düzeyindeki tek alt toplam
   * özel matrahı, oranını ve kodunu taşır. Matrah satır tutarlarından değil
   * faturaya girilen tutardan gelir (ikinci elde alış ile satış farkı).
   */
  /*
   * Şarj faturası (14.09.2026 şematronu §1): tip SARJ ya da SARJANLIK, alıcı
   * tarafında aracın plakası, şarj süresi `InvoicePeriod` içinde saatleriyle,
   * SARJ'da ESU rapor kimlikleri ayrı ilave doküman referanslarında,
   * SARJANLIK'ta satırda ünitenin seri numarası. e-Arşiv'de de geçerlidir.
   */
  const sarj = fatura.senaryo === "sarj" || fatura.senaryo === "sarjanlik"
    ? {
        tip: fatura.senaryo === "sarj" ? "SARJ" : "SARJANLIK",
        plaka: sarjPlakaNormalize(fatura.sarjPlaka),
        baslangic: fatura.sarjBaslangic,
        bitis: fatura.sarjBitis,
        raporlar: ((fatura.sarjEsuRaporlari as { raporId: string; tarih: string }[] | null) ?? []),
      }
    : null;
  /** İDİS (GİB İDİS Teknik Kılavuzu v1.0): profil IDIS, sevkiyat no satıcıda, etiket no satırda. */
  const idis = idisBelgesiMi(fatura.idisSevkiyatNo) ? idisNormalize(fatura.idisSevkiyatNo) : null;
  /** Şarj süresinin tarih ve saat parçaları; UBL ikisini ayrı etikete ister. */
  const anParcala = (an: Date | null | undefined) => {
    if (!an) return null;
    const metin = an.toISOString();
    return { tarih: metin.slice(0, 10), saat: metin.slice(11, 19) };
  };

  /*
   * SGK faturası (SGK e-Fatura Teknik Doküman §3.3): ilave fatura tipi hesap
   * kodunda, Kurum'daki mükellef kodu/adı ve dosya no ayrı ilave doküman
   * referanslarında, dönem `InvoicePeriod` içinde gider. Alanlar gruba göre
   * değişir; gruba girmeyen alan belgeye hiç yazılmaz.
   */
  const sgk = fatura.senaryo === "sgk"
    ? sgkBelgeAlanlari({
        ilaveFaturaTipi: fatura.sgkIlaveFaturaTipi,
        mukellefKodu: fatura.sgkMukellefKodu,
        mukellefAdi: fatura.sgkMukellefAdi,
        dosyaNo: fatura.sgkDosyaNo,
        donemBaslangic: fatura.sgkDonemBaslangic?.toISOString(),
        donemBitis: fatura.sgkDonemBitis?.toISOString(),
      })
    : null;
  /** SGK'nın ilave doküman referansları: değer `DocumentType`, alan adı `DocumentTypeCode`. */
  const sgkReferansi = (kod: string, alan: { deger: string; aciklama: string } | undefined) => alan ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>${escape(kod)}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentTypeCode>${kod}</cbc:DocumentTypeCode>
    <cbc:DocumentType>${escape(alan.deger)}</cbc:DocumentType>
    <cbc:DocumentDescription>${escape(alan.aciklama)}</cbc:DocumentDescription>
  </cac:AdditionalDocumentReference>` : "";

  const ozelMatrah = fatura.senaryo === "ozelmatrah" && fatura.ozelMatrahKodu
    ? {
        kod: fatura.ozelMatrahKodu,
        tutar: Number(fatura.ozelMatrahTutari ?? 0),
        oran: Number(fatura.ozelMatrahOrani ?? 0),
        kdv: ozelMatrahKdvsi(Number(fatura.ozelMatrahTutari ?? 0), Number(fatura.ozelMatrahOrani ?? 0)),
        // Alıcının gördüğü görünümde satırdaki "özel matrah nedeni/tutarı"
        // sütunları satır düzeyindeki vergi bloğundan dolar (karar 2026-09-20);
        // belgeye girilen tek matrah satırlara tutarları oranında bölünür.
        paylar: ozelMatrahSatirPaylari(
          fatura.satirlar.map((s) => Number(s.matrah)),
          Number(fatura.ozelMatrahTutari ?? 0),
          Number(fatura.ozelMatrahOrani ?? 0),
        ),
      }
    : null;
  const altToplamKodu = (satir: Parameters<typeof satirIstisnaKodu>[0] & { kdvOrani: unknown }) =>
    Number(satir.kdvOrani) === 0 ? satirIstisnaKodu(satir) : yolcu ? YOLCU_BERABER_ISTISNA_KODU : ihracKayitliKodu ?? null;
  /** Satırda tekrarlanacak kod; yolcu beraberinde resmî örnek kodu yalnız belge düzeyinde yazar. */
  const satirKodu = (satir: Parameters<typeof altToplamKodu>[0]) => (yolcu ? null : altToplamKodu(satir));

  /*
   * Belge düzeyindeki KDV alt toplamları oran ve istisna kodu başına ayrılır
   * (EBLG-59). Şematron vergisi sıfır olan her alt toplamda kod ve açıklama
   * arar, fatura tipini de bu koddan denetler ("201 için tip ISTISNA… olabilir");
   * kod yalnız satırda durunca KDV'si sıfır her yurt içi belge dönüyordu (NES
   * önizlemesi, 2026-09-19). Tutarlar kuruşta toplanır; satır matrahlarının
   * toplamı belge matrahıdır (genel iskonto satırlara dağıtılmıştır).
   */
  /*
   * Yatırım teşvik (EBLG-78): teşvik belge numarası girilmiş fatura YTB
   * kapsamındadır. İDİS gibi bir **profildir**, tip normal kurallarla türer;
   * e-Arşiv'e düşerse tipin başına "YTB" gelir.
   */
  const ytb = ytbBelgesiMi(fatura.ytbNo) ? { no: ytbNormalize(fatura.ytbNo), tarih: fatura.ytbTarihi } : null;
  /*
   * "Vazgeçilen KDV" (kılavuz §2.1.4): istisnalı YTB faturasında KDV
   * alınmasaydı doğacak tutar belgeye yazılır, ama fatura toplamına
   * **eklenmez** — `CalculationSequenceNumeric = -1` bunu söyler. Oran satırın
   * kendi oranı değildir (o sıfırdır), stok kartındaki normal orandır.
   */
  const vazgecilenOran = (satir: { kdvOrani: unknown; stok: { kdvOrani?: unknown } }) =>
    ytb && fatura.senaryo === "istisna" && Number(satir.kdvOrani) === 0 ? Number(satir.stok.kdvOrani ?? 0) : 0;

  const kdvAltToplamlari = [...fatura.satirlar.reduce((gruplar, satir) => {
    const oran = Number(satir.kdvOrani);
    const kod = altToplamKodu(satir);
    const vazgecilen = vazgecilenOran(satir);
    // Vazgeçilen oran belge düzeyinde `Percent` olarak yazıldığı için gruplama
    // anahtarına girer: aynı istisna kodundan farklı oranlı satırlar ayrılır.
    const anahtar = `${oran}|${kod ?? ""}|${vazgecilen}`;
    const grup = gruplar.get(anahtar) ?? { oran, kod, matrahKurus: 0, kdvKurus: 0, vazgecilenOran: vazgecilen, vazgecilenKurus: 0 };
    grup.matrahKurus += Math.round(Number(satir.matrah) * 100);
    grup.kdvKurus += Math.round(belgeKdvi(satir) * 100);
    grup.vazgecilenKurus += Math.round(vazgecilenKdv(Number(satir.matrah), vazgecilen) * 100);
    return gruplar.set(anahtar, grup);
  }, new Map<string, { oran: number; kod: string | null; matrahKurus: number; kdvKurus: number; vazgecilenOran: number; vazgecilenKurus: number }>()).values()];

  /**
   * Gerçek kişi alıcı. UBL-TR şematronu `schemeID="TCKN"` gördüğünde `cac:Person`
   * arar; ünvanı `cac:PartyName` içinde bırakmak e-Arşiv gönderimini reddettirir
   * (NES, 2026-09-10). Ad ve soyad kartta ayrı tutulur (CARI-21); boşsa
   * unvandan tahmin edilir.
   */
  const aliciTckn = fatura.cari.vknTckn?.length === 11;
  const { ad: aliciAd, soyad: aliciSoyad } = adSoyadCoz(fatura.cari);

  /**
   * Tevkifat, fatura düzeyinde `WithholdingTaxTotal` olarak bildirilir; vergi
   * türü kodu satırdaki GİB tevkifat kodudur (FTR-18). Aynı kodlu satırlar tek
   * blokta toplanır, çünkü kod başına bir alt toplam beklenir.
   */
  /*
   * Dövizli belgede kur zorunludur — "Para birimi TRY olmayan belgelerde kur
   * bilgisi zorunludur" (NES şematronu, 2026-09-18). Kural ihracata özgü değil,
   * TRY dışı her belgede geçerlidir; fiyatlama kuru her zaman, vergi kuru ise
   * kur `cac:PricingExchangeRate` içinde, ihracatta ayrıca `TaxCurrencyCode`
   * ve `cac:TaxExchangeRate` ile bildirilir.
   *
   * NES kuru `PricingExchangeRate/CalculationRate`'ten okur (swagger'daki tek
   * kur alanı `pricingExchangeCalculationRate`). Bu blok 2026-09-19'da NES
   * önizleme ucunun şematron denetiminden geçti; blok çıkarılınca aynı uç
   * "kur bilgisi zorunludur" dedi. 2026-09-18'deki redler bu blok henüz
   * worker'a ulaşmadan yapılan gönderimlerdi (EBLG-57).
   */
  const dovizli = fatura.dovizCinsi !== IHRACAT_VERGI_PARA_BIRIMI;
  const kurSatirlari = `
    <cbc:SourceCurrencyCode>${fatura.dovizCinsi}</cbc:SourceCurrencyCode>
    <cbc:TargetCurrencyCode>${IHRACAT_VERGI_PARA_BIRIMI}</cbc:TargetCurrencyCode>
    <cbc:CalculationRate>${Number(fatura.kur ?? 1).toFixed(6)}</cbc:CalculationRate>
    <cbc:Date>${tarihStr}</cbc:Date>`;
  const kurBlogu = dovizli
    ? `${ihracat ? `  <cac:TaxExchangeRate>${kurSatirlari}
  </cac:TaxExchangeRate>
` : ""}  <cac:PricingExchangeRate>${kurSatirlari}
  </cac:PricingExchangeRate>
`
    : "";

  /*
   * İade edilen her fatura ayrı bir `BillingReference` olur (EBLG-58). Şematron
   * 16 haneli numara ve `DocumentTypeCode` "IADE" arar; GİB görünümü de iade
   * tablosunu bu koda bakarak basar. Şemada yeri `OrderReference`'tan sonra,
   * `AdditionalDocumentReference`'tan öncedir.
   */
  const iadeReferansBloklari = (secenekler.iadeReferanslari ?? [])
    .map((ref) => `
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${escape(ref.belgeNo)}</cbc:ID>
      <cbc:IssueDate>${ref.tarih.toISOString().slice(0, 10)}</cbc:IssueDate>
      <cbc:DocumentTypeCode>${IADE_BELGE_TUR_KODU}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`)
    .join("");

  const tevkifatGruplari = new Map<string, { tutar: number; oran: number }>();
  for (const satir of fatura.satirlar) {
    if (!satir.tevkifatKodu || Number(satir.tevkifatTutari) === 0) continue;
    const mevcut = tevkifatGruplari.get(satir.tevkifatKodu) ?? { tutar: 0, oran: 0 };
    mevcut.tutar += Number(satir.tevkifatTutari);
    // Oran koddan gelir; pay/payda saklı türetilmiş değerlerdir.
    if (satir.tevkifatPay && satir.tevkifatPayda) mevcut.oran = (satir.tevkifatPay / satir.tevkifatPayda) * 100;
    tevkifatGruplari.set(satir.tevkifatKodu, mevcut);
  }
  /**
   * Malı alan yabancı firma, ihracat belgesinde alıcı değil **BuyerCustomerParty**
   * olarak bildirilir (GİB `IHRACAT.xml`): kimliği `PARTYTYPE`/`EXPORT`'tur ve
   * kendi ülkesindeki vergi numarası `PartyLegalEntity` içinde durur.
   */
  const yabanciAliciBlogu = ihracat
    ? `
  <cac:BuyerCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="PARTYTYPE">${IHRACAT_ALICI_PARTY_TIPI}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escape(fatura.cari.unvan)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>${aliciAdres.adres ? `
        <cbc:StreetName>${escape(aliciAdres.adres)}</cbc:StreetName>` : ""}
        <cbc:CitySubdivisionName>${escape(aliciAdres.ilce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${escape(aliciAdres.il)}</cbc:CityName>${aliciAdres.postaKodu ? `
        <cbc:PostalZone>${escape(aliciAdres.postaKodu)}</cbc:PostalZone>` : ""}
        <cac:Country>
          <cbc:IdentificationCode>${aliciAdres.ulkeKodu}</cbc:IdentificationCode>${aliciAdres.ulkeAdi ? `
          <cbc:Name>${escape(aliciAdres.ulkeAdi)}</cbc:Name>` : ""}
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escape(fatura.cari.unvan)}</cbc:RegistrationName>${fatura.cari.vknTckn ? `
        <cbc:CompanyID>${escape(fatura.cari.vknTckn)}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:BuyerCustomerParty>
`
    : "";

  /*
   * KAMU senaryosu (GİB kamu e-Fatura kılavuzu, şematron 14.09.2026 §4):
   * ödemeyi yapacak harcama birimi `BuyerCustomerParty` içinde tek bir VKN ile,
   * ödemenin yapılacağı IBAN `PaymentMeans/PayeeFinancialAccount` içinde
   * durur. Alıcı (muhasebe birimi) `AccountingCustomerParty`'de kalır; genel
   * bütçeli kurumda iki VKN aynıdır. Harcama biriminin adresi alıcınınkidir.
   */
  const kamu = earsiv || ihracat || yolcu ? undefined : secenekler.kamu;
  const yolcuUlke = yolcu ? ulkeKoduCoz(yolcu.yolcu.ulke) : undefined;
  const yolcuBlogu = yolcu
    ? `
  <cac:BuyerCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="PARTYTYPE">${YOLCU_BERABER_PARTY_TIPI}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>-</cbc:CitySubdivisionName>
        <cbc:CityName>${escape(yolcu.yolcu.sehir ?? "-")}</cbc:CityName>
        <cac:Country>${yolcuUlke ? `
          <cbc:IdentificationCode>${yolcuUlke}</cbc:IdentificationCode>` : ""}
          <cbc:Name>${escape(ulkeAdi(yolcuUlke) ?? yolcu.yolcu.ulke ?? "-")}</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:Person>
        <cbc:FirstName>${escape(yolcu.yolcu.ad ?? "")}</cbc:FirstName>
        <cbc:FamilyName>${escape(yolcu.yolcu.soyad ?? "")}</cbc:FamilyName>
        <cbc:NationalityID>${escape(yolcu.yolcu.uyruk ?? "")}</cbc:NationalityID>${yolcu.yolcu.bankaHesapNo ? `
        <cac:FinancialAccount>
          <cbc:ID>${escape(yolcu.yolcu.bankaHesapNo)}</cbc:ID>${yolcu.yolcu.bankaAdi ? `
          <cac:FinancialInstitutionBranch>
            <cbc:Name>-</cbc:Name>
            <cac:FinancialInstitution>
              <cbc:Name>${escape(yolcu.yolcu.bankaAdi)}</cbc:Name>
            </cac:FinancialInstitution>
          </cac:FinancialInstitutionBranch>` : ""}
        </cac:FinancialAccount>` : ""}
        <cac:IdentityDocumentReference>
          <cbc:ID>${escape(yolcu.yolcu.pasaportNo ?? "")}</cbc:ID>
          <cbc:IssueDate>${escape((yolcu.yolcu.pasaportTarihi || PASAPORT_TARIHI_BILINMIYOR).slice(0, 10))}</cbc:IssueDate>
        </cac:IdentityDocumentReference>
      </cac:Person>
    </cac:Party>
  </cac:BuyerCustomerParty>
  <cac:TaxRepresentativeParty>
    <cac:PartyIdentification>
      <cbc:ID schemeID="ARACIKURUMVKN">${escape(yolcu.araciKurum.vkn ?? "")}</cbc:ID>
    </cac:PartyIdentification>
    <cac:PartyIdentification>
      <cbc:ID schemeID="ARACIKURUMETIKET">${escape(yolcu.araciKurum.etiket ?? "")}</cbc:ID>
    </cac:PartyIdentification>
    <cac:PartyName>
      <cbc:Name>${escape(yolcu.araciKurum.unvan ?? "")}</cbc:Name>
    </cac:PartyName>
    <cac:PostalAddress>
      <cbc:CitySubdivisionName>-</cbc:CitySubdivisionName>
      <cbc:CityName>-</cbc:CityName>
      <cac:Country>
        <cbc:IdentificationCode>TR</cbc:IdentificationCode>
        <cbc:Name>Türkiye</cbc:Name>
      </cac:Country>
    </cac:PostalAddress>
  </cac:TaxRepresentativeParty>
`
    : "";
  const kamuAliciBlogu = kamu
    ? `
  <cac:BuyerCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${escape(kamu.harcamaBirimiVkn)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escape(kamu.harcamaBirimiAdi)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>${aliciAdres.adres ? `
        <cbc:StreetName>${escape(aliciAdres.adres)}</cbc:StreetName>` : ""}
        <cbc:CitySubdivisionName>${escape(aliciAdres.ilce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${escape(aliciAdres.il)}</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>${aliciAdres.ulkeKodu}</cbc:IdentificationCode>${aliciAdres.ulkeAdi ? `
          <cbc:Name>${escape(aliciAdres.ulkeAdi)}</cbc:Name>` : ""}
        </cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:BuyerCustomerParty>
`
    : "";
  /**
   * Vade (EBLG-73): faturadaki ödeme günü UBL-TR'de `cac:PaymentTerms`
   * içindedir — GİB'in resmî ticari fatura örneği (`UBL-TR 1.2.1/XSLT/
   * TicariFaturaOrnegi.xml`) vadeyi orada gösterir ve bloğun yeri
   * `PaymentMeans` ile `TaxTotal` arasıdır. Gelen belgeden okurken de aynı
   * yere bakıyoruz (`ubl-oku.ts`). Vade girilmemişse blok hiç yazılmaz.
   */
  const vadeBlogu = fatura.vadeTarihi
    ? `
  <cac:PaymentTerms>
    <cbc:Note>Son ödeme tarihi: ${gunBicim(fatura.vadeTarihi)}</cbc:Note>
    <cbc:PaymentDueDate>${fatura.vadeTarihi.toISOString().slice(0, 10)}</cbc:PaymentDueDate>
  </cac:PaymentTerms>
`
    : "";
  const kamuOdemeBlogu = kamu
    ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${KAMU_ODEME_KODU}</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escape(ibanNormalize(kamu.iban))}</cbc:ID>
      <cbc:CurrencyCode>TRY</cbc:CurrencyCode>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
`
    : "";

  /*
   * Fatura düzeyindeki teslimat bilgisi yalnız internet satışına aittir: malın
   * gönderildiği adres, kargo firması ve ödeme şekli (EBLG-56). İhracatta bu
   * bilgiler satır düzeyinde durur (GİB `IHRACAT.xml`), aşağıdaki
   * `ihracatSatirTeslimati` onu üretir.
   */
  const teslimatBlogu = internet
    ? `
  <cac:Delivery>${internet.gonderiTarihi ? `
    <cbc:ActualDeliveryDate>${internet.gonderiTarihi.toISOString().slice(0, 10)}</cbc:ActualDeliveryDate>` : ""}${teslimatAdresi ? `
    <cac:DeliveryAddress>${teslimatAdresi.adres ? `
      <cbc:StreetName>${escape(teslimatAdresi.adres)}</cbc:StreetName>` : ""}
      <cbc:CitySubdivisionName>${escape(teslimatAdresi.ilce)}</cbc:CitySubdivisionName>
      <cbc:CityName>${escape(teslimatAdresi.il)}</cbc:CityName>${teslimatAdresi.postaKodu ? `
      <cbc:PostalZone>${escape(teslimatAdresi.postaKodu)}</cbc:PostalZone>` : ""}
      <cac:Country>
        <cbc:IdentificationCode>${teslimatAdresi.ulkeKodu}</cbc:IdentificationCode>${teslimatAdresi.ulkeAdi ? `
        <cbc:Name>${escape(teslimatAdresi.ulkeAdi)}</cbc:Name>` : ""}
      </cac:Country>
    </cac:DeliveryAddress>` : ""}${internet.tasiyiciUnvan ? `
    <cac:CarrierParty>${internet.tasiyiciVkn ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="${internet.tasiyiciVkn.length === 11 ? "TCKN" : "VKN"}">${escape(internet.tasiyiciVkn)}</cbc:ID>
      </cac:PartyIdentification>` : ""}
      <cac:PartyName>
        <cbc:Name>${escape(internet.tasiyiciUnvan)}</cbc:Name>
      </cac:PartyName>
    </cac:CarrierParty>` : ""}
  </cac:Delivery>${internet.odemeSekli ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${odemeSekliUblKodu(internet.odemeSekli)}</cbc:PaymentMeansCode>${internet.odemeTarihi ? `
    <cbc:PaymentDueDate>${internet.odemeTarihi.toISOString().slice(0, 10)}</cbc:PaymentDueDate>` : ""}${internet.odemeAracisi ? `
    <cbc:InstructionNote>${escape(internet.odemeAracisi)}</cbc:InstructionNote>` : ""}
  </cac:PaymentMeans>` : ""}
`
    : "";

  /*
   * İrsaliye yerine geçen fatura (EBLG-76): mal fatura beraberinde sevk
   * edildiğinde ayrıca e-İrsaliye düzenlenmez, sevkin kanıtı faturanın
   * kendisidir. Fiili sevk anı `cac:Delivery/cac:Despatch` ile, ibare ise
   * `cbc:Note` ile gider — GİB'in genel XSLT'si sevk alanlarını basmaz, notu
   * basar (EBLG-73'te vade tarihinde aynı tuzağa düşmüştük). Blok internet
   * satışının `cac:Delivery`'sinden ayrı durur: o blok teslimat adresi ve
   * kargoyu anlatır, bu blok sevk anını.
   */
  const irsaliyeYerine = fatura.sevkiyatYontemi === "irsaliye_yerine" ? anParcala(fatura.fiiliSevkZamani) : null;
  const sevkBlogu = irsaliyeYerine
    ? `
  <cac:Delivery>
    <cac:Despatch>
      <cbc:ActualDespatchDate>${irsaliyeYerine.tarih}</cbc:ActualDespatchDate>
      <cbc:ActualDespatchTime>${irsaliyeYerine.saat}</cbc:ActualDespatchTime>
    </cac:Despatch>
  </cac:Delivery>
`
    : "";

  /**
   * İhracatta teslimat satır düzeyinde bildirilir (GİB `IHRACAT.xml`): malın
   * teslim yeri, teslim şartı, GTİP (`RequiredCustomsID`) ve gönderilme şekli
   * aynı `cac:Delivery` altında toplanır. GTİP satırın stok kartından gelir,
   * bu yüzden blok satır başına üretilir.
   */
  const ihracatSatirTeslimati = (gtip: string | undefined) => {
    if (!ihracat) return "";
    const gonderim = ihracat.tasimaSekli || gtip
      ? `
      <cac:Shipment>
        <cbc:ID>1</cbc:ID>${gtip ? `
        <cac:GoodsItem>
          <cbc:RequiredCustomsID>${gtip}</cbc:RequiredCustomsID>
        </cac:GoodsItem>` : ""}${ihracat.tasimaSekli ? `
        <cac:ShipmentStage>
          <cbc:TransportModeCode>${escape(ihracat.tasimaSekli)}</cbc:TransportModeCode>
        </cac:ShipmentStage>` : ""}
      </cac:Shipment>`
      : "";
    return `
    <cac:Delivery>${ihracat.teslimTarihi ? `
      <cbc:ActualDeliveryDate>${ihracat.teslimTarihi.toISOString().slice(0, 10)}</cbc:ActualDeliveryDate>` : ""}
      <cac:DeliveryAddress>${aliciAdres.adres ? `
        <cbc:StreetName>${escape(aliciAdres.adres)}</cbc:StreetName>` : ""}
        <cbc:CitySubdivisionName>${escape(aliciAdres.ilce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${escape(aliciAdres.il)}</cbc:CityName>${aliciAdres.postaKodu ? `
        <cbc:PostalZone>${escape(aliciAdres.postaKodu)}</cbc:PostalZone>` : ""}
        <cac:Country>
          <cbc:IdentificationCode>${aliciAdres.ulkeKodu}</cbc:IdentificationCode>${aliciAdres.ulkeAdi ? `
          <cbc:Name>${escape(aliciAdres.ulkeAdi)}</cbc:Name>` : ""}
        </cac:Country>
      </cac:DeliveryAddress>${ihracat.teslimSarti ? `
      <cac:DeliveryTerms>
        <cbc:ID schemeID="INCOTERMS">${escape(ihracat.teslimSarti)}</cbc:ID>
      </cac:DeliveryTerms>` : ""}${gonderim}
    </cac:Delivery>`;
  };

  const tevkifatBlogu = tevkifatIade ? "" : [...tevkifatGruplari.entries()]
    .filter(([kod]) => tevkifatKoduBul(kod))
    .map(([kod, deger]) => `  <cac:WithholdingTaxTotal>
    <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${deger.tutar.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${deger.tutar.toFixed(2)}</cbc:TaxAmount>
      <cbc:Percent>${tevkifatYuzdesi(deger.oran)}</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:TaxTypeCode>${kod}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:WithholdingTaxTotal>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${ihracat ? IHRACAT_PROFILI : yolcu ? YOLCU_BERABER_PROFILI : kamu ? KAMU_PROFILI : earsiv ? "EARSIVFATURA" : sarj ? SARJ_PROFILI : idis ? IDIS_PROFILI : ytb ? YTB_PROFILI : fatura.efaturaProfili === "ticari" && !iadeSenaryosu && !sgk ? "TICARIFATURA" : "TEMELFATURA"}</cbc:ProfileID>
  <cbc:ID>${no}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
  <cbc:IssueTime>${saatStr}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${ihracat ? IHRACAT_FATURA_TIPI : yolcu ? YOLCU_BERABER_FATURA_TIPI : sgk ? SGK_FATURA_TIPI : ytb ? ytbFaturaTipi(senaryoUblKodu(fatura.senaryo), earsiv ? "earsiv" : "efatura") : senaryoUblKodu(fatura.senaryo)}</cbc:InvoiceTypeCode>${internet?.webAdresi ? `
  <cbc:Note>${escape(`İnternet satışı — ${internet.webAdresi}`)}</cbc:Note>` : ""}${irsaliyeYerine ? `
  <cbc:Note>${escape(irsaliyeYerineIbaresi(earsiv ? "earsiv" : "efatura"))}</cbc:Note>` : ""}
  <cbc:DocumentCurrencyCode>${fatura.dovizCinsi}</cbc:DocumentCurrencyCode>${dovizli && ihracat ? `
  <cbc:TaxCurrencyCode>${IHRACAT_VERGI_PARA_BIRIMI}</cbc:TaxCurrencyCode>` : ""}
${sgk ? `  <cbc:AccountingCost>${escape(sgk.ilaveFaturaTipi)}</cbc:AccountingCost>
` : ""}  <cbc:LineCountNumeric>${fatura.satirlar.length}</cbc:LineCountNumeric>${sgk?.donem ? `
  <cac:InvoicePeriod>
    <cbc:StartDate>${sgk.donem.baslangic}</cbc:StartDate>
    <cbc:EndDate>${sgk.donem.bitis}</cbc:EndDate>
  </cac:InvoicePeriod>` : ""}${sarj && anParcala(sarj.baslangic) && anParcala(sarj.bitis) ? `
  <cac:InvoicePeriod>
    <cbc:StartDate>${anParcala(sarj.baslangic)!.tarih}</cbc:StartDate>
    <cbc:StartTime>${anParcala(sarj.baslangic)!.saat}</cbc:StartTime>
    <cbc:EndDate>${anParcala(sarj.bitis)!.tarih}</cbc:EndDate>
    <cbc:EndTime>${anParcala(sarj.bitis)!.saat}</cbc:EndTime>
  </cac:InvoicePeriod>` : ""}${fatura.siparisNo ? `
  <!-- Sipariş referansı (EBLG-73): tarih UBL-TR'de zorunludur; NES tarihsiz
       OrderReference'ı "incomplete content" diye reddediyor (2026-09-20 denemesi),
       bu yüzden tarih girilmemişse fatura tarihine düşülür. -->
  <cac:OrderReference>
    <cbc:ID>${escape(fatura.siparisNo)}</cbc:ID>
    <cbc:IssueDate>${(fatura.siparisTarihi ?? fatura.tarih).toISOString().slice(0, 10)}</cbc:IssueDate>
  </cac:OrderReference>` : ""}${iadeReferansBloklari}${(secenekler.irsaliyeReferanslari ?? []).map((i) => `
  <cac:DespatchDocumentReference><cbc:ID>${escape(i.no)}</cbc:ID><cbc:IssueDate>${i.tarih.toISOString().slice(0, 10)}</cbc:IssueDate></cac:DespatchDocumentReference>`).join("")}${ytb ? `
  <!-- EBLG-78: teşvik belge numarası ve tarihi; şemada yeri
       DespatchDocumentReference ile AdditionalDocumentReference arasıdır. -->
  <cac:ContractDocumentReference>
    <cbc:ID schemeID="YTBNO">${escape(ytb.no)}</cbc:ID>${ytb.tarih ? `
    <cbc:IssueDate>${new Date(ytb.tarih).toISOString().slice(0, 10)}</cbc:IssueDate>` : ""}
  </cac:ContractDocumentReference>` : ""}

${earsiv ? `  <cac:AdditionalDocumentReference>
    <cbc:ID>${fatura.earsivGonderimSekli === "kagit" ? "KAGIT" : "ELEKTRONIK"}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentTypeCode>SEND_TYPE</cbc:DocumentTypeCode>
  </cac:AdditionalDocumentReference>` : ""}${sgk ? `${sgkReferansi("MUKELLEF_KODU", sgk.mukellefKodu)}${sgkReferansi("MUKELLEF_ADI", sgk.mukellefAdi)}${sgkReferansi("DOSYA_NO", sgk.dosyaNo)}` : ""}${sarj ? sarj.raporlar.map((rapor) => `
  <cac:AdditionalDocumentReference>
    <cbc:ID schemeID="ESURaporID">${escape(rapor.raporId)}</cbc:ID>
    <cbc:IssueDate>${escape(rapor.tarih)}</cbc:IssueDate>
  </cac:AdditionalDocumentReference>`).join("") : ""}${ihracat?.beyannameNo ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>${escape(ihracat.beyannameNo)}</cbc:ID>
    <cbc:IssueDate>${tarihStr}</cbc:IssueDate>
    <cbc:DocumentType>CUST_INV</cbc:DocumentType>
  </cac:AdditionalDocumentReference>` : ""}
  
  <cac:Signature>
    <cbc:ID schemeID="VKN_TCKN">${supplier.vkn}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${supplier.vkn}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escape(supplier.unvan)}</cbc:Name>
      </cac:PartyName>
${saticiAdresi}
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#Signature</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>

  <cac:AccountingSupplierParty>
    <cac:Party>${supplier.webSitesi ? `
      <cbc:WebsiteURI>${escape(supplier.webSitesi)}</cbc:WebsiteURI>` : ""}
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">${supplier.vkn}</cbc:ID>
      </cac:PartyIdentification>${supplier.mersisNo ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="MERSISNO">${escape(supplier.mersisNo)}</cbc:ID>
      </cac:PartyIdentification>` : ""}${supplier.ticaretSicilNo ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="TICARETSICILNO">${escape(supplier.ticaretSicilNo)}</cbc:ID>
      </cac:PartyIdentification>` : ""}${idis ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="SEVKIYATNO">${escape(idis)}</cbc:ID>
      </cac:PartyIdentification>` : ""}
      <cac:PartyName>
        <cbc:Name>${escape(supplier.unvan)}</cbc:Name>
      </cac:PartyName>
${saticiAdresi}
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${escape(supplier.vergiDairesi)}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>${supplier.telefon || supplier.eposta ? `
      <cac:Contact>${supplier.telefon ? `
        <cbc:Telephone>${escape(supplier.telefon)}</cbc:Telephone>` : ""}${supplier.eposta ? `
        <cbc:ElectronicMail>${escape(supplier.eposta)}</cbc:ElectronicMail>` : ""}
      </cac:Contact>` : ""}
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${gtbAlici || !aliciTckn ? "VKN" : "TCKN"}">${gtbAlici ? GUMRUK_BAKANLIGI_VKN : fatura.cari.vknTckn}</cbc:ID>
      </cac:PartyIdentification>${sarj && sarj.plaka ? `
      <cac:PartyIdentification>
        <cbc:ID schemeID="PLAKA">${escape(sarj.plaka)}</cbc:ID>
      </cac:PartyIdentification>` : ""}
${aliciTckn && !gtbAlici ? "" : `      <cac:PartyName>
        <cbc:Name>${escape(gtbAlici ? GUMRUK_BAKANLIGI_UNVAN : fatura.cari.unvan)}</cbc:Name>
      </cac:PartyName>`}
      <cac:PostalAddress>${gtbAlici ? `
        <cbc:CitySubdivisionName>-</cbc:CitySubdivisionName>
        <cbc:CityName>${GUMRUK_BAKANLIGI_IL}</cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>` : `${aliciAdres.adres ? `
        <cbc:StreetName>${escape(aliciAdres.adres)}</cbc:StreetName>` : ""}
        <cbc:CitySubdivisionName>${escape(aliciAdres.ilce)}</cbc:CitySubdivisionName>
        <cbc:CityName>${escape(aliciAdres.il)}</cbc:CityName>${aliciAdres.postaKodu ? `
        <cbc:PostalZone>${escape(aliciAdres.postaKodu)}</cbc:PostalZone>` : ""}
        <cac:Country>
          <cbc:IdentificationCode>${aliciAdres.ulkeKodu}</cbc:IdentificationCode>${aliciAdres.ulkeAdi ? `
          <cbc:Name>${escape(aliciAdres.ulkeAdi)}</cbc:Name>` : ""}
        </cac:Country>`}
      </cac:PostalAddress>
${aliciTckn && !gtbAlici ? `      <cac:Person>
        <cbc:FirstName>${escape(aliciAd)}</cbc:FirstName>
        <cbc:FamilyName>${escape(aliciSoyad)}</cbc:FamilyName>
      </cac:Person>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>
${yabanciAliciBlogu}${yolcuBlogu}${kamuAliciBlogu}${teslimatBlogu}${sevkBlogu}${kamuOdemeBlogu}${vadeBlogu}
${kurBlogu}  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${(ozelMatrah ? ozelMatrah.kdv : tevkifatIade ? Number(fatura.toplamNetKdv) : Number(fatura.toplamKdv)).toFixed(2)}</cbc:TaxAmount>
${(ozelMatrah
    ? [{ matrahKurus: Math.round(ozelMatrah.tutar * 100), kdvKurus: Math.round(ozelMatrah.kdv * 100), oran: ozelMatrah.oran, kod: ozelMatrah.kod }]
    : kdvAltToplamlari
  ).map((g) => {
    // EBLG-78: istisnalı YTB faturasında alt toplam, alınmayan KDV'yi taşır;
    // `CalculationSequenceNumeric` -1 onun toplama katılmayacağını söyler.
    const vazgecilen = "vazgecilenOran" in g && g.vazgecilenOran > 0;
    return `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${(g.matrahKurus / 100).toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${((vazgecilen ? g.vazgecilenKurus : g.kdvKurus) / 100).toFixed(2)}</cbc:TaxAmount>${vazgecilen ? `
      <cbc:CalculationSequenceNumeric>${VAZGECILEN_KDV_SIRA_NO}</cbc:CalculationSequenceNumeric>` : ""}
      <cbc:Percent>${(vazgecilen ? g.vazgecilenOran : g.oran).toFixed(2)}</cbc:Percent>
      <cac:TaxCategory>${g.kod ? `
        <cbc:TaxExemptionReasonCode>${escape(g.kod)}</cbc:TaxExemptionReasonCode>
        <cbc:TaxExemptionReason>${escape(istisnaAciklamasi(g.kod))}</cbc:TaxExemptionReason>` : ""}
        <cac:TaxScheme>
          <cbc:Name>KDV</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
`;
  }).join("")}  </cac:TaxTotal>
${tevkifatBlogu}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamBrut.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${fatura.dovizCinsi}">${fatura.toplamMatrah.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${fatura.dovizCinsi}">${ihracKayitliKodu ? kurusTopla(fatura.toplamMatrah, fatura.toplamKdv) : fatura.genelToplam.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${fatura.dovizCinsi}">${kurusTopla(fatura.toplamSatirIskontosu, fatura.genelIskontoToplam)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${fatura.dovizCinsi}">${fatura.genelToplam.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${fatura.satirlar
    .map(
      (s, index) => `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${birimUblKodu(s.birim)}">${s.miktar.toFixed(3)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:LineExtensionAmount>${ihracatSatirTeslimati(gtipNormalize(s.stok.gtipKodu))}
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      ${Number(s.iskontoOrani ?? 0) > 0 ? `<cbc:MultiplierFactorNumeric>${(Number(s.iskontoOrani) / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>` : ""}
      <cbc:Amount currencyID="${fatura.dovizCinsi}">${s.iskontoTutari.toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>${Number(s.genelIskontoPayi ?? 0) > 0 ? `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:AllowanceChargeReason>Genel iskonto payı</cbc:AllowanceChargeReason>
      <cbc:Amount currencyID="${fatura.dovizCinsi}">${Number(s.genelIskontoPayi).toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>` : ""}${ozelMatrah ? `
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${ozelMatrah.paylar[index].kdv.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${ozelMatrah.paylar[index].matrah.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${ozelMatrah.paylar[index].kdv.toFixed(2)}</cbc:TaxAmount>
        <cbc:Percent>${ozelMatrah.oran.toFixed(2)}</cbc:Percent>
        <cac:TaxCategory>
          <cbc:TaxExemptionReasonCode>${escape(ozelMatrah.kod)}</cbc:TaxExemptionReasonCode>
          <cbc:TaxExemptionReason>${escape(istisnaAciklamasi(ozelMatrah.kod))}</cbc:TaxExemptionReason>
          <cac:TaxScheme>
            <cbc:Name>KDV</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>` : `
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${belgeKdvi(s).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${fatura.dovizCinsi}">${s.matrah.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${fatura.dovizCinsi}">${belgeKdvi(s).toFixed(2)}</cbc:TaxAmount>
${vazgecilenOran(s) > 0 ? `        <cbc:CalculationSequenceNumeric>${VAZGECILEN_KDV_SIRA_NO}</cbc:CalculationSequenceNumeric>
` : ""}        <cbc:Percent>${s.kdvOrani.toFixed(2)}</cbc:Percent>
        <cac:TaxCategory>
          ${satirKodu(s) ? `<cbc:TaxExemptionReasonCode>${escape(satirKodu(s))}</cbc:TaxExemptionReasonCode>
          <cbc:TaxExemptionReason>${escape(istisnaAciklamasi(satirKodu(s)!))}</cbc:TaxExemptionReason>` : ""}
          <cac:TaxScheme>
            <cbc:Name>KDV</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>`}
    <cac:Item>
      <cbc:Name>${escape(s.stok.ad)}</cbc:Name>${ytb && ytbNormalize(s.ytbMakineAdi) ? `
      <!-- EBLG-78: makine adı kılavuz v1.2 ile Name'den ModelName'e taşındı. -->
      <cbc:ModelName>${escape(ytbNormalize(s.ytbMakineAdi))}</cbc:ModelName>` : ""}
      <cac:SellersItemIdentification>
        <cbc:ID>${escape(s.stok.kod)}</cbc:ID>
      </cac:SellersItemIdentification>${idis && s.idisEtiketNo ? `
      <cac:AdditionalItemIdentification>
        <cbc:ID schemeID="ETIKETNO">${escape(idisNormalize(s.idisEtiketNo))}</cbc:ID>
      </cac:AdditionalItemIdentification>` : ""}${sarj?.tip === "SARJANLIK" && s.sarjUniteSeriNo ? `
      <cac:ItemInstance>
        <cbc:SerialID>${escape(s.sarjUniteSeriNo)}</cbc:SerialID>
      </cac:ItemInstance>` : ""}${ihracat && menseiAdi(s.stok.mensei) ? `
      <cac:OriginCountry>
        <cbc:IdentificationCode>${ulkeKoduCoz(s.stok.mensei)}</cbc:IdentificationCode>
        <cbc:Name>${escape(menseiAdi(s.stok.mensei))}</cbc:Name>
      </cac:OriginCountry>` : ""}${ytb && ytbHarcamaTipiBul(s.ytbHarcamaTipi) ? `
      <cac:CommodityClassification>
        <cbc:ItemClassificationCode>${escape(s.ytbHarcamaTipi!)}</cbc:ItemClassificationCode>
      </cac:CommodityClassification>` : ""}${ytb && s.ytbHarcamaTipi === YTB_MAKINE_HARCAMA_TIPI && (ytbNormalize(s.ytbMakineId) || ytbNormalize(s.ytbMakineSiraNo)) ? `
      <cac:ItemInstance>${ytbNormalize(s.ytbMakineSiraNo) ? `
        <cbc:ProductTraceID>${escape(ytbNormalize(s.ytbMakineSiraNo))}</cbc:ProductTraceID>` : ""}${ytbNormalize(s.ytbMakineId) ? `
        <cbc:SerialID>${escape(ytbNormalize(s.ytbMakineId))}</cbc:SerialID>` : ""}
      </cac:ItemInstance>` : ""}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${fatura.dovizCinsi}">${s.birimFiyat.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
  `,
    )
    .join("")}
</Invoice>`;
}

/**
 * EBLG-16 sonrası düzeltme: numarayı sağlayıcı attığında UBL'e yalnız seri
 * öneki yazılmış olur. Arşivlenen belge, düzenlenen belgenin kendisidir; bu
 * yüzden sağlayıcıdan dönen numara `cbc:ID` alanına geri yazılır. Yoksa
 * arşivdeki belge numarasız kalır ve ondan üretilen görünüm "SNC" der.
 *
 * Fatura numarası, `cbc:ProfileID`'yi izleyen ilk `cbc:ID`'dir — belgede
 * onlarca `cbc:ID` bulunduğu için değişiklik bu çıpaya bağlanır.
 */
export function belgeNoyuUbleYaz(xml: string, belgeNo: string): string {
  const desen = /(<cbc:ProfileID>[^<]*<\/cbc:ProfileID>\s*<cbc:ID>)([^<]*)(<\/cbc:ID>)/;
  if (!desen.test(xml)) return xml;
  return xml.replace(desen, (_tam, bas: string, _eski: string, son: string) => `${bas}${escapeXml(belgeNo)}${son}`);
}

/**
 * Tevkifat yüzdesi. Şematron oranı kod listesindeki metinle karşılaştırır:
 * "90" geçer, "90.00" "602 vergi tipinin yüzdesi '90.00' olamaz" diye döner
 * (NES önizlemesi, 2026-09-19 — bu yüzden tevkifatlı belge hiç gidemiyordu).
 */
function tevkifatYuzdesi(oran: number): string {
  return String(Math.round(oran * 100) / 100);
}

/** Tutarları kuruşta toplar; ondalıklı toplama `0.1 + 0.2` kaymasına düşmesin. */
function kurusTopla(...tutarlar: (number | { toString(): string } | null | undefined)[]): string {
  const kurus = tutarlar.reduce<number>((t, v) => t + Math.round(Number(v ?? 0) * 100), 0);
  return (kurus / 100).toFixed(2);
}

function escapeXml(deger: string): string {
  return deger
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
