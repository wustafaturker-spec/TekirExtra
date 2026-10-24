# F04 — Kısmen tamamlanan personel işinde SIGKILL ve stalled kurtarma

23 Ekim 2026. `--f04-worker-kurtarma-prova`, önceki aktif SIGTERM kabulünü iki yönlü zorla kapanma/kurtarma kabulüyle genişletir. Eski → güncel ve güncel → eski yönleri aynı internal Redis ve geçici restore DB üzerinde çalışır. Ürün kaynakları, runtime paketleri ve worker kilit ayarları değiştirilmez; gerçek şirket servisine veya kuyruğuna bağlanılmaz.

## Senaryo

Runner önce 5 gerçek HTTP/tarayıcı, 5 restore ve önceki 26 tam paket/devir kontrolünü çalıştırır. Bir personelli SIGTERM provasından sonra her kurtarma yönü için iki yeni personel eklenir. İstihdam ve net ücret geçmişleri vardır; aynı tenant/dönemde mevcut bordrolar korunur.

Geçici DB’de nonce ile adlandırılmış bir BEFORE INSERT trigger yalnız ikinci yeni personelin bordrosunda advisory kilit bekletir. İlk personelin bordrosu ayrı transaction’da commit olur. Worker’ın DB sorgusu, kaynak konteynerin ağ adresi ve `pg_blocking_pids` ile doğrulanır; işin active, attemptsStarted=1, attemptsMade=0, stalledCounter=0 ve beş dakikalık Redis kilidinin mevcut olması gerekir. İlk yeni bordro görünürken ikinci bordro henüz yoktur.

Kaynak worker’a **SIGKILL** gönderilir. Sürecin Running=false, OOMKilled=false ve exit 137 olduğu doğrulanır. SIGKILL ikinci personelin henüz commit edilmemiş INSERT transaction’ını sonlandırır. Ayrı bağlantıdaki advisory kilit finally bloğunda bırakılır ve test trigger/function’ı kaldırılır; ilk bordro ve önceki kayıtların tamamı korunmalıdır.

Diğer sürümün gerçek `main.worker.js` süreci başlatılır. Worker’ın personel kilidi **300.000 ms**, BullMQ stalled taraması varsayılan **30.000 ms** olarak kalır. Test kodu Redis kilit anahtarına doğrudan yazmaz, kilit silinmez veya kısaltılmaz, saat ilerletilmez, job yeniden oluşturulmaz. Halef başlangıcında iş active ve ilk işleme denemesinde kalmalı; mevcut kilidin doğal olarak sona ermesi beklenir. Her yönün kurtarma bütçesi 420 saniyedir.

Kurtarma sonrasında **aynı job ID** completed, attemptsStarted=2, attemptsMade=1 ve stalledCounter=1 olmalıdır. Bu, tamamlanmış başarısız denemenin yeniden denenmesi değil, SIGKILL ile sonucu yazılamayan aktif işin stalled olarak yeniden işlenmesidir; attempts=1 ayarı korunur. Sonuç yalnız eksik ikinci bordronun oluşturulduğunu ve diğerlerinin mevcut bulunduğunu göstermelidir. İlk yeni bordro ve bütün önceki bordro/kalem içerik hash’leri aynı kalır; tenant/personel/dönem başına tek kayıt vardır.

İkinci yönde aynı senaryo yeni iki personelle tekrarlanır. Sonunda eski worker yeniden başlatılır; kurtarılan iki işin sayaçları ve beş bordronun tamamı korunmalıdır. Test trigger/function’ının kaldırıldığı ayrıca doğrulanır.

## Ortam ve sınırlar

Eski paket `.release-candidates/f04-ihtiyac-20261019/runtime`, güncel paket `.release-candidates/f04-servis-gecis-20261022/yeni-api`’dir. Önceki salt okunur overlay düzeni kullanılır; yeni temiz bağımlılık kurulumu değildir. Sabit paket hash’leri ve F04 plan/bağ/ayar/audit içerikleri tam kabulün sonunda tekrar karşılaştırılır.

