# Firma istisnası hazırlığı

## Tarayıcı doğrulaması

İzole 3112 Next sunucusunda üç Playwright senaryosu geçti: ayrı onay ve vazgeçmede yazmama, onay/iptal istekleri, fiyat ve sınırsız kota taslağının kaynak sürümüyle gönderimi, 409 çakışmasında eski onayın kapanması ve aynı kaynak sürümündeki kaydedilmemiş formun korunması. Yenileme sırasında ortak veri hook'u geçici olarak veriyi boşalttığı için formun söküldüğü görüldü; istisna bileşeni son başarılı kaynak verisini koruyacak şekilde düzeltildi. Tarayıcı API'si taklittir; SQL yetki/kota/yaşam döngüsü kanıtları yukarıdaki gerçek PostgreSQL kabulleridir. Test sunucusu koşu sonunda kapatıldı.

## Onay/iptal ve eski transaction görünümü

Onay ve onaylı koşulların iptali abonelikte `kota_surumu` değerini de değiştirir. Böylece daha önce başlamış Repeatable Read transaction'ı iptal edilmiş ek kotayla yazamaz; PostgreSQL serialization hatasıyla işlem geri alınır. Yeniden denemede güncel standart kota uygulanır. Yalnız taslak iptali etkin koşulları etkilemediği için kota sürümünü değiştirmez.

Beş gerçek PostgreSQL kabulü geçti: ileri başlangıçta koşulların henüz uygulanmaması, etkin iptal sonrası modüllerin geri gelmesi, eski snapshot yazımının reddi ve fazla kayıtların korunması, önizlemeden sonra artan kullanımın onayda reddi; önceki özel fiyat ve süre sonu davranışları da aynı dosyada doğrulandı. Geçici veritabanı kaldırıldı; mevcut ortama uygulanmadı.

## Güncel durum: fiyat, modül ve kota onayı

Kapsam içeren taslaklar da ayrı onayla etkinleştirilebilir. Onay transaction'ı abonelik satırını kilitler ve güncel kullanımın hedef sınırlara sığdığını tekrar doğrular. Etkin koşullar API modül kontrolü, abonelik özeti, uygulama kota kontrolü ve PostgreSQL kayıt tetikleyicilerinde aynı zaman aralığıyla okunur. Başlangıç dahil, bitiş hariçtir; worker beklenmez. Katalog fotoğrafı değiştirilmez. Bitişte veya iptalde standart koşullar döner; fazla mevcut kayıt silinmez, standart kota dolu/aşılmışken yeni kayıt oluşturma durur. Eski şema 1 koşullarının sınırları da doğrudan DB yazımında denetlenir.

Firma ekranında modül seçimi, kota ve fiyat beraber hazırlanıp onaylanabilir. Modül bağımlılıkları ortak sözleşmeyle doğrulanır. Yalnız fiyat için eski onay ucu geriye uyumlu kalır. Birleşik temiz PostgreSQL koşusunda altı dosyadaki 46 kabul testi geçti; kapsam istisnasıyla 251 cari oluşturulup standart 250 sınırına dönüşte kayıtların korunduğu ve yeni kaydın engellendiği gerçek DB'de doğrulandı. 16 erişim/abonelik birim testi ve API/web tam tür kontrolü de geçti. Aşağıdaki fiyatla sınırlı teslim notları önceki aşamayı anlatır; kapsam etkinleştirmesinin kapalı olduğuna ilişkin ifadeler artık geçerli değildir. Canlı ortama uygulanmadı.

## Güncel durum: yalnız özel fiyat onayı

Yalnız fiyat içeren taslaklar ayrı onay adımıyla etkinleştirilebilir. Onay SQL'de aktif yönetici, kaynak sürüm/koşullar, abonelik durumu, süre ve bekleyen paket ataması bakımından yeniden doğrulanır. Onay tekrarı ikinci olay oluşturmaz. Kota/modül değişikliği içeren kayıtlar bu onay yolunda reddedilir.

Etkin fiyat katalog fotoğrafını değiştirmeden, başlangıç dahil/bitiş hariç zaman aralığında okunur. Panel, ödeme bağlantısı, yeni ödeme girişimi, otomatik yenileme, abonelik özeti, yenileme raporu ve tahsilat hatırlatması bu fiyatı tüketir. Bitişte worker beklemeden standart fiyat döner; iptal de sonraki yeni ödemelere standart fiyatı uygular. Başlamış ödeme kendi fotoğrafını korur. Onaylı dönem bitmeden veya koşullar iptal edilmeden kaynak paket değiştirilemez.

Bu teslimde 15 PostgreSQL kabulü ve 16 birim testi geçti; API/web tam tür kontrolleri tamamlandı. Kabulde gerçek ödeme girişimleri özel fiyatı kullandı, kaynak katalog fotoğrafı değişmedi, süre dolunca yeni girişim standart tutara döndü ve eski girişim aynı kaldı. Mevcut ortama migration uygulanmadı. Aşağıdaki önceki hazırlık notlarında geçen etkinleştirme eksikliği artık kota/modül istisnaları için geçerlidir.

