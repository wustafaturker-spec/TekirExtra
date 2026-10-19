# Ödeme sözlerinin tahsilat iş listesinde görünmesi

19 Ekim 2026. Yerel pilot kullanıcı geri bildirimi: girilen ödeme sözü tahsilat iş listesinde görünmüyor.

## Neden ve düzeltme

Salt okunur incelemede 21 Ekim tarihli yeni aktif sözün takip bağlantısı olmadığı görüldü. Önceki ekran yalnız `TahsilatTakibi` kayıtlarını gösteriyordu. Otomatik bağlama yalnız tarihi geçmiş sözlerde worker üzerinden çalışır; manuel pilotta worker kapalıydı. İleri tarihli bir sözün bu yolla hemen görünmesi mümkün değildi.

Tahsilat iş listesine bağımsız **Ödeme sözleri** bölümü eklendi. İleri tarihli sözler dahil iptal/revize edilmemiş kayıtlar, cari/fatura, söz tarihi, tutar, gerçekleşen, kalan ve türetilmiş durumla listelenir. Gerçekleşme mevcut ödeme kaynaklarından okunur; yeni bakiye, ödeme veya takip oluşturulmaz. Gerçekleşmiş fakat iptal/revize edilmemiş söz de gerçekleşti durumuyla görünür.

Yeni `GET /api/v1/cari/odeme-sozleri/is-listesi` ucu tenant/RLS ve mevcut tahsilat erişimini kullanır; `no-store` yanıt verir. Söz tarihi ve kimlikle sıralı 20 kayıtlık cursor sayfalaması vardır. Yabancı/değişmiş imleç 409 döner. Her carinin mevcut kaynak sınırları korunur; aynı sayfadaki cari bir defa uzlaştırılır. Sayfa tek RepeatableRead transaction'ında, 15 saniye sınırıyla okunur. UI mevcut söz yanıt doğrulamasını kullanır; yenileme ve sonraki sayfa düğmeleri bulunur.

## Doğrulama

- 84 PostgreSQL/HTTP ödeme sözü ve tahsilat kabul testi geçti. Yeni senaryolar: takipsiz ileri tarihli söz, revizyon/iptal, finans kayıtlarının aynı kalması, 21 sözde iki sayfa ve tekillik, yabancı imleç, satış rolü ve kapalı mod engeli.
- Chromium senaryosu geçti: takip yokken gelecek söz görünür; yenilemede gerçekleşen/kalan değişir; mobilde sayfa yatay taşmaz; yazma isteği gönderilmez. İlk soğuk geliştirme derlemesi 60 saniyelik teste sığmadı; sayfa test öncesinde derletildi ve başarılı koşum 4,7 saniye sürdü.
- İlk sayfalama test fixture'ında üretilen arama sütununun kopyalanması reddedildi. Fixture bu sütunu kopyalamayacak şekilde düzeltildi; son 84 test başarılı.
- Ayrı API noEmit kontrolü varsayılan 2 GiB heap sınırına takıldı. Sabit aday üreticisinde 4 GiB heap ile tam API ve web üretim derlemeleri başarılı.

## Yerel geçiş

Yeni sabit aday: `f02-20261019T055525672Z-509d149c`, `.release-candidates/cekirdek-soz-is-listesi-20261019`; web BUILD_ID `fRgyT0T5gthbibDk-me1o`. Kaynak özeti `5a43c195a10b321cca53df6ea6765ab09651667cb66cd262710fdfcb4061677e`; dosya özeti `f00bb94e17ad6f0645bbf0caadf53ee594dbf972a5570f0e4f3f4c20e1b4310f`.

Derleme sonunda uygulamanın dört değişen dosyası güncel kaynakla eşleşti. Derleme sırasında yalnız tarayıcı testinin timeout/ön derleme ayarı değişti; bu test ayarı adaya dahil sayılmaz. Uygulama kodunda sonradan değişiklik yok.

Derlenmiş yeni servis gerçek şirkette salt okunur çağrıldı: 16 Ekim sözü `gecikti`, 21 Ekim sözü `aktif` olarak döndü. Bu kontrol HTTP oturum kabulü değildir ve iş kaydı yazmaz. [Sonuç](../.release-candidates/pilot-yayin-20261019/soz-kaynak-kontrol.json).

Bağımsız runtime `api-worker-runtime-20261019T055545302Z-8b72eb` hazır; dosya özeti `61a9ff3a12e5eb11240919888e1806274afbba851c63382bd40a913d2bc22d24`. Şema ve lockfile eşitliği geçiş üreticisinde doğrulandı. Migration veya gerçek şirkette deneme kaydı yapılmadı.

**Yerel düzeltme yayınlandı.** Yeni API/web Node 22.23.2 altında `healthy`. DB/Redis readiness başarılı, giriş sayfası 200, yeni söz listesi oturumsuz istekleri 401 ile reddediyor. Çalışan yeni API konteynerinde gerçek şirket bağlamıyla salt okunur sorgu 16 ve 21 Ekim sözlerini döndürdü. Bu kontrol HTTP oturumu veya kullanıcının tarayıcı ekran teyidi değildir.

Güncel Compose dosyası `.release-candidates/pilot-yayin-20261019/soz-is-listesi-compose.json`; proje adı değişmedi. Önceki paket ve `yerel-compose.json` saklandı. Worker kapalı. Kullanıcı açık sayfayı yenileyerek Tahsilat iş listesi → Ödeme sözleri bölümünden yeni kaydı görebilir.

Gerçek kullanıcı ekran teyidi ve alan kabulü bu teknik testlerle tamamlanmış sayılmaz.
