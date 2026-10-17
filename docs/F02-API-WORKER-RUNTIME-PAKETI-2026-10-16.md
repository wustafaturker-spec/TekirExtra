# F02 API/worker bağımlılık paketi ve Node 22 provası

**Tarih:** 16 Ekim 2026. Dördüncü adayın API/worker kodu, üretim bağımlılıkları ve yeniden üretilmiş workspace çıktıları ayrı dizinde paketlendi. Gerçek şirket verileri, ayarlar ve çalışan servisler değiştirilmedi. İlk doğal pilot kaydı kullanıcı isteğiyle ertelenmiş durumda.

## Paket kimliği

Ana dizin: `.release-candidates/f02-pilot-20261016-4/`.

| Alan | Değer |
| --- | --- |
| Kaynak aday | `f02-20261016T070519121Z-c0319aa2` |
| Kaynak SHA-256 | `70a4f6d6411b76864941d9bdd753174330a50d581fda3c7eae7afda4b2a63e95` |
| Özgün API/web dosya özeti | `6e2637c9b7feb85ce4e40cc4a5f3971ce13d375d48c09fe6bb37f4b575bd237c` |
| Runtime dizini | `api-worker-runtime-20261016T172341681Z-5b7b66` |
| Runtime dosya özeti | `be5a4dca2e7826d0c13468dd04e6751929773246e1ce9d1a9063671a4fc3b2dc` |
| Dosya/bağlantı girdisi | 23.577; bunların 1.009'u paket içinde çözülen sembolik bağlantı |
| Doğrudan API üretim bağımlılığı | 29 |

Bu runtime manifesti özgün aday manifestine ek kanıttır. Ana adayın API/web dosyaları değiştirilmedi. Runtime kökündeki manifest tüm dosya ve sembolik bağlantı özetlerini içerir; `.env` dosyası ve paket dışına çıkan bağlantı kabul edilmez.

## Üretim yöntemi

[Paketleme betiği](../.release-candidates/f02-pilot-20261016-4/f02-runtime-paketle.cjs) kilitli pnpm çözümünü ayrı dizinde `--prod --offline --frozen-lockfile --ignore-scripts` ile kurdu. Mevcut host `node_modules` dizini kopyalanmadı. Paket önbelleği kullanıldı; bağımlılıkların internetten yeniden indirildiği iddia edilmez. `shared` ve `baglanti` kaynakları bu dizin için yeniden derlendi. Prisma 6.19.3 istemcisi paketin kendi şemasından hedef dizine üretildi; şema eşitliği biçimsel boşluk/yorum farklarından bağımsız doğrulandı.

Kurulum host Node 24.14.0 üzerinde yapıldı; çalışabilirlik ayrıca Node 22.23.2 altında sınandı. Native Argon2 hash/doğrulama ve tüm doğrudan bağımlılıkların paket içinden yüklenmesi geçti. Her test öncesi/sonrası dosya özetleri karşılaştırıldı.

## Tam API/worker başlangıcı: 11 kontrol

[Prova betiği](../.release-candidates/f02-pilot-20261016-4/f02-runtime-prova.cjs), [sonuç raporu](../.release-candidates/f02-pilot-20261016-4/f02-runtime-prova.json).

Geçici PostgreSQL, uygulama rolü, Redis ve MinIO ayrı test ağında kullanıldı. Gerçek şirket bağlantısı kullanılmadı. API ve worker yalnız salt okunur `/runtime` paketinden başlatıldı; proje dizini konteynere bağlanmadı. Sabit `sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55` imajı Node/OS tabanı olarak kullanıldı; içindeki 20 Eylül uygulaması çalıştırılmadı.

