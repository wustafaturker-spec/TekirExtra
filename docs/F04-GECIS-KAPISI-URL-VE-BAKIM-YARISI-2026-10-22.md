# F04 — Geçiş kapısında URL eşdeğerliği ve bakım yarışı

22 Ekim 2026. [İzole yeni–eski–yeni provasının](F04-IZOLE-SERVIS-VE-TRAFIK-GECISI-2026-10-22.md) test geçiş kapısında iki davranış düzeltildi. Gerçek şirket proxy’si, API/web paketi veya yayın ayarı değiştirilmedi.

## Bulunan açıklar ve düzeltme

Eski sürümdeki plan bağlı talep engeli yalnız URL’nin tam küçük harfli ve son eğik çizgisiz biçimini tanıyordu. Örneğin `/API/v1/SATIN-ALMA/TALEPLER` veya `/api/v1/satin-alma/talepler/` karşılaştırmayı geçerek upstream’e ulaşıyordu. Aynı sorun büyük harfli tarihli plan rotasında da vardı. Düzeltmede kapı politikası için pathname küçük harfe çevrilir ve sondaki `/` işaretleri kaldırılır. Upstream’e iletilen URL ve normal talep gövdesi aynen korunur. Anlık `onizle` rotası açık kalır; eski sürümde tarihli plan rotaları ve JSON içinde `ihtiyacPlaniId` alanı bulunan POST 409 alır. Alanın null olması izin sayılmaz. Eski talep kapısında bozuk JSON 400, desteklenmeyen içerik biçimi 415 alır.

Diğer açık, hedef hazırlığının asenkron kontrolü sırasında geçiş durumunun yeniden doğrulanmamasıydı. Bekleyen hazırlık kontrolü, daha sonra verilen bir bakım komutuna rağmen kapıyı açabiliyordu. İki eşzamanlı hedef kontrolü de başarılı dönebiliyor; bakım açılmadan canlı sürümden diğerine geçilebiliyordu.

Her bakım komutu artık durum revizyonunu artırır. Hazırlığa başlamak için bakım açık ve aktif HTTP sayısı sıfır olmalıdır. API/web hazırlığı bittikten sonra aynı revizyon, bakım modu ve sıfır aktif istek yeniden doğrulanır. Yeni bakım komutu eski hazırlığı geçersiz kılar; iki eşzamanlı hazırlıktan yalnız ilki kapıyı açabilir. Trafik açıkken doğrudan başka sürüme geçiş 409 alır. Kabul edilmiş HTTP’nin başladığı sürümde tamamlanması korunur.

## Odaklı HTTP kabulü

`f04-gecis-proxy.cjs` artık fabrika olarak da içe alınabilir. CLI hâlâ sabit izole backend adreslerini ve loopback kontrol portunu kullanır; testler rastgele loopback portlarında Node HTTP fixture upstream’iyle gerçek soket/istek açar. Fixture, iş API’si değildir; 18 odaklı test gerçek satın alma işlemi kabulü olarak sunulmaz.

Düzeltme öncesi davranışta 15 testin **8’i geçti, 7’si başarısız oldu**. URL eşdeğerliği, yeni bakım komutu, eşzamanlı hazırlık ve bakımsız sürüm değişimi sorunları böylece yeniden üretildi. İlk sandbox denemesi yerel `listen EPERM` nedeniyle işlevi sınayamadı; kaydedilen önceki davranış logu izinli gerçek HTTP koşumuna aittir.

Düzeltme sonrası pakete null alan, bozuk JSON ve içerik biçimi kontrolleri de eklendi. Yarış testleri sabit süre uyumayı değil, upstream’in ilgili hazırlık isteklerini gerçekten aldığını bildiren işaretleri bekler. Her test 10 saniye ile sınırlıdır ve kendi HTTP sunucularını kapatır.

```bash
node --test --test-isolation=none --test-reporter=tap apps/api/scripts/f04-gecis-proxy.test.cjs
```

## Sonuç

**18/18 odaklı HTTP testi geçti.** Aynı son kodla ağsız Node 22 web kabulü, **5 gerçek HTTP/tarayıcı + 5 restore testi ve 10 servis geçişi kontrolü** de yeniden geçti. Bakımda istek reddi, kabul edilmiş isteğin tamamlanması, yeni–eski–yeni gerçek form girişleri, eski sürümde plan bağlı isteğin engellenmesi ve geri dönüşte aynı tarihsel plan/talep bağı korundu.

219 public tablonun yedek/restore eşitliği doğrulandı. Servis geçişinde beş F04 tablosunun içeriği aynı kaldı; yalnız beklenen iki mod audit’i eklendi. Bütün geçici uygulama, tarayıcı, DB, Redis/MinIO konteynerleri ve ağ temizlendi; ana koşum exit 0 ile bitti. Ürün/API/web kaynakları ve migration değişmedi; önceki başarılı paket manifest hash’leri aynıdır. Yeni tam derleme veya 48 DB/26 fixture/worker paketlerinin yeniden kabulü bu dilime dahil değildir. JavaScript sözdizimi ve diff kontrolleri geçti.

## Gerçek paketlerle tekrar

Ürün/API/web kaynağı değişmediğinden önceki başarılı paketler kullanılır; tam derleme veya paketleme tekrar yapılmaz. Yeni kapıyla ağsız Node 22 web kontrolü ve mevcut 5 gerçek HTTP/tarayıcı, 5 restore ve 10 yeni–eski–yeni servis kontrolü ayrı kanıt dizinine yeniden koşulur:

```bash
F04_API_DIST=/tmp/tekir-f04-mod-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-gecis-kapisi-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-servis-gecis-prova
```

Kanıt dizini `.release-candidates/f04-gecis-kapisi-20261022/`; `odakli-ilk.log`, `odakli-son.log`, `duzeltme-oncesi-proxy.cjs`, `servis-gecis-ozeti.json`, ana `kabul-ozeti.json`, HTTP/restore logları ve kaynak hash’leri birlikte okunur. Önceki başarılı geçiş kanıtı değiştirilmez.

Bu kapı hâlâ izole prova aracıdır. Hedef reverse proxy/TLS/erişim düzenine kurulmuş sayılmaz. Worker devri, hedef hacim/kesinti bütçesi, kapasite kararı ve gerçek alan pilotu açık kalır.
