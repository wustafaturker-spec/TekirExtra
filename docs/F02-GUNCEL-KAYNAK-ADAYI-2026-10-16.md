# F02 güncel kaynak adayı: belge dili/PDF değişiklikleri

16 Ekim 2026. Önceki dördüncü aday korunur. Yeni belge dili, şema, cari/stok ve PDF kaynaklarını içeren adaylar ayrı kaynak kopyalarında derlenir. Gerçek DB, şirket ayarları ve çalışan API/web/worker dosyaları değiştirilmez.

**Sonuç:** Sabit yedinci adayda **140 kontrol geçti**: 90 API/veritabanı, 17 standalone tarayıcı, 27 PDF birim ve 6 derlenmiş gerçek PDF üretimi. Migration tekrarı ve 14 tablo için dump/restore karşılaştırması başarılı; geçici DB silindi. [Yerel kabul özeti](../.release-candidates/f02-pilot-20261016-7/yerel-kabul-ozeti.json), [25 kanıt dosyasının SHA-256 manifesti](../.release-candidates/f02-pilot-20261016-7/kanit-manifest.json). Çalışma alanına sonradan eklenen 15 dosya bu adayın dışında; canlı yayın yapılmadı.

## Kaynak kopyasıyla derleme

Yeni araç: [f02-sabit-kaynak-adayi.mjs](../scripts/f02-sabit-kaynak-adayi.mjs). Kaynakları kopyalamadan önce/sonra özetlerini karşılaştırır; değişen kopyayı reddeder. `.env` dosyalarını taşımaz. Kilitli bağımlılıkları çevrimdışı kurar; Prisma istemcisi ve ortak paketleri bu kopyada üretir. API ve web sırayla derlenir. Next'in değiştirdiği `tsconfig.json`/`next-env.d.ts` yalnız kopyaya aittir; gerçek geliştirme dosyalarına yazılmaz. Paket/ortak derleme tsconfig'leri ve `turbo.json` da kaynak kimliğine dahil edildi.

Next, iç içe lockfile'larda üst çalışma alanını kök seçtiğinden ilk çıktı standalone sunucuyu `.release-candidates/<kaynak>/apps/web/server.js` altında taşıdı. [Paketleme düzeltmesi](../scripts/lib/f02-standalone-paket.mjs), sunucu ve yerel bağımlılıklarını aynı önekten alıp `web/apps/web/server.js` girişini oluşturur; static/public dosyalarını bağlar. Bütün bağlantıların paket içinde kaldığını doğrular; yeni çıktı kimliği ve SHA-256 oluşturur. Önceki dosyalar değiştirilmez. Bu adım aday üretim aracına da bağlandı.

## Beşinci/altıncı adayın sonucu

Kaynak kopyası: `.release-candidates/f02-kaynak-1792174508961-0dc2263f`.

| Alan | Değer |
| --- | --- |
| İlk derlenmiş çıktı | `.release-candidates/f02-pilot-20261016-5`; standalone dizin düzeni düzeltilmeden kullanılmaz |
| Düzeltilmiş çıktı | `.release-candidates/f02-pilot-20261016-6` |
| Altıncı aday ID | `f02-20261016T183536251Z-cf89cd3f` |
| Kaynak SHA-256 | `ab3036225199bbe7d26ae0649ea3a8e145978380e993a7a59bdf9e06bf045efc` |
| Dosya SHA-256 | `17a4d50d93b0bac21906d44ab4b5d73dd243138fb4b0eef7f07cae74631672a7` |
| Web BUILD_ID | `Wmh77TYe65LZzZ6z-1Bbm` |

Altıncı adayın [API kabul raporunda](../.release-candidates/f02-pilot-20261016-6/f02-kabul.json) 90 test, migration tekrarı ve 14 tablo için dump/restore karşılaştırması geçti; geçici DB silindi. [Standalone tarayıcı raporunda](../.release-candidates/f02-pilot-20261016-6/tarayici-kabul.json) 17 senaryo geçti; atlanan, başarısız veya kararsız test yok. Bunlar API yanıtı fixture'ları kullanan senaryolardır; dördüncü adayın gerçek API/worker ile 14 kontrolü bu adaya taşınmış sayılmaz.

