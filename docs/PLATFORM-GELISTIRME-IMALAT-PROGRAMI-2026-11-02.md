# Platform geliştirme imalat programı

Tarih: 2 Kasım 2026
Durum: Firma listesi, kalıcı detayın ilk sürümü ve takip kayıtları uygulandı ve doğrulandı. İstatistik, büyüme/deneme dönüşümü, kullanıma başlama, bekleyen işler, ödeme kapsam uzlaştırması ve tarihsel operasyon gözlemlerinin ilk sürümleri uygulandı. Paket tanım/sürüm yönetimi, fiyat hesaplama ve sürüme fiyat kaydı eklendi; ticari bağlantılar ve duyuru teslimleri devam edecek.
Öncelik: Tenant firma takibi ve istatistikler, ayrıntılı abonelik paketleri, duyuru sistemi.
Takvim: Aşağıdaki sıra teslim bağımlılıklarını gösterir; ekip kapasitesi ve teknik keşif tamamlanmadan kesin tarih taahhüdü içermez.

## 1. Amaç ve mevcut durum

Platform ekibinin hangi firmanın takip beklediğini görmesini, paketleri kod değişikliği gerektirmeden yönetmesini, firmalara hedefli duyurular iletmesini ve mevzuat/operasyon işlerini birbirine bağlamasını sağlamak.

Kod incelemesinde mevcut görülenler:

- Yönetim özeti, görev merkezi, firmalar, mevzuat değişiklikleri, yürürlükteki değerler, talepler, denetim, ödeme raporu, abonelik, sistem sağlığı ve yapay zekâ yönetim ekranları.
- Firma listesinde abonelik durumu, kullanıcı sayısı, son giriş, e-belge sağlayıcısı, plan talebi ve izinli destek işlemleri; firma yönetim penceresinde ödeme ve abonelik geçmişi.
- Firma listesinin tamamı yükleniyor, süzülen sonuçların ilk 200'ü gösteriliyor. Mevzuat değişiklikleri API'de 200, talepler 300 kayıtla sınırlı.
- Firma ekranında sabit paket seçenekleri ve API tarafında ortak plan tanımları var. Paket yönetimi bunların tüm tüketicilerini kapsamalı.
- Mevzuatta ikinci yetkili onayı, sürüm kontrolü, etki analizi ve kabul senaryoları; görevlerde paylaşılabilir filtreler ve bağlı değişiklik oluşturma yaklaşımı mevcut.
- Sistem sağlığında 60 saniyelik yenileme, alarm ve başarısız işi yeniden deneme mevcut. Yayın takvimi ve sistem alarmlarında e-posta davranışları mevcut.

Yerel `/platform` adresi oturum açmaya yönlendi; oturum içi görsel inceleme yapılmış kabul edilmez. İlk teslimde yetkili test oturumuyla ekran envanteri tamamlanır.

Önceki [P0 düzeltme planı](PLATFORM-KURUMSAL-YONETIM-IMALAT-PLANI-2026-10-31.md), [ihtiyaç odaklı yol haritası](PLATFORM-KURUMSAL-YONETIM-YOL-HARITASI-2026-10-31.md) ve [görev merkezi belgesi](platform-gorev-merkezi.md) referanstır. Önceki tamamlanma kayıtları değiştirilmez; yeniden kullanılabilir bileşenler teknik keşifte doğrulanır. Bu belge kodlama veya üretim yayını yapıldığı anlamına gelmez.

## 2. Ekran haritası

Yeni yollar öneridir; mevcut bağlantılar geçiş boyunca çalışır.

| Ekran | Önerilen adres | İşlev |
|---|---|---|
| Firma takip listesi | `/platform/firmalar` | Filtreler, takip görünümleri, sıralama, sayfalama |
| Firma detay | `/platform/firmalar/[id]` | Profil, abonelik, kullanım, ödeme, bağlantılar, takip ve duyurular |
| Firma istatistikleri | `/platform/istatistikler` | Büyüme, kullanım, abonelik ve operasyon |
| Paket yönetimi | `/platform/paketler` | Paket listesi, taslaklar, satış durumu |
| Paket detay/sürüm | `/platform/paketler/[id]` | Fiyat, özellik, kota, sürüm ve geçiş kuralları |
| Duyuru yönetimi | `/platform/duyurular` | Hedefleme, zamanlama, yayın ve raporlama |
| Duyuru düzenleme | `/platform/duyurular/[id]` | İçerik, gösterim biçimi, hedef önizlemesi |
| Firma duyuru merkezi | Firma panelindeki duyuru alanı | Geçerli ve geçmiş duyurular |
| Kişisel bildirim merkezi | Mevcut kabukta bildirim alanı | Görev, onay, hatırlatma ve okunma durumu |

## 3. İmalat sırası ve teslimler

| Teslim | Kapsam | Ön koşul | Çıkış ölçütü |
|---|---|---|---|
| T0 | Envanter, ölçüm tanımları, veri ve API sözleşmeleri | Yok | Hesaplama, veri kaynağı ve geçiş kararları yazılı |
| T1 | Firma takip listesi ve firma detayının temel sürümü | T0 | Tüm firmalar bulunabilir; kalıcı detay ve takip kaydı çalışır |
| T2 | Günlük kullanım özetleri ve ilk istatistik ekranı | T0, T1 | Tanımlı metrikler doğru; kartlar firma listesine açılır |
| T3 | Paket kataloğu, sürümler ve abonelik entegrasyonu | T0, T1 | Mevcut abonelikler korunur; yeni paket uçtan uca çalışır |
| T4 | Duyuru yönetimi, firma gösterimleri ve raporlar | T1, T3 | Hedefli yayın ve kullanıcı bazında tekrar kuralları çalışır |
| T5 | Mevzuat, görev, bildirim ve operasyon geliştirmeleri | T1, T2; ilgili işte T3/T4 | Bağlı işler ve hatırlatmalar uçtan uca izlenir |
| T6 | Birleşik kabul, pilot ve yayın hazırlığı | T1–T5 | Kabul senaryoları, geçiş ve geri dönüş provası tamam |

Firma istatistikleri paket kataloğunun tamamlanmasını beklemez. İlk sürüm mevcut plan kodlarıyla çalışır; T3'te sürüm kimliklerine uyarlanır. Duyuru hedeflemesi yayınlanan paket kimlikleriyle bağlanır.

## 4. İş listesi ve kabul ölçütleri

Aşağıdaki kodlar bu belgenin iş takip anahtarlarıdır; mevcut PLT ister numaralarını değiştirmez. Başlangıçta tüm işler yapılacak durumundadır.

### T0 — Hazırlık ve ortak sözleşmeler

