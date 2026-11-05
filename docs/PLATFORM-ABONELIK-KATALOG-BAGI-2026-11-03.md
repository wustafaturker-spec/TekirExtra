# Aboneliklerin katalog sürümüne bağlanması

PK-09'un bilinen eski planları koruyarak bağlama bölümü ve PK-02 tüketici bağlantısı. Bu teslim kaynak koddadır; mevcut yerel veritabanına migration veya çalışan uygulamaya yayın yapılmadı.

## Koşulların kaynağı

`TenantAbonelik.paketSurumId`, mevcut planın ilk katalog sürümüne bağlanır. `paketKosullari` aynı satırda şema sürümü, `eski_plan_gecisi` kaynağı, kanonik plan kodu/adı, dört kullanım limiti ve eski dönem fiyatlarını taşır. Kaynak sürümün tanımı ile korunmuş ticari koşullar ayrı gösterilir: ilk katalog sürümünün boş fiyatı geriye dönük doldurulmaz ve sonradan yayınlanan fiyat seçilmez.

Başlangıç 399, Profesyonel 999 TRY KDV hariç aylık eski bedellerle; 1/3/6/12 aylık dönem toplamları ve mevcut KDV oranıyla bağlanır. Kurumsal teklif fiyatını ve null/sınırsız limitlerini korur. Eski v1 kodu veritabanında v1 kalır ve Profesyonel kaynak sürümüne bağlanır. Bilinmeyen planın kodu değişmez, sürüm/koşul alanları null kalır; otomatik fiyat üretilmez. Abonelik satırı olmayan firmaya bu migration yeni satır açmaz.

Migration `20261104050000_abonelik_katalog_bagi` yalnız yeni sütunları doldurur. Mevcut plan kodu, abonelik durumu, dönem başlangıcı/sonu, iptal tarihi, meta ve güncellenme tarihi korunur. Yeni bağ büyüme yaşam olayı üretmez. Bağlanan ilk sürüm arşivlense de mevcut sözleşme geçerlidir; kullanılan sürüm fiziksel silinemez.

## Yazma ve okuma kuralları

DB trigger'ı yeni bilinen aboneliğe bağı aynı transaction içinde ekler. v1 varsayılanıyla açılan abonelik de bu yoldan geçer. Mevcut platform plan değiştirme/onay işlemi plan kodunu değiştirdiğinde yeni planın korunmuş eski koşulları seçilir; durum veya iletişim güncellemesi bağı değiştirmez. Aynı planın bağı/koşulları doğrudan düzenlenemez veya kaldırılamaz. Hatalı ya da yarım bağ kabul edilmez. Yeni katalog fiyatını mevcut aboneye atayan bir uç eklenmedi.

Uygulama rolü katalog tablolarına okuma yetkisi kazanmaz. Kiracı kendi aboneliğindeki sürüm referansını ve korunmuş koşulları mevcut RLS içinde okur. İç eşleme işlevi dışarıya açılmaz. `AbonelikService` özet/limit doğrulaması, panel/e-posta ödeme seçenekleri, girişim açma ve dolayısıyla otomatik yenileme bu kaynaktan beslenir. Bozuk bağda eski sabite sessizce dönülmez. Eski uygulama/test istemcisindeki iki null/eksik alan için mevcut davranış korunur.

Yeni bağlı ödemelerin fotoğrafı şema 2, kaynak `eski_plan_gecisi` ve `paketSurumId` içerir. Kaydedilmiş matrah/KDV/toplam ve gerçek oran birlikte taşınır; başarılı ödeme ve fatura aynı fotoğrafı kullanır. Şema 1 `eski_sabit` ve fotoğrafsız geçmiş uyumluluğu devam eder. DB fotoğraf doğrulaması iki şemayı da kabul eder ve değişmezlik kuralını korur.

Yaklaşan yenilemeler işlevi aboneliğin bağını/koşullarını aynı SELECT'te döndürür; rapor kartın dönemi için aynı tutar hesabını kullanır. Fiyatlı paketlerin tahsilat hatırlatma uygunluğu korunur; hatırlatma bağlantısının açtığı sayfa ve ödeme girişimi bağlı koşulları okur.

## Yönetim raporu

