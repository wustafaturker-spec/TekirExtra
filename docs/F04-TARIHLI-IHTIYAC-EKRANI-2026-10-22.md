# F04-03 — Giriş tarihi ekranı ve tarihli talep aktarımı

22 Ekim 2026. Sorumlu: frontend/backend. Bağımlılıklar: F04-02 hesap çekirdeği ve sipariş giriş tarihi migration/API'si. Bu teslim tarihli UI dilimidir; F04'ün tamamı veya yayın kabulü değildir.

## Kullanıcı akışı

Açık, deposu belli ve faturaya doğrudan bağlanmamış alış siparişinin varyantsız kalan kaleminde **Giriş tarihi** bağlantısı bulunur. `/panel/stok/giris-tarihleri?satirId=…` ekranı ürün/sipariş, kalan ana birim miktarı, önceki doğrulama günü ve gerekçesini gösterir. Yönetici/muhasebe yeni gün ve gerekçeyle tarihi doğrulayabilir veya gerekçeyle kaldırabilir. Depo rolü salt okunur inceleyebilir. Ziyaret tek başına kayıt yazmaz.

Eski kaynak doğrulaması ve geçmiş gün ayrı uyarılardır. Yazma hatasında sonucu varsaymak yerine satırı yeniden yüklemek gerekir; tekrar yüklenene kadar yazma düğmeleri kapalı kalır. Backend kaynak özeti, sürüm, rol, tenant ve gün kontrollerini korur. Tarih kaldırma veya doğrulama finans/stok girişi, sipariş onayı ya da dış iletişim oluşturmaz.

İhtiyaç ekranında **Hesap kapsamı** seçimi vardır: varsayılan **Yalnız mevcut stok** önceki akışı kullanır; **Doğrulanmış tarihli girişlerle** yeni tarihli API'yi okur. Anlık stok sonucu ile tarihli giriş, dönem sonu, tarihli açık ve dönem içindeki en büyük açık ayrı gösterilir. Dahil edilen ve dışlanan kaynaklar tarih inceleme ekranına bağlanır. Form veya kapsam değişince önceki sonuç temizlenir; geciken yanıt yeni forma yazılmaz.

## Satın alma aktarımı ve güncellik

URL yalnız özgün ihtiyaç girdileri ve `hesapTuru=tarihli` seçimini taşır. Açık miktar, fiyat veya kaynak kanıtı URL'den kabul edilmez. Talep formu tarihli API'den yeniden hesaplar; tarihli yanıttan anlık hesaba sessiz geçiş yoktur. Ana birimde tarihli açık aktarılır; bütçe ve tahmini fiyat kullanıcı tarafından girilir. Tarihli açık sıfır veya doğrulanamıyor ise taslak hazırlama bağlantısı verilmez.

Hedef günden önce görülen en büyük açık dönem sonu açığından büyükse tek hedef tarihli talep aktarımı engellenir. Kullanıcı önce erken açığın ihtiyaç gününü ayrı planlamalıdır; geç giriş erken açığı gizleyemez.

Kaydetmeden önce stok ve doğrulamalar yeniden okunur. API `kaynakKaniti`, deterministik satır sırasıyla kaynak kimliği/özeti, teslim birikimi, doğrulama sürümü, doğrulanan kaynak özeti ve günü kapsayan SHA-256 üretir. Aynı gün ve miktarda yeni doğrulama revizyonu bile kanıtı değiştirir; yalnız sorgu saatinin değişmesi değiştirmez. Değişiklikte taslak yazılmaz; kullanıcı **İhtiyacı yeniden yükle** ile günceller, bütçe/fiyat/departman korunur. Başarılı kayıt veya vazgeçme hesap türü dahil aktarım parametrelerini temizler.

Bu kontrol ile taslak POST'u aynı DB transaction'ı değildir. Aradaki ve sonraki kaynak değişimleri engellenmez; tarihli aktarım stok ayırmaz veya farklı taslakları tekilleştirmez. Mevcut taslak → onay → teklif → sipariş akışı kullanılır. Tarihli kapsam yalnız doğrulanmış açık alış siparişi kalanlarıdır; rezerv dışı gelecekteki talepler, irsaliyeye geçmiş girişler ve kalıcı karşılama bağları henüz yoktur.

