# TekirExtra Uygulama ve Modül Geliştirme Raporu

**Tarih:** 2 Eylül 2026  
**İnceleme türü:** Kod, veri modeli, kullanıcı akışları, test, güvenlik ve operasyonel hazırlık analizi  
**İncelenen kapsam:** `apps/api`, `apps/web`, `packages`, Prisma migrasyonları, CI, Docker ve ürün/mimari dokümanları

## 1. Yönetici özeti

TekirExtra, sıradan bir prototipten belirgin biçimde ileri seviyededir. Çok kiracılı
veri yapısı, PostgreSQL RLS, rol denetimi, mali hareket modelleri, e-belge worker'ı,
stok ve üretim süreçleri gibi zor konularda çalışan bir temel bulunmaktadır. Kod
tabanında 24 backend alanı, 92 web rotası, 100'ün üzerinde Prisma modeli/enumu ve
66 birim/servis test dosyası vardır.

Buna karşın ürün olgunluğu modüller arasında eşit değildir. Cari, stok, fatura,
belge, kasa-banka, personel ve üretim alanları geniş kapsamlıdır; AI, B2B, CRM,
mali müşavir ve abonelik alanları ise aynı menü görünürlüğüne rağmen pilot veya
taslak seviyesindedir. Bu durum kullanıcıda bütün modüllerin üretime hazır olduğu
izlenimini oluşturabilir.

En doğru sonraki yatırım sırası şöyledir:

1. B2B erişim ve fiyat doğruluğu, mali müşavir çıktı doğruluğu ve CI E2E açığını kapatmak.
2. Finansal tutarlılık için şirket geneli dönem kapatma modülünü geliştirmek.
3. Kalıcı bildirim ve görev merkezini kurmak.
4. Çekirdek modüllerin regresyon, idempotensi ve tenant izolasyonu testlerini artırmak.
5. Ardından bütçe/nakit akışı ve gerçek satın alma onay sürecine geçmek.

Yeni özellik geliştirmeden önce üç önemli ürün gerçeği arayüzde açıkça ayrılmalıdır:

- AI OCR şu anda simülasyondur; gerçek belge okumamaktadır.
- B2B ekranı gerçek bir dış bayi portalı değil, tenant içinden cari seçilen yönetim ekranıdır.
- Mali müşavir dışa aktarımları gerçek ürün formatı uygunluğu doğrulanmış paketler değildir.

## 2. İnceleme yöntemi ve sayısal görünüm

İncelemede aşağıdakiler karşılaştırılmıştır:

- `docs/ISTERLER.md`, `docs/MIMARI.md` ve `docs/URUN-URETIM-PLANI.md`
- NestJS controller, service ve Zod şemaları
- Prisma şeması ve migrasyon/RLS politikaları
- Next.js panel rotaları ve rol bazlı menü erişimi
- Vitest, Playwright ve gerçek PostgreSQL kabul testleri
- GitHub Actions, Docker Compose, health/readiness ve Prometheus altyapısı

Öne çıkan ölçümler:

| Ölçüm | Sonuç | Yorum |
|---|---:|---|
| Backend alanı | 24 | Modül kapsamı geniş |
| Panel rotası | 92 | Navigasyon ve ekran kapsamı güçlü |
| API test dosyası | 66 | Sayı iyi, dağılım dengesiz |
| Web E2E dosyası | 3 | Kritik iş alanlarına göre düşük |
| Gerçek DB kabul testi | 1 | RLS ve finans invariantları için yetersiz |
| 1.000 satırı aşan kaynak dosyası | 8 | Bakım ve regresyon riski yüksek |
| Üretim kodunda `any`/`as any` kullanımı | yaklaşık 74 | Tip güvenliği borcu var |

## 3. Modül olgunluk haritası

