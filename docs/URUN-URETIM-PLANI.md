# TekirExtra — Ayrıntılı Ürün ve Üretim Planı

**Sürüm:** 1.0
**Tarih:** 2026-08-28
**Durum:** Ürün sahibi onayı bekleyen uygulama planı
**Dayanak:** `docs/ISTERLER.md`, `docs/MIMARI.md`,
`docs/URETIM-HAZIRLIK-KONTROL-LISTESI.md`

## 1. Amaç

Bu plan TekirExtra'nın kontrollü pilottan güvenilir SaaS ürününe geçişini ve
sonrasında aşağıdaki ürün paketlerinin geliştirilmesini tanımlar:

1. Üretim güvenilirliği ve kalıcı worker altyapısı
2. Merkezi mutabakat ve düzeltme merkezi
3. Dönem kapatma
4. Bildirim ve görev merkezi
5. Bütçe ve nakit akış planlama
6. Satın alma talep ve onay yönetimi
7. Demirbaş ve amortisman
8. Çoklu şube ve masraf merkezi
9. Yatay kullanıcı deneyimi ve teknik bakım çalışmaları

Plan; veri modeli, API, arayüz, güvenlik, test, gözlemlenebilirlik, veri geçişi
ve sürüm kapılarını birlikte ele alır. Her yeni modül, `ISTERLER.md` içindeki
S-01 kuralı gereği ürün sahibiyle ister onayı alınmadan geliştirmeye başlamaz.

## 2. Planlama varsayımları

### 2.1 Ekip ve süre

Baz kapasite:

- 2 tam zamanlı full-stack geliştirici
- Yarı zamanlı ürün sahibi / alan uzmanı
- Yarı zamanlı QA ve operasyon desteği
- İki haftalık sprintler

Bu kapasiteyle önerilen program 12 sprint, yaklaşık 24 haftadır. Tek geliştirici
ile 40–48 hafta beklenmelidir. Entegratör veya banka sandbox erişimi gibi dış
bağımlılıklar bu tahmine dahil değildir.

### 2.2 Öncelik ilkeleri

1. Veri kaybı ve mali tutarsızlık riski yeni özelliklerden önce gelir.
2. Kesin mali kayıt fiziksel olarak silinmez; ters kayıt veya iptal uygulanır.
3. Her mutasyon tenant, rol, durum ve idempotensi kontrollerinden geçer.
4. Büyük veri migrasyonları geriye uyumlu ve iki aşamalı yayımlanır.
5. Yeni modüller önce pilot firmada özellik bayrağıyla açılır.
6. Bir sürümün ölçüm ve hata bütçesi görülmeden sonraki büyük paket açılmaz.

## 3. Genel yol haritası

| Sürüm | Sprint | Paket | Çıkış ölçütü |
|---|---:|---|---|
| R0 | 1–2 | Üretim güvenilirliği | Kalıcı kuyruk, geri yükleme provası, kritik E2E |
| R1 | 3–4 | Mutabakat ve düzeltme merkezi | Finansal istisnalar tek kuyrukta yönetilebilir |
| R2 | 5 | Dönem kapatma | Dönem kilidi ve yeniden açma denetimli çalışır |
| R3 | 6 | Bildirim ve görev merkezi | Kritik olaylar uygulama içi ve e-posta ile izlenir |
| R4 | 7–8 | Bütçe ve nakit akışı | 7/30/90 günlük tahmin ve bütçe karşılaştırması |
| R5 | 9–10 | Satın alma talep/onay | Talep–onay–sipariş–kabul zinciri tamamlanır |
| R6 | 11 | Demirbaş ve amortisman | Varlık, zimmet ve amortisman planı çalışır |
| R7 | 12+ | Şube ve masraf merkezi | Pilot tenant için şube bazlı operasyon ve rapor |

Yatay UX, performans ve kod sadeleştirme işleri her sprint kapasitesinin
%20'sini kullanır. R7, veri modeline etkisi nedeniyle ayrı bir yeniden
değerlendirme kapısına sahiptir ve gerekirse 3–4 sprinte genişletilir.

## 4. Ortak teslim standardı

