# P0-01 — AI veri ve üretim hazırlığı envanteri

Tarih: 14 Ekim 2026  
Durum: Devam ediyor — altyapı/katalog ve seçilmiş şirketin 21 profil taraması tamamlandı; 21:06'da yerel yeni sürüm devreye alındı. Yönetici onayının yeni sürümde yenilenmesi, alan doğrulaması ve pilot kabulü açık.

Bu çalışma [modüller arası üretim planının](AI-MODULLER-ARASI-URETIM-PLANI-2026-10-14.md) ilk paketidir. İlk aşamada yalnız katalog incelendi; kullanıcı şirketi belirttikten sonra yalnız seçilmiş şirketin toplulaştırılmış veri taraması yapıldı. İlk denetimde yeniden başlatma yapılmadı. Sonrasında kullanıcının “yapalım” onayıyla yerel API/worker/web yeni derlemeye geçirildi; ayrıntılar bölüm 6'da. Elle mali kayıt/aktarımı onaylayan kayıt değiştirilmedi; doğrulama için AI sağlayıcısı çağrısı yapılmadı.

## 1. Gözlenen çalışan ortam

Kontroller yerel TekirExtra ortamına aittir; başka bir üretim ortamının durumunu kanıtlamaz.

| Kontrol | Gözlem | Kanıtın sınırı |
|---|---|---|
| API `:3001/health/ready` | `ready`; veritabanı, Redis ve depo `ok` | İş akışı ve AI doğruluğu testi değildir |
| Web `:3100/giris` | HTTP 200 | Yeni ekranların yayınlandığını tek başına kanıtlamaz |
| Worker `:9464/health` | `worker: ready` | Zamanlanmış işin vaktinde başarılı çalıştığı kanıtlanmadı |
| TekirExtra PostgreSQL/Redis/MinIO/Mailpit konteynerleri | Çalışıyor, sağlıklı | Diğer uygulama yığınları bu envantere karıştırılmadı |
| PostgreSQL | 16.13, hedef `tekirextra` | Katalog salt okunur işlemle denetlendi |
| Prisma geçişleri | 238 tamamlanmış, 0 tamamlanmamış; migrate status güncel | Son tamamlanma: 14 Ekim 14:28:53 İstanbul |
| `tenant_id` kapsamlı tablo | 185 | Bilinçli dört istisna aşağıda açıklanmıştır |
| Beklenen RLS/FORCE/politika eksikliği | Yok | Politika içeriklerinin ve tüm API yetkilerinin tam denetimi değildir |
| Doğrulanmamış yabancı anahtar | 0 | Semantik iş tutarlılığının tamamını kanıtlamaz |

Katalog çıktısı 14 Ekim 20:32:17 İstanbul zamanında alındı. Bilinçli RLS istisnaları mevcut kabul testleriyle aynıdır: `auth_kimlikler`, `oturumlar`, `eposta_dogrulamalar`, `mevzuat_talepleri`. İstisna olmak herkese okuma izni anlamına gelmez; mevcut kimlik/platform erişim tasarımı korunur.

### Çalışan süreç ile derlenmiş kod ayrımı

İstanbul saatine göre:

- API süreci 09:08:17, web 09:09:45, worker 09:23:43'te başlamış.
- API ve worker `dist` ana dosyaları 19:26:18'de üretilmiş.
- Web `.next/BUILD_ID` dosyası 09:07:14'te üretilmiş; kimliği `xqKjlIRzbKTcJ5NGtLR7_`.

API/worker süreçleri son derlemeden önce başladığı için son derlemenin çalışan süreçlere yüklendiği kabul edilmez. Çalışan commit/build kimliği ayrıca kanıtlanmamıştır. Yeni çek/fiyat özellikleri için yayın kabulü hâlâ gereklidir. Yeniden başlatma bu salt okunur çalışma kapsamında yapılmadı.

## 2. Hazırlanan güvenli envanter aracı

Araç: [ai-hazirlik-envanteri.mjs](../apps/api/scripts/ai-hazirlik-envanteri.mjs) ve [sorgu/koruma yardımcıları](../apps/api/scripts/ai-hazirlik-envanteri.lib.mjs).

