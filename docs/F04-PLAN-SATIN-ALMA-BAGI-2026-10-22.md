# F04 — İhtiyaç planından tek satın alma taslağı

22 Ekim 2026. Bu dilim kayıtlı ihtiyaç planından satın alma taslağı hazırlamayı ve plan başına tek talep bağlantısını ekler. Gerçek şirket verisine bağlanılmadı; migration gerçek ortama uygulanmadı ve yayın yapılmadı.

## Davranış ve kapsam

Güncel, doğrulanmış ve pozitif açığı bulunan kayıtlı planda “Bu plandan satın alma taslağı hazırla” bağlantısı görünür. Daha erken ayrı planlanması gereken dönem içi açık varsa aktarım yapılmaz. Ürün, miktar ve gün plan üzerinden alınır; bütçe kalemi ve tahmini fiyatı kullanıcı seçer. Kayıt yalnız taslak oluşturur; otomatik onay, sipariş veya stok rezervi yoktur.

`POST /api/v1/satin-alma/talepler` isteği isteğe bağlı `ihtiyacPlaniId` kabul eder. Bu alanla talep açma yönetici, muhasebe ve depo rolleriyle sınırlıdır. Sunucu tenant kapsamındaki planı okur, girdileriyle aynı transaction içinde tarihli hesabı yeniden çalıştırır ve sonuç kanıtını karşılaştırır. Pozitif açık, erken açık sınırı ve tek kalemin ürün/miktar/gün eşitliği sunucuda da doğrulanır. Mevcut bütçe, aktif kart ve departman kontrolleri korunur.

Talep, sayaç, oluşturma olayı, değişmez plan bağlantısı ve bağlantı audit’i aynı transaction’da yazılır. Bağ yazımı veya audit başarısızsa hepsi geri alınır. Plan başına tek talep DB’de unique anahtarla korunur. Eşzamanlı aynı kullanıcı/aynı içerik ve belirsiz yanıt sonrası aynı istek, önceki talebi döndürür. Farklı kullanıcı veya farklı içerikle aynı planı tekrar kullanmak 409 verir. Önceki kayıt bulunursa eski kaynakların güncelliğine bakıp yeni talep açılmaz; tekrarın sonucu tarihsel talep kimliğidir.

Bağlı talep iptal edilse bile bağlantı silinmez; aynı plan ikinci talep açamaz. Talep değişikliği gerekiyorsa mevcut talep iptal edilip yeni ihtiyaç planı hazırlanır. Bağlı taslağın düzenleme yetkisi detay yanıtında kapalıdır ve doğrudan güncelleme isteği de reddedilir. Onaya gönderme, iptal ve sonraki onay/sipariş yaşam döngüleri mevcut kuralları kullanır.

Plan okuması `satinAlmaBagi.talepId` döndürür. Plan geçmişi, güncelliği değişmiş olsa da bağlı talebi inceleme bağlantısını gösterir. Satın alma sayfası `?ihtiyacPlani=<uuid>` ile açıldığında var olan bağda mevcut talebi gösterir; eski ve bağsız planla form açmaz. Talep detayının mevcut sahiplik/rol sınırları geçerlidir.

Bu güvence **aynı kayıtlı plan** içindir. Mevcut plansız normal talep ve doğrudan ihtiyaç-girdisi aktarımı geriye uyumlu olarak devam eder; bu yollar plan tekilliği iddiası taşımaz. Farklı planların aynı stoğu veya açığı tekrar göstermesi engellenmez. Planlar arasında kapasite tahsisi ve bütün talep girişlerinde ortak ihtiyaç tekilleştirmesi bu dilimin kapsamı değildir.

## Veri modeli ve yayın gereği

`20261022190000_ihtiyac_satin_alma_bagi` migration’ı `ihtiyac_satin_alma_baglari` tablosunu ekler. Plan ve talep FK’ları tenant ile bileşiktir; plan ve talep başına bağlantı tektir. RLS/FORCE etkindir; uygulama rolüne SELECT/INSERT verilir, UPDATE/DELETE verilmez. Eski kayıtlar için otomatik bağ veya talep üretilmez.

Yeni API sürümünden önce migration ve Prisma client üretimi gerekir. Satın alma detayları yeni ilişkiyi okuduğundan migration olmadan yeni API çalıştırılmamalıdır. Geri dönüşte önceki API/web kullanılabilir; bağlantı ve audit kayıtları silinmez. Önceki sürüm bu yeni plan tekilliği davranışına eşdeğer kabul edilmez.

