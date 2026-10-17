# F02 — Uygulama içi bildirim ve itiraz iletişim kontrolü

16 Ekim 2026. Geciken sözden üretilen takip, tercihe bağlı uygulama içi bildirime bağlandı. Açık tahsilat itirazı müşteri hatırlatma/ihtar akışında sunucuda denetleniyor. Yeni migration yoktur; gerçek şirket ayarları değiştirilmedi ve canlı yayın yapılmadı.

## Bildirim

`tahsilat_otomasyonu.uygulamaIciBildirim` varsayılan `false` alanıdır. Ayar ekranında ayrı onay kutusu bulunur. Yeni gecikmiş söz takibe bağlanırken etkinse bildirimin alıcısı mevcut takibin aktif yönetici/muhasebe sorumlusudur. Takipteki itiraz, sorumlu ve sonraki işlem planı korunur; otomasyonu çalıştıran kullanıcı otomatik olarak ek alıcı olmaz.

Bildirim mevcut `vade` türünde ve `tahsilat-takip:<takipId>` anahtarıyla üretilir. Her takip için tek bildirim, kullanıcı başına tek teslimat vardır. Aynı sözün/worker'ın tekrarı mükerrer kayıt üretmez. Yeni bir söz aynı takibe bağlandığında baştan okunmamış teslimat açılmaz. Kullanıcının vade türü için uygulama içi tercihi kapalıysa teslimat üretilmez; e-posta tercihi açık olsa bile e-posta ile telafi edilmez. Teslimatın `epostaDurumu=kapali` olması bu yeni olayın e-posta worker'ına düşmesini önler.

Takip/bağ/audit/bildirim aynı cari transaction'ında yazılır; bildirim hatası tümünü geri alır. Görev tamamlanır veya iptal edilirse bildirimi kapanır, geçmiş silinmez. Sorumlu değiştiğinde önceki teslimat `yoksayildi` olur; mevcut bildirim, yeni uygun sorumluya tercihi elveriyorsa uygulama içinde teslim edilir. Aynı kullanıcının önceki teslimatı varsa ikinci satır üretilmez.

Bildirim metni tutar veya cari unvanı içermez. Bağlantı `/panel/cari/tahsilat?takip=<id>` yoludur; geçerli takip kimliği liste filtresinden bağımsız ilgili detayı açar. Gerçek detay yine mevcut tenant/rol/mod kontrolünden geçer. Geçersiz bağlantı kimliği API'ye gönderilmez.

Bildirim liste/sayaç/durum değiştirme uçları, yeni F02 kaynağı için hem istek rolünü hem veritabanındaki aktif/güncel kullanıcı rolünü ve tahsilat modunu doğrular. Eski token rolü tek başına yeterli değildir. Firma kapsamındaki F02 bildirimleri için güncel rol ayrıca yönetici olmalıdır. Kapalı veya geçersiz şirket modu yeni F02 kayıtlarını gizler; diğer bildirim türlerinin görünürlüğü değişmez. Varsayılan tarayıcı yalnız kendi `vade:` önekini kapattığı için F02 olayını yanlışlıkla kapatmaz.

Özellik sonradan açılırsa önceden bağlanmış sözler için geriye dönük bildirim üretilmez. Özelliği kapatmak önceki bildirimleri silmez. Kullanıcı, mevcut bildirim tercihleri ve durum eylemleriyle geçmişini yönetebilir.

## İtiraz iletişim politikası

Cari başına açık/bekleyen ve nedeni `itiraz` olan takip, o cariye hatırlatma ve ihtar gönderimini engeller. Bu ilk sürümde itiraz cari kapsamındadır; itirazlı olmayan başka faturaları otomatik ayırıp göndermek yoktur. Kapatılmış veya nedeni tahsilat olan takip engel değildir. Tahsilat şirket modunu kapatmak veya 7 günlük sıklık sınırını aş seçeneği bu engeli kaldırmaz.

