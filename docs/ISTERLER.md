# TekirExtra — Yazılım İster Dokümanı (SRS)

**Sürüm:** 0.5
**Tarih:** 2026-07-12
**Durum:** 2. aşama S-01 onayı alındı: TOTP (KLN-05) zorunluya çekildi, e-posta doğrulaması (KLN-09) eklendi

---

## 1. Giriş

### 1.1 Amaç
Bu doküman, KOBİ'lere yönelik web tabanlı ön muhasebe uygulaması **TekirExtra**'nın
ilk sürümünün (v1.0) fonksiyonel ve fonksiyonel olmayan isterlerini tanımlar.

### 1.2 Kapsam
TekirExtra v1.0 aşağıdaki modülleri kapsar:

- Cari hesap takibi
- Fatura yönetimi (alış/satış) ve e-Fatura / e-Arşiv (GİB) entegrasyonu
- Stok takibi
- Kasa ve banka yönetimi
- Kullanıcı ve yetki yönetimi
- Raporlama

**Kapsam dışı (v1.0):** Resmi defter (genel muhasebe/yevmiye), bordro/personel,
e-İrsaliye, e-Defter, üretim/reçete takibi, mobil uygulama.

**v1.0 sonrası, mimaride hazırlanacak (bkz. §3.9):** Pazaryeri entegrasyonları
(Trendyol, Hepsiburada, N11, Amazon TR), kredi kartı ile tahsilat (sanal POS)
ve banka entegrasyonları (hareket çekme, eşleştirme, ödeme talimatı).

### 1.3 Hedef Kitle
- Birincil: 2–50 çalışanlı KOBİ'lerin ön muhasebe personeli ve işletme sahipleri
- İkincil: İşletmenin mali müşaviri (raporlara salt-okunur erişim)

### 1.4 Tanımlar
| Terim | Açıklama |
|---|---|
| Cari | Müşteri, tedarikçi veya her iki rolü taşıyan hesap |
| e-Fatura | GİB kayıtlı mükellefler arası elektronik fatura (UBL-TR) |
| e-Arşiv | e-Fatura mükellefi olmayan alıcılara kesilen elektronik fatura |
| Özel entegratör | GİB ile e-belge trafiğini sağlayan aracı servis sağlayıcı |
| KDV | Katma Değer Vergisi |

---

## 2. Genel Tanım

### 2.1 Ürün Perspektifi
TekirExtra, tarayıcı üzerinden erişilen, çok kiracılı (multi-tenant) bir
SaaS uygulamasıdır. Her firma (kiracı) sisteme bağımsız kaydolur; verileri
diğer firmalardan yalıtılmıştır. e-Belge gönderimi özel entegratörler
üzerinden yapılır ve **her firma kendi entegratörünü bağımsız seçer**:
örneğin A firması Foriba ile çalışırken B firması İzibiz kullanabilir.
Firma, entegratör erişim bilgilerini girerek bağlantıyı kendisi kurar.

### 2.2 Kullanıcı Rolleri
| Rol | Yetkiler |
|---|---|
| Yönetici | Tüm modüller + kullanıcı/yetki yönetimi + firma ayarları |
| Muhasebe | Tüm operasyonel modüller (fatura, cari, kasa/banka, stok) |
| Satış | Satış faturası ve cari görüntüleme; kasa/banka erişimi yok |
| Salt-okunur | Tüm raporları görüntüler, hiçbir kayıt oluşturamaz/değiştiremez |

---

## 3. Fonksiyonel İsterler

Öncelik: **[Z]** Zorunlu (v1.0'da olmalı) · **[İ]** İstenen (v1.0'a sığarsa) · **[G]** Gelecek sürüm

### 3.1 Cari Hesap Takibi (CARI)