| Modül grubu | Olgunluk | Güçlü yön | Ana eksik |
|---|---|---|---|
| Cari | İleri | Kart, adres, kişi, banka, etiket, ekstre, CRM ve analiz | Büyük servis/sayfa, zayıf servis regresyon kapsamı |
| Stok/depo | İleri | Çoklu depo, varyant, lot/seri, sayım, transfer, fiyat listesi | 3.349 satır backend koda karşı yalnız bir doğrudan test dosyası |
| Fatura | İleri | Taslak/kesin yaşam döngüsü, tekrar, PDF, e-belge bağlantısı | Çok büyük servis/UI, dönem kilidi ve yaygın idempotensi yok |
| Belgeler | İleri-orta | Teklif/sipariş/irsaliye zinciri ve dönüştürme | Uzun servis/UI, satın alma onayı ve üçlü eşleştirme yok |
| Kasa-banka | İleri | Kasa, banka, kart, POS, ekstre, çek/senet, ödeme talimatı | Karmaşık çapraz akışların E2E/invariant kapsamı eksik |
| e-Belge | İleri-orta | Kalıcı kuyruk, retry, dead-letter, Sovos, gelen belge | Diğer entegratörler mock; sandbox contract kapsamı eksik |
| Masraflar | Orta-ileri | Onay, ödeme, kira tahakkuku, kart bağlantısı | Onay matrisi, masraf politikası ve satın alma bağı zayıf |
| Personel/bordro | Orta-ileri | Bordro, avans, izin, mevzuat seti ve kabul senaryosu | Yasal çıktı/entegrasyon ve uçtan uca bordro ödeme testi eksik |
| Üretim | Orta-ileri | Reçete, emir, rezervasyon, operasyon, kalite ve maliyet | Tek büyük servis, bakım/MRP/izlenebilirlik derinliği sınırlı |
| Düzeltme merkezi | Orta-ileri | Tarama, SLA, rol kapsamı, otomatik kapanış, metrik | Dedektör kapsamı ve kaynak modüle götüren çözüm akışları genişlemeli |
| Pazaryeri | Orta | Dört adaptör, sipariş eşleme/faturalama, Amazon kesintisi | Worker tabanlı sürekli senkron ve gerçek sandbox doğrulaması eksik |
| POS/SMS | Orta | iyzico, PayTR ve Netgsm adaptörleri | Webhook replay/idempotensi ve uçtan uca mutabakat kapsamı artırılmalı |
| Projeler/gelir | Orta | Proje kırılımı, hedefler, gelir/gider görünümü | Zaman çizelgesi, kaynak planı ve gelişmiş kârlılık yok |
| CRM fırsat | Başlangıç-orta | Temel CRUD ve aşama değişimi | Aktivite, teklif dönüşümü, kazanma/kaybetme nedeni ve otomasyon yok |
| Mali müşavir | Başlangıç | Luca/XML, Zirve/CSV ve KDV özeti için ilk uçlar | Format doğruluğu, escaping, muhasebe kodları ve dönem paketi yok |
| B2B | Prototip | Katalog, özel fiyat fikri, sepet ve sipariş üretimi | Gerçek bayi kimliği/izolasyonu ve doğru fiyat motoru yok |
| AI/OCR | Demo | Arayüz ve servis sözleşmesi mevcut | OCR simüle; tahmin zaman/vade/ödeme durumunu kullanmıyor |
| Abonelik | Başlangıç | Plan ve durum veri modeli | Gerçek ödeme/faturalama, kota uygulaması ve webhook yok |
| Raporlama | Orta | Dashboard, finans raporları, dışa aktarım altyapısı | Semantik metrik kataloğu, drill-down ve büyük veri stratejisi eksik |

## 4. Öncelikli kritik bulgular

### P0.1 — B2B bayi erişim sınırı güvenli değil

`B2bController` katalog ve ekstreyi URL'den alınan `cariId` ile açmaktadır.
Kullanıcının hangi cariye ait olduğunu gösteren bir kullanıcı–cari ilişkisi yoktur.
`b2b_bayi` rolündeki bir kullanıcı aynı tenant içindeki başka bir cari kimliğini
bildiğinde o carinin katalog/ekstre verisini isteyebilir. RLS yalnız tenant sınırını
korur; tenant içi bayi ayrımını korumaz.

Öneri:

