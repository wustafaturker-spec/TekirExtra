# F04 — Mevcut verili şemaya ilk migration provası

22 Ekim 2026. Önceki prova tam şemaya migration tekrarı ve restore doğruluyordu. Bu dilim, **F04 tabloları henüz yokken oluşturulmuş iş verisinin** ilk F04 geçişinde korunmasını sınar. Yalnız geçici PostgreSQL kullanılır; gerçek şirket/yayın değişmez.

**Sonuç:** 265 eski migration’dan sonra üç F04 migration’ı ilk kez uygulandı. `_prisma_migrations` hariç **213 eski tablonun** satır sayısı/içerik özeti eşleşti; bunların 16’sı fixture veya önceki migration referans verisi içeriyordu. Geçiş öncesi **1/1**, geçiş sonrası **3/3**, yükseltilmiş DB’de gerçek HTTP/tarayıcı **4/4** test geçti. İzole deploy duvar süresi 3739 ms gözlendi; bu bir performans hedefi veya üretim kilit kabulü değildir. Geçici şema kopyası ve DB silindi; servisler kapatıldı.

## İzole başlangıç

Yeni `--f04-ileri-prova` modu migration zincirini ikiye ayırır. Üç F04 migration’ı geçici kopyadan çıkarılır; önceki zincir boş DB’ye uygulanır. Kaynak migration dosyaları değiştirilmez. Geçici `schema.prisma` mevcut veri modeli dosyasının kopyasıdır; `migrate deploy` şemadan yeni tablo üretmez, yalnız kopyalanmış eski migration zincirini uygular. Test de beş F04 tablosunun fiziksel olarak bulunmadığını denetler.

F04 sınırından sonra bu üç dosya dışında yeni migration görülürse runner durur; bilinmeyen migration’ı sessizce “eski şema” saymaz. Bu seçim, gerçek üretim ortamının migration geçmişinin yerine geçmez.

F04 öncesi uygulama DB rolüyle aşağıdaki sentetik işler oluşturulur:

- Bir yönetici, hammadde/mamul kartı ve iki depo.
- Ana depoda stok 10, rezerv 4, yoldaki 5; ikinci depoda stok 5, rezerv 1.
- Alış siparişinde miktar 8, teslim edilmiş 3, açık kalan 5.
- Üretim kaleminde plan 8, sarf 2; iki depoda toplam aktif rezerv 3 ve rezerv dışı açık ihtiyaç 3. Mamulün hedef deposu ikinci depodur; hammadde deposu olarak otomatik seçilmemelidir.
- Yeni ihtiyaç planına bağlı olmayan, düzenlenebilir eski satın alma taslağı ve oluşturma olayı.

Eski şema üzerinde anlık önizleme de çalıştırılır: stok 10/rezerv 4/yeni ihtiyaç 8 için kullanılabilir 6 ve açık 2 doğrulanır. Seed kullanıcısı test içindeki yetkili bağlam için oluşturulur; bu kullanıcının gerçek parola girişi bu aşamada test edilmez. Sonraki dört gerçek HTTP senaryosu ayrı fixture kullanıcılarıyla parola girişini kapsar.

## İlk ileri geçiş

Eski iş tablolarının satır sayısı ve tüm satır içeriklerinden kararlı özet alınır. `_prisma_migrations` yeni migration kayıtları alacağı için iş tablosu karşılaştırmasına dahil edilmez; uygulanmış yeni migration adları ayrıca denetlenir. Mevcut tüm iş tabloları karşılaştırılır; yalnız yeni üç iş nesnesinin kontrolüyle sınırlı değildir.

Ardından asıl zincirle `prisma migrate deploy` çalıştırılır. Tam olarak şu üç yeni migration’ın bitmiş olduğu doğrulanır:

1. `20261022120000_siparis_giris_tarihi`
2. `20261022160000_ihtiyac_uretim_ve_plan`
3. `20261022190000_ihtiyac_satin_alma_bagi`

İlk uygulamadan hemen sonra eski tabloların içerik özeti başlangıçla karşılaştırılır. Yeni beş tablo boş olmalıdır: eski siparişe tarih teyidi, üretime depo/gün ataması veya eski satın alma taslağına plan bağı kendiliğinden üretilmez.

## Yeni API’nin eski kaynaklarla davranışı

Yeni servisler aynı eski kayıtlarda üç kontrol yapar:

- Normal eski satın alma taslağı okunur ve düzenleme yetkisi korunur; kısmi teslim miktarı değişmemiştir.
- Doğrulanmamış giriş ve atanmamış rezerv dışı üretim belirsiz kalır. İyimser plan saklama reddedilir.
- Kullanıcı açıkça ana hammadde deposunu/gününü atar ve giriş gününü teyit eder. Kalan giriş 5 ve ek üretim talebi 3 ile yeni ihtiyaç 10 için açık 2 hesaplanır. Plan ve plan başına tek yeni satın alma taslağı oluşturulur; tekrar aynı talebi döndürür. Eski taslak ayrı ve düzenlenebilir kalır; stok/rezerv/yoldaki bakiyesi değişmez.

Bu son aşama beklenen yeni F04 atama/plan/talep/audit kayıtlarını yazar. “Eski bütün tablo özetleri aynı” iddiası **migration’ın hemen sonrasına** aittir; kullanıcının yeni talep oluşturduğu son aşamada eski satın alma/audit tablolarına doğal olarak yeni satırlar eklenir.

Bunun ardından önceki dört gerçek HTTP/tarayıcı senaryosu aynı yükseltilmiş DB üzerinde yeniden çalışır. Böylece API’nin yalnız boş-yeni kurulumda çalıştığı varsayılmaz.

## Süre ve kilit kapsamı

Runner ileri deploy’un duvar süresini kaydeder. Bu süre pnpm/Prisma süreç başlangıcını da içerir; tek SQL DDL süresi değildir. Veri küçük, sentetik ve yazma yarışından arındırılmıştır. Sonuç gerçek hacimde indeks oluşturma süresi, uzun transaction beklemesi, disk kapasitesi veya üretim kilit kabulü sayılamaz. Hedef hacim ve kabul bütçesi belirlenmeden performansın kabul edildiği söylenmez.

Gerçek geçiş öncesinde [geçiş/geri dönüş yönergesindeki](F04-GECIS-VE-GERI-DONUS-PROVASI-2026-10-22.md) migration envanteri, gerçek yedek, bakım/erişim kapsamı, API/web eşliği ve alan kabulü koşulları devam eder. Bu prova o koşulları veya G0–G5’in tamamını kapatmaz.

## Tekrar çalıştırma

Proje kökünde, hazır yeni API ve önceki web paketiyle:

```sh
F04_API_DIST=/tmp/tekir-f04-pilot-http-api F04_WEB_ROOT=/tmp/tekir-f04-bag-web-vr3hvkyy/.next-bag-final/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-ilk-migration-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-ileri-prova
```

Geçici API paketi yoksa `node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-pilot-http-api` ile yeniden derlenir. Geçici web paketi silinmişse ayrıca üretilmelidir. Docker ve yerel test portları gerekir. Runner’ın eski migration kopyası işlem sonunda silinir; çalışma alanındaki şema/migration dosyalarına yazılmaz. Gerçek DB URL’si kullanılmaz; Prisma CLI’ye geçici bağlantı zorunlu verilir.

Yeni uygulama veya web kodu ve migration SQL’i değişmedi; önceki derlenmiş API/web kaynak eşleşmesiyle kullanılır. Bu dilimde tam uygulama derlemesi veya önceki 41 DB testinin tamamı yeniden koşulmuş sayılmaz. Alan pilotu, kapasite tercihi, gerçek hacimde kilit/süre kabulü ve tam uygulama geri dönüşü açıktır.


## Kabul kanıtı

Kanıtlar `.release-candidates/f04-ilk-migration-20261022/` altındadır. `ileri-eski-migration.log` eski zinciri, `ileri-once-kabul.log` F04 öncesi veri kurulumunu, `ileri-yeni-migration.log` ilk üç migration uygulamasını, `ileri-sonra-kabul.log` eski kaynaklarla yeni akışı, `http-kabul.log` son dört birleşik senaryoyu içerir. `ileri-gecis-ozeti.json` envanter/ölçüm/karşılaştırma ve migration SHA-256 değerlerini; `ileri-yeni-akis.json` iş sonucunu; `kabul-ozeti.json` son kabul ve DB temizliğini kaydeder. `ileri-fixture.json` yalnız sentetik kayıt kimliklerini içerir.

`kaynak-kaniti.json` test/harness kaynaklarını ve yeniden kullanılan derlenmiş API dosyalarını sabitler. Önceki pilot API’sinin ürün kaynakları ve derlenmiş dosyaları önceki kanıtla eşleştirildi. Web kimliği `2EB4omJpWbYNTVcsFRywM`; gerçek HTTP kabulü, önceki belgelerde açıklanan odaklı Nest test modülüdür, bütün üretim uygulamasının açılışı değildir. İlk sandbox Docker reddi DB oluşturmadı; son başarılı koşum özeti bu reddin kaydını yeniledi. JavaScript harness dosyalarının `node --check` kontrolleri ve `git diff --check` başarılı.
