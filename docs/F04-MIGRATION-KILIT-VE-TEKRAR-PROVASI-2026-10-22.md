# F04 — Migration kilidi, zaman aşımı ve kontrollü tekrar

22 Ekim 2026. Bu dilim normal indeks oluşturma sırasında açık bir yazma türü tablo kilidinin migration’ı nasıl etkilediğini, başarısız kaydın kör tekrarı engellediğini ve denetlenmiş kurtarmayı sınar. Yalnız runner’ın kendi geçici PostgreSQL 16 ortamında çalıştırıldı. Gerçek DB, kalıcı ayar veya yayın değişmedi.

## Kurulum ve gözlem

Yeni `--f04-kilit-prova` modu önce F04 öncesi 265 migration’ı uygular ve mevcut veride ilk geçiş provasının iş kayıtlarını oluşturur. Üç F04 migration’ı henüz uygulanmamıştır. Başlangıçta 213 eski iş tablosunun içerik özeti alınır; `_prisma_migrations` iş tablosu karşılaştırmasına dahil edilmez.

İkinci bağımsız DB oturumunda `uretim_emri_kalemleri` üzerinde `RowExclusiveLock` tutulur. Bu, normal DML’nin aldığı tablo kilidi türüdür; test gerçek bir üretim sarfı veya kalıcı iş yazımı yapmaz. Kilidin alındığı `pg_locks` ve rastgele koşum kimliği taşıyan `application_name` ile doğrulanır. Yalnız bu geçici DB’nin yeni bağlantılarına `lock_timeout=1s` uygulanır; gerçek ortamın rolü veya bağlantı ayarı değiştirilmez.

Asıl `prisma migrate deploy` çalıştırılır. İlk migration tamamlanır. İkinci migration, önce depo indeksini oluşturmayı dener ve sonra üretim kalemleri indeksinde engelleyici yazma kilidine takılır. Koşumda:

- PostgreSQL `55P03 / canceling statement due to lock timeout` döndürdü.
- Prisma `P3018` ile deploy’u durdurdu.
- Başarısız ikinci migration için `finished_at` ve `rolled_back_at` boş bir kayıt kaldı.
- İkinci migration’ın iki indeksi ve üç tablosu katalogda yoktu; bu ortamda yarım ikinci-migration DDL’si kalmadı.
- 213 eski iş tablosunun içerik özeti değişmedi.

Bu sonuç, bütün migration zincirinin tek transaction olduğu anlamına gelmez: ilk migration uygulanmış halde kaldı. İkinci migration’ın nesne yokluğu ayrıca kontrol edilmeden tamamının geri alındığı varsayılmaz.

Zaman aşımıyla biten deploy duvar süresi **4047 ms** gözlendi. Bunun yalnız 1 saniyesi ayarlanmış kilit bekleme üst sınırıdır; süreç/Prisma başlangıcı da ölçüme dahildir. Bu değer üretim performans hedefi veya servis kesinti bütçesi değildir.

## Kör tekrar ve kurtarma

Engelleyici oturumun hâlâ açık olduğu doğrulandı; yalnız test kimliği ve DB ile eşleşen oturumun beklemesi iptal edilip kapanması beklendi. Böylece doğal 45 saniyelik güvenlik süresinin bitmesi başarı gibi kabul edilmedi. Geçici `lock_timeout` ayarı temizlendi.

Resolve yapılmadan ikinci `migrate deploy` çalıştırıldı: **P3009** ile reddedildi. Başarısız migration kaydı yok sayılıp sonraki migration’a geçilmedi.

Yalnız izole testte, beklenen hata kaydı ve ikinci migration nesnelerinin yokluğu doğrulandıktan sonra `migrate resolve --rolled-back 20261022160000_ihtiyac_uretim_ve_plan` çalıştırıldı. Ardından normal deploy tamamlandı; üç F04 migration’ının bitmiş olduğu ve eski iş tablolarının hâlâ aynı kaldığı doğrulandı. Kurtarma sonrası başarılı deploy duvar süresi **2961 ms** idi; aynı küçük-fixture sınırlamaları geçerlidir.

