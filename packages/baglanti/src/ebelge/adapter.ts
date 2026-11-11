import type { EbelgeSaglayici } from "@tekirextra/shared";
import type {
  BaglantiSonuc,
  BelgeDurumSonuc,
  EntegratorConfig,
  GelenBelge,
  GelenCekimSecenegi,
  GonderimSonuc,
  MukellefDurum,
  OnizlemeSonuc,
  UblBelge,
  EarsivIptalGirdi,
  EarsivRapor,
  EarsivRaporTutari,
  EirsaliyeBelge, EntegratorGecmisKaydi,
  GelenEirsaliye,
  MukellefKaydi,
  ZarfAraligi,
  GelenZarfSonucu,
  GelenYanit,
  SeriTanimi,
  TasarimTuru,
  BelgeTasarimi,
} from "./types";

/**
 * e-Belge entegratör adaptör sözleşmesi (EBLG-01, MIMARI §5.1).
 *
 * Adaptör yalnızca taşıma/zarf/kimlik farklarını kapatır; UBL-TR üretimi
 * ve iş kuralları ebelge modülündedir. Sağlayıcı durum kodları ortak
 * BelgeDurum kümesine adaptör içinde normalize edilir.
 */
export interface EntegratorAdapter {
  readonly saglayici: EbelgeSaglayici;

  /**
   * Sağlayıcı belge numarasını kendisi atayabiliyor mu (EBLG-16)? Yalnızca
   * yetenek bildirir; numaralandırmayı devretmek için ayrıca yapılandırmada
   * seri öneki tanımlı olmalıdır. Sovos gibi numarayı bizden bekleyen
   * sağlayıcılarda tanımsız kalır.
   */
  readonly belgeNoAtar?: boolean;