Mevcut `VadeHatirlatmaService` aday yanıtına `itirazEngeli` ve `gonderimEngeli` eklendi. İtirazlı cari varsayılan/toplu seçimden çıkarılır; seçimi ve önizlemesi kapalı, nedeni görünür. Servis önizlemede ve PDF üretiminden sonra SMTP çağrısından hemen önce tekrar doğrular. Aynı servis kullanıldığı için mevcut toplu gönderim ve AI üzerinden onaylı gönderim de bu kontrolden geçer. Güncel engel bulunan cari gönderim sonucunda hata/neden döner; gerçek e-posta taşıyıcısı çağrılmaz. Diğer cariler ayrı değerlendirilir.

Müşteri e-postalarının önizleme, kullanıcı onayı ve CRM kaydı mevcut akıştır. Bu dilim yeni otomatik müşteri e-postası başlatmaz. SMTP çağrısı ile itiraz kaydı tek atomik dağıtık işlem değildir: son kontrolden sonra başlamış teslimat, sonradan açılan itirazla geri çağrılamaz. Mevcut SMTP akışında kalıcı içerik-onay snapshot'ı veya belirsiz teslim sonrası exactly-once garantisi eklenmedi; bunlar ayrı iletişim altyapısı işidir.

## Doğrulama

Toplam **392 ayrı test** geçti:

- 170 API birim testi: 10 yeni kanal/tercih/erişim sınırı testi; mevcut otomatik takip, ödeme sözü, hatırlatma ve bildirim regresyonları dahil.
- 123 web birim testi.
- 82 geçici PostgreSQL/HTTP senaryosu: yeni 8 senaryo gerçek bildirim tablolarını, iki worker yarışını, tercih/rol/mod kısıtlarını, kapanış ve sorumlu değişimini, atomik geri almayı ve itiraz kapısını kapsar. Eski yönetici tokenıyla güncel kullanıcı rolü muhasebeye düşünce firma kapsamındaki F02 kayıtları da gizlenir. SMTP yerine sahte taşıyıcı kullanıldı; gerçek alıcıya ileti gönderilmedi. Test rolü superuser/BYPASSRLS değildir ve konteyner koşu sonunda silindi. HTTP kabulünde kimlik middleware ile verilir; JWT oturum açma testi değildir.
- 17 üretim Chromium senaryosu: ayar ekranı, itirazlı carinin seçim/önizleme engeli, geç gelen sunucu engelinin görünmesi, doğrudan takip bağlantısı ve aynı ekranda başka bildirim bağlantısına geçiş dahil. Gerçek üretilmiş arayüz yönlendirilmiş sentetik API yanıtlarıyla sınandı; gerçek şirket pilotu değildir.

API tam strict TypeScript kontrolü ve web üretim derlemesi başarılı. Üretim çıktısı `.next-f02-bildirim-release-20261016`, BUILD_ID `V8sgpaaCeQCoZLbbYR8Bc`. Next'in ürettiği `next-env.d.ts` ve `tsconfig.json` değişiklikleri koşu öncesi içeriklerine geri alındı; önceki çalışma alanı değişiklikleri korundu. `git diff --check` temiz.

```sh
# apps/api
pnpm exec vitest run src/cari/tahsilat-bildirimi.test.ts src/cari/geciken-soz-zamanlayici.service.test.ts src/cari/tahsilat-takibi.semalar.test.ts src/cari/odeme-sozu.semalar.test.ts src/cari/odeme-sozu-uzlastirma.test.ts src/cari/vade-hatirlatma.test.ts src/cari/vade-hatirlatma-ai-not.test.ts src/bildirimler --maxWorkers=1 --no-file-parallelism
node scripts/f01-yaris-kabul.mjs --f02
NODE_OPTIONS=--max-old-space-size=4096 pnpm exec tsc -p tsconfig.json --noEmit

# apps/web
pnpm test --maxWorkers=1 --no-file-parallelism
NEXT_DIST_DIR=.next-f02-bildirim-release-20261016 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F02_BILDIRIM_DIST=.next-f02-bildirim-release-20261016 pnpm exec playwright test --config playwright.tahsilat-bildirim.config.ts --max-failures=1
```

## Kalan kapsam

Gerçek şirket pilotu, üretim kapasitesi ve yayın kabulü bekliyor. F02 paketi henüz tamamlanmış sayılmıyor.