`apps/api` dizininden:

```bash
node scripts/ai-hazirlik-envanteri.mjs --metadata-only
node scripts/ai-hazirlik-envanteri.mjs --tenant-id <seçilmiş-şirket-UUID>
```

- Varsayılan veya bütün şirketleri tarayan mod yoktur; şirket UUID'si açıkça seçilir.
- Yalnız `tekirextra` veritabanı adı kabul edilir. Bu ad kontrolü sunucu/ortam kimliğini tek başına kanıtlamaz; `.env` hedefi operasyon tarafından doğru ortamla eşleştirilmelidir.
- Her işlem ilk sorgudan önce `READ ONLY` olur; sorgu başına 10 saniye sınırı ve 120 saniye işlem sınırı vardır.
- Şirket taraması yalnız uygulama bağlantısını kullanır; superuser veya `BYPASSRLS` rolünü reddeder. Şirket bağlamı ve SQL tenant filtresi birlikte kullanılır.
- Katalog modu yönetim bağlantısını kullanabilir; bu mod ticari tablolardan kayıt okumaz.
- JSON yalnız standart çıktıya yazılır; ERP veya dosya yazımı yoktur. Çıktıyı paylaşmadan önce şirket UUID'si/yapılandırma metadata'sı için paylaşım yetkisi kontrol edilir.
- Şirket taramasında adet, tarih aralığı, veri olan ay sayısı, boş alan sayıları ve sabit durum/döviz grupları çıkarılır. Ham fatura/çek/hesap numarası, isim, tutar, belge içeriği veya görsel raporlanmaz.
- API anahtarı, adres ve serbest metin ayarları seçilmez. CLI sağlayıcı/anahtar-var bilgisi çalışan sunucunun veya şirket BYOK ayarının kanıtı değildir.

21 profil stok, kesin alış/satış faturaları ve satırlar, kapamalar, alış sipariş/irsaliyeleri, çek/senet, bütçe, satın alma, banka ekstresi, üretim, CRM, masraf ve projeyi kapsar. Bu başlangıç taraması POS/pazaryeri/B2B/personel/mevzuat/sevkiyatın ayrıntılı veri envanteri değildir; bu modüller seçilirse profiller genişletilmelidir.

## 3. Test sonuçları

- 11 birim testi geçti: kapsam zorunluluğu, UUID/veritabanı kontrolü, 21 profilin mevcut şemayla eşleşmesi, parametreli şirket filtresi, üst belge şirket eşitliği, salt okunur işlem sırası, RLS atlayan rolün reddi, gizli değerlerin rapora alınmaması, şirket AI ayarının güvenli alan seçimi ve temkinli yeterlilik sınıflaması.
- 3 gerçek PostgreSQL kabul testi geçti: katalog denetimi; rastgele, mevcut olmayan şirket bağlamında 21 sorgunun boş sonuç vermesi; hiçbir satıra dokunmayan yazma komutunun dahi PostgreSQL `25006` ile reddedilmesi.
- Kabul testleri şirket/test kaydı oluşturmaz veya silmez. Yazma testi `DELETE ... WHERE FALSE` kullanır ve READ ONLY tarafından reddedilir.

```bash
pnpm exec vitest run src/ai/kalite/ai-hazirlik-envanteri.test.ts
pnpm exec vitest run --config vitest.kabul.config.ts test/ai-hazirlik-envanteri.kabul.test.ts
```

Uygulama davranışı, Prisma şeması veya geçiş değişmediği için bu adımda API/web yeniden derlenmedi. Yeni CLI dosyalarının sözdizimi ve yardım komutu ayrıca doğrulandı. Canlı model çağrısı yapılmadı.

## 4. Seçilmiş şirket — 20:40:49 İstanbul taraması

