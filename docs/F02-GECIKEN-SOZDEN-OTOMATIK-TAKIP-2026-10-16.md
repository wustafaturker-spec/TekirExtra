# F02 — Geciken ödeme sözünden otomatik takip

16 Ekim 2026. Geciken sözler mevcut tahsilat iş listesine bağlandı. Ayrı şirket ayarı varsayılan kapalıdır; gerçek şirket ayarı değiştirilmedi. Yeni migration yalnız geçici PostgreSQL'de sınandı. Canlı yayın yapılmadı.

## Ürün davranışı

- `tahsilat_otomasyonu`: `acik=false`, `sorumluUserId=null` varsayılanları. Açmak için aynı şirketin aktif yönetici/muhasebe kullanıcısı gerekir. Tahsilat operasyonunun ayrıca `pilot` veya `acik` modunda olması gerekir. Salt okunur/kapalı modda tarama yazmaz.
- Worker başlangıçta ve 15 dakikada bir tarar. Türkiye gününden önce vadeli, mantıksal aktif, güncel gerçekleşmesi `gecikti` ve hem söz hem satış faturası kalanı pozitif olan kayıtlar iş üretir. Bugün/gelecek gün, iptal, revize, gerçekleşmiş, geçersiz kaynak ve kapanmış fatura iş üretmez. Yeni işte gözlenen kalan, söz ile fatura kalanının küçüğüdür.
- Caride açık/bekleyen takip yoksa sorumlu adına bugün tarihli “Geciken ödeme sözü takibi” açılır. Varsa söz o takibe bağlanır. Mevcut sorumlu, neden/itiraz, sonraki işlem ve işlem tarihi korunur; sürüm artar ve eski sürümlü düzenleme 409 alır.
- Her söz için en fazla bir kalıcı bağ vardır. Aynı sözün tekrarı, iki worker veya kapanış sonrası yeniden tarama yeni iş üretmez. Kapatılan takip yeniden açılmaz. Sonradan ödeme geri alma da önceden bağlanmış söz için yeni iş üretmez; kullanıcı gerekli yeni takibi manuel açabilir. Revizyon yeni söz kimliği olduğundan, o yeni söz gecikirse ayrı kaynak olarak değerlendirilir.
- Oluşan takipler mevcut günlük iş listesinde görünür. Detay işlem geçmişi söz kimliği, gözlenen kalan/döviz ve söz gününü gösterir; audit ayrıca kaynak fatura kimliğini saklar. Bağdaki kalan geçmiş gözlemidir; güncel borç olarak kullanılmaz. Sonradan ödeme/iptal/revizyon takip durumunu kendiliğinden kapatmaz.
- E-posta/SMS, ödeme, bakiye veya fatura değişikliği yapılmaz. Kontrollü bildirim ve itiraz iletişim politikası ayrı kalan iştir.

## Kalıcılık, yarış ve yetki

`TahsilatSozBaglantisi` / `tahsilat_soz_baglantilari`, söz kimliğinde unique index, tenant RLS/FORCE RLS ve kapsam trigger'ı taşır. Söz ile takip aynı tenant/cariye ait ve bağlama sırasında aktif olmalıdır. Bağlar değiştirilemez/silinemez; uygulama rolü yalnız SELECT/INSERT yapar. FK'lar mali/operasyon geçmişini cascade silmez.

Her cari işleminde tahsilat modu ve otomasyon ayarı paylaşılmış kilitle yeniden okunur, cari mevcut yazma sırasıyla kilitlenir, gerçek sorumlunun aktifliği ve güncel rolü kullanıcı kilidiyle doğrulanır. Söz/ödeme/fatura kaynakları kilit altında yeniden okunur. Takip oluşturma veya sürüm artışı, bağ ve audit aynı transaction'dadır. Audit hatası hepsini geri alır. Kapatma/elle takip/söz revizyonuyla yarış cari kilidi ve DB tekilliğiyle korunur. Tekrar gün veya rastgele iş anahtarına dayanmaz; kalıcı söz bağına dayanır.

Tenant keşfi mevcut worker kalıbıyla `DATABASE_URL_MIGRATE` bağlantısından yalnız tenant kimliklerini 100'lük sayfalarla okur. İş kaynakları ve yazımlar uygulama bağlantısında `tenantIslem` üzerinden yapılır. Sistem kimliği takip/audit oluşturmaz; gerçek sorumlunun güncel rolüyle çalışılır. Kullanıcı pasifleşir/rolü düşerse alternatif yöneticiye geçilmez.

