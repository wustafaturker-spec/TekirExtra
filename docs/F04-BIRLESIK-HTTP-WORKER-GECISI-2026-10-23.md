# F04 — Aynı koşumda API/web ve gerçek worker devri

23 Ekim 2026. `--f04-birlesik-gecis-prova`, önceki korumalı API/web geçişini aynı DB/Redis/internal ağ üzerinde gerçek `main.worker.js` süreçleriyle birleştirir. Güncel korumalı sabit API/worker paketi, önceki standalone web ve sabit eski API/web/worker kullanılır. Yeni ürün derlemesi, gerçek sağlayıcı hesabı veya hedef şirket servisi değişikliği yoktur.

## Geçiş sırası

İlk HTTP/tarayıcı, restore, paket bütünlüğü ve yeni API/web girişinden sonra gerçek Redis’e sentetik bir bekleyen e-belge işi eklenir. Bu noktada tüketiciler henüz açılmamıştır. Kontrol daha sonra şu sırayı uygular:

1. Bakım açılır; pause olmayan kuyrukla eski trafik açılması reddedilir. E-belge kuyruğu pause edilir, aktif sıfır doğrulanır. Güncel gerçek worker başlatılır ve sağlık kontrolü geçer. Güncel HTTP trafiği açılır. Aynı worker ayrı personel kuyruğunda boş kadro işini tek kez tamamlar; e-belge işi başlamadan kalır.
2. F04 yazması kapatılır. Kabul edilmiş HTTP isteği kontrollü bekletilir, bakım açılır ve yeni HTTP 503 alır. İstek tamamlanıp aktif HTTP sıfıra indiğinde queue pause/aktif sıfır tekrar denetlenir. Güncel worker SIGTERM ile normal durdurulur; ancak bundan sonra yeni API/web kapatılır.
3. Eski API/web hazır edilir. İki worker’ın da kapalı olduğu ve queue pause/aktif sıfır doğrulanır. Eski worker, güncel worker kapandıktan sonra başlatılır; sağlık kontrolünden sonra eski HTTP trafiği açılır.
4. Eski HTTP ve worker birlikte çalışırken e-belge resume çağrısı orkestratör tarafından reddedilir. Kuyruk duraklatılmış ve bekleyen iş hiç başlamamış kalır. Eski worker personel kuyruğundaki ayrı işi tek kez tamamlar. Eski web form girişi/oturum ve temel ihtiyaç/talep okuması çalışır; yeni plan payload’ı eskiye aktarılmaz.
5. Güncele dönüşte önce bakım, sıfır aktif HTTP, queue pause ve sıfır aktif e-belge doğrulanır. Eski worker normal durdurulur; ardından eski API/web kapatılır. Yeni API/web ve güncel worker pause korunarak başlatılır. Yeni trafik worker hazır olduktan sonra açılır.
6. Orkestratör resume için proxy’nin yeni modda, eski worker’ın kapalı, güncel worker’ın sağlıklı ve güncel API’nin ready olmasını zorunlu tutar. Resume sonrasında aynı bekleyen e-belge işi ilk kez işlenir. Sentetik var olmayan fatura kimliği yerel NotFound ile tek kalıcı ret/dead-letter üretir. attempts=1, attemptsStarted=1, stalledCounter=0 ve aynı job verisi doğrulanır.
7. Güncel worker yeniden başlatılır. HTTP 200 sürer, eski worker kapalı kalır. Job’ın son durumu/sayaçları ve dead-letter içeriği değişmez. Üç gerçek Chromium form girişi, plan/pay/talep korunumu ve yalnız beklenen iki mod audit’i önceki akışla birlikte doğrulanır.

Worker sağlıkları Docker Running/OOM durumu ve gerçek 9464 health endpoint’iyle denetlenir. Kaynak worker normal durmadan hedef worker açılmaz; shutdown için exit 0 veya 143 gerekir, SIGKILL/137 kabul edilmez. Worker başlatma/durdurma ve personel işlerinin zaman çizelgesi servis raporunda tutulur.

## Sınırlar

Bu orkestratör yalnız kendi test konteynerlerini ve proxy kontrolünü yönetir. Hedef systemd/Compose/TLS kurulumu veya dış Redis yönetim izinleri uygulanmış sayılmaz. Proxy’nin Redis pause kapısı HTTP’yi yönetir; worker durdurma ve resume yetkisi bu test orkestratöründe korunur. Dışarıdan doğrudan Redis’e resume yapan bir yöneticiyi engellediği iddia edilmez.

