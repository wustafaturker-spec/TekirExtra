# Platform Kurumsal Yönetim — İhtiyaç Odaklı Yol Haritası

**Tarih:** 31 Ekim 2026  
**Sürüm:** 2.0  
**Durum:** Değerlendirme adayları; onaylanmış ister, takvim veya açık imalat taahhüdü değildir.  
**Bağlı uygulama belgesi:** [P0 düzeltme imalat planı](PLATFORM-KURUMSAL-YONETIM-IMALAT-PLANI-2026-10-31.md).

## 1. Kullanım kuralı

Pilot ve küçük ekip ölçeğinde önce PLT-25–31 güvenlik/veri tutarlılığı düzeltmeleri tamamlanır. Bu yol haritasındaki özellikler yalnız gerçek ihtiyaç, kullanıcı/iş sahibi, yeniden kullanım değerlendirmesi ve kabul ölçütleri kesinleştiğinde isterleştirilir. S-01 gözden geçirmesi sonrası o tarihte boş olan sıradaki PLT numarası alınır. Buradaki eski K referansları yalnız ilk belgeyle eşleme içindir; yeni bir aktif numara dizisi değildir.

Her aday için durum **Değerlendirme adayı**dır. Hedef tarih, atama veya tahmini süre yoktur. Aşağıdaki kabul ölçütleri gelecekteki isterin başlangıcıdır; bugün yapılacak iş sayılmaz. Yol haritası adayları P0’ın teslim kapısı olamaz.

## 2. Küçültülmüş P1 önerisi — henüz onaylanmadı

P0 sonrası önerilen en küçük kapsam üç başlıktır. Finans/destek rolüne bugün ihtiyaç yoksa rol genişlemesi de ertelenebilir.

### Yalın platform rolleri — eski K07

**Öneri:** Mevcut yönetici ve mevzuat editörüne yalnız finans/destek rolleri eklenmesini değerlendir. API, menü ve görev kapsamı için küçük, açık rol matrisi kullan. Dinamik rol tasarım ekranı, süreli vekâlet ve genel izin motoru ilk teslimde yoktur. Finansın ödeme/abonelik, desteğin izinli destek/operasyon erişimi sınırları ürün sahibiyle netleştirilir; ikisi de varsayılan olarak kullanıcı yönetemez veya mevzuat yayınlayamaz.

**Kabul adayı:** Pozitif/negatif rol matrisi HTTP ile doğrulanır. Son aktif yönetici ve dört göz ilkesi korunur. Yeni roller eklendiğinde, rol düşürmede görev aktarımı (PLT-31) yeni rol geçişlerine de uygulanır: kişinin artık göremeyeceği kapsamdaki açık görevler aynı işlemde aktarılır. Bugünkü yönetici → editör açığı bu adayı beklemez; P0'da PLT-31 ile kapanır.

**Sonraya bırakılan kısım:** Özel roller, vekâlet, süreli izin ve ilave denetçi/hazırlayan/onaylayan şablonları, gerçek ekip gereksinimi doğarsa ayrıca isterleştirilir.

**Etkinleştirme koşulu:** Finans/destek görevleri farklı kişilere verildiğinde ve mevcut iki rol iş ayrımını karşılamadığında.

**Yeniden kullanılacak bileşen:** KLN-20 izin kataloğu ve matris yaklaşımı (`packages/shared/src/yetki-modulleri.ts`, `tenant/ozel-roller.controller.ts`), platform guard/decorator ve menü süzme. Kiracı rol kayıtları ve tenant bağlamı platformla birleştirilmez.

**Durum:** Değerlendirme adayı; ayrı kapsam onayı gerekir.

### Denetim kategorisi ve takip kimliği — eski K10

**Öneri:** PLT-26 görünürlük düzeltmesini genişlet; mevcut olay kaydına açık kategori ve API/worker adımlarını bağlayan takip kimliği ekle. Yeni olay deposu veya genel analitik platformu kurma. Kullanıcıya okunabilir hata ve gerektiğinde takip kimliği göster.

**Kabul adayı:** Aynı işlem ilgili log ve olay kayıtlarında izlenir; gizli değer yazılmaz; editörün PLT-26 ile kapatılan erişimleri açılmaz. Arama/dışa aktarma ve arşiv genişletmeleri ihtiyaçla ayrıca belirlenir.

