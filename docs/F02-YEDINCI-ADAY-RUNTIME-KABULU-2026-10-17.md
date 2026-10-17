# F02 yedinci aday — Node 22 çalışma zamanı kabulü

17 Ekim 2026. Aday `f02-20261016T192044389Z-1a2c15ca`, web BUILD_ID `76UhtlwyCG-IRZn-VRm_B`. Bu çalışma, [yedinci adayın önceki 140 yerel kontrolüne](F02-GUNCEL-KAYNAK-ADAYI-2026-10-16.md) ek çalışma zamanı kanıtlarını kaydeder.

## Sabit kaynak ve paket

Üretim bağımlılıkları ayrı dizine çevrimdışı, frozen lockfile ile kuruldu. API çıktısı yedinci adaydan; Prisma şeması, paket tanımları ve yeniden derlenen ortak kodlar `.release-candidates/f02-kaynak-1792177097679-1ad86317` sabit kopyasından alındı. Kopyadaki kaynakların tamamı aday manifestiyle karşılaştırıldı. Ana çalışma alanının sonradan değişen dosyaları pakete alınmadı.

- Runtime dizini: `api-worker-runtime-20261017T044844904Z-3d4dfb`.
- Runtime SHA-256: `a0b918eed1fad893609a1e7f0e3659186a5b1b2ad2a5d013c416b92d8bc5f526`.
- 23.584 dosya/bağlantı girdisi; 1.009 bağlantı paket içinde çözülüyor.
- 29 doğrudan üretim bağımlılığı, Prisma 6.19.3 ve native Argon2 doğrulandı.
- Node 22.23.2 tabanı: `sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55`. İmajın eski uygulaması çalıştırılmadı; yalnız Node/OS tabanı kullanıldı.

[Paketleme betiği](../.release-candidates/f02-pilot-20261016-7/f02-runtime-paketle.cjs), [runtime manifest işaretçisi](../.release-candidates/f02-pilot-20261016-7/runtime-son-aday.json).

## API/worker ve PDF sonucu

[Node 22 API/worker raporunda](../.release-candidates/f02-pilot-20261016-7/f02-runtime-prova.json) **11 kontrol geçti**. Tam API başlangıcı, PostgreSQL/Redis/depo sağlığı, sentetik kullanıcının gerçek parolasıyla HTTP giriş, kimlik/cari/fatura okumaları, takip/görüşme ve ödeme sözü işlemleri, nakitte çift sayımın önlenmesi doğrulandı. Tam worker geciken sözü mevcut takibe bir kez bağladı; görüşme korundu, uygulama içi bildirim oluştu ve e-posta kapalı kaldı. Salt okunur moda geçişten sonra yazma isteği 403 döndü.

Geçici PostgreSQL/Redis/depo, API/worker konteynerleri ve test ağı temizlendi. Gerçek şirket bağlantısı veya kullanıcı parolası kullanılmadı.

[Arşiv/PDF raporunda](../.release-candidates/f02-pilot-20261016-7/f02-runtime-arsiv.json) **bir ek PDF kontrolü geçti**: ağsız, salt okunur Node 22 konteynerinde gerçek derlenmiş `PdfService.htmlToPdf` ile 25,830 bayt PDF üretildi; `Çığ`, `Şişli`, `Ürün` metinleri doğrulandı. Chromium/headless shell 1228 ve ffmpeg 1011 paketlendi.

| Arşiv alanı | Değer |
| --- | --- |
| Dosya | `api-worker-runtime-20261017T044844904Z-3d4dfb.tar.gz` |
| Boyut | 378,233,820 bayt |
| SHA-256 | `eebef45180ca39aa090cf48e1363996759df036cfee19558c3b5508316a14f50` |
| Güvenli göreli arşiv yolu | 27,880 |
| gzip, runtime/browser son özetleri | Geçti |

Paket Linux x64, glibc/OpenSSL 3 ve sınanan Node 22 tabanına aittir. Node yürütücüsü ve Chromium sistem kitaplıkları arşive dahil değildir. Ortam değişkenleri dışarıdan sağlanır; migration/servis geçişi ayrıca yürütülür.

## Gerçek web/API/worker akışı

[Tam akış raporunda](../.release-candidates/f02-pilot-20261016-7/f02-tam-akis-prova.json) **14 kontrol geçti**. Sabit adayın standalone web'i, aynı Node 22 API/worker ve geçici PostgreSQL/Redis/depo ile çalıştırıldı. Tarayıcı API fixture'ı kullanmadı. Sentetik kullanıcı gerçek giriş formundan giriş yaptı, görüşme ekledi; yenileme sonrası metin ve API'deki iki görüşme kaydı doğrulandı. Ödeme sözü ekranı ve salt okunur masaüstü/mobil kontrolleri geçti; JavaScript ve 5xx hatası görülmedi. Mobil ekran görüntüsü ayrıca incelendi.

[Tarayıcı betiği](../.release-candidates/f02-pilot-20261016-7/f02-tam-akis-tarayici.cjs), [mobil görüntü](../.release-candidates/f02-pilot-20261016-7/tam-akis-2af9db8f3fa4a7b3/salt_okunur-mobil.png), [masaüstü görüntü](../.release-candidates/f02-pilot-20261016-7/tam-akis-2af9db8f3fa4a7b3/pilot-masaustu.png).

Test öncesi/sonrası runtime dosyaları ve adayın API/web manifesti doğrulandı. Geçici konteynerler ve ağ temizlendi. [Kabul özeti](../.release-candidates/f02-pilot-20261016-7/runtime-kabul-ozeti.json): 11 API/worker + 1 PDF + 14 tam akış = **26 ek kontrol**. Bunlar önceki 140 yerel kontrole ektir; bazı davranışlar ayrı başlangıç ve tam akış koşumlarında tekrar sınanır, 166 farklı senaryo iddiası değildir.

Önceki 25 kanıt dosyasının SHA-256 değerleri değişmedi. Yeni raporlar, betikler, paket manifestleri ve tarayıcı görüntüleri [ayrı kanıt manifestinde](../.release-candidates/f02-pilot-20261016-7/runtime-kanit-manifest.json) korunur. [Sıralı çalıştırıcı](../.release-candidates/f02-pilot-20261016-7/f02-kalan-kabul.cjs), [özet/doğrulama betiği](../.release-candidates/f02-pilot-20261016-7/f02-runtime-kabul-ozetle.cjs).

İlk çevrimdışı paketleme denemesi kısıtlı ortamda pnpm exit 1 ile durdu; başarısız manifest ve build logu saklandı. Yetkili ortamda ayrı dizine yapılan ikinci kurulum tamamlandı; kabul edilen paket yalnız ikinci dizindir.

## Kalan işler

Yedinci adayın Node 22 runtime ve gerçek tarayıcı akışı kapıları kapandı. Ana çalışma alanının sonradan değişen 15 dosyası bu adayın kapsamında değildir; bunların yayını için yeni sabit aday ve ayrı kabul gerekir. Gerçek doğal pilot kaydı/alan kabulü, üretim kapasitesi, uygun önceki sürüme dönüş, hedef üretim kurulumu ve canlı yayın açık kalır.

Gerçek şirket kayıtları, ayarları ve çalışan servisler değiştirilmedi. Daha önceki manuel pilot/otomasyon durumu bu oturumda gerçek DB üzerinden yeniden sorgulanmadı; bu çalışma otomasyon veya bildirim açmadı. Kullanıcının ilk doğal pilot kaydını erteleme kararı korunur.
