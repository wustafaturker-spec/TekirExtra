# Aynı planda kontrollü katalog fiyat ataması

PK-02/PK-08'in firma seçimi, kalıcı etki önizlemesi ve açık onayla uygulama ilk teslimidir. Uygulama tarihi Türkiye takviminde bugündür; ileri tarihli iş planlaması bu teslimde yoktur. Katalog sürümünü yayınlamak tek başına atama yapmaz.

Devam teslimi: [ileri tarihli ve dönem sonu plan, iptal ve worker uygulaması](PLATFORM-PLANLI-PAKET-ATAMASI-2026-11-04.md). Aşağıdaki açıklamalar ilk bugünkü atama tesliminin kapsamını kaydeder.

## Akış ve kapsam

Fiyat etkisi ekranında mevcut sayfadan en çok 25 firma seçilir. Neden ve uygulama tarihiyle `POST /platform/paketler/atama-onizle` çağrılır. Yöneticiye ait `platform_paket_atamalari` satırı hedef sürümü/revizyonunu, tam kaynak abonelik satırlarını, önerilen koşulları, nedeni, uygulama gününü ve 15 dakikalık son onay zamanını saklar. İstemciye gereksiz abonelik iletişim/meta alanları dönmez; firma, dönem bedelleri, farklar ve limitler döner. Önizleme abonelikleri değiştirmez.

Hedef yayınlanmış, fiyatlı, geçerlilik tarihi gelmiş ve mevcut eski planla eşleşen sürüm olmalıdır. Kaynak aktif veya deneme durumunda, kayıtlı bağı ve dönem fiyatları bulunan aynı plan aboneliği olmalıdır. v1 Profesyonel olarak eşlenir. Mevcut fiyat dönemlerinden herhangi birini kaldıran hedef reddedilir; aylık fiyatla eksik dönem tamamlanmaz. Kurumsalın fiyatsız eski koşulları, bilinmeyen/yeni eşlenmeyen paket, askı/iptal ve paketler arası geçiş bu yoldan atanmaz.

Onay ekranında seçili firmaların dört dönem matrah/KDV/toplam ve bedel farkları gösterilir. `POST /platform/paketler/atama-uygula` yalnız önizleme kimliği alır; istemci fiyat veya firma listesini onay sırasında değiştiremez. Aynı yönetici hesabının hâlâ aktif/yetkili olması, hedefin yayın/revizyonu, son onay zamanı ve uygulama günü tekrar doğrulanır. Kaynak aboneliklerin tamamı kararlı sırayla kilitlenir ve saklanan tam satırlarla karşılaştırılır. Bir firma bile değişmişse toplu işlem uygulanmaz ve yeni önizleme gerekir.

Başarı halinde yalnız `paket_surum_id`, `paket_kosullari` ve güncellenme zamanı değişir. Plan kodu, durum, mevcut dönem ve iptal tarihleri, iletişim, meta ve kayıtlı dört limit korunur. Koşulların kaynağı `katalog_atamasi` olur. Her firma için atama kimliği ve önce/sonra koşullarıyla denetim olayı aynı transaction içinde yazılır. Kaynak satır karşılaştırması ile hem değişen ödeme/dönem hem de eski bir önizlemenin sonradan uygulanması engellenir.

## Tekrar, yarış ve yetki

Aynı onayın tekrar veya eşzamanlı gönderimi `tekrar: true` ile ilk sonucu döndürür; ikinci güncelleme/denetim olayı oluşmaz. İki ayrı önizleme aynı kaynak için hazırlanmışsa yalnız ilk uygulama geçer; diğeri kaynak değişimi nedeniyle reddedilir. Geçerli atama daha sonra arşivlense veya önizleme süresi dolsa da yapılmış işlemin tekrar isteği yeni atama yapmadan ilk sonucu döndürür; güncel yönetici yetkisi yine zorunludur.