Bir epic ancak aşağıdaki koşulların tümü sağlanınca tamamlanmış sayılır:

- İster ve kabul senaryoları ürün sahibi tarafından onaylandı.
- Prisma migrasyonu ileri ve geri uyumluluk açısından incelendi.
- API girdi şemaları ve sunucu tarafı iş kuralları eklendi.
- Rol/yetki matrisi hem API hem arayüzde uygulandı.
- Denetim izi, yapılandırılmış log ve gerekli metrikler eklendi.
- Birim, servis, tenant izolasyonu ve kritik E2E testleri geçti.
- Boş, yükleniyor, hata, yetkisiz ve başarılı UI durumları tamamlandı.
- Mobil/tablet görünüm ve klavye kullanımı kontrol edildi.
- Operasyon/runbook ve kullanıcı yardım metni güncellendi.
- Pilot geçişi, geri alma yöntemi ve başarı metriği tanımlandı.

## 5. R0 — Üretim güvenilirliği

**Süre:** 2 sprint
**Amaç:** Yeni ürün geliştirmeden önce iş kaybı ve mali veri riski taşıyan
operasyonel açıkları kapatmak.

### 5.1 Kalıcı e-belge kuyruğu

Backend:

- `ebelge-gonder`, `ebelge-durum-sorgula`, `gelen-belge-cek` ve
  `earsiv-raporla` BullMQ kuyruklarını tanımla.
- Her işte `tenantId`, varlık kimliği, correlation ID, deneme sayısı ve
  idempotency anahtarı taşı.
- Worker içinde tenant RLS bağlamını kur.
- Exponential backoff, jitter, maksimum deneme ve dead-letter politikası ekle.
- Aynı fatura için eşzamanlı gönderimi veritabanı tekilliğiyle engelle.
- API kapanırken yeni iş kabulünü durdurup kontrollü kapanış uygula.

Arayüz:

- Kuyrukta, deneniyor, zamanlandı, başarısız ve dead-letter durumlarını göster.
- Yetkili kullanıcıya güvenli “yeniden dene” eylemi sun.
- Hata nedeni ile önerilen düzeltme adımını birlikte göster.

Gözlemlenebilirlik:

- Kuyruk derinliği, en eski iş yaşı, başarı/hata oranı ve retry sayısı metriği.
- Dead-letter oluştuğunda alarm.
- Sağlayıcı ve işlem türü bazında gecikme paneli.

Kabul ölçütleri:

- API/worker yeniden başlatıldığında işler kaybolmaz.
- Aynı gönderim işi en az iki kez teslim edilse bile tek e-belge oluşur.
- Geçici sağlayıcı hatası otomatik denenir; kalıcı hata dead-letter'a gider.
- İki tenantın işleri ve log bağlamı birbirine karışmaz.

### 5.2 Yedekleme ve geri yükleme

- PostgreSQL ve MinIO yedeklerini zamanlanmış, şifreli ve uzak hedefli çalıştır.
- Yedek bütünlüğünü otomatik doğrula.
- Aylık izole geri yükleme provası yap.
- RPO hedefini 24 saatten 1 saate, RTO hedefini 4 saate çekmek için WAL/PITR
  seçeneğini değerlendir.
- Geri yükleme kanıtını tarih, süre, veri sayısı ve checksum ile sakla.

Kabul ölçütleri:

- Son üretim benzeri yedek boş ortama başarıyla yüklenir.
- Tenant, belge eki ve finans toplamları örneklemle doğrulanır.
- Runbook başka bir ekip üyesi tarafından uygulanabilir.

### 5.3 Kritik regresyon ve yük testleri

E2E senaryoları:

- Satış faturası → e-belge → tahsilat → kapanan bakiye
- Alış faturası → stok girişi → banka/kart ödemesi
- Masraf → onay → kısmi ödeme → kart taksiti → tam ödeme
- Çek/senet tahsil veya ödeme → doğru hesap yönü
- POS tahsilatı → banka mutabakatı → geri alma
- İptal/iade → stok, cari ve finans ters hareketleri
- İki tenantlı negatif erişim

Yük profili:

- 100.000 fatura, 500.000 stok hareketi, 100.000 cari hareket.
- Liste p95 < 2 saniye; ağır rapor p95 < 5 saniye.
- 50 eşzamanlı kullanıcıda hata oranı <%1.

### 5.4 R0 sürüm kapısı

- Readiness tüm zorunlu bağımlılıkları kontrol ediyor.
- Kritik E2E testleri CI'da yeşil.
- Bir yedek geri yükleme provası tamamlandı.
- Kuyruk yeniden başlatma ve idempotensi kaos testi geçti.
- Pilot ortamda en az 7 gün kritik alarm oluşmadı.

## 6. R1 — Merkezi mutabakat ve düzeltme merkezi

**Süre:** 2 sprint
**Amaç:** Modüller arasındaki eksik, hatalı ve eşleşmemiş kayıtları tek çalışma
kuyruğunda görünür ve çözülebilir yapmak.

### 6.1 Alan modeli

Yeni temel kavramlar:

- `DuzeltmeKaydi`: tenant, tür, önem, durum, kaynak türü/ref, neden kodu,
  açıklama, önerilen eylem, atanan kullanıcı, son tarih, çözen kullanıcı/zaman.
- `DuzeltmeOlayi`: durum değişiklikleri ve kullanıcı notları.
- Durumlar: `acik`, `incelemede`, `beklemede`, `cozuldu`, `yoksayildi`.
- Önem: `bilgi`, `uyari`, `kritik`.

İlk dedektörler:

- Eşleşmemiş banka ekstre satırı
- Belgesiz kredi kartı harcaması
- Ödeme bağlantısı olmayan onaylı masraf
- POS brüt/net/komisyon farkı
- Hatalı veya uzun süredir bekleyen e-belge
- Negatif stok ve onaysız sayım farkı
- Vadesi geçmiş ancak durumu güncellenmemiş çek/senet
- Fatura ile cari ödeme toplamı uyuşmazlığı

### 6.2 İşleme mimarisi

- Dedektörler salt-okunur ve tekrar çalıştırılabilir olmalı.
- Aynı neden+kaynak için tek açık kayıt bulunmalı.
- Sorun kaynaktan düzeltildiğinde kayıt otomatik çözülebilmeli.
- Manuel çözüm eylemleri mevcut domain servislerini çağırmalı; doğrudan tablo
  güncellememeli.
- Her çözüm denetim izine ve düzeltme olay geçmişine yazılmalı.

### 6.3 API ve arayüz

API:

- Sayfalı liste; tür, önem, durum, tarih, kullanıcı ve kaynak filtreleri.
- Detay, ata, not ekle, beklemeye al, yeniden tara, çöz ve yoksay uçları.
- Dashboard özetleri ve yaşlandırma dağılımı.

UI:

- `/panel/islemler` ana çalışma kuyruğu.
- KPI: kritik açık, bugün oluşan, SLA aşan, kullanıcıya atanan.
- Satır içinden kaynak kayda gitme ve önerilen eylemi başlatma.
- Toplu atama/yoksayma yalnız güvenli türlerde.
- “Neden oluştu?” ve “Nasıl çözülür?” açıklamaları.

### 6.4 Kabul ölçütleri

- Aynı sorun tekrar taramada çoğalmaz.
- Kaynak işlem düzeldiğinde ilgili istisna kapanır.
- Kullanıcı yalnız rolünün görebildiği kaynaklara ait kayıtları görür.
- Kritik kayıt 15 dakika içinde bildirim üretir.
- Çözüm geçmişinden kim, neyi, ne zaman yaptığı izlenebilir.

## 7. R2 — Dönem kapatma

**Süre:** 1 sprint
**Amaç:** Aylık mali dönemlerin kontrol listesiyle kapatılması ve kapalı döneme
izinsiz geçmiş tarihli hareket yazılmasının engellenmesi.

### 7.1 Alan modeli

- `MaliDonem`: yıl, ay, durum, kapatan/açan kullanıcı, tarih ve gerekçe.
- `DonemKontrolu`: kontrol kodu, sonuç, bulgu sayısı, son çalışma zamanı.
- Durumlar: `acik`, `kontrol_ediliyor`, `kapali`, `yeniden_acildi`.

