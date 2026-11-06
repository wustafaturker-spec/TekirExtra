# Platform yerel pilot yayını — 5 Kasım 2026

6 Kasım güncellemesi: Duyuru tasarımı yalnız web servisi değiştirilerek yerel pilota alındı. Güncel paket `.release-candidates/platform-duyuru-design-20261106`, build ID `qQjORoka183cUCx3enore`. Üretim paketinde masaüstü/mobil 12 tarayıcı kabulü ve canlı sağlık/giriş kontrolleri geçti. [Ayrıntı ve geri dönüş](PLATFORM-DUYURU-TASARIM-PILOT-2026-11-06.md). Gerçek kullanıcı oturumuyla kapsamlı DY kabulü açık kalır.

Durum: `c8ee18c` kaynaklarından üretilen yeni paket yerel pilotta açıldı.

- Pilot: http://localhost:3100
- Platform: http://localhost:3100/platform
- Paketler: http://localhost:3100/platform/paketler
- Firma ve istatistik ekranları aynı pilotta güncel sürümü kullanır.

## Migration ve bağlantılar

Mevcut `tekirextra` veritabanında 336 migration'ın tamamının önceden, son paket migration'larının 4 Kasım 2026 tarihinde uygulanmış olduğu görüldü. `prisma migrate status` ve `prisma migrate deploy` başarıyla çalıştırıldı: şema güncel, bekleyen migration yok. Tekrar DDL uygulanmadı ve migration geçmişi değiştirilmedi. Önceki geliştirme notlarındaki “uygulanmadı” ifadeleri bu kontrolle güncellenmiştir.

Üç tarihsel checksum farklılığı önceki pilot kaynaklarında da bulunur: `20261013180000_ai_gorev_sahibi_zamanlama` (`checksum_manual`), `20261013200000_gelen_epostalar` (`custom`), `20261023090000_cari_birlestirme`. `20261104110000_platform_planli_paket_atamasi` farkı yalnız dosya sonundaki bir boş satırdır; eklenen satırla hesaplanan SHA-256 veritabanı kaydıyla aynıdır. Bunlar yeni SQL geçişi gibi yeniden uygulanmadı.

Yapılandırılmış uygulama/migration bağlantılarının parolaları kalıcı PostgreSQL rollerince kabul edilmiyordu. Önce rol yedeği alındı; `tekir` ve `tekir_app` parolaları mevcut `.env` değerleriyle eşitlendi. Rol yetkileri korunur. Platform rolü zaten bağlanıyordu. Redis PING ve S3 bucket HEAD kimlik doğrulaması da geçti. Anahtar/parola değerleri bu kayda veya yayın çıktısına yazılmadı.

## Paket ve servisler

Paket: `.release-candidates/platform-pilot-c8ee18c-20261105`.

Kaynak sabitlenerek API ve web yeniden üretildi. Web build kimliği: `PHO4yyNvh4M3lTlUQk18N`. Runtime bağımlılıkları aynı lockfile/API paket tanımıyla eşleşen önceki paketten alındı; API çıktıları, workspace çıktıları, Prisma şeması ve üretilmiş istemci yeni sabit kaynaktan paketlendi. 25.536 runtime dosyası hash manifestine alındı, paket dışına bağımlılık/symlink olmadığı doğrulandı. Ortam dosyaları pakete alınmadı.

API, web, genel worker ve söz hatırlatma worker'ı yeni sürümden çalışıyor. Dört servis de `healthy`; yeniden başlatma sayıları 0, politika `unless-stopped`, kontrol anındaki açılış hata kayıtları 0. Mevcut JWT, platform JWT, web oturum işareti ve bağlantı şifreleme anahtarları korunur.

## Yedek ve geri dönüş

Tam PostgreSQL custom arşivi:

`backups/platform-pilot-c8ee18c-20261105/tekirextra-gecis-oncesi.dump`

Boyut: 582.367.158 bayt. Dizin 0700, arşiv ve `roller.sql` rol yedeği 0600 izinlidir. Arşivin tamamı `pg_restore --file=/dev/null` ile açılıp doğrulandı; bu bir veritabanına geri yükleme provası değildir.

Önceki uygulama compose yapılandırması `.release-candidates/platform-pilot-isletim-20261105/geri-donus-compose.json` dosyasında korunur. İşletim yardımcısı mevcut anahtarları bellekte devralır:

```sh
python3 .release-candidates/platform-pilot-isletim-20261105/pilot.py durum
# Gerektiğinde yalnız uygulama sürümünü geri alır:
python3 .release-candidates/platform-pilot-isletim-20261105/pilot.py geri-don
```

Geri dönüş bu yayında çalıştırılmadı. Yardımcı veritabanını veya rol parolalarını geri yüklemez.

## Canlı kontroller

Yeni API runtime'ından gerçek platform rolüyle salt okunur servis kontrolleri geçti: üç paket, sürüm/deneme süresi, katalog bağı, planlı atamalar, firma listesi, firma istisnaları, ek hacmi/depolama ve istatistik/operasyon. Yeni oturum veya örnek iş verisi oluşturulmadı.

Geçerli eski platform oturumu bulunmadığından giriş yapılmış ekranlar için yeni oturum üretilmedi. Gerçek üretim web'inde Chromium kontrolü giriş ekranını, oturumsuz platform yönlendirmesini, API'nin 401 yanıtını, 390 px mobil taşma olmamasını ve sıfır script hatasını doğruladı. API readiness 200. Ekran görüntüsü alma protokol hatası sonrası işlev kontrolleri görüntü kaydı olmadan geçti. Giriş yapılmış ekranlar önceki izole tarayıcı kabulleri ve canlı servis okumalarıyla desteklenir.

Önce/sonra sayımları aynı: 723 firma, 716 kullanıcı, 162 belge, 635 abonelik, 3 abonelik ödemesi; toplam ödeme 34.271,20 TL.

Ayrıntılı kayıt, runtime manifesti ve canlı kontrol sonuçları `.release-candidates/platform-pilot-isletim-20261105/yayin-ozeti.json` ve yeni paket dizinindedir. Uzak sunucu yayını yapılmadı.

## Giriş bağlantısı düzeltmesi — aynı gün

Kullanıcının bildirdiği `JSON.parse` hatası gerçek giriş POST isteğinde yeniden incelendi. Redis sunucusu parolasız, API'nin `REDIS_URL` değeri parolalıydı. İlk PING kontrolü kullanılan istemciyle başarılı görünse de giriş sayacının `redis` istemcisi AUTH hatasıyla yeniden bağlanmayı sürdürüyordu; giriş proxy'si zaman aşımı/socket reset sonrasında JSON dışı yanıt üretiyordu. İlk yayın kontrolü giriş ekranını açmış, form POST akışını doğrulamamıştı.

Mevcut `.env` dosyasına `REDIS_URL` ile aynı parolayı taşıyan `REDIS_PASSWORD` eklendi; önceki ortam dosyası korumalı yedek dizinine alındı. Redis aynı kalıcı volume ile yeniden oluşturuldu. Uygulama kodu ve kullanıcı hesapları değiştirilmedi.

Gerçek pilotta var olmayan test adresiyle giriş isteği artık yaklaşık 700 ms'de 401 ve `application/json` yanıtı veriyor. Chromium form kontrolü anlaşılır kimlik bilgisi hatasını doğruladı; JSON parse veya tarayıcı script hatası yok. Gerçek kullanıcı hesabı, parola veya 2FA değiştirilmedi. Redis ve dört pilot servisi sağlıklı. Ek kontrol kaydı: `.release-candidates/platform-pilot-isletim-20261105/giris-kontrol.json`.

## Duyuru sistemi yerel pilot güncellemesi — 5 Kasım 2026

Tenant duyuruları için yeni yerel pilot paketi `.release-candidates/platform-duyuru-pilot-20261105` altında hazırlandı ve API, web, worker ve söz hatırlatma servisleri bu pakete geçirildi. Önceki uygulama bileşimi `ops/geri-donus-compose.json` içinde korundu. API ve web üretim derlemeleri ayrı çalıştırıldığında geçti; Web build ID `_seCd7WYAjYQL36zrV3uE90a6551`.

Mevcut pilot veritabanında 344 migration'ın tamamı güncel. Sekiz duyuru migration'ı uygulanmadan önce `backups/platform-duyuru-oncesi-20261105/tekirextra-20261105T134435Z.sql.gz` tam dökümü alındı ve `gzip -t` ile doğrulandı; dosya izinleri 0600, yedek klasörü 0700. İlk yedek denemesi eksik kaldığı için `.incomplete` olarak işaretlendi ve geçerli yedekten ayrı tutuldu.