- [ ] **HZ-01 — Mevcut akış envanteri.** Firma, paket seçimi, fiyat, ödeme, yenileme, erişim ve kota tüketicilerini API/web/worker/veritabanında çıkar. Mevcut testleri eşleştir. Kabul: sabit paket/fiyat referanslarının ve kullanım ölçümü kaynaklarının listesi hazır.
- [ ] **HZ-02 — Veri sözlüğü.** Etkin firma, aktif kullanıcı hesabı, dönemde etkin kullanıcı, yeni firma, ücretliye geçiş, iptal, yenileme ve ödeme gecikmesini ayrı tanımla. Kabul: her metriğin formülü, tarihi, kapsamı ve veri kaynağı yazılı.
- [ ] **HZ-03 — Ortak liste sözleşmesi.** Sunucuda arama, izin verilen sıralamalar, kararlı ikinci sıralama anahtarı, sınırlı sayfa boyutu, toplam ve URL filtreleri. Kabul: liste ile sayaç kapsamı açık, eski istek yeni filtreyi ezmiyor.
- [ ] **HZ-04 — Yetki ve denetim matrisi.** Mevcut platform yöneticisi/editör yetkileri üzerine ekran/API/özet erişimlerini tanımla. Firma verisini yalnız gerekli sayılar ve durumlarla sun. Kabul: yetkisiz istek veri ve sayım alamıyor; yeni yönetim işlemleri mevcut denetim izine yazılıyor.

### T1 — Tenant firma takibi

- [x] **FR-01 — Firma listesini yenile.** Unvan/VKN araması; plan, abonelik durumu, kayıt tarihi, son giriş, yenileme tarihi ve bağlantı durumu filtreleri; sunucuda sayfalama/sıralama. Kabul: 200'den fazla firmada tüm sonuçlara ulaşılır, filtre bağlantısı yeniden açıldığında aynı kapsam gelir. İlk sürüm son giriş verisini kullanır; gerçek modül etkinliği IS-01–03 ile gelir. Kanıt: [ilk teslim](PLATFORM-FIRMA-TAKIP-ILK-TESLIM-2026-11-02.md).
- [x] **FR-02 — Hazır takip görünümleri.** Hiç giriş yapmayan, 30 gündür giriş yapmayan, 7 gün içinde yenilenecek, ödemesi geciken, denemesi bitecek, bağlantı hatalı ve takip tarihi geçen firmalar. Kabul: her görünümün eşik/tarih tanımı kullanıcıya açıklanır; bilinmeyen veri sorunsuz kabul edilmez. Gerçek modül etkinliği IS-01–03'te ölçülecektir.
- [ ] **FR-03 — Kalıcı firma detayı.** Genel bilgiler, abonelik, kullanım, ödeme, bağlantılar, takip ve duyurular sekmeleri; mevcut yönetim işlemlerini yeniden kullan. Kabul: doğrudan URL açılır, mevcut `?firma=` bağlantıları doğru detaya taşınır, liste filtreleri dönüşte korunur.
- [x] **FR-04 — Takip kaydı.** Platform sorumlusu, iç not, sonraki görüşme tarihi, takip durumu ve bağlı görevler. Kabul: notu yazan/zamanı görünür; değişiklik geçmişi tutulur; pasif sorumlunun açık işleri belirlenebilir. Kanıt: [firma detay ve takip teslimi](PLATFORM-FIRMA-DETAY-VE-TAKIP-2026-11-02.md).
- [ ] **FR-05 — Firma zaman çizelgesi.** Abonelik, ödeme, iade, fatura hatası, bağlantı sorunu, destek ve takip olaylarını tarih sırasında birleştir. Kabul: kaynak kayda geçiş yapılır; mevcut ödeme/iade işlemleri çoğaltılmaz.

### T2 — Firma istatistikleri ve ölçüm altyapısı

- [x] **IS-01 — Günlük özet üretimi.** Firma/gün bazında kullanım ve operasyon sayıları; idempotent iş, yeniden hesaplama, son işlenen zaman ve eksik gün işareti. Kabul: tekrar çalışma sayıları ikiye katlamaz; tarihsel veri yoksa sıfır yerine veri başlangıcı/eksikliği gösterilir.
- [x] **IS-02 — Büyüme ekranı.** Dönem başı/sonu firma sayısı, yeni firma, denemeden ücretliye geçiş ve iptaller; önceki eşit süreli dönem karşılaştırması. Kabul: tarih aralığı ve payda görünür; sıfır paydada yanıltıcı yüzde üretilmez. İlk sürüm ölçüm başlangıcından itibaren gözlenen yeni firma/ilk deneme için 14 günlük olgun kohortu kullanır; mevcut firmaların bilinmeyen geçmişi orana katılmaz. Kanıt: [büyüme teslimi](PLATFORM-BUYUME-VE-DENEME-DONUSUMU-2026-11-02.md).
- [x] **IS-03 — Kullanım ekranı.** Son 7/30 günde etkin firmalar, hiç başlamayanlar, dönemde etkin kullanıcılar, modül kullanım sayıları ve eğilimler. Kabul: aboneliği aktif firma ile ürünü kullanan firma ayrı; destek/sistem etkinliği müşteri kullanımı sayılmaz. İlk sürümde hiç başlamayan, kaydı ölçüm sonrası bilinen ve bütün günleri ölçülmüş yeni firmanın gözlenen etkinlik eksikliğidir; geçmişi yetersiz firma ayrı gösterilir. Kanıt: [kullanıma başlama teslimi](PLATFORM-KULLANIMA-BASLAMA-VE-BEKLEYEN-ISLER-2026-11-02.md).
- [x] **IS-04 — Abonelik ve operasyon ekranı.** Plan dağılımı, yaklaşan yenilemeler, gecikmeler, başarısız tahsilatlar, bağlantı sorunları ve bekleyen işler. Kabul: karttan ilgili filtreli listeye geçilir; kayıt bazlı mevcut ödeme raporuyla sonuçlar uzlaştırılır. Gözlenen tarihsel operasyon ilk sürümü ve bilinmeyen geçmiş sınırı [teslim kaydında](PLATFORM-TARIHSEL-OPERASYON-EGILIMLERI-2026-11-03.md).
- [x] **IS-05 — Ortak rapor davranışı.** Tarih/plan filtreleri, önceki dönem karşılaştırması, son güncellenme ve erişilebilir grafik/tablo alternatifi. Kabul: grafik, toplam ve detay listesi aynı ölçüm tanımını kullanır; tarihsel detay için özet kaynağı kullanılır, bugünkü durum tarihsel sonuç yerine gösterilmez.

### T3 — Ayrıntılı abonelik paketi yönetimi

