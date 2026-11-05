# Kayıtlı ek hacmi ölçümü

Güncel durum: [katalog depolama kotası](PLATFORM-DEPOLAMA-KOTASI-2026-11-04.md) ayrıca tamamlandı. Aşağıdaki kota uygulanmadığına ilişkin ifadeler bu ölçüm/rezervasyon tesliminin önceki aşamasını anlatır.

PK-04 depolama kotası hazırlığı için firma detayına kayıtlı eklerin sayısı, bayt toplamı ve kayıt türü dağılımı eklendi. Ölçüm kaynağı yalnız `ekler.boyut` değeridir; fiziksel nesne deposu envanteri, yedekler, günlükler ve kayıtsız nesneler kapsanmaz. Dosya silinince kayıt toplamdan düşer; fiziksel nesnenin silinmesindeki gecikme ölçümü değiştirmez. Ölçüm dönemsel sıfırlanmaz; mevcut kayıtların anlık hacmidir.

Toplamlar SQL'de bigint/numeric hassasiyetinde hesaplanır ve API'de metin olarak döner. Arayüz bayt değerini tam gösterir; MiB gösterimi BigInt ile aşağı yuvarlanır. Yalnız aktif, kurulumu tamamlanmış platform yöneticisi okuyabilir; uygulama rolü işlevi çalıştıramaz. Dosya adları ve depo anahtarları döndürülmez.

Temiz geçici PostgreSQL kabulü geçti: boş firma, tür dağılımı, başka firmanın dışlanması, 32 bit sınırını aşan toplam, silme sonrası düşüş, uygulama rolünün reddi, bulunamayan firma ve pasif yöneticinin reddi doğrulandı. API ve web tam tür kontrolleri geçti. Geçici veritabanı kaldırıldı; çalışan ortama migration uygulanmadı.

Bu teslim kota uygulamaz ve ek ücret oluşturmaz. Depolama sınırını kataloğa ekleme, yükleme sırasında kapasite ayırma, eşzamanlı yükleme sınırı ve başarısız yüklemede rezervasyonun bırakılması sonraki iştir. Ayrı şube modeli bulunmadığından depo kayıtları şube sayısı olarak kabul edilmedi.