1. Paket dosyaları ve sembolik bağlantılar doğrulandı.
2. Node 22 altında 29 bağımlılık, Prisma ve native Argon2 çalıştı.
3. Tam API başlangıcında PostgreSQL, Redis ve depo hazır durumuna geldi.
4. Sentetik kullanıcının gerçek parolasıyla HTTP girişi geçti.
5. Kimlik, cari ve fatura okumaları başarılı oldu.
6. HTTP üzerinden takip ve görüşme oluşturuldu.
7. Ödeme sözü oluşturulup kaynakları okundu.
8. Nakit planında aynı fatura/söz çift sayılmadı.
9. Tam worker başlangıcında geciken söz mevcut takibe bir kez bağlandı.
10. Uygulama içi bildirim bağlantısı ve görüşme korundu; e-posta kapalı kaldı.
11. Salt okunur ayardan sonra HTTP yazma isteği 403 ile engellendi.

Raporun genel sonucu `gecti`, kontrol sayısı 11 ve temizlik sonucu `true`. Hazır olma kontrolünün satırındaki `durum: ready`, gerçek sağlık yanıtından gelir; başarısız kontrol değildir. Geçici konteynerler ve ağ temizlendi.

## Chromium, PDF ve taşınabilir arşiv

[Arşiv betiği](../.release-candidates/f02-pilot-20261016-4/f02-runtime-arsivle.cjs), [sonuç raporu](../.release-candidates/f02-pilot-20261016-4/f02-runtime-arsiv.json). Sonuç `arsiv_hazir`.

Playwright 1.61.1'in istediği Chromium ve headless shell 1228 (`149.0.7827.55`) ile ffmpeg 1011 ayrı browser dizinine kopyalandı. Hosttaki diğer tarayıcı sürümleri alınmadı. Browser dizini özeti `2870974a0ded7a3355e900a0350cd3458c130fd7068b8ab08194f5cd74859e0b`.

Node 22 altında ağsız ve salt okunur konteynerde gerçek derlenmiş `PdfService.htmlToPdf` çağrıldı. 25.830 baytlık PDF üretildi; PDF başlığı ve `pdftotext` çıktısında `Çığ`, `Şişli`, `Ürün` doğrulandı. PDF SHA-256: `e21bf0da260acc25390179f9113f736b68f7cf819f24ee0029663e9c6bb1b0c1`. Bu, önceki 11 kontrole ek bir PDF kontrolüdür; toplam 12 yeni kontrol geçti.

| Arşiv alanı | Değer |
| --- | --- |
| Dosya | `api-worker-runtime-20261016T172341681Z-5b7b66.tar.gz` |
| Boyut | 378.215.854 bayt; yaklaşık 361 MiB |
| SHA-256 | `6007a3d47c472ed0467357169a9d308c05f03acf6eaf2f927100e3c6a65a2ea9` |
| İçerik | Runtime, browser dizini, iki manifest ve işletim README'si |
| Kontroller | gzip bütünlüğü, 27.872 güvenli göreli arşiv yolu, paket/browser son dosya özeti karşılaştırması geçti |

`PLAYWRIGHT_BROWSERS_PATH`, açılmış `api-worker-runtime-20261016T172341681Z-5b7b66-browsers` dizininin mutlak yolu olmalıdır. Arşiv gerçek şirket verisi veya `.env` içermez. Prova raporları ve web standalone ana aday dizininde ayrıca tutulur.

## İşletim sınırları

Paket Linux x64, glibc/OpenSSL 3 ve sınanan Node 22 tabanına aittir. Node yürütücüsü ve Chromium sistem kitaplıkları pakete dahil değildir. ARM, Alpine/musl veya başka işletim sistemi kabulü yapılmadı. Ortam değişkenleri dışarıdan sağlanır. Migration uygulaması, servis yöneticisi, proxy ve üretim ortamında başlangıç kabulü ayrı işletim adımlarıdır.

API girişi `node apps/api/dist/main.js`, ayrı worker girişi `node apps/api/dist/main.worker.js` olur; çalışma dizini açılmış runtime köküdür. Web standalone paketi ana adayda ayrı durur. Bu çalışma gerçek pilot alan kabulünü, üretim kapasitesini, uygun eski sürüme dönüşü veya canlı yayını tamamlamaz. [20 Eylül eski uygulama üçlüsünün uyumsuzluğu](F02-ESKI-IMAJ-UYUMU-VE-BAGIMLILIK-ENVANTERI-2026-10-16.md) geçerlidir.