- [x] **PK-01 — Katalog ve sürümler.** Ad, benzersiz kod, açıklama, özellik listesi, sıralama; taslak/yayınlanmış/arşiv sürümleri; ayrı satışa açıklık durumu. Kabul: kullanılan paket fiziksel silinmez, yayınlanmış sürüm yerinde değiştirilmez. Ayrı satış sürümü seçimi, gerekçeli onay/durdurma, satış-arşiv kilidi ve geçmiş [teslimi](PLATFORM-PAKET-SATIS-DURUMU-2026-11-04.md) katalog yönetimini tamamlar. Yeni müşteri kayıt/satın alma tüketicisi PK-02/PK-08 ve gerçek ortam pilotu kapsamında kalır.
- [ ] **PK-02 — Fiyatlandırma.** Aylık/yıllık ve mevcut desteklenen dönemlerle uyumlu fiyatlar, para birimi, vergi bilgisi, geçerlilik tarihi. Kabul: tutarlar ondalık/kuruş hassasiyetinde; ödeme, fatura ve yenileme aynı sürümden fiyat alır. Yeni para birimi yayını ödeme sağlayıcısı/faturalama desteği doğrulanmadan açılamaz.
- [ ] **PK-03 — Modül ve özellik matrisi.** Paket kapsamındaki modüller/özellikler; bağımlılık kontrolleri. Kabul: menü ve API erişim politikası aynı katalogdan beslenir; URL/API ile erişim kuralı aşılamaz. Aynı planda açık kapsam ataması, 17 modül için API/panel/araç/MCP/ek/ilgili otomasyon uygulaması [teslim edildi](PLATFORM-KAPSAM-ATAMASI-VE-ATOMIK-KOTA-2026-11-04.md); yeni satış ve geniş ticari geçiş kabulüyle birlikte program kapanışı kalır.
- [ ] **PK-04 — Kullanım kotaları.** Kullanıcı, şube, depolama, belge ve yapay zekâ limitleri; dönem, birim, sınırsız seçimi, uyarı eşikleri. Kabul: ölçüm kaynağı ve sıfırlama kuralı her kota için belli; eşzamanlı işlemler limit kontrolünü aşamaz. Kullanıcı/cari/stok/fatura için atomik DB koruması ve bağlı uyarı eşiği tamamlandı; [Depolama sözleşmesi ve atomik yükleme kotası](PLATFORM-DEPOLAMA-KOTASI-2026-11-04.md) eklendi; şube, diğer belgeler ve AI harcaması kalır.
- [ ] **PK-05 — Deneme ve kota aşımı.** Deneme süresi/limitleri, bitiş davranışı; aşımda uyarı, engelleme veya fiyatı tanımlı ek kullanım. Kabul: aşım bedeli ve politikası açıkça etkinleştirilmeden ek ücret oluşmaz; deneme bitişi tek kez uygulanır.
- [ ] **PK-06 — Paket geçişi.** Yükseltme/düşürme, hemen veya dönem sonunda uygulama; ücret farkı, vergi/indirim ve kalan dönem önizlemesi. Kabul: önizleme ile uygulama aynı hesaplama kuralını kullanır; kaynak değişirse yeniden hesaplanır; tekrarlanan istek ikinci mali etki üretmez. Kullanım yeni limitin üzerindeyse uygulanacak kural görünür.
- [x] **PK-07 — Firmaya özel koşullar.** Süreli indirim, özel fiyat, ek kota, gerekçe, başlangıç/bitiş ve geçmiş. Kabul: katalog + firma istisnasından oluşan etkin koşullar açıklanabilir; süre bitince tanımlı standart koşula dönülür.
- [ ] **PK-08 — Yayın önizlemesi ve mevcut aboneler.** Yalnız yeni satış, seçili firmalar veya uygun mevcut aboneler için uygulama; etkilenen firma listesi, yeni yenileme tutarı ve uygulama tarihi. Kabul: mevcut aboneler sessizce yeni fiyata geçirilmez; yayın anında yetki/sürüm tekrar kontrol edilir, etki kaydı saklanır.
- [x] **PK-09 — Eski kayıtların geçişi.** Sabit planları ilk katalog sürümlerine eşle; eski plan kodları ve ödeme geçmişi referanslarını koru; aboneliklere sürüm bağla. Kabul: geçiş öncesi/sonrası erişim, dönem sonu ve yenileme tutarı örnek ve toplam kontrolleriyle aynı; eşlenmeyen kayıt raporlanır. Uygulama ve izole geçiş kabulü tamamlandı; bilinmeyen planlar raporlanır, mevcut yerel veritabanına uygulama/pilot ayrı kalır. [Kanıt](PLATFORM-ABONELIK-KATALOG-BAGI-2026-11-03.md).

### T4 — Duyuru sistemi

- [ ] **DY-01 — Duyuru editörü.** Başlık, güvenli biçimlendirilmiş içerik, görsel, buton metni/bağlantısı; taslak, önizleme, planlı yayın, yayın, arşiv ve durdurma. Kabul: zararlı HTML/URL reddedilir; yüklenen dosyalar doğrulanır; yayın geçmişi saklanır.
- [ ] **DY-02 — Gösterim biçimleri.** Duyuru merkezi, üst bant, modal/popup ve sayfa içi kart; masaüstü/mobil önizleme. Kabul: klavye erişimi, odak yönetimi ve ekran okuyucu etiketleri çalışır; modal kapandığında odak geri döner.
- [ ] **DY-03 — Hedefleme.** Tüm firmalar, seçili firmalar, paket, abonelik durumu ve kullanıcı rolü; dahil/hariç kuralları. Kabul: yayın öncesinde hedef firma/kullanıcı sayısı görünür; hedef dışı kullanıcı doğrudan API'den içeriği alamaz. Yeni uygun firmaların yayına katılım politikası açıkça seçilir.
- [ ] **DY-04 — Yer ve zaman.** Giriş sonrası, ana sayfa ve seçili modüller; başlangıç/bitiş, Türkiye saat dilimiyle önizleme. Kabul: sunucu zamanına göre erken/geç gösterim olmaz; durdurulan yayın belirlenen kısa önbellek süresi içinde kalkar.
- [ ] **DY-05 — Tekrar ve etkileşim.** Kullanıcı başına bir kez, yeni içerik sürümünde yeniden veya belirli aralıkla; kapat, sonra hatırlat, okudum. Kabul: sekme/cihaz değişiminde tekrar kuralı korunur; küçük içerik düzeltmesinin tekrar gösterim yaratıp yaratmayacağı yayın sırasında seçilir.
- [ ] **DY-06 — Popup sırası.** Öncelik, aynı anda tek modal, sonraki uygun gösterim ve çakışma politikası. Kabul: birden fazla duyuru aynı anda açılmaz; normal duyurular temel işi sürekli engellemez; kritik duyurunun kapatma/onay davranışı önizlemede görünür.
- [ ] **DY-07 — Ölçüm ve firma bağlantısı.** Hedeflenen kullanıcı, benzersiz gösterim, okudum, kapatma, erteleme ve buton tıklaması; firma bazlı detay. Kabul: tekrar gönderilen olaylar benzersiz metrikleri şişirmez; gösterim okuma sayılmaz; hedef paydası ve rapor zamanı görünür. Okudum kaydı hukuki onay olarak adlandırılmaz.

