# F02 — TEKİR EKTRA ÖN MUHASEBE pilot başlangıç kaydı

## 19 Ekim 2026 — yerel manuel pilot teknik yayını

Kullanıcı pilot/yayına dönmeyi ve `localhost:3100` hedefini seçti. [Yeni adayın yerel geçiş kaydı](LOCALHOST-PILOT-YAYIN-2026-10-19.md) güncel durumu içerir. API/web yeni sabit paketten sağlıklı çalışıyor. Gerçek yedeğin 208 tablo özet eşitliği ve yeni migration provası başarılı; iki iade migration'ı yerel hedefe uygulandı. Güncel ayarlar eski kayıttan farklı: pilot modu yanında otomasyon ve uygulama içi bildirim açık. Bu ayarlar değiştirilmedi; worker çalıştırılmadı. Şirkette 565 cari, 189 fatura, 2 söz ve 2 takip var; geçiş öncesi/sonrası sayılar aynı. Gerçek kullanıcı oturumu, doğal örnek ve alan kabulü henüz yapılmadı. Aşağıdaki tarihsel kayıtlar 16–17 Ekim gözlemleridir.

16 Ekim 2026. Şirket, sorumlu hesap ve localhost ortamı kullanıcı tarafından seçildi. Salt okunur ekran kullanıcı tarafından teyit edildi ve F02 yerel şirkette manuel pilot moduna alındı. Doğal iş örnekleriyle pilot kabulü henüz yapılmadı.

| Alan | Doğrulanan değer |
| --- | --- |
| Şirket | TEKİR EKTRA ÖN MUHASEBE |
| Tenant ID | `66d60ea8-0a3e-44e1-8f87-be3ddb65fc18` |
| Sorumlu hesap | `admin@tekirextra.local` |
| Kullanıcı ID | `81e03301-c977-4dc1-b7b6-e5be3e09574a` |
| Hesabın durumu | Aktif; `yonetici`; seçilen şirkete bağlı; e-posta için tek eşleşme |
| İncelenen veritabanı | Yerel `tekirextra-postgres-1`, DB `tekirextra` |
| Hedef pilot ortamı | Kullanıcı tarafından seçilen yerel `http://localhost:3100` |
| Alan kabulünü verecek kişi | Henüz belirtilmedi |
| İnceleme zamanı | 16 Ekim 2026, yaklaşık 09:56 TRT |
| Güncel yerel aday | `f02-20261016T070519121Z-c0319aa2` (dördüncü aday) |

İlk incelemede üçüncü adayın, son açılışta ise [hazırlık belgesindeki](F02-PILOT-VE-YAYIN-HAZIRLIGI-2026-10-16.md) dördüncü adayın kaynak ve dosya özetleri doğrulandı. Yerel API `/health` isteği `durum: ok`, web `/` isteği 200 döndü. Web üzerinden `/api/v1/cari/tahsilat-takipleri` oturumsuz isteği 401 ile reddedildi. Bunlar oturum açma veya yetkili tenant HTTP testi değildir. `/api/v1/health` yolunun 404 dönmesi ayrı `/health` endpointiyle karıştırılmaz.

Çalışan API/worker komutları depo kökündeki `apps/api/dist/main.js` ve `apps/api/dist/main.worker.js`; web çalışma dizini `apps/web`. Diskteki 478 derlenmiş API JavaScript dosyası üçüncü adayla kaynak haritası referans satırları hariç eşit. Bu dosya karşılaştırması süreçte önceden yüklenmiş bütün modüllerin özeti değildir. Mevcut web BUILD_ID `jCQMwpNSqR8RZuvXvzBJO`; üçüncü adayın web BUILD_ID'sinden farklı. Bu nedenle 17 aday tarayıcı testinin çalışan web'i doğruladığı ileri sürülmez; yerel web ekran kabulü ayrıca gereklidir.

## Salt okunur veritabanı başlangıcı