- `BayiKullanici` veya `User.cariId` benzeri açık bir ilişki ekleyin.
- Bayi uçlarında `cariId` istemciden alınmasın; kimlik bağlamından türetilsin.
- Yönetici adına işlem yapma ayrı, denetimli bir “bayi olarak görüntüle” akışı olsun.
- Başka cariye erişim için negatif API ve gerçek DB kabul testi ekleyin.
- Siparişe idempotency anahtarı ve tekrar gönderim koruması ekleyin.

### P0.2 — B2B sipariş fiyat ve vergi hesabı katalogla tutarsız

Katalog özel fiyat listesini ve cari iskontosunu gösterirken sipariş oluşturma
servisi stok kartının normal satış fiyatını kullanmaktadır. Ayrıca toplamlar
`genelToplam / 1.2` ile geri hesaplanmakta, bütün kalemlerin KDV'si fiilen %20
varsayılmaktadır. Bulunamayan stok kalemi hata vermek yerine sessizce atlanmaktadır.

Öneri:

- Katalog ve sipariş aynı sunucu tarafı fiyatlandırma motorunu kullanmalı.
- Her kalem kendi KDV oranıyla Decimal üzerinden hesaplanmalı.
- İstemciden gelen fiyat hiçbir zaman otorite kabul edilmemeli.
- Eksik/pasif stok tüm siparişi açık hata ile durdurmalı.
- Fiyat listesi sürümü sipariş satırında kanıt olarak saklanmalı.

### P0.3 — Mali müşavir çıktıları üretim formatı güvenilirliğinde değil

Luca XML üretimi `<Faturalar>` açılış etiketi olmadan kapanış etiketi yazmaktadır.
Unvan ve diğer metinler XML/CSV için kaçırılmadığından `&`, `<`, çift tırnak veya
satır sonu içeren gerçek veriler çıktıyı bozabilir; CSV formül enjeksiyonu da
değerlendirilmemiştir. Çıktılar resmi ürün şemasına karşı doğrulanmamaktadır.

Öneri:

- String birleştirmek yerine XML builder ve güvenli CSV writer kullanın.
- Luca/Zirve/Logo/Mikro için sürümlü format profilleri oluşturun.
- Muhasebe hesap kodu eşleme ekranı ve doğrulama raporu ekleyin.
- Golden-file, XSD/şema ve gerçek sandbox kabul testleri kurun.
- Dönem paketi manifesti, checksum ve dışa aktarım denetim izi saklayın.

### P0.4 — CI web E2E testlerini çalıştırmıyor

CI içindeki `pnpm --filter /web test:e2e` filtresi hiçbir workspace projesiyle
eşleşmemektedir. Komut sıfır koduyla “No projects matched” döndürdüğü için pipeline
yeşil görünürken Playwright testleri atlanmaktadır.

Öneri:

- Komutu `pnpm --filter @tekirextra/web test:e2e` olarak düzeltin.
- “Eşleşen proje yok” durumunu hata yapan CI kontrolü ekleyin.
- Playwright için API ve altyapı servislerini de başlatan açık bir test fixture'ı kullanın.

### P0.5 — AI/OCR özelliği kullanıcıyı yanıltabilir

OCR servisi yüklenen görüntüyü işlememekte; her çağrıda sabit Migros verisi ve
%94 güven skoru döndürmektedir. Nakit tahmini seçilen gün aralığını filtreye
uygulamamakta, tüm kesin faturaları ödenmiş/kalan bakiye ayrımı olmadan toplamakta
ve sabit %85/%95 katsayıları kullanmaktadır.

Öneri:

- Gerçek OCR gelene kadar modülü “deneysel demo” olarak işaretleyin veya üretimde kapatın.
- Dosyayı base64 JSON yerine güvenli multipart/S3 yükleme hattından geçirin.
- OCR sonucunu kullanıcı onaylı masraf/fatura taslağına dönüştürün; otomatik mali kayıt üretmeyin.
- Nakit tahmininde vade, kalan bakiye, çek/senet, tekrarlayan gider, bordro ve güven senaryolarını kullanın.
- “AI” etiketi ancak model/algoritma, ölçüm seti ve açıklanabilirlik sağlandığında kullanılmalı.

