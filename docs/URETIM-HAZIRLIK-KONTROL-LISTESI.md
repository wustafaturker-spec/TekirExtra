# Üretim hazırlık kontrol listesi

**Güncelleme:** 2026-08-17  
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

- [ ] E-belge kuyruğu bellek-içi `setTimeout` yerine Redis/BullMQ ile kalıcı hale getirilecek.
- [ ] Worker gerçek consumer olarak e-belge gönderim, durum sorgulama ve gelen belge işlerini işleyecek.
- [ ] Retry, exponential backoff, idempotency ve dead-letter akışları test edilecek.
- [ ] Sovos canlı/sandbox akışı gerçek ortamda doğrulanacak.
- [x] Mock adapter kullanan sağlayıcılar üretimde `ALLOW_MOCK_ENTEGRATIONS=true` olmadan engelleniyor.
- [x] Kabul testleri PostgreSQL, Redis, Mailpit ve MinIO servisleriyle CI içinde çalıştırılacak.
- [x] Tenant izolasyonu için iki tenantlı negatif erişim testleri CI’a eklenecek.
- [x] Migration uygulaması CI içinde otomatikleştirildi; geri yükleme provası ayrıca sürdürülüyor.
- [ ] PostgreSQL ve MinIO yedekleme/geri yükleme prosedürü yazılı ve denenmiş olacak.
- [x] Rate limit, webhook replay koruması ve upload boyut/tür kontrolleri etkin olacak.
- [x] Merkezi log, error tracking, metrik ve alarm kanalları (JSON stdout + request ID + Prometheus/Alertmanager; `observability/README.md`).

## Operasyon notları

`/health` yalnızca sürecin ayakta olduğunu; `/health/ready` ise trafiğe hazır
olduğunu gösterir. Readiness başarısızsa load balancer yeni trafik
yönlendirmemelidir. Geliştirme ortamında S3/Redis değişkenleri tanımlı değilse
ilgili bağımlılık kontrolü atlanır; üretimde bu değişkenler zorunlu tutulmalıdır.

## Son kullanıcı kapsamı

TekirExtra mevcut haliyle ön muhasebe ürünüdür. E-defter, bordro, resmi genel
muhasebe ve banka OFX aktarımı ürün kapsamı dışındadır. Abonelik ödeme sağlayıcı
bağlantısı ve gelen e-İrsaliye'nin stok kabulüne dönüştürülmesi henüz tamamlanmış
özellik olarak sunulmamalıdır.