Kimlik/şema kontrolleri `BEGIN READ ONLY` içinde yapıldı. Aşağıdaki hacim sayımları aynı zamanda `SET LOCAL ROLE tekir_app` ve seçilmiş `app.tenant_id` kapsamında alındı. Veri veya ayar yazılmadı.

| Tablo | Seçilmiş şirkette kayıt |
| --- | ---: |
| Cari hesaplar | 564 |
| Faturalar | 185 |
| Ödeme sözleri | 0 |
| Tahsilat takipleri | 0 |
| Tahsilat görüşmeleri | 0 |
| Söz/takip bağları | 0 |

564 cari, otomasyonun bir turdaki 100 cari sınırının üstündedir; bu sayı uygun gecikmiş sözü olan cari sayısı değildir. Mevcut söz sayısı sıfır olduğundan otomasyonun gerçek hacim/süre kabulü bu sayımlardan çıkarılmaz. Cari ve fatura adetleri test verisi ayrımı veya tutar uzlaştırması içermez.

Başlangıçta `tahsilat_operasyonu` ve `tahsilat_otomasyonu` için bu şirkete ait ayar kaydı yoktu. Kaynak varsayılanları sırasıyla `mod: kapali` ve `acik: false, uygulamaIciBildirim: false, sorumluUserId: null`. Operasyon modu önce `salt_okunur`, kullanıcı teyidinden sonra `pilot` yapıldı. Seçilen sorumlu otomasyona atanmadı; otomasyon kaydı eklenmedi.

İncelenen DB'de şu migration kayıtları tamamlanmış ve geri alınmamış görünüyor; bu oturum bunları uygulamadı:

- `20261015100000_odeme_sozleri`
- `20261015110000_tahsilat_takibi`
- `20261016100000_geciken_soz_takibi`
- `20261016110000_arama_geri_yukleme`

Dört F02 tablosunda RLS ve FORCE RLS açık. `tekir_app` superuser değil ve BYPASSRLS yetkisi yok. Arama normalleştirme fonksiyonunun `public.unaccent` ve `public.unaccent` sözlüğünü açık şemayla kullandığı katalogdan doğrulandı. Bunlar katalog gözlemleridir; tüm migration dosyalarının checksum karşılaştırması veya çalışan API'nin bağlantı rolü doğrulaması değildir.

## Sonraki uygulama kaydı

### Yerel yedekte bulunan yetki eksikliği

İlk güncel yedek `backups/f02-pilot/tekirextra-20261016T065814Z.sql.gz`, mevcut betiğin `--no-privileges` seçeneği yüzünden GRANT kayıtlarını taşımıyordu. Ağ erişimi ve host portu olmayan ayrı PostgreSQL'e veri yüklemesi tamamlandı, ancak `tekir_app` ile cari tablosunu okuma kontrolü yetki hatası verdi. Geçici konteyner silindi; bu yedek pilot geri yükleme kabulünü geçmedi.

`scripts/backup-postgres.sh` içinden `--no-privileges` çıkarıldı; `--no-owner` korundu. Yeni boş ortamda `tekir_app`/`tekir_platform` rollerinin yedek yüklenmeden önce kurulması gerekir. Bu rollerin kimlik bilgileri yedekte yer almaz. Yeni yedek `backups/f02-pilot/tekirextra-20261016T070413Z.sql.gz`; gzip bütünlük kontrolü geçti.

Yeni yedeğin derlemeyle aynı anda yapılan ilk geri yükleme denemesi yerel kaynak yoğunluğunda süre sınırına takıldı; [başarısız deneme raporu](../.release-candidates/f02-pilot-20261016-4/tekir-yerel-yedek-prova-zaman-asimi.json) korunuyor. Derleme bittikten sonra tek başına tekrarlandı: **10:35 TRT'de tam SQL geri yükleme ve uygulama rolüyle şirket sayımları geçti**. 564 cari, 185 fatura, sıfır söz/takip doğrulandı; geçici konteyner silindi. [Başarılı yerel yedek raporu](../.release-candidates/f02-pilot-20261016-4/tekir-yerel-yedek-prova.json). Bu prova bütün tabloların içerik özetlerini karşılaştırmaz; tam SQL yüklemesinin hatasız bitişini ve seçilmiş şirkete uygulama rolüyle erişimi kanıtlar. Gerçek veritabanına geri yükleme yapılmadı.

