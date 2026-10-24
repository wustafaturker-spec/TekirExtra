# Platform Paneli İnceleme Raporu

**Tarih:** 24 Ekim 2026
**İnceleme türü:** Kod okuma + yerel veritabanında salt okuma. Kod değişikliği yapılmadı; platform
paneline giriş yapılmadı (2FA kodu gerektirir).
**Kapsam:** Tüm firmaları yöneten ekip ekranı (`/platform`), platform kimlik doğrulaması (MVZ-04),
Mevzuat Merkezi yayın akışı, yapay zekâ tavanı, abonelik yaşam döngüsü (platform tarafından
yönetilmesi gereken kısım).
**Dosyalar:** `apps/web/src/app/platform/*`, `apps/web/src/lib/platform-api.ts`,
`apps/api/src/mevzuat/{platform.controller,platform-auth.service,platform-mevzuat.service,platform-ai-tavan.service}.ts`,
`apps/api/src/platform-kullanici-olustur.ts`, `apps/api/src/tenant/abonelik.*`.

## 1. Özet

Bugünkü platform paneli aslında **Mevzuat Merkezi + yapay zekâ maliyet tavanı**: beş ekran
(Değişiklikler, Yürürlükteki değerler, Talepler, Denetim izi, Yapay zekâ tavanı). Bu dar kapsamda
güvenlik iyi kurulmuş: ayrı JWT anahtarı ve ayrı veritabanı rolü, zorunlu parola + 2FA, 30 dakikalık
oturum, yenileme yok, mevzuat yayınında dört göz kuralı ve olay kaydı.

Asıl eksik **firmaların ve aboneliklerin yönetimi**:

1. **Abonelik kendi kendine yönetiliyor ve hiçbir şeyi durdurmuyor.** Firma yöneticisi planını bir onay
   sorusuyla ödemesiz Kurumsal'a (sınırsız) geçirebiliyor; "dönem sonunda iptal" dönem bitince de
   erişimi kesmiyor; "askıda" durumu kodda denetleniyor ama bir firmayı askıya alan hiçbir yol yok.
2. **Platform firmaları göremiyor.** Hangi firmaların olduğu, planı, kullanıcı sayısı, son etkinliği,
   e-belge durumu hiçbir ekranda yok (yalnız yapay zekâ tavanı ekranında ad listesi).

Satışa (ücretli aboneliğe) geçmeden önce 1. madde kapanmalı.

## 2. Durum

