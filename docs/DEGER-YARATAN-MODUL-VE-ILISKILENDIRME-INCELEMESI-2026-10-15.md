# TekirExtra: değer yaratacak modüller ve ilişkiler

15 Ekim 2026 — güncel çalışma ağacı üzerinden ürün ve iş akışı incelemesi.

Bu inceleme [ayrıntılı geliştirme ve üretime geçiş planına](DEGER-YARATAN-MODULLER-URETIM-PLANI-2026-10-15.md) dönüştürüldü. [58 görevlik iş listesi](DEGER-YARATAN-MODULLER-IS-LISTESI-2026-10-15.csv) paket bağımlılıklarını, sorumlu rolleri ve kabul referanslarını içerir.

## 1. Karar özeti

En güçlü yatırım alanı, mevcut geniş kapsamı sonuç odaklı iş akışlarına bağlamaktır. Öncelik sıram:

1. Kâr kalitesi ve eksik maliyetlerin tamamlanması.
2. Tahsilat takibi: ödeme sözü, itiraz, sorumlu ve gerçekleşen sonuç.
3. CRM fırsatından teklif, sipariş ve tahsilata izlenebilir satış süreci.
4. Satış/üretim taleplerinden tarihli stok ve satın alma ihtiyacı.
5. Alış faturası–mal kabul farkını ödeme kararına bağlama.
6. Pazaryeri hakedişi ve kanal bazında gerçek katkı görünümü.

Yeni modül olarak sözleşme/yenileme, satış sonrası servis/garanti, demirbaş/bakım ve proje zaman takibi anlamlı adaylardır. Bunların sırası hedef işletmeye göre değişir. Geniş bir genel ERP kapsamından önce, tek bir müşteri grubunda baştan sona ölçülebilen akış seçilmelidir.

## 2. İnceleme kapsamı ve kanıt düzeyi

Prisma veri modeli, modül/controller/servis kodları, menü, entegrasyon adaptörleri ve mevcut geliştirme raporları karşılaştırıldı. Şemada **196 model**, panel altında **120 `page.tsx`** dosyası var. Bu sayılar kapsamı gösterir; üretim olgunluğu veya kullanım başarısı ölçüsü değildir.

Bu rapor yeni bir üretim verisi taramasına veya müşteri görüşmelerine dayanmıyor. Öncelikler, kodda gözlenen ilişkiler ve bu oturumda kullanıcının bildirdiği akışlarla oluşturulmuş ürün değerlendirmesidir. Kâr raporunda görülen 17 eksik maliyetli satış satırı, bu oturumun somut veri kalitesi örneğidir; tüm müşteriler için istatistik değildir. Bütün uygulamanın güvenlik, performans ve regresyon testleri bu incelemede yeniden çalıştırılmadı.

Eylül tarihli incelemelerdeki bazı “eksik” özellikler güncel kodda bulunuyor. Aşağıdaki önerilerde eski raporların listeleri doğrudan tekrarlanmadı. “Kodda var”, “bütün iş akışı doğrulandı” ve “müşteri tarafından düzenli kullanılıyor” ayrı durumlardır.

## 3. Zaten bulunan, tekrar geliştirilmemesi gereken temel