## 5. Yeni geliştirilmesi gereken ana modüller

### 5.1 Dönem kapatma — en yüksek iş önceliği

Üretimde yalnız üretim alanına özel dönem kilidi vardır. Şirket geneli mali dönem
kilidi bulunmadığından kapatılmış aya fatura, ödeme, stok ve entegrasyon hareketi
yazılmasını tek noktadan engelleyen güvence yoktur.

Gerekli kapsam:

- `MaliDonem`, `DonemKontrolu`, kapatma/açma olay geçmişi
- Banka/kart mutabakatı, e-belge, masraf, sayım, kasa ve negatif stok kontrolleri
- Tüm tarihli mutasyonların çağırdığı merkezi `DonemKilidiService`
- Yönetici + zorunlu gerekçe + TOTP ile yeniden açma
- Geç gelen entegrasyon kaydını sonraki açık döneme/düzeltme merkezine yönlendirme
- `/panel/donem-kapatma` kontrol listesi ve kanıt çıktısı

Bu modül yeni özellik değil, finansal veri bütünlüğü katmanı olarak ele alınmalıdır.

### 5.2 Kalıcı bildirim ve görev merkezi

Mevcut zil menüsü farklı API özetlerini tarayıcıda birleştirmektedir; kalıcı
bildirim kaydı, okundu/arşivlendi durumu, kullanıcı tercihi ve görev yaşam döngüsü
yoktur. Kritik olayların teslim edildiği ve sahiplenildiği kanıtlanamaz.

Gerekli kapsam:

- `Bildirim`, `BildirimTeslimati`, `BildirimTercihi`, `Gorev`
- Uygulama içi bildirim + e-posta; kritik ve izinli olaylarda SMS
- Olay birleştirme, tekrar bastırma, sessiz saat ve escalation
- Düzeltme kaydı, e-belge dead-letter, vade, ödeme talimatı ve stok alarmı kaynakları
- Okundu değil “aksiyon alındı” metriği ve görev SLA'sı

### 5.3 Bütçe ve açıklanabilir nakit akışı

Projelerde hedef gelir/gider alanları olsa da şirket bütçesi, revizyon, gerçekleşen
eşleme ve senaryo modeli yoktur. Mevcut AI tahmini gerçek nakit planlama ihtiyacını
karşılamaz.

Gerekli kapsam:

- Aylık/yıllık bütçe, kategori/proje kırılımı ve revizyon geçmişi
- Gerçekleşen hareketlerle izlenebilir eşleme
- 7/30/90 gün; iyimser/baz/kötümser senaryolar
- Vade, ödeme davranışı, çek/senet, bordro, kira ve tekrarlayan faturalar
- Her tahmin satırından kaynak belgeye drill-down

### 5.4 Satın alma talep ve onay yönetimi

Mevcut “Satın Alma” ekranı alış faturası ve genel belge ekranlarına yönlendiren bir
çalışma alanıdır. Talep, teklif karşılaştırma, onay matrisi, mal kabul ve üçlü
eşleştirme bulunmamaktadır.

Gerekli kapsam:

- Talep → onay → teklif → sipariş → kısmi mal kabul → fatura eşleştirme
- Tutar/kategori/departman bazlı onay matrisi ve görev ayrılığı
- Stoklu/hizmet kalemi farkı
- Sipariş–kabul–fatura toleransları ve düzeltme merkezi entegrasyonu
- Bütçe aşımı uyarısı veya engeli

### 5.5 Demirbaş ve amortisman

Şemada demirbaş, zimmet veya amortisman modeli bulunmamaktadır. Personel ve alış
faturası altyapısı hazır olduğu için R6'nın bağımlılıkları büyük ölçüde mevcuttur.

Gerekli kapsam:

- Alış faturası/masraftan tekilleştirilmiş demirbaş oluşturma
- Seri no, konum, garanti, bakım ve durum yaşam döngüsü
- Personel zimmeti ve imzalı teslim/iade tutanağı
- Sürümlü amortisman planı; maliyet üst sınırı invariantı

