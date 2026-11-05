# İleri tarihli ve dönem sonu fiyat ataması

PK-02/PK-08 için aynı planda fiyat atamasına ileri tarih, dönem sonu, iptal ve worker uygulaması eklendi. Bu teslim kaynak koddadır; mevcut yerel veritabanına migration veya çalışan API/worker/web'e yayın yapılmadı.

## Zaman ve onay

Mevcut atama önizleme/onay uçları korunur. `uygulamaTuru` gönderilmezse veya `bugun` ise önceki bugünkü atama yolu çalışır. `tarih` için yarın ile 366 gün sonrası arasında bir Türkiye takvim günü seçilir; uygulama anı Europe/Istanbul 00.00 olarak saklanır. `donem_sonu` tek firma alır ve tarih alanı null olmalıdır; kesin zaman aboneliğin mevcut UTC dönem sonundan alınır. Birden çok firmanın farklı dönem sonlarını tek atomik atamaya dönüştürme yapılmaz.

Hedef sürüm yayınlanmış, aynı eski planla eşlenmiş ve fiyatlı olmalıdır; fiyat geçerlilik tarihi seçilen uygulama gününü aşamaz. Gelecekte geçerli olacak fiyat o güne planlanabilir. Mevcut fiyat dönemleri ve limitlerin korunması, aktif/deneme kaynağı, v1 eşlemesi ve diğer önceki atama kontrolleri devam eder.

15 dakikalık önizleme onayı, ileri tarihli planı kaydeder; müşteri koşullarını o anda değiştirmez. Tam kaynak satırları ve hedef sürüm/revizyonu onayda yeniden doğrulanır. Firma başına tek bekleyen plan ayrılır. Başka bir bekleyen planla çakışan hemen atama veya ikinci plan reddedilir. Aynı onayı yeniden göndermek ikinci plan oluşturmaz.

## Uygulama, iptal ve inceleme

`PlatformPaketZamanlayiciService` yalnız worker sürecinde, platform bağlantısı varsa açılışta ve dakikalık çalışır; tarama başına en çok 25 vadesi gelmiş planı işler. Her plan ayrı transaction'dadır. Uygulama, onay ve iptal ortak yönetici yetki kilidini ve plan/sürüm/abonelik satır kilitlerini kullanır. Birden çok worker aynı adayları görse de tek uygulama ve tek firma denetim olayı oluşur.

Uygulama anında onaylayan yöneticinin aktifliği/rolü, hedefin yayın/revizyonu ve fiyat geçerliliği, saklanan tam kaynak abonelik satırları yeniden doğrulanır. İletişim veya güncellenme alanı dahil bir kaynak değişikliği bütün grubu incelemeye taşır; firmaların bir kısmı uygulanmaz. Plan kimliği, neden, kaynak/hedef koşullar ve olaylar korunur. Bu inceleme kendiliğinden onaylanmaz veya değişmiş koşullarla yeniden hesaplanıp uygulanmaz.

`GET /platform/paketler/planli-atamalar` yöneticiye onaylanmış planları; planlandı, uygulandı, iptal veya inceleme durumlarıyla sunar. Hedef sürüm filtresi, kararlı 25'lik sayfalama ve boş sayfada toplam desteklenir. Listede tam abonelik/meta fotoğrafı dönmez. `/platform/paketler/planli-atamalar` ekranı tarih/saat, firma bağlantıları, gerekçe, inceleme/iptal nedenlerini gösterir; sayfa URL'de korunur. Fiyat etkisi ekranından bu listeye geçilir.

`POST /platform/paketler/planli-atamalar/:id/iptal` aktif yönetici ve gerekçe gerektirir. Onaylayanın yetkisi kaldırılmış olsa da başka bir yönetici bekleyen/inceleme planını iptal edebilir. İptal firmanın mevcut fiyatını değiştirmez ve firma rezervasyonunu kaldırır. Tekrar iptal ikinci olay üretmez; uygulanmış atama iptal edilerek geriye alınamaz. İptal/worker yarışında yalnız bir sonuç geçer.

Altyapı/denetim yazma hatası transaction'ı geri alır; plan sonraki taramada yeniden denenir ve aynı taramadaki diğer adaylar işlenir. Worker kapalı kalırsa açıldığında gecikmiş planları yeniden doğrulayarak işler. Kapanışta yeni aday başlatılmaz; sürmekte olan transaction atomik olarak biter. Dakikalık tarama gerçek zaman garantisi değildir; büyük kuyruk birkaç tarama gerektirebilir.

## Ödeme sıralaması

