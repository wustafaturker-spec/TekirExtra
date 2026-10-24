# F04 — Üretim ihtiyacı atama ve kayıtlı plan ekranları

22 Ekim 2026. Bu dilim, üretim talebi ve kalıcı plan API çalışmasının kullanıcı ekranlarını ve plan listeleme API’sini tamamlar. Gerçek şirket verisi veya çalışan yayın değiştirilmedi.

## Kullanıcı akışı

Üretim emrindeki açık, varyantsız malzeme kaleminden rezerv dışı ihtiyaç ekranına gidilir. Yönetici, muhasebe ve depo kullanıcıları kaynak miktarını, tüm depolardaki aktif rezervi ve kalan ihtiyacı görür. Hammadde deposu, ihtiyaç günü ve gerekçe açıkça seçilir; mamul deposundan otomatik atama yapılmaz. Kaynak özeti ve atama sürümü yazmada kontrol edilir. Çakışmadan sonra yeniden okuma gerekir. Atamayı kaldırmak üretim ihtiyacını silmez; tarihli hesabın belirsizliğini geri getirir. Yazma başarılı olup yeniden okuma başarısızsa ekran bunu ayrı bildirir.

Tarihli ihtiyaç ekranındaki doğrulanmış sonuç, “Planı sakla” ile tarihsel olarak kaydedilir. İstemci yalnız beş girdi alanını, sonuç kanıtını ve istek anahtarını yollar; payları sunucu hesaplar. Yanıtı belirsiz ağ hatasında aynı anahtar korunur. 409 sonrası yeni hesap gerekir. Kaydetme sırasında girdi değişikliği engellenir; başarılı kayıt tekrar gönderilmez.

Kayıtlı planlar ekranı geçmiş girdi ve karşılama paylarını, dönem içi açığı ve güncellik durumunu gösterir. Eski plan değişmez. “Girdilerle yeniden hesapla” özgün girdileri ihtiyaç ekranına taşır; kendiliğinden hesaplama veya kayıt başlatmaz. Planlar stok ayırmaz ve farklı planlar arasında kapasite tahsis etmez.

## Listeleme API’si

`GET /api/v1/stok/ihtiyac-plani/planlar?imlec=<uuid>` aynı yetkilerle tenant kapsamındaki kayıtları en yeni önce listeler. Sayfa büyüklüğü 20, devam tespiti için okunan üst sınır 21’dir. Sıralama oluşturulma zamanı ve kimlik üzerinden kararlıdır; aynı zamanlı kayıtların sayfalanması doğrulanmıştır. İmleç tenant içinde aranır; başka tenant veya olmayan kayıt 409 verir. Tarih karşılaştırması oturum saat diliminden bağımsızdır.

Liste sorgusu tam snapshot yerine yalnız tarihsel ürün/depo etiketi ve girdi özetini seçer. Detayda snapshot ve güncellik kontrolü ayrıca okunur. Yanıtlar `no-store` kullanır. Bu dilim yeni migration eklemez; önceki iki F04 migration’ı gerçek ortama uygulanmadı.

## Doğrulama ve kanıt

- Gerçek, izole PostgreSQL/RLS kabulü: **31/31**. Yeni iki test sayfalama, aynı zamanlı kayıtlar, İstanbul saat dilimi, tarihsel etiketler, tenant imleci ve yetki/girdi sınırlarını kapsar. Geçici veritabanı silindi.
- Üretim web paketinde fixture API yanıtlarıyla tarayıcı kabulü: **21/21**, atlanan veya kararsız test yok. Atama, kaldırma, çakışma, kayıt tekrar anahtarı, eski sonuç reddi, geçmiş plan, sayfalama, erişim korumaları ve mobil taşma kontrol edildi. Bu koşum gerçek API ile birleşik HTTP kabulü değildir.
- F04 odaklı API TypeScript kontrolü, web tam TypeScript kontrolü ve web üretim derlemesi başarılı. Önceki dilimde süreyi aşan tam API kontrolü bu dilimde tekrar çalıştırılmadı; başarılı kabul edilmez.
- Paket kimliği: `uitda57Sb9p76mfgZDerA`. Değişen yedi web kaynağının SHA-256 değerleri test kopyasıyla eşleşti. Geçici paket, izleme kökü ve tek işçi ayarlarıyla ayrı dizinde üretildi; yayın manifesti değildir.

Kanıt dizini: `.release-candidates/f04-plan-yonetimi-20261022/`. `kabul-kaynaklari.json` paket/kaynak eşleşmesini, `web-build.log` derlemeyi, `tarayici/sonuc.json` son başarılı koşumu, `tarayici/artifacts/` mobil görüntüleri içerir. İlk koşumda 19/20 geçti; erişim korumasını yanlış seviyede bekleyen test düzeltildi ve ana/sayfa korumaları ayrı test edildi. İlk koşum `tarayici-ilk/` altında korundu. `kabul-ozeti.json` tool sonuçlarının özetidir; DB ham logu değildir. Geçici paket yolu kalıcı dağıtım çıktısı sayılmaz.

## Kalan işler

Gerçek API ile birleşik HTTP/tarayıcı kabulü, tam API tür kontrolü, operasyon pilotu ve plan–satın alma taslağı arasında atomik bağ/tekilleştirme açıktır. F04 bütünü tamamlanmış veya yayına alınmış sayılmaz.
