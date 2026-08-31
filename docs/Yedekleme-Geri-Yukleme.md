# Yedekleme ve geri yükleme

Yedek oluşturma, arşiv bütünlüğü ve geri yükleme akışı çalışan PostgreSQL ve
MinIO konteynerlerinde doğrulanmıştır. Aylık prova üretim verisine dokunmamak
için her zaman izole PostgreSQL konteyneri ve geçici MinIO volume'ü üzerinde
yapılmalıdır.

PostgreSQL yedeği almak için çalışan Compose projesinin kökünde:

```bash
./scripts/backup-postgres.sh backups
./scripts/backup-minio.sh backups
```

Geri yükleme mevcut veritabanındaki tabloları değiştirebilir; önce uygulama
trafiği durdurulmalı ve geri dönüş provası ayrı bir veritabanında yapılmalıdır:

```bash
docker compose stop api worker web
./scripts/restore-postgres.sh backups/tekirextra-YYYYMMDDTHHMMSSZ.sql.gz
docker compose start api worker web
```

MinIO eklerini geri yüklemek için trafik durdurulduktan sonra:

```bash
./scripts/restore-minio.sh backups/tekirextra-minio-YYYYMMDDTHHMMSSZ.tar.gz
./scripts/verify-backup.sh backups/*.sql.gz backups/*.tar.gz
```

MinIO yedeği çalışan konteynerin `/data` volume'ünden alınır. Üretimde yedekler
şifreli ve erişim kontrollü bir nesne deposuna kopyalanmalı; PostgreSQL ve MinIO
aynı zaman damgasıyla saklanmalıdır. Geri yükleme sonrası `/health/ready` ve
örnek bir ek indirme akışı doğrulanır.

## Son prova kanıtı

2026-08-30 tarihinde yerel üretim benzeri veriyle izole geri yükleme yapıldı:

- PostgreSQL SQL akışı `ON_ERROR_STOP=1` ile hatasız tamamlandı.
- Geri yüklenen veritabanında 120 public tablo, 94 migration ve 135 tenant
  kaydı doğrulandı.
- MinIO arşivi geçici volume'e açıldı ve `tekirextra-ekler` altındaki örnek
  fatura, masraf ve firma ekleri doğrulandı.
- Prova sırasında MinIO restore komutundaki çift gzip açma hatası giderildi;
  arşiv doğrulaması artık yalnız gzip bütünlüğünü değil tar indeksini de okur.

Bu sayılar yalnız prova kanıtıdır; sonraki provalarda kaynak sistemle alınan
manifestteki sayılar karşılaştırılmalıdır. Geçici konteyner ve volume prova
sonunda kaldırılmalıdır.