| No | İster | Öncelik |
|---|---|---|
| CARI-01 | Sistem; müşteri, tedarikçi veya her ikisi tipinde cari kartı oluşturabilmelidir (unvan, VKN/TCKN, vergi dairesi, adres, iletişim, IBAN). | Z |
| CARI-02 | Cari kartında e-Fatura mükellefiyet durumu tutulmalı ve entegratör üzerinden sorgulanabilmelidir. | Z |
| CARI-03 | Her cari için borç/alacak bakiyesi anlık izlenebilmelidir. | Z |
| CARI-04 | Tarih aralığı seçilerek cari hesap ekstresi alınabilmeli, PDF/Excel dışa aktarılabilmelidir. | Z |
| CARI-05 | Carilere döviz cinsi tanımlanabilmeli (TRY, USD, EUR); bakiye hem döviz hem TRY karşılığı izlenebilmelidir. | İ |
| CARI-06 | Vadesi geçen bakiyeler için yaşlandırma raporu (0-30-60-90+ gün) alınabilmelidir. | İ |
| CARI-07 | Cari kartları Excel'den toplu içe aktarılabilmelidir. | İ |
| CARI-08 | Cari için risk limiti tanımlanabilmeli, limit aşımında fatura kesiminde uyarı verilmelidir. | İ |
| CARI-09 | Cari kartında birden çok adres (fatura/sevk) ve ilgili kişi (ad, telefon, e-posta) tutulabilmelidir. | Z |
| CARI-10 | Cari bazında özel satış koşulları tanımlanabilmelidir: özel fiyat listesi, varsayılan iskonto oranı, varsayılan vade (gün). | İ |
| CARI-11 | Cariler kategori/etiketlerle gruplanabilmeli (ör. bayi, perakende, VIP); listeler ve raporlar bu kırılımla filtrelenebilmelidir. | İ |
| CARI-12 | **Modül içi raporlar:** ekstre, yaşlandırma, cari bazlı satış/alış özeti, tahsilat performansı (ortalama tahsilat süresi), en yüksek bakiyeli cariler. Tümü RPR-06 rapor araç setini kullanır. | Z |

### 3.2 Fatura Yönetimi (FTR)

| No | İster | Öncelik |
|---|---|---|
| FTR-01 | Satış faturası oluşturulabilmelidir: cari seçimi, kalem satırları (stok/hizmet), miktar, birim fiyat, iskonto (satır ve genel), KDV oranı (%0, %1, %10, %20). | Z |
| FTR-02 | Alış faturası girilebilmeli; girişte ilgili stok miktarları otomatik artmalıdır. | Z |
| FTR-03 | Satış faturası kesildiğinde stok miktarları otomatik azalmalı, cari bakiye borçlandırılmalıdır. | Z |
| FTR-04 | Fatura satırlarında KDV, iskonto ve genel toplam otomatik hesaplanmalı; kuruş yuvarlaması mevzuata uygun yapılmalıdır. | Z |
| FTR-05 | Fatura taslak olarak kaydedilebilmeli, kesinleştirilmeden düzenlenebilmelidir. Kesinleşen fatura değiştirilemez; iptal/iade süreci işletilir. | Z |
| FTR-06 | Faturalar numaralandırma serisiyle (ör. TKR2026...) otomatik ve kesintisiz numaralanmalıdır. | Z |
| FTR-07 | Fatura PDF çıktısı üretilebilmeli, e-posta ile gönderilebilmelidir. | Z |
| FTR-08 | İade faturası (alış/satış) düzenlenebilmeli, stok ve cari hareketleri ters yönde işlenmelidir. | Z |
| FTR-09 | Proforma fatura oluşturulabilmeli ve tek tıkla satış faturasına dönüştürülebilmelidir. | İ |
| FTR-10 | Tekrarlayan (abonelik tipi) faturalar tanımlanabilmelidir. | G |
| FTR-11 | Tevkifatlı ve istisnalı fatura senaryoları desteklenmelidir. | İ |
| FTR-12 | Belge zinciri desteklenmelidir: teklif → sipariş → irsaliye → fatura; her adım bir sonrakine tek tıkla dönüştürülebilmeli, zincir izlenebilmelidir (e-İrsaliye kapsam dışı; kağıt/PDF irsaliye). | İ |
| FTR-13 | Bekleyen siparişler/irsaliyeler toplu seçilip tek faturada birleştirilebilmelidir (toplu faturalama). | İ |
| FTR-14 | Fatura kaleminde carinin fiyat listesi ve özel iskontosu otomatik önerilmeli (CARI-10, STK-11); satıcı kullanıcı bazında maksimum iskonto yetkisi tanımlanabilmelidir. | İ |
| FTR-15 | **Modül içi raporlar:** dönemsel satış/alış özeti, kâr marjı analizi (satış - ağırlıklı ortalama maliyet), iskonto analizi, KDV dökümü, iade oranları, taslakta bekleyen belgeler. Tümü RPR-06 rapor araç setini kullanır. | Z |