PDF sayı-yazı/tema birim kontrollerinin 16'sı geçti. Kaynak kopyası alındıktan sonra eklenen ticari belge testleri, importları sabit kopyaya yönlendirilerek ayrıca çalıştırıldı. [Bu ek sonuçta](../.release-candidates/f02-pilot-20261016-6/pdf-ticari-sonuc.json) 11 testin 9'u geçti; çift dil ödeme/teslim koşulları ve VD ekinin yinelenmemesi kontrolleri başarısız oldu. Testlerin beklediği düzeltmeler güncel kaynakta zaten bulunuyordu; altıncı aday bu düzeltmelerden önceki kopyaya aittir. Bu nedenle tam kabul edilmiş veya yayına hazır sayılmaz.

## Yeni adayın kapsamı

Yedinci aday, kaynak kopyası alındığı sıradaki PDF düzeltmeleri, yeni ticari belge testleri, stok ekranı değişikliği ve düzeltilmiş paketleme aracıyla ayrı hazırlandı. Aday kimliği, kabul sonuçları ve açık kapılar aşağıdadır. Gerçek doğal pilot kaydı kullanıcı isteğiyle ertelenmiştir; otomasyon/bildirimler bu iş kapsamında açılmaz.

Yedinci kaynak kopyası `.release-candidates/f02-kaynak-1792177097679-1ad86317` içinde. Bu kopyada sayı-yazı, tema ve ticari belge testlerinin **27'si geçti**; altıncı adayın iki PDF başarısızlığı giderilmiş durumda.

Derlenmiş API'nin gerçek `belgePdfHtml` ve `PdfService.htmlToPdf` çağrılarıyla altı sentetik çıktı üretildi: TR, EN, DE, AR, RU ve TR–EN çift dil. Altısında PDF başlığı, belge/müşteri metni ve SHA-256 kontrol edildi. Çift dil koşulları, VD ekinin yinelenmemesi ve Arapça RTL HTML kontrolü geçti; çift dil ve Arapça sayfa görüntüleri ayrıca incelendi. Chromium yalıtılmış/offline bağlamda çalıştı; gerçek iş kaydı/DB/iletişim kullanılmadı. Bu prova host Node 24.14.0 içindir; yeni adayın ayrı Node 22 runtime kabulü yerine geçmez.

PDF metin çıkarımının harf aralıklı `QUOTATION` başlığına boşluk eklemesi ilk test koşumunu durdurdu. Başlığın HTML ve görüntüde doğru olduğu incelendi; metin karşılaştırmasında yalnız boşluklar normalize edildi. Müşteri/belge kimliği kontrolleri korundu. Başarısız rapor ayrı saklandı; son altı kontrol başarılı. Bu işlem için ürün kodu değiştirilmedi.

İlk derleme yöneticisi exit 143 ile sonlandı; web alt sürecinin kalmadığı kontrol edildi. Başarılı API derlemesi ve PDF provasının dosya özeti korunarak yalnız web derlemesi devam ettirildi. [Devam aracı](../.release-candidates/f02-guncel-hazirlik/aday-7-devam.mjs) kaynak kontrol noktasını diske yazar; yalnız kopyadaki Next tür ayarlarını bilinen başlangıç içeriğine alır ve işlem sonunda geri koyar. Gerçek web ayarları değiştirilmez. API dosya özeti `96a98d9af8b02a2fe6c332dfa8c1f41550d4e39ef23dc14f5def42c88dde7f24`; kaynak kontrol noktası `440ee6dc9eeb370927baef042825cebf61f4b8d9d9fce6f0c57ffd618e1d3803`.

## Tamamlanan yedinci aday

| Alan | Değer |
| --- | --- |
| Dizin | `.release-candidates/f02-pilot-20261016-7` |
| Aday ID | `f02-20261016T192044389Z-1a2c15ca` |
| Kaynak SHA-256 | `440ee6dc9eeb370927baef042825cebf61f4b8d9d9fce6f0c57ffd618e1d3803` |
| API/web dosya SHA-256 | `0852ee60478e6a24ae1f87d445d9cf019188893d17c91fb5b9c66ad221ce13eb` |
| Web BUILD_ID | `76UhtlwyCG-IRZn-VRm_B` |
| Kaynak/dosya tutarlılığı | Kopyanın kaynağı derleme sonrasında aynı; standalone önek düzeltmesi sonrası manifest doğrulandı |

[Kaynak ve devam raporu](../.release-candidates/f02-pilot-20261016-7/sabit-kaynak-raporu.json), [paketleme kaydı](../.release-candidates/f02-pilot-20261016-7/standalone-kok-duzeltmesi.json), [27 PDF birim testi](../.release-candidates/f02-pilot-20261016-7/pdf-birim-sonuc.json), [6 gerçek PDF üretimi](../.release-candidates/f02-pilot-20261016-7/pdf-uretim-prova.json).

