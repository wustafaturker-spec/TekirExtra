# F01 — Çok ürünlü işlemler ve hacim kontrolü

Sonraki teslim: [Dönem inceleme özeti ve pilot ölçüm dosyası](F01-PILOT-OLCUMU-2026-10-15.md). Bu belge önceki teslimin ölçüm ve test sonuçlarını korur.

15 Ekim 2026. Çalışma alanındaki API iyileştirmesi ve kabul kapsamı. Gerçek şirketlerde pilot açılmadı; canlıya yayın yapılmadı. Yeni migration yoktur.

## Satış maliyeti okuması

Ortak `satisSatirlari` hesabında aynı faturanın ürün/varyant toplamı her satırda yeniden filtrelenip toplanıyordu. Hareket grubunun maliyeti de her satırda yeniden hesaplanıyordu. Miktar ve kayıtlı maliyet toplamları artık grup başına bir kez oluşturulur. Hareket grupları büyürken dizi kopyalanmaz.

Aynı ürün/birim için katsayı sorgusunun bekleyen Promise'i hemen saklanır. Önceki kodda ilk sorgu tamamlanana kadar eşzamanlı satırlar aynı sorguyu tekrar açabiliyordu. 500 aynı birimli satır ve ikinci faturanın tek katsayı sorgusunu paylaşması regresyon testiyle doğrulanır. Önbellek yalnız bu okumanın ömründedir.

Decimal toplama sırası, satır miktarına göre maliyet payı, kuruş yuvarlaması, varyant ayrımı, iade işareti ve tanımsız tarihsel birimde mevcut katsayı-1 davranışı korunur. F01 kapanışının tanımsız birimi reddeden sıkı kontrolü değişmez. Hareket payları hâlâ satır bazında üretilir; çok satır × çok hareket içeren bir grubun çıktı büyüklüğü ayrıca yük kabulü gerektirir. Bütün okumanın her veri dağılımında doğrusal olduğu iddia edilmez.

## Gerçek servislerle çok ürünlü kabul

Geçici PostgreSQL dosyası 35 senaryodan 43'e genişletildi. Kaynak ve tenant bağlamı gerçek uygulama rolü/RLS altında yürütülür. Yeni kapsam:

- Aynı satış faturasındaki iki farklı ürünün incelemesi eşzamanlı kapanır; iki çözüm olayı ve kendi kaynaklarına ait audit kayıtları birer kez oluşur. Mali kaynak snapshot'ı değişmez.
- Gerçek çok ürünlü `FaturaService.taslagaGeriAl` ile kapanış, her iki işlem sırasında sınanır. Seçilen stok kimliği sıralamada ilk ve son olacak şekilde dört senaryo vardır. Geri alma önceyse eski kanıt reddedilir; kapanış önceyse geri alma commit'i bekler ve tarihsel kanıt korunur. Her iki ürün için birer ters hareket ve eski stok miktarına dönüş doğrulanır.
- Gerçek `StokMaliyetService.uygula()` toplu yolu kullanılır. İlk ürünün transaction'ı commit olduktan sonra ikinci ürünün transaction'ı tutulur. Bekleyen gerçek `RaporService` kapanışının kilit beklemesi `pg_blocking_pids` ile gözlenir. Maliyet değiştikten sonra eski kanıt reddedilir; yeni kanıtla her inceleme ayrı kapanır. İki maliyet geçmişi aynı çalışma kimliğini taşır; toplu audit iki kartı bildirir.
- İkinci kartın transaction'ına hata enjekte edilir. Mevcut toplu servis kart başına commit yaptığı için ilk kartın değişikliği kalır; ikinci kartın maliyet/geçmiş yazımı rollback olur. Toplu başarı audit'i oluşmaz. İlk kart için yeni kanıt gerekir; ikinci kartın değişmemiş kaynağı kendi kanıtıyla kapanabilir. Bu senaryo toplu işlemin tamamının atomik olmadığını açıkça korur.

Fatura geri alma testinde bağlı belge fixture'ı boştur; e-belge/ödeme/sipariş zincirlerinin bütün kombinasyonları bu teslimde sınanmış sayılmaz. F01'e toplu kapanış ucu eklenmedi.

## Sentetik hacim ölçümü

Runner boş PostgreSQL 16 Alpine konteyneri açar; DB belleği 512 MB ile sınırlıdır. Migration'lar yalnız bu geçici veritabanına uygulanır. Uygulama rolünde tek şirket, tek satış faturası, aynı ürün/birimde 2.000 → 10.000 → 20.000 satır oluşturulur. Mal satırlarının birim fiyatı 0,10 TRY, kayıtlı maliyeti sıfırdır. Fixture mali hareketleri eklemelidir; mevcut cari hareketi değiştirme yetkisi verilmez.