### T5 — Bağlı işler, mevzuat ve operasyon

- [ ] **AK-01 — Mevzuat/talep listelerinde sayfalama.** Sunucuda arama, tarih/durum filtresi, sıralama ve gerçek toplamlar. Kabul: 200/300 sınırını aşan kayıt bulunur; yönetim özeti sınırlı listenin uzunluğunu toplam sayısı sanmaz.
- [ ] **AK-02 — Talep → görev → değişiklik.** Talep üzerinden görev veya taslak oluştur, açıklama/kalemi aktar; karşılıklı bağlantı ve çözüm yayını tut. Kabul: kapalı talebin hangi düzenlemeyle çözüldüğü izlenir; kaynak yetkisi her geçişte doğrulanır.
- [ ] **AK-03 — Onay karşılaştırması.** Mevcut ve önerilen değerler, eklenen/değişen/kaldırılan kalemler; etki analizi ve kabul sonuçları tek inceleme alanında. Kabul: karşılaştırma hedef yürürlük tarihiyle uyumlu; mevcut ikinci yetkili ve sürüm koruması sürer.
- [ ] **AK-04 — Onay bekleme takibi.** Bekleme süresi, inceleyen kişi, hedef tarih ve gecikme görünümü. Kabul: kişiye atama ikinci yetkili kuralını kaldırmaz; gecikmeden göreve geçilir.
- [ ] **AK-05 — Dönemden hazır taslak.** Takvim satırından tür/dönem/yürürlük tarihi doldur; uygun önceki dönem kalemlerini taslağa kopyala. Kabul: kopya otomatik yayınlanmaz; doğrulama ve kabul senaryolarından geçer.
- [ ] **AK-06 — Bildirim ve hatırlatmalar.** Görev ataması, yaklaşan/geçen son tarih ve onay talepleri; uygulama içi okunma, kişisel tercihler ve mevcut e-postalarla uyum. Kabul: iş tekrarında aynı hatırlatma çoğalmaz; artık yetkisi olmayan alıcıya içerik açılmaz. İşlemsel bildirimler duyuru kampanyalarından ayrı kayıt türüdür.
- [ ] **AK-07 — Alarmdan olay takibine.** Sorumlu, not, bağlı görev, tekrar gruplama ve çözüm zamanı. Kabul: mevcut yeniden deneme ve alarm mekanizması yeniden yazılmaz; yeni tekrarla yeniden açılma tanımlıdır.
- [ ] **AK-08 — Ortak liste deneyimi.** Diğer platform listelerine URL filtreleri, kalıcı kayıt bağlantısı ve kişisel kaydedilmiş görünümler. Kabul: paylaşılan görünüm yetkiyi genişletmez; geçersiz filtre anlaşılır biçimde temizlenir.
- [ ] **AK-09 — Operasyon performansı.** Ortalama onay/talep çözüm süresi, geciken görev oranı ve yeniden açılan sorunlar. Kabul: başlangıç/bitiş olayları ve yeniden açılmanın süreye etkisi açıklanır; eksik geçmişten kesin süre üretilmez.

## 5. Veri ve teknik uygulama sınırları

Önerilen veri grupları; kesin model ve migration adları T0'da mevcut Prisma/SQL yapısıyla uyumlu belirlenir:

| Grup | Tutulacak temel veri |
|---|---|
| Firma takibi | Tenant, sorumlu, not, takip durumu/tarihi, görev bağlantıları, geçmiş |
| Kullanım özeti | Tenant, gün, metrik, değer, veri sürümü, üretim zamanı |
| Paket | Katalog kimliği, sürüm, fiyatlar, özellikler, kotalar, yayın ve satış durumu |
| Abonelik koşulu | Paket sürümü, geçerlilik, firma istisnaları, planlanan geçiş |
| Duyuru | İçerik sürümü, hedef kuralları, yer, biçim, zaman ve yayın durumu |
| Duyuru alıcısı/olayı | Firma/kullanıcı, sürüm, benzersiz gösterim, etkileşim, erteleme |
| İş bağlantıları | Talep, görev, değişiklik, alarm ve olay ilişkileri |

- Mevcut platform/kiracı kimlik ve veritabanı ayrımı korunur. Yeni özet erişimleri dar SQL işlevleri veya mevcut güvenli erişim örüntüsüyle sağlanır; platforma tenant tablolarında sınırsız okuma verilmez.
- Yönetim yazımları denetim kaydıyla atomik; mali geçişler ve dış servis tekrarları işlem anahtarıyla korunur.
- Paket erişim/kota önbelleği güncellemeleri için sürüm/geçersizleştirme davranışı API ve worker'da birlikte uygulanır.
- Yeni geniş analitik veya genel onay motoru ilk teslimin şartı değildir; mevcut görev, olay, worker ve bildirim bileşenleri kullanılır.
- API değişiklikleri yönetim özeti, ödeme raporu ve mevcut bağlantıları kapsayacak biçimde uyarlanır. JSON dışı hata yanıtları kullanıcıya anlaşılır mesaj verir.
- Özet metrikler ölçüm dönemine, abonelik fiyatları uygulanmış sürüme bağlıdır. Bugünkü paket adı/fiyatı geçmiş kaydın anlamını değiştirmez.

## 6. Ölçüm kuralları

- İş günü ve takvim filtreleri Europe/Istanbul sınırlarıyla hesaplanır; zaman damgaları UTC saklanır.
- Etkin firma: seçilen dönemde tanımlı müşteri etkinliği olan firma. Kesin etkinlik olayları HZ-02'de belirlenir; arka plan işi veya destek oturumu dahil edilmez.
- Aktif kullanıcı hesabı ile dönemde etkin kullanıcı ayrı metriklerdir.
- Mevcut durum dağılımı anlık; dönemsel büyüme ve iptal raporu olay/geçmiş kaynağından hesaplanır.
- Denemeden ücretliye dönüşümün kohortu ve gözlem süresi raporda belirtilir. Dönemdeki tüm ücretli firmalar dönüşüm payına yazılmaz.
- İstatistik toplama başlangıcından önceki dönemler yalnız güvenilir kaynak varsa doldurulur; tahmin gerçek veri gibi sunulmaz.
- Duyuruda benzersiz kullanıcı ve firma sayıları ayrı; gösterim, okudum ve tıklama ayrı olaylardır.