### 3.3 e-Fatura / e-Arşiv Entegrasyonu (EBLG)

| No | İster | Öncelik |
|---|---|---|
| EBLG-01 | Entegratör katmanı adaptör mimarisiyle soyutlanmalıdır: her firma, desteklenen entegratörlerden (Foriba, İzibiz, eLogo, Uyumsoft vb.) dilediğini bağımsız seçebilmelidir. Yeni bir entegratör, çekirdek kod değişmeden adaptör eklenerek desteklenebilmelidir. | Z |
| EBLG-01a | Firma yöneticisi, entegratör erişim bilgilerini (kullanıcı adı, parola/API anahtarı, servis adresi) arayüzden girebilmeli ve "bağlantı testi" ile doğrulayabilmelidir. | Z |
| EBLG-01b | Entegratör erişim bilgileri veritabanında şifrelenerek (at-rest encryption) saklanmalı, arayüzde ve loglarda asla açık gösterilmemelidir. | Z |
| EBLG-02 | Fatura kesinleştirilirken alıcının e-Fatura mükellefiyeti otomatik sorgulanmalı; mükellefse e-Fatura, değilse e-Arşiv olarak gönderilmelidir. | Z |
| EBLG-03 | Giden e-belgeler UBL-TR 1.2 standardına uygun üretilmelidir. | Z |
| EBLG-04 | Gönderilen belgelerin durumu (kuyrukta, iletildi, kabul, ret, hata) izlenmeli ve arayüzde gösterilmelidir. | Z |
| EBLG-05 | Gelen e-Faturalar entegratörden çekilebilmeli; kullanıcı onayıyla alış faturası olarak sisteme işlenebilmelidir. | Z |
| EBLG-06 | Ticari e-Faturalarda kabul/ret yanıtı gönderilebilmelidir. | Z |
| EBLG-07 | e-Arşiv faturaları için GİB'e günlük raporlama entegratör üzerinden otomatik yürütülmelidir. | Z |
| EBLG-08 | Gönderim hatalarında belge "hata" durumuna düşmeli, kullanıcı düzeltip yeniden gönderebilmelidir; otomatik yeniden deneme uygulanmalıdır. | Z |
| EBLG-09 | e-belge XML ve PDF görüntüleri arşivlenmeli, mevzuat gereği en az 10 yıl saklanabilir yapıda tutulmalıdır. | Z |

### 3.4 Stok Takibi (STK)

| No | İster | Öncelik |
|---|---|---|
| STK-01 | Ürün/hizmet kartı oluşturulabilmelidir: kod, ad, birim, barkod, KDV oranı, alış/satış fiyatı, kategori. | Z |
| STK-02 | Stok hareketleri (alış, satış, iade, sayım düzeltme) kalem bazında izlenebilmelidir. | Z |
| STK-03 | Anlık stok miktarı ve stok değeri raporlanabilmelidir. | Z |
| STK-04 | Kritik stok seviyesi tanımlanabilmeli, altına düşünce panelde uyarı gösterilmelidir. | Z |
| STK-05 | Ürünler Excel'den toplu içe aktarılabilmelidir. | İ |
| STK-06 | Stok sayımı (fiili envanter) girilebilmeli, farklar düzeltme hareketi olarak işlenmelidir. | İ |
| STK-07 | Çoklu depo desteği sağlanmalıdır. | G |
| STK-08 | Maliyetlendirme ilk sürümde ağırlıklı ortalama yöntemiyle yapılmalıdır. | İ |
| STK-09 | Ürünler hiyerarşik kategori ağacıyla sınıflandırılabilmeli; ürün görseli eklenebilmelidir. | İ |
| STK-10 | Çoklu birim desteği: ürün için ana birim + çevrim katsayılı ek birimler (ör. adet/koli/palet); alış-satış farklı birimle yapılabilmelidir. | İ |
| STK-11 | Çoklu fiyat listesi tanımlanabilmelidir (ör. perakende, bayi, ihracat); fatura kesilirken carinin fiyat listesi otomatik uygulanmalıdır (CARI-10 ile birlikte). | İ |
| STK-12 | Ürün varyantları (renk/beden gibi nitelik kombinasyonları) tanımlanabilmeli, stok varyant bazında izlenebilmelidir. | G |
| STK-13 | **Modül içi raporlar:** envanter değeri, stok hareket özeti, en çok/en az satanlar, stok devir hızı, ürün bazlı kârlılık (ağırlıklı ortalama maliyete göre), kritik stok listesi. Tümü RPR-06 rapor araç setini kullanır. | Z |