**Etkinleştirme koşulu:** Denetim olaylarını iş akışları arasında arama/izleme ihtiyacı oluştuğunda.

**Yeniden kullanılacak bileşen:** Mevcut `mevzuatOlay`, denetim ekranı ve `core/observability` hata/structured logger altyapısı; ikinci olay deposu kurulmaz.

**Durum:** Değerlendirme adayı; ayrı kapsam onayı gerekir.

### Sunucu sayfalaması ve API hata yanıtı — eski K12’nin dar kısmı

**Öneri:** Firma listesindeki sınırsız yüklemeyi, mevzuat değişikliklerindeki 200 ve taleplerdeki 300 kayıt tavanını gerçek sunucu sayfalamasıyla değiştir. Sınırlandırılmış sayfa boyutu, kararlı sıralama, arama/filtre ve açık toplam/sonraki sayfa bilgisi sağla. URL filtreleri ve eski yanıt iptali korunsun. `platform-api.ts` JSON dışı hata yanıtında ayrıştırma hatası yerine anlaşılır durum/kod ve varsa takip kimliği sunsun.

**Kabul adayı:** 200/300 sınırını aşan veride kayıt kaybolmaz; aynı zamanlı kayıtlarda sayfa sırası kararlıdır; eski istek yeni filtreyi bozmaz. HTML, boş gövde ve bozuk JSON hata yanıtları kullanılabilir mesaj üretir.

**Kapsam dışı:** Mevzuattan ayrı platform modülüne taşıma, genel UI yenileme ve geniş mimari refactor. Bunlar aşağıdaki koşullu mimari adaydır.

**Etkinleştirme koşulu:** Firma/liste hacmi mevcut sorgu sınırları veya hata işleme sorunları nedeniyle kullanım kaybı ürettiğinde.

**Yeniden kullanılacak bileşen:** PLT-03 firma listesi, mevcut mevzuat liste servisleri, PLT-24 URL filtreleri, `use-platform-verisi.ts`, `platform-api.ts` ve ortak liste bileşenleri.

**Durum:** Değerlendirme adayı; ayrı kapsam onayı gerekir.

## 3. Diğer ihtiyaç adayları — mevcut imalat kapsamında değil

### Ortak kritik işlem onay merkezi — eski K08

**İhtiyaç doğarsa önerilen kapsam:** Talep → inceleme → onay/ret/süre dolumu → uygulama → sonuç akışını kur. Ödeme düzeltme, iade, eşik üstü indirim, toplu askı ve sağlayıcı değişikliğini kapsa. Talepte gerekçe, önceki/yeni değer, etki listesi, sürüm ve geçerlilik süresi tut. Talep sahibi onaylayamasın. Onay sonrası içerik değişirse yeni onay iste. Uygulama anında aktör/onaylayanın yetkisini ve kaynak sürümünü yeniden denetle. Çift uygulamayı işlem anahtarıyla engelle.

**Gelecekteki kabul ölçütü adayı:** Onaylanmamış veya süresi dolmuş talep uygulanamaz. Onaylı içerik sonradan değiştirilemez. Aynı onaya iki uygulama tek etki üretir. İptal edilmiş yetki veya değişmiş kaynak kayıt yeniden inceleme gerektirir.

**Etkinleştirme koşulu:** Aynı kritik mali/yönetim işlemini hazırlayan ve uygulayan kişilerin ayrılması ihtiyacı doğduğunda.

**Yeniden kullanılacak bileşen:** Mevzuatın dört göz/durum geçişi yaklaşımı, mevcut abonelik talep kararı ve AI onay altyapısı. AI onayında isteyen kişinin onay vermesi kuralı farklıdır; platformda ikinci kişi onayı ayrı politika olarak uygulanır.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Oturum, cihaz ve hesap kurtarma merkezi — eski K09

**İhtiyaç doğarsa önerilen kapsam:** Kullanıcıya aktif oturumlar, son etkinlik, cihaz bilgisi ve tek/tüm oturumları kapatma ekranı sun. Cihaz bilgisinin güvenilir cihaz kanıtı olmadığını tasarımda dikkate al. Tek kullanımlık, özetlenmiş kurtarma kodları; görev ayrılığına sahip hesap kurtarma; hassas işlemlerde kısa süreli yeniden doğrulama ekle. Şüpheli giriş ve yetki değişikliği bildirimi üret. İsteğe bağlı IP kısıtlamasına kilitlenmeyi önleyen kontrollü yönetim akışı ekle.