Uygulama rolünün atama tablosuna veya SQL işlevlerine erişimi yoktur. Platform rolü atama tablosunu doğrudan yazamaz; dar SECURITY DEFINER işlevleri kullanılır. Abonelik bağı trigger'ı yalnız aynı transaction'da uygulandı işareti yazılan, kaynak ve hedefi tam eşleşen atama kaydına izin verir. Özel oturum ayarıyla bağ koruması gevşetilmez. Başka doğrudan bağ/koşul değişiklikleri korunur. v1 ile Profesyonel kanonik kod dönüşümü aynı bağ/koşulları korur; sırf eski kod değiştiği için atanmış fiyat sıfırlanmaz.

İstemci ağ/5xx hatasında onay kimliğini korur ve aynı işlemi yeniden deneyebilir. 403/404/409 durumunda yeni önizleme istenir; seçim ve neden korunur. Vazgeçmek uygulama isteği göndermez. Başarı mesajı rapor yeniden yüklenirken korunur. Sayfa yenilemede açık istemci onay formu yeniden yüklenmez; eski kalıcı kayıt silinmez ve tekrar onaylama kendiliğinden gerçekleşmez.

## Ödeme ve yenileme

Yeni panel/e-posta/otomatik yenileme girişimleri ve yaklaşan yenileme raporu bağlı koşullardan fiyat alır. Ödeme fotoğrafı şema 2, `katalog_atamasi` kaynağını ve hedef sürüm kimliğini taşır; DB fotoğraf doğrulaması bu kaynağı kabul eder. Başlamış girişimler ve geçmiş ödemeler kendi değiştirilemez fotoğraflarıyla devam eder. Atama mevcut dönem ücretini yeniden hesaplamaz, sağlayıcıya çekim/iade isteği göndermez ve ara dönem mahsuplaşması oluşturmaz. Fatura aynı fotoğraf okuyucusunu kullanır.

## Doğrulama ve yayın

Sekiz ilgili dosyada 128 birim testi geçti. Temiz geçici PostgreSQL'de tüm migration'lar uygulandı; 12 yeni atama, 9 eski katalog bağı ve 18 ödeme/otomatik yenileme/fatura senaryosu olmak üzere 39 benzersiz kabul testi geçti. Son koşu 12 atama ve 9 eski bağ senaryosunu yeniden doğruladı; kilit beklemesinde dolan onay süresi de reddedildi. Migration öncesi/sonrası provasında dört bilinen plan/v1 bağı, bilinmeyen plan, eski abonelik alanları, dört dönemin toplam fiyatları ve yaşam olayı sayıları korundu. İlk kabul koşusunda test firmalarının VKN'si tekrar ettiği için kurulum hatası alındı; her firmaya ayrı VKN verilerek düzeltildi. API/web TypeScript ve değişen kaynakların ESLint kontrolleri geçti. Mevcut veritabanına migration uygulanmadı; çalışan API/worker/3100 web güncellenmedi.

İzole 3112 Next sunucusunda 14 benzersiz Playwright senaryosu doğrulandı: mevcut katalog/geçişteki 10 test, fiyat etkisi URL/sayfalama testi ve üç yeni atama testi. Yeni testler ayrı onay/vazgeçme, dört dönem tablosu, çakışmada seçimin/nedenin korunması ve 503 sonrasında aynı onayla tekrar denemeyi kapsar. İlk birleşik koşuda 11 test geçti; üç yeni testin genel alert/status seçicileri Next rota bildirimi veya yükleniyor durumuyla çakıştı. Seçiciler uygulama alanı ve ilgili başarı metnine daraltıldı; üç atama testi yeniden koşulup geçti (27,6 saniye). Tarayıcı API yanıtları taklittir; gerçek DB davranışı yukarıdaki kabul testlerinde sınanır.

## Devam

İleri tarihli/dönem sonunda uygulama, yeni satış, firmaya özel koşul, kota/özellik sürümleme, paketler arası geçiş ve ara dönem ücret farkı politikası kalır. PK-02/PK-08/T3 bütünü tamamlandı sayılmaz. Sonraki teslim, ileri tarihli atamaların iptal/yeniden doğrulama ve worker uygulama sözleşmesidir; aktif dönem fiyatı ile başlamış ödeme fotoğrafı ayrımı korunmalıdır.