### 3.5 Kasa ve Banka (KSB)

| No | İster | Öncelik |
|---|---|---|
| KSB-01 | Birden fazla kasa ve banka hesabı tanımlanabilmelidir (TRY ve döviz). | Z |
| KSB-02 | Tahsilat ve ödeme (tediye) fişleri kesilebilmeli, ilgili cari bakiyesine yansımalıdır. | Z |
| KSB-03 | Kasalar/hesaplar arası virman yapılabilmelidir. | Z |
| KSB-04 | Kasa ve banka hesap hareketleri tarih aralığıyla listelenebilmeli, anlık bakiye görülebilmelidir. | Z |
| KSB-05 | Çek ve senet takibi yapılabilmelidir: portföy, ciro, tahsil, karşılıksız durumları. | İ |
| KSB-06 | Banka ekstresi (CSV/OFX) içe aktarılıp hareketlerle eşleştirilebilmelidir (otomatik banka bağlantısı için bkz. ENT-06). | G |
| KSB-07 | Fatura üzerinden doğrudan tahsilat/ödeme kaydı oluşturulabilmelidir (kapama). | Z |

### 3.6 Raporlama (RPR)

| No | İster | Öncelik |
|---|---|---|
| RPR-01 | Ana panelde özet göstergeler sunulmalıdır: aylık satış/alış, tahsilat/ödeme, vadesi gelen alacak/borç, kritik stok. | Z |
| RPR-02 | KDV özet raporu (hesaplanan/indirilecek) dönem bazında alınabilmelidir. | Z |
| RPR-03 | Satış raporları: cari, ürün, dönem kırılımında. | Z |
| RPR-04 | Tüm raporlar PDF ve Excel olarak dışa aktarılabilmelidir. | Z |
| RPR-05 | Kâr/zarar özeti (basit gelir-gider farkı) raporlanabilmelidir. | İ |
| RPR-06 | **Ortak rapor araç seti:** Her modülün kendi "Raporlar" sekmesi olmalıdır (CARI-12, STK-13, FTR-15). Tüm raporlar ortak yetenek setini sunar: tarih aralığı + modüle özgü filtreler, gruplama/kırılım, sıralama, PDF/Excel dışa aktarım (RPR-04), kayıtlı rapor görünümleri (filtre setini adlandırıp saklama). | Z |
| RPR-07 | **Gömülü analitik (Metabase):** Sistem, Metabase ile gömülü analiz panoları sunmalıdır. Hazır panolar (satış trendi, nakit akış, cari risk, stok analizi) uygulama içinde gösterilir; kiracı yalıtımı imzalı gömme parametresiyle (kilitli tenant_id) garanti edilir. Operasyonel/mali belgeler (ekstre, KDV özeti gibi) Metabase'e değil, yerli rapor araç setine (RPR-06) aittir. | İ |

### 3.7 Kullanıcı ve Firma Yönetimi (KLN)

| No | İster | Öncelik |
|---|---|---|
| KLN-01 | E-posta + parola ile oturum açılmalı; parola politikası uygulanmalıdır (asgari uzunluk, karmaşıklık). | Z |
| KLN-02 | Bölüm 2.2'deki roller atanabilmeli; yetkisiz modüller arayüzde ve API'de erişime kapalı olmalıdır. | Z |
| KLN-03 | Firma bilgileri (unvan, VKN, vergi dairesi, logo, e-imza/mali mühür entegratör bilgileri) yönetilebilmelidir. | Z |
| KLN-04 | Tüm kritik işlemler (fatura kesme/iptal, kayıt silme, yetki değişikliği) denetim izine (audit log) yazılmalıdır: kim, ne zaman, ne yaptı. | Z |
| KLN-05 | İki adımlı doğrulama (TOTP) desteklenmelidir. | Z |
| KLN-09 | Firma kaydında e-posta doğrulaması yapılmalıdır: kayıtta doğrulama linki gönderilir, link tıklanmadan oturum açılamaz. | Z |
| KLN-06 | Sistem çok kiracılı (multi-tenant) çalışmalıdır: her firma bağımsız kaydolur, firmalar arası veri yalıtımı hem uygulama hem veri katmanında garanti edilmelidir. | Z |
| KLN-07 | Firma kaydı (onboarding) self-servis olmalıdır: firma bilgileri, ilk yönetici kullanıcı ve entegratör bağlantısı sihirbazla kurulabilmelidir. | Z |
| KLN-08 | Firma hesabı modeli, ileride abonelik planı/faturalandırma bilgisi taşıyacak şekilde genişletilebilir olmalıdır; v1.0'da fiyatlandırma uygulanmaz. | G |