### 5.6 Çoklu şube ve masraf merkezi

Bu alan henüz yoktur ve en yüksek migrasyon riskine sahiptir. Depo, kasa, banka,
POS, belge serisi, kullanıcı yetkisi ve raporların tümünü etkiler. Dönem kapatma ve
bütçe modeli oturmadan başlanmamalıdır.

Önerilen yaklaşım:

- Önce `Sube`, `MasrafMerkezi`, kullanıcı erişim modeli ve “Merkez” backfill prototipi
- Nullable ilişki → çift okuma → backfill → zorunlu alan şeklinde kademeli migrasyon
- Tenant RLS yanında şube kapsam kontrolü ve negatif erişim testleri
- Şubeler arası dengeli stok/finans transferi invariantları

## 6. Mevcut modüllere özel geliştirme önerileri

### Cari ve CRM

- Fırsattan teklif/sipariş üretimi ve kaynak bağlantısı eklenmeli.
- Kazanma/kaybetme nedeni, olasılık, ağırlıklı pipeline ve aktivite zaman çizelgesi eklenmeli.
- Cari servisindeki 1.028 satırlık sorumluluk; kart, ekstre, analiz ve CRM alt servislerine ayrılmalı.
- Tahsilat davranışı analizi nakit akışı modülünün ortak girdisi yapılmalı.

### Stok, depo ve üretim

- Stok servisinin düşük test yoğunluğu öncelikle artırılmalı.
- MRP ihtiyaç önerisi, satın alma talebi oluşturma ve tedarik süresi eklenmeli.
- Sayım ve transfer için daha fazla idempotensi/eşzamanlılık testi eklenmeli.
- Üretime planlı bakım, makine/ekipman uygunluğu ve OEE metrikleri sonraki fazda eklenebilir.
- Lot/seri geriye ve ileri izlenebilirlik raporu hazırlanmalı.

### Fatura, belge ve e-belge

- Fatura servisi ve 1.480 satırlık ekran komut/sorgu ve alt bileşenlere ayrılmalı.
- Kritik mutasyonların tamamı ortak `Idempotency-Key` standardına geçirilmelidir.
- Sovos dışındaki entegratörler üretim menüsünde ancak gerçek adapter ve contract testten sonra açılmalı.
- İptal/iade sonrası stok, cari ve finans toplamı invariant testleri genişletilmeli.
- Büyük PDF/Excel üretimi mevcut mimari plandaki arka plan rapor kuyruğuna taşınmalı.

### Kasa-banka, POS ve pazaryeri

- Webhooklarda timestamp/nonce/replay koruması standartlaştırılmalı.
- POS brüt/net/komisyon ve banka mutabakatı tek bir uçtan uca senaryoda test edilmeli.
- Pazaryeri senkronizasyonu manuel istek yerine kalıcı worker, cursor ve dead-letter ile çalışmalı.
- Adaptör sözleşmeleri kaydedilmiş sağlayıcı yanıtları ve sandbox testleriyle doğrulanmalı.
- Finansal dış servis hataları düzeltme merkezinde otomatik kayıt üretmeli.

### Personel ve bordro

- Bordro onay/ödeme zinciri gerçek DB ve rol ayrılığıyla uçtan uca test edilmeli.
- SGK/banka dosyası ve yasal çıktılar sürümlü şemalara karşı doğrulanmalı.
- Hassas veriler için alan bazlı yetki, erişim kaydı, saklama ve anonimleştirme politikası eklenmeli.
- Mevzuat seti değişikliklerinde dört göz onayı değerlendirilmelidir.

### Raporlama ve mali müşavir

- Her KPI için tek semantik tanım ve kaynak hareket drill-down'u oluşturulmalı.
- Rapor sorgularına veri büyüklüğü hedefleriyle indeks/EXPLAIN testleri eklenmeli.
- Tarih, para birimi ve iade işaret kuralları ortak rapor motoruna taşınmalı.
- Dışa aktarımlar kullanıcı isteği, üretim zamanı, filtre ve checksum ile kayıt altına alınmalı.

