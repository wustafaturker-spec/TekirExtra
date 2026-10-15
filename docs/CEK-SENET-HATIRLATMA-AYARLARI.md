# Çek/senet hatırlatma ayarları

Yönetici **Ayarlar → Modüller → Kasa & Banka** ekranından şirket genelindeki hatırlatma süresini seçer:

- `cekSenetHatirlatmaGun`: 1–90 gün; 0 vade öncesi hatırlatmayı kapatır. Varsayılan 7.
- `cekSenetVadeGunuHatirlat`: vade günü hatırlatması; bağımsız açılır/kapatılır. Varsayılan açık.

Ayarlar kişiye özel değildir; mevcut modül ayarları ve yönetici yazma yetkisi kullanılır. Bildirim alıcıları yönetici/muhasebe rolleridir; uygulama içi ve e-posta teslimatı mevcut bildirim tercihlerine bağlıdır. Yeni bir SMS/WhatsApp veya e-posta gönderim sistemi eklenmemiştir.

Vade öncesi tarama, belge vadesine tam seçilen gün sayısı kaldığında çalışır. Bugün vadeli evraklar ve vadesi geçmiş evraklar ayrı günlük özetlerdir. Her gün/kategori için tek birleştirme anahtarı kullanılır; aynı gün tekrarlanan worker taraması aynı bildirimi ve mevcut teslimatı tekrar oluşturmaz. Vadesi geçmiş evrak uyarısı, iki seçenek kapalı olsa bile korunur. Yeni evraklar mevcut günlük özette sayıya eklenir; her evrak için ayrı mesaj gönderilmez.

Yalnız sonuçlanmamış `portfoyde`, `tahsile_verildi`, `teminata_verildi`, `verildi` durumları taranır. Tahsil/ödeme/ciro/iade sonrası evrak hatırlatma sayısına katılmaz. Karşılaştırmada İstanbul iş günü ve PostgreSQL DATE alanının UTC gün başlangıcı kullanılır; gecikmiş evraklar “önümüzdeki günlerde vadeli” sayılmaz.

Otomatik tarama mevcut `TEKIR_WORKER=1` bildirim worker'ına bağlıdır (normalde beş dakikalık tarama). Tam saat teslim garantisi ve worker'ın çalışmadığı geçmiş günler için telafi gönderimi bu aşamanın kapsamı değildir. Kaydedilmiş eski ayarlar yeni varsayılanlarla okunur; tablo/migration gerekmez. Bu değişiklik çek görüntüsünden OCR veya ek vade analizi ekranı içermez; onlar ayrı geliştirme aşamalarıdır.
