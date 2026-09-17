/**
 * GİB UBL-TR kod listeleri (FTR-21).
 *
 * Kaynak: `docs/e-belge/.../UBL-TR Kod Listeleri` — belgenin kendi sürüm
 * numarası 1.17'dir (dosya adı 1.16 der). Kodlar UBL'e olduğu gibi yazıldığı
 * için liste dışı bir değer ne arayüzden ne API'den kabul edilir.
 */

export const GIB_KOD_LISTESI_SURUMU = "UBL-TR 1.17";

export type IstisnaTuru = "kismi" | "tam";

export interface IstisnaKodu {
  kod: string;
  /** Kısmi istisna 2xx, tam istisna 3xx. */
  tur: IstisnaTuru;
  ad: string;
}

/**
 * KDV istisna kodları. `351` istisna değildir; KDV oranı sıfır olan ama
 * istisna sayılmayan satışlar için listede bilerek durur.
 */
export const KDV_ISTISNA_KODLARI: readonly IstisnaKodu[] = [
  { kod: "201", tur: "kismi", ad: "17/1 Kültür ve Eğitim Amacı Taşıyan İşlemler" },
  { kod: "202", tur: "kismi", ad: "17/2-a Sağlık, Çevre Ve Sosyal Yardım Amaçlı İşlemler" },
  { kod: "204", tur: "kismi", ad: "17/2-c Yabancı Diplomatik Organ Ve Hayır Kurumlarının Yapacakları Bağışlarla İlgili Mal Ve Hizmet Alışları" },
  { kod: "205", tur: "kismi", ad: "17/2-d Taşınmaz Kültür Varlıklarına İlişkin Teslimler ve Mimarlık Hizmetleri" },
  { kod: "206", tur: "kismi", ad: "17/2-e Mesleki Kuruluşların İşlemleri" },
  { kod: "207", tur: "kismi", ad: "17/3 Askeri Fabrika, Tersane ve Atölyelerin İşlemleri" },
  { kod: "208", tur: "kismi", ad: "17/4-c Birleşme, Devir, Dönüşüm ve Bölünme İşlemleri" },
  { kod: "209", tur: "kismi", ad: "17/4-e Banka ve Sigorta Muameleleri Vergisi Kapsamına Giren İşlemler" },
  { kod: "211", tur: "kismi", ad: "17/4-h Zirai Amaçlı Su Teslimleri İle Köy Tüzel Kişiliklerince Yapılan İçme Suyu teslimleri" },
  { kod: "212", tur: "kismi", ad: "17/4-ı Serbest Bölgelerde Verilen Hizmetler" },
  { kod: "213", tur: "kismi", ad: "17/4-j Boru Hattı İle Yapılan Petrol Ve Gaz Taşımacılığı" },
  { kod: "214", tur: "kismi", ad: "17/4-k Organize Sanayi Bölgelerindeki Arsa ve İşyeri Teslimleri İle Konut Yapı Kooperatiflerinin Üyelerine Konut Teslimleri" },
  { kod: "215", tur: "kismi", ad: "17/4-l Varlık Yönetim Şirketlerinin İşlemleri" },
  { kod: "216", tur: "kismi", ad: "17/4-m Tasarruf Mevduatı Sigorta Fonunun İşlemleri" },
  { kod: "217", tur: "kismi", ad: "17/4-n Basın-Yayın ve Enformasyon Genel Müdürlüğüne Verilen Haber Hizmetleri" },
  { kod: "218", tur: "kismi", ad: "17/4-o Gümrük Antrepoları, Geçici Depolama Yerleri, Gümrüklü Sahalar ve Vergisiz Satış Yapılan Mağazalarla İlgili Hizmetler" },
  { kod: "219", tur: "kismi", ad: "17/4-p Hazine ve Arsa Ofisi Genel Müdürlüğünün işlemleri" },
  { kod: "220", tur: "kismi", ad: "17/4-r İki Tam Yıl Süreyle Sahip Olunan Taşınmaz ve İştirak Hisseleri Satışları" },
  { kod: "221", tur: "kismi", ad: "Geçici 15 Konut Yapı Kooperatifleri, Belediyeler ve Sosyal Güvenlik Kuruluşlarına Verilen İnşaat Taahhüt Hizmeti" },
  { kod: "223", tur: "kismi", ad: "Geçici 20/1 Teknoloji Geliştirme Bölgelerinde Yapılan İşlemler" },
  { kod: "225", tur: "kismi", ad: "Geçici 23 Milli Eğitim Bakanlığına Yapılan Bilgisayar Bağışları İle İlgili Teslimler" },
  { kod: "226", tur: "kismi", ad: "17/2-b Özel Okulları, Üniversite ve Yüksekokullar Tarafından Verilen Bedelsiz Eğitim Ve Öğretim Hizmetleri" },
  { kod: "227", tur: "kismi", ad: "17/2-b Kanunların Gösterdiği Gerek Üzerine Bedelsiz Olarak Yapılan Teslim ve Hizmetler" },
  { kod: "228", tur: "kismi", ad: "17/2-b Kanunun (17/1) Maddesinde Sayılan Kurum ve Kuruluşlara Bedelsiz Olarak Yapılan Teslimler" },
  { kod: "229", tur: "kismi", ad: "17/2-b Gıda Bankacılığı Faaliyetinde Bulunan Dernek ve Vakıflara Bağışlanan Gıda, Temizlik, Giyecek ve Yakacak Maddeleri" },
  { kod: "230", tur: "kismi", ad: "17/4-g Külçe Altın, Külçe Gümüş Ve Kiymetli Taşlarin Teslimi" },
  { kod: "231", tur: "kismi", ad: "17/4-g Metal Plastik, Lastik, Kauçuk, Kağit, Cam Hurda Ve Atıkların Teslimi" },
  { kod: "232", tur: "kismi", ad: "17/4-g Döviz, Para, Damga Pulu, Değerli Kağıtlar, Hisse Senedi ve Tahvil Teslimleri" },
  { kod: "233", tur: "kismi", ad: "2942 Sayılı Kamulaştırma Kanunu Kapsamında Taşınmazların Devri" },
  { kod: "234", tur: "kismi", ad: "17/4-ş Konut Finansmanı Amacıyla Teminat Gösterilen ve İpotek Konulan Konutların Teslimi" },
  { kod: "235", tur: "kismi", ad: "16/1-c Transit ve Gümrük Antrepo Rejimleri İle Geçici Depolama ve Serbest Bölge Hükümlerinin Uygulandığiı Malların Teslimi" },
  { kod: "236", tur: "kismi", ad: "19/2 Usulüne Göre Yürürlüğe Girmiş Uluslararası Anlaşmalar Kapsamındaki İstisnalar (İade Hakkı Tanınmayan)" },
  { kod: "237", tur: "kismi", ad: "17/4-t 5300 Sayılı Kanuna Göre Düzenlenen Ürün Senetlerinin İhtisas/Ticaret Borsaları Aracılığıyla İlk Teslimlerinden Sonraki Teslim" },
  { kod: "238", tur: "kismi", ad: "17/4-u Varlıkların Varlık Kiralama Şirketlerine Devri İle Bu Varlıkların Varlık Kiralama Şirketlerince Kiralanması ve Devralınan Kuruma Devri" },
  { kod: "239", tur: "kismi", ad: "17/4-y Taşınmazların Finansal Kiralama Şirketlerine Devri, Finansal Kiralama Şirketi Tarafından Devredene Kiralanması ve Devri" },
  { kod: "240", tur: "kismi", ad: "17/4-z Patentli Veya Faydalı Model Belgeli Buluşa İlişkin Gayri Maddi Hakların Kiralanması, Devri ve Satışı" },
  { kod: "250", tur: "kismi", ad: "Diğerleri" },
  { kod: "301", tur: "tam", ad: "11/1-a Mal İhracatı" },
  { kod: "302", tur: "tam", ad: "11/1-a Hizmet İhracatı" },
  { kod: "303", tur: "tam", ad: "11/1-a Roaming Hizmetleri" },
  { kod: "304", tur: "tam", ad: "13/a Deniz Hava ve Demiryolu Taşıma Araçlarının Teslimi İle İnşa, Tadil, Bakım ve Onarımları" },
  { kod: "305", tur: "tam", ad: "13/b Deniz ve Hava Taşıma Araçları İçin Liman Ve Hava Meydanlarında Yapılan Hizmetler" },
  { kod: "306", tur: "tam", ad: "13/c Petrol Aramaları ve Petrol Boru Hatlarının İnşa ve Modernizasyonuna İlişkin Yapılan Teslim ve Hizmetler" },
  { kod: "307", tur: "tam", ad: "Zenginleştirme Ve Rafinaj Faaliyetlerine İlişkin Teslim Ve Hizmetler[KDVGUT- (II/8-4)]" },
  { kod: "308", tur: "tam", ad: "13/d Teşvikli Yatırım Mallarının Teslimi" },
  { kod: "309", tur: "tam", ad: "13/e Liman Ve Hava Meydanlarının İnşası, Yenilenmesi Ve Genişletilmesi" },
  { kod: "310", tur: "tam", ad: "13/f Ulusal Güvenlik Amaçlı Teslim ve Hizmetler" },
  { kod: "311", tur: "tam", ad: "14/1 Uluslararası Taşımacılık" },
  { kod: "312", tur: "tam", ad: "15/a Diplomatik Organ Ve Misyonlara Yapılan Teslim ve Hizmetler" },
  { kod: "313", tur: "tam", ad: "15/b Uluslararası Kuruluşlara Yapılan Teslim ve Hizmetler" },
  { kod: "314", tur: "tam", ad: "19/2 Usulüne Göre Yürürlüğe Girmiş Uluslar Arası Anlaşmalar Kapsamındaki İstisnalar" },
  { kod: "315", tur: "tam", ad: "14/3 İhraç Konusu Eşyayı Taşıyan Kamyon, Çekici ve Yarı Romorklara Yapılan Motorin Teslimleri" },
  { kod: "316", tur: "tam", ad: "11/1-a Serbest Bölgelerdeki Müşteriler İçin Yapılan Fason Hizmetler" },
  { kod: "317", tur: "tam", ad: "17/4-s Engellilerin Eğitimleri, Meslekleri ve Günlük Yaşamlarına İlişkin Araç- Gereç ve Bilgisayar Programları" },
  { kod: "318", tur: "tam", ad: "Yaptırılan Sağlık Tesislerine İlişkin Projeler ve 652 Sayılı Kanun Hükmünde Kararnameye Göre Kiralama Karşılığı Yaptırılan Eğitim Öğretim Tesislerine İlişkin Projelere İlişkin Teslim ve Hizmetler" },
  { kod: "319", tur: "tam", ad: "13/g Başbakanlık Merkez Teşkilatına Yapılan Araç Teslimleri" },
  { kod: "320", tur: "tam", ad: "Geçici 16 (6111 sayılı K.) İSMEP Kapsamında İstanbul İl Özel İdaresi'ne Bağlı Olarak Faaliyet Gösteren \"İstanbul Proje Koordinasyon Birimi\"ne Yapılacak Teslim ve Hizmetler" },
  { kod: "321", tur: "tam", ad: "Geçici 26 Birleşmiş Milletler (BM) ile Kuzey Atlantik Antlaşması Teşkilatı (NATO) Temsilcilikleri ve Bu Teşkilatlara Bağlı Program, Fon ve Özel İhtisas Kuruluşları ile İktisadi İşbirliği ve Kalkınma Teşkilatına (OECD) Resmi Kullanımları İçin Yapılacak Mal Teslimi ve Hizmet İfaları, Bunların Sosyal ve Ekonomik Yardım Amacıyla Bedelsiz Olarak Yapacakları Mal Teslimi ve Hizmet İfaları İle İlgili Bunlara Yapılan Mal Teslimi ve Hizmet İfaları" },
  { kod: "322", tur: "tam", ad: "11/1-a Türkiye'de İkamet Etmeyenlere Özel Fatura ile Yapılan Teslimler (Bavul Ticareti)" },
  { kod: "323", tur: "tam", ad: "13/ğ 5300 Sayılı Kanuna Göre Düzenlenen Ürün Senetlerinin İhtisas/Ticaret Borsaları Aracılığıyla İlk Teslimi" },
  { kod: "324", tur: "tam", ad: "13/h Türkiye Kızılay Derneğine Yapılan Teslim ve Hizmetler ile Türkiye Kızılay Derneğinin Teslim ve Hizmetleri" },
  { kod: "325", tur: "tam", ad: "13/ı Yem Teslimleri" },
  { kod: "326", tur: "tam", ad: "13/ı Gıda, Tarım ve Hayvancılık Bakanlığı Tarafından Tescil Edilmiş Gübrelerin Teslimi" },
  { kod: "327", tur: "tam", ad: "13/ı Gıda, Tarım ve Hayvancılık Bakanlığı Tarafından Tescil Edilmiş Gübrelerin İçeriğinde Bulunan Hammaddelerin Gübre Üreticilerine Teslimi" },
  { kod: "328", tur: "tam", ad: "13/i Konut veya İşyeri Teslimleri" },
  { kod: "350", tur: "tam", ad: "Diğerleri" },
  { kod: "351", tur: "tam", ad: "KDV - İstisna Olmayan Diğer" },
];

