# F04 — İzole servis ve trafik geçişi

22 Ekim 2026. Önceki tam eski paket ve özel worker provaları şema uyumunu doğrulamıştı. Bu dilim aynı giriş adresinin arkasında güncel tam API/web → bakım → eski API/web → bakım → güncel API/web sırasını sınar. Gerçek şirket servisi, host portu, TLS ayarı veya canlı yönlendirme değiştirilmez.

## Paketler

Güncel tam API, `tsc -p apps/api/tsconfig.json --outDir /tmp/tekir-f04-servis-gecis-api` ile derlendi. Ayrı prova kopyasında bu çıktı, mevcut üretilmiş güncel Prisma istemcisi ve workspace dist dosyaları, 19 Ekim runtime bağımlılık tabanının üzerine salt okunur bind olarak yerleştirilir. Bu düzen tam AppModule’ü çalıştırır; temiz frozen bağımlılık kurulumu veya bütün platformun regresyon kabulü sayılmaz. API kaynak hash’leri manifestte kayıtlıdır; çalışma alanındaki diğer modül değişiklikleri bu izole derlemeye dahil olabilir, yayınlanmış sayılmaz.

Güncel web önceki başarılı `rT6H2smlP0AaroR2y9q90` derlemesidir; yeniden derlenmez. Ayrı prova kopyasında hosta mutlak `node_modules` bağı göreli yapılır, eksik next/react bağlantıları aynı sürümlerin izlenmiş paket içi dosyalarına bağlanır ve işe yaramayan `/proc/self` izleme artığı çıkarılır. İlk konteyner koşumu ayrıca Next dinamik erişim modülünün izleme çıktısında eksik kaldığını gösterdi. Paketleyici, izlenmiş runtime paketlerinin tam dosyalarını aynı kurulu sürümlerden alacak şekilde düzeltildi. Next 15.5.20 ve React 19.2.7 sürümleri yerel paketlerden doğrulanmıştır. Derlenen JS değişmez. Bütün bağlantıların paket içinde çözüldüğü kontrol edilir.

Kalıcı `f04-gecis-paketle.mjs` aracı aynı paketleri boş `/tmp/tekir-f04-gecis-paket-dogrula-r2` dizininde yeniden üretti. 1.304 API ve 10.114 web dosyasının hash’leri provadaki kopyalarla aynıdır; `paketleyici-tekrar-kabulu.json` bu eşitliği kaydeder. Mevcut paket üzerine yazılmaz.

Eski API ve web önceki tam paket provasındaki sabit 19 Ekim arşivleridir. Paket hash’leri koşum öncesinde/sonrasında doğrulanır. Güncel ve eski sürümler aynı sentetik DB, Redis, MinIO ve test JWT/oturum anahtarlarını kullanır. Hiçbir uygulama `.env` dosyası yüklenmez. Worker devri bu modda yapılmaz; genel ve özel worker kabulleri önceki ayrı kanıtlardır.

Güncel web paketi, tam DB provasından önce `--network none` Node 22 konteynerinde gerçek `/giris` isteğinde 200 ile doğrulanır. Burada host node_modules veya host uygulama dosyaları bağlanmaz. Paketleyicinin ilk eksik izleme kopyası `f04-servis-gecis-20261022-ilk/`, tamamlama sırasında durdurulan ara paket `f04-servis-gecis-20261022-paket-ilk/` altında korunur. İlk tam geçiş denemesinde API hazır olmuş, web modül eksikliği nedeniyle trafik açılmamıştır; geçici kaynaklar temizlenmiştir.

## Trafik kapısı ve isteklerin tamamlanması

`f04-gecis-proxy.cjs` yalnız izole test ağına açılan Node HTTP geçiş kapısıdır; işletim ortamındaki reverse proxy’nin yerine kurulmaz. Dış istekler tek 8080 girişinden geçer; kontrol portu yalnız proxy’nin loopback adresinde ve koşum nonce’u ile kullanılır. Başlangıç ve iki geçiş arası bakım modudur: 503, `Retry-After` ve `no-store` döner.

Hedef API `/health/ready` ve web `/giris` hazır değilse geçiş isteği 409 ile reddedilir. Devam eden HTTP istekleri varken hedef değiştirilemez. Test aracı nonce başlığıyla kabul edilmiş bir `/auth/ben` isteğini kısa süre bekletir; bakım açıldıktan sonra yeni istek 503 alırken bu istek başladığı sürümde tamamlanır. Sayaç sıfırlanınca eski API/web süreçleri durdurulur. Bu, HTTP isteği boşaltma kontrolüdür; gerçek DB’de uzun iş/transaction kesinti bütçesi yerine geçmez.

Yeni F04 yazmaları geçişten önce yönetici tarafından kapatılır. Eski sürüm bu şirket kapısını bilmediğinden, yalnız modu kapatmak eski API’ye gönderilen yeni plan payload’ını güvenli kılmaz. Eski sürüm aktifken geçiş kapısı tarihli plan rotalarını ve `POST /api/v1/satin-alma/talepler` gövdesinde `ihtiyacPlaniId` alanı taşıyan istekleri 409 ile reddeder. Böylece yeni sekmenin plan bağlı isteği eski API’de sıradan talebe sessizce dönüşmez. Anlık önizleme ve mevcut talep okuması açık kalır. Normal talebe elle kopyalanmış sayıların kaynağı varsayılmaz.