**Gelecekteki kabul ölçütü adayı:** Kurtarma kodu bir kez kullanılır; sıfırlama önceki kodları iptal eder. Yeniden doğrulama başka işleme taşınamaz. Kullanıcı kendi oturumlarını, yetkili güvenlik yöneticisi izinli oturumları kapatabilir.

**Etkinleştirme koşulu:** Birden çok cihaz/oturum veya kullanıcı kurtarma talebi somutlaştığında.

**Yeniden kullanılacak bileşen:** PLT-25 oturum iptali, kiracı oturum ekranı/servis yaklaşımı ve `auth/kurtarma-kodlari.ts`; platform kimlik ve anahtarları ayrı kalır.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Bildirim, hatırlatma ve eskalasyon altyapısı — eski K11

**İhtiyaç doğarsa önerilen kapsam:** Mevcut BLD uygulama içi/e-posta bildirim altyapısını platform personeli için genişlet. Alıcı, sorumlu, kanal, önem ve tekrar sıklığını tanımla. Görev tarihi, onay bekleme, destek süresi, tahsilat ve alarm olaylarını bağla. Mevcut teslimat/tekrar deneme kayıtlarını kullan; eksik kalan kalıcı teslimat, mükerrer bildirim engeli ve başarısız teslimat görünümünü tamamla. Gerekirse outbox tasarımını bu aday içinde değerlendir. Kritik güvenlik bildirimleri ile isteğe bağlı bildirim tercihlerini ayır.

**Gelecekteki kabul ölçütü adayı:** Worker yeniden başlasa da bildirim kaybolmaz. Aynı olay/alıcı/kanal kombinasyonu tekrar e-posta üretmez. Süre aşan iş belirlenen sorumluya yükseltilir; teslimat hatası görünürdür.

**Etkinleştirme koşulu:** Platform personeline kalıcı bildirim/teslimat gereksinimi doğduğunda; BLD’nin eksik kalan kısmı ölçüldüğünde.

**Yeniden kullanılacak bileşen:** Bildirim Merkezi (BLD), `bildirimler/bildirim.service.ts`, `bildirim-uretici.service.ts`, `bildirim-eposta.service.ts`, zamanlayıcı ve mevcut worker/kuyruk altyapısı. Kiracı alıcı/kapsam kuralları platform personeline doğrudan uygulanmaz.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Bütünleşik firma yönetim ekranı — eski K13

**İhtiyaç doğarsa önerilen kapsam:** Firma kimliği, iletişim kişileri, sorumlu ekip üyesi, sözleşme, abonelik, ödeme/fatura, kullanım, entegrasyon, destek ve görev özetlerini tek detay ekranında topla. Görüşme notu ve takip tarihi ekle. Deneme → kurulum → aktif → riskli → askıda → ayrılmış yaşam döngüsünü nedenli geçişlerle yönet. Bu operasyon statüsünü abonelik erişim statüsünden ayrı tut. Kurulum kontrol listesi ve eksik yapılandırmaları göster. Yetkili olaylardan ortak zaman çizelgesi oluştur.

**Gelecekteki kabul ölçütü adayı:** Bir firma seçimi diğer firmanın detayını göstermez. Finans bilgisi izinsiz destek rolüne açılmaz. Operasyon statüsü tek başına aboneliği askıya almaz. Her geçişin aktörü, nedeni ve geçmişi görünür.

**Etkinleştirme koşulu:** Firma bilgileri arasında dolaşma günlük destek/finans işini belirgin yavaşlattığında.

**Yeniden kullanılacak bileşen:** PLT-03 firma listesi/geçmişi, abonelik/ödeme/fatura servisleri ve PLT-24 görev merkezi; kiracı özet fonksiyonları genişletilir.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Destek talepleri ve hizmet seviyesi yönetimi — eski K14

