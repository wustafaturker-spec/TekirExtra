# F01 — Varyant, birim ve kapalı dönem kabulü

**Sonraki teslim:** [Varyant kapsamında kontrollü inceleme kapanışı](F01-VARYANT-KAPSAMINDA-KAPANIS-2026-10-15.md). Uygun varyantlı kaynağın kapanışı bu sonraki teslimde açıldı. Aşağıdaki kapanış engeli ve 109 test sonucu önceki teslimin tarihsel kaydıdır.

15.10.2026. Ayrı bağlantılardaki yarış kabulünün devamı. Ortak satış kaynağında varyant maliyet ayrımı düzeltildi; F01 ekranı ve Excel'e varyant kodu/adı eklendi. Canlı servisler ve mevcut şirket kayıtları değiştirilmedi; migration yoktur.

## Bulgu ve düzeltme

Ortak `satisSatirlari` hesabı stok hareketlerini fatura ve ürünle grupluyordu. Aynı ürüne ait iki varyantın birer satış satırı olduğunda, yalnız ilk varyanta ait 40 TL hareket maliyeti iki satıra 20'şer TL dağıtılıyordu. İkinci varyantın maliyet eksikliği görünmüyordu. Düzeltmeden önce iki yeni test satışta `[20, 20]`, iadede `[-20, -20]` sonucuyla başarısız oldu.

Grup ve satır payı artık fatura + ürün + varyant temelindedir. Aynı örnek satışta `[40, 0]`, iadede `[-40, 0]` döner. Aynı varyantın satırları kendi ana birim miktarlarına göre paylaşır. Varyantsız eski kayıtlar ayrı gruptur; varyantlı kayıtla birleştirilmez. Ürün bazındaki toplama davranışı korunur; hareketin kayıtlı maliyeti değiştirilmez.

Bu ortak kaynak satış raporları, kâr/zarar ve F01 listesi tarafından kullanılır. Kaynak varyantı eşleşmeyen eski hareketler başka satıra maliyet olarak dağıtılmaz. Mali kayıtlar aynı kalırken rapor satırlarının maliyeti ve eksik maliyet uyarıları değişebilir; eski varyant eşleşmeleri ayrıca incelenmelidir. Bu teslim tüm FIFO/değerleme motorlarının varyant kabulü değildir.

## Kullanıcıya yansıması

F01 liste yanıtında `varyantId`, `varyantKod`, `varyantAd` bulunur. Liste ve kayıtlı kaynak doğrulama panelinde okunabilir varyant kodu/adı gösterilir. Yeni inceleme kayıtlarının kaynak açıklamasına varyant kimliği de eklenir. Excel'in mevcut ilk 13 sütunu korunur; sona `Varyant Kodu` ve `Varyant` sütunları eklenir. Metinler formül olarak değerlendirilmez.

Varyantlı satır veya hareket içeren kaynakta otomatik inceleme kapatma engeli devam eder. Bu teslim bu engeli kaldırmaz. Liste bulgusu ve uyarının doğru varyanta ait olması ile kanıtlı kapanışı açmak ayrı kabul koşullarıdır. Maliyet uygulama yetkileri genişletilmedi.

## Kabul kapsamı

Geçici PostgreSQL runner'ı mevcut yedi yarış senaryosuna aşağıdaki on dört gerçek DB senaryosunu ekler:

- Varyantın yalnız satış satırında, yalnız harekette veya ikisinde bulunması: hiçbirinde zorlanmış istemci kanıtıyla kapanış yapılamaz.
- Aynı ürünün varyantları ve eski varyantsız/varyantlı satırları: diğer varyantın maliyeti eksik satırı gizlemez. F01 listesi ve gerçek kâr/zarar veri kaynağı aynı eksik ciroyu verir; kayıt açılabilir ve kaynak açıklaması varyantı belirtir.
- `1 paket = 12 adet` ve kesirli birim/miktar: tam hareket kapsamıyla doğru kayıtlı maliyet doğrulanır; kapanış fatura, stok, cari, maliyet geçmişi ve dönem snapshot'ını değiştirmez.
- Tanımsız birim ve sıfır katsayı: katsayı varsayımıyla kapanış yapılamaz.
- Kuruşa yuvarlandığında sıfır kalan çok küçük maliyet: kapanış açılmaz.
- Büyük kayıtlı maliyet ve döviz: decimal hesapla 370.370.367,37 TL maliyet ve 40.250,40 TL ciro korunur; kapanış tutar yazmaz.
- Kapalı dönemde sıfır maliyet: gerçek maliyet uygulaması eski hareketi doldurmaz; inceleme açık kalır.
- Kapalı dönem stok hareketi maliyetini doğrudan güncelleme: veritabanı tetikleyicisi de reddeder. Önceden kayıtlı pozitif maliyetin inceleme kapanışı ise yalnız takip/audit yazabilir; dönem açılmaz ve mali snapshot aynı kalır.
- Kapalı dönemde gerçek fatura geri alma servisi: mali hareket oluşturmadan 409 ile durur.

Kapalı dönem kayıtları test verisidir; test içinde mali dönem oluşturulması gerçek dönem kapatma sürecinin kabulü sayılmaz. Yabancı tenant ve HTTP rol matrisi mevcut F01 DB/HTTP kabulünde korunur. Geçici veritabanının migration, RLS, uygulama rolü ve otomatik silme düzeni [önceki kabul notundaki](F01-ESZAMANLILIK-KABULU-2026-10-15.md) gibidir; hem `DATABASE_URL` hem `DATABASE_URL_MIGRATE` geçici ortama sabitlenir.

## Doğrulama

Toplam 109 ayrı test geçti: 64 F01 birim/gerileme, ortak kaynak tüketicileri için 9 stok/fatura/birim testi, 21 izole PostgreSQL senaryosu, 1 PostgreSQL/Nest HTTP kabulü ve 14 üretim Chromium senaryosu. Tekrar koşular test sayısına ayrıca eklenmedi. Yirmi bir izole senaryo kaynak koduyla ve son derlenmiş API ile geçti. Derlenmiş koşuda gerçek kâr/zarar kaynağı da kullanıldı; iki varyantlı ve eski varyantsız/varyantlı örnekte 200 TL net satış, 10 TL SMM, 190 TL net kâr ve 100 TL eksik maliyetli ciro listeyle uyuştu. Yeni Chromium senaryosu varyantın listede ve doğrulama panelinde görünmesini, ayrıntılı inceleme gerektiğinde kapanışın kapalı kalmasını denetledi. Tarayıcı API yanıtları taklittir; gerçek DB senaryoları ayrı olarak çalıştırıldı.

Tam API TypeScript derlemesi `--noEmitOnError` ile başarılıdır. Çıktı `/tmp/tekirextra-devam-api-dist` dizinindedir; aynı çıktıyla mevcut F01 HTTP kabulü de geçti ve sentetik kayıtlarını rollback etti. Web üretim çıktısı `.next-f01-varyant-release-20261015`, build kimliği `y6D3DYXKR1B7H2gVs5Ugc` olup 14 Chromium testi bu çıktıyla geçti. Geçici PostgreSQL konteyneri test sonunda otomatik silindi. `git diff --check` temizdir. Canlı yayın yapılmadı.

```sh
# apps/api
node scripts/f01-yaris-kabul.mjs
pnpm exec vitest run src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
pnpm exec vitest run src/stok/stok.raporlar.test.ts src/stok/urun-hareket-kaynak.test.ts src/fatura/satis-kirilimi.test.ts src/stok/birim-cevrim.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-devam-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-devam-api.tsbuildinfo
F01_API_DIST=/tmp/tekirextra-devam-api-dist node scripts/f01-yaris-kabul.mjs
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-devam-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-varyant-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-varyant-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Kalan kapsam

F01 görevleri `devam_ediyor` kalır. Varyantlı kaynakta kanıtlı kapanışın açılması, daha geniş çok ürünlü/toplu yarışlar, paket bazında kontrollü açılış ve pilot ölçümü henüz tamamlanmadı. Yeni varyant uyarılarının pilot veride muhasebe kullanıcısıyla incelenmesi gerekir. Canlı yayın yapılmadı.