Kullanıcı seçimi: **1234567801 — TEKİR EKTRA ÖN MUHASEBE**. VKN üzerinden tam eşleşme sağlandı; kayıtlı unvanın sonunda boşluk bulunması dışında ad uyumlu. Şirket kimliği `66d60ea8-0a3e-44e1-8f87-be3ddb65fc18`. Kimlik eşleştirmesi yönetim bağlantısında yalnız bu VKN'nin id/unvan/VKN alanlarıyla yapıldı; 21 iş profili RLS uygulama rolünde READ ONLY çalıştı. Diğer şirketlerin ticari kayıtları taranmadı.

| Profil | Adet | Tarih/ay gözlemi | Önemli eksiklik veya kapsam |
|---|---:|---|---|
| Stok kartı | 38 | Oluşturma: Eylül–Ekim 2026 | 37 tedarik süresi ve 37 güvenlik stoğu boş; ana birim tam |
| Stok hareketi | 338 | 15 Eylül–14 Ekim 2026, 2 ay | Stok/miktar/girilen birim boşluğu yok |
| Stok–tedarikçi bağı | 10 | Tarih alanı yok | 10 tedarik süresi, 3 alış fiyatı boş |
| Kesin alış faturası | 8 | 15 Eylül–14 Ekim 2026, 2 ay | Tamamı TRY; 3 vade tarihi boş |
| Kesin alış satırı | 18 | Üst fatura dönemi, 2 ay | Stok/miktar/birim tam; 12 varyant boş (varyantsız üründe normal olabilir) |
| Kesin satış faturası | 121 | 16 Eylül–13 Ekim 2026, 2 ay | 16 vade boş; 110 TRY, 9 USD, 2 EUR |
| Fatura kapaması | 86 | Oluşturma: Eylül–Ekim 2026 | Fatura/tutar boşluğu yok; tam ve doğru kapanış ayrıca sınanmalı |
| Alış siparişi | 3 | Eylül 2026 | Üçünün de teslim süresi boş; 1 onaylandı, 1 kısmen kapandı, 1 kapandı |
| Alış irsaliyesi | 10 | Eylül 2026 | 3 kaynak belge bağı boş; 4 iptal, 1 taslak, 3 onaylandı, 2 kapandı |
| Çek/senet | 5 | Vade: 29 Ekim 2026–25 Ocak 2027 | Hepsi alınan TRY çek; 3 ciro, 1 tahsil, 1 karşılıksız; 4 hesap numarası boş |
| Bütçe | 1 | Oluşturma: Eylül 2026 | Onaylı; detay satırları ve gerçekleşen eşleşmesi bu taramada ölçülmedi |
| Satın alma talebi | 7 | Oluşturma: Eylül–Ekim 2026 | İhtiyaç tarihleri tam; 2 onay bekliyor, 1 onaylandı, 1 reddedildi, 2 siparişe dönüştü, 1 iptal |
| Satın alma teklifi | 4 | Oluşturma: Eylül 2026 | 3 geçerlilik tarihi ve 1 teslim süresi boş; 3 TRY, 1 USD |
| Banka ekstresi satırı | 12 | Ocak–Şubat 2026 | Hepsi eşleşti; 9 cari, 10 fatura bağı boş (eşleşme türüne göre normal olabilir) |
| Üretim emri | 17 | 30 Eylül–28 Ekim 2026 | 3 planlanan bitiş, 9 tamamlanma tarihi boş; 8 tamamlandı, 6 iptal, 3 diğer aktif aşamalarda |
| Üretim operasyonu | 10 | Planlanan başlangıç: Eylül–Ekim 2026 | 5 fiili başlangıç ve 5 bitiş boş; 5 tamamlandı, 4 iptal, 1 planlandı |
| Üretim bildirimi | 9 | 30 Eylül–3 Ekim 2026 | 1 mamul birim maliyeti boş |
| Üretim sarfı | 39 | Bu profilde tarih yok | Miktar/birim maliyet boşluğu yok |
| CRM fırsatı | 4 | Oluşturma: 13 Ekim 2026 | Hepsi yeni lead; kapanış tarihinin boş olması bu aşamada normal |
| Masraf | 27 | 31 Ocak 2026–1 Eylül 2027, 15 tarih ayı | Hepsi onaylı; 17 belge no, 27 proje bağı boş; ileri tarihlerin iş anlamı doğrulanmalı |
| Proje | 1 | Oluşturma: 10 Ekim 2026 | Aktif; hedef gelir/gider tam; proje bağlı masraf yok |