## Bulunan hata ve düzeltme

İlk gerçek API koşusunda eski iki senaryo geçti; yeni taslak senaryosu POST isteğine ulaşamadı. PostgreSQL JSONB, snapshot içindeki nesne alanlarını yeniden sıraladığından istemcideki düz JSON karşılaştırması aynı sonucu değişmiş sayıyordu. İhtiyaç karşılaştırması nesne anahtarlarını özyinelemeli sıralayacak şekilde düzeltildi; dizilerin anlamlı sırası korunur. Regresyon testi, aynı alanların farklı sırada eşit olduğunu ve gerçek kaynak değişiminin hâlâ saptandığını doğrular. Tarayıcı fixture’ı da artık JSONB gibi alan sırasını değiştirir.

## Son doğrulama

- İzole PostgreSQL/RLS: **37/37**. Yeni altı test yarış/tekrar, eski plan, yanlış ürün/miktar/gün, rol ve tenant sınırları, DB değişmezliği/FK, audit rollback, iptal sonrası tekillik ve açıksız plan reddini kapsar. Geçici DB silindi.
- Son üretim web paketinde fixture tarayıcı: **23/23**. Yeni iki senaryo kayıtlı plandan taslak, bağlı talebe dönüş ve eski planın doğrudan URL ile engellenmesini doğrular. JSONB alan sırası fixture’da da değiştirilir.
- Gerçek derlenmiş API ve üretim web paketiyle birleşik kabul: **3/3**. Parolalı Chromium’da plan → taslak → tek DB bağı ve HTTP tekrarında aynı talep doğrulandı; talep taslak kaldı. Önceki JWT/atama/plan güncellik senaryoları da yeniden geçti. API yanıtı taklidi veya token enjeksiyonu yoktur; test modülü kapsamı önceki gerçek HTTP belgesindeki sınırlara tabidir, satın alma controller ve servisleri bu dilimde eklenmiştir.
- Web ihtiyaç yardımcı testleri: **15/15**. Tam API ve web TypeScript kontrolleri, odaklı HTTP API derlemesi ve son web üretim derlemesi başarılı. Son paket alan sırası düzeltmesini içerir ve kendi tür kontrolünden de geçmiştir.

Son web build kimliği `2EB4omJpWbYNTVcsFRywM`. Değişen kaynaklar test kopyasıyla SHA-256 üzerinden eşleştirildi. Son paket `/tmp/tekir-f04-bag-web-vr3hvkyy/.next-bag-final/standalone` altında; sabit test giriş yolu `.next-bag/standalone` bu son pakete yönelir. Paket izleme kökü `/`, tek işçi ve statik/public kopyalama ayarları yalnız geçici test paketine aittir; asıl Next yapılandırması değiştirilmedi.

DB kabulü proje kökünden `node apps/api/scripts/f01-yaris-kabul.mjs --f04` ile çalışır. Birleşik kabul için önce `node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-bag-http-api` ile API paketini üretin. Ardından:

```sh
F04_API_DIST=/tmp/tekir-f04-bag-http-api F04_WEB_ROOT=/tmp/tekir-f04-bag-web-vr3hvkyy/.next-bag-final/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-plan-satin-alma-20261022/gercek-http node apps/api/scripts/f01-yaris-kabul.mjs --f04-http
```

Geçici paket silinmişse önce yeniden derlenmelidir; Docker ve yerel port erişimi gerekir. Runner canlı bağlantı dosyasını okumaz. Client üretimi geliştirme ortamının Prisma komutuyla yapılmıştır; bu komut migration uygulamamıştır.

## Kanıt ve kalan işler

Son kabul sonuçları ve paket kaynak eşleşmesi `.release-candidates/f04-plan-satin-alma-20261022/` altında tutulur. DB özet kaydı tool sonucudur; ham DB logu değildir. Üretim web paketi geçici dizinde derlenir; dağıtım manifesti sayılmaz. İlk fixture ve başarısız birleşik koşu özetleri ayrı dizinlerde korunur.

Operasyon pilotu, farklı planlar arasında kapasite tahsisi kararı ve bütün F04 kapsamının yayın kabulü açıktır. Bu dilim gerçek şirket yayını veya kapasite rezervi değildir.