## 7. Güvenlik ve platform değerlendirmesi

Güçlü taraflar:

- Tenant tablolarında RLS ve çoğunda `FORCE ROW LEVEL SECURITY`
- JWT + dönen refresh token, Argon2 parola, TOTP ve kritik işlem yeniden doğrulaması
- AES-256-GCM bağlantı sırrı saklama yaklaşımı
- Rate limiting, temel güvenlik başlıkları, request ID ve yapılandırılmış log
- Dosya türü/boyutu doğrulama testleri

Geliştirilmesi gerekenler:

- Auth modülünün doğrudan servis/controller test dosyası yoktur.
- Demo kullanıcı parolaları giriş ekranında sabittir; üretim build'inde özellik bayrağıyla kapatılmalıdır.
- `/metrics` herkese açıktır; ayrı ağ/kimlik katmanıyla sınırlandırılmalıdır.
- Rate limit yalnız IP tabanlıdır; giriş, yenileme ve hassas uçlar için kullanıcı/uç bazlı politika gerekir.
- Audit kaydı ana işlemden sonra asenkron yazılmakta ve başarısızlığı işlemi geri almamaktadır. Kritik mali/onay işlemleri aynı transaction içinde alan olayı üretmelidir.
- Metrics `req.path` değerini etiket yaptığı için ID içeren rotalarda yüksek cardinality riski vardır; route template kullanılmalıdır.
- KVKK veri envanteri, saklama süresi, dışa aktarma/silme-anonimleştirme akışı görünür değildir.
- Tüm dış callback'lerde ortak imza, timestamp, nonce ve replay standardı bulunmalıdır.

## 8. Test ve kalite değerlendirmesi

Mevcut test sayısı olumlu görünse de risk ağırlıklı dağılım yeterli değildir:

- Stokta binlerce satır iş mantığına karşı yalnız bir doğrudan stok test dosyası vardır.
- Auth, ekler, döviz, fiyat listeleri ve gelirler modüllerinde doğrudan test boşluğu vardır.
- Yalnız bir gerçek PostgreSQL kabul testi, çok kiracılı geniş şema için yetersizdir.
- Üç Playwright dosyası 92 rotanın ancak küçük bir bölümünü kapsar.
- Coverage ölçümü/eşiği yoktur.
- Büyük veri ve performans test aracı/senaryosu yoktur.

Önerilen zorunlu test paketi:

1. İki tenant + her rol için yetkisiz okuma/yazma matrisi.
2. Satış faturası → e-belge → tahsilat → kapanan bakiye.
3. Alış siparişi → kabul → fatura → ödeme.
4. İptal/iade sonrası stok, cari ve finans başlangıç eşitliği.
5. POS → komisyon → banka mutabakatı ve tekrar callback.
6. Bordro tahakkuk → onay → kısmi/tam ödeme.
7. Worker çökmesi, yeniden başlama ve aynı işin iki kez teslimi.
8. Ay sonu, saat dilimi, kur ve taksit tarihi sınırları.
9. 100 bin fatura / 500 bin hareket veri setinde p95 ölçümü.

## 9. Teknik borç ve geliştirici deneyimi

- `fatura/page.tsx`, `stok/[id]/page.tsx` ve `cari/page.tsx` yaklaşık 1.450 satırdır.
- `fatura.service.ts`, `stok.service.ts`, `cari.service.ts` ve `ebelge.service.ts`
  yaklaşık 1.000–1.400 satırdır.
- Bu dosyalar küçük değişikliklerin geniş regresyon üretmesine ve paralel geliştirmede
  çatışmaya neden olur.
- Tekrarlanan DTO/interface tanımlarının `packages/shared` içine taşınması gerekir.
- Para hesaplarında görülen `number` dönüşümleri Decimal/kuruş tabanlı ortak motorla azaltılmalıdır.
- API için OpenAPI sözleşmesi ve istemci tip üretimi görünmemektedir.
- API `dev` komutu watch mode kullanmamakta, her açılışta Prisma + tam TypeScript
  derlemesi yapmaktadır; geliştirme döngüsü yavaştır.

