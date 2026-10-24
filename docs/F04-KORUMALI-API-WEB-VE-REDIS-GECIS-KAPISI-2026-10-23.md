# F04 — Korumalı API/web trafik geçişi ve Redis kuyruk kapısı

23 Ekim 2026. Güncel korumalı API paketi `.release-candidates/f04-ebelge-korumali-20261023/yeni-api`, önceki taşınabilir standalone web paketi ve sabit eski API/web aynı izole giriş adresinde yeni → bakım → eski → bakım → yeni sırasıyla sınanır. Hedef şirket servisi, DNS, TLS veya canlı proxy değiştirilmez.

## Geçiş kapısı

`TEKIR_EBELGE_GECIS_KAPISI=1` kullanılan prova proxy’sinde eski sürüme açılma için önce bakım ve sıfır devam eden HTTP isteği, ardından **e-belge kuyruğunda pause=true ve aktif iş=0** gerekir. BullMQ’nun meta/active anahtarları aynı Redis Lua okumasında denetlenir; test kodu bu gözlemde anahtarlara yazmaz. Hedef API/web readiness kontrolünden sonra kuyruk şartı tekrar okunur. Hazırlık sırasında pause kaybolursa geçiş reddedilir; durum revizyonu eski bakım/hazırlık yarışlarını da korur.

Eski trafik açıkken her yeni proxy isteğinde kuyruk şartı tekrar denetlenir. Pause kaybı, aktif iş veya gözlem hatası saptanırsa kapı bakım moduna döner ve istek upstream’e aktarılmadan 503 alır. Eski sürümü açma kontrolü 409 döner. Redis gözlemi iki saniye içinde tamamlanmazsa eski geçiş açılmaz. Yeni sürümün açılması bu eski sürüm şartına bağlı değildir.

Fabrika arayüzündeki isteğe bağlı callback, eski prova modlarıyla uyumu korur; eski modları otomatik korumalı ilan etmez. Korumalı runner CLI bayrağını açık geçirir ve gerçek Redis kullanır. Kontrol portu yalnız konteyner loopback’inde nonce ile erişilir. Queue pause/resume kontrolü test orkestratöründedir; proxy okur ve karar verir.

Bu kapı HTTP trafiğini yönetir. Dışarıdan queue resume eden bir yönetici veya eski worker tüketimini otomatik durdurmaz; kontrol düzleminin yetkisi ve worker devir sırası ayrıca korunmalıdır. Tüketiciler bu API/web modunda TEKIR_WORKER=0’dır. Önceki gerçek tam worker/pause geri dönüş kabulü ayrı kanıttır; ikisinin aynı anda hedef ortamda çalıştığı iddia edilmez.

## Kabul

Önceki on servis/trafik kontrolü korunur: yeni API/web üzerinde giriş ve tarihli plan, gerçek Chromium form girişi, bakımda 503, kabul edilmiş HTTP’nin tamamlanması, eski sürümde oturum ve temel akışlar, eskiye yeni plan payload’ının engellenmesi, güncele kontrollü dönüş, salt okunur plan/bağ ve iki beklenen mod audit’i.

Korumalı mod dört ek kontrol içerir:

1. Yeni API paketinde arama desteği koruması doğrulanır; gerçek Redis’te sentetik bekleyen bir e-belge işi oluşturulur. Tüketici olmadığı için attempts/attemptsStarted sıfırdır.
2. Eski API/web açılırken queue pause yoksa trafik kapısı 409 verir ve bakım 503 sürer. Pause edilip aktif sıfır doğrulanınca eski sürüm açılır. Bekleyen job kimliği, verisi ve sayaçları değişmez.
3. Eski trafik açıkken test queue resume eder. Sonraki kimlik isteği upstream’e ulaşmadan 503 alır ve proxy bakıma döner; yeniden eskiye açma 409’dur. Queue tekrar pause edilince eski trafik yeniden açılabilir. Bekleyen iş değişmez.
4. Korumalı yeni API/web’e döndükten sonra queue pause hâlâ vardır. Test resume eder; güncel API oturumu çalışır, bekleyen işin tüm verisi/sayaçları aynıdır. Bu mod iş tüketimini sınamaz.