## Etkilenen yerler ve işletim

- Web: sipariş kalemi bağlantısı, yeni giriş tarihi sayfası, stok ihtiyaç sayfası, talep formu ve aktarım yardımcıları.
- API: kaynak adaptörünün kanıt üretimi, tarihli önizlemenin kanıt alanı ve tarih okumasında ürün/sipariş etiketi.
- Ek migration yok; önceki `20261022120000_siparis_giris_tarihi` gerekir. Gerçek şirkete uygulanmadı ve çalışan uygulama yayınlanmadı.
- Geri dönüş: önceki web/API paketine dönülür; mevcut tarih doğrulama/audit kayıtları korunur. Eski anlık stok ve manuel satın alma akışı kullanılabilir.

## Doğrulama

14 aktarım yardımcı testi ve 46 API hesap/servis/kaynak testi geçti. Geçici PostgreSQL üzerinde 20/20 kabul testi başarılı; aynı miktar/günde yeni doğrulama revizyonunun kaynak kanıtını değiştirmesi ve aynı kaynağın tekrar okunmasında sabit kalması eklendi. Geçici DB otomatik silindi. Web tam tür kontrolü başarılı.

Son üretim standalone paketinde Playwright'ın mevcut Chromium'u ile 13/13 fixture tarayıcı senaryosu geçti: önceki 9 anlık hesap/talep senaryosu ve 4 yeni tarihli aktarım/erken açık/tarih doğrulama-kaldırma/depoda mobil okuma senaryosu. Yalnız teyit revizyonu değiştiğinde kayıt engeli, yeniden yüklemeden sonra tarihli miktarla taslak hazırlama, tarih yazımında sürüm çakışması, yeniden okuma gereği, rol ve mobil taşma doğrulandı. Yazmalar API fixture'larıyla karşılandı; gerçek şirkette taslak veya tarih kaydı oluşturulmadı. Gerçek HTTP/API ile birleşik tarayıcı kabulü değildir.

Web üretim derlemesi (140 sayfa), web tam tür kontrolü ve API tam tür kontrolü başarılı. Son API kontrolü 4 GiB Node heap ile çalıştırıldı. Derlemede mevcut CSS autoprefixer uyarıları var; hata yok.

Kanıtlar `.release-candidates/f04-tarihli-ui-20261022/` altında: `tarayici/sonuc.json`, mobil ekran görüntüsü, `web-build.log`, `kabul-kaynaklari.json`. Son build kimliği `ywhSTw2rJ8AUtJPzTRmlv`; değişen beş web üretim dosyası geçici kaynak kopyasıyla SHA-256 üzerinden eşleşti. Test paketi `/tmp/tekir-f04-ui-nudowv8a/.next/standalone` girişinden çalıştı; kalıcı dağıtım/geri dönüş paketi değildir.

İlk tarayıcı koşusu eski test ayarının sistem Chrome'unu araması nedeniyle uygulamayı açamadı; kanıtı `tarayici-chrome-baslatilamadi/` altında korundu. Test ayarı varsayılan olarak kurulu Playwright Chromium'unu kullanır; `F04_TEST_CHANNEL` ile ayrıca kanal seçilebilir. Yeni tarayıcı indirilmedi. Yerel port açılması sandbox dışında yetkilendirilerek çalıştırıldı.

Geçici kopyanın ilk standalone izleme kökü, kaynak dışındaki bağımlılıkları yanlış konuma taşıdı ve sonraki paket denemesinde modül çözümlemesi hatası verdi. Son test kopyasında `outputFileTracingRoot: '/'`, `webpackBuildWorker: false`, `cpus: 1` ve ayrı `.next-final` dizini kullanıldı; nested standalone'a static/public kopyalandı ve giriş wrapper'ı eklendi. Bu ayarlar çalışma alanındaki `next.config.ts` dosyasına uygulanmadı. Son paket tamamlandıktan sonra 13 senaryonun tamamı bu paket üzerinde koşuldu.

Gerçek şirket/alan pilotu, kalıcı karşılama bağları ve yayın sonrası kabul açıktır.
