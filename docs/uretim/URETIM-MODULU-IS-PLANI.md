# TekirExtra Profesyonel Üretim Modülü İş Planı

**Durum:** Planlanan kapsam tamamlandı (2026-10-17 tespiti) — aşağıdaki uygulama ilerlemesi listesinin tamamı işaretli; sonraki geliştirmeler ISTERLER ve üretim inceleme notlarında izlenir
**Kaydedilme tarihi:** 21 Ağustos 2026  
**Mevcut ekran:** `/panel/uretim`  
**Hedef:** Mevcut reçete–sarf–mamul girişi akışını; planlama, kısmi üretim, izlenebilirlik, maliyet, kalite ve görevler ayrılığı içeren profesyonel bir üretim yönetim modülüne dönüştürmek.

## Uygulama ilerlemesi

- [x] Genişletilmiş üretim emri durum modeli
- [x] Tenant/yıl bazlı atomik üretim emri sayacı
- [x] Planla, malzeme ayır, başlat, tamamla ve iptal geçişleri
- [x] Üretim emri detay ekranı ve depo bazlı malzeme uygunluğu
- [x] Depo/varyant bazlı izlenebilir malzeme rezervasyonu
- [x] Sarfta rezervasyonun tüketilmesi ve iptalde çözülmesi
- [x] Kısmi üretim bildirimleri, idempotency ve bildirim bazlı gerçek sarf
- [x] Reçete versiyonlama, yürürlük tarihi, onay ve üretim emrine sürüm sabitleme
- [x] İş merkezleri, operasyonlar ve kapasite planlama
  - [x] İş merkezi kapasite/verimlilik/maliyet tanımları
  - [x] Reçete sürümüne bağlı operasyon rotası
  - [x] Emir açılışında rota ve süre planının sabitlenmesi
  - [x] Tarih aralıklı kapasite yükü ve aşım görünümü
  - [x] Sıralı operasyon başlatma, bekletme, tamamlama ve fiilî süre bildirimi
- [x] Kalite, maliyet sapması ve üretim raporları
  - [x] Emir bazlı planlanan/gerçek malzeme ve operasyon maliyeti
  - [x] Dönemsel üretim maliyeti ve sapma raporu
  - [x] Reçete bazlı kalite zorunluluğu, karantina ve kabul/red akışı
- [x] Üretim planlama, operatör, depo, kalite ve maliyet muhasebesi görevler ayrılığı
- [x] Tüm üretim mutasyonlarında merkezi denetim izi
- [x] Kalite zorunlu üretimde karantina akışı ve red sonrası yeniden üretime açılma
- [x] Üretim bildiriminde lot, üretim/SKT ve çok satırlı seri numarası girişi
- [x] Bildirim ve emir bazında hurda/yeniden işleme toplamları
- [x] Hurda ve yeniden işleme miktarlarında zorunlu neden kaydı
- [x] Kontrol merkezinde açık iş, gecikme, kalite ve kayıp KPI'ları
- [x] Emir listesinde durum, metin, gecikme filtreleri ve ilerleme görünümü

## 1. Yönetici özeti

Mevcut modül ürün reçetesi tanımlayabilmekte, üretim emri oluşturmakta, kullanılabilir malzemeleri depolardan sarf etmekte ve mamulü hedef depoya almaktadır. Lot/seri ve ortalama maliyet altyapısıyla temel entegrasyon mevcuttur.

Ancak üretim tek adımda tamamlanmakta; planlanan miktar otomatik olarak gerçekleşen miktar kabul edilmektedir. Kısmi üretim, gerçek sarf, hurda, iş merkezi, operasyon rotası, rezervasyon, kalite ve gerçek üretim maliyeti bulunmamaktadır.

Profesyonel hedef yapı şu ana çalışma alanlarından oluşacaktır:

- Üretim kontrol merkezi
- Üretim emirleri ve emir detayı
- Reçete ve reçete versiyonları
- Üretim planlama
- Malzeme hazırlama ve rezervasyon
- Üretim bildirimleri
- Lot/seri izlenebilirliği
- Kalite kontrol
- Üretim maliyeti ve sapma analizi
- Üretim raporları

