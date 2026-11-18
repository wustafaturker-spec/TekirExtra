# TekirExtra — Yapay zekâ ayrıntılı imalat programı

Tarih: 14 Kasım 2026  
Sürüm: 1.0  
Durum: Planlandı; bu belgenin kaydedilmesi uygulama işlerinin tamamlandığı anlamına gelmez.  
Amaç: Mevcut yapay zekâ altyapısını yetkileri koruyan, kaynaklarını doğrulayan ve günlük iş süreçlerini ölçülebilir biçimde tamamlayan bir yardımcıya dönüştürmek.

## 1. Dayanak, kapsam ve mevcut durum

Bu program, 14 Kasım kaynak kod incelemesi ve ardından belirlenen geliştirme önerilerinin uygulanabilir iş kırılımıdır. Mevcut sağlayıcı adaptörleri, araç yürütücüsü, onaylar, finans kaynakları, OCR, hafıza, görevler ve teklif otomasyonu genişletilir. Aynı işlevler için ikinci bir altyapı kurulmaz.

Dayanak belgeler:

- [Önceki inceleme ve üretim planı](../YAPAY-ZEKA-INCELEME-VE-URETIM-PLANI-2026-10-14.md).
- [Modüller arası üretim planı](AI-MODULLER-ARASI-URETIM-PLANI-2026-10-14.md).
- [Ek entegrasyon iş planı](YAPAY-ZEKA-EK-ENTEGRASYON-IS-PLANI-2026-11-05.md).
- [Finans kaynakları](AI-FINANS-KAYNAKLARI.md) ve [kalite testleri](AI-KALITE-TESTLERI.md).

Bu belge mevcut bileşenlerin iyileştirilmesi için güncel iş sırasını belirler. Önceki belgelerdeki tamamlanma işaretleri bu belgedeki işleri otomatik kapatmaz. Satın alma karşılaştırması, şirket belgelerinde kaynaklı arama ve uzman çalışma ekranları önceki ek entegrasyon planında kalır; burada hazırlanan ortak bileşenleri kullanırlar.

İncelemede gözlenenler:

| Konu | Mevcut temel | Geliştirme ihtiyacı |
|---|---|---|
| Yetkilendirme | Ortak araç yürütücüsü ve uç denetimleri | Arka plan kullanıcı bağlamında özel rolün korunması |
| Görevler | Günlük çalışma kaydı, sahiplik, yeniden deneme | Kapalı sağlayıcı sonucu ve sahiplik sonlandırma denetimi |
| Finans | Sohbette kaynaklı yanıt, caride olgu seçimi | Yönetici yorumunda aynı doğrulama standardı |
| Bütçe | Günlük çağrı kilidi ve çağrı sonrası maliyet | Eşzamanlı maliyet rezervasyonu ve kayıp telemetri |
| OCR | Şema/doğrulama, model yedeği, kayıt izi | Toplu belge kuyruğu ve alan bazında inceleme |
| e-Belge | Yardımcı AI denetimleri | Zaman aşımında alttaki isteğin iptali |
| Teklif | E-postadan çıkarım ve aday eşleştirme | Zincir, tekrar, fiyat sürümü ve eksik bilgi akışı |
| Hafıza | Kullanıcı kararını koruyan eşleşmeler | Kapsam, açıklama ve geçerlilik yönetimi |
| Kalite | AI klasöründe 39 dosyada 435 test geçti | Gerçek model ve uçtan uca kabul kapsamını genişletme |

Test sonucu yalnız önceki incelemede çalıştırılan AI birim grubuna aittir; canlı model doğruluğu, tüm API testleri veya üretim kabulü olarak yorumlanmaz. Bu belge hazırlanırken uygulama testleri yeniden çalıştırılmadı.

## 2. Üretim kuralları

1. Firma izolasyonu, temel rol, özel rol, abonelik ve kayıt erişimi her giriş kanalında uygulanır.
2. Model, uygulamanın sunduğu araçlar ve adaylar dışından yetki veya kayıt kimliği oluşturamaz.
3. Finansal hesaplar iş servislerinde yapılır; model doğrulanmış olguları seçer ve sınırlı açıklama üretir.
4. Taslak oluşturma ile kesinleştirme/gönderim ayrı adımlardır; mevcut onay kuralları korunur.
5. E-posta, belge ve araç çıktısı kullanıcı talimatı yerine geçmez.
6. Yan etkili işlemler tekrar çağrıldığında aynı mantıksal işlemi ikinci kez uygulamaz.
7. İptal, zaman aşımı, kota ve aktarım engelleri başka sağlayıcı seçilerek aşılamaz.
8. Varsayılan telemetride belge/sohbet gövdesi, kimlik numarası veya API anahtarı tutulmaz.
9. Şema değişiklikleri ileriye dönük migration ile yapılır; mevcut veri ve açık onaylar korunur.
10. Yeni otomasyonlar özellik bayrağıyla açılır; kullanıcıya açıklanabilir durum ve kaynak sunulur.

