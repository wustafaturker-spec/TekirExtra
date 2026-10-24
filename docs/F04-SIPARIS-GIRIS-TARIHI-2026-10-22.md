# F04-02 — Doğrulanmış sipariş giriş tarihi ve kaynak adaptörü

22 Ekim 2026. Sorumlu: backend. Bağımlılıklar: F04-01, F04-02 hesap çekirdeği, P00-05 tenant/yetki sınırları. Bu dilim API ve veri katmanıdır; kullanıcı ekranı, kalıcı ihtiyaç–karşılama bağı ve operasyon pilotu açık.

## Veri ve API

Yeni `SiparisGirisTarihi` modeli (`siparis_giris_tarihleri`) satır başına doğrulanmış beklenen depo giriş gününü, sürümü, kaynak özetini, gerekçeyi, doğrulayan kullanıcıyı ve zamanı tutar. `tarih: null` doğrulamayı kaldırır. Eski kayıtlar tarihsiz kalır; `teslimSuresi` metni veya ihracat tarihi dönüştürülmez. Önceki/yeni tarih ve sürümler `audit_log` içinde saklanır. Satır silinirse güncel tarih kaydı cascade ile silinir; audit geçmişi korunur.

API tabanı `/api/v1/stok/ihtiyac-plani`:

- `GET /giris-tarihleri/:satirId`: satırın kaynak özeti, kalan ana birim miktarı, tarih/sürüm ve kaynak geçerliliği. Yönetici, muhasebe, depo.
- `PUT /giris-tarihleri/:satirId`: yönetici veya muhasebe tarafından açık kullanıcı işlemi. Gövde: `tarih` (`YYYY-MM-DD` veya null), `beklenenSurum` (ilk kayıt için 0), `beklenenKaynakOzeti`, en az 5 karakter `gerekce`.
- `GET /tarihli-onizle`: mevcut önizleme ile aynı stok/depo/miktar/birim/ihtiyaç günü sorgusu. Eski `hesap` anlık stok sonucudur; ayrı `tarihli` alanı kaynaklı dönemsel hesabı döndürür. GET yanıtları `no-store`.

Mevcut `/onizle`, stok ekranı ve satın alma taslağı aktarımı davranışı korunur. Tarihli açık henüz satın alma formuna aktarılmaz; eski form mevcut stok açığıyla çalışır.

## Hesap sözleşmesi

Yalnız deposu açıkça kayıtlı, varyantsız, aktif fiziksel ürünün `onaylandi` / `kismen_kapandi` alış siparişi satırları okunur; faturaya doğrudan bağlanmış siparişler dışlanır. Kalan miktar SAT-09 `miktar − teslimEdilenMiktar` ile, kayıtlı birim katsayısından ana birime çevrilir. Üç ondalığı aşan dönüşüm yuvarlanmaz. Negatif/fazla teslim ve geçersiz birim hesap hatasıdır.

İrsaliyeye dönüşen miktar fiziksel stok değildir ve bu adaptörde tarihli giriş sayılmaz. Tarihli motor yalnız teslim edilmemiş sipariş kalanını alır. Sipariş kalan toplamı deponun yoldaki bakiyesini aşarsa sonuç 409 ile bütünüyle reddedilir; düşük kalan toplamı, irsaliyeye geçen miktar gibi kapsam dışında kalan yoldakiyi gösterir. Tarihli giriş mevcut stoğa veya yoldaki bakiyesine ayrıca yazılmaz.

Kaynak özeti satır/tenant/ürün/varyant/cari/depo, sipariş türü/yönü, ilk miktar, birim/ana birim ve katsayıyı kapsar. Bunlar değişirse eski tarih hesaba katılmaz; tekrar doğrulama gerekir. Teslim birikimi tek başına değiştiğinde tarih kalan miktar için geçerlidir. Kaynak geçerliliği güncel tarih anlamına gelmez: motor geçmiş veya ufuk sonrası tarihleri ayrıca dışlar.