### 3.8 Ayarlar ve Kayıt İşlem Kuralları (AYR)

| No | İster | Öncelik |
|---|---|---|
| AYR-01 | Her modülün **kendi ayarlar sayfası** olmalıdır; modüle özgü tüm parametreler orada yönetilir. Örnekler — Fatura: seri tanımları, varsayılan KDV oranı, fatura şablonu; Cari: varsayılan vade, döviz; Stok: varsayılan birim, kritik seviye politikası; Kasa/Banka: varsayılan kasa, fiş numaralandırma. | Z |
| AYR-02 | **Sistem ayarları** altında yalnızca modüller-üstü (global) ayarlar bulunmalıdır: firma bilgileri, kullanıcı/rol yönetimi, entegrasyon bağlantıları, güvenlik politikaları, mevzuat parametreleri (KDV oranları — V-02). Modüle özgü hiçbir ayar sistem ayarlarına konmaz. | Z |
| AYR-03 | Yeni bir modül ayarı, ortak ayar altyapısı üzerinden tanımlanabilmelidir (şema + doğrulama + arayüz); her modül için sıfırdan ayar sayfası kodlanmaz. | Z |
| AYR-04 | Her işlem sayfasında (fatura, cari, stok, fiş vb.) kayıt üzerinde **silme, değiştirme, kopyalama, iptal** gibi eylemler ortak bir **kural altyapısına** bağlı olmalıdır: eylemin görünürlüğü/izni; kaydın durumu (ör. taslak/kesin), kullanıcının rolü ve bağlı kayıtları (ör. hareketi olan cari) birlikte değerlendirilerek belirlenir. | Z |
| AYR-05 | Kural örnekleri (varsayılan set): kesinleşmiş fatura değiştirilemez/silinemez ama **kopyalanabilir** ve iptal edilebilir; hareketi olan cari/stok kartı silinemez (pasife alınır); taslak kayıtlar serbestçe düzenlenir/silinir. | Z |
| AYR-06 | İzin verilen eylemler API yanıtında kayıtla birlikte dönmelidir; arayüz düğmeleri buna göre çizer, asıl denetim sunucudadır. | Z |
| AYR-07 | Kopyalama eylemi: mevcut kayıttan yeni taslak üretir (ör. faturayı kopyala → yeni taslak fatura, yeni tarih/numara ile). | Z |

### 3.9 Entegrasyon Aileleri — Pazaryeri, Sanal POS, Banka (ENT)

Bu bölümdeki isterler **v1.0'da uygulanmaz**; ancak veri modeli ve adaptör
mimarisi bu ailelere baştan hazır tasarlanır (bkz. MIMARI.md). Tümü **[G]**
önceliklidir; ENT-01 hariç.

| No | İster | Öncelik |
|---|---|---|
| ENT-01 | Tüm dış bağlantılar (e-belge, pazaryeri, POS, banka) **ortak bağlantı modeli** üzerinden yönetilmelidir: firma, sağlayıcıyı seçer, erişim bilgilerini girer, bağlantıyı test eder (EBLG-01a/01b desenine uygun). Mimari v1.0'da bu genel modeli kurar. | Z |
| ENT-02 | Pazaryeri entegrasyonu: Trendyol, Hepsiburada, N11 ve Amazon TR'den siparişler otomatik çekilebilmeli, tek tıkla/toplu faturalaştırılabilmelidir. | G |
| ENT-03 | Pazaryeri stok/fiyat senkronizasyonu: TekirExtra'daki stok miktarı ve fiyat, bağlı pazaryerlerine gönderilebilmelidir. | G |
| ENT-04 | Sanal POS ile kredi kartı tahsilatı yapılabilmelidir: hem ödeme kuruluşları (iyzico, PayTR vb.) hem doğrudan banka sanal POS'ları adaptör olarak desteklenebilmelidir. Tahsilat, cari bakiyeye ve kasa/banka hesabına otomatik işlenir. | G |
| ENT-05 | Cariye e-posta/SMS ile **ödeme linki** gönderilebilmeli; link üzerinden yapılan kart tahsilatı ilgili faturayı/bakiyeyi kapatmalıdır. | G |
| ENT-06 | Banka entegrasyonu: hesap hareketleri otomatik çekilmeli, gelen/giden tutarlar cari ve faturalarla eşleştirilebilmelidir (önerili otomatik eşleştirme + kullanıcı onayı). | G |
| ENT-07 | Banka entegrasyonu üzerinden ödeme talimatı (EFT/havale) oluşturulabilmelidir; talimat gönderimi çift onay (oluşturan ≠ onaylayan) ve zorunlu TOTP ile korunmalıdır. | G |
| ENT-08 | Pazaryeri komisyon/kesinti kayıtları gider olarak işlenebilmelidir. | G |