### Salt okunur açılış sonucu

Dördüncü adayın API/web derlemeleri ve 90 API + 17 standalone tarayıcı testi geçti. Geçici kabul DB'sinde migration tekrarı ve 14 tablo için sentetik yedek/geri yükleme eşitliği ayrıca başarılı.

**10:49 TRT'de** yalnız tenant `66d60ea8-0a3e-44e1-8f87-be3ddb65fc18` için `tahsilat_operasyonu = {surum: 1, mod: salt_okunur}` kaydedildi. İşlem, seçilmiş yönetici bağlamında `tekir_app` bağlantısıyla adayın `AyarlarService.guncelle` servisini çağıran açık bakım betiğinden yürütüldü; kullanıcı parolası kullanılmadı ve HTTP oturumu taklit edilmedi. Denetim kaydı: `9d297e67-1b55-4adf-9283-10cb87e10cb9`, işlem `tahsilat_modu_guncellendi`.

Adayın gerçek `TahsilatTakibiService` sınıfı aynı DB'de `salt_okunur` mod ve sıfır takip döndürdü. Yazma erişim kontrolü 403 ile reddedildi; söz/takip/görüşme/bağ sayıları sıfır kaldı. Otomasyon ve uygulama içi bildirim ayarları değişmedi; ikisi de kapalı. Mali kayıt, migration veya çalışan servis değişikliği yapılmadı. [Açılış, önceki durum ve yedek SHA-256 raporu](../.release-candidates/f02-pilot-20261016-4/tekir-pilot-salt-okunur.json); [uygulanan bakım betiği](../.release-candidates/f02-pilot-20261016-4/pilot-salt-okunur.cjs).

