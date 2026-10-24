# F04 — Şirket modu ve kontrollü açılış

22 Ekim 2026. Tarihli ihtiyaç akışları mevcut modül ayar altyapısına bağlandı. Gerçek şirket ayarı değiştirilmedi ve yayın yapılmadı. Yeni şema/migration eklenmez; F04’ün önceki üç migration’ı yeni API’den önce yine gereklidir.

## Modlar ve kapsam

`stok_ihtiyac_plani` ayarı `{surum: 1, mod: ...}` biçimindedir. Kayıt veya mod alanı yoksa varsayılan `kapali` olur. Bozuk mod veya desteklenmeyen sürüm açık kabul edilmez; sürüm alanı belirtilmemişse şema sürüm 1 kullanır. Yönetici dahil şirket kapısını atlayamaz.

| Mod | Tarihli hesap, kaynaklar, pilot raporu ve plan geçmişi | F04 tarih/atama, plan saklama ve plan bağlı yeni taslak |
|---|---|---|
| `kapali` | Kapalı | Kapalı |
| `salt_okunur` | Mevcut okuma rolleriyle açık | Kapalı |
| `pilot` | Mevcut rollerle açık | Mevcut yazma rolleriyle açık |
| `acik` | Mevcut rollerle açık | Mevcut yazma rolleriyle açık |

Pilot modu şirket genelindedir; kullanıcı listesi veya depo kısıtlaması getirmez ve rol yetkilerini genişletmez. Pilot seçimi gerçek alan kabulü sayılmaz. Planlar stok veya planlar arası kapasite ayırmaz; kapasite tercihi bu dilimde alınmış sayılmaz.

Mevcut anlık `/stok/ihtiyac-plani/onizle` modu ve normal satın alma işlemleri bu ayardan bağımsızdır. Halihazırdaki satın alma talebinin genel onay/iptal/sipariş yaşam döngüsü kapatılmaz. Bu kapı F04 yazmalarını ve **plan bağlı** taslak oluşturmayı denetler; bütün satın alma modülünün genel yazma engeli değildir. Plansız normal talebe elle aktarılan bir miktarın kaynağı sunucuda varsayılmaz. Mevcut tarihli girdi aktarım ekranı da salt okunur modda form açmayı veya kaydetmeyi istemcide reddeder; bu yol normal talep API’sinin politikasını değiştirmez.

## Ayar ekranı ve API

Yönetici, Ayarlar → Modüller → “Tarihli Stok İhtiyacı” kartından modu seçer. Mevcut `GET/PUT /api/v1/ayarlar/stok_ihtiyac_plani` uçları kullanılır. Ayar okuması varsayılanı göstermek için DB’ye kayıt eklemez. PUT hem controller hem F04 servis kuralında yöneticiyle sınırlıdır; şema sıkıdır. Mod güncellemesi ve `ihtiyac_modu_guncellendi` audit kaydı aynı transaction’dadır. Audit başarısızsa mod da geri alınır.

Tarihli önizleme, sipariş giriş tarihi kaynağı, üretim ihtiyacı kaynağı ve plan detayları güncel `erisim` alanı döndürür. `yazabilir` şirket modu kapısını ifade eder; tarih doğrulamanın yönetici/muhasebe gibi ek rol sınırları ayrıca geçerlidir. UI yalnız sunucunun yazabilir dediği durumda ilgili kontrolü açar. Salt okunur modda plan saklama, üretim atama ve tarih teyidi kontrolleri kapanır; yeni plan bağlı taslak bağlantısı gösterilmez. Var olan bağlı talep incelemesi genel talep erişim kurallarıyla devam eder.

Ekran açıkken şirket modu değişirse eski düğmenin izinli görünmesi yazmayı yetkilendirmez. Sunucu her yazma transaction’ında modu tekrar denetler; istek anahtarıyla önceki sonucu döndüren tekrarlar da bu kontrolden geçer. Kapatma, daha önce başarıyla kaydedilmiş işin geri alındığı anlamına gelmez; salt okunur inceleme veya normal talep listesiyle mevcut kayıt doğrulanmalıdır.

Mod, sonuç kanıtının stok/tedarik hesabına dahil edilmez. Salt okunur moda geçmek kaynak miktarını değiştirmediğinden tarihi planı kendiliğinden eski yapmaz; güncel izin ayrıca değerlendirilir. Snapshot içindeki eski erişim bilgisi güncel yetki yerine kullanılmaz.

## Kapatma–yazma yarışı

Ayar güncellemesi tenant/modül anahtarında exclusive transaction advisory lock alır. F04 yazmaları aynı anahtarı shared olarak, sonra ayar satırını `FOR SHARE` ile okur; kilitler transaction sonuna kadar tutulur. İki yol aynı kilit sırasını kullanır.