Otomatik yenileme normalde dönem sonundan üç gün önce başlayabilir. Bu erken çekim onaylanmış fiyat geçişinin uygulama anını aşacaksa bekletilir; kartın günlük/dönemlik deneme sayısı tüketilmez. Uygulama zamanı geldiğinde plan hâlâ bekliyor veya inceleme gerektiriyorsa yeni panel/e-posta/otomatik girişimleri de bekler. İnceleme planının rezervasyonu tutulur; yönetici iptal veya yeni değerlendirmeyle çözmeden eski fiyatla tahsilata sessizce dönülmez.

Yeni girişimin abonelik fiyatını okuması ile plan onayı/uygulaması abonelik satır kilidiyle sıralanır. DB insert trigger'ı da bu kuralı uygular. Kiracıya açık dar kontrol işlevi yalnız kendi `app.tenant_id` bağlamındaki bekleme bilgisini verir; atama tablosuna veya başka firmaların planlarına erişim vermez. Platform rolü plan/rezervasyon tablosunu doğrudan yazamaz, iç denetim/hemen uygulama işlevlerini çağıramaz.

Plan onayından önce başlamış girişimler değiştirilemez fiyat fotoğraflarıyla sonuçlanabilir. Böyle bir ödeme dönem sonunu değiştirirse plan incelemeye gider; eski ödeme yeni fiyatla yeniden hesaplanmaz. Uygulamadan sonra yeni girişimler/yenilemeler atanan sürümün fiyatını kullanır; mevcut dönem ve limitler korunur. İleri tarih öncesi normal bir ödeme veya sonraki yenileme de tam kaynak fotoğrafını değiştirirse yeni onay gerekir. Mevcut otomatik yenilemenin üç günlük geçmiş dönem aday penceresi bu teslimde genişletilmedi; uzun kesinti sonrasında ödeme manuel takip gerektirebilir.

## Doğrulama

Dokuz dosyada 133 birim testi geçti; yeni zamanlayıcının worker koşulu, dakikalık çalışma, kapanış, çakışmama ve hata sonrası devamı ile tarih/tür/iptal sorgu sözleşmeleri sınandı. Temiz geçici PostgreSQL'de yeni migration ve tüm önceki migration'lar uygulandı; 15 yeni planlı atama, 12 bugünkü atama, 9 eski katalog bağı ve 18 ödeme/yenileme/fatura senaryosu olmak üzere 54 kabul testi geçti. Gerçek DB senaryoları Türkiye 00.00, tam dönem sonu, erken uygulamama, iki worker, toplu kaynak değişimi, arşiv/yetki değişimi, iptal/tekrar/yeni plan, erken otomatik çekim sayacı, eski girişim sonucu, geçerlilik tarihi, iptal yarışı, geçici hatada rollback/yeniden deneme ve yetki sınırlarını kapsar. Test sahibi, saat geçişini simüle etmek için yalnız geçici DB'de plan vadesini geçmişe alır; üretim işlevlerinde test saati parametresi yoktur.

API/web TypeScript, Prisma şema doğrulaması ve değişen kaynakların ESLint kontrolleri geçti. İzole 3112 Next sunucusunda 18 benzersiz Playwright senaryosu doğrulandı: mevcut 14 katalog/geçiş/bugünkü atama/fiyat etkisi senaryosu ve dört yeni planlı atama senaryosu. Yeni kapsam ileri tarih ve ayrı onay/planlandı mesajı, dönem sonunda tek firma ve sunucu zamanı, gerekçeli iptal/URL sayfası/mobil genişlik ve editör engelidir. İlk birleşik koşuda 16 test geçti; ileri tarih alanının label bağlantısı eksikliği düzeltildi, iptal sonucu test seçicisi durumun gerekçeyle birlikte bulunduğu hücreyi doğrulayacak şekilde güncellendi. Dört yeni test tekrar koşulup geçti (41,6 saniye). Tarayıcı API yanıtları taklit edilir; gerçek transaction/ödeme davranışı yukarıdaki PostgreSQL kabulünde sınanır. Geçici veritabanı ve tarayıcı sunucusu koşu sonunda kapandı.

## Kalan kapsam

Fiyat geçişi aynı plandaki mevcut kayıtlı koşullarla sınırlıdır. Yeni satış, paketler arası yükseltme/düşürme ve mahsuplaşma, firma istisnaları, özellik/kota sürümleme ve uygun bütün abonelere toplu yayın tamamlanmış sayılmaz. Sonraki temel iş PK-03/PK-04 modül/özellik ve kota sözleşmeleridir; bu tüketiciler tamamlanmadan T3 bütünü kapanmaz.