Dağıtım sonrasında API readiness 200 (PostgreSQL, Redis ve nesne deposu hazır); dört uygulama servisi `healthy`. Oturumsuz `/platform/duyurular` isteği beklenen 307 platform giriş yönlendirmesini verdi. Bu oturumda test paketleri ve gerçek kullanıcı oturumuyla duyuru akışı çalıştırılmadı; uzak üretim yayını yapılmadı. Kullanıcı kabulü ve uzak üretim yayını açık kalır. Ayrıntılı makinece okunur kayıt: `.release-candidates/platform-duyuru-pilot-20261105/yayin-ozeti.json`.

## Duyuru oluşturma düğmesi — 5 Kasım 2026

`/platform/duyurular` sayfasındaki oluşturma bağlantısı birincil düğme olarak belirginleştirildi. Firma panelindeki `/panel/duyurular` alanına bu sayfanın yalnız platformca yayımlanan duyuruları gösterdiğini açıklayan metin eklendi. Yeni web build ID `OxoeqXWsoo093JuvOob_p`; güncelleme `.release-candidates/platform-duyuru-pilot-20261105b` paketinde yerel pilota geçirildi. API readiness 200 ve dört servis `healthy`. Oturumsuz istek hâlâ platform girişine yönlendiriliyor; gerçek kullanıcı oturumuyla düğmenin görsel kabulü bu turda yapılmadı. Ayrıntı: `.release-candidates/platform-duyuru-pilot-20261105b/yayin-ozeti.json`.

## Firma kaydı ve vergi bilgileri yerel pilot güncellemesi — 5 Kasım 2026

Gerçek/tüzel kişi seçimi, TCKN/VKN doğrulaması, kayıt sırasında firma iletişim ve adres bilgileri, e-posta tekilliği, değiştirilemeyen VKN ve destek doğrulamasıyla platformdan VKN değişikliği ile GİB vergi dairesi sözlüğü yerel pilota geçirildi. Aday `.release-candidates/platform-onboarding-pilot-20261105`; kaynak özeti `aef01bf2037043e8ee1d0d3217ef94355c422f0d8444e7582ebb9ff913dd01db`, web build ID `ktRrY11qZ9iSRWzVYmUSQ`. Runtime 26.769 dosya içerir; SHA-256 `83f1da73c895d519dbcebc2eefbd23c2300488d6fa1e5dc90f4e5e80c8f65742`.

Geçiş öncesi `backups/platform-onboarding-pilot-20261105/tekirextra-gecis-oncesi.dump` tam yedeği alındı (621.089.512 bayt, dosya izni 0600, klasör izni 0700); `pg_restore --list` doğrulaması geçti. Pilot DB'sindeki 351 migration günceldi; yeni migration uygulanmadı. Eski compose yapılandırması adayın `ops/geri-donus-compose.json` dosyasında saklandı. Mevcut oturum ve şifreleme anahtarları korunarak API, web, genel worker ve söz hatırlatma worker'ı yeni runtime'a geçti.

Dağıtım sonrası dört servis `healthy`, API readiness 200. `http://localhost:3100/` ve `/kayit` 200; paket listesi 200; aktif vergi dairesi uç noktası 200 ve 860 kayıt döndürdü. Platform yönetim vergi dairesi uç noktası oturumsuz isteğe beklenen 401'i verdi. Gerçek kullanıcıyla firma oluşturma/kayıt kabulü bu turda yapılmadı; gerçek test hesabı veya şirket kaydı oluşturulmadı. Bu yalnız yerel pilot yayınıdır; uzak üretime yayın yapılmadı. Makinece okunur yayın özeti: `.release-candidates/platform-onboarding-pilot-20261105/yayin-ozeti.json`.

## Firma kayıt ekranı tasarımı — aynı gün

Kayıt ekranı geniş masaüstü formu ve dar telefon görünümü için yeniden düzenlendi. Koyu tanıtım paneli; firma bilgileri, yönetici hesabı ve alan grupları daha rahat taranacak bir düzene alındı. Yeni web build ID `vfmSP3vhJ6zZR1glKK3ig`; `.release-candidates/platform-onboarding-design-20261105` paketi yerel pilota geçirildi. API readiness 200, kayıt ekranı 200; masaüstü ve 390 px mobil görünüm Chromium ile açılarak gözle kontrol edildi. Önceki ekran paketi `.release-candidates/platform-onboarding-pilot-20261105` rollback hedefi olarak korundu. Veri tabanı veya migration değişmedi. Yayın özeti: `.release-candidates/platform-onboarding-design-20261105/yayin-ozeti.json`.