Bu yöntem gerçek üretimde koşulsuz otomatik `resolve` talimatı değildir. Gerçek yarım şemada nesneler kalmışsa, migration içeriği farklıysa veya hata nedeni kilit değilse bu testteki kurtarma koşulları sağlanmaz. Runner böyle bir durumda otomatik resolve yerine hata verir. SQLSTATE ve hata kaydı tek başına nesnelerin geri alındığını kanıtlamaz.

## Son işlevsel kabul

Kilit sonrası kurtarılan şemada geçiş sonrası üç servis testi ve dört gerçek HTTP/tarayıcı testi geçti. Eski kaynaklar, açık kullanıcı teyidi, tarihli plan, plan başına tek satın alma taslağı, güncellik ve salt okunur pilot raporu çalıştı. Başlangıç kurulumu bir testtir: toplam **1 önce + 3 sonra + 4 HTTP**, tamamı başarılıdır. Kilit/katalog/P3009 kontrolleri bu test sayısına ayrıca eklenmiş hayali senaryo adedi değildir; runner’ın zorunlu kontrolleridir.

Geçici DB ve servisler kapatıldı, eski migration kopyası silindi. Uygulama/web kodu veya migration SQL’i değiştirilmedi. Önceki API paketi ve `2EB4omJpWbYNTVcsFRywM` web paketi kaynak eşleşmesiyle kullanıldı. Yeni tam derleme veya önceki 41 DB testinin bütünü yeniden koşulmadı. JavaScript harness sözdizimi ve diff kontrolleri başarılıdır.

## Gerçek geçişe etkisi

Normal `CREATE INDEX` yazma işlemlerini bekleyebilir ve yazma işlemleri de indeks oluşturmayı bekleyebilir. Bu prova kilidi ortadan kaldırmaz veya üretimde kesintisiz geçiş garantisi vermez. Hedef hacim, kabul edilen bekleme süresi, bakım aralığı ve mevcut uzun transaction’lar gerçek geçiş planında belirlenmelidir.

[Geçiş/geri dönüş yönergesine](F04-GECIS-VE-GERI-DONUS-PROVASI-2026-10-22.md) ek olarak, deploy başarısızlığında yeni API açılmaz. Hata kodu, başarısız migration kaydı, kalan nesneler, uygulanmış önceki migration’lar ve eski iş verisi kontrol edilir. Sonraki adım, bu somut duruma göre yetkili operasyon kapsamında seçilir. Başarısız kaydı sırf deploy devam etsin diye tamamlandı veya geri alındı saymak bu provanın sonucu değildir.

Hedef hacimde indeks/kilit/süre kabulü, tam eski API/web/worker geri dönüşü, gerçek alan pilotu ve kapasite tercihi hâlâ açıktır. Gerçek şirketten bu bilgiler veya pilot kabulü alınmış sayılmaz.

## Tekrar çalıştırma ve kanıt

Proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-pilot-http-api F04_WEB_ROOT=/tmp/tekir-f04-bag-web-vr3hvkyy/.next-bag-final/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-kilit-prova-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-kilit-prova
```

Docker, yerel port erişimi, test Chromium’u ve hazır API/web paketleri gerekir. Geçici paketler kaldırılmışsa önce yeniden üretilmelidir. Canlı adres kabul edilmez; Prisma CLI’ye runner’ın bağlantısı zorunlu verilir. Engelleyici oturum yalnız bu DB ve koşum kimliğiyle seçilir.

Kanıt dizini `.release-candidates/f04-kilit-prova-20261022/`: `kilit-ilk-deploy.log`, `kilit-kor-tekrar.log`, `kilit-resolve.log`, `kilit-ozeti.json`, `ileri-gecis-ozeti.json`, önce/sonra servis logları, `http-kabul.log`, `kabul-ozeti.json` ve `kaynak-kaniti.json`. `kilit-ozeti.json` kilit alt aşamasını kaydeder; son deploy’un geçtiği `ileri-gecis-ozeti.json` içindeki `kilitProva.sonDeploy` ve ana kabul kaydında doğrulanır. İlk sandbox Docker reddi DB açmadı; son başarılı koşum özeti onun yerini aldı.