---

## 4. Fonksiyonel Olmayan İsterler

### 4.1 Performans
- **NFR-01:** Sayfa yüklenme süresi normal yükte 2 saniyeyi aşmamalıdır.
- **NFR-02:** Sistem 50 eşzamanlı kullanıcıyı performans kaybı olmadan desteklemelidir.
- **NFR-03:** 100.000 fatura ve 500.000 stok hareketi içeren veri setinde listeleme/raporlama 5 saniye altında tamamlanmalıdır.

### 4.2 Güvenlik
- **NFR-04:** Tüm trafik TLS ile şifrelenmelidir; parolalar geri döndürülemez algoritmayla (bcrypt/argon2) saklanmalıdır.
- **NFR-05:** KVKK yükümlülükleri karşılanmalıdır: kişisel verilerin envanteri, silme/anonimleştirme yeteneği.
- **NFR-06:** Oturumlar makul sürede zaman aşımına uğramalı; API erişimi token tabanlı ve yetki denetimli olmalıdır.
- **NFR-07:** OWASP Top 10 açıklarına karşı önlem alınmalıdır (girdi doğrulama, CSRF, XSS, SQL enjeksiyonu).

### 4.3 Veri Bütünlüğü ve Yedekleme
- **NFR-08:** Mali kayıtlar (kesinleşmiş fatura, kasa/banka fişi) hiçbir koşulda fiziksel silinmemeli; iptal/ters kayıt ile yönetilmelidir.
- **NFR-09:** Veritabanı günlük otomatik yedeklenmeli, yedekten dönüş prosedürü belgelenmelidir.
- **NFR-10:** Parasal tutarlar kayan nokta yerine tam sayı/decimal tipte saklanmalıdır.

### 4.4 Kullanılabilirlik
- **NFR-11:** Arayüz Türkçe olmalıdır; metinler i18n altyapısıyla yönetilmeli, ileride ek dil eklenebilmelidir.
- **NFR-12:** Uygulama güncel Chrome, Firefox, Edge ve Safari sürümlerinde çalışmalıdır; temel akışlar tablet ekranında kullanılabilir olmalıdır.
- **NFR-13:** Fatura kesme akışı, deneyimli kullanıcı için klavye ile 1 dakikanın altında tamamlanabilmelidir.

### 4.5 İşletim
- **NFR-14:** Uygulama konteyner (Docker) olarak paketlenebilmeli, tek komutla ayağa kaldırılabilmelidir.
- **NFR-15:** Hedef çalışma süresi %99,5; planlı bakım pencereleri kullanıcılara önceden duyurulmalıdır.
- **NFR-16:** Uygulama ve e-belge trafiği için yapılandırılmış log tutulmalıdır.

---

## 5. Kısıtlar ve Varsayımlar