  baglantiTest(cfg: EntegratorConfig): Promise<BaglantiSonuc>;
  /**
   * EBLG-97: hesapta tanımlı belge serileri. Bağlantı etkinleştirilirken
   * yapılandırmadaki önekler buna karşı denetlenir; seri listesi sunmayan
   * sağlayıcıda tanımsız kalır ve denetim yapılmaz.
   */
  seriTanimlari?(cfg: EntegratorConfig): Promise<SeriTanimi[]>;
  /**
   * EBLG-99: entegratörde tanımlı belge tasarımları (XSLT). Tasarım yönetimi
   * sunmayan sağlayıcıda tanımsız kalır; ayar ekranı "desteklenmiyor" der.
   */
  tasarimlariListele?(cfg: EntegratorConfig, tur: TasarimTuru): Promise<BelgeTasarimi[]>;
  /** EBLG-99: yeni tasarım yükler; varsayılan yapmaz (seçim belge başına gönderilir). */
  tasarimYukle?(cfg: EntegratorConfig, tur: TasarimTuru, girdi: { baslik: string; xslt: string }): Promise<BelgeTasarimi>;
  /** EBLG-99: tasarımı verilen UBL ile çizer; entegratörün HTML'ini döndürür. */
  tasarimOnizle?(cfg: EntegratorConfig, tur: TasarimTuru, tasarimId: string, ublXml: string): Promise<OnizlemeSonuc>;
  mukellefSorgula(cfg: EntegratorConfig, vknTckn: string): Promise<MukellefDurum>;
  belgeGonder(cfg: EntegratorConfig, belge: UblBelge): Promise<GonderimSonuc>;
  /**
   * Belgeyi göndermeden sağlayıcının denetiminden geçirir ve görünümünü
   * döndürür (L). Önizleme ucu sunmayan sağlayıcıda tanımsız kalır; sihirbaz
   * o durumda yalnız özet gösterir.
   */
  belgeOnizle?(cfg: EntegratorConfig, belge: UblBelge): Promise<OnizlemeSonuc>;
  durumSorgula(cfg: EntegratorConfig, belgeRef: string): Promise<BelgeDurumSonuc>;
  /**
   * `isle` verilirse sağlayıcı her belgeyi indirdiği anda ona verir ve
   * biriktirmez (dönen dizi boş olabilir); gelen XML'ler eklerle MB'larca
   * olabildiği için uzun pencerede hepsini bellekte tutmak worker'ı düşürür.
   * Verilmezse ya da sağlayıcı desteklemiyorsa belgeler dizide döner.
   */
  gelenBelgeleriCek(cfg: EntegratorConfig, sonrasi: Date, isle?: (belge: GelenBelge) => Promise<void>, secenek?: GelenCekimSecenegi): Promise<GelenBelge[]>;
  /**
   * Tam GİB mükellef listesini indirir (EBLG-10). Yalnızca toplu liste sunan
   * sağlayıcılar uygular; tekil sorgusu ucuz olan sağlayıcılarda tanımsız
   * kalır ve çağıran `mukellefSorgula`'ya düşer.
   */
  mukellefListesiCek?(cfg: EntegratorConfig): Promise<MukellefKaydi[]>;
  /**
   * Verilen tarih aralığındaki gelen zarfları tek çağrı ailesiyle indirir
   * (EBLG-11, EBLG-12). Aralık kursörden gelir; adaptör aralığı sağlayıcının
   * izin verdiği dilimlere kendi böler.
   */
  gelenZarflariCek?(cfg: EntegratorConfig, aralik: ZarfAraligi): Promise<GelenZarfSonucu>;
  /**
   * Kaynak kaydımız için sağlayıcıda **zaten oluşmuş** belgeyi arar (EBLG-17).
   *
   * Gönderim ağ çağrısı ile veritabanına yazma aynı atomik birim değildir:
   * çağrı başarılı olup kalıcılaştırma düşerse belge sağlayıcıda kalır, bizde
   * kaydı olmaz ve yeniden deneme aynı satış için ikinci belge üretir. Yeniden
   * denemeden önce bu uç sorulur; belge varsa gönderim tekrarlanmaz, mevcut
   * belge benimsenir.
   *
   * Bulunamazsa `undefined` döner. Aramayı desteklemeyen sağlayıcıda tanımsız
   * kalır ve çağıran doğrudan göndermeye devam eder.
   */
  belgeAra?(cfg: EntegratorConfig, kaynakKayitId: string, tur: UblBelge["tur"]): Promise<GonderimSonuc | undefined>;

  /**
   * Gönderilmiş belgenin **resmî görünümü** (EBLG-75): alıcının portalda
   * gördüğü PDF'i sağlayıcıdan indirir. Belgeye görünüm gömmediğimiz için
   * (bkz. EBLG-31 kararı) tasarımı sağlayıcı yapar; kendi yedek görünümümüz
   * yalnız bu indirme başarısız olduğunda basılır. Uygulamayan sağlayıcıda
   * tanımsız kalır.
   */
  gidenBelgePdf?(cfg: EntegratorConfig, uuid: string, tur: UblBelge["tur"]): Promise<Buffer | null>;

