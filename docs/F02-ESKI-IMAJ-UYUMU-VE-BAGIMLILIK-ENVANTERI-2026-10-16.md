# F02 — Eski tam imajların uyumu ve bağımlılık envanteri

16 Ekim 2026. Yerel Docker deposunda 20 Eylül tarihli TekirExtra API/worker/web imajları bulundu ve güncel şemalı izole ortamda sınandı. **10 kontrolün 8'i geçti, 2'si başarısız oldu. Bu üçlü güncel şemaya geri dönüş paketi olarak uygun değil.** Gerçek şirket ayarları, veri ve çalışan servisler değiştirilmedi.

## Bulunan imajlar

| Bileşen | Sabit imaj ID'si | Oluşturulma tarihi |
| --- | --- | --- |
| API | `sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55` | 20 Eylül 2026 |
| Worker | `sha256:c78e107350ef0db8171a4fc29770620b574a02a423f5141ad5ba27cd86082eb7` | 20 Eylül 2026 |
| Web | `sha256:cda86ffc690e5098dcbc7151220cb94cddd65b5a572d4d68311904b2702983b8` | 20 Eylül 2026 |

Keşif sırasında etiketler `tekirextra-api:latest`, `tekirextra-worker:latest`, `tekirextra-web:latest` idi. Prova etiketle değil yukarıdaki sabit ID'lerle çalıştı. Etiketlerin eski olması, bunların onaylı önceki üretim sürümü olduğunu kanıtlamaz; imajlarda kaynak revision etiketi yoktu.

Üç imajda Node `v22.23.2`, Linux x64 var. API/worker imajlarının package.json, lockfile, main ve main.worker dosya özetleri eşleşiyor. Son migration `20260920210000_eirsaliye_fatura_baglantisi`; F02 takip servisi yok. Eski web BUILD_ID `b1QwcW55F4hyDcuM09msr`.

[İmaj içerik envanteri](../.release-candidates/f02-pilot-20261016-4/geri-donus-imaj-envanteri.json), [envanter betiği](../.release-candidates/f02-pilot-20261016-4/f02-imaj-envanteri.cjs). Eski proje dizinlerinde güncel depo yapısına ait API dist/web .next çifti bulunmadı; V2 assistant yedeği de tam API/web/worker dağıtım paketi değildi.

## Tam imajlarla izole koşum

[Prova betiği](../.release-candidates/f02-pilot-20261016-4/f02-eski-imaj-prova.cjs), SHA-256 `2768e6ad82c03f7069337ac804dd2d2a6f924f427beb64bd606e0eccb1a85a2c`. [Sonuç raporu](../.release-candidates/f02-pilot-20261016-4/f02-eski-imaj-prova.json), 20:15–20:16 TRT.

Yeni nonce/parola ile geçici PostgreSQL ve boş Redis kuruldu. Güncel migration'lar yalnız geçici DB'ye uygulandı; uygulama bağlantısında DB adı/nonce ve RLS rolü doğrulandı. Sentetik kullanıcı, gerçek Argon2 parola hash'i, kimlik rehberi, cari/fatura ve F02 söz/itiraz takibi oluşturuldu. Gerçek kullanıcı parolası veya token'ı kullanılmadı; giriş endpointi sentetik parolayla gerçek oturum üretti.

API/worker/web konteynerleri dış erişimi olmayan `--internal` ağdaydı; yalnız PostgreSQL şema/fixture kontrolü için ek bridge bağlantısı ve rastgele loopback portu aldı. PostgreSQL erişimi dışında host uygulama portları kullanılmadı. API ve web kontrolleri konteynerin içinden yapıldı. API/web aynı ağ ad alanını paylaştı; bu düzen gerçek Docker Compose yerleşiminin kabulü değildir.

Eski uygulama dosya sistemi salt okunur, çalışma dizini `/tmp` ve entrypoint doğrudan Node olarak seçildi. İmajın repo kökündeki `.env` dosyası kullanılmadı; test DB/Redis/JWT değerleri açıkça verildi. SMTP ve ek deposu ulaşılamayan yerel porta yönlendirildi. Ek yükleme/SMTP/dış servis kabulü yapılmadı. Eski migration veya paket kurulum betiği çalıştırılmadı.

| Kontrol | Sonuç |
| --- | --- |
| Fixture kimlik rehberi ve parola doğrulaması | Geçti |
| Eski API açılışı ve `/health` | Geçti |
| Sentetik parolayla gerçek giriş | Geçti |
| JWT ile kullanıcı/tenant okuma | Geçti |
| Cari detayı | Geçti |
| Fatura detayı | **500 — başarısız** |
| Eski web giriş sayfası | Geçti |
| Eski web üzerinden aynı origin API proxy isteği | **404 — başarısız** |
| Eski worker'ın 10 saniye süreç canlılığı | Geçti; kuyruk işleme kabulü değil |
| F02 söz/takip/iş audit, fatura ve ayar özeti | Önce/sonra eşit |

Sonuç `uyumsuzluk_bulundu`, onaylı geri dönüş paketi `false`. Geçici API/web/worker/PostgreSQL/Redis ve ağ temizlendi (`temizlik: true`).