## 3. Organizasyon ve tahmin yöntemi

Sorumluluklar kişi adı yerine rolle tanımlanmıştır; işe başlarken sahip atanır.

| Rol | Sorumluluk |
|---|---|
| Teknik sorumlu | Sözleşmeler, bağımlılıklar, tasarım kararları ve kod inceleme |
| API geliştirici | Yetki, servisler, sağlayıcılar, görevler ve veri modeli |
| Web geliştirici | İnceleme ekranları, işlem durumu ve mobil görünüm |
| QA sorumlusu | Kabul senaryoları, gerçek model ölçümü ve regresyon kanıtı |
| Operasyon sorumlusu | Migration, gözlemleme, özellik bayrakları ve geri dönüş |
| İş alanı temsilcisi | Muhasebe/satış kuralları, örnek belgeler ve pilot kabul |

Eforlar kişi-gün cinsinden ilk tahmindir; geliştirme, inceleme ve paket içi testleri kapsar. Sağlayıcı bekleme süresi, veri hazırlama gecikmesi ve dış entegrasyon sorunları dahil değildir. AI-IM-00 sonunda tahminler güncellenir. Bağımsız paketler ekip kapasitesine göre birlikte yürütülebilir; bağımlılık tamamlanmadan bağlı paket kabul edilemez.

## 4. Ana iş listesi ve bağımlılıklar

| Kod | Öncelik | İş paketi | Bağımlılık | Efor | Ana sorumlu |
|---|---|---|---|---|---|
| AI-IM-00 | P0 | Envanter, başlangıç ölçümü ve sözleşmeler | Yok | 2–3 | Teknik sorumlu, QA |
| AI-IM-01 | P0 | Ortak kullanıcı bağlamı | 00 | 3–5 | API |
| AI-IM-02 | P0 | Görev durumları ve sahiplik güvenliği | 01 | 3–5 | API |
| AI-IM-03 | P0 | Yönetici yorumunun olgu tabanlı doğrulanması | 00 | 3–5 | API, muhasebe |
| AI-IM-04 | P1 | Ortak AI yürütme ve yetenek yönlendirmesi | 01, 02, 03 | 5–8 | API |
| AI-IM-05 | P1 | Bütçe rezervasyonu ve maliyet uzlaştırma | 04 | 5–8 | API, operasyon |
| AI-IM-06 | P1 | İptal ve zaman aşımı zinciri | 04 | 3–5 | API, web |
| AI-IM-07 | P1 | Kalıcı iz ve yönetim görünürlüğü | 04, 05 | 3–5 | API, web |
| AI-IM-08 | P1 | Belge gelen kutusu ve işleme kuyruğu | 04, 05, 06 | 6–10 | API, web |
| AI-IM-09 | P1 | Alan bazında OCR inceleme ve düzeltme | 08 | 5–8 | Web, API, muhasebe |
| AI-IM-10 | P1 | Teklif talebi çıkarımı ve eşleştirme | 01, 04, 06 | 5–8 | API, satış |
| AI-IM-11 | P1 | Fiyatlı teklif taslağı ve onaylı gönderim | 05, 10 | 5–8 | API, web, satış |
| AI-IM-12 | P2 | Hafıza kapsamı ve geçerlilik | 01, 10 | 4–6 | API, web |
| AI-IM-13 | P2 | Ortak işlem ve kaynak ekranları | 02, 03, 06, 07 | 4–6 | Web |
| AI-IM-14 | P0/P1 | Kalite havuzu ve yayın kapıları | 00 ile başlar; her paketle genişler | 6–10 | QA, API |
| AI-IM-15 | P1 | Pilot, operasyon ve kontrollü yayın | Yayına alınacak paketler, 14 | 3–5 | Operasyon, QA |

Toplam ilk tahmin: 65–105 kişi-gün. AI-IM-14 eforu diğer paketlerdeki birim testlerine ek olan ortak kalite altyapısı ve değerlendirme çalışmasıdır. Takvim taahhüdü değildir.

## 5. Ayrıntılı iş paketleri

### AI-IM-00 — Envanter ve başlangıç ölçümü

İmalat:

- [ ] Web, mobil, Telegram, MCP, görev, e-posta ve e-Belge girişlerini listele.
- [ ] Her giriş için sağlayıcıya ulaşan yolu, veri kapsamını ve yetki kaynaklarını çıkar.
- [ ] Mevcut model/istem/şema sürümleri ile özellik bayraklarını kaydet.
- [ ] Kullanılabilir test ve kabul komutlarını doğrula; canlı veri yazanları açıkça ayır.
- [ ] Anonim/sentetik belge ve talep örnekleri hazırla; geliştirme ve ayrı değerlendirme setlerini ayır.
- [ ] API yanıtları, durum kodları ve geçiş dönemi uyumluluğu için karar kaydı oluştur.

