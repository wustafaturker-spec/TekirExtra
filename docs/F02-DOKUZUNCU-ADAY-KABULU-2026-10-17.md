# F02 güncel belge kaynakları — dokuzuncu aday

17 Ekim 2026. [Yedinci adaydan](F02-YEDINCI-ADAY-RUNTIME-KABULU-2026-10-17.md) sonra gelen belge/PDF, fatura ve makbuz kaynakları ile Belge Görünümü ekranı yeni sabit adayda toplandı. Kaynak farkı 29 dosya: önceki 27 dosya ve bu çalışmada eklenen iki tarayıcı regresyon dosyası.

## Uygulama düzeltmesi

Belge Görünümü ekranının kaşe yüklemesi ortak kimlik doğrulamalı API istemcisine taşındı. Varsayılan `/api/v1` yolu ve oturum yenilemesi bütün isteklerde aynı şekilde kullanılır; uzaktaki tarayıcının `localhost:3001` adresine gitmesi giderildi.

Yeni dosya başarıyla yüklendikten sonra eski kaşe silinir. Yükleme başarısızsa eski görsel korunur. Eski görsel silinemediğinde yeni görsel kullanılmaya devam eder ve kullanıcıya önceki ekin korunduğu bildirilir.

[Uygulama](../apps/web/src/app/panel/ayarlar/belge-gorunumu/page.tsx), [üç tarayıcı regresyonu](../apps/web/e2e/belge-gorunumu.spec.ts).

## Aday kimliği ve derleme kaynağı

| Alan | Değer |
| --- | --- |
| Dizin | `.release-candidates/f02-pilot-20261017-9` |
| Aday ID | `f02-20261017T052606307Z-fixture9` |
| Kaynak SHA-256 | `8bafb85cdb4db9b0e2b6a9713ed24a91686ba739f1d95cbd68f4a65806acd4d4` |
| API/web SHA-256 | `aecade76a7814d823c4c2939cd457925489ea2d73eb6854717ebc0c61c333dab` |
| Web BUILD_ID | `ly22sN-NrGqg_hhhGBFP4` |
| Sabit kaynak | `.release-candidates/f02-kaynak-1792213991025-fixture9` |

API ve web sekizinci adayın ayrı kaynak kopyasında başarıyla derlendi. Yeni kaşe testinin ilk koşumu test verisindeki eksik e-belge uygulama ayarı yüzünden durdu; başarısız rapor sekizinci adayda korunur. Bu tek test dosyasındaki veri düzeltmesi dokuzuncu adayın kaynak kimliğine eklendi. Devralma betiği iki kaynak arasındaki farkın yalnız bu dosya olduğunu zorunlu olarak doğruladı; API/web dosya özetleri aynı kaldı. Bu nedenle dokuzuncu adayın uygulama çıktıları yeniden derlenmedi. [Kaynak ve devralma raporu](../.release-candidates/f02-pilot-20261017-9/sabit-kaynak-raporu.json), [betik](../.release-candidates/f02-pilot-20261017-9/test-kaynagi-adaylastir.mjs).

Dokuzuncu kaynak kopyasının test bağımlılıkları ayrıca çevrimdışı/frozen lockfile ile kuruldu ve Prisma istemcisi bu kopyada üretildi. `.env` dosyaları kopyalanmadı. Runtime bağımlılık paketi de aday kaynaklarından ayrı hazırlanır.

## Tamamlanan yerel kontroller

