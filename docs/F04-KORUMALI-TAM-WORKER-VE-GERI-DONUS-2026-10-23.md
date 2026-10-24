# F04 — Arama desteği korumalı tam worker ve kontrollü geri dönüş

23 Ekim 2026. Önceki doğrudan servis kabulünde eklenen arama desteği koruması bu dilimde gerçek `main.worker.js`, tam AppModule, BullMQ ve gerçek Sovos adaptörü üzerinden sınanır. Sovos adaptörü yalnız internal Docker ağındaki SOAP fixture’ına yönlendirilir; gerçek sağlayıcı hesabı veya dış adres kullanılmaz.

## Paket

Güncel tam API `/tmp/tekir-f04-korumali-api` dizinine derlenir. `f04-korumali-api-paketle.mjs` çıktıyı, güncel Prisma istemcisini ve workspace dist dosyalarını `.release-candidates/f04-ebelge-korumali-20261023/yeni-api` dizinine kopyalar. Arama desteği korumasının derlemede bulunduğunu kontrol eder. Dosya/source manifesti yazılır; mevcut paket üzerine yazılmaz. Runtime bağımlılık tabanı önceki 19 Ekim arşividir; temiz bağımlılık kurulumu değildir. Yeni web paketi yoktur.

Runner bu sabit korumalı paketi salt okunur overlay olarak çalıştırır. Önceki worker paketini ve eski API/web arşivlerini değiştirmez. Güncel paketin bütünlüğü başta/sonda doğrulanır; yeni korumayı eski pakette varmış gibi kabul etmez.

## Kabul

`--f04-korumali-worker-prova` önce 5 HTTP/tarayıcı, 5 restore ve temel tam paket/genel worker devir kabulünü çalıştırır. Ardından yedi odaklı kontrol ekler:

1. E-belge kuyruğu pause edilir, eski worker durdurulur. Yeni fixture tenant’ında e-Fatura/e-İrsaliye kapalı, e-Arşiv açık tutulur. Aktif Sovos bağlantısı yalnız nonce içeren internal SOAP adresini kullanır. Korumalı tam worker başlatılır; queue pause korunur.
2. Yeni faturanın ilk gönderimi resume sonrasında gerçek Sovos adaptöründen tek `sendInvoice` SOAP isteğiyle tamamlanır. Fixture UUID döner; gerçek servis ref’i ve XML arşivini yazar.
3. Hata durumundaki başka fatura için yeniden gönderim açılır. Sovos adaptörü `belgeAra` sağlamadığından güncel servis gönderimi durdurur. **attempts=5, exponential backoff=5.000 ms** ayarları değiştirilmez. Yaklaşık 75 saniyelik doğal backoff sonunda beş deneme ve tek dead-letter beklenir; SOAP gönderimi sıfır kalır.
4. Güncel worker yeniden başlatılır. İlk gönderimin sonucu ve gönderim sayısı, failed job ve dead-letter içeriği korunur.
5. Geri dönüşten önce bütün e-belge kuyruğu pause edilir, aktif iş sayısının sıfıra indiği doğrulanır. Güncel worker normal durdurulur. Yeni riskli gönderim kuyruğa eklenip eski worker açılır; e-belge işi attemptsStarted=0 kalmalı, SOAP gönderimi olmamalıdır. Aynı eski worker ayrı personel kuyruğunda boş kadro işini tamamlamalıdır.
6. Eski worker durdurulur, güncel worker pause korunarak açılır. Resume sonrasında bekleyen gönderim yeni koruma tarafından reddedilir. Bu gate fixture’ı bir denemeyle eklenir; varsayılan beş deneme/backoff kabulü önceki ayrı iştedir.
7. Son geri dönüşte kuyruk yeniden pause edilir, aktif iş sıfırken güncel worker durdurulur ve eski worker açılır. Kuyruk pause kalır; ilk gönderimin arşivi/ref’i, finansal fatura/satır/hareket içerikleri ve tek SOAP gönderimi korunur.

## Geri dönüş sınırı

Eski worker arşivi yeni korumayı içermez. Bu nedenle eskiye dönüşte e-belge tüketimini açık tutmak bu kabulün güvenli yolu değildir. Burada queue pause bütün tenant’ların e-belge kuyruğuna uygulanır; yalnız bir tenant’ı durdurduğu varsayılmaz. Diğer kuyruklar açık kalır. Bu bir izole operasyon provasıdır; hedef servis yöneticisi/proxy’ye otomatik geçiş kapısı kurulmuş sayılmaz. Doğrudan eski API’den gelen yeni iş de Redis’te aynı pause kuyruğunda bekler; bu dilimde eski HTTP retry endpoint’i ayrıca sınanmaz.