Çıktı: Envanter tablosu, başlangıç ölçümü, atanmış iş listesi ve güncellenmiş eforlar.

Kabul: Her aktif AI girişinin sahibi, yetki kaynağı, maliyet yolu ve test yöntemi bulunur. Ölçülmeyen değerler tahmin olarak işaretlenir.

### AI-IM-01 — Ortak kullanıcı bağlamı

Kaynaklar: `apps/api/src/core/istek-baglami.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/src/ai/ajan/uc-cagirici.ts`, görev ve teklif servisleri.

İmalat:

- [ ] Güncel kullanıcı, aktiflik, temel rol, özel rol ve paket kapsamını yükleyen ortak çözümleyici tasarla.
- [ ] Worker görevleri ve teklif sorumlusunun bağlamını bu çözümleyiciden kur.
- [ ] Onay sonrasında devam eden otomasyonlarda yetkiyi yeniden yükle.
- [ ] Sistem bakım kimliği ile gerçek kullanıcı adına yürütülen işlemleri ayrı sözleşmelerle tanımla.
- [ ] Yetki verisi okunamıyorsa işlemi durdur; temel role sessizce geri dönme.

Kabul: Kullanıcının panelde kapalı olan bölümü görev, teklif otomasyonu veya MCP üzerinden de kullanılamaz. Rol sonradan değiştiğinde bekleyen işlem güncel yetkiyle değerlendirilir.

Test: Temel rol × özel rol × paket matrisi; pasif/silinmiş kullanıcı; firmalar arası kimlik; işlem beklerken rol değişikliği. Gerçek PostgreSQL/RLS üzerinde en az iki firmayla kabul testi.

### AI-IM-02 — Görev durumları, sahiplik ve tekrar güvenliği

Kaynak: `apps/api/src/ai/ayarlar/ai-gorev-yurutucu.ts`, görev modelleri ve bakım servisi.

İmalat:

- [ ] Kapalı sağlayıcı sonucunu başarıdan ayır; mevcut UI/API için uyumluluk eşlemesi tanımla.
- [ ] Çalışma sonucu kodları öner: `basarili`, `kosul_saglanmadi`, `saglayici_kapali`, `sinir_asildi`, `yetkisiz`, `iptal`, `hata`, `sonuc_belirsiz`.
- [ ] Her sonuç için yeniden deneme, gün kapatma ve bildirim kararını tabloya bağla.
- [ ] Çalışma tamamlamalarını sahiplik anahtarı ve beklenen durum koşuluyla atomik yap.
- [ ] Sahipliği kaybeden worker'ın yeni worker sonucunu ezmesini engelle.
- [ ] Süresi aşan çalışmada deneme sınırını ve toplam çalışma süresini denetle.
- [ ] Araç başarısı ile görevin amacının tamamlanmasını ayrı kaydet.

Kabul: Sağlayıcı kapalıyken başarı bildirimi oluşmaz. Aynı gün için iki worker tek geçerli çalışma sahibi üretir. Eski worker yeni sonucu değiştiremez. Sonucu belirsiz yan etkili iş körlemesine tekrarlanmaz.

Test: İki worker yarışı; süreç çökmesi; sahiplik devri; kapalı sağlayıcı; bütçe/429; geçici 503; bildirimin gönderilememesi.

### AI-IM-03 — Finansal olgu sözleşmesi ve yönetici yorumu

Kaynaklar: `ai/rapor/ai-rapor.service.ts`, `ai/cari-ozet/`, `ai/ajan/finans-kaynaklari.ts`, `finans-aciklama.ts`.

İmalat:

- [ ] Ortak olgu sözleşmesi: kimlik, metrik kodu, ondalık değer, para birimi, birim, dönem, alınma zamanı, kaynak, uyarı ve hesaplama sürümü.
- [ ] Yönetici yorumunda serbest tutar üretimini kaldır; model yalnız izinli olgu/yorum kodlarını seçsin.
- [ ] Açıklama metnini doğrulanmış şablonlarla uygulamada oluştur.
- [ ] Bakiye ile dönem hareketi, net/brüt kâr ve vergi dahil/hariç ayrımlarını koru.
- [ ] Eksik kur/veri ve karışık dövizi açıkça göster; eksik veri sıfır sayılmasın.
- [ ] Parasal hesaplarda mevcut Decimal/ondalık sözleşmelerini kullan; sunum dönüşümlerini sınırla.
- [ ] Model başarısızsa doğrulanmış temel özeti döndür.

Kabul: Model kaynak dışı tutar, oran, dönem veya metrik ilişkisi gösteremez. Yetkisiz kaynak cevaba giremez. Kaynak ekranına bağlantı bulunur.

Test: Negatif/büyük tutar, sıfır, eksik veri, karışık döviz, dönem sınırı, brüt/net karışması ve modelin bilinmeyen olgu kimliği döndürmesi.

### AI-IM-04 — Ortak yürütme servisi ve model yetenekleri

