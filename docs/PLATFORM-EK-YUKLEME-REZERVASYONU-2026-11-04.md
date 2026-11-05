# Ek yükleme rezervasyonu

Güncel durum: [katalog depolama kotası](PLATFORM-DEPOLAMA-KOTASI-2026-11-04.md) ayrıca tamamlandı. Aşağıdaki kota uygulanmadığına ilişkin ifadeler bu ölçüm/rezervasyon tesliminin önceki aşamasını anlatır.

Ortak `EklerService.yukle` dosya boyutunu gerçek buffer uzunluğuyla karşılaştırır; kiracı/sahip doğrulamasından sonra 15 dakikalık bayt rezervasyonu oluşturur. Nesne deposuna yazım açık veritabanı transaction'ı dışında yapılır. Sahip ikinci kez doğrulanır; ek kaydı ve rezervasyonun tamamlanması tek transaction'da yazılır. Süresi dolmuş rezervasyon tamamlanamaz.

Hata durumunda önce metadata sonucu denetlenir. Commit başarılı olmuş ama yanıt kaybolmuşsa kayıtlı nesne silinmez, mevcut ek döndürülür. Metadata bulunmadığı doğrulanırsa rezervasyon iptal edilir ve nesne için silme denenir. DB sonucu doğrulanamıyorsa dosya güvenli tarafta kalacak şekilde korunur; rezervasyon süresi sonunda aktif ölçümden düşer. Temizlik hatası ilk hatayı değiştirmez. Nesne deposunda kalabilen sahipsiz dosyaların fiziksel envanteri bu teslimin kapsamı değildir.

İşlevler yalnız uygulama rolüne açıktır ve kiracı bağlamı zorunludur. Tabloya doğrudan erişim verilmez. Aynı kiracının rezervasyon işlemleri transaction advisory kilidiyle sıralanır. Firma ek hacmi ekranı tamamlanmış dosya hacminden ayrı olarak yalnız süresi dolmamış, açık rezervasyon sayısı ve baytını gösterir.

Dört PostgreSQL kabul senaryosu geçti: başarı/depo hatası, metadata rollback/nesne temizliği, kaybolan commit yanıtı, rezervasyon süresi ve kiracı sınırı; mevcut ek hacmi ölçümü de doğrulandı. MIME doğrulaması bu testte taklittir; nesne deposu bellek adaptörüdür, metadata ve rezervasyon gerçek geçici PostgreSQL'dedir. API ve web tam tür kontrolleri geçti.

Henüz depolama sınırı uygulanmaz; `kotaUygulaniyor: false` korunur. Sonraki adım depolama limitini katalog ve firma istisnası sözleşmesine eklemek; toplam kayıtlı bayt ile aktif rezervasyonları aynı kilit altında denetlemek ve başarısız/sona ermiş rezervasyonların kapasite tüketmediğini eşzamanlı kabulde doğrulamaktır. Çalışan ortama migration uygulanmadı.
