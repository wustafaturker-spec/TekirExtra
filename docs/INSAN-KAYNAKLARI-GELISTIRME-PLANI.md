# İnsan Kaynakları Modülü Geliştirme Planı

## Amaç

İnsan Kaynakları modülü; personel özlük verilerini güvenli biçimde yöneten,
maaş tahakkuklarını denetlenebilir bir yaşam döngüsüyle izleyen ve kasa, banka
ve cari hesap modülleriyle tutarlı finansal kayıt üreten bir alt sistem olacaktır.

İlk sürüm **yasal bordro motoru değil**, operasyonel maaş tahakkuk ve ödeme
takibidir. SGK, gelir vergisi, damga vergisi, teşvik ve kümülatif matrah
hesapları mevzuat uzmanı doğrulaması gerektiren ayrı bir fazdır.

## Mimari ilkeler

1. Personel ile uygulama kullanıcısı ayrı varlıklardır.
2. Her tenant tablosu uygulama filtresine ek olarak PostgreSQL RLS ile korunur.
3. TCKN, IBAN ve ücret verileri hassas veridir; en az yetki ilkesi uygulanır.
4. Tahakkuk, onay ve ödeme ayrı işlemlerdir.
5. Onaylanmış finansal kayıt değiştirilmez; revizyon veya ters kayıt oluşturulur.
6. Para değerleri API'de hassasiyet kaybettirmeyen decimal metin olarak taşınır.
7. Her kritik durum geçişi audit log'a yazılır ve tekrar çalıştırmaya dayanıklıdır.

## Hedef modüller

- Personel özlük kartı ve istihdam geçmişi
- İşyeri, departman, pozisyon ve yönetici organizasyonu
- Maaş tahakkuku, bordro kalemleri, prim ve kesintiler
- Avans talep, onay, ödeme ve bordro mahsubu
- Bordro hazırlama, onaylama, ödeme ve iptal akışı
- İzin türleri, talepler ve bakiye hareketleri
- Özlük belgeleri ve süre sonu bildirimleri
- İK, bordro ve personel maliyeti raporları

## Fazlar

### Faz 1 — Güvenlik ve çalışabilirlik

- Web çağrılarını ortak kimlik doğrulamalı API istemcisine taşı.
- Web/API endpoint sözleşmesini tekleştir.
- Personel ve bordro uçlarına rol koruması ekle.
- Personel tablolarına `ENABLE/FORCE RLS` ve tenant politikaları ekle.
- TCKN, IBAN, tarih ve para doğrulamalarını güçlendir.
- Tahakkukta işe giriş/çıkış dönem uygunluğunu uygula.
- Kasa/banka hesabının tenant, aktiflik ve TRY uygunluğunu doğrula.
- Avansı finansal kaynak olmadan ödenmiş kaydetmeyi engelle.
- Kritik akışlar için birim ve entegrasyon testleri ekle.

Çıkış ölçütü: Yetkili kullanıcı personel oluşturup uygun dönem için tahakkuk
üretebilir; yetkisiz roller hassas verilere erişemez ve tenant sınırı veritabanı
seviyesinde korunur.

### Faz 2 — Personel özlük çekirdeği

- Serbest metin departman/unvan alanlarını referans tablolarına taşı.
- İşyeri ve istihdam dönemi modellerini ekle.
- `taslak`, `aktif`, `askida`, `uzun_sureli_izin`, `isten_ayrildi` durumlarını ekle.
- İşe giriş, işten çıkış ve yeniden başlatma komutlarını oluştur.
- Atomik tenant bazlı personel/cari numarası üret.
- Alan bazlı maskeleme ve hassas veri görüntüleme audit'i ekle.

### Faz 3 — Tahakkuk motoru

- Bordro başlığı ve kazanç/kesinti kalemlerini ayır.
- Kısmi ay, prim, kesinti ve avans mahsubunu hesapla.
- `taslak → hesaplandi → onay_bekliyor → onaylandi` yaşam döngüsünü uygula.
- Toplu tahakkuku idempotent ve büyük veri için arka plan işine uygun tasarla.
- Onaylanan bordrolar için sürümlü revizyon modeli kur.

### Faz 4 — Finans entegrasyonu

- Tahakkuk ve ödeme tarihlerini muhasebesel olarak ayır.
- Kısmi ve çoklu bordro ödemelerini destekle.
- Ödeme iptalinde ters finansal hareket üret.
- Hazırlayan, onaylayan ve ödeyen görevlerini ayır.
- Eşzamanlı ve yinelenen ödeme koruması ekle.

### Faz 5 — İzin ve avans yönetimi

- Yapılandırılabilir izin türleri ve hareket bazlı izin bakiyesi oluştur.
- Talep, yönetici onayı, ret ve iptal akışlarını uygula.
- Tatil, hafta sonu, yarım gün ve çakışma kontrollerini ekle.
- Avans talep, onay, ödeme, mahsup ve kalan bakiye takibini tamamla.

### Faz 6 — Belgeler, arayüz ve raporlama

- Özlük dosyasını mevcut ekler altyapısına bağla.
- Personel detayını özlük, istihdam, ücret, bordro, avans, izin ve belge
  sekmelerine ayır.
- Bordro çalışma alanı, onay kuyruğu ve ödeme ekranı oluştur.
- Sunucu taraflı sayfalama, filtreleme, kaydedilmiş görünüm ve mobil tasarım ekle.
- Personel sayısı, maaş yükü, açık bordro, avans ve izin raporlarını oluştur.

### Faz 7 — Türkiye mevzuatına uygun bordro