| Öncelik | Madde | Durum |
|---|---|---|
| P0-1 | Abonelik denetimsiz: ücretsiz plan yükseltme, etkisiz iptal, askıya alma yolu yok (satış öncesi kapı) | Açık |
| P1-1 | Firma listesi / genel bakış yok | Açık |
| P1-2 | Platform girişinde deneme sınırı yok; başarısız denemeler kaydedilmiyor; pasif platform kullanıcısının token'ı 30 dk yaşıyor | Açık |
| P1-3 | Yapay zekâ tavanı değişikliği denetim izine yazılmıyor | Açık |
| P2-1 | Platform kullanıcı yönetimi yalnız betikle; platform rolleri yok | Açık |
| P2-2 | `/platform` sayfaları web rota korumasının dışında (veri sızmaz, arayüz kabuğu görünür) | Açık |
| P3-1 | Kayıtlı ve izinli destek erişimi (firma adına bakma) | Açık |
| P3-2 | Ödeme sağlayıcısı (KLN-08'de "ayrıca bağlanabilir") | Açık |

## 3. Bulgular

### P0-1 Abonelik denetimsiz

- `POST /abonelik/plan-degistir` firma yöneticisine açık; ödeme ya da platform onayı yok. Ekranda
  `confirm("… planına geçilsin mi? Değişiklik hemen uygulanır.")` sonrası plan değişiyor. Kurumsal
  planın bütün sınırları `null` (sınırsız).
- `POST /abonelik/iptal` yalnız `durum = iptal` yazıyor. Ekran "erişim dönem sonuna kadar sürer"
  diyor, ama dönem sonunda erişimi kesen bir iş ya da denetim yok; `limitDogrula` yalnız `askida`
  durumuna bakıyor.
- `askida` durumuna geçiren bir uç, iş ya da platform ekranı yok.
- Yerel veride 550 abonelik kaydının 549'u eski `v1` kodunda (kabul testlerinin açtığı firmalar dahil);
  `v1` sınır hesabında "Profesyonel" sayılıyor.

**Öneri:** Plan değişikliği firma tarafında **talep**e dönüşsün, platform onaylasın (ya da ödeme
sağlayıcısı bağlanınca ödemeyle). Platformda firma başına plan, dönem ve durum (aktif / askıda / iptal)
yönetimi; dönem sonu geçmiş iptal ve askıdaki firmada yazma işlemleri dursun (okuma ve dışa aktarma
açık kalsın — veriler firmanındır). Her değişiklik platform denetim izine.

### P1-1 Firma genel bakışı yok

Platform ekibi bir firmayı bulmak, planını görmek, kaç kullanıcısı olduğunu, son ne zaman
kullanıldığını, e-belge entegratörünün bağlı olup olmadığını görmek için veritabanına bakmak zorunda.

**Öneri:** `/platform/firmalar`: arama, plan ve durum, aktif kullanıcı sayısı, son giriş, e-belge
bağlantısı, yapay zekâ harcaması; firma ayrıntısında abonelik geçmişi ve P0-1 işlemleri. Platform
rolü RLS'i aşmadan yalnız özet sayıları okumalı (firma verisinin içeriğini değil).

### P1-2 Platform girişi

`PlatformAuthService.giris` yanlış denemeyi saymıyor ve kaydetmiyor; yalnız genel IP sınırı var.
Platform hesabı bütün firmaların mevzuat değerlerini değiştirebildiği için firma girişinden daha sıkı
olmalı. Ayrıca guard platform token'ını yalnız imzayla doğruluyor; pasife alınan platform
kullanıcısı 30 dakika çalışmaya devam eder.

**Öneri:** Firma tarafındaki `GirisDenemeSayaci`'nı platform girişine de uygula (daha düşük sınırla),
başarısız denemeleri `mevzuat_olaylari`'na yaz; guard'da platform kullanıcısının aktifliğini denetle.

### P1-3 Yapay zekâ tavanı denetimsiz

`tavanYaz` yalnız son güncelleyeni tutuyor; önceki değer kayboluyor, tavanın kaldırılması (`null`)
satırı sildiği için kimin kaldırdığı da kalmıyor.

**Öneri:** Her tavan değişikliği eski → yeni değerle platform olay kaydına.

### P2-1 Platform kullanıcı yönetimi

İki platform kullanıcısı var; açma `platform-kullanici-olustur` betiğiyle, pasife alma ve 2FA yenileme
yalnız veritabanından. Platform rolü yok: her platform kullanıcısı mevzuat yayınlayabilir, yapay zekâ
tavanını değiştirebilir (mevzuat yayınında dört göz kuralı bunu kısmen dengeliyor).

**Öneri:** Ekip büyüyünce: platform kullanıcıları ekranı (açma, pasife alma, 2FA sıfırlama) ve
en az iki rol (mevzuat editörü, platform yöneticisi).

### P2-2 Rota koruması

Web middleware'i yalnız `/panel/*` yollarını koruyor; `/platform/*` sayfaları giriş yapmamış
ziyaretçiye de yükleniyor. Veriler API'de korunduğu için sızma yok, ama ekran kabuğu ve menü görünüyor.

**Öneri:** `/platform/*` için de imzalı işaret çerezi.

### P3-1 Destek erişimi

Platform ekibinin bir firmanın sorununa bakması için firma kullanıcısının parolasını istemesi gerekir.
İleride: firma yöneticisinin süreli izin verdiği, her adımı firmanın denetim izine yazılan salt okuma
destek oturumu.

### P3-2 Ödeme

Ücretli satışta P0-1 ödeme sağlayıcısıyla birleşir (plan değişikliği ödemeyle onaylanır, ödenmeyen
dönem askıya düşer).

## 4. İyi çalışanlar

- Platform token'ı ayrı anahtarla imzalanıyor; kiracı ve platform token'ları birbirinin uçlarına
  giremiyor (testli). Platform veritabanı bağlantısı ayrı rol (`tekir_platform`).
- Giriş: parola + 2FA zorunlu, 30 dk oturum, yenileme yok; token `sessionStorage`'da.
- Mevzuat yayınında dört göz: hazırlayan ve düzenleyenler yayınlayamıyor; olaylar kayıtlı.
- Firma tarafındaki yapay zekâ maliyeti platform tavanıyla sınırlanabiliyor.

## 5. Önerilen sıra

1. **P0-1** — abonelik kuralları: plan değişikliği talep + platform onayı, askıya alma, dönem sonu
   iptalinin uygulanması, yazma kısıtı (ödeme sağlayıcısı sonra bağlanır).
2. **P1-1** — firma genel bakışı (P0-1 işlemlerinin ekranı da burası).
3. **P1-2 + P1-3** — platform girişi deneme sınırı, aktiflik denetimi, tavan denetim izi.
4. **P2** — ekip büyüyünce.
