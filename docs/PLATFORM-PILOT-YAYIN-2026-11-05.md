# Platform yerel pilot yayını — 5 Kasım 2026

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
