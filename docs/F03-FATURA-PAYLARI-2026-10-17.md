# F03 — Kaynak satırdan fatura payı ve kapama görünümü

17 Ekim 2026. Fırsat ekranı, aktif tekliflerin kaynak satır zinciriyle doğrulanmış **kesin satış faturası paylarını KDV dahil** gösterir. Bu ölçü ciro/net satış değildir. Kasa/banka, iade ve diğer kapamalar ayrı gösterilir; kapama defteri gerçek nakit akışı veya iade satırının ticari dağılımı olarak sunulmaz.

## Kaynak kanıtı

`FaturaSatir.kaynakBelgeSatirId`, mevcut belge → fatura dönüşümünde kaynak satır kimliğini saklar. Doğrudan ve toplu faturalama aynı oluşturma yolunu kullanır. Eski faturalarda alan boş bırakılır; stok, miktar, sıra veya tutar benzerliğinden tahmini eşleştirme/backfill yapılmaz. Tekrarlayan fatura üretiminde kaynak kimliği kopyalanmaz. Mevcut manuel fatura oluşturma/düzenleme yolları kaynak kimliği üretmez; satırlar yeniden yazıldıysa kanıt kaybolur ve sonuç dağıtılamadı kalır.

Migration `20261017140000_fatura_satir_kaynak_bagi`, nullable alanı ve kaynak satır/tenant/stok bileşik foreign key'ini ekler. Kaynak satır silinirse yalnız kaynak alanı NULL olur; mali fatura satırı silinmez. Mevcut tablo RLS/FORCE RLS politikaları korunur. Yeni tablo veya bağımsız mutasyon ucu yoktur. Migration yalnız geçici DB'de uygulandı; gerçek şirket veritabanı değiştirilmedi.

Okuyucu, aynı tenant/cari kapsamındaki fatura satırından sipariş/irsaliye satırına, oradan aktif bağlı teklif satırına kadar hem satır hem belge ebeveynini doğrular. Kaynak belgenin `faturaId` ve dövizi hedef faturayla eşleşmelidir. İptal kaynaklar, kırılmış zincir, yinelenmiş fatura satır kaynağı, negatif satır ve satır toplamı–fatura genel toplamı tutarsızlığı pay üretmez. Taslak/iptal fatura gerçekleşmiş pay sayılmaz. Fırsatın tahmini tutarı kullanılmaz. Farklı dövizler birleştirilmez.

`GET /crm/firsatlar/:id/belgeler` yanıtına `ticariSonuc` eklendi. Tutarlar decimal-string; bilinmeyen pay NULL'dır, sıfıra çevrilmez. Aynı karma faturanın farklı fırsatlara ait satırları kendi fırsatlarına ayrı ayrı yansır; bütün fatura toplamı tekrarlanmaz. Her fatura için tam/kısmi/dağıtılamadı/kesin değil kapsamı belirtilir. Kaynak satırları, fatura satırları ve kapama okumaları ayrı ayrı 5000 kayıtla sınırlıdır; aşılırsa eksik sonuç yerine 409 verilir. Mevcut 200 bağ ve 1000 zincir/kaynak sınırları da korunur.

## Kapama sınırı

Kapamalar yalnız bütün fatura satırlarının bu fırsata ait olduğu ve toplamın doğrulandığı kesin faturada gösterilir. Karma veya eksik kaynaklı faturada ödeme/iade, fatura payına oranlanmaz; bütün kapama payları NULL kalır. `FaturaKapama.tutar` zaten kapanan faturanın dövizindedir; yeni kur dönüşümü yapılmaz.

Kaynak tenant/cari, tek kaynak şartı ve negatif olmayan tutar doğrulanır. Kasa/banka kaynağı tahsilat olmalıdır. İade kaynağı kesin satış iadesi olmalıdır. Çek/senet/kart diğer kapamada ayrı tutulur. Kapama toplamı faturayı aşarsa kalan dahil bütün kapama ölçüleri dağıtılamadı olur. İptal edilen iadenin eski kapaması güvenilir sayılmaz; kapama çözülünce kalan bakiye güncellenir. Okuma denkleştirme çalıştırmaz ve deftere yazmaz; mevcut kapama defterinin anlık görüntüsünü kullanır.

İade ile kapama, fatura payından düşülerek net satış olarak adlandırılmaz. Karma faturada iadenin/ödemenin hangi satırı kapattığı mevcut şemada kanıtlanamıyor. Bu dağılım, net satış/iade sonucu ve tam F03-K1/K2 birleşik satış kabulü sonraki dilimlerdir. Gerçek pilot ve canlıya geçiş kullanıcı isteğiyle ertelenmiş durumdadır; bu çalışma yeni üretim yayın adayı oluşturmaz.

## Doğrulama

**131 test geçti:** 92 CRM/belge/fatura birim testi, 32 geçici PostgreSQL testi ve 7 fixture tarayıcı senaryosu. Yeni DB kontrolleri gerçek belge dönüşümünde satır kaynağının taşınmasını, kesin/taslak/iptal durumlarını, eski/kırılmış kaynakları, iki fırsatın ortak faturasını, iade/kasa kapamasını, kapama çözülmesini, fazla kapamayı, tutar/döviz tutarsızlığını, yinelenen kaynağı ve tenant/stok foreign key kapsamını doğrular. Kaynak satır silinmesi mali satırı koruyarak kanıtı NULL yapar. Okuma öncesi/sonrası belge ve finans kayıtları karşılaştırıldı.

DB testi belge dönüşüm servisini gerçekten çağırır; fatura kesinliği ve kapama kayıtları test fixture'ında kurulur. Gerçek fatura kesinleştirme, nakit hareketi işleme veya kullanıcı pilotunun uçtan uca kanıtı değildir. Yeni migration uygulama rolü/RLS ve PostgreSQL 16 üzerinde doğrulandı; geçici veritabanı otomatik silindi. Odaklı API kaynakları, kabul testi ve bağımlılıklarının tür kontrolü ile web kaynakları/e2e ve bağımlılıklarının tür kontrolü geçti. Tam üretim derlemesi yapılmadı.

Tarayıcıdaki önceki altı bağlama/oluşturma/salt okunur senaryosuna mobil fatura payı ve kapama kontrolü eklendi. Farklı dövizler ayrı, kısmi pay açıkça etiketli, belirsiz pay NULL durumunda ve iadeler ayrı görünür. Yazma isteği oluşmadığı ve yatay taşma olmadığı doğrulandı. Yedi senaryoda başarısız/atlanan/kararsız test yok; mobil ekran görüntüsü incelendi.

[Kabul özeti ve kaynak SHA-256 kayıtları](../.release-candidates/f03-fatura-paylari-20261017/kabul-ozeti.json), [PostgreSQL logu](../.release-candidates/f03-fatura-paylari-20261017/postgres-kabul.log), [birim sonucu](../.release-candidates/f03-fatura-paylari-20261017/api-birim.json), [tarayıcı sonucu](../.release-candidates/f03-fatura-paylari-20261017/tarayici.json), [mobil fatura payları](../.release-candidates/f03-fatura-paylari-20261017/fatura-paylari-mobil.png).