export interface TevkifatKodu {
  kod: string;
  ad: string;
  /**
   * Tevkifat oranı koda bağlıdır (FTR-18). Yalnız `650 DİĞERLERİ` birden çok
   * oranla kullanılabildiği için küme çok elemanlıdır; kullanıcı o durumda
   * listeden oran seçer, serbest oran giremez.
   */
  oranlar: readonly string[];
}

export const TEVKIFAT_KODLARI: readonly TevkifatKodu[] = [
  { kod: "601", ad: "YAPIM İŞLERİ İLE BU İŞLERLE BİRLİKTE İFA EDİLEN MÜHENDİSLİK-MİMARLIK VE ETÜT-PROJE HİZMETLERİ", oranlar: ["3/10"] },
  { kod: "602", ad: "ETÜT, PLAN-PROJE, DANIŞMANLIK, DENETİM VE BENZERİ HİZMETLER", oranlar: ["9/10"] },
  { kod: "603", ad: "MAKİNE, TEÇHİZAT, DEMİRBAŞ VE TAŞITLARA AİT TADİL, BAKIM VE ONARIM HİZMETLERİ", oranlar: ["5/10"] },
  { kod: "604", ad: "YEMEK SERVİS HİZMETİ", oranlar: ["5/10"] },
  { kod: "605", ad: "ORGANİZASYON HİZMETİ", oranlar: ["5/10"] },
  { kod: "606", ad: "İŞGÜCÜ TEMİN HİZMETLERİ", oranlar: ["9/10"] },
  { kod: "607", ad: "ÖZEL GÜVENLİK HİZMETİ", oranlar: ["9/10"] },
  { kod: "608", ad: "YAPI DENETİM HİZMETLERİ", oranlar: ["9/10"] },
  { kod: "609", ad: "FASON OLARAK YAPTIRILAN TEKSTİL VE KONFEKSİYON İŞLERİ, ÇANTA VE AYAKKABI DİKİM İŞLERİ VE BU İŞLERE ARACILIK HİZMETLERİ", oranlar: ["5/10"] },
  { kod: "610", ad: "TURİSTİK MAĞAZALARA VERİLEN MÜŞTERİ BULMA / GÖTÜRME HİZMETLERİ", oranlar: ["9/10"] },
  { kod: "611", ad: "SPOR KULÜPLERİNİN YAYIN, REKLÂM VE İSİM HAKKI GELİRLERİNE KONU İŞLEMLERİ", oranlar: ["9/10"] },
  { kod: "612", ad: "TEMİZLİK HİZMETİ", oranlar: ["7/10"] },
  { kod: "613", ad: "ÇEVRE VE BAHÇE BAKIM HİZMETLERİ", oranlar: ["7/10"] },
  { kod: "614", ad: "SERVİS TAŞIMACILIĞI HİZMETİ", oranlar: ["5/10"] },
  { kod: "615", ad: "HER TÜRLÜ BASKI VE BASIM HİZMETLERİ", oranlar: ["5/10"] },
  { kod: "616", ad: "5018 SAYILI KANUNA EKLİ CETVELLERDEKİ İDARE, KURUM VE KURULUŞLARA YAPILAN DİĞER HİZMETLER", oranlar: ["5/10"] },
  { kod: "617", ad: "HURDA METALDEN ELDE EDİLEN KÜLÇE TESLİMLERİ", oranlar: ["5/10"] },
  { kod: "618", ad: "HURDA METALDEN ELDE EDİLENLER DIŞINDAKİ BAKIR, ÇİNKO VE ALÜMİNYUM KÜLÇE TESLİMLERİ", oranlar: ["5/10"] },
  { kod: "619", ad: "BAKIR, ÇİNKO VE ALÜMİNYUM ÜRÜNLERİNİN TESLİMİ", oranlar: ["5/10"] },
  { kod: "620", ad: "İSTİSNADAN VAZGEÇENLERİN HURDA VE ATIK TESLİMİ", oranlar: ["5/10"] },
  { kod: "621", ad: "METAL, PLASTİK, LASTİK, KAUÇUK, KÂĞIT VE CAM HURDA VE ATIKLARDAN ELDE EDİLEN HAMMADDE TESLİMİ", oranlar: ["9/10"] },
  { kod: "622", ad: "PAMUK, TİFTİK, YÜN VE YAPAĞI İLE HAM POST VE DERİ TESLİMLERİ", oranlar: ["9/10"] },
  { kod: "623", ad: "AĞAÇ VE ORMAN ÜRÜNLERİ TESLİMİ", oranlar: ["5/10"] },
  { kod: "650", ad: "DİĞERLERİ", oranlar: ["2/10", "5/10", "7/10", "9/10"] },
];

const ISTISNA_HARITASI = new Map(KDV_ISTISNA_KODLARI.map((k) => [k.kod, k]));
const TEVKIFAT_HARITASI = new Map(TEVKIFAT_KODLARI.map((k) => [k.kod, k]));

export function istisnaKoduBul(kod: string | null | undefined): IstisnaKodu | undefined {
  return kod ? ISTISNA_HARITASI.get(kod) : undefined;
}

export function tevkifatKoduBul(kod: string | null | undefined): TevkifatKodu | undefined {
  return kod ? TEVKIFAT_HARITASI.get(kod) : undefined;
}

/** "9/10" gibi bir oranı paya ve paydaya ayırır. */
export function tevkifatOraniAyristir(oran: string): { pay: number; payda: number } | undefined {
  const eslesme = oran.match(/^(\d+)\/(\d+)$/);
  if (!eslesme) return undefined;
  return { pay: Number(eslesme[1]), payda: Number(eslesme[2]) };
}