## 2. Başarı ölçütleri

- Üretim emri kontrollü bir durum makinesi üzerinden ilerler.
- Planlanan ve gerçekleşen miktarlar ayrı izlenir.
- Kısmi üretim ve birden fazla üretim bildirimi desteklenir.
- Gerçek sarf, fire, hurda ve iade ayrı kaydedilir.
- Malzemeler üretim öncesinde kaynak depo ve lot bazında rezerve edilebilir.
- Reçeteler versiyonlanır, onaylanır ve yürürlük tarihleriyle yönetilir.
- Emir hangi reçete sürümüyle açıldıysa o sürüm korunur.
- Seri ve lot girişleri barkod/çoklu giriş ekranından yapılabilir.
- Planlanan ve gerçekleşen üretim maliyeti karşılaştırılır.
- Aynı üretim bildirimi iki kez stok hareketi oluşturamaz.
- Üretim, depo, kalite ve muhasebe yetkileri birbirinden ayrılır.
- Tüm kritik durum değişiklikleri denetim kaydına yazılır.

## 3. Mevcut kritik açıklar

### 3.1 Sınırlı durum modeli

Mevcut durumlar yalnızca `taslak`, `tamamlandi` ve `iptal`dir. Profesyonel hedef:

```text
taslak
→ planlandi
→ malzeme_bekliyor
→ hazir
→ uretimde
→ kismen_tamamlandi
→ tamamlandi
```

Alternatif durumlar: `beklemede`, `durduruldu`, `iptal_talebi`, `iptal`.

### 3.2 Planlanan miktarın gerçekleşen sayılması

Mevcut tamamlamada üretilen miktar ve sarf edilen miktar doğrudan plan değerlerine eşitlenmektedir. Hedefte şu değerler ayrı tutulacaktır:

- Planlanan mamul
- İyi ürün
- Hatalı ürün
- Hurda
- Yeniden işleme
- Gerçek malzeme sarfı
- Reçete sapması

### 3.3 Kaynak depo kontrolü

Sistem malzemeleri varsayılan ve kullanılabilir stoğu yüksek depolardan otomatik tüketmektedir. Kaynak depo, kalite/karantina durumu, üretim hattı ve fiziksel hazırlama süreci açıkça yönetilmelidir.

### 3.4 Reçete versiyonu bulunmaması

Her mamul için yalnız bir reçete bulunmaktadır. Eski reçetelerin geçerlilik, onay ve değişiklik geçmişi korunmamaktadır.

### 3.5 Emir numarası yarış durumu

Yıl içindeki emir sayısı kullanılarak numara üretilmektedir. Eş zamanlı işlemler için atomik `UretimSayac` kullanılmalıdır.

### 3.6 Eksik maliyet kapsamı

Mevcut toplam maliyet yalnızca malzeme ortalama maliyetidir. İşçilik, makine, enerji, taşeron, genel üretim gideri, kalite ve gerçek hurda maliyeti eksiktir.

### 3.7 Tarihlerin ayrışmaması

Plan tarihi, fiilî üretim zamanı, stok işlem tarihi ve lot üretim tarihi ayrı yönetilmelidir. Kapalı döneme geriye dönük stok hareketi engellenmelidir.

### 3.8 Lot/seri kullanıcı deneyimi

Lot bilgileri arayüzde alınmamakta; seri numaraları tarayıcı `prompt` penceresinde virgülle girilmektedir. Barkod okuyucu, satır bazlı doğrulama ve CSV/Excel aktarımı desteklenmelidir.

### 3.9 Görevler ayrılığı

Üretim işlemlerinin `muhasebe` rolüne bağlanması yerine üretim planlama, operatör, depo, kalite, yönetici ve maliyet muhasebesi rolleri tanımlanmalıdır.

## 4. Hedef veri modeli

