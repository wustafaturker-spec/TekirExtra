# F01 — Ayrı bağlantılarda eşzamanlılık kabulü

**Sonraki teslim:** [Varyant maliyet ayrımı, birim ve kapalı dönem kabulü](F01-VARYANT-BIRIM-VE-KAPALI-DONEM-KABULU-2026-10-15.md). Aşağıdaki yedi yarış ve 69 test sonucu bu önceki teslimin tarihsel kaydıdır; izole senaryo dosyası sonraki teslimde genişletildi.

15.10.2026. Kaynak doğrulaması ve kontrollü inceleme kapatmanın devamı. Kaynak kontrolüne ek birim tanımlarını sabitleyen kilit eklendi. Canlı servisler ve mevcut şirket kayıtları değiştirilmedi; yeni migration yoktur.

## Bulgu ve düzeltme

İlk gerçek yarış koşusunda maliyet uygulaması, çift kapanış, fatura geri alma ve inceleme notu senaryoları geçti. Ek birim katsayısını değiştiren bağlantı ile kapanış arasında beklenen kilit beklemesi oluşmadı. Mevcut sorgular stok kartını kilitliyor, ek birim satırını sabitlemiyordu.

Doğrulama/kapatma artık stok kartı kilidinden sonra ürünün `stok_birimleri` satırlarını kimlik sırasıyla `FOR SHARE` kilitler. Mevcut satırların katsayı güncellemesi/silinmesi işlem sonuna kadar bekler; yeni ek birim eklenmesinin FK kontrolü stok kartı kilidinde bekler. Ana birim zaten stok kartında kilitlidir. Kaynak kilit sırası: stok kartı → ek birimler → fatura → ilgili fatura satırları → stok hareketleri → kapatmada inceleme kaydı. İşlem izolasyonu veya mevcut maliyet hesaplama formülü değiştirilmedi.

Katsayı değişimi önce commit ederse kapanış yeni kapsamı görür ve eski kanıtı reddeder. Kapanış önce kaynak kilitlerini alırsa katsayı yazımı onun commit'ini bekler. Sonradan yapılan değişiklik, kapanış anındaki kanıtı değiştirmez; geçmiş kayıt yeni kaynağın sürekli doğruluğunu garanti etmez.

## Gerçek PostgreSQL test düzeni

`node scripts/f01-yaris-kabul.mjs` her koşuda yalnız yerel erişimli, rastgele port ve kimlikte, tmpfs üzerinde geçici PostgreSQL 16 konteyneri açar. Mevcut imaj kullanılır. Boş veritabanına depodaki migration'lar uygulanır. Hem `DATABASE_URL` hem `DATABASE_URL_MIGRATE` bu konteynere atanır; uygulama `.env` bağlantıları test istemcileri için kullanılmaz. Test sonunda konteyner durdurulur ve `--rm` ile silinir; mevcut veritabanının hareket silme/güncelleme korumaları gevşetilmez.

Testler yalnız `F01_YARIS_DB_URL` ve koşuya ait nonce ile açılır. Loopback host, uygulama rolü, rastgele test veritabanı adı/portu ve veritabanındaki koşu işareti doğrulanır. `tekir_app` süper kullanıcı değildir, RLS atlama yetkisi yoktur ve test edilen tabloların sahibi değildir. Stok hareketleri ile inceleme/olay tablolarında RLS ve FORCE etkinliği doğrulanır.

Her test kendi sentetik tenantını oluşturup commit eder; bu sayede iki bağımsız Prisma istemcisinin transaction'ları aynı kaynağı görebilir. Üçüncü istemci `pg_blocking_pids` üzerinden ikinci bağlantının gerçekten birinci bağlantıda beklediğini doğrular. Sabit süre uyutmanın tamamlanması yarış kanıtı sayılmaz. Testlerde bekleme ve transaction süreleri sınırlıdır; hata olsa da açılmış transaction'lar serbest bırakılır.

Bu dosya normal kabul konfigürasyonundan ayrıdır; yalnız `vitest.maliyet-yaris.config.ts` ve geçici ortam runner'ıyla çalışır. Yanlış/eksik bağlantı ayarında testler çalışmaya başlamaz.

## Yedi senaryo