| Alan | Güncel kodda görülen altyapı | Değer yaratacak sonraki genişleme |
|---|---|---|
| Satış belgeleri | Teklif → sipariş → irsaliye → fatura zinciri; satış rezervasyonu ve alışta yoldaki stok | CRM, teslimat ve tahsilatın aynı iş görünümünde birleşmesi |
| Cari ve tahsilat | Risk/grup limiti, teminat, ödeme davranışı, tahsilat önceliği, mutabakat | Yapılandırılmış ödeme sözü ve sonuç takibi |
| POS | iyzico/PayTR tahsilatı, ödeme sayfası/linki, e-posta/SMS, fatura kapama | Takip iş listesinin bu araçları sonuçlarıyla birlikte kullanması |
| Banka | CSV/XLSX ekstre, kurallar, eşleştirme, Vomsis senkronu, webhook | Eksik veri ve belirsiz eşleşmelerin daha hızlı çözülmesi |
| Satın alma | Talep, onay, teklifler, bütçe/bağlanan tutar, sipariş | Birleşik ihtiyaç planı, teslim taahhüdü ve ödeme uygunluğu |
| Üçlü eşleştirme | Fatura–sipariş–mal kabul miktar/fiyat farkları ve Düzeltme Merkezi | Açık farkın ödeme kararına kontrollü etkisi |
| Stok maliyeti | Yeniden hesaplama, geçmiş değişiklik kaydı, gider dağıtımı | Eksik maliyetin nedenini bulup kullanıcıyı çözüm akışına götürme |
| Üretim | Reçete, operasyon, rezervasyon, kapasite, maliyet, kalite | Çoklu sipariş/emir için tarihli ihtiyaç ve teslim uygunluğu |
| B2B | Kullanıcı–bayi cari bağı, katalog, fiyat listesi/iskonto, sipariş, ekstre | Sipariş geçmişi, belge, mutabakat ve tahsilatın müşteri görünümü |
| Proje | Aşama, alt kırılım, fatura/masraf/gelir ve nakit ilişkileri | Zaman çizelgesi, işçilik maliyeti ve hakediş |
| Finansal kontrol | Dönem kapatma, bütçe, nakit akışı, düzeltme/bildirim merkezleri | Aynı sorun için tek sorumlu ve çözüm sonucunun ölçülmesi |
| Otomasyon | E-posta/ek OCR, AI araçları/onayları, rapor abonelikleri | Modül içinde bağlama uygun, kaynaklı ve onaylı yardım |

Özellikle **ödeme linki**, **banka entegrasyonu**, **satın alma onayı**, **üçlü eşleştirme**, **B2B kimlik bağı**, **maliyet dağıtımı**, **dönem kapatma** ve **rapor zamanlama** tamamen yeni modül gibi planlanmamalıdır.

## 4. Öncelik matrisi

Yük: küçük = sınırlı ekran/bağlantı; orta = yeni alan modeli ve birkaç modül; büyük = dış entegrasyon veya yaygın veri modeli değişimi. Bunlar göreli değerlendirmedir; takvim/kişi-gün taahhüdü değildir.

| Paket | Niteliği | Fayda | Yük | Öncelikli kullanıcı |
|---|---|---|---|---|
| F01 Kâr kalitesi ve maliyet tamamlama | Mevcut akışı genişletme | Çok yüksek | Orta | Yönetici, muhasebe |
| F02 Tahsilat operasyon merkezi | İlişki + yeni takip kayıtları | Çok yüksek | Orta | Muhasebe, satış |
| F03 CRM–teklif–sipariş bağı | İlişkilendirme | Yüksek | Küçük/orta | Satış ekibi |
| F04 Tarihli ihtiyaç/tedarik planı | Birleşik analiz | Yüksek | Orta/büyük | Satın alma, depo, üretim |
| F05 Ödeme uygunluğu ve tedarikçi fark yönetimi | Mevcut akışları bağlama | Yüksek | Orta | Satın alma, muhasebe |
| F06 Kanal katkısı ve hakediş | Analiz + entegrasyon genişlemesi | Yüksek; kanal kullanılıyorsa | Orta/büyük | E-ticaret işletmesi |
| F07 Müşteri çalışma alanı | B2B/portal genişlemesi | Yüksek; bayi hacmi varsa | Orta | Bayi, müşteri temsilcisi |
| F08 Proje zaman/hakediş | Yeni alt modül | Yüksek; hizmet işinde | Orta | Hizmet/proje işletmesi |
| F09 Sözleşme ve yenileme | Yeni modül | Yüksek; düzenli hizmette | Orta | Hizmet/satış |
| F10 İade–servis–garanti | Yeni modül | Yüksek; ürün desteğinde | Büyük | Teknik servis, ticaret |
| F11 Demirbaş ve bakım | Yeni modül; eski planda da var | Yüksek; varlık yoğun işletmede | Büyük | Üretim, operasyon |
| F12 Şube ve masraf merkezi | Yapısal genişleme | Yüksek; çok lokasyonda | Büyük | Çok şubeli işletme |