### 4.1 Üretim emri

```text
UretimEmri
- id, tenantId, no
- mamulStokId
- receteVersiyonuId
- isMerkeziId, uretimHattiId
- kaynakDepoId, hedefDepoId
- planlananMiktar, uretilenMiktar
- hurdaMiktari, yenidenIslemeMiktari
- planlananBaslangic, planlananBitis
- fiiliBaslangic, fiiliBitis
- oncelik, durum
- sorumluUserId
- siparisId
- aciklama
```

### 4.2 Üretim emri malzemesi

```text
- planlananMiktar
- rezerveMiktar
- sarfEdilenMiktar
- iadeEdilenMiktar
- fireMiktari
- kaynakDepoId
- planlananBirimMaliyet
- gercekBirimMaliyet
```

### 4.3 Reçete versiyonu

```text
UrunRecetesi
└── ReceteVersiyonu
    - surum
    - durum
    - yururlukBaslangic/yururlukBitis
    - onaylayanUserId
    - degisiklikNedeni
    - ciktiMiktari
    - malzemeler
    - operasyonlar
```

Reçete durumları: `taslak`, `onay_bekliyor`, `aktif`, `pasif`, `arsiv`.

### 4.4 Üretim operasyonu

```text
- sira
- operasyonKodu
- isMerkeziId
- hazirlikSuresi
- cevrimSuresi
- planlananBaslangic/Bitis
- fiiliBaslangic/Bitis
- durum
```

### 4.5 Üretim bildirimi

```text
- uretimEmriId
- uretilenMiktar
- hurdaMiktari
- bildirimTarihi
- vardiyaId
- operatorUserId
- lotNo
- idempotencyAnahtari
- aciklama
```

### 4.6 Ek modeller

- İş merkezi
- Üretim hattı
- Operasyon rotası
- Vardiya
- Duruş nedeni
- Hurda nedeni
- Kalite kontrol kaydı
- Malzeme rezervasyonu
- Üretim maliyet kalemi

## 5. Hedef iş akışı

```text
Reçete onayı
    ↓
Üretim emri oluşturma
    ↓
Malzeme ihtiyaç analizi
    ├── Eksik → Malzeme bekliyor
    └── Yeterli → Planlandı
                    ↓
             Malzeme rezervasyonu
                    ↓
              Üretime başlama
                    ↓
         Kısmi üretim bildirimleri
                    ↓
        Kalite kontrol gerekiyorsa
            ├── Red / yeniden işleme
            └── Kabul
                    ↓
           Mamul stok girişi
                    ↓
           Gerçek maliyet hesabı
                    ↓
                Tamamlandı
```

## 6. Ekran yapısı

### 6.1 Üretim kontrol merkezi — `/panel/uretim`

KPI’lar:

- Açık üretim emirleri
- Bugün planlanan üretim
- Üretimde olan işler
- Malzeme bekleyenler
- Geciken emirler
- Tamamlanan miktar
- Gerçekleşme ve hurda oranı
- Planlanan/gerçek maliyet sapması

Paneller:

- Bugünün üretim planı
- Malzeme eksiği olan emirler
- Geciken işler
- Son üretim bildirimleri
- Kritik stok uyarıları

### 6.2 Üretim emirleri — `/panel/uretim/emirler`

- Durum, tarih, ürün, depo, hat ve sorumlu filtreleri
- Planlanan/gerçekleşen miktar
- İlerleme yüzdesi
- Malzeme hazırlık durumu
- Tahmini/gerçek maliyet
- Gecikme göstergesi
- Yetkili toplu işlemler

### 6.3 Yeni emir sihirbazı

1. Mamul ve reçete versiyonu
2. Planlanan miktar ve tarihler
3. Kaynak/hedef depo
4. İş merkezi ve sorumlu
5. Malzeme ihtiyacı
6. Stok uygunluğu
7. Maliyet önizlemesi
8. Onay

### 6.4 Emir detayı — `/panel/uretim/emirler/:id`

Sekmeler:

- Genel bakış
- Malzemeler
- Operasyonlar
- Üretim bildirimleri
- Lot/seri
- Maliyet
- Kalite
- Hareket geçmişi

İşlemler:

- Planla
- Malzemeyi rezerve et
- Üretime başla/beklet
- Kısmi üretim bildir
- Sarf düzelt
- Hurda bildir
- Üretimi tamamla
- İptal talebi oluştur

### 6.5 Reçeteler — `/panel/uretim/receteler`

- Mamul ve aktif sürüm
- Son güncelleme
- Malzeme ve operasyon sayısı
- Tahmini maliyet
- Onay durumu
- Açık emirlerde kullanım

### 6.6 Planlama — `/panel/uretim/planlama`

- Haftalık takvim/Gantt
- İş merkezi ve üretim hattı
- Kapasite yükü
- Çakışmalar
- Malzeme uygunluğu
- Gecikmeler

### 6.7 Malzeme hazırlama

- Emir ve gereken malzemeler
- Kaynak depo ve lot/seri
- Planlanan/toplanan/eksik miktar
- Barkodla toplama
- Hazırlama onayı

### 6.8 Üretim bildirimi

- İyi ürün, hurda ve yeniden işleme
- Gerçek sarf
- Lot/seri
- Başlangıç/bitiş zamanı
- Operatör ve vardiya
- Hurda/duruş nedeni
- Açıklama ve ek belge

## 7. Maliyet yaklaşımı

### Planlanan maliyet

- Reçete malzemeleri
- Standart işçilik
- Standart makine zamanı
- Genel üretim gideri
- Standart fire

### Gerçekleşen maliyet

- Gerçek sarf ve sarf anındaki maliyet
- Fiilî işçilik
- Fiilî makine zamanı
- Hurda
- Taşeron ve enerji
- Dağıtılan genel üretim gideri

Maliyet kalemleri: `malzeme`, `iscilik`, `makine`, `enerji`, `tasaron`, `genel_uretim`, `fire`, `diger`.

Planlanan/gerçekleşen/sapma raporu üretim emri ve dönem bazında sunulmalıdır.

## 8. Yetki matrisi

| İşlem | Planlama | Operatör | Depo | Kalite | Yönetici | Maliyet muhasebesi |
|---|---:|---:|---:|---:|---:|---:|
| Reçete taslağı | Evet | Hayır | Hayır | Görür | Evet | Görür |
| Reçete onayı | Politika | Hayır | Hayır | Opsiyonel | Evet | Hayır |
| Emir oluşturma | Evet | Hayır | Hayır | Hayır | Evet | Hayır |
| Malzeme hazırlama | Görür | Hayır | Evet | Hayır | Evet | Hayır |
| Üretim bildirimi | Görür | Evet | Hayır | Görür | Evet | Hayır |
| Kalite kararı | Hayır | Hayır | Hayır | Evet | Evet | Hayır |
| Maliyet kapatma | Görür | Hayır | Hayır | Hayır | Evet | Evet |

## 9. API taslağı

```text
GET    /uretim/ozet

GET    /uretim/receteler
POST   /uretim/receteler
GET    /uretim/receteler/:id
POST   /uretim/receteler/:id/surumler
POST   /uretim/recete-surumleri/:id/onaya-gonder
POST   /uretim/recete-surumleri/:id/onayla

GET    /uretim/emirler
POST   /uretim/emirler
GET    /uretim/emirler/:id
PATCH  /uretim/emirler/:id
POST   /uretim/emirler/:id/planla
POST   /uretim/emirler/:id/rezerve-et
POST   /uretim/emirler/:id/baslat
POST   /uretim/emirler/:id/beklet
POST   /uretim/emirler/:id/bildirimler
POST   /uretim/emirler/:id/tamamla
POST   /uretim/emirler/:id/iptal

GET    /uretim/emirler/:id/malzeme-uygunlugu
GET    /uretim/emirler/:id/maliyet
GET    /uretim/planlama
GET    /uretim/kapasite
```

