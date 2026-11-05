# Kontrollü kapsam ataması ve atomik kota

Katalogdaki modül/kota sözleşmesi artık aynı plandaki aboneliklere açık kapsam onayıyla atanabilir. Bu teslim kaynak kod ve izole kabul kapsamındadır; çalışan yerel uygulamaya yayın veya mevcut veritabanına migration uygulanmadı.

## Atama sözleşmesi

Fiyat etkisi ekranında kapsamlı hedef seçildiğinde ayrı kapsam akışı açılır. Firma başına açılacak/kapanacak modüller, mevcut kullanım, eski/hedef limitler ve dört dönem fiyat farkı gösterilir. Önizleme aboneliği değiştirmez. Onay, bugünkü tek işlem veya mevcut planlama altyapısıyla ileri tarih/dönem sonu için kaydedilir. Kapsamı olan hedefe eski yalnız fiyat isteği gönderilmesi DB seviyesinde reddedilir.

Onaylı hedef koşulları abonelikte şema 2 olarak saklanır; modüller ve kotalar bu değiştirilemez fotoğraftan okunur. Üst seviye limitler kapsam sınırlarıyla aynı olmak zorundadır. Katalog yayını kendiliğinden müşteri koşulunu değiştirmez. Eski şema 1 aboneliklerin modül erişimi korunur; yeni atomik sınırlar yalnız açık kapsam atamasından sonra uygulanır.

Önizleme mevcut kullanımın altına inen kotayı reddeder. Onayda yetki, hedef sürüm ve kaynak abonelik tekrar doğrulanır. Kullanımı etkileyen her başarılı kaynak yazımı `kota_surumu` değerini değiştirir; önizlemeden sonra kullanım değişmişse yeniden önizleme gerekir. Planlı kapsam geçişinde de değişen kullanım planı incelemeye düşürür; otomatik olarak farklı bir etki kabul edilmez. Yalnız fiyat planları bu teknik kullanım sürümü değişiminden etkilenmez. Mevcut dönem, plan kodu ve başlamış ödemelerin fiyat fotoğrafları korunur; ara dönem ücret farkı tahsil edilmez. Kapsamlı aboneliğin eski plan değiştirme yolu ile kapsamı sıfırlaması engellenir.

## Erişim

API her istekte güncel bağlı sözleşmeyi okur; kapsam önbelleğe alınmaz. GET, yazma ve salt okuma etiketli uçlar aynı modül sınırına tabidir. Panel menü/sayfa denetimi aynı ortak yol matrisini kullanır; kullanıcı rolü ve özel rol sınırları ayrıca uygulanır. Yönetici rolü paket sınırını aşmaz. Hesap/abonelik ayarları ve ortak kontrol uçları açık kalır. Panel oturum bilgisi yenilemesinde menü güncellenir; API değişikliği sonraki istekte uygular.

Asistan araçları bağlamdaki modüllerle süzülür; çağrı öncesi güncel sözleşme yeniden okunur. MCP geçerli anahtarla da yapay zekâ modülü kapalıysa reddedilir. Satışa bağlı AI uçları ile cari/e-belge içindeki açık AI uçları hem sahip modülü hem yapay zekâyı gerektirir. Ek dosyanın sahip modülü denetlenerek ortak ek yolu üzerinden erişim engeli aşılmaz. Self servis personel, bayi ekranları satış modülüne bağlıdır. Mevcut veri yazan/maliyet doğuran otomasyon kapıları ilgili modülleri de denetler; kapsam okunamazsa modül denetimli iş durur. Önceden başlamış mali işlemlerin sonuçlarını kaydeden geri çağrılar ayrı mevcut akışını korur.

## Atomik kota

Kullanıcı, aktif cari, aktif stok kartı ve aylık oluşturulan fatura için PostgreSQL BEFORE trigger'ı kapasite artışını denetler. Ekleme, toplu/iç servis/entegrasyon yazımı, kopya, yeniden etkinleştirme ve kullanıcı rol değişimi aynı korumadan geçer. Kullanım azaltma, pasife alma ve silme de kullanım sürümünü değiştirir. Kullanıcı sayımında çalışan self servis rolü hariç tutulur.

Abonelik satırının gerçek yazımı ortak kilittir: READ COMMITTED işlemler sırayla güncel sayımı görür; REPEATABLE READ eski görünümle kotayı aşmak yerine serialization hatasıyla geri alınır. API bu yeniden deneme durumunu 503 ve Retry-After olarak sunar. Kota doluluğu 400, kapalı modül yazımı 403 döner; SQL ayrıntısı istemciye verilmez. Kiracı rolü için bağlam doğrulanır; ölçüm fonksiyonuna doğrudan erişim verilmez.

Fatura sayımı oluşturma zamanının Türkiye takvim ayına göredir; taslak ve iptal sayılır. İptal hakkı boşaltmaz; belge tarihi sayımı değiştirmez. Null sınırsız, sıfır ilk kaydı engeller. Abonelik ekranı kayıtlı uyarı yüzdesini kullanır ve dolu kotayı açıkça gösterir. Bu teslim aşım bedeli veya ücretli taşma üretmez.

## Doğrulama ve kalanlar

Gerçek PostgreSQL'de yeni kapsam/kota senaryoları ve önceki katalog/atama kabulleri birlikte çalıştırıldı. Eşzamanlı son yer, Repeatable Read, toplu geri alma, yeniden etkinleştirme, rol değişimi, fatura iptali, sıfır/sınırsız, kiracı yalıtımı, kullanım değişen planın engellenmesi ve worker uygulaması sınandı. Eski aboneliklerin migration öncesi/sonrası alanları ve dört dönem fiyat toplamları ayrıca korundu.

260 benzersiz API, 41 ortak ve 8 web birim testi; 82 PostgreSQL kabulü ve 23 benzersiz Playwright senaryosu geçti. PostgreSQL kabulleri altı dosyayla tek koşuda tamamlandı. Migration öncesi/sonrası koruma provası ayrıca geçti. Tarayıcı ilk koşusunda 22 senaryo geçti; yeni kapsam testindeki iki bildirime birden eşleşen seçici düzeltildikten sonra o senaryo yeniden geçerek 23'e tamamlandı. Tarayıcı API yanıtları taklittir; veritabanı güvenceleri gerçek PostgreSQL'de sınandı. API ve web TypeScript, ortak paket derleme ve değişen kaynakların ESLint kontrolleri temizdir. Web tip kontrolü test sunucusu kapandıktan sonra çalıştırıldı. Geçici veritabanı ve test sunucusu kapatıldı.

Şube, depolama, diğer belge türleri ve yapay zekâ harcaması için ölçüm/yenileme/aşım sözleşmeleri; firma istisnaları, yeni satış ve paketler arası ticari geçiş devam eder. PK-04 ve T3 bütünü tamamlandı sayılmaz.
