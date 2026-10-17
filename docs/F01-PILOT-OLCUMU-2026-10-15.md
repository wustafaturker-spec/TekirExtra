# F01 — Dönem inceleme özeti ve pilot ölçüm dosyası

Sonraki teslim: [Önceki ölçümle karşılaştırma](F01-OLCUM-KARSILASTIRMA-2026-10-15.md). Bu belge ilk ölçüm görünümünün tarihsel kapsamını ve sonuçlarını korur; dosya karşılaştırması sonraki teslimde eklenmiştir.

15 Ekim 2026. Çalışma alanındaki salt okunur ölçüm görünümü. Gerçek şirketlerde pilot açılmadı; canlıya yayın yapılmadı. Yeni tablo veya migration yoktur.

## Kullanım

Satış Maliyet Kontrolü ekranındaki **Dönem inceleme özeti** düğmesi, gösterilen satış dönemi için güncel uyarı ve inceleme ölçümlerini açar. İlk liste açılışında ek özet sorgusu çalışmaz. Ürün, bulgu ve sayfa filtreleri özete uygulanmaz; bu ayrım ekranda belirtilir. Yenileme, inceleme kaydı değişimi veya yeni dönem seçimi güncel ölçümün yeniden okunmasını sağlar.

**Ölçüm dosyasını indir (JSON)** gösterilen yanıtı şirket kimliği/unvanı, satış dönemi, kullanım modu, sürüm 1 ve DB transaction başlangıç zamanı ile saklar. Dosya kişisel inceleme notlarını veya kullanıcı adlarını içermez. Dosya indirirken ikinci bir kaynak okuması yapılmaz; ekranda gösterilen ölçüm indirilir.

Dosyalar pilot öncesi/sonrası ölçüm kanıtı olarak saklanabilir. Otomatik karşılaştırma, dosya içeriğine güvenerek veri değiştirme, kalıcı pilot baz kaydı veya otomatik pilot başarısı kararı eklenmedi. Gerçek veriyle ilk ve son ölçüm henüz alınmadı.

## Ölçüm tanımı

Kohort, seçilen **satış belgesi dönemi** içindeki güncel kesin satış faturalarının pozitif TRY cirolu mal satırlarıdır. Hizmetler, iadeler, sıfır/negatif cirolu satırlar, taslak ve iptal faturalar kapsam dışıdır. İncelemeler açılış/kapanış tarihine göre ayrıca süzülmez; bu satış satırlarına ait bütün F01 inceleme kayıtları değerlendirilir. Başka neden/tür/kaynakla açılmış Düzeltme Merkezi kayıtları katılmaz.

| Alan | Tanım |
| --- | --- |
| Uyarı satırı / ilgili ciro | Mevcut maliyet listesi ve kâr uyarısıyla aynı sıfır kayıtlı maliyet koşulu; ciro decimal-string TRY |
| Aktif takipli uyarı | En az bir açık/incelemede/beklemede F01 inceleme kaydı olan uyarı satırı; satır bir kez sayılır |
| Aktif takipsiz uyarı | Aktif incelemesi olmayan uyarı satırı; geçmişte kapanmış/yoksayılmış kaydı olabilir |
| Takipli kaynak satırı | Durumdan bağımsız en az bir F01 inceleme geçmişi olan ayrı kaynak satırı |
| Açık / incelemede / beklemede | İnceleme **kaydı** sayısı; kaynak satırı sayısı değildir |
| Doğrulanmış kapanış | Güncel durumu `cozuldu` ve `kayitli_maliyet_dogrulandi → cozuldu` olayı bulunan F01 kaydı |
| Diğer kapanış | Güncel durumu `cozuldu`, fakat bu doğrulama olayı bulunmayan kayıt; kaynakla doğrulanmış sayılmaz |
| Medyan süre | Kaydın `createdAt` zamanından ilk doğrulama olayının `createdAt` zamanına kadar geçen takvim süresinin medyanı; saniye, milisaniyeye yuvarlanmış string |