Fixture SOAP yanıtı gerçek Sovos protokol uyumluluğu/hesabı veya GİB kabulü kanıtı değildir. Test gerçek adapter’ın ZIP/SOAP üretimini ve yanıt çözümlemesini çalıştırır; fixture alanları sınırlıdır. Rezervasyon sonrası dış kabul/yanıt kaybı, doğal 15 dakika rezervasyon yaşı, Redis kaybı, tekrarlı kesinti, hedef hacim ve alan pilotu açık kalır. Önceki uzun SIGKILL modları bu koşumda tekrar çalıştırılmaz.

## Tekrar çalıştırma

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir /tmp/tekir-f04-korumali-api
node apps/api/scripts/f04-korumali-api-paketle.mjs
```

Önceki odaklı HTTP derlemesi ve standalone web paketiyle:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-korumali-worker-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-korumali-worker-prova
```

Paketleyici sabit paketin üzerine yazmaz; tekrar hazırlıkta yeni paket dizini/sürümü belirlenmelidir. Kanıtlar `tam-paket-geri-donus.json` içindeki korumaliWorker, yedi yeni kontrol, üst kabul raporu, HTTP/restore logları ve paket manifestiyle birlikte okunur.

## Sonuç

İlk koşum **exit 0** ile tamamlandı: **5 gerçek HTTP/tarayıcı + 5 restore testi ve 29 tam paket/genel worker/korumalı kabul kontrolü geçti.** 29 kontrol 22 temel kontrol ve yedi yeni kontrolü içerir. Önceki aktif/SIGKILL modları bu koşumda tekrar çalıştırılmadı. Güncel tam API derlemesi, yeni sabit paketleme ve sözdizimi/diff kontrolleri başarılıdır.

İlk gönderim gerçek SovosEntegratorAdapter üzerinden **tek sendInvoice** ile tamamlandı ve XML arşivlendi. Doğal varsayılan backoff kontrolü **78.003 ms** sürdü; attemptsMade=5/attemptsStarted=5 ve tek dead-letter oluştu. Bu faturada SOAP gönderimi sıfır kaldı. Restart sonrası ilk sonuç, tek gönderim ve dead-letter içeriği korundu. Fixture bir getStatus çağrısını da yerel yanıtladı; bu ayrıca gerçek sağlayıcı durum kabulü sayılmaz.

Eskiye dönüş öncesinde e-belge kuyruğu pause ve aktif iş sıfır olarak doğrulandı. Eski tam worker yeni riskli işi başlamadan bekletti; ayrı personel kuyruğundaki iş tek denemede tamamlandı. Korumalı worker’a pause korunarak dönüldü, resume sonrası tek denemeli gate fixture’ı gönderim yapmadan reddedildi. Son eskiye dönüş de pause halinde kaldı. Finansal fatura/satır/hareket içerikleri ile ilk e-belgenin ref/XML arşivi korundu.

221 public tablonun yedek/restore içeriği eşleşti. Beş F04 tablosu, şirket modu ve ihtiyaç audit içerikleri değişmedi. Eski/yeni paketler koşum sonunda tekrar doğrulandı. API, web, iki worker, SOAP fixture, Redis, MinIO, PostgreSQL ve ağ temizlendi; üst raporda geciciDbSilindi=true, alt raporda temizlik=true. Pause yalnız geçici Redis’te uygulandı; hedef şirket kuyruğu değiştirilmedi.

Kanıt dizini `.release-candidates/f04-korumali-worker-20261023/`; `tam-paket-geri-donus.json` içindeki korumaliWorker ve yedi yeni kontrol, üst `kabul-ozeti.json`, HTTP/restore logları, `korumali-worker-kaynak-kaniti.json` ve `.release-candidates/f04-ebelge-korumali-20261023/yeni-api-manifest.json` birlikte okunur.

Gerçek sağlayıcı hesabı/protokol kabulü, hedef ortamda pause/aktif iş sıfır geçiş kapısı, güncel API/web tam trafik geçişi, doğal rezervasyon süresi, Redis kaybı, hedef hacim ve alan pilotu açıktır.