## 5. F01 — Kâr kalitesi ve maliyet tamamlama

**Mevcut:** Satış kârlılığı kaynak maliyetlerden hesaplanıyor; eksik maliyet uyarısı var. Stok maliyetini yeniden hesaplama ve ek gider dağıtımı da bulunuyor. Kullanıcının son raporunda 17 satırın maliyeti eksikti.

**Eklenecek:** Uyarıdan tek tıkla ürün/fatura/hareket listesine geçiş; eksikliğin nedenini ayırma: eksik alış/açılış, negatif stok, yanlış birim, eksik varyant/parti, dağıtılmamış gider. Düzeltme Merkezi'ne tekil iş, sorumlu ve çözüm bağlantısı. Raporda maliyet kapsamı ve tamamlanmamış satırlar görünür kalır.

**İlişki:** Alış/açılış → stok maliyeti → satış satırı → kârlılık → düzeltme kaydı → kontrollü yeniden hesaplama.

**İlk sürüm:** Eksik maliyet listesi, neden sınıfı, mevcut düzeltme ekranına bağlantı ve uygulama öncesi etki önizlemesi. Yeni bir maliyet motoru yazılmaz.

**Kabul:** Kaynak düzeltildiğinde uyarı gerçekten kapanır; kapanan dönem sessizce değişmez; maliyet bilinmiyorsa tahmini değer gerçek maliyet gibi doldurulmaz. Kayıtlı stok maliyeti ile raporun kullandığı dönem/maliyet yöntemi ayrıca karşılaştırılır.

**Ölçüm:** Eksik maliyetli satır sayısı ve bu satırlara ait ciro; eksikliği çözme süresi. Finansal rapordaki ciro kapsamı, tek başına maliyetin doğru olduğunu kanıtlamaz.

## 6. F02 — Tahsilat operasyon merkezi

**Mevcut:** Tahsilat öncelik listesi ve davranıştan hesaplanan beklenen ödeme tarihi var. POS ödeme linki, hatırlatma ve cari mutabakat da var. Tahmin edilen tarih, müşterinin verdiği ödeme sözüyle aynı kavram değildir.

**Eklenecek:** `OdemeSozu`, `TahsilatGorusmesi` ve gerekirse `TahsilatItirazi`; sorumlu, tutar/döviz, vade, ilgili faturalar ve takip tarihi. Sözün kısmen/tamamen yerine gelmesi gerçek tahsilat/kapama üzerinden izlenir. İtirazlı fatura için hatırlatma davranışı ayrı politika olur.

**İlişki:** Açık fatura → takip görevi → ödeme sözü/link → gerçek tahsilat → fatura kapama → sözün sonucu → güncel nakit planı.

**İlk sürüm:** Bugün aranacaklar, sözü geçenler, itirazlılar; mevcut SMS/e-posta/POS eylemleri; sonraki takip tarihi. Genel görev merkezi yerine önce tahsilatın ihtiyaç duyduğu dar görev modeli.

**Kabul:** Ödeme sözü nakit veya fatura kapaması oluşturmaz. Kısmi ödeme doğru dağıtılır; aynı ödeme nakit planına hem fatura hem söz olarak iki kez eklenmez. Kullanıcı iletişimi mevcut izin ve onay kurallarıyla yürür.

**Ölçüm:** Sözü tutma oranı, takip edilen alacakların tahsilata dönüşmesi, gecikmiş alacağın yaş dağılımı ve personelin manuel takip süresi. İyileşme hedefi pilot öncesi baz ölçümle belirlenir.

## 7. F03 — CRM fırsatından tahsilata satış dosyası

**Mevcut:** `CrmFirsat` cari, tahmini tutar, aşama, kapanış tarihi ve sorumlu taşıyor. İncelenen CRM servisindeki aşama değişimi yalnız fırsat kaydını güncelliyor. E-posta → CRM bağı mevcut; belge zinciri de mevcut.