Süreye yalnız güncel durumu çözülmüş doğrulanmış kayıtlar girer. Negatif/geçersiz tarih farkı medyana alınmaz; dışarıda kalan kayıt sayısı gösterilir. Geçerli örnek yoksa medyan `null` ve ekranda “Henüz ölçüm yok” döner; sıfırmış gibi sunulmaz. Yeni kayıtla tekrar açılan inceleme ayrı örnek sayılır. Sayfa geçmişindeki 50 olay sınırı ölçümü etkilemez; ilk doğrulama olayı doğrudan sorgulanır.

Karşılaştırmada şirket, satış dönemi ve ölçüm sürümü aynı olmalıdır. Arada kesinleşen, iptal/taslak olan faturalar veya değişen maliyetler kohortu/uyarıyı değiştirebilir. Güncel kaynaklara göre dışarıda kalan eski incelemeler ayrı bir işlem tarihi raporu olarak gösterilmez. Uyarı azalması veya inceleme kapanışı, maliyet doğruluğunu veya kâr artışını tek başına kanıtlamaz.

Dosyadaki `kapsam.kaynakKimlikOzeti`, kohorta giren sıralı satış satırı kimliklerinin SHA-256 özetidir. Aynı sayıda farklı satış satırı da bu özeti değiştirir; sıralama veya maliyet değişikliği değiştirmez. Şirket/dönem/sürümle birlikte kaynak kümesinin değişip değişmediğini kontrol etmeye yarar. Tutar doğruluğu kanıtı veya dosya imzası değildir.

## API ve tutarlılık

`GET /rapor/maliyet-eksikleri/izleme?baslangic=YYYY-MM-DD&bitis=YYYY-MM-DD` yalnız tarih parametrelerini kabul eder. Aynı 366 günlük dönem ve 20.000 satış/iade satırı koruması kullanılır. Ayrıca 20.000 F01 inceleme kaydı aşılırsa kısmi medyan yerine 400 ve tarih daraltma uyarısı döner.

Yanıt `Cache-Control: no-store` taşır; tarayıcı/ara önbelleğin eski bir ölçümü yeni sorgu gibi sunması önlenir.

Mevcut beş maliyet okuma rolü geçerlidir. Kapalı şirket modu 403 döner; salt okunur/pilot/açık modlarda özet okunabilir. Yeni yazma yetkisi veya mali kayıt işlemi eklenmedi.

Özet, `PrismaService.tenantIslem` içinde isteğe bağlı `RepeatableRead` izolasyonu kullanır. Kaynak satışlar, inceleme durum/olayları ve şirket bilgisi aynı DB snapshot'ından okunur. Mevcut diğer çağrıların izolasyon varsayılanı değiştirilmedi. Şirket ayarı kilidi aynı işlem boyunca korunur. `alindigiZaman`, DB transaction başlangıç zamanıdır. Serialization/DB hatası başarılı veya boş ölçüm gibi gösterilmez; kullanıcı Yenile ile tekrar okuyabilir.

## Kabul

84 birim/gerileme testi geçti. Kaynak koduyla 45 geçici PostgreSQL ve gerçek HTTP/JWT/RLS kabulü geçti. Yeni birim kapsamı boş/null süre, çift/tek medyan, tekrar açılmış kayıtlar, aktif takipli/takipsiz satır ayrımı, genel kapanış, ters tarih, kapsam dışı kayıtlar, kaynak kimlik özeti ve geçmiş limiti içerir.