- Yürürlük tarihli ve sürümlü mevzuat parametreleri oluştur.
- SGK, işsizlik, gelir/damga vergisi, istisna, tavan/taban, eksik gün ve
  teşvik hesaplarını geliştir.
- Hesap sonuçlarını bordro uzmanı ve mali müşavir kabul senaryolarıyla doğrula.

## Önerilen API yapısı

```text
GET    /personel
POST   /personel
GET    /personel/:id
PATCH  /personel/:id
POST   /personel/:id/isten-cikar
POST   /personel/:id/yeniden-baslat

GET    /personel/bordrolar
POST   /personel/bordrolar/tahakkuk
GET    /personel/bordrolar/:id
POST   /personel/bordrolar/:id/onaya-gonder
POST   /personel/bordrolar/:id/onayla
POST   /personel/bordrolar/:id/odemeler

GET    /personel/avanslar
POST   /personel/avanslar
POST   /personel/avanslar/:id/onayla
POST   /personel/avanslar/:id/ode
```

## Test ve kalite kapıları

- Birim: doğrulamalar, dönem uygunluğu, para hesabı ve durum geçişleri
- Entegrasyon: gerçek PostgreSQL üzerinde RLS, transaction ve eşzamanlılık
- API sözleşmesi: endpoint, hata gövdesi, tarih/decimal serileştirmesi ve roller
- E2E: personel oluşturma, tahakkuk, onay, ödeme, avans ve izin senaryoları
- Güvenlik: IDOR, tenant aşımı, alan sızıntısı ve yinelenen ödeme testleri
- Her fazda API ve web typecheck, test ve build başarılı olmalıdır.

## Tahmini takvim

| Faz | Tahmin |
| --- | ---: |
| Güvenlik ve çalışabilirlik | 3–5 gün |
| Personel özlük çekirdeği | 1–2 hafta |
| Tahakkuk motoru | 2 hafta |
| Finans entegrasyonu | 1–2 hafta |
| İzin ve avans yönetimi | 2 hafta |
| Belgeler, arayüz ve raporlama | 2–3 hafta |
| Yasal bordro motoru | 4–8+ hafta |

İlk güvenilir operasyonel sürüm yaklaşık 7–10 hafta; mevzuata uygun tam bordro
ise uzman kabulüyle birlikte yaklaşık 12–18 hafta ölçeğindedir.

## Uygulama durumu — 20 Ağustos 2026

- [x] Kimlik doğrulamalı web/API sözleşmesi
- [x] Personel tablolarında RLS
- [x] TCKN, IBAN ve ödeme hesabı doğrulamaları
- [x] Atomik personel numarası
- [x] Personel durumları ve istihdam geçmişi
- [x] İşten çıkış ve yeniden işe başlatma akışı
- [x] Döneme uygun personel tahakkuku
- [x] Bordro durum yaşam döngüsü ve görev ayrılığı
- [x] Kazanç/kesinti kalemleri ve transaction içinde toplam hesabı
- [x] Bordro çalışma alanı, detay, ret ve ödeme arayüzü
- [x] Kısmi/çoklu ödeme ve ters kayıt
- [x] Avans talep, onay, ödeme ve mahsup yaşam döngüsü
- [x] İzin yönetimi (hafta sonu, resmî tatil ve yarım gün takvimi dahil)
- [x] İşyeri, departman, pozisyon ve yönetici hiyerarşisi
- [x] Özlük belgeleri, dosya sınıflandırması ve süre sonu takibi
- [x] İK gösterge paneli ve personel maliyet raporları
- [x] Alan şifreleme ve hassas veri görüntüleme audit'i
- [x] Yürürlük tarihli ve sürümlü bordro mevzuat parametre altyapısı
- [x] SGK tavanı, kümülatif vergi ve asgari ücret istisnalı brütten nete ön hesaplama çekirdeği
- [x] Mevzuat sürümlü brüt–net simülasyon ve hesap izi ekranı
- [x] Brüt ücretli personel tahakkukunda mevzuat sürümü ve değişmez hesap özeti
- [x] Bordro onay ekranında mevzuat sürümü ve ayrıntılı hesap izi
- [x] Aylık prim günü, eksik gün nedeni ve tahakkuk kilidi
- [x] Uzman kabul senaryoları ve mevzuat etkinleştirme kalite kapısı
- [x] Mevzuat sürümlü SGK işveren teşviki ve net işveren maliyeti hesap izi
- [x] Personel derecesi ve mevzuat sürümüyle engellilik indirimi
- [x] Personel bazlı SGK teşviki ve otomatik tahakkuk entegrasyonu
- [x] Teşvik sonrası işveren maliyeti ve tasarruf yönetim raporu
- [x] Dönem seçilebilir ayrıntılı işveren maliyeti Excel raporu
- [x] Personel ve departman filtreli işveren maliyet analiz ekranı
- [x] Önceki dönem maliyet karşılaştırması ve filtre kapsamlı Excel
- [x] Şahıs/hayat sigortası ve sendika aidatı gelir vergisi matrah indirimleri
- [x] Şahıs/hayat sigortası primlerinin matrah indirimi ile nakit kesintisini ayrı izleme
- [x] Sendika aidatının matrah indirimi ile nakit kesintisini ayrı izleme
- [x] Fazla mesai ve prim/ikramiyenin SGK-vergi matrahlarına otomatik dahil edilmesi
- [x] Nakit yemek yardımında fiilî gün bazlı ayrı SGK ve gelir vergisi istisnaları
- [x] Ücret dışı ödemelerde iki aylık SGK tavan devri hesaplama çekirdeği
- [x] SGK tavan devrini dönem bordroları arasında kalıcı hesap izine bağlama
- [ ] Mevzuata uygun yasal bordro motoru
