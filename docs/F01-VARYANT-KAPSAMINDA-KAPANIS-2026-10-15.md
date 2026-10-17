# F01 — Varyant kapsamında kontrollü inceleme kapanışı

Sonraki teslim: [Şirket bazında kontrollü açılış](F01-KONTROLLU-ACILIS-2026-10-15.md). Bu belge önceki teslimin tarihsel sonuçlarını korur; güncel kullanım modları ve kabul sonuçları yeni belgede yer alır.

15.10.2026. Varyant maliyet ayrımı tesliminin devamı. Uygun varyantlı kaynak artık kullanıcı notu ve güncel doğrulamayla kapatılabilir. Yeni migration yoktur; canlı servisler ve mevcut şirket kayıtları değiştirilmedi.

## Kapanış koşulu

Seçili satış satırının varyantı sunucuda bulunur; istemci varyant veya miktar seçerek bu kapsamı değiştiremez. Aynı faturada aynı ürün ve varyanta ait bütün satırlar ana birime çevrilir. Yalnız bu varyantın ilişkili stok hareketleriyle miktar ve pozitif kayıtlı maliyet kapsamı doğrulanır. Aynı varyantın tamamen terslenmiş maliyet dilimleri netlenir; kalan sıfır/negatif veya eksik dilim kapanışa uygun sayılmaz.

Varyantın aynı şirket ve ürüne ait olması gerekir. Satış satırı ve hareket varyantları eşleşmiyorsa başka grubun maliyeti kullanılmaz. Faturadaki bu ürünün hiçbir satırına karşılık gelmeyen varyant hareketi varsa kaynak belirsiz sayılır; seçilen sağlıklı görünen grup da kapatılmaz. Eski varyantsız kayıtlar ayrı grup olarak korunur. Tanımsız birim, eski kanıt/sürüm ve diğer mevcut kaynak engelleri devam eder.

Diğer varyantın eksik satırı kendi uyarı ve incelemesiyle kalır. Bir kaydı kapatmak aynı varyantın diğer inceleme kayıtlarını da kapatmaz. Bu teslim maliyet doldurmaz; kayıtlı değerlemenin bağımsız muhasebe doğrulaması değildir.

## Ekran ve tutar anlamı

Panel, bu varyantın birlikte kontrol edilen satış satırı sayısını ve ana birimde toplam miktarını gösterir. Gösterilen maliyet **seçilen satış satırının payıdır**; grup toplam maliyeti olarak sunulmaz. Örneğin aynı varyantın 1 ve 2 adetlik satırları toplam 3 adet/30 TL kayıtlı maliyetle doğrulanırken ilk satırın maliyeti 10 TL olabilir. Kapanış notu ve kullanıcı geçmişi bu ayrımı belirtir.

Yönetici ve muhasebe güncel uygun doğrulama ve notla kapanış yapabilir; diğer maliyet okuma rollerinin yazma yetkisi değişmedi. HTTP gövdesi `{ kayitId, beklenenGuncelleme, kanit, aciklama }` olarak kalır. İstemciden varyant kimliği, kapsam miktarı veya mali tutar kabul edilmez. Önceki sürümün bekleyen kanıtı yeni kapsamla uyuşmazsa yeniden doğrulama gerekir.

## Kaynak kilidi ve denetim

Stok kartı ve birimlerden sonra ürünün varyant satırları kimlik sırasıyla `FOR SHARE` kilitlenir. Ardından fatura, ilgili fatura satırları, stok hareketleri ve kapatmada inceleme kaydı kilitlenir. Mevcut stok kartıyla başlayan sıra korunur. Varyant kimliği güncellemesi ve kapanış iki işlem sırasında da birbirini bekler.

Kanıt, seçilen varyantın kimlik/ad/kod/durum/sürüm bilgisi ve grup satırları/miktarıyla genişletildi. Faturanın bu ürüne ait bütün satır ve hareketleri de kaynak özetinde tutulur; diğer gruptaki kaynak değişikliği eski kanıtı temkinli biçimde geçersiz kılabilir. Kapanış bu özeti aynı transaction içinde tekrar üretir ve sürümü karşılaştırır.

Çözüm olayı ve `AuditLog` aynı transaction içinde yazılır. Audit JSON'unda varyant kimliği/kodu/adı, kontrol edilen satır sayısı ve kapsam miktarı bulunur. Kullanıcı geçmişinde varyant ve seçilen satırın kayıtlı maliyeti yer alır. Sonradan yapılan meşru değişiklik kapanış anındaki tarihsel kanıtı değiştirmez.