Zorunlu kontroller:

- Açık banka ve kart mutabakatı
- Onaysız masraf ve sayım
- Hatalı/bekleyen e-belge
- Kasa sayımı
- Vadesi geçmiş çek/senet
- Eksik kur veya vergi bilgisi
- Negatif stok

### 7.2 Merkezi dönem kilidi

- Tarihli tüm finansal mutasyonlar ortak `DonemKilidiService` kontrolünden geçer.
- Kapalı döneme işlem, güncelleme, silme veya geri alma engellenir.
- Yeniden açma yalnız yönetici + zorunlu gerekçe + tercihen TOTP ile yapılır.
- Yeniden açma ve tekrar kapatma denetim izine yazılır.
- Entegrasyondan geç gelen belgeler açık sonraki döneme düzeltme kaydı olarak
  alınır; sessizce kapalı döneme yazılmaz.

### 7.3 UI ve kabul ölçütleri

- `/panel/donem-kapatma` kontrol listesi ve dönem takvimi.
- Başarısız kontrolden ilgili düzeltme kuyruğuna geçiş.
- Kritik kontrol açıkken kapatma yapılamaz.
- Kapalı dönemde tüm ilgili API uçları aynı standart hata kodunu döndürür.
- Yetkili yeniden açma sonrası işlem yapılabilir ve geçmiş eksiksiz görünür.

## 8. R3 — Bildirim ve görev merkezi

**Süre:** 1 sprint
**Amaç:** Kritik olayların kaybolmasını önlemek ve kullanıcıya yapılacak işi
tek yerde sunmak.

### 8.1 Alan modeli ve kanallar

- `Bildirim`: tür, önem, başlık, mesaj, hedef URL, okundu/arsivlendi zamanı.
- `BildirimTercihi`: kullanıcı + olay türü + uygulama/e-posta/SMS kanalı.
- `Gorev`: başlık, kaynak, atanan, son tarih, durum, öncelik.
- Uygulama içi kanal zorunlu; e-posta ilk sürüm; SMS yalnız kritik ve izinli
  olaylarda.

Olay kaynakları:

- Vade, kritik stok, kart son ödeme tarihi
- Onay bekleyen masraf/izin/ödeme talimatı
- Düzeltme merkezi kritik kaydı
- Entegrasyon veya worker hatası
- Sözleşme, belge veya personel tarihi

### 8.2 Teknik tasarım

- Domain servisleri doğrudan e-posta göndermek yerine olay yayınlar.
- Olay tüketimi idempotent worker işi olur.
- Kullanıcı tercihi ve sessiz saatler uygulanır.
- Aynı olay için bildirim birleştirme ve tekrar baskılama yapılır.

### 8.3 Kabul ölçütleri

- Kritik olay uygulama içi bildirimde 1 dakika içinde görünür.
- Tek olay tekrar işlense bile kullanıcıya ikinci bildirim gitmez.
- Okundu/arsivlendi durumu kullanıcı bazındadır.
- Yetkisiz kullanıcı hedef kaydın içeriğini bildirimde göremez.

## 9. R4 — Bütçe ve nakit akış planlama

**Süre:** 2 sprint
**Amaç:** İşletmenin beklenen nakit açığını önceden görmesi ve bütçeyi
gerçekleşenlerle karşılaştırması.

### 9.1 S-01 karar kapısı

Geliştirme öncesinde şu kararlar kesinleştirilir:

- Bütçe seviyesi: firma, proje, departman/masraf merkezi
- Aylık mı haftalık mı planlanacağı
- Devreden bütçe politikası
- Kur tahmin yöntemi
- Nakit tahmininde güven katsayıları
- Taslak faturaların tahmine dahil edilme kuralı

### 9.2 Alan modeli

- `Butce`: dönem, sürüm, durum, para birimi, açıklama.
- `ButceKalemi`: kategori, proje, masraf merkezi, aylık hedef tutar.
- `NakitTahminSenaryosu`: iyimser, normal, kötümser katsayıları.
- `NakitTahminKalemi`: kaynak tür/ref, tarih, giriş/çıkış, olasılık, tutar.