**İhtiyaç doğarsa önerilen kapsam:** Talep numarası, kategori, önem, ekip/sorumlu, durum, ilk yanıt ve çözüm hedefi ekle. Çalışma saatleri, tatiller, müşteri yanıtı bekleme ve yeniden açılmada süre kurallarını tanımla. İç notları müşteri mesajından ayır. Dosya eklerinde erişim, boyut ve içerik güvenliği uygula. İlgili belge/entegrasyon ve görev bağlantıları kur. Kapanış nedeni ve müşteri değerlendirmesi ekle.

**Gelecekteki kabul ölçütü adayı:** Müşteri iç notu ve yetkisiz eki göremez. Süreler tanımlı takvimle hesaplanır. Görev kapatma destek talebini kendiliğinden çözmez. Hedef aşımı K11 üzerinden eskale edilir.

**Etkinleştirme koşulu:** Müşteri destek talepleri düzenli hacme ulaştığında ve sorumlu/hedef süre takibi gerektiğinde.

**Yeniden kullanılacak bileşen:** PLT-24 görev merkezi, BLD ve mevcut ek dosya güvenliği. `/platform/talepler` MVZ mevzuat talebidir; müşteri destek bileti değildir, yeniden adlandırılarak veya aynı tabloya karıştırılarak kullanılmaz. Destek talebi ayrı iş türü olur; mevzuat talebiyle açık bağlantı kurulabilir.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Talebe bağlı ve denetlenebilir destek erişimi — eski K15

**İhtiyaç doğarsa önerilen kapsam:** Mevcut firma izinli, süreli, salt okunur destek oturumunu koru. Açılışı destek talebi ve gerekçeye bağla; destek kişisini, süreyi ve yapılan erişimleri göster. Firma izni geri alındığında oturumu düşür. Platform kullanıcısının pasife alınması/yetkisinin kaldırılmasının açık destek token'ını da düşürmesini sağla. Kritik veri görüntüleme ve dışa aktarma için ayrı izin tanımla.

**Gelecekteki kabul ölçütü adayı:** Firma izni, destek yetkisi veya kullanıcı aktifliği kalktığında destek erişimi en geç 10 saniyede kapanır. Yazma uçları reddedilir. Her erişim firma ve platform denetimine bağlanır; talep dışı erişim açılamaz.

**Etkinleştirme koşulu:** Ayrı destek personeli ve kayıtlı destek talebi akışı devreye girdiğinde.

**Yeniden kullanılacak bileşen:** PLT-10 ve KLN-24 firma izinli salt okunur destek erişimi, `DestekOturumService`, platform/firma denetim kayıtları; ikinci destek token mekanizması kurulmaz.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Tahsilat ve finansal mutabakat — eski K16

**İhtiyaç doğarsa önerilen kapsam:** Banka hareketi, sağlayıcı tahsilatı, abonelik ödemesi ve faturayı referanslarla eşleştir. Eksik/fazla/mükerrer ödeme, kısmi ödeme, iade ve ters ibraz durumlarını yönet. Eşleşmeyen kayıtlar için iş listesi üret. Para birimi ve kur farkını açıkça ele al. Otomatik eşleşmenin güven kurallarını tanımla; belirsiz kayıtları elle incelemeye bırak. Yaşlandırılmış alacak listesi ve firma finans zaman çizelgesi ekle.

**Gelecekteki kabul ölçütü adayı:** Aynı dış işlem ikinci ödeme yaratmaz. Kısmi ödeme bakiyeyi doğru bırakır. İade ilk ödeme ve faturaya bağlanır. Sağlayıcı kesintisi veya ters ibraz firmanın erişimini belgelenmemiş biçimde değiştirmez; erişim politikası açıkça uygulanır.

**Etkinleştirme koşulu:** Elle/sağlayıcı tahsilatlarının eşleştirilmesi mevcut ekranlarla sürdürülemez olduğunda.

**Yeniden kullanılacak bileşen:** KSB-06 ekstre içe aktarma/eşleştirme, KSB-16 denkleştirme, KSB-34 dijital PDF ekstre; `kasa-banka/ekstre.service.ts`, `ekstre-eslestirme.service.ts`, `ekstre-mutabakat.ts`, `fatura/denklestirme.ts`; PLT-20–23 abonelik fatura/tahsilat bağı. Kiracı mali kayıtlarına genel erişim açılmaz; faturalayan firma bağlamı korunur.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Fiyat, sözleşme ve mali dönem yönetimi — eski K17