[90 API kabul testi](../.release-candidates/f02-pilot-20261016-7/f02-kabul.json): 82 kaynak ve 8 derlenmiş JWT/HTTP/RLS testi geçti. Migration tekrarı ve 14 tablo geri yükleme eşitliği başarılı; geçici DB silindi. [17 standalone tarayıcı senaryosu](../.release-candidates/f02-pilot-20261016-7/tarayici-kabul.json) geçti; atlanan, başarısız veya tekrar denemeyle geçen test yok. Tarayıcı senaryoları API fixture'ları kullanır. Bu koşumun 140 kontrolüne önceki adayların sonuçları eklenmez.

Örnekler tamamen sentetiktir: [Türkçe–İngilizce PDF](../.release-candidates/f02-pilot-20261016-7/pdf-prova/en-cift.pdf), [Arapça PDF](../.release-candidates/f02-pilot-20261016-7/pdf-prova/ar-tek.pdf), [Arapça sayfa görüntüsü](../.release-candidates/f02-pilot-20261016-7/pdf-prova/ar-tek.png). Son adayın API dosya özeti, gerçek PDF provasındaki derlenmiş API özetiyle ayrıca eşleştirildi; başka sürümün PDF çıktısı kabul edilmedi.

## Açık kabul kapıları

Derleme sırasında ana çalışma alanına 15 başka kaynak değişikliği eklendi. Bunlar belge/fatura/makbuz PDF ve servisleri, yeni veri yardımcısı/testleri, POS/kasa-banka ve fatura ekranını içeriyor. Kesin liste kaynak raporunun `sonradanDegisenKaynaklar` alanında. `guncelCalismaAlaniylaAyni: false`; yedinci aday bu sonraki değişiklikleri içermez. Bu dosyalar geri alınmadı veya değiştirilmedi. Çalışma alanının daha sonraki halini yayımlamak için ayrı kaynak kabulü gerekir.

Yedinci aday yerel API JS ve standalone web paketidir. Dördüncü adayın üretim bağımlılığı arşivi, Node 22 tam API/worker ve gerçek girişli 14 kontrolü yeni kimliğe taşınmış sayılmaz. Yeni adayın bu runtime kontrolleri ayrıca yenilenmelidir. Gerçek doğal pilot kaydı/alan kabulü, üretim kapasitesi, uygun önceki sürüme dönüş ve canlı yayın açık kalır. Uygulama içi bildirim/otomasyon gerçek şirkette bu çalışma kapsamında açılmadı; mali kayıt veya gerçek takip/söz oluşturulmadı.

## 17 Ekim 2026 — yedinci adayın ek teknik kabulü

[17 Ekim yedinci aday runtime kabulü](F02-YEDINCI-ADAY-RUNTIME-KABULU-2026-10-17.md) tamamlandı: 11 Node 22 API/worker, 1 gerçek PDF ve 14 gerçek web/API/worker akışı kontrolü geçti. Geçici ortamlar temizlendi; önceki 140 kontrolün kanıtları değişmedi. Bu sonuç yedinci aday kimliğine aittir; yeni runtime/tam akış kabulü gerektiren önceki açık madde bu aday için kapanmıştır. Sonradan değişen çalışma alanı kaynakları, doğal pilot/alan kabulü, üretim kapasitesi, uygun eski sürüme dönüş ve canlı yayın kapsam dışındadır. Gerçek şirket verileri, ayarlar ve çalışan servisler değiştirilmedi.

## 17 Ekim 2026 — güncel kaynakların dokuzuncu aday kabulü

[Güncel belge/PDF adayında](F02-DOKUZUNCU-ADAY-KABULU-2026-10-17.md) 29 dosya farkı kaynak kimliğine alındı; kaşe yüklemesinin API yolu ve eski görseli erken silme hatası giderildi. Son aday `f02-20261017T052606307Z-fixture9`; 214 yerel teknik kontrol geçti. Güncel çalışma alanı kaynak özeti eşleşti, geçici ortamlar temizlendi. Gerçek şirket verileri/ayarları ve çalışan servisler değiştirilmedi. Sonradan değişen kaynakların ayrıca kabulü maddesi bu kaynak kimliği için kapandı; gerçek doğal pilot/alan kabulü, üretim kapasitesi, uygun eski sürüme dönüş, hedef ortam kurulumu ve canlı yayın açık kalır.