Bu kabul kısmi bordro commit’i sonrasında ilk stalled kurtarmayı sınar. Tekrar tekrar SIGKILL/maxStalledCount aşımı, Redis kaybı/restore, çoklu worker rekabeti, e-belge veya dış sağlayıcının belirsiz teslimi kapsamında değildir. Bordro mevzuat kabulü ve gerçek şirket pilotu sayılmaz. Tekrarlı işlemeye uygun olmayan dış etkiler bu personel testiyle güvenli ilan edilmez.

## Tekrar çalıştırma

Önceki odaklı API derlemesi mevcut değilse yeniden üretin:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-genel-http-api
```

Proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-worker-kurtarma-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-worker-kurtarma-prova
```

Doğal kilit süresi iki yönde toplam yaklaşık on dakika bekleme getirir; önceki kabul ve paket doğrulamaları buna eklenir. Önceki raporları korumak için yeni koşumda ayrı evidence dizini kullanılır.

## Sonuç

İlk koşum, prova gözlemcisinin BullMQ 6 ham Redis istemcisine eski API ile erişmesi nedeniyle durdu; SIGKILL uygulanmadı ve geçici kaynaklar temizlendi. Rapora `.release-candidates/f04-worker-kurtarma-20261023-ilk-deneme/` altında erişilir. Erişim `q.getBackend().client` olarak düzeltildi. Aynı kuyruk gözlem kodu ağdan yalıtılmış geçici Redis üzerinde waiting, attemptsMade=0, attemptsStarted=0, stalledCounter=0 ve mevcut olmayan kilit için PTTL=-2 sonucunu verdi; kontrol konteynerleri temizlendi.

Düzeltilmiş tam koşum **exit 0** ile tamamlandı: **5 gerçek HTTP/tarayıcı + 5 restore testi ve 31 tam paket/devir/kurtarma kontrolü geçti.** 31 kontrol önceki 26 kontrolü de içerir; bağımsız yeni iş senaryosu sayısı olarak toplanmaz.

Eski → güncel kurtarma **307.642 ms**, güncel → eski kurtarma **308.163 ms** sürdü. Bu süreler halef başlatılmasından sonuç/bordro doğrulamasına kadardır; yalnız Redis kilidinin ömrü değildir. İki yönde de kaynak worker exit 137/OOMKilled=false oldu. Aynı job ID, attemptsStarted=2, attemptsMade=1, stalledCounter=1 ile tamamlandı. Önceden commit edilmiş bordro değişmedi; yalnız eksik ikinci bordro oluşturuldu. Son restart sonrasında beş bordronun ve kalemlerinin içerik hash’i aynı kaldı.

Bu koşumdaki **221 public tablonun** yedek/restore içerikleri eşleşti. Beş F04 tablosu, şirket modu ve ihtiyaç audit içerikleri korundu. Eski/güncel paket dosyaları tekrar doğrulandı. Geçici trigger/function kaldırıldı; API, web, iki worker, Redis, MinIO, PostgreSQL ve ağ temizlendi. Üst raporda geciciDbSilindi=true, alt raporda temizlik=true. Sözdizimi ve diff kontrolleri geçti.

Kanıt dizini `.release-candidates/f04-worker-kurtarma-20261023/`; `tam-paket-geri-donus.json` içindeki isKurtarma ve beş yeni kontrol, üst `kabul-ozeti.json`, HTTP/restore logları ve `worker-kurtarma-kaynak-kaniti.json` birlikte okunur. isKurtarma.redisAnahtarinaYazildi=false, test kodunun kilit anahtarına doğrudan müdahale etmediğini belirtir; BullMQ’nun normal job/kilit yazmaları devam eder. Ürün kaynakları veya migration bu dilimde değiştirilmedi; önceki HTTP derlemesi ve sabit paketler kullanıldı.

Diğer kuyruklar/dış sağlayıcı teslimi, tekrarlı kesinti/maxStalledCount aşımı, Redis kaybı, hedef servis yönetimi, hacim/kesinti bütçesi, kapasite kararı ve gerçek alan pilotu açık kalır.