## 7. Doğrulama ve tamamlanma kapıları

Her işte kapsamına uygun servis/API testleri ve kritik akışlarda tarayıcı kabulü çalıştırılır. Doküman/kozmetik değişiklikleri için uygulamayı taklit eden test yazılmaz.

| Alan | Zorunlu kabul senaryosu |
|---|---|
| Firma listesi | 200 üzeri firma, kararlı sayfalama, birleşik filtre, doğrudan detay ve geri dönüş |
| Yetki | Yönetici/editör ve iki farklı tenant ile olumlu/olumsuz API erişimi; sayım sızıntısı kontrolü |
| İstatistik | Gün sınırı, eksik gün, tekrar çalışan iş, sıfır payda, geçmiş/anlık ayrımı |
| Paket | Eski aboneliğin eşlenmesi, satıştan kaldırma, sürüm değişimi, özel koşul bitişi |
| Mali geçiş | Fiyat önizlemesi, dönem sonu geçiş, eşzamanlı istek, yeniden deneme, başarısız sağlayıcı işlemi |
| Kota | Eşzamanlı oluşturma, dönem sıfırlama, düşürmede limit üstü kullanım, önbellek yenileme |
| Duyuru | Hedef dışı erişim, yayın/bitiş sınırı, iki sekme, erteleme, tek popup, mobil/klavye |
| Bağlı iş | Talep-görev-yayın zinciri, ikinci yetkili, sürüm çakışması, hatırlatma tekrarı |

Bir teslimin tamamlanması için kod, migration, ilgili test sonuçları, kullanıcı akışı ve bilinen sınırlamalar birlikte kaydedilir. Yazılmış kod tek başına tamamlandı sayılmaz. Performans hedefleri ve veri hacmi T0'da mevcut ortam ölçümüyle belirlenir; T6'da aynı hacimde doğrulanır.

## 8. Geçiş, pilot ve geri dönüş

1. Eklemeli şema ve uyumlu API değişikliklerini hazırla; eski/yeni sürüm birlikte çalışma koşullarını doğrula.
2. Mevcut planları eşle, abonelik/erişim/fiyat sonuçlarını uzlaştır; eşlenmeyen kayıt varsa paket geçişini durdur.
3. Firma takip ve istatistikleri sınırlı pilotta aç; özetlerle kaynak kayıtlarını karşılaştır.
4. Paket değişimini seçili pilot firmalarda dene; yenileme, kota, fatura ve iade ilişkilerini doğrula.
5. Duyuruları önce önizleme/test hedef kitlesinde, sonra seçili firmalarda yayınla; hedef dışı görünürlüğü kontrol et.
6. Birleşik kabul sonrası yayın adayı oluştur; geçiş raporu ve somut değişiklikler kullanıcıya sunulur. Bu program üretim yayını yetkisi içermez.

Geri dönüşte yeni paket satışı/geçişi ve duyuru yayını durdurulabilir; uygulanmış ödeme, fatura ve abonelik geçmişi silinmez. Mali işlemler mevcut düzeltme/iade yollarıyla ele alınır. Şema geri dönüşü veri kaybettiriyorsa ileri düzeltme uygulanır. Eski uygulama sürümüne dönüşün yeni paket koşullarını okuyabilmesi pilot öncesi doğrulanır.

## 9. İlk başlanacak işler ve ilerleme kaydı

İlk çalışma sırası: **HZ-01 → HZ-02/HZ-03/HZ-04 → FR-01 → FR-02 → FR-03 → FR-04/FR-05 → IS-01–IS-05**. Ardından T3 ve T4; T5 işleri ilgili ön koşulları tamamlandıkça alınır. Bu sıralama eşzamanlı ajan çalışması talimatı değildir.

Her iş kaydı şu alanlarla takip edilir: iş kodu, sorumlu, durum, bağımlılık, ilgili değişiklik/commit, test kanıtı, bilinen sınırlama ve tamamlanma tarihi. Durumlar: yapılacak, geliştirmede, doğrulamada, engelli, tamamlandı. Yeni kapsam ayrı iş olarak eklenir; mevcut kabul ölçütleri sessizce daraltılmaz.

### 2 Kasım ilk teslim kaydı

| İş | Durum | Kanıt / kalan |
|---|---|---|
| HZ-01–02 | Geliştirmede | Paket kaynakları ve liste metrikleri belgelendi; tam kota/istatistik envanteri devam edecek |
| HZ-03–04 | Liste kapsamı uygulandı | Doğrulanan sayfalı API, URL filtreleri, mevcut yönetici yetkisi ve dar SQL işlevleri |
| FR-01 | İlk sürüm tamamlandı | 215 firma ile gerçek PostgreSQL kabulü, filtre/URL/mobil tarayıcı kabulü |
| FR-02 | Kısmen tamamlandı | Giriş, yenileme, deneme, ödeme ve bağlantı görünümleri hazır; takip tarihi görünümü FR-04'ü bekliyor |
| FR-03–05, IS, PK, DY, AK | Yapılacak | Bu teslimde tamamlandı sayılmaz |

İlgili isterler PLT-47–49 olarak [ister belgesine](ISTERLER.md) kaydedildi. Yerel 3100 pilot derlemesi ve üretim yayını değiştirilmedi.

### Firma detay ve takip devam kaydı

| İş | Durum | Kanıt / kalan |
|---|---|---|
| FR-02 | Tamamlandı | Takip tarihi geçen ve sorumlusu uygun olmayan görünümler eklendi |
| FR-03 | İlk sürüm hazır | Kalıcı URL, filtreli dönüş, genel bilgiler, takip, notlar, bağlı görevler, mevcut abonelik/ödeme ve olay geçmişi; kullanım ve duyuru bölümleri IS/DY teslimlerinde |
| FR-04 | Tamamlandı | Sürüm kontrollü kayıt, yönetici ataması, eklemeli/tekrar korumalı not, görev bağı ve denetim |
| FR-05 | Kısmen uygulandı | Firma kimliği taşıyan denetim akışı mevcut; tüm operasyon kaynaklarının birleşik zaman çizelgesi sürüyor |
| IS-01–05 | Sıradaki ana teslim | Günlük ölçüm, büyüme, kullanım, abonelik ve operasyon istatistikleri |

