# F04 — Aktif e-belge işinde SIGTERM ve iki yönlü stalled kurtarma

23 Ekim 2026. `--f04-ebelge-aktif-prova`, önceki sağlayıcısız e-belge devir kabulünü yedi aktif iş kontrolüyle genişletir. Gerçek `main.worker.js`, e-belge kuyruğu ve dead-letter kuyruğu kullanılır. Gerçek sağlayıcı, şirket servisi veya canlı Redis kullanılmaz; ürün kaynakları ve sabit runtime paketleri değiştirilmez.

## Senaryo

Runner önce 5 HTTP/tarayıcı ve 5 restore testi ile önceki temel paket/genel worker ve sekiz e-belge devir kontrolünü çalıştırır. Önceki e-belge işleri ve dead-letter içerikleri aktif senaryolardan önce/sonra karşılaştırılır. Aktif kabul için dört yeni benzersiz job kullanılır.

### Normal kapanış

Eski ve güncel worker ayrı ayrı sınanır. Test bağlantısı yalnız geçici restore DB’de `ebelge_kayitlari` tablosuna ACCESS EXCLUSIVE kilidi alır. Var olmayan fatura kimliği için durum sorgusu kuyruğa eklenir. İşin active olduğu, gerçek worker sorgusunun tablo kilidinde beklediği worker IP’si ve PostgreSQL kilit kaydıyla doğrulanır. İş attemptsStarted=1, attemptsMade=0, stalledCounter=0 ve yaklaşık 120 saniyelik Redis kilidi taşımalıdır.

SIGTERM gönderildiğinde worker Running=true ve iş active kalmalıdır. DB kilidi finally bloğunda bırakılınca sorgu yerel kayıt bulunamadı nedeniyle atlanmış olarak tamamlanır. attemptsMade=1/attemptsStarted=1 ve dead-letter yokluğu doğrulanır. Worker OOM veya SIGKILL olmadan exit 0/143 ile kapanmalıdır. Uygulamanın DB transaction sınırı değiştirilmez; kilit kısa tutulur.

### Zorla kapanış ve kurtarma

Eski → güncel ve güncel → eski yönleri ayrı sınanır. Test bu kez geçici DB’de `faturalar` tablosunu kilitler. Var olmayan faturaya ait gönderim işi gerçek worker SELECT sorgusunda beklerken SIGKILL gönderilir. Süreç exit 137/OOMKilled=false olmalı; job active, attemptsMade=0 ve mevcut kilitle kalmalıdır. DB kilidi finally bloğunda bırakılır.

Diğer sürüm başlatılır. E-belge worker’ının **120.000 ms** kilidi ve BullMQ’nun varsayılan **30.000 ms** stalled taraması korunur; Redis kilit anahtarına doğrudan müdahale edilmez, job silinmez/yeniden eklenmez, saat ilerletilmez. Halef başlangıcında aynı job hâlâ active/attemptsStarted=1 olmalıdır. Her yön için 240 saniyelik gözlem bütçesi vardır.

Doğal kilit sonrasında aynı job yeniden işlenir. Gerçek gönderim servisi faturayı bulamaz; yerel NotFound, worker tarafından kalıcı hataya çevrilir. Job failed, attemptsStarted=2, attemptsMade=1, stalledCounter=1 olur; aynı job ID’ye bağlı dead-letter kaydı bulunmalıdır. attempts=5/backoff ayarı korunur fakat kalıcı ret yeniden denenmez. Bu, başarıyla gönderim veya dış sağlayıcı hatası testi değildir.

Sonunda eski worker yeniden başlatılır. Dört yeni job’ın sonuç/sayaçları ve iki yeni dead-letter kaydı değişmez. Önceki altı job ve üç dead-letter içeriği de korunur. Kaynak fatura ve e-belge kayıtlarının bütün içerik özeti aynı kalmalıdır.

## Sınırlar

