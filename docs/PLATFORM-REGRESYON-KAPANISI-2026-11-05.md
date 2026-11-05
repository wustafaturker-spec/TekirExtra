# Platform ve abonelik regresyon kapanışı — 5 Kasım 2026

Firma takibi/istatistikleri, paket kataloğu, kontrollü ve planlı atama, firma istisnaları, ek rezervasyonu/depolama kotası ve deneme süresi kaynakları birlikte commit kapsamına alındı. Bu kayıt uygulama ve izole kabul kapanışıdır; canlı pilot ve programın kalan duyuru işleri tamamlanmış sayılmaz.

Ödeme fiyat fotoğrafı kabulündeki doğrudan plan değişikliği gerçek katalog yayını, kapsam önizlemesi ve ayrı yönetici onayına taşındı. Tarihsel rapor hazırlıkları da aynı korumalı akışı kullanır. Eski talep onayı ve doğrudan plan değiştirme yollarının katalog korumasını aşamadığı doğrulanır; koruma gevşetilmedi.

Deneme süresi alanını göndermeyen eski istemci taslaktaki süreyi sıfırlamaz. Detay formu gün sayısını API'ye iletir; alanın etiketi girişe bağlıdır, yayın önizlemesi/geçmiş süreyi gösterir. Yeni firma kabulü 0 ve 14 günü, mevcut abonenin korunmasını, yayın değişmezliğini ve taslak kopyalama/düzenlemesini kapsar. Eski liste/satış tarayıcı hazırlıkları güncel sözleşmeye uyarlandı.

Doğrulama:

- API: 352 dosyada 3.124 birim testi geçti; yerel ağ testleri sandbox dışında, iki worker ile çalıştı.
- Ortak paket: 51 dosyada 381 test; web: 14 dosyada 168 test geçti.
- Birleşik PostgreSQL: 30 dosyada 228 kabul testi geçti. Platform, ödeme, iade, rapor, deneme, ek rezervasyonu ve depolama birlikte çalıştırıldı. Tüm migration zinciri tek kullanımlık PostgreSQL'e uygulandı; ortam kaldırıldı.
- Platform tarayıcıları: 104 benzersiz senaryo doğrulandı. İlk geniş koşuda 98 geçti; düzeltmelerden sonra ilgili üç dosyada 21 senaryo, son yönetim özeti senaryosu ayrıca geçti. API yanıtları tarayıcıda taklittir; veritabanı kabulleri gerçek PostgreSQL'dedir.
- API TypeScript kontrolü 4 GiB Node heap ile, web TypeScript kontrolü ve lint geçti. İlk eşzamanlı genel koşudaki heap/sandbox/zaman aşımı sorunları son kontrollerde giderildi.

Mevcut veritabanına migration uygulanmadı; çalışan uygulama yeniden başlatılmadı. Yerel geçici derlemeler, yama, tünel betiği ve kapsam dışındaki belgeler commit'e alınmadı.
