# Firma paneli arayüz denetimi

18 Kasım 2026

Bu tarama, firma panelinde günlük kullanılan fatura, cari, stok, e-Belge ve yönetim akışlarına odaklanır. Bulgular mevcut mobil Chromium referans görüntüleri ve güncel kaynak kod üzerinden değerlendirildi. Canlı pilot oturumu, gerçek kayıt yazımı ve tüm panel rotalarının tarayıcı testi bu incelemenin kapsamında değildi.

## Öncelik 1 — İşlem veya karar hatasına açık ekranlar

| Ekran | Bulgu ve etkisi | Düzeltme ve kabul ölçütü |
|---|---|---|
| Stok kartı · Fiyat ve endeks | Filtre geçersiz hale geldiğinde sorgu duruyor ve önceki karşılaştırma ekranda kalabiliyor. Ters tarih aralığında da fiyat listesi uyarısı çıkabiliyor. Grafik, aylık veriler ve dışa aktarma yanlış filtreyle ilişkilendirilebilir. | Görünür sonucu geçerli sorguya bağlayın. Geçersiz tarihte tarih uyarısı verin. Endeks, liste ve tarih değiştirildiğinde eski sonuç ve CSV işlemi görünmemeli. [Karşılaştırma bileşeni](../apps/web/src/components/fiyat-endeks-sekmesi.tsx#L99) |
| e-Belge Operasyonları | Sayaçlar sıfırla başlıyor. İlk istek başarısız olursa hata ile birlikte sıfır sayaçlar ve boş liste mesajı gösterilebiliyor. Otomatik yenileme başarılı olsa bile önceki hata mesajı kalabiliyor. | İlk yüklemeyi, erişilemeyen kuyruğu, son başarılı veriyi ve gerçek boş kuyruğu ayrı gösterin. Otomatik yenileme toparlandığında eski hata kalkmalı. [Kuyruk ekranı](../apps/web/src/app/panel/ebelge/kuyruk/page.tsx#L38) |
| Onay Kuralları | İlk liste isteği başarısız olunca veri boş kalıyor. Ekran hata ile birlikte “Yükleniyor…” göstermeye devam edebiliyor. Silme işlemi yerleşik tarayıcı onayı kullanıyor. | Liste hatasında “Tekrar dene” gösterin. Silme onayında kural adını ve açık taleplere etkisini uygulama içinde gösterin. İlk istek 503 döndüğünde yükleme göstergesi kapanmalı. [Onay kuralları](../apps/web/src/app/panel/ayarlar/onay-kurallari/page.tsx#L153) |

## Öncelik 2 — Günlük kullanımda yüksek sürtünme

| Ekran | Bulgu ve etkisi | Düzeltme ve kabul ölçütü |
|---|---|---|
| Cari Hesaplar | Mobil referans görüntüsünde başlık işlemleri, sayaçlar ve uzun filtre bloğu listenin önünde. Kullanıcı cari aramaya ve kayda ulaşmak için birkaç bölüm geçiyor. | Arama, temel filtreler ve “Yeni Cari”yi liste başında tutun. Diğer işlemleri gruplayın, gelişmiş filtreleri gerektiğinde açın. 390 pikselde arama ve ilk kayıt kaydırmadan veya kısa bir kaydırmayla erişilebilir olmalı. [Cari ekranı](../apps/web/src/app/panel/cari/page.tsx#L1045) · [Mobil referans](../apps/web/e2e/responsive-layouts.spec.ts-snapshots/cari-listesi-veri-dolu-mobil-linux.png) |
| Stok Kartları | Başlıktaki analiz, denetim, maliyet ve içe aktarma düğmeleri ürün aramasından önce yer kaplıyor. Mobil referansta ürün tablosunun sağ tarafı ekran dışında kalıyor. | Arama ve “Yeni Ürün/Hizmet”i öne alın. Yönetim işlemlerini gruplayın. Dar ekranda ürün adı, kod, tip ve kaydı açma işlemi yatay kaydırma gerektirmemeli. [Stok ekranı](../apps/web/src/app/panel/stok/page.tsx#L187) · [Mobil referans](../apps/web/e2e/responsive-layouts.spec.ts-snapshots/stok-listesi-veri-dolu-mobil-linux.png) |
| Fatura oluşturma | Mevcut mobil referansta liste filtreleri ve özetler, açılan formun üzerinde kalıyor. Birden fazla kalemle çalışırken form, toplamlar ve kayıt işlemi arasında uzun kaydırma gerekiyor. | Mobil yeni fatura görünümünde önce formu gösterin. Kalem özeti ile taslak kaydetme işlemini kolay erişilen bir alanda tutun. 390 pikselde iki kalemli taslağın oluşturulması test edilmeli. [Fatura ekranı](../apps/web/src/app/panel/fatura/page.tsx) · [Mobil referans](../apps/web/e2e/responsive-layouts.spec.ts-snapshots/fatura-formu-doldurulmus-mobil-linux.png) |
| Maliyet yeniden hesaplama ve dağıtımı | Çok sayıda kartı ve hareketi etkileyebilen işlemlerin son onayı tarayıcının yerleşik penceresinde. Kullanıcı kapsamı ancak onay metninden okuyabiliyor. | Etkilenen kart ve hareket adetlerini, kaynak belgeyi ve işlemin yönünü gösteren uygulama içi onay kullanın. Vazgeçme ve onay davranışları ayrı ayrı sınanmalı. [Yeniden hesaplama](../apps/web/src/app/panel/stok/maliyet/page.tsx#L39) · [Dağıtım](../apps/web/src/app/panel/stok/maliyet-dagitimi/page.tsx#L64) |

Uygulama sırası **Fiyat ve Endeks → e-Belge Operasyonları → Onay Kuralları → Cari ve Stok listeleri → Fatura oluşturma → maliyet işlemleri**. İlk üç iş, görünümün yanlış ya da çelişkili durum bilgisi göstermesini önler.
