# Yedekleme ve geri yükleme (PLT-109…117, NFR-09)

Her gece 04:00'te (İstanbul) `yedekleme` servisi veritabanını ve MinIO dosyalarını yedekler. Yedekler `backups/platform/<zaman>-<kimlik>/` altındadır. Durum ve elle yedek: Platform › Yedekler. Dış kopya henüz yok (PLT-115); disk arızasına karşı koruma sağlamaz.

Klasör içeriği: `veritabani.dump` (pg_dump özel biçim), `roller.sql` (veritabanı rolleri, parola özetleriyle), `dosyalar.tar.gz` (MinIO), `dogrulama.txt`, `kunye.json`, `SHA256SUMS`. Dosyalar yalnız sahibi tarafından okunabilir.

## Canlıya geri yükleme

Bu işlem son yedekten sonraki bütün veriyi siler. Ekrandan yapılmaz.

1. Platform › Yedekler'den geri dönülecek yedeği seçin, "Dene" ile açılabildiğini doğrulayın.
2. API, worker ve web süreçlerini durdurun; kuyrukta iş kalmadığını kontrol edin.
3. O anki durumun yedeğini alın: `./scripts/backup-postgres.sh backups/geri-yukleme-oncesi`.
4. Bütünlüğü denetleyin: `cd backups/platform/<klasor> && sha256sum -c SHA256SUMS`.
5. Veritabanını açın (yalnız veritabanı yeniden kuruluyorsa `roller.sql` önce yüklenir):

```sh
docker exec -i tekirextra-postgres-1 pg_restore -U tekir -d tekirextra --clean --if-exists --no-owner < veritabani.dump
```

6. Dosyaları, MinIO durdurulmuş ve `minio-data` birimi boşaltılmış olarak `dosyalar.tar.gz` içinden açın.
7. Süreçleri başlatın, Sistem Sağlığı'nı ve örnek bir belgeyi kontrol edin.