**Eklenecek:** Fırsat–teklif/sürüm bağı; teklif kabul/red sonucu ve nedeni; fırsattan oluşturulan siparişler; gerçek fatura ve tahsilat görünümü. Başlangıçta mevcut kayıtları bağlama da desteklenir; yalnız yeni belge oluşturmaya mecbur bırakılmaz.

**İlişki:** Gelen ticari talep → fırsat → teklif/sürüm → sipariş → teslim/fatura → tahsilat.

**İlk sürüm:** Fırsatta “teklif hazırla/bağla”, ilgili belgeler ve takip tarihi. Teklif ve siparişin mevcut dönüştürme servisleri kullanılır.

**Kabul:** Teklif kabulü siparişin onaylandığı anlamına gelmez; tek sipariş birkaç fırsata yanlışlıkla tam tutarıyla yazılmaz. Kaybedilen fırsatın gerekçesi ve bekleyen teklifin son geçerlilik tarihi tutulur.

**Ölçüm:** Teklif kazanma oranı, fırsattan siparişe süre ve fırsata bağlanabilen gerçekleşen satış/tahsilat. “Kazanıldı” tutarı gerçekleşen ciro yerine kullanılmaz.

## 8. F04 — Tarihli stok ihtiyacı ve teslim uygunluğu

**Mevcut:** Satış rezervasyonları, alışta yoldaki stok, üretim malzeme rezervasyonu, emir bazında malzeme uygunluğu ve kapasite var. Eksik, bunların bütün açık talepleri aynı zaman ekseninde değerlendiren görünümde birleşmesidir.

**Eklenecek:** Sipariş/üretim talebinin hangi stok, açık alış veya planlı üretimle karşılanacağını gösterme; eksik miktarı ve en geç satın alma tarihini çıkarma; mevcut satın alma talebine onaylı aktarım. Satış temsilcisine gerekçeli teslim uygunluğu.

**İlişki:** Satış ihtiyacı + üretim bileşenleri + kullanılabilir stok + güvenilir giriş tarihleri → net ihtiyaç → satın alma talebi/üretim önerisi.

**İlk sürüm:** Tek depo veya ürün grubu, açık siparişler ve kullanıcı tarafından doğrulanmış tedarik süreleri. Mevsimsel AI talep tahmini ilk sürüm için gerekli değildir.

**Kabul:** Kullanılabilir stok rezervasyonu zaten düşüyorsa açık satış talebi yeniden düşülmez. Varyant/birim/parti kapsamı korunur; kalite blokeli stok uygun sayılmaz. Tarihi bilinmeyen giriş kesin teslim taahhüdü üretmez.

**Ölçüm:** Eksik malzeme yüzünden geciken sipariş, acil satın alma sayısı, verilmiş teslim sözünün gerçekleşmesi.

## 9. F05 — Tedarikçi fark yönetimi ve ödeme uygunluğu

**Mevcut:** Satın alma onayı, bütçeye bağlanan tutar, teklif karşılaştırması, sipariş ve üçlü eşleştirme var. Üçlü eşleştirme açıkça farkı uyarı/Düzeltme Merkezi kaydı olarak ele alıyor; fatura girişini engellemiyor. Ödeme talimatı ayrı bir süreç.

**Eklenecek:** Ödeme hazırlığında açık miktar/fiyat/teslim farklarının görünmesi. Şirket isterse belirli fark sınıflarında gerekçeli istisna/onay şartı. Tedarikçinin taahhüt ettiği teslim tarihi ile doğrulanmış gerçekleşen teslimin karşılaştırılması.

**İlişki:** Talep → teklif → sipariş → mal kabul/kalite → fatura farkı → uygun ödeme önerisi → banka gerçekleşmesi.

**İlk sürüm:** Ödeme adayında mevcut açık farklar ve kaynak bağlantıları; uyarı modu. Ödeme engelleme yeni iş kuralı olarak ayrıca kararlaştırılır.