Kaynaklar:

- Açık satış/alış faturaları
- Çek/senet vadeleri
- Kredi kartı taksitleri ve ekstre ödeme tarihleri
- Tekrarlayan faturalar ve kira dönemleri
- Onaylı satın alma siparişleri
- Bordro/personel yükümlülükleri
- Manuel plan kalemleri

### 9.3 Hesaplama ve UI

- Tahmin üretimi saf, yeniden çalıştırılabilir hesaplama servisi olmalı.
- Gerçekleşen hareketler aynı kalemi tekrar saymamalı.
- 7/30/90 günlük nakit pozisyonu ve en düşük bakiye tarihi gösterilmeli.
- Bütçe–gerçekleşen farkı tutar ve yüzde olarak sunulmalı.
- Kaynağa kadar açıklanabilir drill-down bulunmalı.
- CSV/Excel içe aktarım ve Excel/PDF dışa aktarım eklenmeli.

### 9.4 Kabul ölçütleri

- Aynı açık belge farklı kaynaklardan iki kez sayılmaz.
- Senaryo katsayısı değişince tahmin izlenebilir şekilde değişir.
- Kart taksitleri kendi vadelerinde nakit çıkışı üretir.
- Gerçekleşen ödeme tahminden düşer ve gerçekleşene taşınır.
- Toplamlardan kaynak kayda kadar iz sürülebilir.

## 10. R5 — Satın alma talep ve onay

**Süre:** 2 sprint
**Amaç:** Plansız harcamaları azaltmak ve satın alma sürecini belge zinciriyle
kontrollü hale getirmek.

### 10.1 S-01 karar kapısı

- Onay matrisi rol, kullanıcı, tutar, kategori ve departmana göre mi çalışacak?
- Aynı seviyede tek mi çoklu mu onay gerekecek?
- Teklif toplama zorunluluk eşiği nedir?
- Bütçe aşımı engel mi uyarı mı olacak?
- Kısmi teslimat ve fazla teslimat toleransı nedir?

### 10.2 Süreç

```text
Taslak talep → Onay → Teklif karşılaştırma → Satın alma siparişi
→ Kısmi/tam mal kabul → Alış faturası eşleştirme → Ödeme
```

Alan modeli:

- `SatinAlmaTalebi` ve kalemleri
- `OnayAkisi`, `OnayAdimi`, `OnayKarari`
- `TedarikciTeklifi` ve kalemleri
- `MalKabul` ve kalemleri
- Sipariş, kabul ve fatura bağlantıları

### 10.3 İş kuralları

- Talebi oluşturan, politika gerektiriyorsa kendi talebini onaylayamaz.
- Onaylı talep olmadan sipariş üretilemez.
- Stoklu kalemde mal kabul depo hareketi üretir; hizmette üretmez.
- Sipariş–kabul–fatura miktar/tutar farkları toleransla kontrol edilir.
- Bütçe aşımı açıklama ve ek onaya yönlendirilir.
- Kesin kayıt değişmez; revizyon yeni sürüm oluşturur.

### 10.4 Kabul ölçütleri

- Tutar eşiğine göre doğru onay zinciri oluşur.
- Kısmi teslimatlar kalan sipariş miktarını doğru günceller.
- Aynı mal kabul iki kez stoğa işlenmez.
- Üçlü eşleştirme farkı varsa fatura onaya/düzeltmeye düşer.
- Sürecin tüm adımları denetim izinde ve belge zincirinde görünür.

## 11. R6 — Demirbaş ve amortisman

**Süre:** 1 sprint
**Amaç:** Gider niteliğindeki demirbaşların fiziksel varlık ve zimmet olarak
izlenmesini sağlamak.

### 11.1 S-01 karar kapısı

- Vergisel amortisman mı, yalnız yönetimsel amortisman mı?
- Yöntemler: normal, azalan bakiyeler, kıst amortisman
- Faydalı ömür ve oran kaynağı
- Muhasebe fişi üretilecek mi, yalnız rapor mu?

### 11.2 Alan modeli ve işlevler