**İhtiyaç doğarsa önerilen kapsam:** Fiyat/plan koşullarını yürürlük tarihli sürümlerle sakla. Sözleşme, yenileme, indirim, ücretsiz dönem ve ek süreyi gerekçeli/onaylı yönet. Fiyat değişikliğinin mevcut firmaya ne zaman uygulanacağını açıklaştır. Dönem kapanışı, kontrollü yeniden açma ve düzeltme kaydı akışı kur. Hatalı mali kayıt silinerek düzeltilmesin; özgün kayıt ve düzeltme ilişkisi korunsun. Muhasebe/vergi etkileri ilgili iş sahibi tarafından ayrıca doğrulansın.

**Gelecekteki kabul ölçütü adayı:** Geçmiş ödeme o tarihteki fiyat/sözleşme sürümüne bağlanır. Onaysız indirim uygulanamaz. Kapalı döneme sıradan kayıt yazılamaz. Düzeltme geçmişi ve bakiye etkisi yeniden üretilebilir.

**Etkinleştirme koşulu:** Müşteriye özel fiyat/sözleşme veya kapalı mali dönem düzeltme ihtiyacı doğduğunda.

**Yeniden kullanılacak bileşen:** Mevcut abonelik plan kataloğu, abonelik ödeme/fatura servisleri, dönem kapatma ve mali düzeltme akışları; ikinci muhasebe defteri kurulmaz.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Görev ve ekip iş yükü yönetimi — eski K18

**İhtiyaç doğarsa önerilen kapsam:** Mevcut görev merkezini destek, olay, firma, mutabakat ve onay kayıtlarına bağla. Alt görev/kontrol listesi, bağımlılık, izleyen kişi, ekip kuyruğu ve iş yükü görünümü ekle. Tarih hatırlatmalarını K11 üzerinden çalıştır. Durum değişimlerinde kapanış nedeni ve yeniden açma geçmişini koru. Kapsam/atama kurallarını rol değişikliği ve pasife alma sonrasında yeniden değerlendir; sahipsiz işleri ekip kuyruğuna taşı.

**Gelecekteki kabul ölçütü adayı:** Yetkisiz bağlı kayıt adı veya içeriği görev üzerinden sızmaz. Bağımlı görevler yanlışlıkla otomatik kapanmaz. Pasife alınan kullanıcıya ait açık işler görünür ve yeniden atanabilir. Mevcut sürüm kontrolü korunur.

**Etkinleştirme koşulu:** Mevcut görevlerin atama/izleme sınırları ekip işini aksattığında.

**Yeniden kullanılacak bileşen:** PLT-24 görev modeli, kapsam/atama kuralları, sürüm kontrolü, yönetim özeti ve mevcut görev arayüzü; yeni genel görev tablosu kurulmaz.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### SSO ve kurumsal kimlik sağlayıcısı — eski K19

**İhtiyaç doğarsa önerilen kapsam:** İlk hedef protokol olarak OIDC değerlendir; kurum gereksinimi varsa SAML kapsamını ayrıca kesinleştir. Davet/üyelik ve rol eşlemesini kontrollü yap. Sadece e-posta alan adıyla yetki verme. Hesap kapatma, sağlayıcı oturum süresi ve yerel oturum iptalini ilişkilendir. Sağlayıcı kesintisi için denetimli acil erişim yolu tanımla. SSO devreye girerken mevcut kullanıcı eşlemesini doğrula.

**Gelecekteki kabul ölçütü adayı:** Yanlış issuer/audience, tekrar kullanılan callback ve izinsiz rol eşlemesi reddedilir. Kurumdan ayrılan kullanıcı erişimini kaybeder. SSO yapılandırma hatası kontrolsüz yönetici hesabı yaratmaz.

**Etkinleştirme koşulu:** Somut müşteri/kurum sözleşmesi SSO gerektirdiğinde; SAML yalnız doğrulanmış gereksinimse.

**Yeniden kullanılacak bileşen:** Platform auth/oturum guard’ı ve oturum iptali; mevcut kullanıcı/davet kimlikleri eşlenir, paralel hesap dizini açılmaz.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Olay, alarm ve çalışma kılavuzları — eski K20