Ay sayısı takvimde veri bulunan ay sayısıdır, yeterli geçmiş veya süreklilik kanıtı değildir. Özellikle masrafların 2027'ye uzanması geçmişte 15 aylık gerçekleşen veri olduğu anlamına gelmez. İptal/taslak/gelecek tarihli kayıtlar tahmin eğitimine gerçekleşen işlem gibi alınmamalıdır. Eksik hesap/belge/proje/varyant alanlarına tahmini değer yazılmadı.

### AI yapılandırması bulgusu

- Şirket sağlayıcısı `gemini`; özellikler açık, günlük çağrı sınırı 1000, aylık maliyet bütçesi tanımlı değil.
- Genel/ekonomik/güçlü model alanları boş. Genel modelin boşluğu tek başına arıza değildir; kaynak koddaki factory sağlayıcı varsayılanını kullanabilir.
- Eski yurt dışı onay tarihi 14 Ekim 09:37:44 İstanbul olarak mevcut, ancak onayın sağlayıcı/model/politika alanlarının üçü de boş.
- Yeni kaynak kodu onayı tarih + etkin sağlayıcı + etkin model + `2026-10-v1` politika eşleşmesiyle doğrular ([kiraci-saglayici.ts](../apps/api/src/ai/saglayici/kiraci-saglayici.ts)). Bu metadata yeni koddaki dış sağlayıcı onayını karşılamaz. Çalışan eski sürümün davranışı veya geçerli API anahtarı bu okumadan kanıtlanamaz.
- Yönetici Ayarlar → Yapay Zeka ekranında sağlayıcı/modeli doğrulayıp veri aktarım onayını kendisi yenilemelidir; onay alanları otomatik doldurulmadı. Anahtar okunmadı, çözülmedi, çağrı yapılmadı.

### Modül bazında ön pilot kararı

| Alan | Ön karar | Gerekçe / önce yapılacak |
|---|---|---|
| Son alış / tedarikçi fiyat karşılaştırması | Kurala dayalı sınırlı pilot adayı | 18 satırda birim/stok tam; aynı ürün/varyant/birim/dövizde çoklu tedarikçi ve pozitif fiyat/miktar eşleşmesi ayrıca ölçülmeli. İki tedarikçi varmış gibi sonuç üretilmez |
| Yıllık fiyat artışı | Geçmiş veri toplama gerekli | Kesin alış geçmişi yalnız Eylül–Ekim 2026; önceki 12 aylık dönem yok. İki 12 aylık dönem karşılaştırmasının sonucu uydurulamaz; doğrulanmış eski faturalar gerekir |
| Stok mevcut durum / hareketsizlik | Kurala dayalı sınırlı pilot adayı | 338 hareket mevcut, fakat geçmiş yaklaşık bir ay; mevsimsellik ve uzun vadeli talep tahmini için yeterli değil |
| Stok sipariş zamanı / güvenlik stoğu | Veri tamamlama gerekli | 37/38 stokta tedarik süresi ve güvenlik stoğu, 10/10 stok–tedarikçi bağında tedarik süresi boş |
| Çek vade tablosu | Mevcut kurala dayalı davranış açıklanabilir | 5 çekin tümü mevcut açık vade filtresi dışında: ciro/tahsil/karşılıksız. Açık vade tablosunun boş olması tek başına hata değil ([cek-vade-analizi.ts](../apps/api/src/kasa-banka/cek-vade-analizi.ts)) |
| Çek hatırlatma / OCR | Canlı iş akışı kabulü gerekli | Açık durumlu çek yok; gerçek kullanıcı görseli, hatırlatma ayarı/worker/teslim kanıtı bu taramada sınanmadı. Test için mali kayıt otomatik oluşturulmadı |
| Nakit akışı / tahsilat | Eksiklik uyarılı kurala dayalı pilot adayı | 121 satış, 8 alış, 86 kapama var; toplam 19 faturanın vadesi boş. Dövizler ayrı kalmalı; kapanış ve ödeme kaynaklarının tamlığı ayrıca doğrulanmalı |
| Satın alma / tedarikçi teslim değerlendirmesi | Veri tamamlama gerekli | 3 siparişte teslim süresi yok, 4 teklifin 3'ünde geçerlilik yok; gerçekleşen teslim ilişkisinin doğruluğu ölçülmedi |
| Banka eşleşmesi açıklaması | Sınırlı pilot adayı; yeni veri gerekli | 12 eşleşmiş satır Ocak–Şubat dönemi; cari/fatura bağı boşluğu eşleşme türüyle açıklanmalı, yakın dönem kapsaması yok |
| Bütçe/masraf | Kapsam ve tarih doğrulaması gerekli | 1 bütçe, 27 onaylı masraf; ileri tarih ve kategori/bütçe gerçekleşen ilişkisi alan uzmanıyla doğrulanmalı |
| Üretim | Kaynaklı durum özeti pilot adayı | Reçete/sarf bağlantı hacmi var; kapasite, fire ve maliyet tahminleri için gerçekleşen/iptal ayrımı ve eksik maliyet doğrulanmalı |
| CRM/proje | Kayıt özeti pilot adayı; tahmin ertelenmeli | 4 yeni fırsat ve 1 proje sonuç/başarı modeli kurmaya yetmez |

