# Çekirdek adayında kesinti, toparlanma ve yerel HTTP yük provası

18 Ekim 2026. Kapsam `.release-candidates/cekirdek-aday-20261018-3` sabit adayı ve `api-worker-runtime-20261018T105632135Z-e6c489` paketidir. Gerçek şirket pilotu ve canlı yayın ertelenmiştir.

## Yeniden çalıştırma

```sh
node scripts/cekirdek-isletim-prova.cjs .release-candidates/cekirdek-aday-20261018-3
```

Betik dışarıdan verilmiş DB bağlantı değişkenleri varsa durur. Rastgele ad/parola/nonce ile yalnız geçici Docker PostgreSQL, Redis ve MinIO oluşturur; aday migration'larını burada uygular. Tam API/worker Node 22 tabanında, salt okunur runtime bağlaması ve 512 MiB bellek sınırıyla çalışır. Uygulama rolünün superuser/BYPASSRLS olmadığı doğrulanır. Gerçek `.env` dosyaları okunmaz.

Süreç çökmesi testi yalnız betiğin kendi API/worker konteynerinde `--init` altındaki uygulama PID'sini doğrulayıp SIGKILL verir. Docker `on-failure:3` politikasıyla restart sayısının tam bir artması ve servisin hazır duruma dönmesi beklenir. Init süreci uygulamanın çıkış kodunu Docker'a iletir. Bu, Docker daemon/host reboot sonrası açılış veya hedef sistemin servis yöneticisi kabulü değildir. Redis durdurulduğunda API readiness 503 ve liveness 200 olmalı; Redis açılınca readiness yeniden 200'e dönmelidir. Bağımlılık kesintisinde başarılı liveness tek başına trafik kabulü değildir.

Özellik salt okunur ve kapalı modda sınanır; kapalıyken okuma/yazma 403 ve F02 bildiriminin gizlenmesi, yeniden açılınca aynı geçmişin/bildirimin görünmesi beklenir. Worker yeniden çalıştırılır. Söz, takip, görüşme, bağ, bildirim/teslimat, iş auditleri ve fatura/cari hareket/kasa-banka hareket/kapamaların sıralı tam kayıt özetleri karşılaştırılır. Ayar değişikliklerinin kendi auditleri bu iş audit özetine dahil değildir.

Yük deneyi altı gerçek HTTP ucunda toplam 120 istek, dört eşzamanlı closed-loop istemci kullanır. Her ucun 20 örneği ve toplam p50/p95/p99 kaydedilir; hata veya timeout başarı sayılmaz. Veri seti bir tenant, bir cari, iki fatura, iki söz, bir takip ve bir görüşmedir. Cari/kasa-banka hareket ve fatura kapama tabloları bu fixture'da boştur; özet kontrolü bu tablolara beklenmedik kayıt eklenmediğini de doğrular. Bu küçük sentetik set üretim kapasitesi veya SLA/p95 kabulü değildir. CPU limiti yoktur; Docker bellek kullanımı yalnız koşum sonundaki örnektir, tepe kullanım iddiası değildir. Ön ısıtma ayrı yapılmaz; uçlar önceki kabul adımlarında kullanılmıştır. Üretim için gerçek veri hacmi, donanım, trafik bileşimi, süre ve kabul bütçeleri P00-02 kapsamında belirlenmelidir.

Paket/aday bütünlüğü başlangıçta ve sonda doğrulanır; geçici konteynerler ve ağ temizlenir. Rapor adı `cekirdek-isletim-prova.json` olduğundan önceki runtime/tarayıcı kanıtları değişmez.

## Geri dönüş kararı

[Önceki tam imaj provasındaki](F02-ESKI-IMAJ-UYUMU-VE-BAGIMLILIK-ENVANTERI-2026-10-16.md) 20 Eylül API/web/worker üçlüsü fatura şeması ve web yönlendirmesi kontrollerini geçememişti. Bunlar geri dönüş sürümü olarak seçilmez. Bugünkü Node 22 provasında aynı imajın yalnız Node/OS tabanı kullanılır; eski uygulamanın uygunluğu bundan çıkarılmaz.

Önceki dağıtım kimliği, bağımlılıkları ve güncel şemayla uyumu belli kabul edilmiş paket bulunmadan tam sürüm dönüşü tamamlandı sayılmaz. Geçici özellik kapatma/yeniden açma kanıtı bu kapının yerine geçmez. Migration geri alınarak iş verileri silinmez.

