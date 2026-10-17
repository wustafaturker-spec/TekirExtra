# F02 — Yerel yayın adayı ve gerçek pilot hazırlığı

16 Ekim 2026. Bu kayıt yerel aday, JWT/HTTP/RLS provası ve sentetik yedek/geri yükleme kanıtını toplar. Kullanıcının seçtiği localhost şirketinin güncel yedeği ayrıca geri yükleme provasını geçti. Salt okunur ekranın kullanıcı teyidinden sonra manuel pilot modu açıldı; ayrıntılar şirket pilot kaydındadır. Doğal iş örnekleriyle pilot kabulü ve canlı yayın tamamlanmadı.

## Aday kimliği

**Sonraki aday:** [Güncel kaynak kopyasından hazırlanan yedinci aday](F02-GUNCEL-KAYNAK-ADAYI-2026-10-16.md), ID `f02-20261016T192044389Z-1a2c15ca`. Bu adayın 90 API/veritabanı, 17 fixture tarayıcı, 27 PDF birim ve 6 gerçek PDF kontrolü geçti; migration tekrarı ve 14 tablo dump/restore eşitliği başarılı. Aşağıdaki dördüncü aday kaydı tarihsel kanıttır; kimlikler ve kabul sonuçları birbirine karıştırılmaz. Yeni adayın üretim bağımlılığı/Node 22 tam runtime kabulü ayrıca gerekir. Derleme sırasında çalışma alanına eklenen 15 sonraki dosya yedinci adaya dahil değildir.

Araç: `scripts/f02-yayin-adayi.mjs`. API'yi çalışan `apps/api/dist` dizinine dokunmadan ayrı aday dizinine derler. Web'i ayrı Next dizininde üretir, standalone sunucu/bağımlılık/static/public dosyalarını adaya kopyalar. `.env` dosyaları kopyalanmaz. Lockfile ve kaynak/çıktı dosyaları SHA-256 ile kaydedilir; derleme boyunca kaynak değişirse aday başarısızdır. Var olan adayın üzerine yazılmaz. Kaynak ve dosya özeti `scripts/f02-aday-dogrula.mjs` ile tekrar doğrulanır; yeni/eksilmiş dosyalar da özeti değiştirir.

İlk hazırlık adayı, kabul testi derleme sırasında düzeltildiği için kaynak tutarlılığı kontrolünde reddedildi. İkinci adayın 89 API ve 17 standalone Chromium testi geçti; yedek geri yükleme provası aksansız arama fonksiyonunun boş `search_path` altında çözümlenemediğini bulduğu için yayın provası başarısızdır. İkisi de yayın adayı olarak kullanılmaz. Düzeltmeyi taşıyan üçüncü adayın yerel provası geçti. Seçilmiş şirketin yerel yedek provası ayrıca yedek betiğinin GRANT kayıtlarını dışarıda bıraktığını buldu; `--no-privileges` kaldırıldı. Bu kaynak değişikliğini taşıyan dördüncü aday ayrı derlendi.

| Kimlik | Değer |
| --- | --- |
| Dizin | `.release-candidates/f02-pilot-20261016-4` |
| Aday ID | `f02-20261016T070519121Z-c0319aa2` |
| Kaynak SHA-256 | `70a4f6d6411b76864941d9bdd753174330a50d581fda3c7eae7afda4b2a63e95` |
| Dosya SHA-256 | `6e2637c9b7feb85ce4e40cc4a5f3971ce13d375d48c09fe6bb37f4b575bd237c` |
| Web BUILD_ID | `qOC2BEKveb5K46ZC9XeXN` |

API TypeScript ve web üretim derlemeleri başarılı. Dördüncü adayda 82 kaynak kabul testi ve adayın derlenmiş sınıflarını kullanan 8 JWT/HTTP/RLS testi, toplam 90 API testi geçti. Bunlara 17 standalone Chromium senaryosu eklenince bu provada **107 ayrı test** geçti; önceki koşumlar bu toplama tekrar eklenmez. Tarayıcı senaryoları API fixture'ları kullanır; canlı API ile uçtan uca oturum açma kanıtı değildir. Üçüncü web paketindeki 23 sembolik bağlantının tamamı geçerli ve paket içindeydi.

