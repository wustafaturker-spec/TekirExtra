# F04 — Aktif personel işinde kontrollü worker devri

23 Ekim 2026. `--f04-aktif-worker-devir-prova`, önceki genel worker provasını bir personelli, işlem sürerken SIGTERM senaryosuyla genişletir. Ürün kaynakları ve sabit runtime paketleri değiştirilmez. Gerçek şirket servisi, veritabanı veya Redis kuyruğuna bağlanılmaz.

## Düzen ve kapsam

Runner önceki beş HTTP/tarayıcı, beş restore ve 22 tam paket/devir kontrolünü çalıştırır. Önceki boş kadro işleri tamamlandıktan sonra yalnız restore DB’de net ücret geçmişi ve istihdam dönemi olan bir personel oluşturulur. Eski paket `.release-candidates/f04-ihtiyac-20261019/runtime`, güncel paket `.release-candidates/f04-servis-gecis-20261022/yeni-api`’dir; aynı salt okunur overlay düzeni ve internal Redis kullanılır.

Aktif işte eski ve güncel worker ayrı ayrı sınanır:

1. Ayrı DB transaction’ı `personel_bordro` tablosuna ACCESS EXCLUSIVE kilidi alır. Kilit yalnız geçici DB’de tutulur; ürün koduna test gecikmesi eklenmez.
2. Gerçek BullMQ işi oluşturulur. `pg_stat_activity` ve `pg_blocking_pids` worker sorgusunun bu kilitte beklediğini, kuyruk ise işin active olduğunu doğrular.
3. Worker’a SIGTERM gönderilir. Kilit tutulurken süreç Running=true ve iş active kalmalıdır; DB beklemesi tekrar doğrulanır.
4. Kilit finally bloğunda bırakılır. İşin completed, attemptsMade=1 ve hatasız olması, ardından worker’ın OOM veya SIGKILL olmadan exit 0/143 ile kapanması gerekir. Uygulamanın beş saniyelik transaction sınırı değiştirilmez.
5. Yeni sürümde ve eskiye dönüşte bekleyen işler işlenir. İlk aktif iş tek bordro oluşturur; sonraki işler mevcut bordroyu kullanır. Eski worker yeniden başlatılır. Bordro ve kalemlerinin bütün içerik hash’i aynı, dört işin deneme sayısı bir kalmalıdır.

Bu kabul, PostgreSQL’de kısa süre bekleyen aktif personel işinin normal SIGTERM ile tamamlanmasını sınar. Uzun kilit/transaction timeout, SIGKILL, stalled işin yeniden atanması, Redis kaybı, birden fazla worker’ın aynı anda aktif işi alması ve e-belge/dış sağlayıcı teslimi kapsamında değildir. Bir personelli teknik fixture bordro mevzuat kabulü veya gerçek alan pilotu sayılmaz.

## Tekrar çalıştırma

Odaklı HTTP API derlemesi mevcut değilse önce:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-genel-http-api
```

Ardından proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-genel-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-servis-gecis-20261022/yeni-web F04_HTTP_EVIDENCE=../../.release-candidates/f04-aktif-worker-devir-20261023 node apps/api/scripts/f01-yaris-kabul.mjs --f04-aktif-worker-devir-prova
```

Kanıtlar `tam-paket-geri-donus.json`, üst `kabul-ozeti.json`, HTTP/restore logları ve bu dilimin kaynak hash’leriyle birlikte değerlendirilir. Paketler ve odaklı HTTP derlemesi önceki kabulden kullanılır; yeni ürün derlemesi olduğu iddia edilmez.

## Sonuç

İlk koşum, aktif işin DB kilidinde beklediğini gözleme adımında durdu; SIGTERM aşamasına geçmedi. Geçici kaynaklar temizlendi ve rapor `.release-candidates/f04-aktif-worker-devir-20261023-ilk-deneme/` altında saklandı. Kilit gözlemi, sorgu metnine ve tek satır beklentisine bağlı kontrolden worker ağ adresi + doğrudan `pg_locks` ilişki kaydı kontrolüne taşındı. Birden fazla bekleyen sorgu tek sonuçla sınırlandırılır; başarısızlıkta iş durumu ve kilit teşhisi kaydedilir.

Düzeltilmiş koşum **exit 0** ile tamamlandı: **5 gerçek HTTP/tarayıcı + 5 restore testi ve 26 tam paket/devir kontrolü geçti.** 26 kontrol önceki 22 kontrolü de içerir; bağımsız yeni iş senaryosu sayısı olarak toplanmaz.

Eski worker SIGTERM sonrasında kilit 628 ms daha tutulurken active kaldı; güncel worker için bu süre 595 ms idi. Kilit bırakılınca ikisi de işi hatasız tamamlayıp **exit 0** ile kapandı. Dört yeni işin attemptsMade değeri 1 kaldı. İlk iş tek bordro ve beş kalem oluşturdu; sonraki işler mevcut bordroyu kullandı. Eskiye dönüş ve restart sonrasında bordro ile kalemlerinin bütün içerik hash’i aynı kaldı.

219 public tablonun yedek/restore içerikleri eşleşti. Beş F04 tablosu, mod ayarları ve ihtiyaç audit içerikleri korundu. Eski/güncel paket dosyaları koşum sonunda tekrar doğrulandı. API, web, iki worker, Redis, MinIO, geçici PostgreSQL ve ağ temizlendi; üst raporda geciciDbSilindi=true, alt raporda temizlik=true. JavaScript sözdizimi ve diff kontrolleri başarılıdır.

Kanıt dizini `.release-candidates/f04-aktif-worker-devir-20261023/`; `tam-paket-geri-donus.json` içindeki aktifIs ve dört yeni kontrol, üst `kabul-ozeti.json`, HTTP/restore logları ve `aktif-worker-kaynak-kaniti.json` birlikte okunur. Hedef servis yönetimi, hacim/kesinti bütçesi, diğer kuyrukların/dış sağlayıcının kabulü, kapasite kararı ve gerçek alan pilotu açık kalır.
