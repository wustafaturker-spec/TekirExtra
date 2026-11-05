# Satış ve satın alma form yerleşimi — 5 Kasım 2026

Durum: ortak form düzeltmesi yerel web pilotunda yayınlandı.

1280 piksel masaüstünde satış faturası, satış teklifi ve alış siparişinin açılmış ek bölümlerinde taşma doğrulandı. Formun gerçek iç genişliği 596 px iken dört sütunlu alan ızgarası 758 px istiyordu. Son sütun sağdaki yapışkan özetin altına giriyordu; sayfanın toplam genişliği değişmediği için yalnız sayfa yatay taşmasını denetlemek hatayı bulmuyordu. Etkilenen örnekler Talep Tarihi, İDİS sevkiyat numarası, Teslim Şekli ve İlgili Kişinin Görevi alanlarıdır.

`invoice-layout__main` adlı form alanı genişlik kapsayıcısı yapıldı. Alanlar kullanılabilir genişlik 850 px ve altına indiğinde iki, 520 px ve altına indiğinde tek sütuna geçer. Cari seçimi dar formda tam satır olur; geniş alanlar tek sütunda fazladan örtük sütun üretmez. Grid çocukları ve giriş/seçim kontrollerinin minimum genişlikleri içerik sığmasını engellemez. Satış/satın alma özet sayfalarında denetlenen genişliklerde taşma görülmedi; bu sayfaların düzeni değiştirilmedi.

## Doğrulama

İlk inceleme: satış/satın alma özetleri, satış/alış faturası, satış teklifi ve alış siparişi olmak üzere altı ekranda beş genişlik, toplam 30 kontrol. Üç ekranın açılmış bölümlerinde beş grid taşması kaydedildi. Önerilen düzeltmeyle aynı 30 kontrolde taşma ve script hatası sıfırlandı; önce/sonra görselleri de incelendi.

Son canlı kontrol yayınlanan üretim dosyalarıyla, geçici CSS eklenmeden yapıldı:

- Satış ve satın alma özetleri; iki yönde fatura, teklif, sipariş ve irsaliye: 10 ekran.
- 390, 768, 1024, 1101, 1280, 1366, 1440 ve 1920 px: 8 genişlik.
- 80 kontrolün tamamında sayfa taşması, form alanlarının kapsayıcı dışına çıkması ve tarayıcı script hatası yok.
- Katlanır form bölümleri açıldı; kontroller örnek API yanıtlarıyla yürütüldü. Gerçek iş verisi okunmadı veya yazılmadı.
- Web üretim derlemesi ve tür kontrolü geçti; kaynak diff kontrolü temiz.

## Pilot yayını

Yalnız web servisi güncellendi. API, genel worker ve söz hatırlatma worker'ının başlangıç zamanları korunur. Dört servis sağlıklı; migration veya veritabanı işlemi yapılmadı. Oturum işareti anahtarı korundu.

Web build: `2CvVCjqH9QU1o-kp28nKo`.

Paket, kaynak CSS hash'i, inceleme sonuçları, görseller ve işletim yardımcıları `.release-candidates/satis-satin-alma-yerlesim-20261105` dizinindedir. Önceki web compose yapılandırması `geri-donus-compose.json` olarak saklanır. Gerektiğinde yalnız web sürümünü geri almak için:

```sh
python3 .release-candidates/satis-satin-alma-yerlesim-20261105/web-yayin.py geri-don
```

Çalışma alanındaki bağımsız tünel/package.json değişiklikleri bu düzeltmeye alınmadı.