- `Demirbas`: kod, ad, kategori, seri no, alış tarihi/tutarı, konum, durum.
- `DemirbasAmortismanPlani` ve dönem satırları.
- `DemirbasZimmet`: personel, teslim/iade tarihi, tutanak.
- `DemirbasBakim`: garanti, bakım tarihi, maliyet ve belge.
- Kaynak alış faturası veya masraf bağlantısı.
- Durumlar: aktif, zimmetli, bakımda, satıldı, hurda, kayıp.

Kabul ölçütleri:

- Alış belgesinden demirbaş oluşturulduğunda tutar tekrar gider yazılmaz.
- Zimmet geçmişi kesintisiz izlenir.
- Amortisman toplamı edinme maliyetini aşmaz.
- Satış/hurda işlemi kalan değer ve geçmişi korur.

## 12. R7 — Çoklu şube ve masraf merkezi

**Tahmini süre:** 2–4 sprint
**Amaç:** Firma operasyonlarını şube, departman ve maliyet merkezi kırılımında
yetkilendirmek ve raporlamak.

Bu paket en yüksek migrasyon riskine sahiptir. Ayrı teknik keşif ve prototip
sonrasında kesin tahmin verilir.

### 12.1 Karar kapıları

- Şube yasal birim mi operasyon birimi mi?
- Belge numara serileri şube bazında mı?
- Kullanıcı birden çok şubeye erişebilir mi?
- Kasa, banka, depo ve POS hesabı şubeye zorunlu mu bağlı?
- Merkez–şube transferinin finansal ve stok etkisi nedir?
- Masraf merkezi hiyerarşik mi, proje ile ilişkisi nasıl?

### 12.2 Teknik yaklaşım

- İlk aşamada `Sube`, `MasrafMerkezi`, kullanıcı erişim tabloları oluşturulur.
- Mevcut tenant kayıtları otomatik “Merkez” şubesine bağlanır.
- Yeni foreign key alanları önce nullable eklenir ve geriye dönük okunur.
- Backfill tamamlandıktan sonra zorunluluk kademeli uygulanır.
- RLS tenant seviyesinde kalır; şube yetkisi uygulama guard/query katmanında
  ikinci filtre olur.
- Tüm raporlar şube ve masraf merkezi filtresi alır.

### 12.3 Kabul ölçütleri

- Mevcut tenant migrasyon sonrası aynı verileri “Merkez” altında görür.
- Şube kısıtlı kullanıcı başka şubenin operasyonel kaydını göremez/değiştiremez.
- Firma geneli rapor yetkili kullanıcı için konsolide sonuç verir.
- Şubeler arası stok ve finans transferi dengeli çift hareket oluşturur.
- Belge serisi çakışması veritabanı düzeyinde engellenir.

## 13. Yatay kullanıcı deneyimi programı

Her sprintte kapasitenin %10'u aşağıdaki UX backlog'una ayrılır:

1. Global arama ve komut paleti
2. Kullanıcı bazlı kayıtlı filtre/sütun/görünüm tercihleri
3. Toplu işlem çubuğu ve güvenli geri bildirim
4. Klavye kısayolları ve fatura giriş hızlandırmaları
5. Onboarding kontrol listesi ve örnek veri seçeneği
6. Özelleştirilebilir dashboard kartları
7. Standart hata yapısı: neden, etkilenen kayıt, önerilen sonraki adım
8. Tablet/PWA hızlı masraf, depo ve üretim akışları
9. OCR ile masraf taslağı; kullanıcı onayı olmadan mali kayıt üretmeme
10. Sabit Türkçe metinleri i18n kataloglarına taşıma

UX kabul standardı:

- Temel iş klavye ile tamamlanabilir.
- Mobilde yatay taşma olmadan ana eylemlere erişilir.
- Form hatası alan seviyesinde ve sunucu mesajıyla tutarlı görünür.
- Kullanıcı uzun işlemde ilerleme ve tekrar deneme durumunu görür.

## 14. Teknik bakım ve mimari sadeleştirme

Her sprintte kapasitenin %10'u teknik bakım için ayrılır.

Öncelikli parçalama hedefleri:

- `apps/web/src/app/panel/cari/page.tsx`
- `apps/web/src/app/panel/fatura/page.tsx`
- `apps/web/src/app/panel/stok/[id]/page.tsx`
- `apps/api/src/uretim/uretim.service.ts`
- `apps/api/src/fatura/fatura.service.ts`
- `apps/api/src/stok/stok.service.ts`

Kurallar:

- Sayfa bileşenleri veri yükleme, form, liste ve modal bölümlerine ayrılır.
- Domain servisleri komut/sorgu veya alt alan servislerine bölünür.
- Ortak ödeme hesabı gösterim tipi kasa, banka, kart ve POS için paylaşılır;
  muhasebe davranışları yine kendi domain servislerinde kalır.
- API DTO ve enumlarının tekrar kullanılanları `packages/shared` içine taşınır.
- Para hesabında `number` yerine Decimal veya kuruş tabanlı saf fonksiyonlar
  kullanılır.
- Her kritik mutasyon `Idempotency-Key` standardına kademeli geçirilir.

Kod kalite hedefleri:

- Yeni servis dosyası tercihen 500 satırı aşmaz.
- Yeni sayfa iş mantığını doğrudan JSX içine gömmez.
- Değiştirilen kritik alanda branch coverage en az %80.
- `git diff --check`, typecheck, birim ve ilgili E2E testleri zorunlu.

## 15. Test stratejisi

### 15.1 Test piramidi

- Saf hesaplama: birim test
- Domain iş kuralı: servis testi + gerçek PostgreSQL kabul testi
- RLS/yetki: iki tenant ve çok rol negatif test
- Entegrasyon: kaydedilmiş yanıt + sandbox contract testi
- Kritik kullanıcı yolu: Playwright E2E
- Büyük veri: zamanlanmış performans testi

### 15.2 Zorunlu çapraz senaryolar

- Kısmi ödeme ve farklı ödeme araçlarının aynı belgeyi kapatması
- İşlem tekrarında mükerrer hareket oluşmaması
- Kapalı döneme entegrasyondan geç gelen kayıt
- Şube/proje/masraf merkezi toplamlarının firma geneline eşit olması
- Ters kayıt sonrası cari, stok ve finans bakiyelerinin başlangıçla eşitliği
- Worker çökmesi ve yeniden başlama
- Saat dilimi ve ay sonu/taksit tarihi davranışı

## 16. Güvenlik ve mevzuat kontrol listesi

- Yeni her tabloda tenant FK, RLS policy ve negatif erişim testi.
- Hassas alanlar at-rest şifreli; log ve API cevaplarında maskeli.
- Onay, dönem açma ve ödeme talimatında görev ayrılığı.
- Kritik yönetici işleminde TOTP yeniden doğrulama değerlendirmesi.
- KVKK veri envanteri, saklama süresi ve anonimleştirme akışı.
- Kesin mali kayıtta fiziksel delete bulunmaması.
- Dosya yüklemede tür, boyut, içerik ve zararlı dosya kontrolü.
- Dış callback'te imza, timestamp, nonce ve replay koruması.

## 17. Yayın ve veri geçiş stratejisi

Her büyük paket şu sırayla yayımlanır:

1. Geriye uyumlu veritabanı migrasyonu
2. Eski ve yeni şemayı okuyabilen backend
3. Arka plan backfill ve tutarlılık raporu
4. Özellik bayrağı kapalı frontend
5. İç tenant ve sentetik veri testi
6. Tek pilot tenantta açılış
7. 7 günlük gözlem ve hata bütçesi kontrolü
8. Kademeli %10 → %50 → %100 açılış
9. Eski alanların temizliği sonraki ayrı migrasyonda

Geri alma, veri silerek değil özellik bayrağını kapatıp eski okuma yoluna
dönerek yapılır. Yeni üretilmiş mali kayıtlar korunur.

## 18. Ölçüm ve başarı göstergeleri

### Operasyon

- API erişilebilirliği ≥ %99,5
- Kritik kuyruk işi başarı oranı ≥ %99,9
- Dead-letter işinin medyan çözüm süresi < 4 saat
- Başarılı günlük yedek oranı %100
- Aylık geri yükleme provası başarı oranı %100

### Ürün

