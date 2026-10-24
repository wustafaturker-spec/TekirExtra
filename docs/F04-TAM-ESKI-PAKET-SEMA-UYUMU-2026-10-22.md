# F04 — Tam eski paket ile yeni şema uyumu

22 Ekim 2026. Önceki eski API provası yalnız dokuz derlenmiş ihtiyaç modülünü güncel host bağımlılıklarıyla çalıştırıyordu. Yeni `--f04-tam-geri-prova`, restore edilen izole veritabanında 19 Ekim tam API paketini, aynı paketin genel worker’ını ve eski standalone web’i çalıştırır. Gerçek şirket verisine veya çalışan servislere işlem yapılmaz.

## Sabit paketler

- API ve bağımlılıklar: `.release-candidates/f04-ihtiyac-20261019/runtime`, `runtime-manifest.json` ile bütün dosyalar ve paket içi sembolik bağlantılar doğrulanır. Eski Prisma istemcisi kullanılır; yeni kaynaktan API yeniden derlenmez.
- Web: `.release-candidates/f04-ihtiyac-talep-web-20261019/web`. Aday manifesti ve dosyaları doğrulanır; eski web ve eski API birlikte çalışır.
- Genel worker: eski API runtime içindeki `main.worker.js`. Yerel pilotta ayrıca kullanılan özel `main.odeme-sozu-worker.js` bu provada çalıştırılmaz.
- Node/OS tabanı: `sha256:4803d67b1d5b88c87583a9e7724a0a4998c1ef389a48a2acc37eb3c5f580af55`. İmajın eski uygulama entrypoint’i çalışmaz; salt okunur arşiv paketi doğrudan Node ile başlatılır.
- Chromium: önceki çekirdek adayının yerel browser paketi. Tarayıcı, mevcut tam uygulama kabul aracından uyarlanan `f04-eski-paket-tarayici.cjs` betiğini kullanır; eski ekrandaki tekrar eden metin için görüşme paragrafı açıkça seçilir.

## Prova düzeni

Runner önce geçici PostgreSQL 16 DB’sini kurar ve güncel migration’ları uygular. Beş gerçek HTTP/tarayıcı kabulü dolu tarihli kaynak, plan/pay/talep bağı ve mod audit kayıtları oluşturur. Dolu DB migration tekrarı ve 219 public tablonun yedek/restore eşitliğinden sonra beş restore testi çalışır. Böylece eski tam paket boş veya yalnız eski şemaya karşı sınanmaz.

Eski uygulama ayrı `--internal` ağda, yeni geçici Redis/MinIO ile başlatılır. DB konteynerinin adı, koşum nonce’u ve test etiketi doğrulanır; uygulama rolünün RLS bypass/superuser olmadığı kontrol edilir. Yalnız bu runner’ın restore DB’sine bağlanılır. `.env` veya gerçek bağlantı ayarları yüklenmez. API/worker/web host portu açmaz. Web ve Chromium API’nin ağ alanını paylaşır; eski web’in localhost API yönlendirmesi korunur. Gerçek TLS/reverse proxy yerleşimi bu düzenle kabul edilmiş sayılmaz.

Yeni sentetik tenant ve parolayla tam API’de giriş, cari/fatura, eski anlık stok ihtiyacı, takip/görüşme, ödeme sözü ve nakitte çift sayım kontrol edilir. Genel worker geciken söz için takip bağı ve uygulama içi bildirim üretir. API/worker yeniden başlatılıp tek bağ/tek bildirim korunması kontrol edilir. E-posta kapalıdır. Eski web’de Chromium gerçek giriş formunu kullanır; salt okunur takip ve ödeme sözü ekranını açar. Token veya API yanıtı enjekte edilmez.

Eski kod yeni F04 tarihli uçlarını ve `stok_ihtiyac_plani` ayar tanımını içermez. Rotaların 404 dönmesi ayrıca sınanır. Eski uygulamanın F04 şirket modunu uyguladığı varsayılmaz; genel satın alma davranışına yeni plan tekilliği yüklenmez.

Tam eski paket kontrollerinden önce/sonra beş F04 tablosunun, F04 mod ayarlarının ve ihtiyaç audit kayıtlarının sayı/içerik özetleri karşılaştırılır. Genel uygulama kabulü kendi sentetik F02 işlerini yazdığı için bu aşamada bütün DB’nin değişmediği iddia edilmez. Bütün public tabloların eşitliği önceki restore aşamasına aittir.

## Sonuç

**5 güncel HTTP/tarayıcı + 5 restore testi ve 15 tam eski paket kontrolü geçti.** Eski tam AppModule ve genel worker Node 22 üzerinde başladı; gerçek giriş, fatura ve anlık ihtiyaç okuması, iş yazımı, worker bağı/bildirimi, yeniden başlatmada tekillik ve eski standalone web’den gerçek form girişi doğrulandı. Web build kimliği `_aEufkb0ztOHGmIoKfx18`.

F04’ün beş tablosu, şirket modu ve ihtiyaç audit içerikleri eski paket provası boyunca aynı kaldı. Paket hash’leri öncesinde ve sonrasında eşleşti. Bütün geçici API/worker/web/Redis/MinIO kaynakları, ağ ve PostgreSQL temizlendi; ana koşum exit 0 ile bitti. Tarayıcı ekran görüntüsü incelendi; API yanıtı taklidi veya oturum token enjeksiyonu kullanılmadı.

JavaScript sözdizimi ve diff kontrolleri geçti. Güncel ürün/API kaynakları önceki başarılı derleme hash’leriyle eşleşir; bu dilim ürün kodunu değiştirmedi ve yeni tam derleme yapmadı. Önceki 48 DB/26 fixture paketi yeniden koşulmuş sayılmaz. Bu 15 kontrolün bir bölümü önceki çekirdek kabul davranışlarını tekrarlar; toplam sayı farklı iş senaryosu sayısı olarak sunulmaz.

## Tekrar ve kanıt

```bash
F04_API_DIST=/tmp/tekir-f04-mod-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-tam-geri-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-tam-geri-prova
```

Güncel `/tmp` API/web derlemeleri yoksa önceki kontrollü açılış belgesindeki kaynaklardan tekrar üretilmelidir. Eski sabit paketler yeniden derlenmez. Kanıt dizini `.release-candidates/f04-tam-geri-20261022/`; ana kayıt `kabul-ozeti.json`, tam paket sonucu `tam-paket-geri-donus.json`, eski web ekranı `salt_okunur-masaustu.png` ve HTTP istek kaydıdır. Test ve paket manifest hash’leri kaynak kanıtında saklanır.

İlk tam paket denemesi, tekil dosya hash’leri eşleşmesine rağmen yeni doğrulayıcının dosya sırası farklı olduğu için toplu özette durdu. Aracın karşılaştırması eski manifestin özgün sırasıyla yapıldı; dosya bazında tam eşitlik koşulu korundu. İkinci denemede API/worker kontrolleri geçti ve tarayıcı gerçek giriş yaptı; eski ekrandaki iki aynı metin nedeniyle genel seçici belirsiz kaldı. Yalnız test seçicisi görüşme paragrafına daraltıldı. İlk sonuçlar `f04-tam-geri-20261022-ilk/` ve `f04-tam-geri-20261022-tarayici-ilk/` dizinlerinde korunur. Ürün kaynakları değiştirilmedi.

Bu prova aynı hedefte yeni sürümü durdurup eski servise trafik geçirme, özel ödeme sözü worker’ını geri alma, host reboot, hedef kapasite, gerçek alan pilotu veya yayın kabulü değildir. G3/G4/G5 yalnız bu teknik kanıtla kapanmaz.
