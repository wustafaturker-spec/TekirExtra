# Platform Modülü — P0 Düzeltme İmalat Planı

**Tarih:** 31 Ekim 2026  
**Sürüm:** 2.0 — kapsam daraltma revizyonu  
**Durum:** S-01 onayı 2026-10-31. Tamamlanan: PLT-29 (93e2b9d), PLT-26 (ca2e3fd), PLT-31 (63e26d5), PLT-25 (03abef5; yayında platform kullanıcıları bir kez yeniden giriş yapar), PLT-30 (ce75c40), PLT-27 (252ef20; iki adım tek commit'te, dosyalar ortak), PLT-28. P0 geliştirmesi tamamlandı; pilot yayını bekliyor.  
**Uygulama kapsamı:** Yalnız PLT-25–PLT-31 (PLT-25–30 = eski K01–K06; PLT-31 bu revizyonda eklendi).  
**Ayrı belge:** [Önerilen küçük P1 ve ihtiyaç odaklı yol haritası](PLATFORM-KURUMSAL-YONETIM-YOL-HARITASI-2026-10-31.md).

## 1. Revizyon kararı ve kapsam sınırı

Önceki 25 paketlik belge, küçük ekip ve pilot ölçeği için gereğinden geniş bir açık iş listesi oluşturuyordu. Bu sürüm yalnız kodda karşılığı bulunan yedi güvenlik/veri tutarlılığı düzeltmesini imalat kapsamına alır. Diğer özellikler ayrı yol haritasına taşınmıştır; otomatik geliştirme taahhüdü değildir.

- PLT-27 atomiklik ve tekrar korumasıyla sınırlıdır; outbox P0 şartı değildir.
- PLT-26 somut olay kanıtları ve varsayılan kapalı mevzuat görünürlüğüyle uygulanır.
- PLT-30 iki sekmede doğrulanan sır ile saklanan sırrın ayrışması yarışını açıkça kapsar.
- P1 önerisi yalnız yalın finans/destek rolleri, denetim kategorisi/takip kimliği, sunucu sayfalaması ve JSON dışı hata yanıtlarıdır.
- Modül taşıma, genel onay motoru, SSO/SAML, SLA, özellik bayrakları, outbox ve diğer kurumsal özellikler bu teslimin bağımlılığı değildir.
- Kesin süre verilmez. Migration, çok süreçli iptal ve gerçek veritabanı yarış testleri ayrıştırıldıktan sonra tahmin yapılır.

[ISTERLER.md](ISTERLER.md) içindeki S-01 kuralı uyarınca modül isterleri geliştirme öncesinde ürün sahibiyle son hâliyle gözden geçirilir. Bu revizyon talebi doküman düzenlemesini yetkilendirir; kodlama veya yayın onayı olarak kaydedilmez. Aşağıdaki numaralar ister taslağı olarak ayrılmıştır.

## 2. Numaralandırma ve izlenebilirlik

Projede mevcut platform dizisi PLT-24’te bitmektedir. Paralel PLT-K dizisi kaldırılmıştır; eski kodlar yalnız geçmiş konuşma/doküman eşlemesidir.

| Eski referans | Güncel ister taslağı | İş |
|---|---|---|
| K01 | PLT-25 | Kalıcı oturum iptali |
| K02 | PLT-26 | Denetim görünürlüğü |
| K03 | PLT-27 | Atomiklik ve ödeme tekrar koruması |
| K04 | PLT-28 | Mevzuat sürüm ve yarış kontrolü |
| K05 | PLT-29 | Takvim tarihi doğrulaması |
| K06 | PLT-30 | Davet ve 2FA kurulum güvenliği |
| — (PLT-24 bilinen açığı; eski K07 kabulündeydi) | PLT-31 | Rol düşürmede platform görevi aktarımı |

## 3. Korunacak mevcut davranışlar

Ayrı platform/kiracı JWT anahtarları ve veritabanı yetkileri; mevzuatın dört göz ilkesi, yayın kilidi ve değişmezlik tetikleyicileri; PLT-24 görev kapsamı ve sürüm kontrolü; son aktif yönetici koruması; şifreli sağlayıcı ayarları; izinli/süreli/salt okunur destek erişimi korunur. Arayüzde istek iptali, taslak koruma ve bölüm bazında yeniden deneme sürer.

## 4. P0 iş paketleri

### PLT-25 — Kalıcı oturum iptali ve güvenlik sürümü

**Kod kanıtı ve bulgu:** Platform JWT'sinde oturum sürümü yoktur. 2FA sıfırlanırken kurulum bekleyen hesap engellenir; yeniden kurulum tamamlandığında süresi dolmamış eski token tekrar kabul edilebilir. Çıkış, sunucuda token iptali yapmaz.

**İmalat:**

- Platform kullanıcılarına oturum sürümü, platform oturumlarına benzersiz oturum kimliği ekle.
- Token'a sürüm ve oturum kimliğini yaz; guard'da güncel kayıtla doğrula.
- 2FA sıfırlama, rol değişikliği, pasife alma ve tüm oturumları kapatmada sürümü artır. Platformda bugün parola kurtarma akışı yoktur (parola yalnız davetle belirlenir); ileride eklenirse aynı kural uygulanır.
- Normal çıkışta ilgili oturumu iptal et; sunucu işlemi tamamlandıktan sonra yerel token ve rota çerezini temizle. Ağ kesintisinde yerel çıkış gerçekleşsin, sunucu iptalinin doğrulanamadığı açıkça belirtilebilsin.
- Çok süreçli dağıtımda önbellek geçersizleştirmeyi tanımla; sunucuda iptal edilen oturumun tüm API süreçlerinde en geç 10 saniyede reddedilmesini hedefle.
- Geçişte sürüm taşımayan eski platform token'larını kontrollü biçimde geçersiz kıl.

**Kabul/test:** Aynı token 2FA sıfırlama öncesinde çalışır, sıfırlama ve yeniden kurulumdan sonra çalışmaz. Çıkış yapılan token API'ye yeniden gönderildiğinde reddedilir. Tek oturum kapatma diğer oturumu etkilemez; tümünü kapatma hepsini etkiler. İki API sürecinde iptal süresi ölçülür.

**Bağımlılık:** Yok. **Öncelik:** P0. **Ana alan:** Auth, platform kullanıcı modeli, web oturum istemcisi.

**Yeniden kullanılacak bileşen:** Kiracı tarafındaki oturum sürümü yaklaşımı, `auth.guard.ts`, platform giriş/çıkış controller’ları, mevcut 10 saniyelik durum önbelleği ve platform çerez/token istemcisi. Kiracı oturum kayıtları platform hesabıyla paylaşılmaz.

### PLT-26 — Denetim kayıtlarında yetki sızıntısını kapatma

**Kod kanıtı ve bulgu:** Editörün denetim sorgusu yönetici olaylarını `notIn` listesiyle çıkarır. Destek, kullanıcı yönetimi, ödeme sağlayıcısı ve fatura ayarı gibi olaylar listede bulunmadığı için editörün sorgusundan dışlanmaz. Kaynak: `platform-mevzuat.service.ts:26,280–284`.

**Somut olay kanıtı:** Aşağıdaki adlar filtre listesinin dışında kalır; kayıt varsa editöre dönebilir. Olay aileleri somut adlarla açılmıştır:

- `abonelik_saglayicisi_guncellendi`, `abonelik_fatura_ayari_degisti`.
- `platform_rolu_degisti`, `platform_kullanicisi_acildi`, `platform_kullanicisi_aktif_edildi`, `platform_kullanicisi_pasife_alindi`.
- `platform_daveti_yenilendi`, `platform_daveti_kabul_edildi`.
- `platform_2fa_sifirlandi`, `platform_2fa_yeniden_kuruldu`.
- `destek_oturumu_acildi`, `destek_oturumu_kapatildi`, `destek_istegi`.
- `giris`, `giris_basarisiz`, `sistem_alarmi`, `kuyruk_isi_yeniden_denendi`.

Olay üreticileri: platform kullanıcı/firma/auth servisleri, `auth.guard.ts`, ödeme sağlayıcısı/fatura ayar servisleri ve sistem sağlığı servisi. Bu liste veritabanında tüm bu kayıtların bulunduğu iddiası değildir; mevcut sorgunun erişim sonucunu gösterir.

**İmalat:**

- Mevcut olay türleri için açık mevzuat izin listesi ve varsayılan kapalı davranış tanımla; genel kategori/takip kimliği genişletmesini sonraki P1 adayına bırak.
- Editöre yalnız izin verilen mevzuat olaylarını göster; bilinmeyen olayları varsayılan olarak kapalı tut.
- Mevcut liste ve detay erişimlerinde aynı görünürlük kuralını uygula; gelecekte sayım/dışa aktarma eklenirse aynı filtreyi kullanması zorunlu olsun. P0’da yeni uç açma.
- Olay ayrıntılarındaki hassas alanları role göre maskele; gizli anahtar, parola, TOTP sırrı ve token kaydetme.
- Mevcut olay türlerini sınıflandır; sınıflandırılamayan geçmiş kayıtları yöneticilere sınırla.

**Kabul/test:** Editör firma, destek, finans, kullanıcı ve sağlayıcı yönetim olaylarını doğrudan API çağrısıyla da alamaz. Yeni ve sınıflandırılmamış olay editöre görünmez. Yetkisiz olayların sayıları da sızmaz.

**Bağımlılık:** Yok; gelecekteki P1 izin altyapısını beklemez. **Öncelik:** P0.

**Yeniden kullanılacak bileşen:** `PlatformMevzuatService.olaylar`, mevcut `mevzuatOlay` modeli ve denetim ekranı; P0 için yeni genel izin motoru veya yeni olay deposu kurulmaz.

### PLT-27 — Mali işlemlerde atomiklik ve tekrar koruması

**Kod kanıtı ve bulgu:** Elle ödeme/dönem uzatma ile platform olay kaydı ayrı işlemlerdedir. Olay yazımı hata verirse istemci hata alırken ödeme tamamlanmış olabilir; tekrar deneme ikinci kayıt ve uzatma oluşturabilir. Plan, durum, AI tavanı ve bazı ayar değişikliklerinde de olay yazımı ayrıdır.

**İmalat:**

- Ödeme, dönem değişikliği ve platform denetim kaydını aynı PostgreSQL transaction'ında tamamla. `platform_odeme_kaydet` çağrısı ve `mevzuatOlay.create` aynı `$transaction` istemcisinde çalışabilir; alternatif olarak aktör/olay yazımı SQL fonksiyonuna alınabilir. Tek yaklaşım seç, aynı olayı iki yerde yazma.
- Elle ödeme isteğine benzersiz işlem anahtarı ekle. Anahtarı aktör, firma, işlem türü ve istek özetiyle ilişkilendir.
- Aynı anahtar ve aynı içerikte ilk sonucu döndür; farklı içerikte 409 üret. Eşzamanlı istekleri benzersiz veritabanı kısıtıyla koru.
- İşlem anahtarı mali kayda bağlı kalıcı referans olsun; saklama süresi dolduğu için aynı ödemenin tekrar işlenmesine izin verme.
- Para değerlerini ondalık/kuruş hassasiyetinde işle; istemci kayan nokta hesaplarına güvenme.
- Plan, askı, talep kararı, AI tavanı, kullanıcı ve sağlayıcı/fatura ayarı değişikliklerini olay kaydıyla atomik hâle getir.
- **Teslim sırası:** önce mali risk taşıyan ödeme/dönem atomikliği ve işlem anahtarı (ayrı commit ve kabul testi), ardından diğer yazımların olayla atomikliği. İkinci adım ilkini bekletmez; ilk adım tek başına pilota çıkabilir.
- Bu P0 akışında harici çağrı yoktur; outbox kurulması veya worker/faturalama mimarisinin değiştirilmesi teslim şartı değildir. Mevcut PLT-20–23 faturalama davranışı regresyonla korunur. Kalıcı teslimat/outbox ihtiyacı ayrı bildirim adayı kapsamında değerlendirilir.
- Erişim önbelleği geçersizleştirmesini başarılı commit sonrasına bağla.

**Kabul/test:** Olay kaydı hatasında ödeme ve dönem değişmez. Yanıt kaybolduktan sonraki aynı istek tek ödeme üretir. Aynı anda aynı anahtarla gönderilen istekler tek mali etki yaratır. Mevcut ödeme–fatura/tahsilat tekilliği regresyon testleri geçer. Outbox ve yeni teslimat güvencesi bu paketin kabul kapsamı değildir.

**Bağımlılık:** Yok; outbox veya yeni bildirim merkezi gerektirmez. **Öncelik:** P0.

**Yeniden kullanılacak bileşen:** `platform_odeme_kaydet`, mevcut abonelik SQL fonksiyonları, `PlatformPrismaService.db.$transaction`, `mevzuatOlay`, mevcut ödeme/faturalama servisleri ve para yardımcıları. İkinci ödeme defteri açılmaz.

### PLT-28 — Mevzuatta sürüm ve eşzamanlılık kontrolü

**Kod kanıtı ve bulgu:** Mevzuat başlığı, kalemleri ve senaryoları görevlerdeki gibi sürüm taşımıyor. Eski taslak yeni kaydı ezebilir. Taslak kontrolü ile durum geçişi arasında yarış ihtimali bulunuyor.

**İmalat:**

- Mevzuat değişikliğine `surum` ekle; tüm düzenleme ve durum geçişlerinde beklenen sürümü zorunlu kıl.
- Başlık, kalem, senaryo ve durum işlemlerini aynı üst kayıt kilidiyle sırala; sürümü transaction içinde doğrula/artır.
- Eski sürüme 409 döndür; arayüzde kullanıcının taslağını koru ve güncel kayıtla karşılaştırma sun.
- Yayın kilidini, dört göz ilkesini ve veritabanı değişmezlik tetikleyicilerini koru.

**Kabul/test:** İki editörün aynı sürümden yaptığı kayıttan biri kazanır; diğeri 409 alır. Kalem düzenleme/onaya gönderme/yayın yarışında onaylanan içerik sonradan değişmez. Başlık kaydı diğer bölümün taslağını silmez.

**Bağımlılık:** Yok. **Öncelik:** P0.

**Yeniden kullanılacak bileşen:** PLT-24 görev merkezindeki sürüm/409 yaklaşımı, mevcut mevzuat transaction’ları, yayın kilidi ve değişmezlik tetikleyicileri; web taslak koruma davranışı.

### PLT-29 — Ortak ve kesin takvim tarihi doğrulaması

**Kod kanıtı ve bulgu:** Mevzuat tarihi yalnız biçim kontrolünden geçiyor; `2026-02-31` gibi bir değer JavaScript tarafından farklı güne taşınabilir.

**İmalat:** Görevlerdeki gerçek takvim kontrolünü (`platform-gorev.controller.ts` içindeki zod `refine`) ortak yardımcıya taşı. Mevzuat ve görev uçlarının oluşturma, güncelleme ve sorgu parametrelerinde kullan (platformda mevzuat içe aktarma ucu yoktur). Tarih-only değerler ile zaman damgalarını ayır; kullanıcıya gösterim ve gecikme hesabında Türkiye saat dilimini açıkça uygula.

**Kabul/test:** Geçersiz gün/ay ve artık yıl hataları 400 alır; geçerli tarihler değişmeden saklanır. UTC/Türkiye gün sınırında görev gecikmesi ve yürürlük hesabı tutarlıdır.

**Bağımlılık:** Yok. **Öncelik:** P0.

**Yeniden kullanılacak bileşen:** `platform-gorev.controller.ts` içindeki gerçek takvim doğrulaması ve shared tarih yardımcıları; ikinci bir tarih standardı oluşturulmaz.

### PLT-30 — Davet ve 2FA kurulum güvenliği

**Kod kanıtı ve bulgu:** Normal girişteki hesap bazlı deneme sınırı davet tamamlama/2FA yeniden kurulumunda yoktur. Davet bilgisi her açıldığında TOTP sırrı değişir; ikinci sekme ilk sekmenin karekodunu geçersizleştirir.

**Somut iki sekme yarışı:** A sekmesinin tamamlama isteği eski sırrı veritabanından okur ve A kodunu doğrular. B sekmesinin bilgi isteği bu sırada yeni sır yazar. A’nın son `updateMany` sorgusu yalnız davet özetini kontrol ettiği için başarıyla tamamlanır; veritabanında B sırrı kalır. Kullanıcı A karekoduyla ilk giriş yapamaz. B, A’nın ilk okumasından önce sırrı değiştirmişse A kodunun reddedilmesi beklenir; başarıyla yanlış sır saklanması iddiası bu daha dar yarış sırasına aittir.

Son `updateMany`, aktiflik ve doğrulanan sır/sürümünü de kontrol etmediğinden pasife alma ve kurulum yenileme yarışları ayrıca kapsanmalıdır.

**İmalat:**

- Davet/hesap bazında dağıtık deneme sayacı, bekleme süresi ve IP sınırını birlikte uygula. Başlangıç politikası 5 başarısız tamamlama/15 dakika; değer yapılandırılabilir olsun.
- Kurulum oturumunu sürümle. Bilgi okuma tekrarında sır değişmesin; açık yeniden başlatma eski kurulumu iptal etsin.
- Tamamlama anında aktiflik, davet özeti, süre, kurulum sürümü ve doğrulanan sır sürümünü transaction içinde yeniden doğrula; daveti tek kez tüket.
- Davet yenileme, hesap pasife alma ve eşzamanlı tamamlama yarışlarını kapat.
- Davet anahtarının URL, log, analitik ve denetim ayrıntısına sızmasını engelle; anahtar taşıma biçimini ve erişim loglarında sorgu maskelemesini düzenle.
- Davet e-postası HTML'inde kullanıcı girdilerini güvenli kaçışla yaz.

**Kabul/test:** A eski sırrı okuduktan sonra B yeni sır yazacak şekilde eşzamanlı test kurulur; A ya çakışma alır ya doğruladığı sırla tamamlanır, başarı yanıtıyla farklı sır kalamaz. Sekme yenileme mevcut karekodu bozmaz. Eski kurulum yeni kurulumdan sonra tamamlanamaz. Aynı daveti iki istekten yalnız biri tüketir. Pasife alınan veya süresi dolan davet tamamlanamaz. Deneme sınırı farklı IP'lerde de geçerlidir.

**Bağımlılık:** PLT-25. **Öncelik:** P0.

**Yeniden kullanılacak bileşen:** `GirisDenemeSayaci` (davet/hesap anahtarıyla), `totpDogrula`, mevcut davet özeti/süresi ve platform kullanıcı modeli. `main.ts` içindeki genel IP sınırı (varsayılan 300 istek/dakika) yalnız ek katmandır; davet tamamlamayı tahmine karşı korumaz ve bu paketin deneme sınırı yerine sayılmaz.

**Mevcut durum notu:** `davet/bilgi` ve `davet/tamamla` uçları anahtarı zaten gövdede alır; açık kalan sızıntı e-postadaki `/platform/davet?anahtar=…` bağlantısının sorgu parametresidir (`platform-kullanicilar.service.ts`, `baglanti`). Web erişim/proxy loglarına düşmemesi için URL parçası (`#anahtar=`) veya eşdeğer bir taşıma biçimi kullanılır.

### PLT-31 — Rol düşürmede platform görevi aktarımı

**Kod kanıtı ve bulgu:** Platform görevlerini tüm yöneticiler görür; editör yalnız mevzuat kapsamını görür (`platform-gorev.service.ts:28`). Rol değişikliği (`platform-kullanicilar.service.ts`, yetki güncellemesi) açık görevlere bakmaz. Açık platform görevi atanmış yönetici editöre düşürülünce görev hâlâ ona atanmış görünür ama kendisi göremez; görev güncellenirken aynı sorumlu gönderilirse `baglariDogrula` "yalnız yönetici atanabilir" hatası verir. PLT-24 notundaki bilinen açık budur.

**İmalat:**

- Yönetici → editör rol değişikliğinde, kişiye atanmış açık (tamamlanmamış) platform görevlerini aynı transaction'da say.
- Açık görev varsa isteğin bir aktarım hedefi (başka aktif, kurulumu tamamlanmış yönetici) taşıması zorunlu olsun; hedef yoksa 400 ile neden ve görev sayısı dönsün.
- Aktarımı rol değişikliğiyle aynı transaction'da yap; mevcut yetki kilidi (`pg_advisory_xact_lock`) içinde kalsın. Görev `surum` artsın; her görev için `platform_gorevi_guncellendi` olayına önceki/yeni sorumlu yazılsın.
- Pasife alma engellenmez ve aktarım istemez (güvenlik işlemi geciktirilmez). Sorumlusu pasif olan açık görevler `/platform/ozet` ve görev listesinde "sorumlu pasif" diye işaretlensin; yeniden atama mevcut düzenleme akışıyla yapılır.
- Arayüz: kullanıcılar ekranında rol düşürmede açık görev sayısı ve aktarım hedefi seçimi gösterilsin.

**Kabul/test:** Açık platform görevi olan yönetici, hedef verilmeden editöre düşürülemez. Hedefle düşürüldüğünde görevler hedefe geçer, sürümleri artar ve olay kaydı oluşur; işlemin herhangi bir adımı hata verirse rol de görevler de değişmez. Mevzuat görevleri aktarılmaz. Pasife alma görev olsa da başarılı olur ve özet görevi işaretler. Eşzamanlı rol değişikliği ile görev güncellemesi tutarlı sonuç verir (409 veya sıralı uygulama).

**Bağımlılık:** Yok. **Öncelik:** P0.

**Yeniden kullanılacak bileşen:** Mevcut yetki güncelleme transaction'ı ve kilidi, `PlatformGorevService` sürüm kontrolü ve `baglariDogrula`, `/platform/ozet`. Genel ekip kuyruğu kurulmaz; o konu yol haritasındaki görev/iş yükü adayında kalır.

## 5. Uygulama sırası ve tamamlanma kapısı

Önerilen sıra: PLT-29 ortak tarih doğrulaması → PLT-26 görünürlük → PLT-31 görev aktarımı → PLT-25 oturum iptali → PLT-30 kurulum yarışı → PLT-27 mali tutarlılık → PLT-28 mevzuat eşzamanlılığı. Bu sıra tahmindir; PLT-30’un PLT-25 ile uyumu dışında bağımsız işler birbirini beklemez.

Her paket için atanan kişi, migration, API sözleşmesi, değişen dosyalar, test komutları/çıktısı, açık risk, pilot sonucu ve kapanış tarihi kaydedilir. Durumlar: İster taslağı → Onaylandı → Geliştirme → Doğrulama → Pilot → Tamamlandı. Bu belgede hiçbir iş tamamlandı olarak işaretlenmemiştir.

P0 kapanışı için:

- Her yedi paketin kabul testleri ve mevcut ilgili regresyonlar geçer.
- PostgreSQL testleri gerçek transaction, kilit ve benzersizlik davranışını doğrular; mock yeterli sayılmaz.
- Gerçek HTTP guard ile eski JWT, editör erişimi ve yetki değişimi sınanır.
- Web’de çıkış, iki sekmeli davet ve mevzuat 409/taslak koruma akışı doğrulanır.
- İzole veritabanı ve sahte dış servisler kullanılır; gerçek müşteri tahsilatı veya e-posta üretilmez.
- Önce geriye uyumlu şema eklenir, veri doldurulur, API/web uyumu yayınlanır, sonra zorunlu kısıtlar etkinleşir.
- Eski token geçişi yeniden giriş gerektirir; pilotta açıkça doğrulanır.
- Geri dönüş mali kayıtları silmez; uyumlu sürüm/özellik kapatma veya ileri düzeltme adımı yazılır.

## 6. Önceki test çalıştırmasının kanıt sınırı

İlk incelemede Codex tarafından 31 Ekim 2026’da iki ayrı hedefli çalıştırma yapılmıştır. Konuşmadaki araç çıktısı ilk çalıştırmada 7 dosya/45 test, ikincide 2 dosya/6 test geçtiğini göstermektedir. Bu tarihsel öz bildirimdir; bağımsız inceleyen tarafından tekrar doğrulanmış veya bu revizyonda yeniden çalıştırılmış değildir. Kalıcı ham çıktı dosyası oluşturulmamıştır. Bu testler P0 açıklarının kapandığına kanıt değildir.

Çalışma dizini: `apps/api`.

```bash
pnpm exec vitest run src/auth/auth.guard.test.ts src/mevzuat/platform-gorev.service.test.ts src/mevzuat/platform-firma.service.test.ts src/mevzuat/platform-auth.controller.test.ts src/mevzuat/yayin-plani.test.ts src/mevzuat/bordro-kabul.test.ts src/abonelik-odeme/saglayici-ayarlari.service.test.ts --maxWorkers=2
pnpm exec vitest run src/mevzuat/platform-kullanicilar.service.test.ts src/mevzuat/platform-auth.kilit.test.ts --maxWorkers=2
```

İlk filtreleme denemesi yanlışlıkla genel API testlerini başlatmış ve kesilmiştir; tam regresyon sonucu olarak kullanılmaz. Yukarıdaki iki hedefli komut ayrı olarak tamamlanmıştır. İlk incelemede E2E ve gerçek PostgreSQL kabul testleri çalıştırılmamıştır. Uygulama tesliminde yeni test çıktıları kalıcı kanıtla eklenmelidir.

## 7. Kaynaklar ve mevcut bileşenler

- [Platform auth/işlem uçları](../apps/api/src/mevzuat/platform.controller.ts)
- [Kimlik guard’ı](../apps/api/src/auth/auth.guard.ts)
- [Platform kullanıcı servisi](../apps/api/src/mevzuat/platform-kullanicilar.service.ts)
- [Firma servisi](../apps/api/src/mevzuat/platform-firma.service.ts)
- [Mevzuat servisi](../apps/api/src/mevzuat/platform-mevzuat.service.ts)
- [Görev servisi](../apps/api/src/mevzuat/platform-gorev.service.ts)
- [AI tavan servisi](../apps/api/src/mevzuat/platform-ai-tavan.service.ts)
- [Görev merkezi davranışları](platform-gorev-merkezi.md)
- [Önceki tarihsel inceleme](PLATFORM-INCELEME-RAPORU-2026-10-24.md)
- [Ayrı yol haritası](PLATFORM-KURUMSAL-YONETIM-YOL-HARITASI-2026-10-31.md)

## 8. Dosya ve commit kapsamı

Bu revizyon yalnız bu belgeyi, ayrı yol haritasını ve ISTERLER içindeki taslak referanslarını değiştirir. Uygulama kodu değiştirilmez; commit/yayın yapılmaz. Sonradan commit istenirse yalnız bu üç dosya adıyla eklenir; `docs/` topluca eklenmez ve diğer çalışma dosyaları kapsama alınmaz.