Öneri: Her sprint kapasitesinin en az %20'si test + parçalama + tip güvenliği için
ayrılmalı; yeni büyük modül eklenirken bu oran düşürülmemelidir.

## 10. Operasyonel hazırlık

Olumlu unsurlar:

- Liveness/readiness ayrımı
- PostgreSQL, Redis ve S3 bağlantı kontrolü
- Worker metrikleri, Prometheus ve Alertmanager dosyaları
- Yedekleme/geri yükleme runbook'u
- e-belge dead-letter ve düzeltme tarama gözlemlenebilirliği

Eksikler:

- Yedek geri yükleme provasının otomatik ve tarihsel kanıtı kod tabanında görünür değil.
- Gerçek SLO dashboard'u, hata bütçesi ve on-call/escalation süreci tamamlanmalı.
- In-memory API metrikleri çoklu instance çalışmasında instance bazında kalır; histogram
  ve standart Prometheus istemcisine geçiş değerlendirilmelidir.
- Feature flag/kademeli tenant açılım altyapısı yol haritasında tarifli fakat kodda görünür değildir.
- Rapor ve toplu işlemler için genel background job altyapısı tamamlanmalıdır.

## 11. Önerilen 12 haftalık uygulama sırası

| Dönem | Hedef | Çıkış ölçütü |
|---|---|---|
| Hafta 1–2 | P0 düzeltmeleri | B2B tenant-içi izolasyon testi, doğru fiyat/KDV, geçerli mali müşavir çıktısı, CI'da gerçek E2E |
| Hafta 3–4 | Çekirdek güvence | Auth/RLS/invariant testleri, webhook replay koruması, demo özellik bayrakları |
| Hafta 5–6 | R2 dönem kapatma | Merkezi kilit tüm mali mutasyonlarda, kontrol listesi ve yeniden açma denetimi |
| Hafta 7–8 | R3 bildirim/görev | Kalıcı teslimat, tercihler, e-posta ve SLA/escalation |
| Hafta 9–10 | Teknik sadeleştirme | İlk üç büyük servis/sayfanın bölünmesi, shared DTO ve API sözleşmesi |
| Hafta 11–12 | R4 keşif + temel | Açıklanabilir 7/30/90 gün nakit akışı ve bütçe alan modeli |

R5 satın alma, R6 demirbaş ve R7 şube çalışmaları bu 12 haftalık güvence paketi
tamamlandıktan sonra başlatılmalıdır.

## 12. Başarı ölçütleri

Önerilen kısa dönem ölçütleri:

- Kritik finans regresyonu: 0
- CI'da atlanan test işi: 0
- Kritik mutasyonlarda idempotensi kapsamı: %100
- Tenant/rol negatif kabul matrisi geçişi: %100
- Ana liste p95: 2 saniyenin altında
- Ağır rapor p95: 5 saniyenin altında
- Dead-letter medyan çözüm süresi: 4 saatin altında
- Dönem kapatma kontrol tamamlanma oranı: %100
- Kritik bildirimin hedef kullanıcıya 15 dakika içinde teslimi: %99+
- Gerçek OCR alan doğruluğu yayına çıkmadan önce tanımlı pilot sette ölçülmeli; ölçümsüz “%94 güven” gösterilmemeli

## 13. Sonuç

TekirExtra'nın temel muhasebe ve operasyon omurgası değerlidir; ürün yeniden
yazılmayı değil, olgunluk farklarının kapatılmasını gerektiriyor. En büyük risk
özellik eksikliği değil, prototip düzeyindeki modüllerin olgun modüllerle aynı
güven seviyesinde sunulması ve kritik iş akışlarının test/CI tarafından eksik
korunmasıdır.

Önerilen karar: önce P0 güvenlik/doğruluk açıklarını ve R2–R3 işletilebilirlik
katmanlarını tamamlayın. Sonra bütçe, satın alma ve demirbaş geliştirmesine geçin;
çoklu şubeyi ise ayrı migrasyon keşfi ve pilot tenant planıyla ele alın.