PLT-50–53 aynı ister belgesine işlendi. Yeni migration yalnız geçici PostgreSQL'de sınanır; mevcut yerel/üretim veritabanına ve 3100 derlemesine uygulanmadı. Mevcut görevler firma bağı olmadan çalışmayı sürdürür.

### Firma istatistikleri ilk sürüm devam kaydı

| İş | Durum | Kanıt / kalan |
|---|---|---|
| IS-01 | Tamamlandı | Günlük atomik/idempotent özet, worker, sınırlı yeniden hesaplama, sürüm ve eksik gün işareti |
| IS-02 | Yapılacak | Büyüme, deneme kohortu, ücretliye dönüşüm ve iptal geçmişi |
| IS-03 | İlk sürüm hazır | 7/30 gün, dönemsel tekil hesap, gözlenen modül etkinliği; güvenilir hiç başlamayan ayrımı kalıyor |
| IS-04 | Kısmen uygulandı | Güncel paket/yenileme/gecikme/başarısız tahsilat/bağlantı sayıları; bekleyen işler ve tarihsel eğilimler kalıyor |
| IS-05 | İlk sürüm hazır | Tarih/paket/firma filtreleri, eşit dönem karşılaştırması, grafik/tablo, aynı özetten sayfalı detay |

Kanıt ve metrik sözlüğü: [istatistik ilk teslim](PLATFORM-FIRMA-ISTATISTIKLERI-ILK-TESLIM-2026-11-02.md). İsterler PLT-54–58 olarak kaydedildi. IS-02 tamamlanmadan T2 bütünü tamamlandı sayılmaz. Sonraki iş büyüme ve denemeden ücretliye dönüşüm ölçümüdür; ardından paket ve duyuru teslimleri sürer. Migration ve 3100 derlemesi mevcut ortama uygulanmadı.

### Büyüme ve deneme dönüşümü devam kaydı

| İş | Durum | Kanıt / kalan |
|---|---|---|
| IS-02 | İlk sürüm tamamlandı | Kaynakla atomik yaşam geçmişi, başlangıç/son firma, kayıt/silme/net/iptal; ölçüm sonrası yeni firmaların ilk denemesinde 14 günlük olgun kohort ve açık payda |
| IS-03 | Kısmen hazır | Gözlenen etkinlik mevcut; ölçüm başlangıcından beri hiç başlamayan ayrımı kalıyor |
| IS-04 | Kısmen hazır | Güncel abonelik/operasyon mevcut; bekleyen işler ve tarihsel operasyon eğilimleri kalıyor |
| PK / DY | Sırada | Ayrıntılı paket kataloğu ve duyuru sistemi henüz uygulanmadı |

PLT-59–62 [ister belgesine](ISTERLER.md) ve [teslim kaydına](PLATFORM-BUYUME-VE-DENEME-DONUSUMU-2026-11-02.md) işlendi. Ölçüm öncesi büyüme null kalır; ilk gün ortasında alınan başlangıç fotoğrafı tam gün geçmişi sayılmaz. Paket filtresi dönem sonuna göre sabit kapsam seçer. Kaynak kayıt akışı aktif abonelik açıyorsa otomatik deneme olarak sayılmaz. Sonraki iş IS-03/04 kalanlarının tamamlanması, ardından T3 paket yönetimidir. T2 bütünü tamamlandı sayılmaz. Mevcut veritabanı ve 3100 derlemesi değiştirilmedi.

### Kullanıma başlama ve bekleyen işler devam kaydı

| İş | Durum | Kanıt / kalan |
|---|---|---|
| IS-03 | Gözlenen kullanım ilk sürümü tamamlandı | Tam kayıt sonrası günlük gözlem, pozitif etkinlik/etkinlik yok/belirsiz sınıfları ve tarihsel kesimden firma listesi |
| IS-04 | Bekleyen işler eklendi | Açık firma görevi, fatura işlemi, iade muhasebeleştirmesi; tür/paket/firma kapsamlı firma ayrıntıları. Ödeme raporuyla tam kapsam uzlaştırması ve tarihsel operasyon eğilimleri kalıyor |
| IS-05 | Yeni bölümlere uygulandı | Ayrı kapsam açıklamaları, URL sınıf/tür/sayfa, bağımsız sayfa sıfırlama ve aynı kaynaktan kart/liste |

PLT-63–66 ve [teslim kaydı](PLATFORM-KULLANIMA-BASLAMA-VE-BEKLEYEN-ISLER-2026-11-02.md) eklendi. Güncel abonelik, dönem kullanımı, tarihsel başlama ve canlı iş sayıları birbirinin yerine kullanılmaz. T2 bütünü tamamlandı sayılmaz. Sonraki iş IS-04 ödeme raporu kapsam uzlaştırmasıdır; ardından paket kataloğu aşamasına geçilir. Mevcut veritabanı ve 3100 derlemesi bu teslimde değiştirilmedi.

### Yerel yayın kaydı

Kullanıcının "güncelleyelim" talimatıyla mevcut yerel veritabanına dört platform migration'ı uygulandı; API, worker ve localhost:3100 web yeni sürüme geçirildi. Veritabanı yedeği alınıp tamamen okunabildiği doğrulandı; firma sayısı 723 olarak korundu. Gerçek API ve tarayıcı salt okuma kontrolü geçti. [Güncel yerel yayın durumu ve geri dönüş bilgileri](PLATFORM-YEREL-GUNCELLEME-2026-11-02.md). Önceki teslimlerdeki yayınlanmadı kayıtları kendi tarihlerindeki durumu anlatır; bu yayın kalan program işlerini tamamlandı saymaz.


### 3 Kasım ödeme kapsam uzlaştırması

IS-04 başarısız/sonuçlanmamış ödeme denemelerinin seçili tarih, güncel paket ve firma kapsamı ödeme raporuyla ortak kaynağa bağlandı. 500 kayıt sınırı yerine kararlı sayfalama ve tam toplam eklendi; kart sorunları ayrı canlı kapsam olarak açıklandı. [Teslim ve doğrulama kaydı](PLATFORM-ODEME-KAPSAM-UZLASTIRMASI-2026-11-03.md). Tarihsel operasyon eğilimleri kalıyor; T2 bütünü kapanmadı. Yeni migration mevcut ortama uygulanmadı.


### 3 Kasım tarihsel abonelik ve operasyon devam kaydı

