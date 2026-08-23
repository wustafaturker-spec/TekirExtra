# Yedekleme ve geri yükleme

Yedek oluşturma ve gzip/arşiv bütünlüğü çalışan PostgreSQL ve MinIO
konteynerlerinde doğrulanmıştır. Geri yükleme provası, üretim verisine dokunmamak
için izole bir PostgreSQL/MinIO ortamında ayrıca yapılmalıdır.

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