`GET /platform/paketler/gecis-durumu?sayfa=...` ve `/platform/paketler/gecis`, yalnız yöneticiye açıktır. Paket kataloğundan rapora geçilir. Toplam abonelik, bağlı kayıt ve bilinmeyen plan sayıları görünür. Bilinmeyenler önce; unvan ve kiracı kimliğiyle kararlı 25'lik sayfalama uygulanır. Boş ileri sayfada toplam korunur.

Rapor bilinen eski sabit kaynağı kayıtlı koşulla karşılaştırır; dört dönemin matrah/KDV/toplamı ve dört limit için eşitlik üretir. Kurumsalın iki taraftaki fiyatsızlığı eşitliktir; bilinmeyen planın sonucu null/inceleme bekliyor kalır. Dönem seçimi ve sayfa URL'de korunur. Bu rapor eski dönem geçmişini yeniden oluşturmaz; dönem/durum alanlarının korunması migration öncesi/sonrası provasında doğrulanır.

## Doğrulama

İlgili yedi dosyada 89 birim testi geçti. API ve web TypeScript (sırasıyla 4/3 GB heap), değişen kaynakların ESLint ve diff boşluk kontrolü temiz. İzole runner'ın `--abonelik-gecis` seçeneği önce eski migration'ları uygular, dört bilinen kod ve bir bilinmeyen kod için farklı durum/dönem/metalı abonelikler açar ve tam satırlarını saklar. Yeni migration'dan sonra yalnız yeni iki sütunun değiştiğini, dört bağın oluştuğunu, bilinmeyenin bağlanmadığını ve yaşam olayı sayısının değişmediğini SQL ile doğruladı. Dört dönem için fiyatlı tüm örneklerin kayıt adedi, matrah ve KDV toplamları da aynı kaldı. Yeni SQL'deki plan değişkeniyle sütun adının çakışması düzeltilmiştir.

Birleşik PostgreSQL koşusunda 49 senaryonun davranış kontrolleri geçti; yeni dosyanın temizliği kullanıcı-kiracı FK'sı nedeniyle hata verdi. Kullanıcılar önce silinecek şekilde düzeltildi. Ardından yeni geçici DB'de migration öncesi/sonrası ve dönem toplamları provası ile dokuz yeni bağ kabul testi temiz olarak yeniden geçti; DB kaldırıldı. Yeni senaryolar sürüm/koşul bağı, v1, bilinmeyen plan, doğrudan DB koruması/RLS, varsayılan kayıt, plan değişimi, katalog fiyat yayınının eski aboneyi etkilememesi, yenileme/panel/girişim eşitliği, limit uygulaması ve yönetim raporunu kapsar.

Tarayıcı ilk koşusunda dokuz senaryo geçti; yeni karşılaştırma sayfasının soğuk derlemesi sırasında 90 saniyelik toplam test süresi doldu. Next trace'inde sayfa derlemesi yaklaşık 69 saniye, istemci çıktı yazımı yaklaşık 42 saniye gözlendi. Test hazırlık payı 150 saniyeye çıkarıldı; gezinme DOMContentLoaded ve ekranın görünürlüğü üzerinden beklenir. Karşılaştırma senaryosu tek başına yeniden koşularak geçti (test 1,8 dakika, sunucu hazırlığı dahil koşu 4,3 dakika). Böylece 10 benzersiz tarayıcı senaryosu doğrulandı: yeni raporda dönem/limit karşılaştırması, bilinmeyen plan, URL/boş sayfa ve editör engeli; mevcut sekiz katalog senaryosunda regresyon yok. İlk test sunucusu hazırlığında da kaynak baskısıyla 240 saniye sınırı aşılmış, API/web tip kontrolleri tamamlandıktan sonra tarayıcı koşusu başlatılmıştır.

## Kalan kapsam

Bilinen eski koşulların bağlanması yeni katalog fiyatlarının satışa açılması değildir. Yeni fiyat/kota/özellik sürümünü seçme, mevcut aboneye etki önizlemesi ve kontrollü atama, firmaya özel koşullar ve ücret farkı politikaları devam eder. Bilinmeyen kodların ticari koşulu kendiliğinden çözülemez; raporda inceleme bekler. PK-09'un bilinen eski kayıtlar ve eşlenmeyen kayıt raporu uygulama/izole kabulü hazırdır; mevcut yerel veritabanındaki pilot/geçiş provası ve yayın ayrı yapılır. PK-02 bütünü yeni ticari atama kurallarıyla kapanır.
