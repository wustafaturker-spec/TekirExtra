# Ödeme koşullarının sabitlenmesi

PK-02'nin ödeme/fatura geçiş hazırlığı. Katalog fiyatı henüz aboneliğe atanmaz; bu teslim yeni çevrim içi ödemelerin mevcut sabit koşullarını kaydeder. Yerel veritabanına veya çalışan uygulamaya uygulanmadı.

## Düzeltilen durum

Ödeme girişimi tutarları kaydediliyordu; fatura işçisine gelen liste ise güncel abonelik planını taşıyor ve fatura sabit KDV oranını okuyordu. Girişim ile fatura arasındaki plan/ad/oran değişikliğinde mali içerik aynı kaynağa bağlı değildi.

Yeni panel, e-posta ve otomatik yenileme girişimi `fiyatFotografi` alanında şema sürümü, `eski_sabit` kaynağı, kanonik plan kodu/adı, TRY, KDV oranı, ay sayısı, matrah, KDV ve toplamı saklar. v1 fiyatı Profesyonel olarak kaydedilir. Ondalık tutarlar iki ondalıklı metindir. KDV ve toplam Decimal ile doğrulanır. Sağlayıcı açıklaması fotoğraftaki adı kullanır; tutar mevcut girişim satırından gelir ve fotoğrafla karşılaştırılır.

Başarılı ödeme aynı transaction içinde fotoğrafı ödeme satırına kopyalar. Tekrarlanan bildirim ikinci ödeme üretmez. Otomatik yenileme de aynı girişim oluşturma yolundan geçer. Katalog yayını veya güncel abonelik planının değişmesi başlamış girişimin fotoğrafını değiştirmez; ödeme tamamlanınca güncel plan geriye alınmaz.

Fatura işçisi liste verisine ek olarak ödeme satırını ödeyen firmanın RLS bağlamında okur. Fotoğrafı kayıtlı matrah/KDV/toplam ve dönemle doğrular; açıklamada fotoğraftaki paket adını, fatura satırında fotoğraftaki matrah ve KDV oranını kullanır. Bozuk fotoğrafta güncel koşullara düşmez; fatura açmadan hata durumunu kaydeder. Daha önce açılmış fatura yeniden yazılmaz.

## Veritabanı ve eski kayıtlar

Migration `20261104030000_abonelik_odeme_fiyat_fotografi`, girişim ve ödeme tablolarına nullable JSONB ekler. Eski satırlar güncellenmez. Fotoğraf oluşturulduktan sonra silinemez/değiştirilemez; fotoğraflı kaydın kimliği, kiracısı, dönemi ve tutarları da değiştirilemez. Girişimde plan kodu korunur. DB trigger'ı şema, alan tipleri, dönem, para birimi, ondalık hassasiyeti, KDV hesabı ve kayıtla tutar eşleşmesini kontrol eder. İade kilidi ve girişimin sonuçlanma alanları güncellenebilir.

Geçiş öncesi girişimler, eski uygulama sürümünün yazdığı kayıtlar ve elle tahsilatlar için null desteklenir. Fotoğrafsız girişim eski tutarıyla tamamlanabilir ve fotoğrafsız ödeme üretir. Geçmişe varsayımsal fotoğraf eklenmesi de UPDATE korumasıyla engellenir. Fotoğrafsız faturada mevcut geriye uyumlu hesap ve ad davranışı sürer. Elle tahsilatın fotoğrafı bu teslimde eklenmedi. Yeni tablo/rol izni yoktur; mevcut kiracı RLS sınırı korunur.

## Kalan işler

Bu ilk fotoğraf teslimi `eski_sabit` kaynağındadır ve katalog sürüm kimliği içermez. Devam tesliminde [bilinen eski aboneliklerin sürüm bağı, korunmuş koşulları, yenileme önizlemesi ve şema 2 fotoğrafı](PLATFORM-ABONELIK-KATALOG-BAGI-2026-11-03.md) eklendi; şema 1 geçmişi korunur. Yeni katalog fiyatını abonelere kontrollü atama, elle tahsilatın aynı ticari koşullara bağlanması ve satışa açma devam eder.

## Doğrulama

İlgili 36 birim testi geçti: fiyat fotoğrafı, fatura, eski tutar, POS ve iade davranışları. İlk fatura birim koşusundaki sahte UUID'ler düzeltildikten sonra fatura dosyasındaki 5 test geçti. Son birleşik izole PostgreSQL koşusunda ödeme/otomatik yenileme/PayTR ve fotoğraf için 18, iade için 7, rapor için 5 ve RLS için 3 olmak üzere toplam 33 test geçti. Paket değişikliği sonrası aynı ödeme/fatura koşulları, DB değişmezliği, fotoğrafsız eski girişim, kiracı yalıtımı ve idempotent ödeme/fatura davranışı doğrulandı. API TypeScript (4 GB heap), değişen kaynakların ESLint ve diff boşluk kontrolü temiz.

İlk geniş kabulde iade ve rapor dosyaları önceden kurulmuş platform kullanıcısı beklediği için başlayamadı; testler kendi aktörlerini oluşturup temizleyecek şekilde düzeltildi. Bir tekrar koşusunda geçici PostgreSQL 40 saniyede hazır olamadı; izole runner'ın hazırlık süresi 120 saniyeye çıkarıldı. Son birleşik koşu 18,23 saniyede 33/33 geçti, geçici DB kaldırıldı. Kabulde görülen mevcut iade kilidi uyarısının kaynağı, `void` dönen işlevin Prisma tarafından okunamamasıydı; sonuç `text`e çevrildi. Bu son düzeltmeden sonra 7 iade birim testi ve yeni geçici PostgreSQL'de 7 iade kabul testi yeniden geçti; kilit açma için hatalı uyarı oluşmadığı da doğrulandı. Bu ikinci geçici DB de kaldırıldı.