- [90 API/veritabanı kontrolü](../.release-candidates/f02-pilot-20261017-9/f02-kabul.json); migration tekrarı ve 14 tablo için dump/restore içerik eşitliği geçti, geçici DB silindi.
- [17 standalone F02 tarayıcı senaryosu](../.release-candidates/f02-pilot-20261017-9/tarayici-kabul.json); başarısız, atlanan ve tekrar denemeyle geçen test yok.
- [3 kaşe regresyonu](../.release-candidates/f02-pilot-20261017-9/belge-gorunumu-tarayici.json); başarısız yüklemede koruma, başarıdan sonra silme ve eski görsel silinemediğinde bilgilendirme geçti.
- [70 PDF/fatura birim testi](../.release-candidates/f02-pilot-20261017-9/pdf-birim-sonuc.json); örnek belge türleri/dilleri, ticari HTML, fatura çıktısı ve fatura şemaları dahil.
- [6 gerçek çok dilli PDF](../.release-candidates/f02-pilot-20261017-9/pdf-uretim-prova.json); TR, EN, DE, AR, RU ve TR–EN çift dil. Derlenmiş yeni API'nin dosya özeti doğrulandı; PDF başlığı, belge/müşteri metni, çift dil koşulları ve Arapça RTL kontrol edildi.

Standalone ve kaşe regresyonları API fixture'ları kullanır. Gerçek web/API/worker akışı ayrıca aşağıda kaydedilir. Önceki adayların test sayıları bu adayın toplamına eklenmez.

## Node 22 API/worker, PDF ve taşınabilir paket

[11 Node 22 API/worker kontrolü](../.release-candidates/f02-pilot-20261017-9/f02-runtime-prova.json) geçti; geçici konteynerler ve ağ temizlendi. Node 22.23.2 üzerinde gerçek parolalı sentetik giriş, F02 HTTP işlemleri, nakitte çift sayımın önlenmesi, tam worker'ın geciken sözü mevcut takibe bağlaması ve salt okunur yazma engeli doğrulandı. E-posta kapalı kaldı.

[Bir ek PDF kontrolü](../.release-candidates/f02-pilot-20261017-9/f02-runtime-arsiv.json) ağsız Node 22 konteynerinde geçti; gerçek `PdfService.htmlToPdf` çıktısında Türkçe metin kontrol edildi. Chromium/headless shell 1228 ve ffmpeg 1011 arşive eklendi. gzip bütünlüğü, güvenli göreli yollar ve runtime/browser dosya özetleri doğrulandı.

| Paket alanı | Değer |
| --- | --- |
| Runtime | `api-worker-runtime-20261017T053054417Z-ea7cbc` |
| Runtime SHA-256 | `9e609db434e798475c759e54c3034a818a2302890475c596536c41ce19828e8b` |
| Arşiv | `api-worker-runtime-20261017T053054417Z-ea7cbc.tar.gz` |
| Boyut | 378,230,746 bayt |
| Arşiv SHA-256 | `0ecbbfebed74624bb8b1a60fbda3f0c0234a316816ba854e75c1ab5804921059` |

Paket Linux x64, glibc/OpenSSL 3 ve sınanan Node 22 tabanına aittir. Node yürütücüsü ve Chromium sistem kitaplıkları arşive dahil değildir; ortam değişkenleri dışarıdan sağlanır.

## Gerçek web/API/worker ve yeni belge ekranı

[16 tam akış kontrolü](../.release-candidates/f02-pilot-20261017-9/f02-tam-akis-prova.json) geçti. Sentetik kullanıcı gerçek formdan giriş yaptı; görüşme kaydı, yenileme sonrası geçmiş, ödeme sözleri ve masaüstü/mobil salt okunur görünüm doğrulandı. API fixture'ı kullanılmadı.

Belge Görünümü ekranında gerçek PDF yanıtı ve uygulamanın aldığı Blob, renk ayarının kaydı/yenileme sonrası korunması, sentetik fatura PDF endpointi, kaşe yükleme/yenileme/silme ve mobil yatay taşma kontrolü geçti. Fatura PDF'inin metninde `INVOICE` ve sentetik cari doğrulandı. Masaüstü/mobil ekranlar ve çok dilli PDF sayfaları ayrıca incelendi. Başarısız 5xx yanıtı veya JavaScript hatası görülmedi.

