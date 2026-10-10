# Üretim hazırlık kontrol listesi

**Güncelleme:** 2026-09-14  
**Durum:** Beta / kontrollü pilot

Bu liste, uygulamanın özelliklerinin çalışmasından bağımsız olarak güvenilir bir
SaaS yayını için gereken operasyonel kapıları izler. Bir madde kanıtı olmadan
tamamlandı sayılmaz.

## Tamamlanan temel kontroller

- [x] Backend ve frontend production build
- [x] TypeScript typecheck
- [x] API ve shared paket testleri
- [x] Docker Compose PostgreSQL, Redis ve MinIO tanımları
- [x] Tenant context ve PostgreSQL RLS altyapısı
- [x] `/health` liveness endpoint'i
- [x] `/health/ready` veritabanı, Redis ve dosya deposu readiness kontrolü
- [x] Temel güvenlik response header'ları
- [x] Dashboard günlük satış/tahsilat ve çek tahsilatı görünürlüğü

## Release kapıları

- [x] E-belge gönderim kuyruğu bellek-içi `setTimeout` yerine Redis/BullMQ ile kalıcı hale getirildi.
- [x] Worker gerçek consumer olarak e-belge gönderim, durum sorgulama ve gelen belge işlerini işliyor.
- [x] Retry, exponential backoff, idempotency ve dead-letter akışları birim testleriyle doğrulandı.
- [ ] Sovos canlı/sandbox akışı gerçek ortamda doğrulanacak.
- [x] Mock adapter kullanan sağlayıcılar üretimde `ALLOW_MOCK_ENTEGRATIONS=true` olmadan engelleniyor.
- [x] Kabul testleri PostgreSQL, Redis, Mailpit ve MinIO servisleriyle CI içinde çalıştırılacak.
- [x] Tenant izolasyonu için iki tenantlı negatif erişim testleri CI’a eklenecek.
- [x] Migration uygulaması CI içinde otomatikleştirildi; geri yükleme provası ayrıca sürdürülüyor.
- [x] PostgreSQL ve MinIO yedekleme/geri yükleme prosedürü yazıldı; 2026-08-30 izole geri yükleme provası tamamlandı.
- [x] Rate limit, webhook replay koruması ve upload boyut/tür kontrolleri etkin olacak.
- [x] Merkezi log, error tracking, metrik ve alarm kanalları (JSON stdout + request ID + Prometheus/Alertmanager; `observability/README.md`).
- [ ] Her yeni ortamın (staging/üretim) ilk kurulumunda kiracı yalıtımı hedef veritabanında doğrulanacak (aşağıdaki "RLS doğrulaması"). 2026-09-14 itibarıyla staging/üretim ortamı yok; yalnız yerel ve CI veritabanı doğrulandı.

## Operasyon notları

`/health` yalnızca sürecin ayakta olduğunu; `/health/ready` ise trafiğe hazır
olduğunu gösterir. Readiness başarısızsa load balancer yeni trafik
yönlendirmemelidir. Geliştirme ortamında S3/Redis değişkenleri tanımlı değilse
ilgili bağımlılık kontrolü atlanır; üretimde bu değişkenler zorunlu tutulmalıdır.

### Veritabanı bağlantı havuzu (STK-35)

API süreci başına havuz boyutu `DATABASE_URL` içindeki `connection_limit`
parametresiyle belirlenir (`…/tekirextra?connection_limit=20`); verilmezse
Prisma çekirdek×2+1 kullanır. Toplam (süreç sayısı × `connection_limit` +
worker) PostgreSQL `max_connections` değerinin altında kalmalıdır. Kiracı
işlemi havuzdan en çok 10 sn bağlantı bekler; dolarsa istemci **503 +
`Retry-After: 3`** alır ve `db_pool_busy` uyarısı loglanır. Bu uyarı sık
görülüyorsa havuz büyütülür ya da süreç sayısı artırılır.

### RLS doğrulaması (yeni ortam kurulumunda)

2026-09-13 denetiminde 17 tabloda RLS'nin hiç olmadığı bulundu: yarım kalıp
"uygulandı" işaretlenen bir geçiş RLS satırlarını atlamıştı. Geçiş dosyasının
varlığı kanıt değildir; hedef veritabanının kendisine bakılır.

1. `_prisma_migrations`'ta `rolled_back_at` dolu ya da `applied_steps_count = 0`
   kayıt olmamalı.
2. `DATABASE_URL_MIGRATE` hedef ortamı gösterirken
   `apps/api/test/rls-kapsama.kabul.test.ts` çalıştırılır; `tenant_id` sütunlu
   her tabloda RLS, FORCE ve politika bulunmalı.
3. Uygulama rolüyle (`tekir_app`) var olmayan bir `app.tenant_id` kurulup
   `tenant_id` sütunlu tablolar sayılır; hepsi 0 dönmeli. İşlem `ROLLBACK` ile
   kapatılır, veri değişmez.

### Mevzuat Merkezi platform kurulumu (MVZ-04/16)

Mevzuat değerleri (KDV, tevkifat, istisna kodları, kanuni süre/eşikler,
bordro) kiracıya ait değildir; platform ekibi ayrı bir panelden (`/platform`)
yönetir.

1. `tekir_platform` rolünün parolası güçlü bir değerle değiştirilir
   (`ALTER ROLE tekir_platform PASSWORD '…'`) ve `DATABASE_URL_PLATFORM`
   buna göre tanımlanır. Rol yalnız mevzuat tablolarına yetkilidir.
2. `PLATFORM_JWT_SECRET` güçlü ve `JWT_SECRET`'tan **farklı** bir değerle
   tanımlanır; aynıysa ya da boşsa platform uçları kapalı kalır.
3. Platform kullanıcıları yalnız sunucuda betikle açılır:
   `node --env-file=.env dist/platform-kullanici-olustur.js <eposta> "<Ad Soyad>"`.
   Parola ve doğrulayıcı anahtarı bir kez yazdırılır; dört göz için en az
   **iki** kullanıcı gerekir.
4. Doğrulama: uygulama rolüyle `INSERT INTO mevzuat_kayitlari …` ve
   `SELECT … FROM platform_kullanicilari` "permission denied" vermeli; platform
   rolüyle herhangi bir kiracı tablosu okunamamalı.

## Son kullanıcı kapsamı

TekirExtra mevcut haliyle ön muhasebe ürünüdür. E-defter, bordro, resmi genel
muhasebe ve banka OFX aktarımı ürün kapsamı dışındadır. Abonelik ödeme sağlayıcı
bağlantısı ve gelen e-İrsaliye'nin stok kabulüne dönüştürülmesi henüz tamamlanmış
özellik olarak sunulmamalıdır.