Kaynaklar: `ai/saglayici/`, `ai/ai.service.ts` ve sağlayıcı kullanan bütün modül servisleri.

İmalat:

- [ ] Mevcut sayaçlı sağlayıcıyı koruyarak ortak yürütme sözleşmesi oluştur.
- [ ] Sözleşmeye iş türü, özellik, kanal, kullanıcı bağlamı, süre, iptal sinyali, çıktı sınırı, şema/istem sürümü ve takip kimliğini ekle.
- [ ] Model yeteneklerini tanımla: görsel, araç çağrısı, yapılandırılmış çıktı, giriş sınırı ve ölçülmüş alan performansı.
- [ ] Yetenek kayıtlarını firma/sağlayıcı/model/sürüm kapsamında süreli tut; manuel sıfırlama ekle.
- [ ] Ekonomik/güçlü seçimlerini yetenek ve aktarım onayıyla birlikte değerlendir.
- [ ] Yedek modele geçiş nedenlerini sınıflandır; yetki/onay/kota engellerinde geçişi reddet.
- [ ] Bağlantı testleri dahil sayaç ve maliyet kapsamını açık politika olarak belirle.
- [ ] OCR, özet, e-Belge, ekstre ve hatırlatma çağrılarını aşamalı taşı.

Kabul: Her üretim çağrısı yetki, aktarım, kota, bütçe ve izleme politikasından geçer. Taşınan modülün önceki doğrulanmış davranışı korunur. Sağlayıcıya özel farklar adaptörde kalır.

Test: Her adaptör için sözleşme testleri; bozuk JSON; boş yanıt; uyumsuz yetenek; onaysız yedek; sağlayıcı hata sınıfları.

### AI-IM-05 — Bütçe rezervasyonu ve uzlaştırma

İmalat:

- [ ] Firma/ay bazında tüketilmiş ve ayrılmış maliyeti birlikte denetle.
- [ ] Sunucunun belirlediği azami çıktı ve fiyat sürümü üzerinden rezervasyon hesapla.
- [ ] Görsel/giriş maliyeti kesin sınırlanamıyorsa sert tavan garantisi verme; destek politikasını açık göster.
- [ ] Rezervasyonu atomik ayır; sağlayıcı çağrısından sonra gerçek kullanımla bir kez uzlaştır.
- [ ] Zaman aşımı/iptalde kullanım bilinmiyorsa rezervasyonu hemen serbest bırakma; uzlaştırma kuyruğuna al.
- [ ] Hata/çökme sonrası uzlaştırma işi, süre sınırı ve operatör inceleme ekranı ekle.
- [ ] Platform ve firma anahtarlarında doğru fiyat/tavan kaynağını kullan; güçlü model maliyetini ortak bütçeye kat.
- [ ] Çağrı izi yazılamazsa kalıcı yeniden deneme sağla; maliyet kaybını alarm olarak göster.

Kabul: Aynı kalan bütçe iki çağrıya birden ayrılmaz. Aynı sonuç iki kez ücretlenmez. Kullanımı belirsiz çağrı bütçeyi sessizce açmaz. Ay değişimi Türkiye saatine göre belirlenir.

Test: 20 eşzamanlı rezervasyon; işlem ortasında çökme; çift sonuç; ay sınırı; eksik fiyat; gerçek/tahmini token; platform/BYOK ayrımı.

### AI-IM-06 — İptal ve süre zinciri

İmalat:

- [ ] UI → API → döngü → sağlayıcı isteğine iptal sinyalini taşı.
- [ ] İstek için tek son tarih belirle; yeniden denemeler kalan süreyi kullansın.
- [ ] e-Belge `Promise.race` bekleme sınırını gerçek istek iptaline bağla.
- [ ] İptalden sonra yeni araç/model çağrısı başlatma.
- [ ] Tamamlanmış kayıt ve açılmış onayları sonuçta açıkça belirt.
- [ ] Sağlayıcının iptal sonrası da ücret oluşturabileceğini maliyet durumunda temsil et.

Kabul: İptal veya süre bitimi yeni iş başlatmaz. Oluşmuş yan etkiler yok sayılmaz. İptal edilen yanıt başarı olarak kaydedilmez.

Test: Model beklerken iptal; araçlar arasında iptal; onay açıldıktan sonra iptal; bağlantı kopması; bütçe rezervasyonunun belirsiz kullanımla uzlaştırılması.

### AI-IM-07 — Kalıcı izleme ve yönetim görünürlüğü

İmalat:

- [ ] İstek, model çağrısı, araç, görev ve onay takip kimliklerini ilişkilendir.
- [ ] Özellik/model bazında başarı, hata sınıfı, p50/p95 süre, token ve maliyet göster.
- [ ] Yedek model oranı, rezervasyon bekleyenler, tekrarlar ve iptalleri ekle.
- [ ] Mevcut telemetri bakımını maliyet/rezervasyon saklama ihtiyaçlarıyla uyumlu tut.
- [ ] Firma erişimi ve platform toplam görünümünü ayrı yetkilendir.