Kullanıcı, `admin@tekirextra.local` ile [Tahsilat İş Listesi](http://localhost:3100/panel/cari/tahsilat) ekranında salt okunur mod ve boş listenin görülmesi sorusuna **“teyit ediyorum”** yanıtını verdi. Salt okunur ekran kabulü kullanıcı beyanıyla tamamlandı. Bu teyit, doğal iş örneklerinin veya bütün F02 paketinin kabulü değildir. Sonraki manuel açılış aşağıda kaydedildi; otomasyon/bildirim adımları [runbook](F02-PILOT-VE-YAYIN-HAZIRLIGI-2026-10-16.md) sırasıyla ayrı yürütülecek. Gerçek veride sahte ödeme/fatura veya geçmiş tarihli söz üretilmeyecek.

### Çalışan web'in masaüstü ve mobil kontrolü

**11:03 TRT'de** mevcut `localhost:3100` web'inin `jCQMwpNSqR8RZuvXvzBJO` build'i ayrı Chromium oturumlarında kontrol edildi. Adayın kaynak/çıktı kimliği kontrol başlangıcında tekrar doğrulandı. Üç senaryo geçti:

- Gerçek anonim HTTP akışında korumalı sayfa giriş ekranına yönleniyor.
- 1440×1000 masaüstü görünümünde salt okunur mod/boş liste, bugün–itiraz–tümü filtreleri, yalnız bana atananlar ve yenileme çalışıyor.
- 390×844 mobil görünümde aynı kontroller geçiyor; yatay taşma veya JavaScript hatası yok.

Masaüstü/mobil senaryoları gerçek kullanıcı girişi yapmaz. Kimlik ve yardımcı API yanıtları tarayıcıda fixture olarak karşılanır; takip liste okumaları seçilmiş yönetici bakım bağlamında adayın `TahsilatTakibiService` sınıfıyla **mevcut yerel DB'den** alınır. Tarayıcının bütün API istekleri yakalanır; yazma istekleri engellenir ve bu senaryolarda hiçbir yazma isteği oluşmadı. Test sonunda gerçek DB modu hâlâ `salt_okunur`. Bu teknik görüntüleme kanıtı, gerçek admin oturumundaki uçtan uca ekran kabulünün yerine geçmez.

[Kontrol betiği](../.release-candidates/f02-pilot-20261016-4/pilot-ekran-kontrol.cjs), [sonuç raporu](../.release-candidates/f02-pilot-20261016-4/tekir-pilot-ekran-kontrol.json), [masaüstü görüntüsü](../.release-candidates/f02-pilot-20261016-4/tekir-pilot-masaustu.png), [mobil görüntüsü](../.release-candidates/f02-pilot-20261016-4/tekir-pilot-mobil.png). Görüntüler fixture/bakım okuması senaryosuna aittir; gerçek admin tarayıcı oturumu değildir.

### Kullanıcı teyidi sonrası manuel pilot açılışı

**11:41 TRT'de** seçilmiş yerel şirkette operasyon ayarı `salt_okunur → pilot` yapıldı. İşlem, adayın kimliği ve mevcut kabul/yedek raporları tekrar doğrulandıktan sonra `tekir_app` bağlantısıyla `AyarlarService.guncelle` üzerinden yürütüldü. Kullanıcının ekran teyidi, önceki ayar/sayımlar ve sonraki sonuç [manuel açılış raporunda](../.release-candidates/f02-pilot-20261016-4/tekir-manuel-pilot-acilis.json) saklanır. [Uygulanan betik](../.release-candidates/f02-pilot-20261016-4/pilot-manuel-acilis.cjs).

- Yeni denetim kaydı: `ffae4a0c-70a8-4fc0-a6e1-490ec78415c3`, işlem `tahsilat_modu_guncellendi`, mod `pilot`.
- Seçilmiş yöneticinin servis yazma erişim kontrolü `pilot` döndü; iş kaydı oluşturarak denenmedi.
- Gerçek takip listesi `pilot` modunda okunuyor ve sıfır takip içeriyor.
- Manuel sorumlu listesinde seçilen aktif yönetici mevcut; varsayılan kullanıcı `81e03301-c977-4dc1-b7b6-e5be3e09574a` (`admin@tekirextra.local`). Bu doğrulama otomasyon sorumlusu atamaz.
- Söz/takip/görüşme/bağ sayıları önce ve sonra sıfır; otomasyon ve uygulama içi bildirim hâlâ kapalı. E-posta veya müşteri iletişimi başlatılmadı.

İlk doğal pilot örneği için gerçek cari ve görüşme bilgisi gerekir. Cari detayının **Tahsilat** sekmesinde gerçek takip konusu, sorumlu, sonraki işlem günü ve işlem açıklamasıyla manuel takip kaydedilebilir. Ödeme sözü ancak müşterinin gerçekten verdiği fatura, döviz, tutar ve tarih bilgisiyle girilir. Kullanıcı ilk gerçek takip kaydı adımını **şimdilik atlamayı** istedi; doğal örnek ve buna bağlı alan kabulü ertelendi. Bu karar pilotun tamamlandığı anlamına gelmez. Kayıt üretilmedi veya şirket ayarı değiştirilmedi; manuel pilot açık, otomasyon/bildirimler kapalı kaldı. Doğal örneğin oluşturulması, tekrar okuması ve alan kabulü daha sonra ayrı kaydedilecek.

Özelliği kapatma gerektiğinde aynı yetkili uygulama servisi/UI üzerinden operasyon modu `kapali` yapılır; bu da ayrı bir denetim kaydı oluşturur. Geçmiş/audit silinmez; DB yedeği sırf bu ayar için geri yüklenmez.

### Gerçek kayıt ertelenmişken teknik kapasite kontrolü

[12 ek sınır/kapasite kontrolü](F02-KAPASITE-VE-SINIR-PROVASI-2026-10-16.md) aynı derlenmiş adayla ayrı ve nonce korumalı PostgreSQL'de geçti. Gerçek şirket bağlantısı/ayarı kullanılmadı; manuel pilot açık ve otomasyon/bildirimler kapalı kaldı. 1.000/5.000 kayıt ve 100 cari sınırları, aşımda kısmi sonuç üretmeme, worker tekrar tekilliği ve transaction timeout rollback kanıtı var. Doğal iş örneği, alan kabulü ve gerçek üretim kapasitesi yerine geçmez.

### Gerçek kayıt ertelenmişken kapatma/yeniden açma kontrolü

[8 ek kontrol](F02-KAPATMA-VE-GERI-ACMA-PROVASI-2026-10-16.md) ayrı geçici PostgreSQL'de geçti. Özellik kapatma/yeniden açmada geçmiş, bağlar ve finans kaynakları korundu; bildirim/bağ çoğalmadı. Önceki hatırlatma bileşeninde itiraz korumasının bulunmadığı karşılaştırmayla doğrulandı. Gerçek şirketin modu, otomasyonu, kayıtları ve çalışan servisleri değiştirilmedi. Tam eski dağıtım paketiyle geri dönüş ve doğal pilot kabulü tamamlanmadı.

### Yerel eski tam imaj araştırması

[20 Eylül API/worker/web üçlüsü](F02-ESKI-IMAJ-UYUMU-VE-BAGIMLILIK-ENVANTERI-2026-10-16.md) ayrı ve dış erişimi kapalı test ağında güncel şemayla sınandı. Giriş/cari okuması çalıştı; fatura detayı 500 ve aynı origin web proxy isteği 404 verdi. Üçlü geri dönüşe uygun değil. Prova gerçek kullanıcı yerine sentetik kullanıcı kullandı; gerçek şirkette servis, veri veya ayar değişikliği yapılmadı. Host bağımlılık envanteri ayrıca alındı; tam eski sürüm ve temiz dağıtım kurulumu kapıları açık kaldı.

| Kabul alanı | Durum |
| --- | --- |
| Şirket / sorumlu kimliği | Doğrulandı |
| Yerel şema / başlangıç hacmi | Salt okunur incelendi |
| Hedef ortam / çalışan aday sürümleri | Localhost seçildi; API disk dosyaları karşılaştırıldı; mevcut web'de üç teknik kontrol geçti; salt okunur ekran kullanıcı tarafından teyit edildi |
| İlgili ortamın yedeği / geri yükleme kanıtı | Yerel tam yedek, gzip kontrolü ve ayrı PostgreSQL'e geri yükleme geçti |
| Salt okunur özellik açılışı / ekran karşılaştırması | Tamamlandı; servis/teknik ekran kontrolleri ve kullanıcı teyidi var |
| Manuel pilot / doğal iş örnekleri / alan kabulü | Manuel mod açık; erişim/sorumlu doğrulandı; ilk gerçek takip ve buna bağlı alan kabulü kullanıcı isteğiyle şimdilik ertelendi |
| Otomasyon / uygulama içi bildirim | Açılmadı |
| Canlı yayın / yayın sonrası kabul | Yapılmadı |

### Ayrı bağımlılık paketi ve tam başlangıç provası

Sonraki [yedinci kaynak adayının](F02-GUNCEL-KAYNAK-ADAYI-2026-10-16.md) 140 yerel kontrolü geçti. Bunlar sentetik/geçici kabul ve PDF çıktılarıdır; gerçek şirket pilotu değildir. Yeni adayın dosyaları çalışan API/web/worker üzerine yazılmadı; gerçek ayar/iş kaydı değişikliği yapılmadı. İlk doğal kayıt ve alan kabulü ertelenmiş durumda kalır. Yedinci adayın yeni runtime kabulü ve çalışma alanındaki sonraki değişiklikler ayrıca ele alınmalıdır.

Sonraki [gerçek tarayıcı/web/API/worker provasında](F02-TAM-AKIS-TARAYICI-PROVASI-2026-10-16.md) sabit adayın 14 kontrolü geçti. Sentetik kullanıcı gerçek formdan giriş yaptı, görüşme ekledi ve yenileme sonrası geçmiş/API kayıt sayısı doğrulandı; salt okunur masaüstü/mobil kontrolleri geçti. Geçici ortam temizlendi. Gerçek şirkette kayıt/ayar/servis değişikliği yapılmadı; ertelenen doğal kayıt ve alan kabulü bekliyor. Çalışma alanındaki yeni belge dili/PDF/şema değişiklikleri ayrıca adaylaştırılmalıdır.

[API/worker runtime paketi](F02-API-WORKER-RUNTIME-PAKETI-2026-10-16.md) ayrı dizinde oluşturuldu. Node 22 altında 11 kontrol; gerçek parolalı sentetik kullanıcı girişi, takip/söz/nakit işlemleri ve tam worker'ın geciken sözü bağlaması dahil geçti. Geçici PostgreSQL/Redis/depo ve test ağı temizlendi. Gerçek şirketin manuel pilot ayarı, otomasyon/bildirim kapalılığı ve ertelenmiş doğal kayıt kararı korunuyor; çalışan servisler değiştirilmedi.

## 17 Ekim 2026 — yedinci adayın ek teknik kabulü

[17 Ekim yedinci aday runtime kabulü](F02-YEDINCI-ADAY-RUNTIME-KABULU-2026-10-17.md) tamamlandı: 11 Node 22 API/worker, 1 gerçek PDF ve 14 gerçek web/API/worker akışı kontrolü geçti. Geçici ortamlar temizlendi; önceki 140 kontrolün kanıtları değişmedi. Bu sonuç yedinci aday kimliğine aittir; yeni runtime/tam akış kabulü gerektiren önceki açık madde bu aday için kapanmıştır. Sonradan değişen çalışma alanı kaynakları, doğal pilot/alan kabulü, üretim kapasitesi, uygun eski sürüme dönüş ve canlı yayın kapsam dışındadır. Gerçek şirket verileri, ayarlar ve çalışan servisler değiştirilmedi.

## 17 Ekim 2026 — güncel kaynakların dokuzuncu aday kabulü

[Güncel belge/PDF adayında](F02-DOKUZUNCU-ADAY-KABULU-2026-10-17.md) 29 dosya farkı kaynak kimliğine alındı; kaşe yüklemesinin API yolu ve eski görseli erken silme hatası giderildi. Son aday `f02-20261017T052606307Z-fixture9`; 214 yerel teknik kontrol geçti. Güncel çalışma alanı kaynak özeti eşleşti, geçici ortamlar temizlendi. Gerçek şirket verileri/ayarları ve çalışan servisler değiştirilmedi. Sonradan değişen kaynakların ayrıca kabulü maddesi bu kaynak kimliği için kapandı; gerçek doğal pilot/alan kabulü, üretim kapasitesi, uygun eski sürüme dönüş, hedef ortam kurulumu ve canlı yayın açık kalır.

## 17 Ekim 2026 — pilot ve yayın tekrar ertelendi

Kullanıcı gerçek pilot kabulünü ve canlıya geçişi daha sonra ele almayı, varsa sonraki faza geçmeyi istedi. Hedef/gerçek görüşme bilgisi bekleyen geçiş ön kontrolü ertelendi; canlıya geçiş işlemi yapılmadı. Geliştirme [F03 fırsat–teklif bağlarının ilk diliminde](F03-FIRSAT-TEKLIF-BAGLARI-2026-10-17.md) devam etti. Bu karar gerçek şirket ayarını veya iş kayıtlarını değiştirmez.