Durum geçişleri koşullu ve transaction içinde uygulanmalıdır. Üretim bildirimleri idempotent olmalıdır.

## 10. Test stratejisi

### Birim ve servis testleri

- Reçete miktar ölçekleme ve fire
- Birden fazla depodan sarf
- Rezerve stok kontrolü
- Kısmi üretim
- Gerçek sarf sapması
- Hurda ve yeniden işleme
- Lot/seri benzersizliği
- Aynı emrin iki kez tamamlanamaması
- Eş zamanlı tamamlamada tek stok hareketi
- FEFO lot tahsisi
- Planlanan/gerçek maliyet
- İptalde rezervasyon çözme
- Kapalı dönem kontrolü
- Tenant izolasyonu ve roller

### Uçtan uca testler

- Reçete sürümü oluşturma ve onaylama
- Emir oluşturma ve malzeme uygunluğu
- Malzeme hazırlama
- Üretime başlama
- Kısmi bildirim ve tamamlanma
- Lot/seri ile mamul girişi
- Kalite kabul/red
- Maliyet kapatma ve raporlama

### Değişmezler

```text
Σ malzeme sarfı = üretim emri gerçek sarf toplamı
Σ mamul girişi = kabul edilen iyi ürün toplamı
gerçek maliyet = malzeme + işçilik + makine + genel gider
aynı bildirim yalnız bir kez stok hareketi oluşturur
```

## 11. Uygulama aşamaları

| Aşama | Kapsam | Tahmin |
|---|---|---:|
| 0 | İş kuralları, roller ve üretim modeli | 2–4 gün |
| 1 | Sayaç, tarih, idempotency ve kritik testler | 4–6 gün |
| 2 | Emir durum makinesi ve detay ekranı | 6–9 gün |
| 3 | Kısmi üretim, gerçek sarf, hurda, lot/seri | 7–10 gün |
| 4 | Reçete versiyonlama ve onay | 5–8 gün |
| 5 | Malzeme rezervasyonu ve depo hazırlama | 6–9 gün |
| 6 | Planlanan/gerçek maliyet ve sapma | 6–10 gün |
| 7 | İş merkezi, operasyon ve kapasite | 8–12 gün |
| 8 | Kalite, raporlama, UAT ve yayın | 6–10 gün |

Profesyonel temel sürüm yaklaşık **6–8 hafta**, geniş üretim planlama ve kalite kapsamı **10–14 hafta** olarak öngörülmektedir.

## 12. Geliştirme öncesi kararlar

- Üretim siparişe bağlı mı, stoğa üretim mi, ikisi de mi desteklenecek?
- Kaynak depo emir genelinde mi, malzeme satırında mı seçilecek?
- Rezervasyon zorunlu mu olacak?
- Kısmi üretimde mamul anında stoğa alınacak mı?
- Kalite kontrol hangi ürünlerde zorunlu olacak?
- Hurda maliyeti mamule mi dağıtılacak, ayrı gider mi olacak?
- İşçilik ve makine zamanı nasıl toplanacak?
- Standart maliyet mi, gerçekleşen maliyet mi ana raporlama kaynağı olacak?
- Yan ürün ve ortak ürün desteği ilk kapsamda olacak mı?
- Kapalı stok/muhasebe dönemleri nasıl belirlenecek?
- Mobil/barkod terminali ilk sürümde gerekli mi?

## 13. Önerilen başlangıç sırası

1. Atomik üretim numarası
2. Durum makinesi ve görevler ayrılığı
3. Üretim emri detay ekranı
4. Kaynak depo ve rezervasyon
5. Kısmi üretim bildirimi
6. Gerçek sarf, hurda ve yeniden işleme
7. Profesyonel lot/seri girişi
8. Reçete versiyonlama
9. Gerçek maliyet ve sapma
10. Kapasite planlama ve kalite

Bu sıra, görsel genişlemeden önce stok ve maliyet doğruluğunu güvence altına alır.