[Aday kabul raporu](../.release-candidates/f02-pilot-20261016-4/f02-kabul.json), migration tekrarını ve sentetik yedeğin ayrı boş veritabanına geri yüklenmesini başarılı kaydetti. 14 tablonun satır sayısı ve tam satır özetleri eşit; geçici iki DB koşum sonunda silindi. Boş `search_path` altında NULL ve Türkçe aksan katlaması da yeni kabul testiyle doğrulandı. Seçilmiş yerel şirketin gerçek yedeği ayrıca [uygulama rolüyle geri yükleme kontrolünü](../.release-candidates/f02-pilot-20261016-4/tekir-yerel-yedek-prova.json) geçti.

Geri yükleme hatası `20261016110000_arama_geri_yukleme` ek migration'ıyla düzeltilir. Eski migration'lar değiştirilmez. `tekir_arama_normal` fonksiyonunun `unaccent` çağrısı ve sözlük parametresi açık `public` şemasıyla çözülür; NULL/aksan katlama anlamı ve mevcut STORED kolonlar korunur. Sözlük parametresinin türü için [PostgreSQL 16 unaccent belgesi](https://www.postgresql.org/docs/16/unaccent.html) esas alındı. Ayrıca mevcut `restore-postgres.sh`, `psql -v ON_ERROR_STOP=1` kullanacak şekilde düzeltildi; SQL hatasında başarı mesajıyla bitmez. Sahte taşıyıcıyla exit 42'nin korunduğu doğrulandı; canlı restore betiği çalıştırılmadı. Prova aracı `pg_restore --exit-on-error` kullanır; bu seçenek ilk hatada çıkar. [PostgreSQL 16 pg_restore belgesi](https://www.postgresql.org/docs/16/app-pgrestore.html).

`manifest.json` durumu yalnız `yerel_aday`dır; dağıtım onayı veya gerçek pilot kabulü değildir. API dosyaları Node bağımlılıklarını tek başına paketlemez: aynı lockfile, workspace `shared/baglanti` derlemeleri, üretilmiş Prisma istemcisi ve üretim Node bağımlılıkları gerekir. Bu nedenle klasörü kopyalamak tek başına kurulumsuz API dağıtımı değildir. Web standalone dosyaları ayrıca kendi sunucusuyla sınanır. Aday yerel diskte kalır; kurumun uzak yedek/dağıtım saklama politikası yerine geçmez.

## Prova kapsamı

**Sonraki tam akış kanıtı:** [Gerçek form girişli web/API/worker provasında](F02-TAM-AKIS-TARAYICI-PROVASI-2026-10-16.md) sabit dördüncü adayla 14 kontrol geçti; bunların 3'ü API taklidi/token enjeksiyonu kullanmayan tarayıcı senaryosudur. Görüşme ekleme POST 201, yenileme ve API'de kayıt sayısıyla doğrulandı; masaüstü/mobil salt okunur sınırları geçti. Aday dosyaları korundu, test kaynakları temizlendi. Bu sonraki kanıt yukarıdaki 17 fixture senaryosunun kapsamını değiştirmez. Çalışma alanı bu sırada belge dili/PDF/şema alanında değişti; sabit adayın güncel kaynağa eşitliği artık geçerli değildir. Güncel kaynakları yayımlamak için ayrı aday üretilmelidir.

`--f02-yayin` koşumu her seferinde boş, nonce ile doğrulanan geçici PostgreSQL açar. Bütün migration'ları uygular ve aynı komutu ikinci kez çalıştırır. Mevcut kaynak kabul paketinin yanında adayın gerçek derlenmiş controller/servis/worker sınıfları ve AuthGuard/RollerGuard'ı çalışır. Kimlik middleware ile uydurulmaz; middleware yalnız boş AsyncLocalStorage tutucusu kurar, kimlik imzası doğrulanmış JWT'den gelir. Test JWT'si geçici anahtarla üretilir; parola/MFA/refresh-token oturum açma akışı değildir.

Yayın provası, aday dosya/kaynak özetlerini başlangıçta doğrular ve sonuç raporunu aynı aday kimliğine bağlar. Kaynak testleri ile derlenmiş aday testleri ayrı belirtilir; kaynak kabulünün tamamı derlenmiş sınıflarla çalışmış gibi sunulmaz.

Koşum sonunda sentetik veritabanı `pg_dump -Fc` ile alınır ve aynı geçici konteyner içinde ayrı boş DB'ye `pg_restore --exit-on-error` ile yüklenir. Seçilmiş 14 tenant/finans/F02/bildirim/audit tablosunun satır sayısı ve sıralı tüm satır JSON özeti karşılaştırılır. Bu, canlı veritabanının yedeği veya kurumun üretim yedeklerinin geri yükleme kanıtı değildir. Konteyner kapanınca iki geçici DB de silinir.

## Yeniden üretme

Komutlar depo kökünden başlar. Yeni aday adı seçilir; mevcut aday üzerine yazılmaz.

```sh
node scripts/f02-yayin-adayi.mjs --cikti .release-candidates/f02-pilot-20261016-4
node scripts/f02-aday-dogrula.mjs .release-candidates/f02-pilot-20261016-4
F02_API_DIST="$PWD/.release-candidates/f02-pilot-20261016-4/api" F02_RELEASE_REPORT="$PWD/.release-candidates/f02-pilot-20261016-4/f02-kabul.json" node apps/api/scripts/f01-yaris-kabul.mjs --f02-yayin

# apps/web çalışma dizininden; burada verilen aday yolu depo köküne göredir.
F02_RELEASE_ROOT=.release-candidates/f02-pilot-20261016-4 pnpm exec playwright test --config playwright.f02-yayin.config.ts --max-failures=1
```

## Gerçek pilot için gereken bilgiler

Kullanıcı pilot şirketini **TEKİR EKTRA ÖN MUHASEBE**, sorumlu hesabı **admin@tekirextra.local** olarak seçti. Yerel `tekirextra-postgres-1/tekirextra` veritabanında salt okunur sorguyla tek eşleşme doğrulandı: tenant `66d60ea8-0a3e-44e1-8f87-be3ddb65fc18`, kullanıcı `81e03301-c977-4dc1-b7b6-e5be3e09574a`, rol `yonetici`, aktif `true`. Saklanan unvanın sonunda boşluk var; kayıt değiştirilmedi. Ayrıntılı başlangıç kaydı: [Seçilmiş şirketin pilot kaydı](F02-TEKIR-EKTRA-PILOT-KAYDI-2026-10-16.md).

Kullanıcı pilot ortamını **http://localhost:3100** olarak kesinleştirdi. Alan kabulünü verecek kişi henüz ayrıca belirtilmedi. Yerel başlangıç ve açılış sonuçları [şirket pilot kaydında](F02-TEKIR-EKTRA-PILOT-KAYDI-2026-10-16.md) tutulur; bu belgenin ilk aday hazırlığı sırasında özellik açılmadı veya migration/servis geçişi yapılmadı.

Pilot şirket dışında kalan tenantlar kapalı kalır. Kaynak veri doğal işlemlerden gelir; gerçek şirkette kabul testi amacıyla sahte ödeme/fatura oluşturulmaz veya söz tarihi geriye çekilmez. Başlangıç/bitiş ve her örneğin kaynak kimliği pilot kayıt dosyasında tutulur; tutarlar döviz bazında karşılaştırılır.

| Adım | Beklenen sonuç | Kanıt / durum |
| --- | --- | --- |
| Salt okunur başlangıç | Söz, takip ve nakit görüntüsü kaynakla karşılaştırılır; mali kayıt değişmez | Salt okunur açılış ve teknik kontroller geçti; boş iş listesi/mod kullanıcı tarafından teyit edildi; nakit/kaynak örnekleri henüz yok |
| Manuel söz/takip | Doğal görüşmeye ait söz, revizyon/iptal ve sorumlu doğru görünür | Manuel pilot açık; ilk gerçek takip ve buna bağlı alan kabulü kullanıcı isteğiyle şimdilik ertelendi |
| Kısmi/tam/geri alınmış ödeme | Güncel söz gerçekleşmesi ve fatura kalanı kaynağa eşit; nakit çift sayılmaz | Doğal işlem oluştuğunda |
| Gecikmiş söz | Ayrı otomasyon ayarı ve aktif sorumluyla tek takip/bağ; tekrar yeni iş üretmez | Tarih doğal olarak geçtiğinde |
| Uygulama içi bildirim | Kullanıcı tercihi korunur; e-posta kuyruğu açılmaz; bağlantı doğru takibi açar | Pilot sorumlusu doğrulayacak |
| İtiraz | Önizleme ve gönderim öncesi kontrol engeli görünür; müşteri iletişimi ayrı onaylıdır | Gerçek ileti gönderilmeden gözlenebilir |
| Özellik kapatma | Otomasyon durur; kapalı/salt okunur mod yazmayı durdurur; geçmiş korunur | Aynı adayda önce geçici DB provası |

## Yayın ve geri dönüş sınırları

1. Mevcut API/web/worker sürümleri ve gerçek şema durumu kaydedilir; şirket bazında ayarların önceki değerleri alınır. Aday üretim aracı çalışan süreçleri veya gerçek DB'yi değiştirmez; yerel salt okunur ayar açılışı şirket pilot kaydında ayrıca tutulur.
2. Üretim yedeği ve ayrı ortamda geri yükleme kanıtı, migration kilit/süre provası ve boş disk kapasitesi geçişten önce alan sorumlularınca doğrulanır. Bu turdaki geçici dump/restore üretim yedeği yerine kullanılmaz.
3. F02'nin üç ek migration'ı ve arama geri yükleme düzeltmesi API/worker etkinleştirilmeden uygulanır. Etkin uygulama rolünde RLS/FORCE RLS, trigger ve haklar kontrol edilir. Gerçek geçmiş/hacim nedeniyle geçici boş DB'deki süreyi üretim süresi diye kullanmayın.
4. Aday API/web/worker sürümleri birlikte kaydedilir; yeni worker ancak yeni şema hazırken başlatılır. Web'in mevcut `/api/v1` rewrite hedefi `127.0.0.1:3001` olduğundan gerçek yerleşim/proxy buna göre doğrulanır.
5. Önce seçilmiş şirket salt okunur açılır. Alan kabulünden sonra pilot modu, ardından gerekirse otomasyon ve uygulama içi bildirim ayrı etkinleştirilir. Aktif sorumlu, kullanıcı tercihleri ve başka tenantın kapalılığı doğrulanır.
6. Sorunda ilk müdahale otomasyonun kapatılması ve F02'nin salt okunur/kapalı moda alınmasıdır. Söz/takip/bağ/audit silinmez. Migration'ı silerek veri geri alma uygulanmaz.
7. Eski binary'ye dönüş yeni itiraz gönderim engelini atlayabilir. Önce müşteri hatırlatma/ihtar ve ilgili AI gönderim yolunu kontrollü durdurmadan eski sürüme dönülmez. Tam eski sürüm/altyapı geri dönüşü bu yerel prova ile kabul edilmiş sayılmaz.

[Özellik kapatma ve yeniden açma provasının](F02-KAPATMA-VE-GERI-ACMA-PROVASI-2026-10-16.md) 8 kontrolü geçti: salt okunur/kapalı modda geçmiş ve finans verisi korunuyor; yeniden açılış aynı bağ/bildirimi kullanıyor; duraklamada eklenen söz bir kez bağlanıyor. Önceki hatırlatma bileşeninin yeni itiraz engelini bilmediği önizleme karşılaştırmasıyla doğrulandı. SMTP çağrısı olmadı. Bu, tam eski API/web/worker paketi kabulü değildir; doğrulanmış önceki dağıtım paketi hâlâ gerekli. Genel V2 geri dönüş bölümü de bu sınırlar doğrultusunda güncellendi.

[Sonraki tam imaj incelemesinde](F02-ESKI-IMAJ-UYUMU-VE-BAGIMLILIK-ENVANTERI-2026-10-16.md) 20 Eylül tarihli yerel API/worker/web bulundu. İzole yeni şemada 10 kontrolün 8'i geçti; fatura detayı kaldırılmış `irsaliye_sonra` kolonu nedeniyle 500, eski web'in aynı origin API proxy yolu 404 verdi. Üçlü geri dönüşe uygun kabul edilmedi. API'nin 29 doğrudan host bağımlılığı, workspace dist ve lockfile özetleri ayrıca kaydedildi; bunlar temiz dağıtım kurulumu kabulü değildir.

## Kapasite ve kabul kaydı

Kaynak adaptörünün 1.000 söz / 5.000 kaynak, tarayıcının 100 cari ve 15 saniye transaction sınırları geçerlidir. Gerçek veri hacmi ve kullanıcı sayısı bilinmeden üretim p95 veya worker SLA hedefi kabul edilmez. Pilot öncesi veri hacmi, SQL süreleri, sayfalama, worker tur süresi ve en kötü kaynak senaryosu kaydedilir; hedefler alan/operasyon sahibiyle belirlenir.

[İzole PostgreSQL kapasite ve sınır provasında](F02-KAPASITE-VE-SINIR-PROVASI-2026-10-16.md) 12 ek kontrol geçti: 1.000/1.001 söz, 5.000/5.001 kaynak/pay, worker ve nakit planında 100/101 cari, worker tekrarında tekillik ve gerçek 15 saniye transaction sınırında takip/bağ/audit rollback. Yerel okuma ölçümleri kaydedildi; bunlar gerçek üretim kapasitesi kabulü değildir. Çalışan şirket ayarları değiştirilmedi.

```text
Şirket / ortam:
Pilot sorumlusu / alan kabulü veren:
Aday ID / kaynak SHA-256 / dosya SHA-256 / web BUILD_ID:
Önceki API-web-worker sürümü / gerçek şema / önceki ayarlar:
Üretim yedeği ve geri yükleme kaydı:
Pilot başlangıç ve bitiş / doğal örnek kayıtları:
Söz-fatura-kapama-nakit karşılaştırması:
Otomasyon / bildirim / itiraz / kapatma sonucu:
Veri hacmi / süre dağılımı / kabul hedefleri:
Açık riskler / alan sahibi kararı:
Somut geçiş yetkilendirmesi ve yayın sonrası kontrol:
```

[Sonraki API/worker runtime paketinde](F02-API-WORKER-RUNTIME-PAKETI-2026-10-16.md) kilitli üretim bağımlılıkları ayrı dizine kuruldu; workspace çıktıları ve Prisma istemcisi üretildi. Node 22 üzerinde tam API/worker başlangıcı, gerçek parolalı HTTP giriş, F02 işlemleri ve geciken söz taraması dahil 11 kontrol geçti. Paket yalnız API JS dosyalarından oluşmaz; ayrı manifestle korunur. Bu yerel kanıt hedef üretim ortamının kurulumu ve servis geçişi yerine geçmez.

Gerçek pilot, üretim kapasitesi, hedef üretim kurulumu, uygun eski sürüme dönüş ve canlı yayın kapıları henüz tamamlanmadı. F02 paketinin tamamlandığı veya yayına hazır olduğu ileri sürülmez.

## 17 Ekim 2026 — yedinci adayın ek teknik kabulü

[17 Ekim yedinci aday runtime kabulü](F02-YEDINCI-ADAY-RUNTIME-KABULU-2026-10-17.md) tamamlandı: 11 Node 22 API/worker, 1 gerçek PDF ve 14 gerçek web/API/worker akışı kontrolü geçti. Geçici ortamlar temizlendi; önceki 140 kontrolün kanıtları değişmedi. Bu sonuç yedinci aday kimliğine aittir; yeni runtime/tam akış kabulü gerektiren önceki açık madde bu aday için kapanmıştır. Sonradan değişen çalışma alanı kaynakları, doğal pilot/alan kabulü, üretim kapasitesi, uygun eski sürüme dönüş ve canlı yayın kapsam dışındadır. Gerçek şirket verileri, ayarlar ve çalışan servisler değiştirilmedi.

## 17 Ekim 2026 — güncel kaynakların dokuzuncu aday kabulü

[Güncel belge/PDF adayında](F02-DOKUZUNCU-ADAY-KABULU-2026-10-17.md) 29 dosya farkı kaynak kimliğine alındı; kaşe yüklemesinin API yolu ve eski görseli erken silme hatası giderildi. Son aday `f02-20261017T052606307Z-fixture9`; 214 yerel teknik kontrol geçti. Güncel çalışma alanı kaynak özeti eşleşti, geçici ortamlar temizlendi. Gerçek şirket verileri/ayarları ve çalışan servisler değiştirilmedi. Sonradan değişen kaynakların ayrıca kabulü maddesi bu kaynak kimliği için kapandı; gerçek doğal pilot/alan kabulü, üretim kapasitesi, uygun eski sürüme dönüş, hedef ortam kurulumu ve canlı yayın açık kalır.
