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

## Son kullanıcı kapsamı

TekirExtra mevcut haliyle ön muhasebe ürünüdür. E-defter, bordro, resmi genel
muhasebe ve banka OFX aktarımı ürün kapsamı dışındadır. Abonelik ödeme sağlayıcı
bağlantısı ve gelen e-İrsaliye'nin stok kabulüne dönüştürülmesi henüz tamamlanmış
özellik olarak sunulmamalıdır.