Bu kapı izole prova aracıdır. Gerçek geçişte aynı kuralın hedef proxy/erişim düzeninde uygulanması, doğrudan eski API erişiminin sınırlandırılması ve worker’ların kontrollü devri ayrıca doğrulanmalıdır. Şirket ayarının eski koda uygulanacağı varsayılmaz.

## Veri ve oturum kontrolleri

Runner önce 5 gerçek HTTP/tarayıcı ve 5 restore testini, 219 public tablonun yedek/restore eşitliğini doğrular. Geçiş, tarihli plan/pay ve bağlı satın alma talebi bulunan restore DB’sinde yapılır. Yeni sentetik yöneticiye gerçek parolalı oturum açılır; ilk token eski API’de de doğrulanır. Her sürüm aşamasında ayrıca yeni Chromium oturumuyla gerçek giriş formu açılır. Bu, tek tarayıcı sekmesinin sürüm değişimi boyunca kesintisiz yenilendiği iddiası değildir.

Güncel API’de plan ve bağlı talep okunur. Eskiye geçerken bakım/kapalı mod korunur; eski anlık ihtiyaç ve mevcut talep okunur, yeni plan isteği reddedilir. Güncele dönünce mod hâlâ kapalı olmalıdır. Yalnız sentetik fixture’da yönetici salt okunur açar; tarihsel snapshot, güncellik ve bağlı talep aynı kalmalıdır.

Beş F04 tablosunun içerik özeti ve satın alma talebi sayısı önce/sonra eşleşir. Seçili şirketin iki beklenen mod audit’i (`kapali`, `salt_okunur`) ayrıca doğrulanır; eski mod audit kayıtları değişmez. Bu yüzden bütün DB’nin veya mod ayarının aynı kaldığı iddia edilmez. Restore aşamasının 219 tabloluk eşitliği ayrı kontroldür.

## Sonuç

**Ağsız web kabulü, 5 HTTP/tarayıcı testi, 5 restore testi ve 10 servis/trafik geçişi kontrolü geçti.** Tam güncel API derlemesi exit 0 ile tamamlandı. Güncel, eski ve geri açılan güncel web’de üç ayrı gerçek Chromium form girişi başarılıdır; API yanıtı taklidi kullanılmadı. İlk yeni oturumun token’ı eski API’de doğrulandı. Ekran görüntüsünde geri açılan planın güncel olduğu, aynı talebe bağlı kaldığı ve şirketin salt okunur olduğu görüldü.

Bakımda 503, devam eden HTTP isteği varken geçişin 409 ile engellenmesi, kabul edilmiş isteğin tamamlanması ve hazır olmayan yeni hedefe geri açılışın reddi doğrulandı. Eski sürüm aktifken tarihli plan rotası ve plan bağlı POST 409 aldı; ikinci talep oluşturulmadı. Güncel sürüme dönünce kapalı mod korunmuştu; yönetici salt okunur seçtikten sonra aynı tarihsel snapshot ve talep bağı okundu.

Beş F04 tablosunun içerik özeti ve talep sayısı değişmedi. Yalnız beklenen iki mod audit’i eklendi; önceki mod audit’leri korundu. Paket dosyaları önce/sonra eşleşti. API/web/proxy/Chromium, Redis/MinIO, ağ ve geçici PostgreSQL temizlendi; ana koşum exit 0 ile bitti. JavaScript sözdizimi ve diff kontrolleri geçti. Güncel API kaynakları derleme manifestiyle ve F04 web kaynakları önceki başarılı build ile eşleşti. Üretilmiş Prisma şeması ham metinde boşluk/öznitelik sırası farkı taşır; depo şemasının yalnız /tmp kopyasına Prisma format uygulanınca baytlar eşleşti. Depo şeması değiştirilmedi; ayrı şema kanıtı saklandı.

Bu dilimde ürün kaynakları veya migration değiştirilmedi; paketleme ve prova araçları eklendi. Önceki 48 DB/26 fixture, 15 tam eski paket ve 8 özel worker kontrolü yeniden koşulmuş sayılmaz. Tekrar eden teknik kabul adımları bağımsız iş senaryosu sayısı olarak toplanmaz.

## Tekrar koşumu

```bash
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir /tmp/tekir-f04-servis-gecis-api
F04_TAM_API_DIST=/tmp/tekir-f04-servis-gecis-api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone node apps/api/scripts/f04-gecis-paketle.mjs
F04_API_DIST=/tmp/tekir-f04-mod-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-servis-gecis-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-servis-gecis-prova
```

Paketleme komutu ilk kurulum içindir; hazır kanıt paketinin üzerine çalıştırılmaz. Bağımsız paketleyici kontrolü için `F04_GECIS_PAKET_ROOT` boş bir geçici dizine ayarlanır. Önceki odaklı API/web `/tmp` çıktıları yoksa ilgili kontrollü açılış belgesine göre yeniden üretilmelidir.

Kanıt dizini `.release-candidates/f04-servis-gecis-20261022/`; `servis-gecis-ozeti.json`, ana `kabul-ozeti.json`, paket manifestleri, HTTP/restore logları, üç tarayıcı ekranı ve `kaynak-kaniti.json` birlikte okunur. Gerçek alan pilotu, kapasite kararı, hedef hacim/kesinti bütçesi, hedef servis yöneticisi/TLS ve tam yayın adayı kabulü açık kalır.
