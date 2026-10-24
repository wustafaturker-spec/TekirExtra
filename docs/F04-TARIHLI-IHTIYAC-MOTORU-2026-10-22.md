# F04-02 — Tarihli ihtiyaç motoru, hesap çekirdeği

22 Ekim 2026. Sorumlu: backend. Bağımlılık: F04-01 sözleşmesi; kaynak adaptöründe P00-05 yetki/veri sınırları. Bu teslim saf hesap çekirdeğidir; F04-02'nin tamamı, API entegrasyonu veya pilot kabulü değildir.

`apps/api/src/stok/ihtiyac-tarihli.ts` tek tenant, ürün, depo, varyant ve ana birim için sürüm 1 dönemsel hesap üretir. Başlangıç kullanılabilir miktarı mevcut eksi rezervdir. Olaylar kaynak satır kimliği, açık kalan ana birim miktarı, doğrulanmış takvim günü ve durum taşır. Snapshot rezervine dahil talepler tekrar düşülmez. Kısmi teslimden sonra siparişin ilk miktarı değil kalan miktarı sağlanmalıdır. Kaynak kapsamı veya tekilliği bozuksa hesap bütünüyle reddedilir.

Doğrulanmamış, gecikmiş veya ufuk sonrası giriş hesaba katılmaz; iptal/tamamlanmış ve kalanı sıfır kaynaklar dışlanır. Geçmiş tarihli girişin bugün geleceği varsayılmaz. Rezerv dışında kalan açık bir talebin tarihi belirsiz veya geçmişse sonuç `dogrulanamadi` olur; sayılar yalnız bilinen kaynakların hesabıdır. Dışlanan her kaynak nedeni ile döner.

Olaylar gün sırasıyla, aynı gün içinde talepler girişlerden önce işlenir. Yeni kullanıcı ihtiyacı hedef günün sonunda hesaplanır; bu gün içi teslim saati taahhüdü değildir. Dönem sonu açık ile dönem içinde görülen en büyük açık ayrı döner. `donem_sonu_yeterli` durumu dönem boyunca eksik olmadığını veya teslim garantisini ifade etmez. Gelecekteki ekran bu iki sonucu birlikte göstermelidir.

Tüm miktarlar Decimal ile hesaplanır; giriş en fazla 12 tam ve üç ondalık basamaktır. En fazla 5000 kaynak kabul edilir; 5001 kaynakta kısmi sonuç üretilmez. Tarih, miktar ve kapsam çalışma anında doğrulanır. Girdi değiştirilmez; finans, stok, rezerv veya kalıcı bağ yazılmaz.

## Entegrasyon sınırı

Mevcut `Belge.teslimSuresi` serbest metindir; `StokDepoBakiye.yoldakiMiktar` tarih taşımaz. Bunlar doğrulanmış giriş tarihi sayılamaz. `Belge.ihracatTeslimTarihi` genel depo giriş tarihi değildir. Bu nedenle çekirdek henüz HTTP ucuna, satın alma aktarımına veya mevcut önizleme ekranına bağlanmadı. Tenant yetkilendirmesi bu saf işlevin sorumluluğu değildir; çağıran adaptör yetkili transaction içinde kaynakları okumalıdır. Başka tenant kapsamını reddeden hesap testi DB/RLS kabulü yerine geçmez.

Sonraki dilim: sipariş satırı düzeyinde doğrulanmış beklenen giriş günü ve revizyon kaydı; kısmi teslim/fatura sonrası kalan miktarın mevcut domain servisleriyle çözümlenmesi; aynı snapshot içinde kaynak okuma, DB/RLS ve yarış kabulü; ardından tarihli sonuçların API/UI ve satın alma güncellik kanıtına eklenmesi. Kalıcı ihtiyaç–karşılama bağları ve farklı taslaklar arasında tekilleştirme ayrıca açık.

Migration, yeni endpoint, şirket ayarı veya yerel yayın değişikliği yoktur. Geri dönüş, çağıranı olmayan hesap dosyasının kaldırılmasıdır; veri geri yüklemesi gerekmez.

## Doğrulama

`ihtiyac-tarihli.test.ts` F04-K1, doğrulanmış kalan giriş, rezerv tekilliği, aynı gün sırası, dönem içi açık, belirsiz/gecikmiş talep, kapsam ayrımı, tekrarlanan kaynak, ondalık/negatif stok, takvim ve 5000/5001 kaynak sınırlarını kapsar. Mevcut hesap/servis testleriyle birlikte çalıştırılır. Gerçek DB, tarayıcı veya operasyon pilotu bu çekirdek tesliminin kabulü olarak sunulmaz.

Son koşumda yeni motorun 23 testi ve mevcut hesap/servisin 18 testi: toplam 41/41 geçti. Tam API `tsc --noEmit -p tsconfig.json` kontrolü yaklaşık 2 GiB varsayılan Node heap sınırında bellek yetersizliğiyle sonlandı; tam API tür kontrolü başarılı sayılmaz.

Yeni motor dosyasının bağımsız strict TypeScript kontrolü (`tsc --noEmit --skipLibCheck --strict --esModuleInterop --target ES2022 --module commonjs --moduleResolution node src/stok/ihtiyac-tarihli.ts`) başarılı.