- **S-01 (Süreç kuralı):** Her modülün geliştirilmesine **başlanmadan önce**, o modülün ister bölümü ürün sahibiyle birlikte gözden geçirilir ve son hali onaylanır. Değişen kararlar bu kapıda dokümana işlenir; onaysız modül geliştirmesine başlanmaz.
- **K-01:** e-Belge gönderimi yalnızca özel entegratörler üzerinden yapılır; doğrudan GİB portal entegrasyonu kapsam dışıdır. Entegratör sözleşmesi firma ile entegratör arasındadır; TekirExtra yalnızca teknik bağlantıyı sağlar.
- **K-02:** Mevzuat referansı Türkiye'dir: VUK, KDV mevzuatı, e-Fatura/e-Arşiv tebliğleri (UBL-TR 1.2).
- **K-03:** Sistem çok kiracılıdır; firma başına tek şube ve tek depo varsayımıyla başlanır, mimari çoklu şube/depoya engel olmamalıdır.
- **V-01:** Firmanın e-Fatura mükellefiyet başvurusu ve entegratör sözleşmesi uygulama dışında tamamlanmış kabul edilir; firma yalnızca erişim bilgilerini girer.
- **V-02:** KDV oranları ve mevzuat parametreleri değişebilir; sistemde sabit kodlanmayıp yönetilebilir parametre olarak tutulmalıdır.

---

## 6. Kabul Ölçütleri (Özet)

v1.0 aşağıdaki uçtan uca senaryolar hatasız çalıştığında kabul edilir:

1. Cari kartı aç → stoklu satış faturası kes → e-Fatura/e-Arşiv otomatik yönlendirilsin ve entegratörden "iletildi" durumu görülsün → stok düşsün → cari borçlansın → tahsilat gir → bakiye kapansın.
2. Gelen e-Fatura entegratörden çekilsin → alış faturası olarak işlensin → stok artsın → ödeme girilsin.
3. İade faturası ile stok ve cari hareketler ters yönde doğru işlensin.
4. Dönem sonunda KDV özeti, cari ekstre ve stok raporu PDF/Excel alınabilsin.
5. Satış rolündeki kullanıcı kasa/banka modülüne erişememeli; tüm kritik işlemler denetim izinde görünmelidir.
6. İki ayrı firma sisteme kaydolsun, farklı entegratörler bağlasın (ör. A firması Foriba, B firması İzibiz); her ikisi de kendi entegratörü üzerinden e-belge gönderebilsin ve hiçbir koşulda birbirinin verisini görememelidir.

---

## 7. Açık Konular

| No | Konu | Durum |
|---|---|---|
| A-01 | v1.0 entegratör adaptörleri | **Karar verildi:** İzibiz, Foriba (SAP), eLogo, Uyumsoft — dördü de v1.0'da (2026-07-12) |
| A-02 | Teknoloji yığını seçimi | **Karar verildi:** TypeScript + NestJS / React + Next.js / PostgreSQL (bkz. Bölüm 8) (2026-07-12) |
| A-03 | Dağıtım modeli | **Karar verildi:** SaaS, çok kiracılı; her firma entegratörünü bağımsız seçer (2026-07-12) |
| A-04 | Fiyatlandırma/lisanslama modeli | **Ertelendi:** Pazara çıkmadan önce karar verilecek. Mimari, abonelik/faturalandırma altyapısı eklenmesine engel olmamalıdır (bkz. KLN-08). (2026-07-12) |
| A-05 | Gömülü analitik aracı | **Karar verildi:** Metabase (AGPL, ayrı servis olarak). Ücretsiz OSS sürümle başlanır; gelişmiş white-label/interaktif gömme gerekirse Pro lisansı değerlendirilir (bkz. MIMARI §10). (2026-07-12) |

---

## 8. Teknoloji Yığını (A-02 Kararı)

| Katman | Teknoloji | Gerekçe (özet) |
|---|---|---|
| Backend | TypeScript + NestJS | Frontend ile tek dil; modül + DI yapısı entegratör adaptör desenine (EBLG-01) birebir uyum |
| Frontend | React + Next.js | Tablo/form ağırlıklı muhasebe arayüzü için en olgun bileşen ekosistemi |
| Veritabanı | PostgreSQL | `NUMERIC` para tipleri (NFR-10); Row-Level Security ile kiracı yalıtımı veritabanı seviyesinde (KLN-06) |
| ORM | Prisma veya TypeORM | Şema geçişleri ve tip güvenliği; kesin seçim mimari tasarımda yapılacak |
| Kuyruk | Redis + BullMQ | Asenkron e-belge gönderimi, durum takibi ve otomatik yeniden deneme (EBLG-04, EBLG-08) |
| Paketleme | Docker / Docker Compose | NFR-14 gereği tek komutla ayağa kalkma |

Karar tarihi: 2026-07-12. Alternatif olarak değerlendirilen .NET 8, tek-dil
avantajının kaybı nedeniyle ikinci sırada bırakılmıştır.