Bu kararlar öneridir; kullanıcı/alan uzmanının pilot kabulü ve çalışır sürüm doğrulaması olmadan üretim onayı sayılmaz.

## 5. Kalan doğrulamalar

1. Şirket seçimi ve kimlik eşleştirmesi tamamlandı; başka şirket/test firmaları karıştırılmadı.
2. Seçilmiş şirket için uygulama rolüyle 21 profil çalıştırıldı; yukarıda yalnız toplulaştırılmış sonuçlar kaydedildi.
3. Tedarikçi fiyat analizi için iki 12 aylık dönem sürekliliği, stok/varyant/birim/döviz eşleşmesi ve sipariş–teslimat bağları alan uzmanıyla incelenir. `kaynakBelgeId` doluluğu tek başına sipariş teslim süresini kanıtlamaz.
4. Stok ve nakit tahminleri için gerçekleşen/etiket verisi, tarih düzenliliği, açık/kapalı kayıtların anlamı, kritik eksiklikler ve gerçek iş eşikleri ayrıca doğrulanır. `createdAt` kayıt oluşturma tarihidir; işlem tarihi yerine kullanılmaz. Çek profilindeki tarih vadedir.
5. Seçilmiş şirketin AI özellik/sağlayıcı/model/onay/kota metadata'sı değerlendirilir. Canlı sağlayıcı denemesi, maliyet ve veri aktarımı için ayrıca yetkilendirilmiş test gerekir.
6. Çalışan sürüm ve yayın kanıtı tamamlanır; gerekiyorsa kontrollü yayın/yeniden başlatma ayrı onayla yapılır. Worker görevleri ve hatırlatma teslimi ayrıca sınanır.
7. Ürün sahibinin seçtiği modüller için pilot/ertelenecek özellik kararı ve veri tamamlama listesi hazırlanır.

Boş olmayan kayıt sayısı veya az null alan tahmin başarısı değildir. Sıfır/negatif değerlerin iş anlamı, mükerrerlik, ilişki doğruluğu, etiket güvenilirliği, zaman içinde boşluklar ve model hata oranı bu basit sayımlarla ispatlanmaz. Bu nedenle araç hiçbir modüle “AI üretime hazır” sonucu vermez.

P0-01 henüz tamamlandı işaretlenmemiştir. Şirket seçimi ve ilk veri yeterliliği taraması tamamlandı; ayrıntılı ilişki/gerçekleşen doğrulaması ve pilot kabulü açık. Yerel yayın kanıtı bölüm 6'da eklendi; dış/başka bir üretim ortamı doğrulanmış sayılmaz. AI onayının yönetici tarafından yeni sürümde yenilenmesi ve veri eksikliklerinin gerçek belgelerden tamamlanması önerilir; P0-02 ve sonraki paketler bu çalışmada uygulanmadı.

