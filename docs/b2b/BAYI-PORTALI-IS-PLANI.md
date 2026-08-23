# TekirExtra Profesyonel B2B Bayi Portalı İş Planı

**Durum:** Planlandı — geliştirmeye başlanmadı  
**Kaydedilme tarihi:** 21 Ağustos 2026  
**Mevcut ekran:** `/panel/b2b`  
**Hedef:** Mevcut şirket içi “cari adına sipariş girme” ekranını, güvenli ve profesyonel bir bayi self-servis portalına dönüştürmek.

## 1. Yönetici özeti

Mevcut B2B ekranında şirket kullanıcısı cariler arasında seçim yaparak katalog görüntüleyip sipariş oluşturabilmektedir. Bu yapı gerçek bir bayi portalı değildir. Hedef yapıda bayi kullanıcıları ayrı kimliklerle giriş yapacak, yalnızca bağlı oldukları cari hesabın verilerine erişecek ve kendi fiyat, iskonto, bakiye, risk, sipariş, fatura ve ekstre bilgilerini yönetebilecektir.

Çözüm iki ayrı uygulama alanı olarak tasarlanacaktır:

| Alan | Kullanıcı | Sorumluluk |
|---|---|---|
| `/panel/b2b-yonetim` | Şirket çalışanı | Bayi, fiyat, risk, kullanıcı ve sipariş yönetimi |
| `/bayi` | Bayi kullanıcısı | Katalog, sepet, sipariş, ekstre, fatura ve profil işlemleri |

Eski `/panel/b2b` ekranı geçiş süresince “bayi adına sipariş oluşturma” operasyon ekranı olarak tutulabilir; ancak yeni merkezi fiyatlandırma servisini kullanmalıdır.

## 2. Başarı ölçütleri

- Bayi yalnızca yetkilendirildiği cari hesabını görebilir.
- URL veya istek gövdesi değiştirilerek başka bayinin verilerine erişilemez.
- Katalog, sepet ve sipariş fiyatları aynı merkezi hesaplama sonucunu kullanır.
- Özel fiyat listesi, cari iskontosu, karma KDV ve döviz doğru hesaplanır.
- Risk, vade, kara liste, stok ve sipariş politikaları backend tarafından uygulanır.
- Aynı sipariş isteği mükerrer belge oluşturmaz.
- Sipariş şirket operasyonu tarafından izlenebilir ve yönetilebilir.
- Portal mobil ve masaüstünde kullanılabilir olur.
- Kritik kullanıcı ve finans hareketleri denetim kaydına yazılır.
- Birim, entegrasyon ve uçtan uca testler kabul kriterlerini doğrular.

## 3. Hedef modül yapısı

### 3.1 Bayi portalı

- Giriş, parola sıfırlama ve iki faktörlü doğrulama
- Ana sayfa ve ticari özet
- Katalog, kategori ve ürün detayı
- Sunucu taraflı kalıcı sepet
- Sipariş oluşturma ve sipariş geçmişi
- Sipariş durumu ve sevkiyat takibi
- Cari bakiye ve ekstre
- Faturalar ve belge indirme
- Teslimat/fatura adresleri
- Bayi kullanıcıları ve roller
- Bildirim tercihleri ve aktif oturumlar

### 3.2 Şirket yönetim paneli

- Bayi listesi ve portal erişim durumu
- Bayi detay ekranı
- Bayi kullanıcısı davetleri
- Fiyat listesi ve iskonto politikaları
- Risk limiti, vade ve bloke yönetimi
- Sipariş onay merkezi
- Portal işlem geçmişi
- Portal özellik anahtarları ve ayarlar

## 4. Kimlik, üyelik ve yetkilendirme

### 4.1 Veri modelleri

`BayiKullanici`:

- `id`, `tenantId`, `cariId`
- `ad`, `soyad`, `eposta`, `telefon`
- `parolaHash`, `rol`, `aktif`
- `epostaDogrulandi`, `ikiFaktorEtkin`
- `sonGirisTarihi`, `createdAt`, `updatedAt`

Ek modeller:

- `BayiDavet`: süreli ve tek kullanımlık davetler
- `BayiOturum`: refresh token, cihaz ve oturum iptali
- `BayiSepet` ve `BayiSepetKalemi`: sunucu taraflı sepet
- `BayiSiparisMeta`: portal sipariş bilgileri ve idempotency anahtarı
- `BayiBildirim`: portal içi bildirimler

### 4.2 Roller

| Yetki | Bayi yöneticisi | Sipariş veren | Finans | Salt okunur |
|---|---:|---:|---:|---:|
| Katalog | Evet | Evet | Evet | Evet |
| Sipariş oluşturma | Evet | Evet | Hayır | Hayır |
| Sipariş onaylama | Evet | Politikaya bağlı | Hayır | Hayır |
| Finans/ekstre | Evet | Opsiyonel | Evet | Evet |
| Kullanıcı yönetimi | Evet | Hayır | Hayır | Hayır |

### 4.3 Güvenlik ilkeleri