[Gerçek tarayıcı betiği](../.release-candidates/f02-pilot-20261017-9/belge-gercek-tarayici.cjs), [masaüstü ekranı](../.release-candidates/f02-pilot-20261017-9/tam-akis-94bc533f821e986a/belge-gorunumu-masaustu.png), [mobil ekranı](../.release-candidates/f02-pilot-20261017-9/tam-akis-94bc533f821e986a/belge-gorunumu-mobil.png), [sentetik fatura PDF'i](../.release-candidates/f02-pilot-20261017-9/tam-akis-94bc533f821e986a/fatura-http.pdf), [Türkçe–İngilizce örnek PDF](../.release-candidates/f02-pilot-20261017-9/pdf-prova/en-cift.pdf), [Arapça örnek PDF](../.release-candidates/f02-pilot-20261017-9/pdf-prova/ar-tek.pdf).

İlk yeni ekran provasındaki PDF gövdesi kontrolü tarayıcının ağ yanıtından sıfır bayt okudu. [Ham API/proxy ve Blob karşılaştırması](../.release-candidates/f02-pilot-20261017-9/tam-akis-d5d8533b9be287df/pdf-ham-yanit-tanisi.json) ve [Blob kaydı](../.release-candidates/f02-pilot-20261017-9/tam-akis-d5d8533b9be287df/pdf-govde-tanisi.json) üçünde de 68.541 bayt ve `%PDF-` gösterdi. Kontrol uygulamanın aldığı Blob üzerinden düzeltildi. Headless iframe görüntüsü tek başına PDF içeriğinin görsel kabulü sayılmadı; ayrıca üretilen sayfa görüntüleri incelendi.

Aynı tanı koşumunda numarasız kesin fatura PDF'i 400 ile engellendi. Bu mevcut koruma korunarak yalnız izole fixture'a sentetik numara eklendi. [İlk gövde okuma başarısızlığı](../.release-candidates/f02-pilot-20261017-9/f02-tam-akis-prova-ilk-pdf-govde-okumasi.json), [numarasız fixture sonucu](../.release-candidates/f02-pilot-20261017-9/f02-tam-akis-prova-numarasiz-fixture.json) saklandı; son 16 kontrolün tamamı geçti. Bu tanı/düzeltmeler ürün kaynaklarını veya derlenmiş çıktıları değiştirmedi.

## Sonuç ve devam noktası

[Kabul özetinde](../.release-candidates/f02-pilot-20261017-9/yerel-kabul-ozeti.json) **214 kontrol** var: 90 API/veritabanı + 17 F02 standalone + 3 kaşe regresyonu + 70 PDF/fatura birim + 6 çok dilli PDF + 11 Node 22 API/worker + 1 Node 22 PDF + 16 tam akış. Kontrol grupları bazı davranışları ayrı başlangıç ve tarayıcı koşumlarında tekrar sınar; sayı farklı iş senaryoları sayısı değildir.

Kaynak özeti son kabulde güncel çalışma alanıyla aynı. API/web ve runtime dosya özetleri doğrulandı; geçici DB'ler, konteynerler ve ağlar temizlendi. 72 kanıt dosyası [SHA-256 manifestinde](../.release-candidates/f02-pilot-20261017-9/kanit-manifest.json) korunur. [Özetleme/doğrulama betiği](../.release-candidates/f02-pilot-20261017-9/kabul-ozetle.mjs).

Bu adımla 7. adayın dışında kalan güncel kaynakların yerel teknik kabulü tamamlandı. Gerçek şirket verileri, ayarları ve çalışan servisler değiştirilmedi; gerçek doğal pilot kaydını erteleme kararı korunuyor. Önceki şirket modu bu oturumda DB üzerinden yeniden okunmadı. Otomasyon, bildirim veya canlı yayın açılmadı.

Sıradaki işler gerçek doğal pilot/alan kabulü, üretim kapasitesi, uygun önceki sürüme dönüş, hedef ortam kurulumu ve yayın geçişidir. Bunlar bu yerel teknik kabulün kapsamı dışındadır.