**Kabul:** Bir farkı “görüldü” işaretlemek ticari kabul sayılmaz. Kısmi teslim/fatura/ödeme doğru ayrılır; tedarikçi puanı için vaat edilen tarih ve gerçek teslim kanıtı bulunur. İrsaliye oluşturulma zamanı otomatik olarak fiili teslim zamanı kabul edilmez.

**Ölçüm:** Fark kapanmadan ödenen fatura, fark çözme süresi ve tedarikçinin zamanında/tam teslim oranı. Sonraki genişleme: tedarikçi portalından teklif ve teslim teyidi.

## 10. F06 — Kanal katkısı ve pazaryeri hakediş mutabakatı

**Mevcut:** Pazaryeri sipariş alma/faturalama, stok-fiyat gönderme ve kesinti giderleştirme altyapıları var. Trendyol adaptöründe incelenen işlevler sipariş ve stok/fiyat; bu modülün tamamı sıfırdan yazılmamalı.

**Eklenecek:** Siparişin satış/iade/indirim/kesinti/hakedişinin ve bankaya yatan tutarın kaynak kimlikleriyle ilişkilendirilmesi. Kanal, ürün ve sipariş düzeyinde tanımı açık katkı görünümü. Komisyon/kargo/finansman gideri için bir kez dağıtım; muhasebe kârından ayrı metrik adı.