## 6. Kullanıcı onayıyla yerel sürüm geçişi — 14 Ekim akşamı

Kullanıcının ilk yenilemesi veritabanında 20:44:59 İstanbul zamanında onay tarihini değiştirmiş, fakat sağlayıcı/model/politika alanlarını boş bırakmıştı. Bu sonuç yeni kaynak/derleme davranışıyla uyuşmuyordu. Eski web derlemesinde `2026-10-v1` ve `politikaSurumu` alanları da yoktu. Bunun üzerine kullanıcı yeni sürümü devreye almayı onayladı.

- API `NODE_OPTIONS=--max-old-space-size=4096 pnpm build` başarılı.
- Web `NEXT_DIST_DIR=.next-onay-release-20261014 NODE_OPTIONS=--max-old-space-size=4096 pnpm build` başarılı; mevcut `.next` korunarak ayrı klasörde derlendi. Next'in otomatik route-type/tsconfig güncellemeleri mevcut kullanıcı değişiklikleriyle birlikte korundu; yeni derleme klasörü `.gitignore`'a eklendi.
- Onay/sağlayıcı hedefli 14 birim testi ve salt okunur envanterin 3 gerçek PostgreSQL kabul testi geçti.
- Doğrulanmış eski süreçlere SIGTERM gönderildi; zorla öldürme yapılmadı. Yeni süreçler eski süreçlerin ortam ayarları bellekte korunarak başlatıldı; anahtarlar/ortam değerleri yazdırılmadı.
- API PID `1002477` başlangıç 21:05:03; worker PID `1002805` başlangıç 21:05:18; web PID `1004330` başlangıç 21:06:29 (İstanbul). Süreçler doğrudan Node/Next olarak çalışıyor; sistem servisi/PM2 kurulmadı. Makine yeniden başlatma sonrası otomatik açılış bu işlemin kapsamı değil.
- 21:06:50'de API ready (DB/Redis/depo ok), worker ready ve `/giris` HTTP 200 doğrulandı. Worker sağlığı bütün zamanlanmış işlerin başarılı çalıştığının kanıtı değildir; etkin worker olağan işleyişine döndü, ayrıca manuel iş tetiklenmedi.
- Yeni web build kimliği: `HHO2l4Gd3apxislfgXsRS`.
- Yeni onay ekranı chunk'ı `page-41538b3d5db544c8.js`: hem güncel politika metni hem `politikaSurumu` parametresi içeriyor. HTTP ile sunulan dosya ve yerel derlemenin SHA-256 değeri aynı: `dc4b8f3bdc735dd73ff06492084dcef3f1bc0fc8a27eec5b1935f5f71525ef0e`.
- Yardımcı başlatma betiği/logları geçici `/tmp/tekirextra-onay-yayin-p9GGJz` klasöründe; kalıcı işletim/runbook kurulumu değildir.

Sonraki adım: Yönetici tarayıcıda sert yenileme yaparak Ayarlar → Yapay Zeka ekranındaki güncel kapsamı okumalı, aktarım onayını kendisi vermeli. Ardından aynı şirketin onay sağlayıcı/model/politika alanları salt okunur yeniden kontrol edilmeli. Kullanıcı adına onay endpoint'i çağrılmadı, onay alanları elle doldurulmadı, canlı Gemini testi yapılmadı. Oturum açmış yöneticinin tam onay akışı henüz doğrulanmış değildir.

Sonraki doğrulama: Kullanıcı yeniden onayladıktan sonra 21:11:04 İstanbul tarihli kayıtta sağlayıcı `gemini`, model `gemini-2.5-flash` ve politika `2026-10-v1` bulundu. Seçilmiş şirketin metadata eşleşmesi sağlandı; önceki boş alan sorunu giderildi. Bu, canlı sağlayıcı bağlantısının/model yanıtının başarılı olduğunu kanıtlamaz; Gemini çağrısı yapılmadı.