IS-04–05 için günlük son başarılı operasyon gözlemi, tarihsel paket/firma kapsamı, günlük tablo, eşit dönem sonu karşılaştırması ve aynı kaynaktan sayfalı firma ayrıntısı eklendi. Kaynakta bulunmayan geçmiş durum yeniden üretilmez; eksik gün ve eksik firma satırı null kalır. [Ölçüm sözleşmesi ve doğrulama kaydı](PLATFORM-TARIHSEL-OPERASYON-EGILIMLERI-2026-11-03.md). PLT-68–70 isterlere işlendi. IS-04'ün gözlenen tarihsel operasyon ilk sürümü tamamlandı; T3 paket kataloğu sıradadır. Programın kalan FR/DY maddeleri ve birleşik pilot kabulü devam eder. Yeni migration mevcut ortama uygulanmadı.


### 3 Kasım paket fiyat hesaplama temeli

PK-02 için dönem bedeli, TRY/KDV hariç sözleşme doğrulaması ve Decimal hesaplama eklendi. Mevcut tutar hesabı bu ortak kaynağa bağlandı; eski planların dört dönem tutarları korundu. [Kapsam ve kalan işler](PLATFORM-PAKET-FIYAT-SOZLESMESI-2026-11-03.md). Fiyatın sürüme kaydı, geçerlilik tarihi ve abonelik/ödeme bağlantıları henüz yok; PK-02 ve PK-09 açık. Veritabanına veya çalışan uygulamaya uygulanmadı.

### 3 Kasım paket tanımı ve sürüm yönetimi

PK-01'in tanım/sürüm bölümü eklendi: mevcut üç tanımın aktarımı, yeni paket/taslak, revizyon kontrollü düzenleme, değiştirilemez yayın, kaynak sürümden kopya ve arşiv; yönetim listesi ve kalıcı detay. [Teslim ve ticari tüketici envanteri](PLATFORM-PAKET-KATALOGU-ILK-TESLIM-2026-11-03.md). Satışa açıklık, fiyat/kota/erişim ve abonelik sürüm bağlantıları tamamlanmadı; PK-01 ve T3 bütünü kapanmaz. Katalog yayını müşteri koşullarını değiştirmez. Sıradaki teslim PK-02 fiyat sözleşmesi ve abonelik/ödeme sürüm bağlantısıdır; PK-09 önce/sonra uzlaştırması geçişin ön koşuludur. Yeni migration mevcut ortama uygulanmadı.


### 3 Kasım paket sürüm fiyatları

PK-02 için taslakta TRY/KDV hariç dönem bedelleri ve Türkiye takvim günüyle geçerlilik tarihi eklendi. Fiyat yayın önizlemesi ve geçmişte görünür, yeni taslağa kopyalanır; yayınlandıktan sonra DB seviyesinde de değiştirilemez. Eski istemcinin göndermediği fiyat korunur; kaldırma açık null gerektirir. [Teslim ve doğrulama](PLATFORM-PAKET-FIYAT-SOZLESMESI-2026-11-03.md). PLT-75–78 isterlere işlendi. Abonelik/ödeme/yenileme/fatura sürüm bağlantıları ve PK-09 uzlaştırması hâlâ açık; geçerlilik tarihi otomatik ticari geçiş başlatmaz. Yeni migration yalnız izole kabul veritabanında uygulandı.


### 3 Kasım ödeme fiyat fotoğrafı ve fatura kaynağı

PK-02 geçiş hazırlığında yeni panel/e-posta/otomatik yenileme girişimlerinin mevcut sabit koşulları değiştirilemez fotoğrafa yazıldı; ödeme aynı fotoğrafı devralıyor, fatura ad/matrah/oranı bu kayıttan geliyor. Güncel plan değişikliği başlamış ödemenin faturasını değiştirmiyor. [Teslim, eski kayıt sınırı ve doğrulama](PLATFORM-ODEME-FIYAT-FOTOGRAFI-2026-11-03.md). PLT-79–82 isterlere işlendi. Katalog sürümü aboneliğe atanmadı; PK-09 önce/sonra uzlaştırması, katalog fiyatından koşul seçimi ve yenileme önizlemesi sıradadır. Elle tahsilat ve fotoğrafsız eski kayıtlar mevcut davranışını korur. Yeni migration yalnız izole kabul veritabanında uygulandı; çalışan yerel uygulama güncellenmedi.


### 3 Kasım eski aboneliklerin katalog bağı

PK-09 için bilinen üç plan/v1 ilk katalog sürümüne, mevcut koşulları aynı abonelik satırında korunarak bağlandı. Bilinmeyen plan varsayılmadan raporlanıyor. Abonelik özeti/limitler, ödeme seçenekleri/girişimi/otomatik yenileme ve yenileme önizlemesi bağlı koşulları okuyor; fotoğraf şema 2 kaynak sürümü taşıyor. `/platform/paketler/gecis` dört dönem ve limit karşılaştırmasını sunuyor. [Teslim ve kanıt](PLATFORM-ABONELIK-KATALOG-BAGI-2026-11-03.md): 89 birim, dokuz yeni bağ kabulü, migration öncesi/sonrası alan ve toplam fiyat provası, 10 benzersiz tarayıcı senaryosu; API/web tip ve lint temiz. PLT-83–86 isterlere işlendi. PK-09 uygulama/izole kabulü kapandı; yeni katalog fiyatını seçme/etki önizlemesi ve kontrollü atama PK-02/PK-08 kapsamında devam ediyor. Mevcut yerel veritabanına migration veya uygulamaya yayın yapılmadı.

### 4 Kasım katalog fiyat etkisi önizlemesi

PK-02/PK-08 için yayınlanmış hedef sürümün fiyatlarını aynı plandaki kayıtlı abonelik koşullarıyla karşılaştıran yönetici API'si ve ekranı eklendi. Dört dönem için matrah/KDV/toplam ve fark, ayrı vergi oranları ve eksik fiyatlar korunarak gösterilir. Diğer planlar karşılaştırılamama gerekçesiyle listelenir; bu liste etkilenen veya atamaya uygun firma listesi değildir. [Kapsam ve doğrulama](PLATFORM-PAKET-FIYAT-ETKISI-2026-11-04.md). Sıradaki adım hedef firma seçimi, uygulama tarihi, onaylanan etki kaydı ve kontrollü atamadır; PK-02/PK-08 bütünü kapanmadı. Mevcut veritabanı ve çalışan uygulama değiştirilmedi.

### 4 Kasım aynı planda kontrollü fiyat ataması

Seçili en çok 25 firma için bugünün Türkiye tarihiyle kalıcı koşul/etki önizlemesi, 15 dakikalık ayrı onay ve atomik/idempotent atama eklendi. Onay anında yönetici, hedef sürüm ve tam kaynak abonelik satırları yeniden doğrulanır. Plan, kota ve mevcut dönem korunur; yeni girişim/yenileme hedef fiyatı, başlamış ödeme kendi fotoğrafını kullanır. [Teslim ve sınırlar](PLATFORM-PAKET-KONTROLLU-ATAMA-2026-11-04.md): 128 birim, 39 benzersiz izole PostgreSQL kabul ve 14 benzersiz tarayıcı testi; migration öncesi/sonrası uzlaştırması, API/web tip ve lint kontrolleri geçti. İleri tarihli uygulama, yeni satış ve paketler arası geçiş devam eder; PK-02/PK-08 bütünü kapanmadı. Yeni migration'lar mevcut ortama uygulanmadı; çalışan uygulama güncellenmedi.

