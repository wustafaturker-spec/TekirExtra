import type { BelgeDurum, EbelgeSaglayici } from "@tekirextra/shared";

/**
 * Entegratör erişim yapılandırması. Veritabanında AES-256-GCM ile şifreli
 * saklanır (EBLG-01b); bu tip yalnızca çözülmüş halin bellek-içi taşıyıcısıdır.
 * Loglara asla yazılmaz.
 */
export interface EntegratorConfig {
  saglayici: EbelgeSaglayici;
  kullaniciAdi: string;
  parola?: string;
  apiAnahtari?: string;
  servisAdresi?: string;
  /** Sovos e-Arşiv servisi e-Fatura servisinden ayrı bir WSDL adresidir. */
  earsivServisAdresi?: string;
  irsaliyeServisAdresi?: string;
  /** Entegratör servislerinde işlem yapan firmanın VKN/TCKN'si. */
  vknTckn?: string;
  /** Gönderici birim (GB) etiketi. */
  gondericiBirimEtiketi?: string;
  /** Posta kutusu (PK) etiketi; gelen belge ve yanıt akışında kullanılır. */
  postaKutusuEtiketi?: string;
  /**
   * Sağlayıcıda **otomatik numaralandırılan** serinin öneki (örn. `K07`).
   * Dolu olduğunda belge numarasını entegratör atar: UBL'e yalnız bu önek
   * yazılır, numara gönderim yanıtından okunur (EBLG-16). Boşsa numarayı
   * kendi seri/sayaç modülümüz üretir.
   */
  belgeSeriOneki?: string;
  /**
   * e-Arşiv serisinin öneki. GİB, e-Fatura ve e-Arşiv serilerinin **farklı**
   * olmasını zorunlu tutar; aynı önekle gönderilen e-Arşiv belgesi şematron
   * kontrolünde reddedilir (NES, 2026-09-10). Sağlayıcı numaralandırıyorsa
   * e-Arşiv kanalı bu öneki kullanır.
   */
  earsivSeriOneki?: string;
  /**
   * e-İrsaliye serisinin öneki. e-İrsaliye numarası **sevkten önce** gerekir —
   * kâğıt malla birlikte yola çıkar — bu yüzden numarayı fatura/e-Arşiv'in
   * aksine biz üretiriz ve sağlayıcıdaki serinin **elle numaralandırılan**
   * (NES'te `isPortal: false`) bir seri olması gerekir; otomatik seride
   * sağlayıcı tam numarayı reddeder.
   */
  eirsaliyeSeriOneki?: string;
  /**
   * e-İrsaliye **yanıt** serisinin öneki. Yanıt, irsaliyeden ayrı bir belgedir
   * ve sağlayıcıda ayrı seri ailesinde durur (NES'te `answerseries`; varsayılan
   * `YNT`). İrsaliyenin aksine numarayı sağlayıcı atar — yanıt kâğıtla yola
   * çıkmaz, elde numarası olmasını gerektiren bir sebep yok (EBLG-24).
   */
  eirsaliyeYanitSeriOneki?: string;
  /**
   * Bağlantı entegratörün **test ortamına** bakıyor. Test ortamlarında
   * entegratör sentetik firma kimlikleri verir (NES'in `1234567801`'i gibi)
   * ve bunlar VKN kontrol hanesini tutmaz; bayrak gönderen VKN doğrulamasını
   * gevşetir. NES'te gidilecek ortamı da belirler: adres bundan türetilir,
   * `servisAdresi` okunmaz (EBLG-01a).
   */
  testOrtami?: boolean;
}

export interface BaglantiSonuc {
  basarili: boolean;
  mesaj?: string;
}

export interface MukellefDurum {
  vknTckn: string;
  eFaturaMukellefi: boolean;
  /** Mükellefse GİB posta kutusu etiketi; birden çok adaydan seçilen. */
  postaKutusu?: string;
  /**
   * Alıcının GİB'de kayıtlı **tüm** posta kutusu etiketleri. Bir VKN'de onlarca
   * etiket olabilir ve hangisinin yürürlükte olduğu veriden kesin çıkarılamaz;
   * `postaKutusu` en iyi tahmindir, bu liste seçimi kullanıcıya sormak isteyen
   * çağıran içindir. Tek etiket varsa doldurulmaz.
   */
  postaKutulari?: string[];
}

/** ebelge modülünün ürettiği UBL-TR 1.2 belgesi — adaptör içeriğe dokunmaz (EBLG-03). */
export interface UblBelge {
  uuid: string;
  belgeNo: string;
  xml: string;
  tur: "efatura" | "earsiv";
  /** e-Fatura için alıcının GİB posta kutusu etiketi. */
  aliciPostaKutusu?: string;
}

export interface GonderimSonuc {
  basarili: boolean;
  /** Sağlayıcının belge takip referansı. */
  belgeRef?: string;
  /**
   * Sağlayıcının atadığı belge numarası; yalnızca otomatik numaralandıran
   * seride dolar (EBLG-16). Çağıran bunu faturanın numarası olarak kaydeder.
   */
  belgeNo?: string;
  hataMesaji?: string;
}

/**
 * Gönderim öncesi önizleme (L). Belge oluşturmaz, numara harcamaz; sağlayıcı
 * belgeyi şema ve şematron denetiminden geçirip alıcının göreceği görünümü
 * döndürür.
 */