Kabul: Bir başarısız işlemin hangi aşamada kaldığı içerik gövdesi kaydetmeden bulunabilir. Maliyet kayıtları gerekli uzlaştırma süresi dolmadan temizlenmez.

### AI-IM-08 — Belge gelen kutusu ve kuyruk

İmalat:

- [ ] Dosya/iş kaydı, sayfa bilgisi, belge türü ve işleme durumlarını tanımla.
- [ ] Mevcut ek depolaması ve iş kuyruğu altyapısını tekrar kullan.
- [ ] Çok sayfalı PDF ve toplu yükleme için boyut/sayfa/adet sınırı uygula.
- [ ] Dosya imzası, MIME, görüntü boyutu ve ayrıştırma kaynak sınırlarını denetle.
- [ ] Firma kapsamlı dosya özeti ve belge anahtarlarıyla mükerrer adayları tespit et.
- [ ] Aynı dosyadan farklı meşru belge oluşmasını destekle; mükerrer adayı otomatik silme.
- [ ] Kısmi başarısız toplu işte başarılı belgeleri koru; kalanları güvenli tekrar işle.
- [ ] Belgeden oluşan taslak/kayıtları denetim iziyle bağla.

Kabul: Tek dosya ve toplu yükleme aynı doğrulamalardan geçer. Aynı işin tekrarı mükerrer taslak açmaz. Başka firmanın özeti/varlığı kullanıcıya sızmaz.

### AI-IM-09 — OCR alan inceleme ve düzeltme

İmalat:

- [ ] Alan değerini sayfa ve varsa konum/alıntı kanıtıyla göster.
- [ ] Sağlayıcı konum üretmiyorsa alanı konumsuz işaretle; sahte kanıt oluşturma.
- [ ] Model güveni, aritmetik kontrol ve eşleşme kesinliğini ayrı göster.
- [ ] KDV kırılımı, matrah, toplam, döviz ve tarih çelişkilerini belirginleştir.
- [ ] Çek/senette rakam-yazı tutar çelişkisini çözülmesi gereken engel yap.
- [ ] Zorunlu/belirsiz alanlar için kullanıcı kararı iste; taslağa aktarmadan sunucuda yeniden doğrula.
- [ ] Orijinal çıkarım ve kullanıcı düzeltmesini ayrı sakla; saklama ve erişim politikasını tanımla.

Kabul: Tek güven puanı otomatik kayıt kararı vermez. Çelişkili tutar veya belirsiz zorunlu alan çözülmeden ilerlenemez. Düzeltme geçmişi kaynağa bağlıdır.

Test: Düşük kaliteli görüntü; eksik sayfa; çoklu KDV; bilinmeyen döviz; geçersiz tarih; tutar çelişkisi; klavye ve mobil inceleme.

### AI-IM-10 — Teklif talebi çıkarımı ve aday yönetimi

İmalat:

- [ ] Yeni e-posta metni, imza, eski alıntı ve yönlendirilmiş içeriği ayır.
- [ ] Talebin yeni istek/revizyon/tekrar olmasını sınıflandır; belirsizse incelemeye al.
- [ ] Cari, ürün, varyant, miktar ve birim adaylarını kaynak ifadeyle göster.
- [ ] Birim dönüşümünü mevcut stok kurallarından yap; tanımsız dönüşümü reddet.
- [ ] Model seçimini sunulan adaylarla sınırla; belirsizliği kullanıcıya taşı.
- [ ] Stokta olmayan kalemler için kaynaklı alternatif veya satın alma önerisi hazırla.
- [ ] Eksik bilgi için düzenlenebilir müşteri yanıt taslağı oluştur.

Kabul: Eski alıntıdaki miktar yeni talebi ezmez. Yanlış/çoklu eşleşme sessiz seçilmez. E-posta içeriği kendi başına gönderim veya kesin işlem başlatamaz.

### AI-IM-11 — Fiyatlı teklif ve onaylı gönderim

İmalat:

- [ ] Fiyat, iskonto, vergi, döviz, vade ve müşteri koşullarını iş servislerinden getir.
- [ ] Fiyat kaynağı, geçerlilik zamanı ve toplam hesap sürümünü taslağa bağla.
- [ ] Taslak kaydında ve onayda güncel fiyat/stok politikasını yeniden değerlendir.
- [ ] Stok kontrolünü rezervasyon garantisi gibi gösterme; gerçek rezervasyon varsa açıkça belirt.
- [ ] Gönderilecek alıcı, konu, metin, ek ve belge sürümünü onay önizlemesine bağla.
- [ ] Her yan etkili adım için mantıksal işlem anahtarı kullan; belirsiz gönderimi incelemeye al.
- [ ] E-posta → çıkarım → teklif → onay → gönderim zincirini göster.