Odaklı HTTP testleri pause yokluğu, aktif iş, yanlış tip/eksik gözlem, Redis hatası ve zaman aşımı, readiness sırasında pause kaybı ve eski trafik açıkken pause kaybını sınar. Önceki URL/JSON kapıları ve bakım/hazırlık yarışı regresyonları da çalışır.

## Tekrar çalıştırma

```sh
node --test apps/api/scripts/f04-gecis-proxy.test.cjs
```

Önceki odaklı HTTP derlemesi ve sabit paketler hazırken proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-korumali-servis-gecis-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-korumali-servis-gecis-prova
```

Yeni API paketi bu koşumda derlenmez/değiştirilmez. Önceki korumalı tam worker belgesindeki paket manifesti kullanılır. Yeni web derlemesi yoktur; önceki web’in ağsız Node 22 açılışı tekrar doğrulanır. Eski/güncel API ve web dosya hash’leri başta/sonda karşılaştırılır. Koşum başına ayrı evidence dizini kullanılır.

## Sonuç

İlk izole geçiş koşumu **exit 0** ile tamamlandı: **27 odaklı HTTP kapı testi, 5 gerçek HTTP/tarayıcı + 5 restore testi ve 14 servis/trafik kontrolü geçti.** 14 kontrol önceki 10 servis kontrolünü ve dört yeni Redis/korumalı API kontrolünü içerir. Standalone web’in ağsız Node 22 /giris=200 kabulü de geçti. Önceki 29 tam worker ve uzun SIGKILL modları bu koşumda tekrar çalıştırılmadı.

Gerçek Redis’te pause yokken eski API/web trafiği 409 ile engellendi ve bakım 503 sürdü. Pause/aktif sıfır ile eski trafik açıldı. Eski trafik açıkken resume edilince sonraki kimlik isteği upstream’e aktarılmadan 503 aldı ve kapı bakıma döndü; yeniden eskiye açma reddedildi. Pause tekrar sağlanınca eski trafik açılabildi. Korumalı yeni API/web’e dönüşte pause korundu; güncel sürüm açıldıktan sonra resume yapıldı ve bekleyen job verisi/sayaçları değişmedi. Üç gerçek Chromium form girişi başarılıdır.

221 public tablonun restore içeriği eşleşti. Beş tarihsel F04 tablo içeriği ve mevcut satın alma talebi korundu; önceki mod audit’leri aynı kaldı ve yalnız beklenen kapali/salt_okunur değişiklikleri için iki yeni audit oluştu. Eski/güncel API ve web paket hash’leri tekrar doğrulandı. Proxy, iki API/web çifti, tarayıcılar, Redis, MinIO, PostgreSQL ve ağ temizlendi; üst raporda geciciDbSilindi=true, servis raporunda temizlik=true. Sözdizimi ve diff kontrolleri geçti. Odaklı HTTP testleri ilk sandbox koşumunda ayrıntısız test failed çıktısıyla durdu; izinli ortamda 27/27 geçti. İlk çıktıda kesin hata nedeni görülmedi.

Kanıt dizini `.release-candidates/f04-korumali-servis-gecis-20261023/`; `servis-gecis-ozeti.json`, üst `kabul-ozeti.json`, `web-ag-siz-kabul.json`, HTTP/restore logları, üç tarayıcı ekranı ve `korumali-servis-gecis-kaynak-kaniti.json` birlikte okunur. Yeni ürün/web derlemesi veya hedef ortam değişikliği yapılmadı.

Hedef servis yöneticisi/TLS/proxy’ye kurulum, Redis kontrol düzlemi ve worker/HTTP geçişinin birlikte işletimi, gerçek sağlayıcı hesabı, Redis kaybı, hacim/kesinti bütçesi ve gerçek alan pilotu açık kalır.
