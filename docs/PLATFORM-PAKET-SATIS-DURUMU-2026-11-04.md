# Katalogda ayrı satış durumu

PK-01'in satışa açıklık bölümü eklendi. Paket, yayın geçmişinden bağımsız tek bir satış sürümü seçimi taşır. Mevcut ve yeni paketler satışa kapalı başlar; sürüm yayınlamak seçimi değiştirmez. Kayıt ekranı da artık seçilmiş açık sürümleri sunar ve seçilen sürümün fiyat/kapsam koşullarını abonelikte saklar. Çalışan yerel uygulamaya yayın veya mevcut veritabanına migration uygulanmadı.

## Yönetim davranışı

Paket detayında satış durumu ve seçili sürüm görünür. Yönetici, yayın geçmişinin açık sayfasındaki bir sürümü seçip gerekçe girer. Ayrı onay bölümünde hedef fiyat ve modül/kota sözleşmesi gösterilir; vazgeçmek yazma isteği göndermez. Satışı durdurmak da gerekçe ve ayrı onay gerektirir. Bu işlem mevcut abonelik, dönem, erişim veya ödeme fotoğraflarını değiştirmez. Katalog listesi son sürümün yayın durumuyla satış durumunu ayrı gösterir.

Satışa açılacak sürüm aynı pakete ait, yayınlanmış, fiyat ve kapsam sözleşmesi tanımlı olmalı; fiyatın Türkiye geçerlilik günü gelmiş olmalıdır. Taslak, arşiv, başka paketin sürümü, eksik sözleşme ve gelecekte geçerli fiyat reddedilir. Satış seçimi için ayrı revizyon tutulur; hedef sürümün revizyonu da onayda doğrulanır. Çakışmada kullanıcı gerekçesi korunur, eski onay kapatılır ve yeni revizyon incelenir. Otomatik olarak son yayına geçilmez.

Satışa açık seçili sürüm, önce satış durdurulmadan veya hedef değiştirilmeden arşivlenemez. Durdurma hedef sürüm bağlantısını geçmiş bilgisi olarak korur; bu sürüm sonradan arşivlenebilir. Arşivlenen sürüm yeniden satışa açılamaz. Aynı güncel durumun yeniden seçilmesi revizyon veya geçmiş kaydı üretmez; eski revizyonla yeniden gönderim 409 gerektirir ve ikinci değişiklik oluşturmaz.

## Veritabanı ve yetki

`platform_paketler` satışa açıklık, seçili sürüm ve satış revizyonunu taşır. Başlangıç değerleri kapalı/null/1'dir. Paket eklerken bu başlangıç durumu DB'de zorunludur. Platform rolüne paket satış sütunlarını doğrudan güncelleme yetkisi verilmez. Yalnız dar `platform_paket_satis_degistir` işlevi aktif, davet kurulumu tamamlanmış yöneticiyi yeniden doğrulayarak yazar. Kullanıcı yetkisi ve paket kilitleri mevcut katalog kilit sırasını kullanır.

Satış/arşiv işlemleri paket advisory kilidini, satış onayı ayrıca kaynak ve hedef satır kilitlerini kullanır. Böylece iki yönetici aynı revizyonu tüketemez; satışa açma/arşivleme yarışında açık satışın hedefi arşiv olamaz. REPEATABLE READ işlemlerinde eski yayın/satış görünümüyle geçiş yapılması serialization hatasıyla geri alınır. Katalog sürümü arşiv kontrolü SQL doğrudan yazımında da uygulanır.

`platform_paket_satis_gecmisi` başarılı durum değişimini aynı transaction'da önceki/yeni durum, hedef fiyat/kapsam fotoğrafı, yönetici ve gerekçeyle kaydeder. Platform rolü bu tabloyu yalnız okuyabilir; kiracı rolü okuyamaz/yazamaz. Genel platform denetim olayına da bağlantı yazılır. Geçmiş ayrı sayfalanır; boş sayfa toplamı kaybetmez, `satisSayfa` URL'de sürüm sayfası ve dönüş filtresinden bağımsız korunur.

## Doğrulama

57 API birim testi geçti; 14'ü yeni satış sözleşmesi/yetki/hata çevirisi kabulüdür. Yeni 15 satış DB senaryosu ve önceki 82 katalog/bağ/atama/kapsam/kota senaryosu, tüm migration'lar temiz geçici PostgreSQL'e uygulanarak tek koşuda geçti (97 toplam). Aktif/pasif yönetici, doğrudan yazma sınırları, eksik/future fiyat, yanlış sürüm, aynı durumun tekrarı, eski revizyon, satış/arşiv yarışı, iki eşzamanlı yönetici ve iki REPEATABLE READ senaryosu kapsandı. Eski abonelik verisi ve fiyatlarının migration öncesi/sonrası korunma provası ayrıca geçti.

İzole 3112 Next test sunucusunda 27 Playwright senaryosu tek koşuda geçti (3,1 dakika). Dört yeni senaryo ayrı önizleme/onay ve vazgeçme, gerekçeli durdurma, çakışmada alanları koruyup yeni revizyonla onay ve satış geçmişinde URL/boş sayfa toplamını doğruladı. Önceki 23 katalog/fiyat/kapsam/planlama senaryosunda regresyon yok. Tarayıcı API'si taklittir; DB güvenceleri yukarıdaki gerçek PostgreSQL kabullerinde sınandı. Prisma doğrulaması/istemci üretimi, API/web TypeScript ve değişen kaynakların ESLint kontrolleri temizdir. Web tip kontrolü tarayıcı sunucusu kapandıktan sonra geçti. Geçici PostgreSQL ve test sunucusu kapatıldı.

## Kalan işler

Kayıt bağlantısı için `tenant/kayit/paketler` yalnız açık ve tarihi gelmiş satış sürümlerini döndürür. Katalog paket kodu aboneliğin plan kodu olur; seçilen sürümün fiyat/kapsam fotoğrafı kayıt, erişim özeti, ödeme ve dönem hatırlatma bağlantılarında korunur. Kayıt sırasında abonelik tetikleyicisi sürümü ve koşulları tekrar doğrular; değişiklikte kayıt reddedilir. Mevcut aboneler için farklı katalog paketine kapsamlı geçiş de eklendi: kaynak koşulları ve hedef sürüm önizlenir, onayda plan kodu/kapsam/fiyat birlikte değişir, mevcut dönem tarihi ve başlamış ödeme fotoğrafları korunur. Anında ve dönem sonunda uygulama, iki yeni PostgreSQL kabul senaryosuyla temiz geçici veritabanında doğrulandı; hatırlatma ödeme bağlantısı için 6 birim testi geçti. Firma bazlı istisnalar, diğer kota türleri, API tam tür kontrolü ve T3/gerçek ortam pilotu açık kalır. API tür kontrolü bellek sınırları içinde tamamlanamadı; web tür kontrolü geçti.