  /** Zarf durumlarını toplu sorgular (EBLG-14); sağlayıcı sınırına adaptör uyar. */
  durumSorgulaToplu?(cfg: EntegratorConfig, belgeRefleri: string[]): Promise<BelgeDurumSonuc[]>;
  yanitGonder(
    cfg: EntegratorConfig,
    belgeRef: string,
    yanit: "kabul" | "ret",
    gerekce?: string,
    kaynak?: { gonderenVkn: string; xml: string },
  ): Promise<GonderimSonuc>;
  earsivIptal?(cfg: EntegratorConfig, girdi: EarsivIptalGirdi): Promise<BaglantiSonuc>;
  earsivRaporListele?(cfg: EntegratorConfig, baslangic: Date, bitis: Date): Promise<EarsivRapor[]>;
  earsivRaporDurum?(cfg: EntegratorConfig, uuid: string): Promise<BaglantiSonuc & { kod?: string }>;
  /**
   * Rapor bölümünün bildirilen tutarı, bölümün belge dökümünden. Yalnız
   * listede tutar vermeyen sağlayıcı (NES) uygular; liste tutar veriyorsa
   * (Sovos) tanımsız kalır.
   */
  earsivRaporTutari?(cfg: EntegratorConfig, uuid: string): Promise<EarsivRaporTutari>;
  irsaliyeGonder?(cfg: EntegratorConfig, belge: EirsaliyeBelge): Promise<GonderimSonuc>;
  /**
   * EBLG-161: giden e-İrsaliyeyi bizim UUID'mizle arar. Zaman aşımına düşen gönderim
   * entegratöre ulaşmış olabilir; yeniden denemeden önce sorulur. Yoksa `undefined`.
   */
  irsaliyeAra?(cfg: EntegratorConfig, uuid: string): Promise<GonderimSonuc | undefined>;
  /**
   * EBLG-36: alıcı irsaliyenin bir kısmını kabul edebilir (`kismi_kabul`).
   * Entegratöre ulaşılamazsa hata fırlatılmalıdır; `hata` durumu belgenin
   * kendisinin reddedildiği anlamına gelir ve son durumdur.
   */
  irsaliyeDurumSorgula?(
    cfg: EntegratorConfig,
    belgeRef: string,
  ): Promise<Omit<BelgeDurumSonuc, "durum"> & { durum: BelgeDurumSonuc["durum"] | "kismi_kabul" }>;
  /**
   * EBLG-106: entegratörün alıcı etiketini kabul etmeyip taslakta bıraktığı
   * irsaliyeye etiket verir ve taslağı gönderir (resmîleştirir). Hata
   * fırlatır; belge taslakta kalır, yeniden denenebilir.
   */
  irsaliyeTaslaginiGonder?(cfg: EntegratorConfig, belgeRef: string, aliciPostaKutusu: string): Promise<void>;
  /** EBLG-106: giden irsaliyenin entegratördeki işlem geçmişi, eskiden yeniye. */
  irsaliyeGecmisi?(cfg: EntegratorConfig, belgeRef: string): Promise<EntegratorGecmisKaydi[]>;
  /**
   * EBLG-106: alıcının entegratörün canlı sorgusundaki e-İrsaliye posta
   * kutuları; kayıtlı değilse boş dizi. Toplu liste ile ayrışabildiği için
   * taslak düzeltmede kutu bununla doğrulanır.
   */
  irsaliyePostaKutulariSorgula?(cfg: EntegratorConfig, vknTckn: string): Promise<string[]>;
  /**
   * `bilinenler`: elimizde olan belgelerin UUID'leri. Bunların XML'i yeniden
   * indirilmez; entegratör liste satırında karar veriyorsa belge `xml: ""` ile
   * yalnız karar için döner. Ortak test VKN'sinde günde yüzlerce belge düştüğü
   * için örtüşen pencere böylece ucuz kalır.
   */
  gelenIrsaliyeleriCek?(cfg: EntegratorConfig, sonrasi: Date, bilinenler?: ReadonlySet<string>): Promise<GelenEirsaliye[]>;
  /**
   * EBLG-34: gelen faturaya entegratörde verilmiş kabul/ret kararı; karar
   * yoksa `null`. Yanıt göndermeden önce sorulur — belge portalda ya da aynı
   * hesabı kullanan başka bir yerde yanıtlanmış olabilir.
   */
  gelenYanitDurumu?(cfg: EntegratorConfig, belgeRef: string): Promise<GelenYanit | null>;
  /** EBLG-34: gelen e-İrsaliyeye entegratörde verilmiş karar; yoksa `null`. */
  gelenIrsaliyeYanitDurumu?(cfg: EntegratorConfig, belgeRef: string): Promise<GelenYanit | null>;
  irsaliyeYanitiGonder?(cfg: EntegratorConfig, belgeRef: string, yanit: "kabul" | "ret", gerekce: string | undefined, kaynakXml: string): Promise<GonderimSonuc>;
}
