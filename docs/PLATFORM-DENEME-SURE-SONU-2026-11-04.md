# Deneme süresi sonu ve ücretli geçiş

Deneme aboneliğinin mevcut `donemSonu` alanı bitiş sınırıdır. Tam bitiş anında API yazımları ve abonelik denetimi kullanan otomasyonlar durur; görüntüleme, dışa aktarma ve ödeme yolları açık kalır. Erişim önbelleği deneme bitişini aşmaz. Durum zamanlayıcıyla değiştirilmez; `deneme` olarak kalır ve erişim tarihten hesaplanır.

Firma deneme kaydını iptal/yeniden etkinleştir ile ücretli duruma geçiremez. Başarılı sağlayıcı ödemesi veya platformun manuel ödeme kaydı denemeyi `aktif` yapar. Deneme sürüyorsa ücretli dönem mevcut bitişten, bitmişse ödeme anından başlar. Gecikmiş deneme günleri satın alınan süreden düşülmez. Aynı ödeme tekrarı ikinci kez dönem uzatmaz. Paket koşulları değişmez.

Bitişi boş tarihsel kayıtlara varsayılan süre atanmaz; otomatik kısıt uygulanmaz. Paket kataloğunda sürüm başına 0–365 gün deneme tanımlanır; 0 denemeyi kapatır. Değer yalnız taslakta değişir, yayımlanan sürümde korunur. Yeni firma kaydı seçtiği açık satış sürümünün gün sayısını alır; deneme açıksa başlangıç ve bitiş zamanı aboneliğe yazılır. Bu ayar var olan firmaları veya kampanya katılımını değiştirmez.

Göçler: `20261104290000_deneme_sure_sonu` ve `20261104300000_paket_deneme_gun_sayisi`. Mevcut ortama uygulanmadı; çalışan API/worker/web yeniden başlatılmadı. Kabul yalnız tek kullanımlık PostgreSQL ortamında yapılır.

## Doğrulama

Erişim, abonelik hizmeti ve guard: 24 birim testi geçti. Bağımsız deneme ödeme kabulü: 3 gerçek PostgreSQL testi geçti (süresi geçmiş deneme, erken ödeme, manuel ödeme ve tekrar koruması). Tüm migration zinciri geçici ortamda uygulandı ve ortam kaldırıldı. API/web TypeScript ve `git diff --check` geçti.

5 Kasım regresyon kapanışı: fiyat fotoğrafı kabulü gerçek katalog yayını, kapsam önizlemesi ve yönetici onayıyla paket değiştirir. Geniş ödeme dosyasındaki 18 test; iade, rapor ve deneme dosyalarıyla birlikte 33 PostgreSQL kabulü geçti. Eski doğrudan paket değiştirme hazırlığı ve ona bağlı başarısızlıklar kapandı. Yeni kayıt kabulü ayrıca sıfır günün denemeyi kapattığını, 14 günlük sürenin yeni firmaya uygulandığını, eski firmanın korunmasını, yayın değişmezliğini ve taslak kopyalamayı doğrular.

Manuel ödeme fonksiyonundaki yerel dönem sonu değişkeni `timestamp(3)` kullanır; ilk yanıt ile kaydedilmiş tekrar yanıtı aynı tarih hassasiyetindedir.

Deneme süresi düzenlemesinde alanı göndermeyen eski istemci mevcut değeri korur. Katalog detay ekranı deneme gününü API’ye gönderir; yayın önizlemesi ve sürüm geçmişi süreyi gösterir. Tarayıcı kabulü etiket bağlantısını ve 14 günlük değerin gönderimini denetler.