1. Gerçek `StokMaliyetService.kartiUygula` satış maliyetini 10'dan 20'ye değiştirdikten sonra kapanış bekler, eski kanıtla 409 alır. Yeni doğrulama ve açık kapatma başarılıdır.
2. Kapanış önce yazarsa gerçek maliyet uygulaması commit'i bekler. Kapanışın 10 tutarındaki tarihsel kanıtı korunur; sonraki maliyet 20 olabilir.
3. İki kapanış aynı kanıtla çakışınca biri kapanır, diğeri 409 alır. Tek çözüm olayı ve tek audit vardır; mali kayıt snapshot'ı değişmez.
4. Gerçek `FaturaService.taslagaGeriAl` önce tamamlanırsa kapanış bekler ve 409 alır; fatura taslaktır ve ters stok hareketi oluşur. Servisin sorguları test transaction'ına yönlendirilir. Fixture'da bağlı belge/e-belge yoktur; boş belge zinciri işbirlikçisi kullanılır. Entegratör çağrısı yapılmaz.
5. Ek birim katsayısı önce değiştirilirse kapanış bekler; eksilen hareket kapsamı nedeniyle eski kanıt reddedilir, inceleme açık kalır.
6. Gerçek inceleme not güncellemesi önce yazarsa kapanış kayıt kilidinde bekler; sürüm değiştiği için 409 alır, not/durum korunur.
7. Kapanış önce yazarsa ek birim katsayısı güncellemesi commit'i bekler. Tek çözüm/audit ve kapanış anındaki kanıt korunur.

Kapanışın mali kayıt yazmadığı kontrollerde fatura/satır, stok kartı/hareketleri, cari hareketler ve maliyet düzeltme geçmişi karşılaştırılır. Maliyet uygulaması veya fatura geri alma servisinin kendi beklenen mali etkisi bu eşitlik kontrolüne dahil edilmez.

## Sonuç ve tekrar çalıştırma

Toplam 69 ayrı test geçti: F01'in 61 birim/gerileme testi, 7 ayrı bağlantılı yarış ve 1 PostgreSQL/Nest HTTP kabul senaryosu. Yedi yarış kaynak koduyla ve son derlenmiş API çıktısıyla geçti; tekrar koşular test sayısına ayrıca eklenmedi. Son tam API TypeScript derlemesi `--noEmitOnError` ile exit 0 döndü. Çıktı `/tmp/tekirextra-devam-api-dist` dizinindedir. Mevcut F01 DB/HTTP senaryosu da aynı çıktıyla geçti ve kayıtlarını rollback etti. Derlenmiş yarış koşusu ayrı boş PostgreSQL'de migration'ları uyguladı; konteyner koşu sonunda durdurulup otomatik silindi. `git diff --check` temizdir. Web kaynakları değiştirilmedi; canlı yayın yapılmadı.

```sh
# apps/api
node scripts/f01-yaris-kabul.mjs
pnpm exec vitest run src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-devam-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-devam-api.tsbuildinfo
F01_API_DIST=/tmp/tekirextra-devam-api-dist node scripts/f01-yaris-kabul.mjs
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-devam-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts
```

Kurulumun ilk denemelerinde PostgreSQL'in geçici başlangıç sunucusu için TCP hazır olma kontrolü düzeltildi. Ardından migration aracının ayrı `DATABASE_URL_MIGRATE` değişkeni kullandığı gözden kaçırıldığı için geçici veritabanının boş kaldığı görüldü. Bu değişken de geçici bağlantıya sabitlendi. Mevcut migration veritabanının son 30 dakikalık geçmişi salt okunur sorguyla kontrol edildi; yeni migration kaydı yoktu. Yanlış kurulumla yarış testi yürütülmedi; şema/RLS ön kontrolü testi durdurdu. Sonraki koşu gerçek boş ortamda migration'ları uygulayıp yedi senaryoyu geçti.

## Kalan sınırlar

Bu kabul seçilen yedi yarışın kanıtıdır; bütün ERP yazma yollarının veya çok ürünlü toplu işlemlerin deadlock analizinin tamamlandığı anlamına gelmez. Varyant/kapalı dönem ayrıntılı kabulü, paket bazında kontrollü açılış, pilot ölçümü ve canlı yayın devam eder. F01 CSV görevleri bu nedenle `devam_ediyor` kalır. Meşru sıfır maliyet otomatik kapatılmaz ve varyantlı kaynakta mevcut temkinli kapatma engeli korunur.
