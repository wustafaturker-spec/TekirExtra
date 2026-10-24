# F04-02 — Rezerv dışı üretim ihtiyacı ve kalıcı plan kanıtı

22 Ekim 2026. Sorumlu: backend; frontend mevcut kaynak görünümü. Bağımlılıklar: F04-01, tarihli hesap çekirdeği, doğrulanmış sipariş girişleri ve P00-05 tenant sınırları. Yeni dilim veri/API katmanıdır; üretim atama ve kayıtlı plan yönetim ekranları henüz yoktur. Gerçek şirket veya çalışan yayın değişmedi.

## Kapsam kararı

Onaylı satış siparişleri zaten stok rezervine katılır; tekrar talep olarak düşülmez. Taslak satış siparişi kesinleşmiş talep değildir. Üretimde mamulün `hedefDepoId` alanı hammadde deposu sayılamaz: rezervasyon malzemeyi birden fazla depodan ayırabilir. Bu nedenle rezerv dışı üretim kaleminin bütün açık kalanı için kullanıcı açıkça tek hammadde deposu ve ihtiyaç günü atar. Emrin açılış/bitiş gününden veya mamul deposundan sessiz atama yapılmaz.

`rezervDışı = max(planlanan + ekİhtiyaç − sarf, 0) − tümDepolardakiAktifRezerv`.

Aktif rezerv, rezervasyonun `rezerve − sarf − çözülen` miktarıdır. Her rezerv bileşeni ve aktif kalan doğrulanır; rezerv kalanı üretim ihtiyacını veya seçili deponun üretim rezerv toplamı stok rezerv bakiyesini aşarsa hesap reddedilir. Sarf/rezerv ilerledikçe kalan miktar tekrar türetilir. İlk plan/ek ihtiyaç, malzeme veya ana birim değişirse kaynak özeti değişir ve atama yeniden doğrulanmalıdır. Atama kaldırılması üretim ihtiyacını silmez; tekrar belirsiz duruma getirir.

Taslak, tamamlanmış ve iptal üretim emirleri okunmaz; iptal talebi henüz iptal değildir. Başka aktif depoya güncel atanmış rezerv dışı ihtiyaç seçili depoda düşülmez. Açık rezerv dışı miktarın ataması yoksa, kapalıysa, deposu pasifleşmişse veya kaynak özeti eskimişse hangi depoya ait olduğu varsayılmaz; ilgili ürünün tarihli yeterlilik sonucu `dogrulanamadi` olur. Tamamı rezervdeki kalem ikinci kez düşülmez.

Kaynak ve rezerv okuyucuları 5000 sınırında çalışır; 5001'de kısmi sonuç yoktur. Tarihli motorun birleşik olay sayısı da 5000 ile sınırlıdır. Varyant, çok seviyeli reçete, planlı mamul girişi ve seri/lot tahsisi kapsam dışıdır.

## Kaynak payları ve kalıcı kayıt

Tarihli sonuçta `karsilama` yeni kullanıcı ihtiyacının mevcut stok ve doğrulanmış sipariş girişleriyle paylarını gösterir. Önce mevcut stok borcu ve daha önceki tarihli talepler karşılanır; aynı kaynak miktarı tekrar kullanılamaz. `yeniTalepKarsilanamayan`, yeni ihtiyacın karşılanmamış kısmıdır; `oncekiAcik` önceki borçtur. Bu iki tutarın toplamı net tedarik açığıyla tutarlıdır. Gün içi sıralama ve erken açık, önceki motor sözleşmesiyle korunur.

`IhtiyacPlani` değişmez girdi, snapshot, sonuç kanıtı, kullanıcı, istek anahtarı ve sürüm 1 saklar. `IhtiyacKarsilamaBagi` kaynak türü/kimliği ve miktarıyla tarihsel payları saklar. Kaynak kaydı sonradan değişse/silinse bile tarihsel plan değiştirilmez; okuma sırasında güncel kaynakla karşılaştırılıp `guncel: false` döner. Paylar stok rezervi veya farklı planlar arasında kapasite tahsisi değildir. İki kullanıcı aynı stoğu ayrı analizlerde gösterebilir; bu kayıtlar stok ayırmış sayılmaz.

Plan kaydı, yetkili transaction içinde girdiyle yeniden hesaplanır; istemciden snapshot, kaynak payı veya miktar kabul edilmez. `sonucKaniti` Türkiye günü, ihtiyaç günü, ürün/depo, birim dönüşümü, bakiyeler, tüm tarihli kaynak kanıtları ve karşılama hesabını kapsar; yalnız sorgu saati değişince değişmez. Beklenen kanıt değişmişse veya veri belirsizse kayıt 409 verir. Yeni plan, paylar ve audit aynı transaction'dadır. İstek anahtarı aynı kullanıcı/gövde için tek kayıt döndürür; farklı girdide kullanılırsa 409 olur. Eşzamanlı unique çakışmasından sonra kayıt yeniden okunup aynı istek özeti doğrulanır.

## API sözleşmesi

Taban `/api/v1/stok/ihtiyac-plani`; yönetici, muhasebe, depo rolleri servis içinde de denetlenir.