### 4 Kasım ileri tarihli ve dönem sonu atama

Aynı plandaki fiyat atamasına Türkiye 00.00 ileri tarih (en çok 366 gün), tek firmanın tam dönem sonu, kalıcı plan onayı, gerekçeli iptal, yönetim listesi ve dakikalık worker eklendi. Worker zamanı gelince kaynak/hedef/yetkiyi tekrar doğrular; değişiklikte tüm grup inceleme bekler. Firma başına tek plan ayrılır; iki worker ve iptal yarışı tek sonuç verir. Erken otomatik tahsilat deneme hakkı harcamadan bekler; vadesi gelmiş/incelemedeki plan çözülmeden eski fiyatla yeni girişim açılmaz. [Teslim ve kalanlar](PLATFORM-PLANLI-PAKET-ATAMASI-2026-11-04.md): 133 birim, 54 izole PostgreSQL kabul ve 18 benzersiz tarayıcı testi; API/web tip, Prisma ve lint kontrolleri geçti. PK-03/PK-04 özellik/kota sözleşmeleri sıradadır; yeni satış, firma istisnaları ve paketler arası geçiş açık olduğundan T3 kapanmadı. Mevcut veritabanı ve çalışan uygulama güncellenmedi.

### 4 Kasım modül ve kota sözleşmesi

PK-03/PK-04 için ortak modül envanterine bağlı 17 kod/bağımlılık ve ölçüm tanımlı dört kota; birim/dönem, sınır/sınırsız ve uyarı eşiği sözleşmesi eklendi. Katalog taslağında düzenlenir, yayın önizlemesi/geçmişinde görünür, kaynak taslağa kopyalanır ve yayından sonra DB'de değiştirilemez. Mevcut aboneler değiştirilmedi; kapsam ataması tamamlanana kadar kapsamlı sürümler fiyat atamasına kapalıdır. Aylık fatura sayımı Türkiye ay sınırlarına bağlandı. [Teslim ve ölçüm/kalan envanteri](PLATFORM-PAKET-KAPSAM-SOZLESMESI-2026-11-04.md): 144 API + 38 ortak birim, 69 PostgreSQL kabulü ve 22 tarayıcı testi; API/web tip ve lint kontrolleri geçti. Sonraki iş kapsamın kiracıya kontrollü ataması, aynı kaynaktan erişim ve atomik kota kontrolleridir; PK-03/PK-04 bütünü kapanmadı. Mevcut veritabanı ve çalışan uygulama güncellenmedi.

### 4 Kasım kapsam ataması, ortak erişim ve atomik dört kota

Aynı plandaki abonelikler modül/kota/fiyat etkisi ve ayrı onayla şema 2 koşullarına geçirilebilir; bugünkü/ileri tarih/dönem sonu akışları ortak denetimi kullanır. Kullanım altı kota reddedilir; kullanım değişen önizleme/plan yeniden inceleme gerektirir. API/panel, araç/MCP, ek dosya ve ilgili otomasyonlar bağlı modülleri uygular; rol yetkisi genişlemez. Kullanıcı/cari/stok/fatura yazımları DB seviyesinde ortak abonelik kilidiyle korunur; toplu yazım, kopya, yeniden etkinleştirme, rol değişimi ve eşzamanlı son yer senaryoları kapsandı. Abonelik ekranı kayıtlı uyarı eşiğini kullanır. [Teslim, doğrulama ve kalanlar](PLATFORM-KAPSAM-ATAMASI-VE-ATOMIK-KOTA-2026-11-04.md). PLT-102–105 isterlere işlendi. Yeni satış, paketler arası geçiş, firma istisnaları ve diğer kota ölçümleri devam eder; T3 kapanmadı. Mevcut veritabanı ve çalışan uygulama güncellenmedi.

### 4 Kasım katalog satış seçimi ve geçmişi

PK-01 için paket düzeyinde ayrı satışa açıklık ve seçili sürüm eklendi. Kapalı başlangıç, hazır yayın/fiyat/kapsam zorunluluğu, gerekçeli önizleme/onay, durdurma, ayrı satış revizyonu ve sayfalı geçmiş yönetim ekranına bağlandı. Yeni yayın mevcut seçimi değiştirmez. Satışa açık hedefi arşivleme, doğrudan SQL ve eski transaction görünümünde de engellenir; eşzamanlı yönetici onayları aynı revizyonu iki kez tüketemez. [Teslim ve doğrulama](PLATFORM-PAKET-SATIS-DURUMU-2026-11-04.md). PLT-106–108 isterlere işlendi. Katalog yönetimi PK-01 tamamlandı; yeni müşteri kayıt/satın alma bağlantısı açıkça kapsam dışı gösterilir ve PK-02/PK-08 kapsamında devam eder. Mevcut veritabanı ve çalışan uygulama güncellenmedi.


### Firma istisnaları ve ek hacmi ölçümü — 2026-11-04

PK-07 uygulaması ve izole kabulleri tamamlandı: süreli fiyat/modül/kota taslağı, ayrı onay, gerekçeli iptal, etkin koşul çözümü, otomatik süre sonu dönüş ve eski transaction görünümüne karşı kota sürümü koruması. [Teslim ve kanıt](PLATFORM-FIRMA-ISTISNA-TASLAKLARI-2026-11-04.md). Canlı ortam pilotu T3 kapsamında açık kalır. PK-04 için [kayıtlı ek hacmi ölçümü](PLATFORM-EK-HACMI-OLCUMU-2026-11-04.md) eklendi; depolama kotası uygulaması henüz açılmadı.


## Deneme süresi sonu ve ücretli geçiş — 04.11.2026

Mevcut deneme kayıtlarının bitiş sınırı erişime bağlandı; kullanıcı kendi durumunu değiştirerek süre sınırını aşamaz. Sağlayıcı ve manuel ödeme denemeyi etkinleştirir, kalan ücretsiz süreyi korur ve geçmiş süreyi satın alınan dönemden düşmez. [Sözleşme ve kapsam](PLATFORM-DENEME-SURE-SONU-2026-11-04.md). Katalogdan deneme gün/koşul tanımı ve yeni kayıt kampanyası devam eder. Mevcut ortama uygulanmadı.
