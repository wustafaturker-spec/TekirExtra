# F01 — Şirket bazında kontrollü açılış

Sonraki teslim: [Çok ürünlü işlemler ve hacim kontrolü](F01-COK-URUNLU-YARIS-VE-HACIM-2026-10-15.md). Bu belgedeki 132 test önceki teslimin kapsamıdır; güncel ek kapsam ve sonuçlar yeni belgede yer alır.

Tarih: 15 Ekim 2026. Çalışma alanındaki uygulama; canlıya yayın ve gerçek şirketlerde pilot açılışı bu teslim kapsamında yapılmadı.

## Davranış

Yönetici, **Ayarlar → Modül Ayarları → Satış Maliyet Kontrolü → Kullanım modu** alanından şirketin modunu seçebilir. Mevcut `ModulAyar` tablosunda `maliyet_kontrolu` modülü, `{surum: 1, mod}` şemasıyla saklanır; migration gerekmez. Alan ve sürüm doğrulaması sunucudadır. Ayar kaydı olmayan şirketin varsayılanı `kapali`dır. Bozuk veya desteklenmeyen sürümdeki kayıt erişimi açmaz.

| Mod | Liste / Excel / geçmiş / kaynak doğrulaması | İnceleme başlatma / not-durum değiştirme / doğrulanmış kapanış |
| --- | --- | --- |
| `kapali` | 403; yöneticiye ayar ekranı açıklanır | 403, yönetici dahil |
| `salt_okunur` | Mevcut beş finans rolü | 403, yönetici dahil |
| `pilot` | Mevcut beş finans rolü | Yalnız yönetici ve muhasebe |
| `acik` | Mevcut beş finans rolü | Yalnız yönetici ve muhasebe |

Pilot şirket bazındadır. Bu sürümde kullanıcı bazında pilot listesi yoktur; pilot ve açık modlarının işlem yetkileri aynıdır. Pilot etiketi seçilmiş şirketin deneme kullanımını belirtir; pilot ölçümlerinin veya kullanıcı kabulünün tamamlandığı anlamına gelmez.

Kâr/zarar raporundaki eksik maliyet uyarıları bu ayardan bağımsız kalır. Mevcut stok maliyet uygulaması ve diğer mali modüller kendi yetki ve kurallarıyla çalışır; bu ayar yalnız F01 uçlarını kontrol eder. Salt okunur F01 ekranında maliyet uygulamasına yönlendiren bağlantı gösterilmez.

## İşlem anında denetim

Liste, Excel, takip okuma, kaynak doğrulama, takip oluşturma/güncelleme ve kapanış ayrı ayrı servis katmanında güncel şirket ayarını okur. Yazma izni ekrandan gelen bir değerle belirlenmez. Kapalı/salt okunur moda geçildiğinde daha önce alınmış geçerli kapanış kanıtı yazma izni sağlamaz.

Ayar satırı aynı veritabanı işlemi içinde `FOR SHARE` ile tutulur. Eşzamanlı ayar güncellemesi önce tamamlanırsa bekleyen işlem yeni modu görür. Kapanış önce kilit alırsa ayar güncellemesi kapanışın commit'ini bekler; tamamlanmış bir kapanış geriye alınmaz. Ayar güncellemesi başarılı döndükten sonraki F01 yazma istekleri yeni moda tabidir. Okumalar da işlem boyunca aynı kilidi tutar; uzun liste/Excel kaynak okuması mod değişikliğini bekletebilir.

Mod ayarı ve `maliyet_kontrol_modu_guncellendi` denetim kaydı aynı transaction içinde yazılır. Tenant, kullanıcı ve seçilen sürüm/mod kaydedilir. Finansal kayıt yazımı eklenmedi.

## Doğrulama

Kaynak testleri: 64 maliyet/Excel/kâr regresyonu; 14 ayar kayıt defteri, çek-senet ayarı ve genel rapor regresyonu geçti. Gerçek HTTP/JWT/RLS kabulünde dört mod × beş finans rolü × dört okuma ucu, yasaklı yazmalar, eski kapanış kanıtı, varsayılan kapalı davranışı, desteklenmeyen sürüm, ayar yazma rolü, denetim kaydı, diğer şirketin bağımsız ayarı ve kâr raporunun sürekliliği doğrulandı. HTTP fixture kayıtları rollback edildi.

Geçici PostgreSQL üzerinde 35 senaryo geçti. Dört yeni yarış senaryosu kapalı/salt okunur mod değişikliği ile gerçek `RaporService` kapanışını iki bağlantıda, her iki işlem sırasıyla sınar. Gerçek `AyarlarService` yazıcısı kullanılır; kilit beklemesi `pg_blocking_pids` ile gözlenir. Kapanış reddedildiğinde inceleme/olay/audit ve mali kaynakların değişmediği denetlenir. Geçici veritabanı koşum sonunda silinir.

Web üretim derlemesi geçti: `.next-f01-kontrollu-acilis-release-20261015`, build kimliği `fjCVeB3mdKkF3JZVXg1e5`. Bu çıktı üzerinde 18 Chromium senaryosu geçti. Üç yeni senaryo salt okunur şirket modundaki yönetici ekranını, kapalı modun boş liste gibi sunulmamasını ve pilot modunun ayar formundan kaydedilmesini doğrular. Tarayıcı yanıtları taklittir; gerçek veritabanı/HTTP testleri ayrıca çalıştırılmıştır.

Tam API TypeScript derlemesi `--noEmitOnError` ile exit 0 döndü; aday çıktı `/tmp/tekirextra-devam-api-dist` dizinindedir. 35 geçici PostgreSQL senaryosu ve gerçek HTTP/JWT/RLS kabulü bu derlenmiş çıktıyla da geçti. Çalışan API'nin `dist` dizinine yayın yapılmadı.

Toplam **132 ayrı test** geçti: 78 birim/gerileme, 35 geçici PostgreSQL, 1 gerçek HTTP/JWT/RLS ve 18 üretim Chromium senaryosu. Kaynak ve derlenmiş çıktı tekrar koşuları ayrıca sayılmadı. `git diff --check` temizdir. Web derlemesinin oluşturduğu `next-env.d.ts` route referansı önceki çalışma alanı değerine geri getirildi.

```sh
# apps/api — ana regresyon
pnpm exec vitest run src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
pnpm exec vitest run src/core/ayarlar/ayar-kayit.test.ts src/core/ayarlar/cek-senet-ayarlari.test.ts src/rapor/rapor.test.ts --maxWorkers=1 --no-file-parallelism
node scripts/f01-yaris-kabul.mjs
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-devam-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-devam-api.tsbuildinfo
F01_API_DIST=/tmp/tekirextra-devam-api-dist node scripts/f01-yaris-kabul.mjs
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-devam-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-kontrollu-acilis-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-kontrollu-acilis-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Kalan kabul

Şirket/kullanıcı seçimi, gerçek veriyle baz ve sonuç ölçümü, alan sahibinin pilot kabulü, daha geniş çok ürünlü/toplu işlem yarışları ve yük testi, yayın adayı ve canlı yayın devam eder. F01-01–04 görevleri bu nedenle bütünüyle tamamlandı sayılmaz. Hiçbir gerçek şirketin modu bu geliştirme sırasında açılmadı.

Önceki teslim: [Varyant kapsamında kontrollü kapanış](F01-VARYANT-KAPSAMINDA-KAPANIS-2026-10-15.md).