Kabul: Model fiyat veya iskonto uyduramaz. İçerik/alıcı değişirse önceki gönderim onayı kullanılamaz. Yeniden deneme ikinci teklif veya ikinci gönderim oluşturmaz.

### AI-IM-12 — Hafıza kapsamı, açıklama ve geçerlilik

İmalat:

- [ ] Kullanıcı, firma ve cari kapsamlarını açıkça ayır; mevcut kayıtlar için uyumlu varsayılan belirle.
- [ ] Kaynak, onaylayan, sürüm, son doğrulama ve geçerlilik bilgilerini ekle.
- [ ] Kullanıcı kararı ile otomatik önerinin öncelik kurallarını koru.
- [ ] Pasif stok/varyant, kapanan cari ve geçersiz birim ilişkilerini kontrol et.
- [ ] Çelişen eşleşmeleri inceleme listesine taşı; bütün firmaya sessiz yayma.
- [ ] “Neden önerildi?” açıklamasını kaynak ve kullanım geçmişiyle göster.
- [ ] Silme/pasife alma, dışa aktarma ve saklama davranışını tanımla.

Kabul: Bir kullanıcıya özel tercih başka kullanıcıya uygulanmaz. Pasif kayıt geri öğrenilmez. Güncel fiyat/bakiye kalıcı hafıza değeri olarak kullanılmaz.

### AI-IM-13 — Ortak işlem ekranı

İmalat:

- [ ] Okunan kaynak, hazırlanan işlem, bekleyen karar ve oluşan sonuç için ortak kartlar oluştur.
- [ ] Önce/sonra değerlerini ve hedef kaydı göster.
- [ ] Cari/stok adayları için seçim kartları sun; UUID yazma ihtiyacını kaldır.
- [ ] Bekliyor, onaylandı, çalışıyor, tamamlandı ve sonucu belirsiz durumlarını ayır.
- [ ] İlerleme, iptal ve güvenli yeniden denemeyi ortak bileşenlere taşı.
- [ ] Mobil görünümü ve klavye/ekran okuyucu kullanımını doğrula.
- [ ] Telegram'da kanal veri kapısını koru; hassas ayrıntı için yetkili panel bağlantısı sun.

Kabul: Kullanıcı bir işlemin yapılıp yapılmadığını model metnine bakmadan anlayabilir. “Onaylandı” ifadesi tek başına “tamamlandı” olarak gösterilmez.

### AI-IM-14 — Kalite havuzu ve yayın kapıları

İlk değerlendirme havuzu, en az 50 farklı senaryodan oluşur:

| Alan | Asgari senaryo |
|---|---|
| Yetki, özel rol, firma ve kanal izolasyonu | 10 |
| Finansal kaynak, dönem ve para birimi | 10 |
| OCR ve kullanıcı düzeltmesi | 10 |
| Teklif, birim, varyant ve tekrar | 10 |
| Hafıza, görev, iptal ve sağlayıcı hataları | 10 |

İmalat:

- [ ] Her senaryoya girdi, beklenen karar, izinli araçlar ve doğrulanabilir sonuç yaz.
- [ ] Kritik model senaryolarını en az üç tekrar çalıştır; desteklenen profilleri ayrı raporla.
- [ ] İstem/şema/model sürümlerini sonuçla birlikte kaydet.
- [ ] Geliştirme örnekleri ile yayın değerlendirme örneklerini ayrı tut.
- [ ] Gerçek model testlerini sentetik/anonim veriyle ve açık maliyet sınırıyla çalıştır.
- [ ] Yanıt metni yanında oluşan kayıt ve işlem durumunu denetle.
- [ ] Paket bazında birim, entegrasyon, HTTP ve gerekli tarayıcı kabul kanıtlarını ilişkilendir.

Yayın kapıları:

- Yetkisiz erişim, firma sızıntısı, onaysız kesin işlem ve mükerrer yan etki için test havuzunda tolerans sıfırdır. Tek olay ilgili yayını durdurur; bu, bütün olası durumlar için güvenlik garantisi değildir.
- Doğrulanmış finansal metinde kaynak dışı tutar/para birimi/dönem için tolerans sıfırdır.
- OCR doğruluğu alan bazında, teklif doğruluğu satır bazında ölçülür; belirsizlikte doğru şekilde kullanıcıya bırakma ayrıca sayılır.
- İş başarısı, düzeltme oranı, p95 süre ve işlem maliyeti hedefleri AI-IM-00 başlangıç ölçümünden sonra pilot öncesi sayısallaştırılır. Boş hedefle yayın kabulü yapılmaz.
- Model/istem değişikliği aynı değerlendirme setinde önceki sürümle karşılaştırılır; başarısız kritik senaryoyla yayın yapılmaz.

### AI-IM-15 — Pilot ve kontrollü yayın

İmalat:

- [ ] Modül/kanal/firma düzeyinde mevcut ayarlara uyumlu özellik bayrakları tanımla.
- [ ] Önce test ortamı, sonra sınırlı firma pilotu, ardından ölçüme bağlı yayılım uygula.
- [ ] Pilot için düşük maliyet sınırı, görev sayısı ve toplu belge sınırı belirle.
- [ ] Durdurma, geri dönüş ve belirsiz işlem inceleme yönergesini hazırla.
- [ ] Destek ekibine durum kodları, kaynak kartları ve tekrar kurallarını anlat.
- [ ] Pilot raporunda başarı, hata, kullanıcı düzeltmesi, süre ve maliyeti karşılaştır.

Kabul: Kritik olayda ilgili otomasyon bağımsız kapatılabilir. Açık onaylar, taslaklar ve maliyet rezervasyonları korunur. Geri dönüş testi tamamlanır.

## 6. Veri modeli ve API üretim hazırlığı

Aşağıdaki adlar taslak kavramlardır; mevcut Prisma modelleri incelenmeden yeni tablo açılmaz.

| Kavram | Asgari bilgi | Kurallar |
|---|---|---|
| AI işlem kaydı | Firma, kullanıcı, kanal, özellik, durum, takip kimliği | Her durum geçişi zamanlı ve koşullu |
| Maliyet rezervasyonu | Firma/ay, fiyat sürümü, ayrılan/gerçek maliyet, çağrı kimliği | Atomik rezervasyon ve tekil uzlaştırma |
| Belge işi | Dosya, sayfa, özet, sürüm, durum ve bağlı kayıtlar | Firma kapsamlı tekrar denetimi |
| Alan kanıtı | Alan, çıkarılan değer, sayfa/konum, doğrulama | Konum yoksa açık eksiklik |
| Düzeltme kaydı | İlk değer, kullanıcı değeri, karar zamanı | Kaynak ve erişim politikası korunur |
| Model yeteneği | Sağlayıcı/model, yetenek, ölçüm/sürüm, geçerlilik | Onay veya yetki yerine geçmez |

Şema kabul listesi:

- [ ] Yeni firma verilerinde RLS, indeksler ve ilişkili kayıtların aynı firmaya ait olması doğrulandı.
- [ ] Büyük tablolara ekleme/backfill işlemleri parçalara bölündü; kilit etkisi ölçüldü.
- [ ] Mevcut kayıtların varsayılanı, nullable alanları ve durum eşlemeleri tanımlandı.
- [ ] Eski/yeni API sürümlerinin birlikte çalışması ve açık işlerin devamı denendi.
- [ ] İstemci tarafından gelen durum, maliyet ve yetki alanları güvenilir kabul edilmiyor.
- [ ] Geçmiş model çıktısı geçersiz şemadaysa güvenli görüntüleme/yeniden işleme yolu var.

## 7. Teslimat programı ve kilometre taşları

Takvim başlangıcı ekip ataması sonrasında belirlenir. Örnek program, iki geliştirici ve yarı zamanlı QA/iş alanı desteği varsayar. 12 hafta yaklaşık 120 geliştirici-gün kapasite sağlar; toplantı, destek ve dış bağımlılıklar nedeniyle bütün kapasite planlanmaz. Üst efor sınırı oluşursa süre uzatılır veya P2 paketleri sonraki teslimata taşınır.

| Dönem | İşler | Teslimat kapısı |
|---|---|---|
| 1. hafta | 00, 14 başlangıcı; 01/03 tasarımı | Envanter ve başlangıç ölçümü kabulü |
| 2–3. hafta | 01, 02, 03; kritik regresyonlar | K1: Yetki, görev ve finans düzeltmeleri |
| 4–6. hafta | 04, 05, 06, 07 | K2: Ortak yürütme, bütçe, iptal ve gözlemleme |
| 7–9. hafta | 08, 09, 10; paket bazlı pilot hazırlığı | K3: Belge inceleme ve teklif çıkarımı |
| 10–11. hafta | 11, 12, 13; kalite havuzu tamamlama | K4: Uçtan uca teklif ve açıklanabilir hafıza |
| 12. hafta ve gerekirse devamı | 15, pilot ölçümü ve düzeltmeler | K5: Kontrollü yayın kararı |

K1 küçük ve bağımsız sürüm olarak yayımlanabilir; büyük ortak katman dönüşümü beklenmez. Sonraki paketler K1 davranışını koruyan regresyon testleriyle geliştirilir. Her kilometre taşında kalan efor yeniden hesaplanır.

## 8. Test uygulama programı

Komutlar ilgili paketin ihtiyacına göre çalıştırılır; aşağıdakiler bu belgede yürütülmüş sonuç değildir.

API çalışma dizini: `apps/api`.

```bash
pnpm exec vitest run src/ai
pnpm exec vitest run src/ebelge/on-denetim-ai.test.ts src/ebelge/gelen-denetim-ai.test.ts
pnpm run typecheck
```

