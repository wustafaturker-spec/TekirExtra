# F04 — Yeni ihtiyaç için stok önizlemesi

İlk dilim, henüz rezerv edilmemiş kullanıcı talebinin tek bir aktif depodaki fiziksel stokla karşılanmasını hesaplar. Stok kartları ekranından **İhtiyaç önizlemesi** açılır. Yönetici, muhasebe ve depo rolleri kullanabilir.

## Hesap sözleşmesi

- Kullanılabilir = mevcut − rezerve. Rezerv yalnız bir kez düşülür.
- Eksik = max(0, talep − kullanılabilir). Negatif kullanılabilir miktar varsa stok borcu da tedarik miktarına eklenir.
- Bütün sonuçlar kartın ana birimindedir. Alternatif birim kartın kayıtlı katsayısıyla çevrilir; üç ondalığı aşan sonuç sessizce yuvarlanmaz.
- Yoldaki miktar ayrı gösterilir. Mevcut siparişlerdeki serbest metin teslim süresi güvenilir giriş tarihi sayılmaz; yoldaki miktar stok yeterlilik hesabına katılmaz.
- Başka depo, başka tenant, hizmet, pasif kart/depo ve varyantlı ürün miktarları birleştirilmez.
- İhtiyaç günü geçerli ve Türkiye takvimine göre bugün veya sonrası olmalıdır.

`GET /api/v1/stok/ihtiyac-plani/onizle` sorgusu `stokId`, `depoId`, `miktar`, `birim`, `ihtiyacTarihi` alır. Tenant kapsamındaki repeatable-read işleminde stok görünümü ve veritabanı zamanı birlikte okunur. Hesap finans, stok, rezerv, belge veya satın alma kaydı yazmaz. Ekrandaki alanlar değişirse eski sonuç kaldırılır; geciken cevap değişmiş forma taşınmaz.

## Kapsam sınırı ve sonraki adım

İhtiyaç günü, bu sürümde geleceğe dönük teslim garantisi değildir. Ekran bu ayrımı açıkça belirtir. Tarihli kesin mal kabulü, gelecekteki satış/üretim taleplerinin dönemlere dağıtılması, varyant bazında plan ve onaylı satın alma talebine aktarım henüz bu dilime dahil değildir. F04 bütünü tamamlandı olarak işaretlenmez.

Dağıtım ve doğrulama sonucu aynı aday dizinindeki raporlarla kayıt altına alınacaktır: `.release-candidates/f04-ihtiyac-20261019/`.

## Doğrulama ve yerel yayın

- 18 hesap/servis birim testi geçti.
- İzole PostgreSQL üzerinde uygulama rolüyle 9 kabul testi geçti. Rezerv, birim hassasiyeti, tenant RLS, depo ayrımı, varyant/hizmet/pasif kart engelleri, tarih, rol ve stok güncelliği doğrulandı. Geçici DB otomatik silindi.
- Son üretim standalone web paketinde 5 Chrome senaryosu geçti: hesaplama, Türkçe miktar gösterimi, alan değişiminde sonuç temizleme, API hatası, gecikmiş cevabın bastırılması, mobil taşma ve yetkisiz rol kontrolü.
- API derlemesi ve GET rota/modül kaydı doğrulandı. Gerçek tenant'ın mevcut ürün ve deposuyla stok listesi, depo listesi ve ihtiyaç önizlemesi HTTP 200 döndü.
- Yayınlanan localhost:3100 ekranı gerçek API ile Chrome'da masaüstü/mobil olarak doğrulandı. Son koşuda tekrar gerekmedi; sayfa hatası, yatay taşma ve iş kaydı yazımı yoktu. HTTP mutasyonları testte engellendi.
- Önceki F03 düzeltmelerinin hashleri ve temel API runtime'ın değişmediği paketleme sırasında doğrulandı. Ödeme sözü worker'ı güncellenmedi. API, web ve worker son kontrolde healthy.

Adres: `http://localhost:3100/panel/stok/ihtiyac`. Stok Kartları ekranındaki **İhtiyaç önizlemesi** bağlantısı da bu sayfayı açar.

Bu ilk dilimin servis tanımı: `.release-candidates/f04-ihtiyac-20261019/compose.json`.

- API: `.release-candidates/f04-ihtiyac-20261019/runtime`.
- Web: `.release-candidates/f04-ihtiyac-web-r2-20261019/web`.
- Web adayı: `f02-20261019T184713579Z-9b8746c3`.
- Web adayının yalnız `web/` paketi kullanılır; API ayrı runtime manifestiyle izlenir.
- Şema migration'ı veya şirket ayarı değişikliği yoktur.

Kanıtlar: `.release-candidates/f04-ihtiyac-20261019/` altındaki `birim-kabul.json`, `db-kabul.json`, `http-kabul.json`, `yerel-tarayici.json`, `runtime-manifest.json`, `tarayici-r2/sonuc.json` ve `yayin-ozeti.json`.

## İşletim notu

Yüksek disk I/O beklemesi sırasında derleme ve ilk kabul denemeleri süre sınırına takıldı. Yayın sonrası ilk gerçek kontrollerde genel veritabanı işlemlerinin beş saniyelik işlem sınırını aşması nedeniyle 503 görüldü; aynı anda rapor ve liste uçları da etkilendi. Genel işlem süresi veya havuz ayarları değiştirilmedi. Son gerçek tarayıcı koşusunda ihtiyaç hesabı ilk istekte geçti. Yerel kaynak baskısı ve yoğunlukta 503 davranışı ayrıca performans işi olarak izlenmelidir; bu teslim genel yük kabulü sayılmaz.

## Geri dönüş

Önceki `.release-candidates/f03-iade-revizyon-20261019/compose.json` ile yalnız API/web servisleri geri alınabilir. Bu dilim DB migration'ı veya veri yazımı yapmadığından şema geri dönüşü gerekmez. Ödeme sözü worker'ı korunur.

Sonraki [satın alma talebine aktarım dilimi](F04-STOKTAN-SATIN-ALMA-TALEBI-2026-10-19.md) web paketini yeniler; güncel servis tanımı o belgededir.