**İhtiyaç doğarsa önerilen kapsam:** Alarmı olay kaydına dönüştür; sorumlu, önem, etkilenen firmalar, başlangıç/tespit/çözüm zamanları, müdahale adımları ve iletişimi tut. Tekrarlanan alarmları ilişkilendir. Kök neden, olay sonrası değerlendirme ve önleyici görevler ekle. Planlı bakım sırasında alarm bastırmayı süreli ve gerekçeli yap. E-posta kesintisinde açılış ve düzelme bildirimlerini kalıcı teslimat kaydıyla yeniden dene. Birden çok API sürecinin aynı alarm için mükerrer olay/bildirim üretmesini önle.

**Gelecekteki kabul ölçütü adayı:** Aynı alarm tek açık olaya bağlanır. Düzelme e-postası ilk denemede başarısız olsa da kaybolmaz. Alarm kapatma neden ve aktörle izlenir. Planlı bakım süresi sonunda izleme otomatik geri açılır.

**Etkinleştirme koşulu:** Tekrarlayan olaylar veya birden çok müdahale sorumlusu düzenli olay yönetimini gerektirdiğinde.

**Yeniden kullanılacak bileşen:** PLT-17–19 sistem sağlığı, alarm kuralları, `sistemAlarmi`, worker nabzı, kuyruk yeniden deneme ve PLT-24 görevler.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Değişiklik, bakım ve kademeli yayın yönetimi — eski K21

**İhtiyaç doğarsa önerilen kapsam:** Değişiklik talebine sürüm, etki, risk, test kanıtı, bakım aralığı ve geri dönüş adımı ekle. Firma bazında özellik açma, pilot grubu, kademeli genişleme ve acil kapatma kur. Özellik bayraklarını süreli/sorumlulu tut; teknik bayrak adlarını müşteri ekranına taşıma. Mevzuat yayınıyla uygulama dağıtımının farklı süreçlerini koru; gerektiğinde ilişkilendir. Etkilenen firmalara bakım/olay bildirimleri sun.

**Gelecekteki kabul ölçütü adayı:** Pilot dışı firma özelliği API üzerinden de kullanamaz. Geri alma yeni mali etki veya veri kaybı üretmez. Şema değişikliğinde eski/yeni API-worker uyumluluğu doğrulanır. Geri döndürülemeyen migration için güvenli ileri düzeltme adımı vardır.

**Etkinleştirme koşulu:** Birden çok pilot/müşteri grubunda farklı yayın takvimi ve ölçülmüş geri dönüş ihtiyacı oluştuğunda.

**Yeniden kullanılacak bileşen:** Mevcut yayın/dağıtım araçları, modül ayarları ve pilot açılış düzeni. Mevzuat yayını ile uygulama dağıtımı farklı süreçler olarak korunur.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Veri yaşam döngüsü, arşiv ve firma kapatma — eski K22

**İhtiyaç doğarsa önerilen kapsam:** Veri sınıfları için saklama/arşiv/silme politikası tanımla. Firma dışa aktarma ve kapatma talebini kimlik, yetki, onay, süre ve kanıtla yönet. Aktif uyuşmazlık veya saklama engelini kontrol et. Gerektiğinde anonimleştirme kullan. Dışa aktarmayı süreli erişimli ve denetimli teslim et. Silmenin yedekler üzerindeki etkisini ve geri yükleme sonrasındaki tekrar uygulama sürecini tanımla. Hukuki saklama sürelerini varsayma; ilgili iş/hukuk sahibiyle kesinleştir.

**Gelecekteki kabul ölçütü adayı:** Yetkisiz kişi firma dışa aktarımı başlatamaz. Talep durumu ve teslimat izlenir. Saklama engeli olan kayıt silinmez. Test firmasının kapatma süreci tüm bağlı alanlarda doğrulanır; denetim kanıtı korunur.

**Etkinleştirme koşulu:** Veri dışa aktarma/kapatma talebi veya kesinleşmiş saklama yükümlülüğü oluştuğunda.

**Yeniden kullanılacak bileşen:** Mevcut dosya erişimi/dışa aktarma, denetim, firma ve saklama mekanizmaları; politikalar kesinleştirilmeden ikinci arşiv deposu kurulmaz.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Yedekleme ve geri yükleme güvencesi — eski K23