İlk deneme internal ağdan host portu yayımlanamadığı için uygulama kontrollerine ulaşmadı. İkinci denemede fixture'ın kimlik rehberi kaydı eksikti; bu ürün uyumsuzluğu değildi. Bu iki hazırlık sonucu [ağ kaydı](../.release-candidates/f02-pilot-20261016-4/f02-eski-imaj-prova-ag-yayinlanmadi.json) ve [eksik fixture kaydında](../.release-candidates/f02-pilot-20261016-4/f02-eski-imaj-prova-eksik-kimlik-fixture.json) saklanır. Yukarıdaki değerlendirme düzeltilmiş son koşuma aittir.

## Uyumsuzlukların nedeni

**Fatura:** Eski Prisma istemcisi `faturalar.irsaliye_sonra` kolonunu seçiyor. [21 Eylül migration'ı](../apps/api/prisma/migrations/20260921193000_irsaliye_sonra_kaldirildi/migration.sql), bilgiyi sevkiyat yöntemine taşıdıktan sonra bu kolonu kaldırıyor. Son koşumda fatura GET isteği bu eksik kolondan 500 döndü. Sağlık/giriş başarıları şema uyumunu kanıtlamıyor. Eski imajı çalıştırmak için gerçek DB'ye kolon eklenmedi veya migration geri alınmadı.

**Web:** Eski imajın `.next/routes-manifest.json` dosyasında `beforeFiles`, `afterFiles`, `fallback` rewrite listeleri boş. Aynı origin `/api/v1/auth/ben` yolu 404 verdi. Bu, eski web'in bütün olası tarihsel yerleşimlerde çalışmadığını kanıtlamaz; güncel uygulamanın aynı origin API yönlendirmesine eşdeğer olmadığını gösterir. Harici proxy/topoloji uyumu ayrıca gerekir. Fatura şema hatası tek başına bu üçlünün güncel DB'ye doğrudan dönüşünü reddetmek için yeterlidir.

Bu bulgular, önceki turdaki [tek hatırlatma bileşeni karşılaştırmasından](F02-KAPATMA-VE-GERI-ACMA-PROVASI-2026-10-16.md) farklıdır: o kaynak 15 Ekim Git commit'ine aitti; burada gerçekten 20 Eylül tam Docker imajları kullanıldı. İki farklı eski sürüm birbirinin yerine değerlendirilmez.

## Mevcut adayın host bağımlılıkları

[Host bağımlılık envanteri](../.release-candidates/f02-pilot-20261016-4/f02-bagimlilik-envanteri.json), [üreten betik](../.release-candidates/f02-pilot-20261016-4/f02-bagimlilik-envanteri.cjs). 29 doğrudan API bağımlılığının istenen aralığı, gerçekten çözülen sürümü, giriş yolu ve package.json özeti kaydedildi. Workspace dist özetleri ve lockfile SHA-256 da alındı.

| Bileşen | Mevcut host |
| --- | --- |
| Node / pnpm | `v24.14.0` / `11.5.2` |
| Nest core | `11.1.28` |
| Prisma client | `6.19.3` |
| Argon2 | `0.44.0` |
| Playwright | `1.61.1` |
| shared / baglanti | `0.1.0` / `0.1.0`; dist dosya özetleri raporda |
| Chromium | Host önbelleğindeki çalıştırılabilir dosya mevcut |

Bu mevcut kurulumu tanımlar; temiz üretim bağımlılığı kurulumu, workspace dist'in kaynaktan tekrar üretimi veya Node 22 altında yeni adayın uyumu değildir. Host Chromium'un mevcut olması API aday klasörüne tarayıcının paketlendiği anlamına gelmez. Yeni adayın yalnız API JS dosyalarını kopyalamak hâlâ yeterli dağıtım paketi sayılmaz.

## Karar

Bu envanterden sonra [ayrı API/worker runtime paketi](F02-API-WORKER-RUNTIME-PAKETI-2026-10-16.md) oluşturuldu. Kilitli üretim bağımlılıkları, yeniden derlenen workspace paketleri ve hedefte üretilen Prisma istemcisiyle tam API/worker Node 22 üzerinde 11 kontrolü geçti. Bu yeni kanıt eski uygulama imajlarının geri dönüşe uygun olmadığı sonucunu değiştirmez; imaj testte yalnız Node/OS tabanı olarak kullanıldı.

20 Eylül üçlüsü güncel şemaya doğrudan geri dönüş için kullanılmayacak teknik adaydır; gerçek servis geçişi yapılmadı. Öncelikli geri dönüş mevcut F02 adayında otomasyonu kapatma/salt okunur moda geçme olarak kalır; bu da gerçek şirkette bu tur uygulanmadı. Tam eski sürüm kabulü için güncel şemayla uyumlu, kimliği ve bağımlılıkları belli daha yeni bir önceki paket gerekir. Doğal iş örneği kullanıcı isteğiyle ertelenmiş; manuel pilot açık, otomasyon/bildirimler kapalıdır.