Web çalışma dizini: `apps/web`.

```bash
pnpm run typecheck
pnpm test
```

HTTP/PostgreSQL kabulü ve Playwright testleri AI-IM-00'da doğrulanan test ortamında ilgili senaryolarla çalıştırılır. Canlı model ölçümünde `test:ai-kalite` ve mevcut `AI_KALITE_*` sözleşmesi kullanılır; sağlayıcı/model açık seçilir, anahtarlar rapora yazılmaz. Paylaşılan veya üretim verisine kontrolsüz test yazımı yapılmaz.

| Seviye | Sorumluluk | Zorunlu kanıt |
|---|---|---|
| Birim | Durumlar, olgular, eşleştirme, hesap ve hata sınıfları | Paketle ilişkili test sonucu |
| Entegrasyon | RLS, yarışlar, kuyruk, rezervasyon ve sahiplik | Gerçek servislerle izole sonuç |
| HTTP | Web/MCP yetkisi ve tekrar güvenliği | İstek/sonuç ve oluşan kayıt denetimi |
| Tarayıcı | OCR, seçim, onay, iptal ve mobil görünüm | Kritik kullanıcı akışları |
| Gerçek model | Doğruluk, belirsizlik, saldırgan içerik, süre/maliyet | Model/istem/sürüm bazlı rapor |

## 9. Operasyon ve geri dönüş

- Uygulama sürümü geri alınsa da açık işlerin okunabilmesi için şema değişiklikleri önce genişletilir, eski alan kaldırma ayrı sürüme bırakılır.
- Kritik yetki/finans bulgusunda ilgili otomasyon bayrağı kapatılır; mevcut manuel ekranlar kullanılabilir kalır.
- Maliyet veya sağlayıcı sorunu varsa yalnız ilgili profil/özellik kapatılır; aktarım onayı olmayan modele geçilmez.
- Yan etkisi belirsiz iş otomatik tekrar edilmez; ilgili kayıt/gönderim kaynağıyla uzlaştırılır.
- Pilotun başlangıç ve bitişinde açık onay, görev, kuyruk ve rezervasyon sayıları karşılaştırılır.
- Alarm eşikleri örnek hacmine göre belirlenir; az çağrıda yanıltıcı yüzdelere dayalı karar verilmez.

## 10. Riskler ve önlemler

| Risk | Önlem |
|---|---|
| Ortak katman geçişinde davranış değişmesi | Modül modül taşıma, sözleşme testleri, özellik bayrağı |
| Sağlayıcı fiyat/yetenek değişimi | Sürümlü fiyat/yetenek kaydı ve kontrollü yeniden ölçüm |
| OCR kanıt konumunun desteklenmemesi | Konumsuz alan gösterimi; desteklenmeyen kanıtı üretmeme |
| Yetersiz anonim örnek | İş alanı temsilcisiyle veri seti hazırlama; canlı kaliteyi erteleyip hazır saymama |
| Yeni migration ile kuyruk/worker uyumsuzluğu | Genişletme–taşıma–daraltma yaklaşımı ve açık iş testi |
| İptal edilen çağrının yine ücretlenmesi | Belirsiz kullanım rezervasyonu ve sonradan uzlaştırma |
| İstem iyileşirken başka senaryonun bozulması | Ayrı değerlendirme seti ve sürümler arası karşılaştırma |

## 11. Tamamlanma tanımı ve takip kartı

Her paketin kapatılması için:

- [ ] Paket kapsamı ve API/veri sözleşmesi uygulandı.
- [ ] Yetki, firma izolasyonu, tekrar ve hata senaryoları geçti.
- [ ] İlgili birim/entegrasyon/UI kontrolleri tamamlandı; sonuçlar iliştirildi.
- [ ] Maliyet, veri aktarımı ve iptal davranışı belgelendi.
- [ ] Migration/backfill ve geri dönüş etkileri doğrulandı.
- [ ] Kullanıcı ekranları ile destek yönergesi güncellendi.
- [ ] Özellik bayrağı ve pilot kabulü gereken kapsamda hazır.
- [ ] Teknik sorumlu ve iş alanı temsilcisi kabul etti; açık kusurlar kaydedildi.

Takip kartı şablonu:

```text
Paket / alt iş:
Durum: Planlandı | Hazır | Geliştiriliyor | Doğrulanıyor | Pilot | Tamamlandı | Engelli
Sahip:
Bağımlılıklar:
Kapsam / teslimat:
Kabul ölçütleri:
Veri modeli / API etkisi:
Test ve ölçüm kanıtı:
Özellik bayrağı / geri dönüş:
Tahmin / gerçekleşen efor:
Açık kusur / engel / sonraki adım:
```

İlk üretim sırası: **AI-IM-00 → AI-IM-01 ve AI-IM-03 → AI-IM-02 → K1 kabulü**. Bu belge yalnız imalat programını kaydeder; uygulama veya yayın işlemi başlatmaz.