- `tenantId` ve `cariId` istemciden güven kaynağı olarak alınmaz.
- Cari kapsamı bayi oturumundan backend tarafından belirlenir.
- Bayi ve şirket oturumları ayrı token/guard zincirleri kullanır.
- Access token kısa süreli, refresh token rotasyonlu olur.
- Parolalar Argon2 ile saklanır.
- Davetler süreli, hashlenmiş ve tek kullanımlık olur.
- Giriş, parola sıfırlama ve doğrulama uçlarına rate limit uygulanır.
- Dosya ve belge indirmelerinde de sahiplik kontrolü yapılır.
- Hassas finans ekranları rol bazlı korunur.
- Oturumlar cihaz bazında görüntülenebilir ve iptal edilebilir.

## 5. Merkezi fiyatlandırma motoru

Katalog ve sipariş aynı `BayiFiyatlandirmaService` üzerinden hesaplanmalıdır.

Fiyat önceliği:

1. Cari sözleşme fiyatı
2. Cari fiyat listesi
3. Bayi grubu fiyat listesi
4. Kampanya fiyatı
5. Stok satış fiyatı

Sonrasında cari/ürün grubu/miktar iskontosu, kampanya, döviz, KDV ve yuvarlama uygulanır.

Backend hesap çıktısı en az şu alanları içermelidir:

```json
{
  "listeFiyati": 1000,
  "uygulananFiyat": 900,
  "iskontoOrani": 10,
  "iskontoTutari": 100,
  "kdvOrani": 20,
  "kdvHaricTutar": 900,
  "kdvTutari": 180,
  "kdvDahilTutar": 1080,
  "dovizCinsi": "TRY",
  "fiyatKaynagi": "cari_fiyat_listesi"
}
```

Frontend fiyat göndermez; yalnızca stok, miktar, adres ve referans gönderir. Sipariş fiyatları backend tarafından yeniden hesaplanarak belge satırlarına snapshot olarak kaydedilir.

Sabit `%20` KDV veya `genelToplam / 1.2` yaklaşımı kaldırılır. Belge toplamları satırlardan türetilir:

```text
toplamBrut = Σ satır liste tutarı
toplamSatırİskontosu = Σ satır iskontosu
toplamMatrah = Σ satır matrahı
toplamKdv = Σ satır KDV'si
genelToplam = toplamMatrah + toplamKdv
```

## 6. Risk ve sipariş politikaları

Sipariş öncesinde backend şu kontrolleri yürütür:

- Cari ve portal erişimi aktif mi?
- Cari kara listede mi?
- Kullanıcı aktif ve siparişe yetkili mi?
- Ürün aktif ve B2B kanalına açık mı?
- Minimum sipariş ve paket miktarı uygun mu?
- Stok/tahsis edilebilir miktar yeterli mi?
- Risk limiti aşılmış mı?
- Vadesi geçmiş borç var mı?
- Teslimat adresi ilgili cariye mi ait?
- Fiyat listesi ve döviz geçerli mi?

Risk sonucu:

- `uygun`
- `onay_gerekli`
- `pesin_odeme_gerekli`
- `blokeli`

## 7. Sipariş yaşam döngüsü

```text
taslak
→ bayi_onayi_bekliyor
→ gonderildi
→ sirket_onayi_bekliyor (gerekiyorsa)
→ onaylandi
→ hazirlaniyor
→ kismen_sevk_edildi / sevk_edildi
→ faturalandi
→ tamamlandi
```

Alternatif son durumlar: `reddedildi`, `iptal_talebi`, `iptal_edildi`.

Portal siparişi doğrudan `onaylandi` oluşturulmaz. Risk ve şirket politikası sonucuna göre `gonderildi` veya `sirket_onayi_bekliyor` durumuyla başlar.

## 8. Portal ekranları

### Giriş

- E-posta/parola, beni hatırla
- Parola sıfırlama
- 2FA doğrulaması
- Destek bağlantısı

### Ana sayfa

- Açık/hazırlanan siparişler
- Cari bakiye ve kullanılabilir risk
- Vadesi yaklaşan/geçmiş borç
- Son fatura ve kampanyalar
- Yeni/hızlı sipariş ve ekstre indirme kısayolları

### Katalog ve ürün detayı

- Kategori, marka, stok kodu ve barkod araması
- Stokta olanlar ve kampanyalar
- Ürün görselleri, varyantlar, paket/koli bilgileri
- Minimum sipariş miktarı
- KDV hariç/dahil fiyat ve tahmini teslimat
- Fiyat kademeleri ve ilgili ürünler

### Sepet

- Birim fiyat, iskonto, KDV ve satır toplamları
- Teslimat adresi, sipariş referansı ve not
- Risk değerlendirmesi
- Fiyat geçerlilik zamanı

### Siparişler

- Durum/tarih filtresi
- Sipariş ve bayi referansı
- Sevk/fatura bağlantıları
- Tekrar sipariş ve iptal talebi
- PDF/Excel indirme

### Finans

- Bakiye, risk limiti ve kullanılabilir limit
- Vadesi geçmiş toplam
- Cari ekstre ve açık/kapalı faturalar
- Ödeme geçmişi ve belge indirme

## 9. API taslağı