## Hedef işletim için kayıt alanları

| Alan | Yayından önce gerekli kayıt |
| --- | --- |
| Sürüm | API/web/runtime manifestleri, web BUILD_ID ve arşiv SHA-256 |
| Kalıcı servis | Servis yöneticisi tanımı, açılış sırası, yeniden başlatma sınırı, log saklama; host reboot provası |
| Yapılandırma | Gizli değerlerin dışarıdan sağlanması, uygulama/migration rol ayrımı, DB/Redis/depo adresleri |
| Trafik | TLS/reverse proxy ve aynı origin API yolu; dışarıdan readiness/işlev kontrolü |
| Yedek | Hedef yedeği, ayrı geri yükleme, RPO/RTO ve veri karşılaştırması |
| Kapasite | Hedef veri hacmi ve eşzamanlı trafik, süre, p95 bütçesi ve hata oranı |
| Geri dönüş | Kabul edilmiş önceki tam paket, şema uyum kanıtı, gönderim yollarının durdurulması ve dönüş işlev testi |
| Alan kabulü | Ertelenmiş gerçek pilot ve ürün/alan sorumlusu kabulü |

## Kabul sonucu

[İşletim raporundaki](../.release-candidates/cekirdek-aday-20261018-3/cekirdek-isletim-prova.json) **17 kontrol geçti**. API hata sonrası 5.628 ms, worker 6.149 ms içinde hazır duruma döndü; her iki konteynerin restart sayısı 0'dan 1'e çıktı. Redis kesintisinde readiness 503/liveness 200 ve yeniden bağlantıda readiness 200 doğrulandı. Özellik kapatma/açma, worker yeniden çalışma, süreç hataları ve yük koşumunda iş/mali kayıt özetleri aynı kaldı.

| Yerel yük ölçümü | Sonuç |
| --- | --- |
| İstek / eşzamanlı istemci | 120 / 4 |
| Başarısız istek | 0 |
| Toplam süre / hız | 2.296 ms / 52,26 istek/sn |
| p50 / p95 / p99 | 54,09 / 195,90 / 262,03 ms |
| En uzun istek | 265,33 ms |
| Koşum sonu API bellek örneği | 214,3 MiB / 512 MiB |

Bu kısa, küçük veri setli ve aynı konteynerden yapılan ölçüm üretim kapasitesini kanıtlamaz. Altı uç için ayrı süreler raporda kayıtlıdır. Kuyruk işi sürerken çökme, DB/depo kaybı veya host reboot bu koşumun kapsamında değildir.

İlk sinyal denemesinde PID 1'e gönderilen sinyal uygulamayı durdurmadı ve restart testi başarısız oldu. [Başarısız rapor](../.release-candidates/cekirdek-aday-20261018-3/cekirdek-isletim-prova-ilk-sinyal-denemesi.json) saklandı; geçici kaynaklar temizlendi. Düzeltme konteyneri `--init` ile başlatıp init altındaki uygulama PID'sini doğrulayarak sonlandırır. Kabul edilen sonuç düzeltilmiş betiğin son koşumudur.

Sonunda aday/runtime bütünlüğü doğrulandı ve geçici kaynaklar silindi (`temizlik: true`). Önceki 190 birleşik test ve 27 runtime/PDF/akış kontrolünün kanıt dosyaları değişmedi. Yeni 17 kontrol bu davranışların bazılarını tekrarlar; toplam farklı iş senaryosu sayısı olarak toplanmaz.

[İşletim kabul özeti](../.release-candidates/cekirdek-aday-20261018-3/cekirdek-isletim-kabul-ozeti.json), önceki runtime kanıtlarının değişmediğini, yeni raporun/çalıştırılan betiğin SHA-256 değerlerini ve aday kimliğini doğrular:

```sh
node scripts/cekirdek-isletim-kabul-ozetle.cjs .release-candidates/cekirdek-aday-20261018-3
```

Hedef kapasite, kalıcı servis/reboot, kabul edilmiş önceki dağıtıma dönüş ve gerçek pilot/yayın kapıları açık kalır. Bu rapor REL-03'ü otomatik kapatmaz.