- Eşleşmemiş finans kaydı sayısında ilk 60 günde %50 azalma
- Ay kapatma süresinde %40 azalma
- Kritik vade kaçırma sayısında %50 azalma
- Masraf/fatura giriş süresinde %25 azalma
- Nakit tahmini kullanılan aktif tenant oranı ≥ %40
- Satın alma talebinden siparişe medyan çevrim süresi görünür ve ölçülebilir

### Kalite

- Kritik finans regresyonu: sürüm başına 0
- P1 hata: 0; P2 hata için 24 saat içinde aksiyon planı
- Yeni kritik modüllerde kabul senaryosu geçiş oranı %100
- Liste p95 < 2 saniye, ağır rapor p95 < 5 saniye

## 19. Risk kaydı

| Risk | Etki | Azaltım |
|---|---|---|
| Mevcut geniş modül kapsamı regresyon üretir | Yüksek | Kritik E2E, %20 teknik bakım kapasitesi |
| Gerçek entegratör davranışı mock'tan farklıdır | Yüksek | Sandbox contract test, pilot, dead-letter |
| Şube migrasyonu eski kayıtları bozar | Yüksek | Nullable alan, backfill, çift okuma, kademeli geçiş |
| Raporlarda aynı hareket iki kez sayılır | Yüksek | Kaynak/ref tekilliği, açıklanabilir drill-down, invariant test |
| Ürün sahibi kararları gecikir | Orta | Her modül öncesi süre sınırlı S-01 karar atölyesi |
| Bildirim gürültüsü kullanıcıyı yorar | Orta | Birleştirme, sessiz saat, kullanıcı tercihleri |
| Plan kapsamı sürekli büyür | Yüksek | Sprint kapsam kilidi, değişiklik bütçesi, ayrı backlog |

## 20. İlk 30 gün için somut görev listesi

### Hafta 1

- R0 teknik tasarım ve S-01 dışı üretim kapısı onayı
- BullMQ kuyruk adları, payload ve idempotency sözleşmesi
- Kritik E2E veri hazırlama altyapısı
- Yedek geri yükleme provası için izole ortam

### Hafta 2

- E-belge gönderim worker'ı ve retry/backoff
- Durum sorgulama ve gelen belge worker'ı
- Kuyruk metrikleri ve alarmlar
- İlk worker yeniden başlatma testi

### Hafta 3

- Dead-letter ekranı ve güvenli yeniden deneme
- PostgreSQL/MinIO otomatik yedek ve doğrulama
- Kritik finans invariant testleri
- 100k/500k performans veri üreticisi

### Hafta 4

- İlk geri yükleme provası
- Pilot ortamda kalıcı worker açılışı
- Mutabakat merkezi S-01 ister atölyesi
- `DuzeltmeKaydi` veri modeli ve ilk üç dedektörün teknik tasarımı

## 21. Ürün sahibi karar listesi

Geliştirme başlamadan önce sırayla şu onaylar alınmalıdır:

1. R1 düzeltme türleri, önem ve SLA kuralları
2. R2 dönem kapatma kontrolleri ve yeniden açma yetkisi
3. R3 bildirim olayları, kanallar ve sessiz saatler
4. R4 bütçe seviyesi, tahmin kaynakları ve senaryo katsayıları
5. R5 satın alma onay matrisi ve toleranslar
6. R6 amortisman kapsamı ve yöntemleri
7. R7 şube tanımı, yetki ve belge serisi politikası

Her karar `docs/ISTERLER.md` içine numaralı ister ve kabul senaryosu olarak
işlenir. Onay sonrası ilgili sürüm için teknik tasarım, migrasyon planı ve
iş kartları kesinleştirilir.

## 22. Önerilen başlangıç kararı

İlk yatırım **R0 + R1 + R2 + R3** paketlerine ayrılmalıdır. Bu dört paket,
uygulamayı yalnız özellik açısından değil işletilebilirlik açısından da ürün
seviyesine taşır. Bütçe, satın alma, demirbaş ve şube modülleri bu temel üzerinde
daha az veri tutarsızlığı ve daha düşük operasyon maliyetiyle geliştirilebilir.
