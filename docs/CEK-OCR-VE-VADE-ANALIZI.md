# Çek/senet görüntü okuma ve vade analizi

## Görüntüden form doldurma

Çek/Senet ekranında “Çek/Senet Al” veya “Çek/Senet Ver” formunu açın. “Çek/senet görüntüsünden yapay zekâ ile doldur” bölümünden en çok 6 MB JPEG/PNG/WebP ön yüz görüntüsü seçin. Yerel görüntü önizlemesi gösterilir; “Görseli oku” mevcut tenant AI sağlayıcısına gönderir. “Mevcut form alanlarını bu öneriyle doldur” yalnız formu değiştirir, evrak/cari kaydı oluşturmaz. Bu seçenek mevcut form alanlarını değiştirir; portföy numarası, işlem tarihi, yön ve cari seçimi korunur.

Çek numarası, banka, şube, hesap numarası, keşideci/borçlu, keşide yeri, tarih, tutar ve döviz önerilir. Belirsiz tarih, tutar veya döviz tahmin edilmez; boş bırakılanları elle tamamlayın. Dövizli belgede kur ayrıca girilmelidir. Çek/senet üzerindeki tarihin sistemde vade olarak kullanılmasını kullanıcı doğrular. Görüntüyle form bilgilerini karşılaştırdığınızı belirten kutucuk işaretlenmeden kaydetme düğmesi açılmaz; ilgili alan değişince onay sıfırlanır.

Rakamla tutar ile modelin yazıyla tutardan çıkardığı sayısal değer farklıysa tutar boş bırakılır. Her iki okuma aynı modelden geldiği için bu denetim bağımsız bir tutar doğrulaması veya sahtecilik tespiti değildir. Model güven skoru kalibre edilmiş doğruluk garantisi değildir. Bilinmeyen belge türü forma aktarılamaz. OCR çekin gerçekliğini, hukuki geçerliliğini veya tahsil edilebilirliğini doğrulamaz.

`POST /ai/cek/oku` mevcut muhasebe/yönetici rol kapısını, tenant sağlayıcı seçimini, tarama özelliği/kota/bütçe ve dış sağlayıcı aktarım onayını kullanır. Görselin MIME imzası ve piksel/boyut sınırı sağlayıcı çağrısından önce denetlenir. Gerçek, görsel okuyabilen model gereklidir; mock sağlayıcı ile çek bilgisi uydurulmaz. Çıktı Zod ile doğrulanır. OCR denetim kaydı kullanıcı, sağlayıcı/model, dosya boyutu, süre ve başarı/hata metadata'sını tutar; görüntü ve çıkarılan çek/hesap bilgilerini tutmaz. Sağlayıcının kendi veri saklama politikası ayrı değerlendirilmelidir.

Bu okuma görüntüyü MinIO evrak eki olarak kalıcı saklamaz; mevcut ön/arka yüz ekleme akışı ayrıca kullanılabilir. PDF ve serbest metin bu çek okuma ucunda desteklenmez. Canlı model doğruluğu sentetik testlerden çıkarılamaz; kullanılacak modelle gerçek belge örnekleri üzerinde ayrıca pilot yapılmalıdır.

## Vade analizi

Çek/Senet ekranındaki vade tablosu alınan ve verilen açık evrakları ayrı gösterir: vadesi geçmiş, bugün, 1–7 gün, 8–30 gün, 31–90 gün, 90 günden sonra. Aralıklar çakışmaz. Her döviz ayrı ve Decimal ile toplanır; güncel kurdan varsayımsal TL veya net nakit hesabı yapılmaz. Tablo üstteki liste filtrelerinden bağımsız olarak tenant'ın tüm açık çek ve senetlerini kapsar.

Tutar/adet düğmesine tıklamak, ilgili yön ve tarih aralığında **yalnız açık evrakları** listeler. Filtre açıkken açıklaması görünür; “Analiz filtresini kaldır” ile temizlenir. Elle durum filtresi seçilirse açık evrak filtresi bırakılır. “Analizi yenile” yeniden okur; evrak listesi değişince analiz de tazelenir.

`GET /kasa-banka/cek-senet-vade-analizi` muhasebe/yönetici rolü ve `tenantIslem`/RLS ile korunur. `portfoyde`, `tahsile_verildi`, `teminata_verildi`, `verildi` durumları açık sayılır. Ciro/tahsil/ödeme/iade/karşılıksız evrak bu tabloya katılmaz. Banka/teminat vadeleri nakit girişi garantisi değildir. İstanbul iş günü UTC DATE başlangıcıyla karşılaştırılır; mevcut KPI vade özeti de aynı güne hizalanmıştır. Analiz sayısaldır, model yorumu içermez.

Hatırlatma günleri mevcut şirket ayarlarından seçilir; ayrıntılar `CEK-SENET-HATIRLATMA-AYARLARI.md` belgesindedir. Yeni tablo/migration gerekmez.

## Kontroller

- OCR çıktı/doğrulama, yanlış dosya, mock sağlayıcı, aktarım kapısı, audit ve otomatik kayıt olmaması: ilgili OCR birim testleri.
- Vade sınırları, açık/kapalı durum, büyük tutarlar, döviz/yön ayrımı: vade analizi birim testleri.
- Gerçek PostgreSQL: vade analizi/liste tutarlılığı, İstanbul gece yarısı, iki tenant izolasyonu, OCR metadata kaydı ve evrak sayısının değişmemesi. Test fixture'ları rollback edilir; gerçek model çağrısı yoktur.
- Tarayıcı: form doldurma, onay olmadan kaydın engellenmesi, alan değişince yeniden onay, açık vade filtresi ve mobil taşma kontrolü; ağ yanıtları sentetiktir.