Bu kabul dış sağlayıcı çağrısından önceki DB beklemesini, yerel atlamayı ve yerel kalıcı ret yolunu sınar. Gönderim rezervasyonu oluşturulduktan sonraki kesinti, sağlayıcının belgeyi alıp yanıt verememesi, geçici dış hata/backoff, tekrarlı SIGKILL/maxStalledCount aşımı, Redis kaybı ve çoklu aktif worker rekabeti kapsam dışıdır. Gerçek entegratör teslimi veya alan pilotu sayılmaz.

Eski paket `.release-candidates/f04-ihtiyac-20261019/runtime`, güncel paket `.release-candidates/f04-servis-gecis-20261022/yeni-api` ve önceki salt okunur overlay düzeni kullanılır. Önceki personel aktif/SIGKILL kabulleri bu modda tekrar koşulmaz. İki doğal kilit beklemesi yaklaşık dört dakika getirir; temel kabul ve paket hash doğrulamaları buna eklenir.

## Tekrar çalıştırma

Önceki odaklı HTTP API derlemesi yoksa:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-genel-http-api
```

Proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-ebelge-aktif-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-ebelge-aktif-prova
```

Üst kabul raporu, HTTP/restore logları, `tam-paket-geri-donus.json` içindeki ebelgeDevir.aktifIs, yedi yeni kontrol ve kaynak hash’leri birlikte okunur. Koşum başına ayrı evidence dizini kullanılır.

## Sonuç

İlk koşum **exit 0** ile tamamlandı: **5 gerçek HTTP/tarayıcı + 5 restore testi ve 37 tam paket/devir/aktif kesinti kontrolü geçti.** 37 kontrol önceki 30 kontrolü ve yedi yeni aktif kontrolü içerir; önceki personel SIGKILL kontrol sayıları bu koşuma eklenmez.

Eski ve güncel worker aktif durum sorgusunu SIGTERM sonrası atlanmış olarak tamamladı; ikisi de **exit 0/OOM=false** ile kapandı. Zorla kesilen gönderim işi eski → güncel yönde **126.397 ms**, güncel → eski yönde **131.218 ms** içinde yerel kalıcı ret/dead-letter sonucuna ulaştı. Bu süreler halef başlatılmasından sonuç doğrulamasına kadardır. Her iki kaynak süreç SIGKILL/exit 137/OOM=false oldu. Aynı job ID’de attemptsStarted=2, attemptsMade=1 ve stalledCounter=1 doğrulandı; iki dakikalık kilit değiştirilmedi.

Son restart sonrası dört yeni job ve iki yeni dead-letter ile önceki altı job ve üç dead-letter içeriği korundu. Kaynak fatura ve e-belge kayıtlarının bütün içerik hash’i değişmedi. 221 public tablonun yedek/restore içerikleri eşleşti. Beş F04 tablosu, şirket modu ayarları ve ihtiyaç audit içerikleri korundu; eski/güncel paket dosyaları tekrar doğrulandı. API, web, iki worker, Redis, MinIO, PostgreSQL ve ağ temizlendi. Üst raporda geciciDbSilindi=true, alt raporda temizlik=true. Sözdizimi ve diff kontrolleri başarılıdır.

Kanıt dizini `.release-candidates/f04-ebelge-aktif-20261023/`; `tam-paket-geri-donus.json` içindeki ebelgeDevir.aktifIs, yedi yeni kontrol, üst `kabul-ozeti.json`, HTTP/restore logları ve `ebelge-aktif-kaynak-kaniti.json` birlikte okunur. Ürün kaynakları/migration bu dilimde değiştirilmedi; önceki HTTP derlemesi ve sabit paketler kullanıldı.

Gerçek sağlayıcı teslimi, gönderim rezervasyonu sonrası kesinti, belirsiz dış yanıt/geçici hata, tekrarlı kesinti/Redis kaybı, hedef işletim/hacim, kapasite ve gerçek alan pilotu açık kalır.