Mevcut rezervler başlangıçta bir kez düşülür. Rezerv dışı gelecekteki satış/üretim talepleri bu adaptörde okunmaz. Dönemsel sonuç bu sınırlı kaynak kapsamındadır; teslim taahhüdü veya tam MRP değildir. 5000 sipariş satırı üst sınırdır; 5001 satırda kısmi hesap verilmez.

## Güvenlik ve eşzamanlılık

Servis doğrudan çağrılsa da rol kontrolü uygular. Tenant filtresi ve zorunlu RLS birlikte kullanılır. Yeni tablonun tenant/satır bileşik FK'sı farklı tenant'a ilişki kurulmasını engeller; uygulama rolüne doğrudan DELETE verilmez. Tarih yazımı önce belgeyi, sonra kaynak satırı kilitler; kaynak özeti ve beklenen sürüm transaction içinde yeniden doğrulanır. Eski ekranla revizyon 409 verir. Aynı kullanıcı/gövdenin başarılı ağ tekrarı yeni sürüm veya audit üretmez. Audit hatasında tarih upsert'i de geri alınır. Finans, stok, sipariş miktarı veya satın alma kaydı yazılmaz.

## Migration, işletim ve geri dönüş

`20261022120000_siparis_giris_tarihi` yeni tablo, tenant/satır FK'sı, RLS/GRANT ve kaynak bileşik unique indeksini ekler. Eski veriye tarih atamaz. Kaynak indeksi büyük tabloda kilit/süre bakımından hedef hacimde ayrıca değerlendirilmelidir. Yeni API uçlarından önce migration uygulanmalıdır; kodun eski önizleme yolu yeni tabloyu sorgulamaz.

Gerçek şirket veritabanına migration veya çalışan servislere yayın yapılmadı. Geri dönüş yeni tarihli uçları kullanımdan kaldırıp önceki API sürümüne dönmektir; yeni tablo ve audit kayıtları korunabilir. Veri silen migration rollback gerekmez.

## Doğrulama

Prisma şema doğrulaması ve istemci üretimi başarılı. Tam API TypeScript kontrolü 4 GiB Node heap ile başarılı. İlk odaklı hesap/servis/kaynak koşumunda 46 test geçti; sonraki stok/belgeler regresyonunda bu testler dahil 182/182 test başarılı. Belgeler fixture'larında mevcut teklif takip mock'u için iki uyarı oluştu; testler geçti.

Geçici PostgreSQL 16 üzerinde bütün migration'lar uygulandı; uygulama DB rolünde 19/19 kabul testi geçti. Önizlemenin eski davranışı, kısmi teslim kalanı, geç/tarihsiz giriş, doğrulama kaldırma, kaynak değişimi, tenant RLS ve çapraz FK, eşzamanlı farklı revizyonlar, ağ tekrarı, rol/takvim sınırları, iptal/deposuz sipariş, yoldaki bakiye tutarsızlığı, audit arızasında gerçek DB rollback ve belge/stok/finans değişmezliği doğrulandı. Geçici DB başarıyla otomatik silindi. Gerçek şirket pilotu, HTTP/tarayıcı veya yayın kabulü yapılmadı.

İlk DB koşusunda test fixture'ının zorunlu `netKdvTutari` alanı eksikti; yeni 9 test fixture oluşturma aşamasında kaldı, eski 9 test geçti. Fixture düzeltildi ve finans/stok değişmezliği senaryosu eklendi. Geçici DB ilk koşudan sonra otomatik silindi.

Sonraki teslim: sipariş satırında gerekçeli tarih doğrulama ekranı, tarihli önizleme görünümü ve kaynak revizyonunu da içeren satın alma güncellik kanıtı; ardından rezerv dışı talepler, kalıcı karşılama bağları ve operasyon pilotu.