export interface OnizlemeSonuc {
  basarili: boolean;
  /** Sağlayıcının çizdiği HTML görünüm; yalnız başarılı önizlemede. */
  html?: string;
  hataMesaji?: string;
}

export interface BelgeDurumSonuc {
  belgeRef: string;
  durum: BelgeDurum;
  detay?: string;
  /**
   * Belge GİB'e raporlanmış mı (yalnız e-Arşiv). Raporlanmış bir e-Arşiv
   * faturası artık uygulamadan iptal edilmez; iptal bildirimi ayrı yürür.
   */
  raporlandi?: boolean;
  /**
   * Belge sağlayıcıda iptal edilmiş mi (yalnız e-Arşiv). İptal isteği ikinci
   * kez geldiğinde hata değil "zaten iptal" demek için gerekir.
   */
  iptalEdilmis?: boolean;
}

/**
 * Gelen belgeye entegratörde verilmiş kabul/ret kararı (EBLG-34). Belge
 * portalda ya da aynı hesabı kullanan başka bir yerde yanıtlanmış olabilir.
 */
export interface GelenYanit {
  karar: "kabul" | "ret";
  /** Entegratörün sakladığı ret/kabul notu. */
  not?: string;
}

export interface GelenBelge {
  uuid: string;
  belgeNo: string;
  gonderenVkn: string;
  gonderenUnvan: string;
  tarih: Date;
  xml: string;
  /** Sağlayıcı bildiriyorsa entegratörde verilmiş karar. */
  yanit?: GelenYanit;
}

export interface EarsivIptalGirdi {
  faturaNo: string;
  toplamTutar: string;
  iptalTarihi: Date;
  sube?: string;
}

export interface EarsivRapor {
  uuid: string;
  donem: string;
  baslangic: string;
  bitis: string;
  faturaSayisi: number;
  /** Raporda bildirilen iptal sayısı; sağlayıcı vermiyorsa yok. */
  iptalSayisi?: number;
  /**
   * Sağlayıcının listede verdiği rapor toplamı. NES listede tutar döndürmez;
   * `null` "bilinmiyor" demektir, tutar rapor dökümünden ayrıca istenir
   * (`earsivRaporTutari`). "0" yazmak "sıfır lira bildirildi" diye okunuyordu.
   */
  toplamTutar: string | null;
  gibDurumu: string;
}

/** Bir rapor dökümünün para birimine göre toplamı. */
export interface EarsivRaporToplami {
  paraBirimi: string;
  tutar: string;
  belgeSayisi: number;
}

/** Rapor dökümünden hesaplanan tutarlar: bildirilen belgeler ve bildirilen iptaller ayrı. */
export interface EarsivRaporTutari {
  uuid: string;
  bildirilen: EarsivRaporToplami[];
  iptal: EarsivRaporToplami[];
}

export interface EirsaliyeBelge { uuid: string; belgeNo: string; xml: string; aliciPostaKutusu: string }
export interface GelenEirsaliye { uuid: string; belgeNo: string; gonderenVkn: string; gonderenUnvan: string; tarih: Date; xml: string; /** Sağlayıcı bildiriyorsa entegratörde verilmiş karar (EBLG-34). */ yanit?: GelenYanit }

/**
 * Entegratörden toplu indirilen GİB mükellef kaydı (EBLG-10). Bir VKN'nin
 * birden çok posta kutusu etiketi olabilir; liste her etiketi ayrı satır
 * olarak taşır, kanal kararını okuyan taraf verir.
 */
export interface MukellefKaydi {
  vknTckn: string;
  /**
   * e-Fatura ve e-İrsaliye kayıtları GİB'de ayrıdır: bir firma e-Fatura
   * mükellefi olup e-İrsaliye kullanmıyor olabilir. Tek indirme ikisini de
   * getirdiğinden tür kayıtta taşınır.
   */
  belgeTuru: "efatura" | "eirsaliye";
  postaKutusu: string;
  unvan?: string;
}

/** Gelen zarf çekiminin tarih penceresi; kursör bu aralığı belirler (EBLG-11). */
export interface ZarfAraligi {
  baslangic: Date;
  bitis: Date;
}

/**
 * Bize gelen uygulama yanıtı — *bizim kestiğimiz* faturaya alıcının verdiği
 * kabul/ret (EBLG-13). Gelen faturadan farklıdır: burada belge bizim, karar
 * karşı tarafındır.
 */
export interface GelenAliciYaniti {
  /** Yanıt belgesinin kendi UUID'si; mükerrer işlemeyi bu anahtar engeller. */
  uuid: string;
  /** Yanıtın atıf yaptığı faturanın UUID'si (varsa). */
  faturaUuid?: string;
  /** Yanıtın atıf yaptığı fatura numarası (varsa). */
  faturaNo?: string;
  yanit: "kabul" | "ret";
  gerekce?: string;
  tarih: Date;
}

/**
 * Zarf düzeyinde tek çağrıyla alınan gelen belge kümesi (EBLG-12). Fatura ve
 * uygulama yanıtı için ayrı ayrı liste çağrısı yapılmaz.
 */
export interface GelenZarfSonucu {
  belgeler: GelenBelge[];
  yanitlar: GelenAliciYaniti[];
}