Pasife alınmış bir varyantın geçmişteki uygun kayıtlı maliyetiyle takip kapanabilir; bu, varyanta yeni stok hareketi açılması değildir. Kapalı dönemde de yalnız takip/audit kapanışı yapılabilir; mali hareket ve dönem durumu değişmez.

## Kabul kapsamı

Geçici PostgreSQL dosyası önceki 21 senaryoyu 31'e genişletir. Önceki bütün varyantları engelleyen koşul yerine eşleşmeyen satır/hareket reddi korunur ve uygun eşleşen varyant kapanışı doğrulanır. Ek kapsam:

- Varyant kimliği ve kapsamının audit'e yazılması; mali snapshot'ın değişmemesi.
- Aynı varyantın farklı birimlerle birden çok satırının birlikte doğrulanması; diğer varyantın eksik kaydının açık kalması.
- Kısmi sıfır maliyetin başka varyantın pozitif maliyetiyle tamamlanmaması.
- Faturada karşılığı olmayan hareket ve başka ürüne ait varyantın reddi.
- Önizlemeden sonra varyant kimliği değişiminde 409 ve açık inceleme.
- İki ayrı bağlantıda kimlik yazımı önce/kapanış önce sıralarının `pg_blocking_pids` ile doğrulanması; tarihsel audit kimliğinin korunması.
- Pasif varyantın tarihsel maliyeti ve kapalı dönemde mali kayıt yazmadan takip kapanışı.
- Aynı faturanın iki sağlıklı varyant incelemesinin eşzamanlı, kendi kanıtıyla birer kez kapanması.

Runner her koşuda yeni boş PostgreSQL açar, migration'ları uygular ve uygulama rolü/RLS/FORCE kontrollerinden sonra test eder. Her iki Prisma bağlantı değişkeni geçici ortama atanır. Konteyner koşu sonunda otomatik silinir. [Kurulum ve izolasyon ayrıntıları](F01-ESZAMANLILIK-KABULU-2026-10-15.md).

## Sonuç ve yayın adayı

Toplam 111 ayrı test geçti: 64 F01 birim/gerileme, 31 izole PostgreSQL senaryosu, 1 PostgreSQL/Nest HTTP kabulü ve 15 üretim Chromium senaryosu. Tekrar koşular test sayısına ayrıca eklenmedi. Yalnız bu teslimde çalıştırılan testler sayılmıştır; önceki teslimdeki 9 ek stok/fatura/birim testi bu sayıya eklenmedi.

31 PostgreSQL senaryosu kaynak koduyla ve son derlenmiş API ile geçti. Tam API TypeScript derlemesi `--noEmitOnError` ile exit 0 döndü; çıktı `/tmp/tekirextra-devam-api-dist` dizinindedir. Mevcut F01 HTTP kabulü de bu çıktıyla geçti ve sentetik kayıtlarını rollback etti. Geçici PostgreSQL konteyneri koşu sonunda otomatik silindi.

Web üretim çıktısı `.next-f01-varyant-kapanis-release-20261015`, build kimliği `LEjT0tpyzMyxx0AAGq5_K` olup 15 Chromium testi bu çıktıyla geçti. Yeni senaryo seçilen varyantın kapsamını, başarılı kapanışını, diğer varyant uyarısının görünür kalmasını ve yenilemede geçmişi doğrular. Eşleşmeyen hareketli varyant senaryosu kapanışın kapalı kaldığını korur. Tarayıcı API yanıtları taklittir; gerçek DB senaryoları ayrıca çalıştırıldı. `git diff --check` temizdir. Canlı yayın yapılmadı.

```sh
# apps/api
pnpm exec vitest run src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
node scripts/f01-yaris-kabul.mjs
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-devam-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-devam-api.tsbuildinfo
F01_API_DIST=/tmp/tekirextra-devam-api-dist node scripts/f01-yaris-kabul.mjs
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-devam-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-varyant-kapanis-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-varyant-kapanis-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Kalan kapsam

F01 görevleri `devam_ediyor` kalır. Daha geniş çok ürünlü/toplu işlem yarışları ve yük kabulü, paket bazında kontrollü açılış, pilot kullanıcı/muhasebe ölçümü ve canlı yayın tamamlanmadı. Bu teslim bütün ERP yazma yollarının veya maliyet değerleme yöntemlerinin tam kabulü sayılmaz.
