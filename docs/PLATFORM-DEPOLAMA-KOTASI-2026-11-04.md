# Katalog depolama kotası

Kapsam sözleşmesine isteğe bağlı `depolama: { sinirBayt, uyariYuzdesi }` eklendi. Bayt sınırı 0…9223372036854775807 aralığında ondalık tam sayı metni veya null'dır; JavaScript sayı hassasiyetine çevrilmez. Tanım yoksa veya sınır null ise sınırsızdır. Eski sürümlere varsayılan limit eklenmez. Sıfır yeni dosya yüklemeyi engeller. Uyarı eşiği 1…99'dur. Yayınlanmış kapsam yerinde değiştirilemez.

Rezervasyon sırasında kayıtlı ek baytları + süresi dolmamış açık rezervasyonlar + yeni dosya aynı kiracı kilidi altında karşılaştırılır. Abonelik kota sürümü yazılarak eski Repeatable Read görünümüyle kapasite aşımı serialization hatasına dönüştürülür. Metadata INSERT/artan boyut UPDATE işlemleri de aynı sınıra tabidir; dosyanın kendi rezervasyonu ikinci kez sayılmaz. DELETE ve boyut azaltma kapasite bırakır. Son metadata transaction'ında etkin limit yeniden okunur: ek kapasite istisnası sona ermişse yükleme standart sınıra göre reddedilir ve metadata yazılmaz.

Katalog editörü/yayın görünümü, firma istisnası formu ve onay karşılaştırması depolama alanını taşır. İstisna uygunluk/onay ve paket atamasının uygulama/worker denetimi kayıtlı dosyalarla açık rezervasyonların hedef sınıra sığmasını doğrular. Firma ek hacmi ekranı limit, uyarı eşiği, kayıtlı/ayrılmış bayt ve doluluk durumunu gösterir. Ek ücret veya dönemsel sıfırlama yoktur.

Doğrulama: 48 ortak sözleşme testi; beş yeni depolama PostgreSQL kabulü (eşzamanlı rezervasyon, sıfır, iptal/süre sonu, doğrudan yazma, katalog yayını/atama ve istisna onayında hacim denetimi, Repeatable Read, yükleme sırasında özel kapasitenin bitmesi). İlk dört yeni depolama kabulüyle önceki rezervasyon/ölçüm/istisna/kapsam kabulleri birlikte 26 test geçti; son süre sonu kabulü ve rezervasyon dosyası ayrıca birlikte sekiz test geçti. Üç Playwright senaryosu, depolama sınırı ve eşiğinin doğru gönderimi dahil geçti. Tarayıcı API'si taklittir; kota kabulleri gerçek geçici PostgreSQL'dedir.

Ölçüm kayıtlı ek metadata'sına dayanır. Yedekler, günlükler ve metadata'sız nesneler fiziksel depolama envanterine dahildir ancak bu kotada sayılmaz. Çalışan ortama migration veya uygulama yayını yapılmadı.

API/web tam tür kontrolleri de geçti. Son depolama koşusu beş senaryonun tamamını geçti; uygunluk ekranının fazla kayıtlı hacim için `depolama_asimi` gerekçesi verdiği ayrıca doğrulandı. Geçici veritabanları ve tarayıcı sunucusu kapatıldı.