Başlamış bir F04 yazması varsa kapatma onu bekler. Yazma tamamlandıktan sonra kapatma onaylanır; sonraki yazmalar reddedilir. Kapatma önce kilidi aldıysa bekleyen yeni yazma eski repeatable-read snapshot’ındaki izinle ilerleyemez. Satır kilidi güncel sürümle çelişirse 409 “mod değişti, yeniden yükleyin” yanıtı verilir. Ham SQL’deki `P2010 / 40001` ve Prisma `P2034` serileştirme biçimleri bu yanıta çevrilir.

Salt okunur hesap/pilot raporu ayar satırına yazma kilidi almaz; PostgreSQL READ ONLY raporu çalışmaya devam eder. Daha önce başlamış okuma kendi tutarlı snapshot’ıyla tamamlanabilir. Kapatma, devam eden okumaları geriye dönük iptal etme veya önceki snapshot’ları silme işlemi değildir.

## Açılış ve kapatma işletimi

Şirket ilk kez bu sürümü aldığında ayar yoksa tarihli akışlar kapalıdır; otomatik pilot açılmaz. Önceki belgelerdeki teknik fixture’lar test için açıkça `pilot` seçer. İlk migration provasının eski verisinde varsayılan kapalı davranışı korunur; yeni akış ancak yönetici açıkça açtıktan sonra denenir.

Gerçek pilotta şirket/depo, alan sahibi, doğal örnekler ve kapasite kapsamı seçilmelidir. Yönetici önce salt okunur veri incelemesini açabilir. Doğal işler için kaynak teyidi/yazmalı pilot gerekiyorsa açıkça pilot moduna geçer. Salt okunur veya kapalıya dönüş mevcut atama, plan, talep bağı veya audit’i silmez. Bu mod kapısı somut paket/migration, yedek, tam geri dönüş ve G0–G5 kabul koşullarının yerine geçmez.

Gerçek şirket pilotu, hedef hacimde kilit/süre bütçesi, tam uygulama geri dönüşü ve kapasite kararı bu dilimde tamamlanmış sayılmaz.

## Teknik kabul ve tekrar koşumu

- İzole PostgreSQL/RLS kabulü: **48/48**. Varsayılan kapalı, bozuk ayar, rol/tenant ayrımı, salt okunur yazma engeli, audit rollback ve kapatma/yazmanın iki kilit sırası doğrulandı.
- Fixture Chromium kabulü: **26/26**. Salt okunur ekranlar, kapalı modda anlık hesap ve ekran açıkken kapatma dahil.
- Gerçek API + standalone web + parolalı Chromium: **5/5**. Yönetici modülü gerçek ayar kartından salt okunura aldı; yeni yazmalar ve tekrarlar engellendi, snapshot korundu.
- 265 eski migration üzerine ilk geçiş: **1 önce + 3 sonra**. 213 eski tablonun içeriği korundu; varsayılan kapalı, açık yönetici pilot seçimi ve yeni akış geçti. Geçici DB silindi.
- Odaklı API derlemesi ve web üretim derlemesi geçti; web 142 sayfa üretti. Standalone build kimliği: `rT6H2smlP0AaroR2y9q90`. Tam API tip kontrolü de seri koşumda exit 0 ile geçti; sonuç `kabul-ozeti.json`, boş başarılı log `api-tip-kontrol.log` içinde kayıtlıdır.

Kanıt dizini: `.release-candidates/f04-kontrollu-acilis-20261022/`. `tarayici/sonuc.json`, `ileri-ve-http/http-kabul.log`, `ileri-ve-http/mod-kabul-ozeti.json` ve geçiş özetleri nihai başarılı koşuma aittir. 48 DB kabulünün sayısı koşum çıktısından özetlenmiştir; bu dizinde ayrı ham DB kabul logu yoktur. İlk HTTP hazırlığı 60 saniyelik test hook sınırına takıldı ve beş test çalışmadı; ilk kayıt `ileri-ve-http-ilk/` altında korunur. Test hazırlık sınırı 180 saniyeye çıkarılıp gerçek API/web hazır olma aşamaları kaydedilerek seri koşum başarıyla tamamlandı. Ürün istek zaman aşımı değiştirilmedi. İlk fixture tarayıcı denemesi standalone paket kopyası bitmeden başlatılmıştı; tamamlanmış aynı paketle nihai 26 test geçti.

Tekrar komutları (depo kökünden; Docker/yerel port erişimi gerektirir):

```bash
node apps/api/scripts/f01-yaris-kabul.mjs --f04
F04_API_DIST=/tmp/tekir-f04-mod-http-api F04_WEB_ROOT=/tmp/tekir-f04-mod-web-k80lgydv/.next-mod/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-kontrollu-acilis-20261022/ileri-ve-http node apps/api/scripts/f01-yaris-kabul.mjs --f04-ileri-prova
```

Derlenmiş `/tmp` yolları bu oturumun geçici paketleridir; başka oturumda güncel kaynaktan yeniden üretilmelidir. Fixture tarayıcı koşumu `apps/web` altında `playwright.ihtiyac.config.ts` ile aynı standalone paketi kullanır. Paket kaynak eşitliği ve SHA-256 değerleri `kaynak-kaniti.json` içinde tutulur. Bu teknik kabul gerçek pilot veya yayın onayı değildir.