**İhtiyaç doğarsa önerilen kapsam:** Yedek sonucuyla gerçek geri yüklenebilirliği ayrı ölç. Veritabanı, dosyalar, gerekli şifreleme anahtarları, kuyruk/outbox ve yapılandırma bağımlılıklarını envanterle. İş sahipleriyle kabul edilebilir veri kaybı (RPO) ve geri dönüş süresi (RTO) hedeflerini belirle. İzole ortamda düzenli geri yükleme provası ve bütünlük kontrolü çalıştır. Geri yükleme ortamından gerçek e-posta/ödeme işlemi çıkmasını engelle. Sonucu platform olayına ve görevlerine bağla.

**Gelecekteki kabul ölçütü adayı:** Yedek başarılı görünse de geri yükleme provası başarısızsa durum sağlıklı gösterilmez. Ölçülen RPO/RTO raporlanır. Şifreli kayıtlar geri yükleme sonrası okunabilir; ödeme/outbox yeniden işleme mükerrer etki yaratmaz.

**Etkinleştirme koşulu:** Mevcut yedeklerin geri yüklenebilirlik kanıtı ve iş sahibi RPO/RTO hedefi gerektiğinde. Mevcut yedekleme yükümlülükleri bu adaya ertelenmez.

**Yeniden kullanılacak bileşen:** Mevcut yedekleme/geri yükleme iş akışı ve `Yedekleme-Geri-Yukleme.md`, sistem sağlığı ve görev kayıtları.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Yönetim raporları ve ölçüm sözlüğü — eski K24

**İhtiyaç doğarsa önerilen kapsam:** Aşağıdaki göstergelerin tanımını, kaynağını, saat dilimini, güncelleme sıklığını ve erişim iznini ortak sözlükte tut. Mevcut duruma ek olarak geçmiş eğilim ve dönem karşılaştırması göster. Her karttan filtreli kaynak listeye geçilsin. Eksik/kısmi/eski veri başarı veya sıfır olarak sunulmasın.

| Alan | Göstergeler |
|---|---|
| Firma | Yeni kayıt, denemeden ücretliye geçiş, kurulum tamamlanması, ayrılma nedeni |
| Finans | Tahsilat, yaşlandırılmış alacak, yenileme başarısı, iade, eşleşmeyen ödeme |
| Destek | İlk yanıt/çözüm süresi, hedef aşımı, yeniden açılma, memnuniyet |
| Operasyon | Açık olay, çözüm süresi, tekrar eden hata, kuyruk bekleme süresi |
| Mevzuat | Onay bekleme, yaklaşan yürürlük, eksik dönem, kabul senaryosu sonucu |
| Yapay zekâ | Firma bazında maliyet, kullanım, bütçe/tavan aşımı, sağlayıcı hataları |

Gelir, tahsilat ve fatura tutarları ayrı tanımlansın; farklı para birimleri doğrudan toplanmasın. AI kullanımının tahmini/kesin maliyet ayrımı korunsun.

**Gelecekteki kabul ölçütü adayı:** Kart toplamı yetkili filtreli listeyle uzlaşır. Tarih sınırı ve para birimi dönüşümleri tekrarlanabilir. Veri kaynağı kesintisi görünürdür. Finans verileri izinsiz rollere rapor üzerinden açılmaz.

**Etkinleştirme koşulu:** Karar almak için belirli bir göstergeye ve güvenilir veri kaynağına ihtiyaç doğduğunda.

**Yeniden kullanılacak bileşen:** Mevcut `/platform/ozet`, rapor servisleri, firma/ödeme/AI özet fonksiyonları ve observability metrikleri; yeni raporlama deposu ihtiyaç ölçülmeden kurulmaz.

**Durum:** Değerlendirme adayı; takvime alınmadı.

### Acil erişim ve güvenlik operasyonu — eski K25

**İhtiyaç doğarsa önerilen kapsam:** SSO veya normal yönetici erişimi kesildiğinde kullanılacak acil erişim hesabı/süreci tanımla. Süre, kapsam, gerekçe, sorumlu, güçlü doğrulama ve anlık bildirim zorunlu olsun. Kullanım sonrası inceleme ve kimlik bilgisi yenileme görevi açılsın. Yetki/oturum/IP kısıtı değişikliklerinin toplu anormallik görünümünü ekle. Acil erişim, denetim kaydını atlayamasın.