**Dış kaynak doğrulaması:** Trendyol resmi dokümanı `settlements`, `otherfinancials` ve `payment-order` kayıtlarının farklı işlem kümeleri olduğunu ve `paymentOrderId` ile eşleşebildiğini açıklıyor. Bu, yalnız sipariş toplamını banka girişiyle karşılaştırmanın yetersiz kalacağını destekler. [Trendyol cari hesap ekstresi entegrasyonu](https://developers.trendyol.com/docs/cari-hesap-ekstresi-entegrasyonu).

**İlk sürüm:** Tek kanal, tek döviz ve seçilmiş hakediş dönemi. Hangi kesintinin hangi siparişlere dağıtıldığı görünür; dağıtılamayan tutar ayrı kalır.

**Kabul:** Sipariş cirosu, hakediş ve banka tahsilatı üç ayrı olaydır; tekrar kayıt veya toplamda çift gelir yaratmaz. İadeler ve iptal edilen kesintiler kaynak işlemin tersidir. Bütün kanallar için aynı kesinti semantiği varsayılmaz.

**Ölçüm:** Eşleşmemiş hakediş tutarı, farkı çözme süresi, maliyeti/kesintisi tamamlanmış sipariş kapsamı.

## 11. F07 — Müşteri/bayi çalışma alanı

**Mevcut:** B2B kullanıcı–cari kimlik bağı, katalog/sipariş ve ekstre; ayrıca girişsiz bağlantıyla cari mutabakat yanıtı var.

**Eklenecek:** Müşterinin kendi sipariş/teslim/fatura/makbuzlarını, ödeme bağlantılarını ve mutabakat durumunu bir yerde görmesi; belge veya bakiye itirazını ilgili kayda bağlaması. Mevcut B2B ve mutabakat altyapısının genişlemesi olarak tasarlanmalı.

**İlk sürüm:** Sipariş durumları + fatura/PDF + ödeme durumu + mevcut ödeme linki + dar kapsamlı itiraz. Tek kullanımlık bağlantı ile kalıcı müşteri hesabının yetkileri ayrılır.

**Kabul:** Kimlik yalnız erişim bağlamından türetilir; bir müşterinin başka cari belgesini istemesi reddedilir. Maliyet/marj ve iç notlar müşteri görünümüne taşınmaz.

**Ölçüm:** Telefonla istenen belge/ekstre sayısı, portal kullanım oranı, itiraz çözme süresi.

## 12. Gerçek ek modül adayları

| Modül | İlk sürüm | Bağlanacağı mevcut alanlar | Kullanım koşulu ve temel ölçüm |
|---|---|---|---|
| F08 Proje zaman ve hakediş | Çalışma kaydı, yönetici onayı, proje/iş kırılımı, faturalandırılabilir süre | Personel, proje, masraf, fatura, tahsilat | Hizmet ekibinde; onaylı olup faturalanmamış iş ve proje katkısı |
| F09 Sözleşme/yenileme | Başlangıç/bitiş, yenileme, bildirim tarihi, belge eki, ücret/vade revizyonu, fatura bağlantısı | CRM, tekrarlayan fatura, kira/masraf, nakit, bildirim | Düzenli hizmette; unutulan yenileme ve sözleşmesiz fatura. Tekrarlayan fatura ve SaaS'ın kendi aboneliğiyle karıştırılmaz |
| F10 Satış sonrası iade/servis/garanti | Talep, seri/lot, inceleme, parça/işçilik, müşteri onayı, değişim/iade kararı | Satış faturası, stok, kalite, sevkiyat, masraf | Destek verilen ürünlerde; çözüm süresi, tekrar arıza, servis maliyeti. Mali iade faturası tek başına servis süreci değildir |
| F11 Demirbaş/bakım | Varlık kartı, konum/zimmet, bakım planı, iş emri, yedek parça ve gider | Satın alma, masraf, personel, stok, üretim kapasitesi | Varlık yoğun işletmede; geciken bakım ve plansız duruş. Amortisman kuralları ayrı kapsam ve uzman kabulü ister |
| F12 Şube/masraf merkezi | Şube/merkez sözlüğü, belge satırı dağıtımı, erişim, rapor kırılımı | Fatura, masraf, banka, proje, bütçe | Çok lokasyonda; dağıtılmamış gider ve merkez bazlı rapor kapsamı. Depo ve personel işyeri doğrudan şirket şubesi sayılmaz |

Üretim ve ticaret yoğun müşteride ikinci aşama adayları: mobil depo toplama/paketleme ve teslim kanıtı; tedarikçi teklif/teslim teyit portalı. Mevcut barkod, sayım, depo transferi ve araç/şoför kartları bu alanlara temel sağlar. Rota optimizasyonu için adres, süre ve teslim gerçekleşmesi verileri oluşmadan ileri optimizasyon yatırımı öncelikli değildir.

## 13. İşletme türüne göre seçim

| İşletme | İlk üç yatırım | Sonraki ayırt edici paket |
|---|---|---|
| Ticaret/toptan | Kâr kalitesi → tahsilat takibi → CRM–teklif ilişkisi | Teslim uygunluğu + müşteri/bayi çalışma alanı |
| Üretim | Kâr/maliyet kalitesi → tarihli malzeme ihtiyacı → tedarikçi teslim/fark yönetimi | Bakım + servis/lot izlenebilirliği |
| Hizmet/proje | Tahsilat takibi → proje zamanı/hakediş → sözleşme/yenileme | Proje işçilik maliyeti ve kaynak planı |
| Pazaryeri ağırlıklı ticaret | Kanal maliyeti/hakediş → stok kullanılabilirliği → iade süreci | Kanal bazında katkı ve müşteriye teslim görünümü |

Genel çekirdeğin ilk paketi için **F01 + F02 + F03** öneriyorum. Üretim pilotunda F03 yerine F04 öne alınır. Her aday aynı anda açılmaz.

## 14. İlişkilerin güvenilir çalışması için gereken ortak parçalar

1. **Kaynak bağı ve dağıtım:** Fatura/ödeme/masraf çoğu zaman çoktan çoğa ilişkilidir. Satır ve tutar dağıtımı tutulmalı; her raporda üst belge toplamını tekrar toplamak çift sayım yaratır. Mevcut kapama/dağıtım kayıtları esas alınır.
2. **Olay teslimi:** Ödeme tamamlandı, mal kabul edildi veya maliyet düzeltildi olaylarının kaçmaması için veritabanı işlemiyle birlikte olay kaydı, tekrar işleme ve dış işlem kimliği tekilliği tasarlanmalı. İncelenen şemada ortak bir outbox modeli görülmedi. Bu, mevcut worker'ı değiştirme projesi değil; seçilen yeni bağlantıların güvenilir teslim gereksinimidir.
3. **Ortak veri tamamlılığı:** Vade, birim, tedarik süresi, stok eşlemesi, maliyet ve kaynak belge eksikleri iş listesinde çözülebilmeli. Eksikliği AI ile görünmez biçimde doldurmak uygun değildir.
4. **Gerekçeli politika/onay:** Risk istisnası, ödeme farkı ve iskonto onayı mevcut alan servislerine bağlanır. İlk aşamada tüm ERP'yi yeniden yazan genel bir iş akışı motoru kurulmaz.
5. **Tutarlı boyutlar:** Kanal, proje, alt kırılım ve ileride masraf merkezi belge üzerinden taşınır. İptal/iade/geri alma kaynak ilişkisinin tersini de doğru taşımalıdır.
6. **Rol ve maliyet görünürlüğü:** Bir iş dosyasının tüm bağlantılarını görmek, bütün maliyet/bordro alanlarını görmek anlamına gelmez. Alan ve işlem yetkileri korunur.
7. **AI'nin rolü:** Kayıt bulma, belge çıkarımı, kaynak seçimi ve eylem önizlemesi. Net ihtiyaç, maliyet, bakiye ve ödeme kapaması uygulama hesaplarıdır; yeni mali kayıt/gönderim açık onaydan geçer. Son gelir-gider düzeltmesindeki yapılandırılmış seçim yaklaşımı bu ilkenin örneğidir.

## 15. Önerilen uygulama sırası ve karar kapıları

**Aşama A — Mevcut veriden hızlı değer:** F01 eksik maliyet listesi; F02 dar tahsilat takibi; F03 fırsat–teklif bağı. Önce mevcut kayıtlarla ilişkilendirme ve kaynaklara geçiş; sonra olaylarla otomatik güncelleme.

**Aşama B — Operasyon ve tedarik:** F04 tarihli ihtiyaç görünümü; F05 ödeme uygunluğu uyarısı; pilot sektöre göre F06 kanal hakedişi veya F07 müşteri çalışma alanı.

**Aşama C — Sektörel ürün paketi:** Hizmette F08/F09; satış sonrası destekte F10; üretimde F11. F12 ancak çok lokasyonlu gerçek bir müşteri ihtiyacıyla ve yaygın veri modeli etkisi planlanarak ele alınır.

Her paket öncesinde seçilecek pilot kullanıcı, gerçek iş örnekleri, mevcut kullanımın baz ölçümü, gerekli veri alanları ve kabul senaryoları belirlenir. Takvim ve gelir/geri dönüş tahmini, bu bilgiler ve ekip kapasitesi olmadan sayısallaştırılmaz. Mevcut ürünün S-01 ister onayı yeni geliştirme başlangıcında uygulanır; bu rapor geliştirme veya yayın onayı değildir.

**İlk küçük teslimat önerisi:** Mevcut kâr uyarısından eksik maliyetli satır listesine geçiş ve ilgili stok maliyet önizlemesine bağlantı. Bunun yanında tek bir tahsilat takip kaydı ve fırsata mevcut teklif bağlama. Böylece üç ayrı modül kullanıcısının günlük işiyle değer doğrulanabilir.

## 16. Ölçüm ve ticari paketleme

Başarıyı yeni ekran sayısıyla değil; eksik kayıt çözme süresi, tahsilat sonucu, teklif dönüşümü, teslim gerçekleşmesi ve mutabakat farkının kapanmasıyla ölçmek gerekir. İlk pilotta hedef yüzdeler uydurulmaz; mevcut durum ölçülüp iyileşme karşılaştırılır.

Ürün paketleri için hipotez:

- **Finans ve Tahsilat:** F01/F02/F05; yönetici ve muhasebenin günlük işine yakın.
- **Ticaret ve Bayi:** F03/F04/F07; siparişten teslim ve tahsilata.
- **Üretim ve Operasyon:** F04/F05/F11; malzeme, tedarik ve bakım.
- **Hizmet ve Proje:** F02/F08/F09; harcanan işten faturaya ve tahsilata.

Bunlar fiyatlandırma veya müşteri ödeme isteği kanıtı değildir. Önce ilgili müşteri grubuyla kullanım/pilot doğrulaması yapılmalı. Yatay altyapı ve güvenilir temel işlevler paket sınırı nedeniyle kullanılamaz hâle getirilmemelidir.

## 17. Temel kod kanıtları

| Bulgu | İncelenen kaynak |
|---|---|
| Güncel modül/veri kapsamı | [Prisma şeması](../apps/api/prisma/schema.prisma), [menü](../apps/web/src/lib/menu.ts), [AppModule](../apps/api/src/app.module.ts) |
| Belge zinciri/rezervasyon | [belgeler.service.ts](../apps/api/src/belgeler/belgeler.service.ts) |
| CRM'nin güncel sınırı | [CRM servisi](../apps/api/src/crm/crm-firsat.service.ts), şemadaki `CrmFirsat` |
| Tahsilat/risk/limit | [tahsilat-riski.ts](../apps/api/src/cari/tahsilat-riski.ts), [cari-islem-denetimi.ts](../apps/api/src/cari/cari-islem-denetimi.ts) |
| Ödeme linki ve kapama | [POS servisi](../apps/api/src/pos/pos.service.ts), [POS controller](../apps/api/src/pos/pos.controller.ts) |
| Banka entegrasyonu zaten var | [banka-entegrasyon.service.ts](../apps/api/src/kasa-banka/banka-entegrasyon.service.ts) |
| Satın alma/bütçe/üçlü eşleştirme | [satın alma servisi](../apps/api/src/satin-alma/satin-alma.service.ts), [üçlü eşleştirme](../apps/api/src/satin-alma/uclu-eslestirme.ts) |
| Düzeltme türleri/atama | [Düzeltme Merkezi servisi](../apps/api/src/duzeltmeler/duzeltmeler.service.ts) |
| Maliyet motoru ve gider dağıtımı | [stok-maliyet.service.ts](../apps/api/src/stok/stok-maliyet.service.ts), [maliyet-dagitimi.service.ts](../apps/api/src/stok/maliyet-dagitimi.service.ts) |
| Mevcut fiyat önerisi | [fiyat-onerisi.ts](../apps/api/src/stok/fiyat-onerisi.ts) |
| B2B kimlik/fiyat/sipariş | [B2B servisi](../apps/api/src/b2b/b2b.service.ts) |
| Proje ilişkileri | [proje servisi](../apps/api/src/projeler/projeler.service.ts), şemadaki `Proje` |
| Üretim/malzeme/kapasite | [üretim controller](../apps/api/src/uretim/uretim.controller.ts), [üretim servisi](../apps/api/src/uretim/uretim.service.ts) |
| Pazaryeri mevcut kapsamı | [pazaryeri controller](../apps/api/src/pazaryeri/pazaryeri.controller.ts), [Trendyol adaptörü](../apps/api/src/pazaryeri/trendyol.adapter.ts) |
| Sevkiyat mevcut kart kapsamı | [sevkiyat controller](../apps/api/src/sevkiyat/sevkiyat.controller.ts) |
| SaaS aboneliği ile müşteri sözleşmesinin ayrımı | [abonelik servisi](../apps/api/src/tenant/abonelik.service.ts), şemadaki `TekrarlayanFatura` ve `KiraSozlesme` |
| Önceki planla çakışmayı önleme | [ürün planı](URUN-URETIM-PLANI.md), [modüller arası AI planı](AI-MODULLER-ARASI-URETIM-PLANI-2026-10-14.md) |

Dış servis araştırması, rapordaki ilgili entegrasyonun teknik imkânını sınamak içindir; bu oturumda sağlayıcı hesabına bağlanılmadı ve harici iş işlemi yapılmadı. Güncel teknik şartlar, seçilen sağlayıcı/hesap için geliştirme başında yeniden doğrulanır.