### Kimlik

```text
POST /bayi-auth/giris
POST /bayi-auth/yenile
POST /bayi-auth/cikis
POST /bayi-auth/parola-unuttum
POST /bayi-auth/parola-sifirla
POST /bayi-auth/2fa/dogrula
GET  /bayi-auth/ben
```

### Portal

```text
GET    /bayi/ozet
GET    /bayi/katalog
GET    /bayi/katalog/:stokId
GET    /bayi/kategoriler
GET    /bayi/sepet
POST   /bayi/sepet/kalemler
PATCH  /bayi/sepet/kalemler/:id
DELETE /bayi/sepet/kalemler/:id
POST   /bayi/sepet/hesapla
POST   /bayi/siparisler
GET    /bayi/siparisler
GET    /bayi/siparisler/:id
POST   /bayi/siparisler/:id/iptal-talebi
POST   /bayi/siparisler/:id/tekrarla
GET    /bayi/finans/ozet
GET    /bayi/finans/ekstre
GET    /bayi/faturalar
GET    /bayi/faturalar/:id
GET    /bayi/faturalar/:id/pdf
GET    /bayi/adresler
POST   /bayi/adresler
PATCH  /bayi/adresler/:id
```

### Yönetim

```text
GET  /b2b-yonetim/bayiler
GET  /b2b-yonetim/bayiler/:id
POST /b2b-yonetim/bayiler/:id/davetler
POST /b2b-yonetim/bayiler/:id/bloke-et
POST /b2b-yonetim/siparisler/:id/onayla
POST /b2b-yonetim/siparisler/:id/reddet
```

## 10. Test stratejisi

### Birim testleri

- Özel fiyat, cari iskontosu ve miktar kademesi
- Karma KDV, döviz ve yuvarlama
- Risk limiti ve kara liste
- Minimum miktar, pasif/geçersiz stok

### Entegrasyon testleri

- Bayiler arası veri izolasyonu
- Katalog-sepet-sipariş fiyat eşitliği
- Değişen fiyatın siparişte yeniden hesaplanması
- Idempotent sipariş gönderimi
- Karma KDV belge toplamları
- Risk ve iptal akışları

### E2E testleri

- Davet, parola oluşturma ve giriş
- Katalog, sepet ve sipariş
- Bayi/şirket onay akışları
- Ekstre ve fatura indirme
- Yetkisiz finans erişimi
- Mobil katalog ve sepet

## 11. Aşamalar ve tahmin

| Aşama | Kapsam | Tahmin |
|---|---|---:|
| 0 | İş kuralları ve kararlar | 2–3 gün |
| 1 | Merkezi fiyat/KDV ve sipariş çekirdeği | 4–6 gün |
| 2 | Bayi kimliği, davet, oturum ve yetki | 5–8 gün |
| 3 | Portal MVP: katalog, sepet, sipariş | 7–10 gün |
| 4 | Finans, ekstre, faturalar ve adresler | 5–7 gün |
| 5 | Şirket B2B yönetim paneli | 5–8 gün |
| 6 | Bildirimler ve operasyon bağlantıları | 4–6 gün |
| 7 | Güvenlik, yük, UAT ve yayın | 4–6 gün |

Toplam tahmin, kapsam ve ekip büyüklüğüne bağlı olarak **6–9 hafta**dır.

## 12. Yayına geçiş

1. İç kullanıcılarla fiyat ve belge doğrulaması
2. Test carisiyle uçtan uca çalışma
3. Tek pilot bayi
4. 3–5 bayilik kontrollü grup
5. Finansal mutabakat
6. Kademeli genel açılış

Özellik anahtarları:

- `bayiPortalAktif`
- `onlineSiparisAktif`
- `finansEkraniAktif`
- `onlineOdemeAktif`
- `siparisOnayiGerekli`

## 13. Geliştirmeye başlamadan önce karara bağlanacak konular

- Bir kullanıcı birden fazla bayiye erişebilecek mi?
- Bayi kullanıcı rollerinin kesin yetki matrisi nedir?
- Stok miktarı tam sayı mı, durum etiketi mi gösterilecek?
- Risk aşımında blokaj mı, şirket onayı mı uygulanacak?
- Sipariş için bayi içi çift onay gerekli mi?
- Fiyat önceliği ve kampanya birleşim kuralları nedir?
- Portal çoklu döviz destekleyecek mi?
- Online ödeme ilk sürüm kapsamında mı?
- Sipariş iptal ve değişiklik sınırları nelerdir?
- Pilot bayi ve kabul testi sorumluları kimlerdir?

## 14. Önerilen başlangıç sırası

1. Fiyatlandırma ve KDV motorunu düzelt.
2. Sipariş doğrulama, risk ve idempotency katmanını kur.
3. Bayi kimliği ve cari kapsamlı yetkilendirmeyi oluştur.
4. Portal MVP arayüzünü geliştir.
5. Finans ve yönetim ekranlarını ekle.
6. Pilot yayın, mutabakat ve kademeli açılış yap.

Bu sıra, finansal ve güvenlik risklerini arayüz geliştirmesinden önce kapatır.