Her hacimde üç liste çağrısı yapılır. Liste sayfa 2 / 100 satırdır; dönem toplamı bütün satırları içerir. Gerçek `RaporService` ve şirket pilot ayarı kullanılır. Okuma transaction sınırı, üretimdeki varsayılan gibi 5.000 ms'dir. Ölçüm servis çağrısı ve DB işlemini içerir; HTTP aktarımı ve tarayıcı çizimi dahil değildir.

Kaynak kodu koşumunda gözlenen süreler:

| Satış satırı | Liste çağrıları (ms) | Ortanca (ms) |
| --- | --- | --- |
| 2.000 | 151 / 110 / 117 | 117 |
| 10.000 | 553 / 606 / 551 | 553 |
| 20.000 | 1.197 / 1.155 / 1.101 | 1.155 |

20.000 satır Excel üretimi 5.070 ms, çıktı 1.381.250 bayttır. Bu süre kaynak okuması ve transaction kapandıktan sonraki XLSX üretimini kapsar. Dosya tekrar açılarak başlık hariç 20.000 satır, 20.000 ayrı kaynak kimliği ve 2.000,00 TRY uyarı cirosu doğrulanır. Ortak kâr/zarar hesabı aynı 20.000 satır / 2.000,00 TRY uyarısını verir.

Derlenmiş API ile ikinci, ayrı geçici veritabanı koşumundaki liste süreleri: 2.000 satırda 267 / 314 / 220 ms; 10.000 satırda 875 / 904 / 885 ms; 20.000 satırda 1.980 / 2.600 / 2.173 ms. Tam Excel 8.183 ms / 1.381.390 bayttır. Yeni rastgele kaynak kimlikleri ve dosya üretim zamanı nedeniyle dosya boyutu değişebilir. Bu ikinci koşumda da bütün tutar, kimlik, satır sayısı, 5 saniyelik DB transaction ve 20.001 satır koruması kontrolleri geçti. İki koşum arasındaki süre farkı performans kazancı veya gerileme karşılaştırması sayılmaz.

20.001'inci satış satırı eklendiğinde liste ve Excel 400 ile tarih daraltma uyarısı verir; kısmi rapor oluşturmaz. Tek ürün filtresi, dönem sınırını aşmak için kullanılamaz.

Bu üçer örnek p95 veya üretim SLA kabulü değildir. Sayılar yerel sentetik gözlemdir; eski sürümle süre karşılaştırması yapılmadı. Çok şirketli trafik, çok hareketli gruplar, ağ ve gerçek pilot hacmiyle bütçelendirme sürer.

## Doğrulama ve aday

Toplam **117 ayrı test** geçti: 73 birim/gerileme, 43 geçici PostgreSQL senaryosu ve 1 gerçek PostgreSQL/Nest HTTP/JWT/RLS kabulü. Birim kapsamı F01 maliyet, takip, doğrulama, Excel ve kâr testleri ile stok raporları, satış kırılımı ve birim dönüşümü tüketicileridir. Kaynak/derlenmiş tekrar koşuları test sayısına eklenmedi; önceki teslimdeki tarayıcı testleri bu toplamda sayılmaz.

Tam API TypeScript derlemesi `--noEmitOnError` ile exit 0 döndü. Aday çıktı `/tmp/tekirextra-devam-api-dist` dizinindedir; 43 PostgreSQL senaryosu ve HTTP kabulü bu çıktıyla da geçti. HTTP test kayıtları rollback edildi; geçici PostgreSQL konteynerleri her koşum sonunda silindi. `git diff --check` temizdir. Web koduna veya canlı servislere yayın yapılmadı.

```sh
# apps/api
pnpm exec vitest run src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts src/stok/stok.raporlar.test.ts src/fatura/satis-kirilimi.test.ts src/stok/birim-cevrim.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
node scripts/f01-yaris-kabul.mjs
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-devam-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-devam-api.tsbuildinfo
F01_API_DIST=/tmp/tekirextra-devam-api-dist node scripts/f01-yaris-kabul.mjs
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-devam-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts
```

## Kalan işler

Gerçek şirket/kullanıcı seçimi, baz/sonuç ölçümü ve muhasebe alan kabulü; gerçek dağılımla eşzamanlı yük bütçesi, maliyet dağıtımı ve diğer çok kaynaklı yolların ek yarışları; yayın adayı ve kalıcı canlı yayın devam eder. F01 görevleri `devam_ediyor` kalır.

Önceki teslim: [Şirket bazında kontrollü açılış](F01-KONTROLLU-ACILIS-2026-10-15.md).
