# F04 — Genel kuyruk worker’ında kontrollü devir

23 Ekim 2026. `--f04-genel-worker-devir-prova`, mevcut tam eski paket kabulünü eski → güncel → eski `main.worker.js` devriyle genişletir. Gerçek şirket servisi veya kuyruğu kullanılmaz. Runner kendi PostgreSQL restore DB’sini ve internal Docker ağındaki geçici Redis/MinIO servislerini kurar; gerçek `.env` dosyası yüklenmez.

## Kapsam

Eski paket `.release-candidates/f04-ihtiyac-20261019/runtime`, güncel çıktı `.release-candidates/f04-servis-gecis-20261022/yeni-api` sabit paketidir. Güncel dist, Prisma istemcisi ve workspace çıktıları eski bağımlılık tabanına salt okunur bağlanır. Her iki paketin dosya hash’leri doğrulanır; bu düzen temiz bağımlılık kurulumu değildir.

Önce mevcut gerçek HTTP/tarayıcı ve restore kabulü koşar. Tam eski API, worker ve web kabulünün ortasında şu ek kontroller çalışır:

1. Eski worker gerçek `tekirextra-personel` BullMQ kuyruğundaki bordro işini tamamlar.
2. Eski worker SIGTERM ile durdurulur. Docker durumunda Running=false, OOMKilled=false ve exit 0 veya 143 gerekir; SIGKILL/137 kabul edilmez. Sonra oluşturulan ikinci iş waiting durumunda kalır.
3. Güncel worker aynı Redis üzerinde ikinci işi tamamlar; eski süreç kapalı kalır.
4. Güncel worker yeniden başlatılır. İlk iki iş completed ve attemptsMade=1 kalır. Önceki tahsilat bağlantısı ve bildirimi birer kayıt olarak korunur.
5. Güncel worker aynı kapanış kontrolüyle durdurulur. Üçüncü iş waiting durumunda kalır.
6. Eski worker yeniden açılır ve üçüncü işi tamamlar. Üç işin de tamamlanma sonucu ve deneme sayısı doğrulanır; güncel worker kapalı kalır.

Personel fixture’ı boş kadrodur; her iş sonucu sıfır oluşturulan/mevcut personel ve boş hata listesidir. Bu kabul gerçek kuyruk protokolünü, kalıcı iş durumunu ve bekleyen iş devrini sınar. Dolu kadro bordro hesabı, iş ortasında SIGTERM, stalled/lock kurtarma, Redis kaybı ve e-belge sağlayıcı teslimi bu koşumun kapsamı değildir. Genel worker’ın bütün kuyruklarının devri tamamlanmış sayılmaz.

Tam kabulün sonundaki beş F04 tablosu, F04 ayarları ve ihtiyaç audit içerikleri önce/sonra eşleşmelidir. Eski standalone web girişi ve salt okunur tahsilat kontrolleri korunur. Kanıt dosyası `tam-paket-geri-donus.json`, üst rapor `kabul-ozeti.json`’dır.

## Tekrar çalıştırma

Önce odaklı API derlemesi:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-genel-http-api
```

Ardından proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-genel-worker-devir-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-genel-worker-devir-prova
```

Önceki `/tmp` web kopyası silindiği için kalıcı prova web paketi kullanılır. Paketler mevcut değilse ilgili paketleme belgelerinden yeniden hazırlanmalıdır. Aynı kanıt dizinini yeni koşum için kullanmak önceki raporları değiştirir; tarih/koşum başına ayrı dizin tercih edilir.

## Sonuç

İlk koşum, prova üreticisi `/runtime` dizininden `bullmq` çözemediği için devir işi eklenmeden durdu. Üretici çalışma dizini `/runtime/apps/api` olarak düzeltildi. İlk koşumun geçici kaynakları temizlendi; raporları `.release-candidates/f04-genel-worker-devir-20261023-ilk-deneme/` altında korundu.

Düzeltilmiş koşum **exit 0** ile tamamlandı: **5 gerçek HTTP/tarayıcı + 5 restore testi ve 22 tam paket/devir kontrolü geçti.** 22 kontrol önceki 15 tam paket kontrolünü de içerir; bağımsız yeni iş senaryosu sayısı olarak toplanmaz. Üç personel işi completed, attemptsMade=1 ve beklenen boş kadro sonucunda kaldı. Eski ve güncel worker durdurma kontrolleri exit 0 verdi.

219 public tablonun yedek/restore içeriği eşleşti. Beş F04 tablosu, şirket modu ayarları ve ihtiyaç audit içerikleri korundu. Eski/güncel paket hash’leri koşum sonunda tekrar doğrulandı. API, web, iki worker, Redis, MinIO, geçici PostgreSQL ve ağ temizlendi; ana raporda geciciDbSilindi=true ve alt raporda temizlik=true. JavaScript sözdizimi, odaklı API derlemesi ve diff kontrolleri başarılıdır.

Kanıt dizini `.release-candidates/f04-genel-worker-devir-20261023/`; `tam-paket-geri-donus.json`, `kabul-ozeti.json`, HTTP/restore logları ve `genel-worker-kaynak-kaniti.json` birlikte okunur. Ürün kaynakları ve migration değiştirilmedi. Hedef servis yönetimi, hacim/kesinti bütçesi, dolu/aktif iş devri ve diğer kuyrukların kabulü, kapasite kararı ve gerçek alan pilotu açık kalır.