- `GET /uretim-talepleri/:kalemId`: kalan rezerv dışı miktar, kaynak özeti ve varsa atama.
- `PUT /uretim-talepleri/:kalemId`: `depoId`, `ihtiyacTarihi`, `aktif`, `beklenenSurum`, `beklenenKaynakOzeti`, `gerekce`. Kalem ve emir kilitlenir; aktif ve aynı tenant deposu doğrulanır. Yeni kayıtta beklenen sürüm 0. Ağ tekrarı ikinci audit yazmaz.
- `GET /tarihli-onizle`: önceki alanlara ek olarak `sonucKaniti` ve `tarihli.karsilama`; üretim talepleri `uretim/<emirId>/<kalemId>` kaynak kimliği taşır.
- `POST /planlar`: yalnız `istekAnahtari`, `beklenenSonucKaniti`, mevcut önizlemenin beş alanından oluşan `girdi` kabul eder.
- `GET /planlar/:id`: değişmez plan/paylar ve güncel kaynak karşılaştırması. Eski snapshot yeniden yazılmaz. Eski istek anahtarını tekrar göndermek güncel plan üretmez; önceki isteğin sonucunu döndürür.

Mevcut ihtiyaç ekranı rezerv dışı üretim toplamını ve üretim emrine kaynak bağlantısını gösterir; satın alma uyarısı bu kapsamı belirtir. Bu dilimde üretim ataması veya plan saklama düğmesi eklenmedi. Tarihli talep aktarımının mevcut tekrar okuma kontrolü yeni kaynak/karşılama alanlarını da kapsar. Tek hedef günden önceki büyük açık için aktarım engeli korunur.

## Migration ve geri dönüş

`20261022160000_ihtiyac_uretim_ve_plan`: üç yeni tablo, tenant/satır ve tenant/depo bileşik FK'ları, parent unique indeksleri, RLS/FORCE ve uygulama rolü izinleri. Atama güncellenebilir; plan/pay tablolarında uygulama rolüne yalnız SELECT/INSERT verilir. UPDATE/DELETE yasaktır. Tenant bağlantıları DB'de korunur; payın kaynak kimliği tarihsel snapshot referansıdır, güncel stok kaydına silme zinciri kurmaz.

Mevcut emir/sipariş/rezervlere otomatik veri ataması yapılmaz. Yeni tarihli API'den önce migration uygulanmalıdır; eski anlık önizleme yeni tablolara gitmez. Geri dönüş yeni uçları bırakıp önceki API/web sürümünü kullanmaktır; kayıtlar/audit silinmez. Yeni üretim taleplerini hesaba katmayan önceki tarihli sürümün aynı kapsama eşdeğer olduğu söylenmez. Bu dilim otomatik sipariş veya stok rezervi oluşturmadığından geri dönüşte otomasyon başlatılmaz.

## Doğrulama

İlk odaklı koşumda 55, rezerv sınırı eklemesinden sonra 56 hesap/servis testi geçti. Son stok/belgeler/üretim regresyonunda 28 dosyada **257/257** birim testi geçti; bunlara 57 odaklı F04 testi dahildir. Karşılama payları 54 borç/talep/giriş birleşiminde ana net ihtiyaç motoruyla eşitlik üzerinden ayrıca kontrol edildi. Mevcut belge fixture'larında teklif takip mock'u için iki uyarı var; testler başarılı.

Gerçek PostgreSQL 16 üzerinde bütün migration'lar uygulandı; **29/29 DB/RLS kabul testi geçti**. Çok depolu rezervin tek düşümü, atanmamış/eskimiş/pasif depolu üretim ihtiyacı, açık depo seçimi, tenant sınırları, atama ağ tekrarı/sürüm çakışması, kalıcı plan/paylar, eşzamanlı tek kayıt, eski önizleme reddi, kaynak değişiminde değişmez snapshot, uygulama DB rolünde UPDATE/DELETE engeli ve audit arızasında plan/pay rollback doğrulandı. Son geçici DB otomatik silindi.

Gerçek DB'nin ilk denemesi yüksek disk beklemesinde PostgreSQL hazır olmadan süreyi aştı; testlere ulaşılmadı, geçici DB silindi. F04 runner'ının DB başlangıç üst sınırı 30 saniyeden 180 saniyeye çıkarıldı; uygulama transaction süreleri değiştirilmedi.

Web tam tür kontrolü ve F04 controller/servis/hesap ağacının odaklı TypeScript kontrolü başarılı. Kalıcı kontrol tanımı `apps/api/tsconfig.ihtiyac-kontrol.json`; `node --max-old-space-size=2048 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-kontrol.json` ile çalıştırılır. Tam API kontrolünün ilk koşusunda plan servisinin anlık/tarihli dönüş tipi daraltması hatası bulundu ve açık `in` kontrolüyle düzeltildi. Düzeltme sonrası odaklı kontrol geçti; yeniden başlatılan tam API kontrolü 3 GiB heap ile 240 saniyelik süre sınırını aştı. Tam API kontrolü başarılı sayılmaz. Bu dilim için yeni üretim paketi veya HTTP/tarayıcı birleşik kabulü yapılmadı; önceki 13 tarayıcı senaryosunun kanıtı önceki UI dilimine aittir.

Kabul özeti ve ilgili kaynak SHA-256 kayıtları `.release-candidates/f04-uretim-plan-20261022/kabul-ozeti.json` içindedir. Bu dosya tool oturumundaki sonuçların özetidir; ham koşum logu veya dağıtım manifesti değildir.

Operasyon pilotu, üretim atama/kayıtlı plan ekranları, plan–satın alma taslağı arasında atomik bağ/tekilleştirme ve tam F04 kabulü açıktır.