**Gelecekteki kabul ölçütü adayı:** Süresi dolan acil erişim otomatik kapanır. Her kullanım görünür ve gözden geçirilebilir. Normal erişim kaybı güvenliği kapatan genel bir geçiş yoluna dönüşmez.

**Etkinleştirme koşulu:** SSO/IP kısıtı nedeniyle normal erişim kesintisi için kontrollü acil erişim gerektiğinde.

**Yeniden kullanılacak bileşen:** Mevcut platform kimlik/2FA/oturum iptali, denetim, BLD ve operasyon prosedürleri; denetimi atlayan genel erişim yolu eklenmez.

**Durum:** Değerlendirme adayı; takvime alınmadı.

## 4. Koşullu mimari düzenleme — eski K12’nin taşıma kısmı

**Öneri:** Platform sorumluluklarını mevzuat klasöründen ayırma ancak mevcut yapının bakım, bağımlılık veya test maliyeti somut olarak gösterilirse yapılır. İşlev geliştirmesinin ön koşulu değildir; büyük klasör taşıma P1’den çıkarılmıştır. API yolları ve veritabanı güvenlik sınırları korunur.

**Etkinleştirme koşulu:** Tekrarlanan modüller arası değişiklik maliyeti, döngüsel bağımlılık veya ölçülmüş test/dağıtım sorunu.

**Yeniden kullanılacak bileşen:** Mevcut mevzuat, abonelik-ödeme, sistem-sagligi modülleri ve platform servisleri; iş mantığı kopyalanmaz.

**Gelecekteki kabul ölçütü adayı:** Davranış/rota/yetki regresyonları geçer ve taşımanın beklenen bakım faydası ölçülür.

**Durum:** Gerekirse değerlendirilecek; P3 ölçeği adayı, tarih/taahhüt yok.

## 5. Yeniden kullanım ve sınırlar

- KLN-20’nin izin kavramları ve test yaklaşımı paylaşılabilir; tenant özel rol tabloları platform personelinin rol deposu hâline getirilmez.
- BLD/worker genişletilir; ikinci genel bildirim merkezi kurulmaz. Outbox ancak mevcut kalıcı teslimat yaklaşımında kanıtlanmış açık varsa bildirim adayının içinde tasarlanır; PLT-27’ye geri bağımlılık eklenmez.
- KSB-06/16/34 ve PLT-20–23 üzerinden finans bağlantısı kurulur; ikinci ekstre, kapama veya muhasebe motoru kurulmaz.
- Mevcut mevzuat talepleri (MVZ), müşteri destek biletleriyle aynı iş nesnesi değildir. Ayrı destek akışı gerekirse mevcut görev/bildirim/dosya altyapısı kullanılır; mevzuat talebine dönüşüm veya bağlantı açıkça tanımlanır.
- Mevzuat dört göz onayı ve AI isteyen-kullanıcı onayı farklı politikalardır; ortak teknik yardımcı paylaşımı bu iş kurallarını birleştirmez.

## 6. Bir adayı istere dönüştürme kaydı

Her aday için şu kararlar yazılmadan geliştirme başlamaz:

1. Gerçek ihtiyacın örneği, hacmi, iş sahibi ve ölçülebilir kazanım.
2. Mevcut bileşenlerde karşılanan ve eksik kalan bölüm.
3. En küçük teslim kapsamı, kapsam dışı ve mevcut sürümlerle uyum.
4. Rol/kayıt görünürlüğü, veri modeli, migration ve API etkisi.
5. Gerçekçi bağımlılıklar; eski K sırası otomatik bağımlılık sayılmaz.
6. Test, pilot, yayın ve geri dönüş kriterleri.
7. ISTERLER içinde sıradaki PLT numarası ve S-01 kapsam gözden geçirme sonucu.

SSO/SAML, SLA takvimleri, genel onay merkezi, özellik bayrakları ve acil erişim hesabı topluca onaylanmış sayılmaz. Veri saklama politikaları ve RPO/RTO hedefleri iş sahipleriyle ayrıca kesinleştirilir. Mevcut güvenlik/yedekleme sorumlulukları yol haritasında aday bulunuyor diye ertelenmez.