## İşletim sınırları

Her tenant koşusunda en fazla 100 farklı, bağlanmamış gecikmiş söz taşıyan cari kabul edilir; aşımda o tenant için kısmi tarama başlamaz. Her caride mevcut kaynak adaptörünün 1.000 söz / 5.000 kaynak sınırları ve 15 saniye transaction bütçesi geçerlidir. Gerçekleşmiş fakat mantıksal aktif ve henüz bağlanmamış sözler de aday keşfinde sayılabilir; büyük hacim için toplu kaynak taraması/ölçüm gerekir. Üretim kapasitesi kabulü değildir.

Her cari bağımsız transaction'dır. Bir cari hatası diğerini durdurmaz; önce tamamlanan cariler kalır, hatalı cari sonraki periyotta tekrar denenir. Tenant bazında `baglanan`, `olusturulan`, `hatali` loglanır; cari/tenant hataları yapılandırılmış log taşır. Bir süreçte üst üste taramalar bastırılır; çok worker'da cari kilidi ve söz tekilliği geçerlidir. Kapanış gelecekteki zamanlayıcıları ve sonraki carileri durdurur; sürmekteki transaction atomik tamamlanır veya geri alınır.

Özelliği kapatmak mevcut takip/bağları silmez. Eski kod yeni ek tabloyla çalışabilir; veri silen rollback gerekmez. Migration uygulanmadan yeni worker kodu açılmaz. Kullanıma alma sırası: migration provası → uygulama/worker adayı → yetkili kullanıcının mod ve sorumlu seçimi → gerçek şirket pilotu.

## Doğrulama

Toplam **367 ayrı test** geçti:

- 157 API birim testi: 16 yeni otomasyon ayarı/worker testi dahil; Türkiye günü, rol/mod, kapasite sınırı, tenant sayfalama, hata yalıtımı, çakışma bastırma ve kapanış test edildi.
- 123 web birim testi.
- 74 geçici PostgreSQL/HTTP testi: 18 yeni otomatik takip senaryosu dahil. İki bağlantıda tekrar, açık itiraz planı, kapalı takip, çoklu fatura, aday keşfinden sonra özellik kapatma, eski/tam ödeme, yetkisiz sorumlu, audit geri alma ve immutable RLS bağları test edildi. Test DB rolü superuser/BYPASSRLS değildir; konteyner koşu sonunda silindi.
- 13 üretim Chromium senaryosu: 3 yeni ayar ekranı senaryosu ve 10 takip/iş listesi regresyonu. Tarayıcılar gerçek üretim arayüzünü yönlendirilmiş sentetik API yanıtlarıyla kullanır; gerçek şirket pilotu değildir. PostgreSQL/HTTP kabulündeki kimlik middleware ile verilir; JWT oturum açma testi değildir.

Prisma şeması doğrulandı ve istemci üretildi. API tam strict TypeScript kontrolü ve web üretim derlemesi geçti. Üretim çıktısı `.next-f02-geciken-release-20261016`, BUILD_ID `TgAG4jQ2qBOIXlwmXmRt5`. Next'in oluşturduğu `next-env.d.ts` ve `tsconfig.json` değişiklikleri koşu öncesi içeriklerine geri alındı; önceki çalışma alanı değişiklikleri korundu. `git diff --check` temiz.

```sh
# apps/api
pnpm exec prisma validate
pnpm exec prisma generate
pnpm exec vitest run src/cari/geciken-soz-zamanlayici.service.test.ts src/cari/odeme-sozu.semalar.test.ts src/cari/odeme-sozu-uzlastirma.test.ts src/cari/tahsilat-takibi.semalar.test.ts src/nakit-akisi --maxWorkers=1 --no-file-parallelism
node scripts/f01-yaris-kabul.mjs --f02
NODE_OPTIONS=--max-old-space-size=4096 pnpm exec tsc -p tsconfig.json --noEmit

# apps/web
pnpm test --maxWorkers=1 --no-file-parallelism
NEXT_DIST_DIR=.next-f02-geciken-release-20261016 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F02_GECIKEN_DIST=.next-f02-geciken-release-20261016 pnpm exec playwright test --config playwright.geciken-soz.config.ts --max-failures=1
```

## Kalan F02 işleri

Kontrollü bildirim ve itiraz iletişim politikası, gerçek şirket pilotu, üretim kapasitesi ölçümü ve yayın kabulü tamamlanmadı. F02 paketi tamamlanmış sayılmıyor.