E-belge işi yerel NotFound yoludur; dış gönderim yapılmaz. Önceki gerçek Sovos adaptörü/internal SOAP ve rezervasyon sonrası kesinti kabulü ayrı kanıttır. Aktif uzun iş, SIGKILL/stalled kurtarma, doğal rezervasyon yaşı ve dış teslim belirsizliği bu birleşik koşumda tekrar sınanmaz. Personel işleri boş kadrodur; dolu bordro hesabı kabulü değildir.

API süreçleri TEKIR_WORKER=0, ayrı worker süreçleri gerçek main.worker girişinden çalışır. İlk staging anında worker’lar kapalıdır; rapordaki ilk korumalı API/bekleyen iş kontrolü bu anı anlatır. Sonraki birleşik kontroller gerçek açık worker’ları doğrular. Önceki workersız pause kaybını zorlamak bu modda eski tüketici açıkken yapılmaz; resume girişimi yerinde reddedilir. Kapının önceki 27 odaklı testi ayrı kanıttır.

## Tekrar çalıştırma

Önceki odaklı HTTP API ve sabit korumalı API/worker/web paketleriyle proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-birlesik-gecis-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-birlesik-gecis-prova
```

Yeni bir koşumda ayrı evidence dizini seçilir. `servis-gecis-ozeti.json` içindeki birlesikWorkerHttp, workerZamanCizelgesi ve birlesikEbelgeSonuc; üst kabul raporu, HTTP/restore logları, üç tarayıcı ekranı ve kaynak kanıtıyla birlikte okunur. Paket manifestleri koşum başında/sonunda doğrulanır.

## Sonuç

İlk koşum **exit 0** ile tamamlandı: **5 gerçek HTTP/tarayıcı + 5 restore testi ve 16 birleşik servis/worker/HTTP kontrolü geçti.** Standalone web’in ağsız Node 22 /giris=200 kabulü de tekrar geçti. Önceki 27 kapı testi, 29 SOAP/worker kontrolü ve uzun SIGKILL modları bu koşumda yeniden çalıştırılmadı.

Güncel ve eski worker ayrı personel işlerini tek denemede tamamladı. Kaynak güncel worker **exit 0** ile kapandıktan sonra eski worker açıldı; eski worker da **exit 0** ile durduktan sonra güncel worker yeniden açıldı. Eski HTTP/worker açıkken resume reddedildi ve bekleyen e-belge işi hiç başlamadı. Güncel HTTP/worker/API readiness sağlandıktan sonra resume edildi; aynı job attemptsMade=1, attemptsStarted=1, stalledCounter=0 ile tek yerel NotFound/dead-letter sonucuna ulaştı. Son restart sonrası HTTP 200, job verisi/sonucu ve dead-letter içeriği aynı kaldı.

Üç gerçek Chromium form girişi başarılıdır. Tarihsel F04 plan/pay/bağ ve satın alma talebi korundu; eski mod audit’leri değişmedi, yalnız beklenen kapali/salt_okunur geçişleri için iki yeni audit oluştu. Bu koşumdaki **226 public tablonun** yedek/restore içerikleri eşleşti. API/web/worker paket hash’leri başta/sonda doğrulandı. İki worker, iki API/web çifti, proxy, tarayıcılar, Redis, MinIO, PostgreSQL ve ağ temizlendi. Üst raporda geciciDbSilindi=true, servis raporunda temizlik=true. Sözdizimi ve diff kontrolleri geçti.

Kanıt dizini `.release-candidates/f04-birlesik-gecis-20261023/`; `servis-gecis-ozeti.json` içindeki workerZamanCizelgesi ve birlesikEbelgeSonuc, üst `kabul-ozeti.json`, `web-ag-siz-kabul.json`, HTTP/restore logları, üç tarayıcı ekranı ve `birlesik-gecis-kaynak-kaniti.json` birlikte okunur. Ürün kaynakları ve sabit paketler bu dilimde değiştirilmedi.

Hedef systemd/Compose/TLS/proxy kurulumu, dış Redis kontrol yetkileri, gerçek sağlayıcı hesabı, hacim/kesinti bütçesi ve gerçek alan pilotu açık kalır. Bu kayıt izole birleşik işletim kabulüdür; hedefte yayın yapılmış sayılmaz.