Etkinleştirme tüketicileri: `tenant/abonelik-kosullari.ts` fiyat ve plan çözümünü, `core/abonelik-erisim.service.ts` modülleri, `abonelik-odeme/abonelik-odeme.service.ts` yeni girişim/yenilemeleri okur. SQL'de `paket_kotasini_koru` doğrudan yazımları denetler; platform yenileme raporu ve tahsilat hatırlatması da korunmuş koşulları tüketir. Sadece TypeScript tarafında fiyat/kota değiştirmek yeterli değildir. Etkinleştirme bu tüketicilerde aynı başlangıç dahil/bitiş hariç zaman kuralını uygulamalı; kaynak katalog fotoğrafını değiştirmemeli ve başlamış ödeme fotoğraflarını korumalıdır. Süre sınırında fiyat ve kapsamın birlikte dönmesi, sınırsız/sıfır kota ve yenileme dönemi kaybının reddi birim kabulüne eklendi.

Etkinleştirme öncesi paket altyapısının birleşik regresyonunda yalnız fiyat atamasının eski `v1` kodunu değiştirdiği görüldü ve düzeltildi. Fiyat ataması mevcut kodu korur; kapsam ataması onaylı kayıtla hedef kodu uygulayabilir. `v1`/`profesyonel` ad düzeltmesi bağlı fiyatı sıfırlamaz. Temiz geçici PostgreSQL'de fiyat atama, planlı atama, kapsam/kota, paketler arası geçiş ve yeni kayıt dosyalarının tamamı birlikte geçti: 43 kabul testi. Bu düzeltme istisna etkinleştirmesini açmaz.

Uygunluk ekranı özel ve standart kotaları güncel kullanımla yan yana gösterir. Standart kotanın üzerindeki kullanım, kota bazında aşım miktarıyla belirtilir. Süre sonu karşılaştırması gelecekteki kullanımı tahmin etmez; bitiş zamanı ve tekrar kontrol gereği ekranda açıklanır. Bu arayüz değişikliği sonrasında web tür kontrolü geçti. Gerçek süre sonu dönüşü ve aşımda yazma davranışının entegrasyonu henüz tamamlanmadı.

Son istisna API değişiklikleri için ortak paket yeniden derlendi ve API'nin tam TypeScript kontrolü 4 GB Node yığın sınırıyla hatasız tamamlandı. Önceki web tür kontrolü ve PostgreSQL kabulüyle birlikte taslak/uygunluk aşamasının kontrolleri geçti. Bu sonuç etkinleştirme entegrasyonunun tamamlandığı anlamına gelmez.

Firma detayındaki güncel uygunluk kontrolü, yetkiyi SQL'de yeniden doğrular; abonelik ve taslak satırlarını aynı kontrolde kilitler. İptal, bitiş zamanı, kaynak sürüm/koşul değişikliği, abonelik durumu, bekleyen paket ataması ve hedef kotanın üzerindeki mevcut kullanım gerekçeleriyle gösterilir. Bu sonuç anlık bilgilendirmedir; onay veya etkinleştirme değildir. Uygulama entegrasyonu tamamlandığında aynı kontroller yazma transaction'ında yeniden çalıştırılmalıdır. Web tür kontrolü ve genişletilmiş PostgreSQL kabulü geçti; askı, iptal ve cari kota aşımı gerçek veritabanında doğrulandı.

PK-07 için süreli fiyat/kapsam önerisinin kalıcı taslak kaydı, kaynak/hedef koşul fotoğrafları, sayfalı geçmiş ve gerekçeli iptal API'si eklendi. Firma aboneliği kilitlenerek kaynak sürüm ve koşullar tekrar karşılaştırılır. Aynı firmanın örtüşen, iptal edilmemiş taslakları reddedilir. İptal tekrar güvenlidir; denetim olayı aynı transaction içinde yazılır.

Taslaklar etkin aboneliğe uygulanmaz. Yanıtlar `uygulamaEntegrasyonu: false` ve `durum: taslak` taşır. Etkinleştirme onayı, ödeme/kota/erişim tüketicileri ve bitişte kaynak koşullara dönüş entegrasyonu tamamlandığında açılmalıdır. Firma detayında özel dönem fiyatı ve kota taslağı hazırlama, kaynak/hedef koşulları karşılaştırma, sayfalı geçmiş ve gerekçeli iptal arayüzü eklendi. Modüller ve uyarı eşikleri mevcut kapsamdan korunur; yeni modül seçimi bu formun kapsamına dahil değildir.

Platform yöneticisi taslak oluşturabilir ve iptal edebilir; aktiflik ve davet kurulumu SQL işlevlerinde yeniden doğrulanır. Uygulama rolünün tablo/işlev erişimi yoktur; platform rolü tabloyu yalnız okuyabilir. Geçici PostgreSQL kabulü tüm migration'larla geçti: kaynak aboneliğin korunması, çakışma, boş geçmiş sayfasında toplam, rol sınırları, iptal tekrarı ve tek denetim olayı doğrulandı. Geçici veritabanı kaldırıldı; çalışan ortama migration uygulanmadı.