İki yeni PostgreSQL senaryosu gerçek `PrismaService` ile snapshot tutarlılığını ve doğrulamasız eski kapanış/taslağa geri alma kapsamını doğrular. İlkinde veritabanının `transaction_isolation` değeri gözlenir; kaynak okuması ile inceleme okuması arasında diğer bağlantıda gerçek F01 kapanışı commit edilir. İlk özet önceki açık kaydı tutarlı görür; sonraki özet doğrulanmış kapanışı görür. Mali kaynak snapshot'ı değişmez. Diğer senaryodaki doğrulamasız kapalı kayıt eski veriyi temsil eden fixture'dır; genel merkeze yeni kapatma yolu eklenmez. HTTP kabulü yeni uç için bozuk JWT, beş rol, kapalı/salt okunur/pilot/açık modları, başka şirketin bağımsız toplamı ve mevcut liste/kâr eşitliğini kapsar.

Web üretim derlemesi `.next-f01-izleme-release-20261015`, build kimliği `W9TQCNH8hJ7OnAbB2MqiG` ile geçti. 20 Chromium senaryosu bu çıktı üzerinde geçti. İki yeni senaryo isteğe bağlı özet açılışını, filtre kapsamını, indirilen JSON dosyasının gösterilen yanıtla birebir eşleşmesini ve özet hatasının sıfır sonuç/indirilebilir ölçüm gibi sunulmamasını doğrular. Tarayıcı API yanıtları taklittir; gerçek DB kabulü ayrıca çalıştırılır.

Toplam **150 ayrı test** geçti: 84 birim/gerileme, 45 geçici PostgreSQL, 1 gerçek HTTP/JWT/RLS ve 20 üretim Chromium senaryosu. Tekrar koşular ayrıca sayılmadı. Tam API TypeScript derlemesi `--noEmitOnError` ile exit 0 döndü; aday çıktı `/tmp/tekirextra-devam-api-dist` dizinindedir. 45 PostgreSQL senaryosu ve güncel HTTP kabulü bu çıktıyla da geçti. HTTP kabulü, aynı kaynak satırındaki F01 dışı neden kaydının ölçüme alınmamasını ve `no-store` başlığını da doğrular.

Hacim senaryosuna yeni özet çağrısı da eklendi: 20.000 satış satırında 20.000 uyarı / 2.000,00 TRY, 1 aktif takipli ve 19.999 aktif takipsiz satır döner; veri okuması 5 saniyelik DB transaction sınırıyla geçer. 20.001 satırda yeni uç da kısmi özet yerine 400 döner. Bu hacim kontrolünde kayıt sayısı 1'dir; 20.000 inceleme kaydının olay geçmişiyle birlikte üretim yükü kabul edildiği anlamına gelmez. Snapshot izolasyonu ayrıca gerçek `PrismaService` yarışında sınanmıştır.

Geçici PostgreSQL konteynerleri her koşum sonunda silindi; HTTP fixture kayıtları rollback edildi. `git diff --check` temizdir. Web derlemesinin oluşturduğu `next-env.d.ts` referansı tur başlangıcındaki değerine geri getirildi. Gerçek şirket ayarları veya çalışan servisler değiştirilmedi.

```sh
# apps/api
pnpm exec vitest run src/rapor/maliyet-izleme.test.ts src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts src/stok/stok.raporlar.test.ts src/fatura/satis-kirilimi.test.ts src/stok/birim-cevrim.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
node scripts/f01-yaris-kabul.mjs
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-devam-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-devam-api.tsbuildinfo
F01_API_DIST=/tmp/tekirextra-devam-api-dist node scripts/f01-yaris-kabul.mjs
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-devam-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-izleme-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-izleme-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Kalan işler

Gerçek pilot şirket/kullanıcı seçimi, baz ve sonuç dosyalarının gerçek veriyle alınması, muhasebe alan kabulü, gerçek trafik/hacim bütçesi ve yayın adayı/canlı yayın devam eder. F01 görevleri `devam_ediyor` kalır.

Önceki teslim: [Çok ürünlü işlemler ve hacim kontrolü](F01-COK-URUNLU-YARIS-VE-HACIM-2026-10-15.md).
