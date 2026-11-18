# Endeks ve fiyat önerisi tamamlaması — 2026-11-17

Kapsam: kullanıcının istediği END-08, END-10, END-16, END-23 ve END-26 eksiklerinin tamamlanması. **Pilot yayını 17 Kasım 2026 22:53'te tamamlandı:** [yayın ve doğrulama kaydı](ENDEKS-PILOT-YAYIN-2026-11-17.md).

## Değişen davranış

- Fiyat önerisi mevcut listeye veya yeni pasif listeye tek toplu istekle uygulanır. İşlem `fiyat_listesi_guncelle` genel ONY kapısından geçer. Kural uyarsa fiyat yazmadan tek talep açılır. Tutar koşulu, önerilen birim fiyatların toplamının TL karşılığıdır; koşulsuz kural her değişikliği onaya bağlar. Tek kalem yazımı da bu kapıyı kullanır.
- Önizleme liste içeriğinin sürümünü taşır. Onay sırasında liste değişmişse öneri uygulanmaz. Yazım transaction içinde liste ve kalem kilitleriyle tekrar doğrulanır; bir kalemde hata olursa bütün kalemler geri alınır. Son onayda talep edenin güncel aktifliği, rolü, özel rolü ve aboneliği denetlenir. Endeks önerisinde endeks satış izni ve plan özelliği de yeniden denetlenir.
- Kur seçimlerinde alış için `USD`/`EUR`, satış için `USD_SATIS`/`EUR_SATIS` bulunur. Worker satış serilerini de mevcut EVDS çekim düzeniyle alır. Katalogda veri yoksa aynı yöndeki günlük TCMB kuru kullanılır; satış yerine alış verisi verilmez. Seçim ürün ekranına, fiyat önerisine, toplu rapora ve araçlara açıktır.
- Ana/ek birim değişiklikleri tetikleyiciyle tarihçeye yazılır; yeni fatura satırı kullandığı dönüşüm katsayısını saklar. Fiyat/endeks sekmesinde tarihçe görünür. Kırılma ayı karşılaştırılmaz; kırılmanın iki tarafında baz ölçeği, aylık/yıllık ve reel oran üretilmez. Sonraki dönemde yeni baz seçilerek hesap yapılabilir. Toplu rapor ve asistan da aynı korumayı kullanır; marj, tedarikçi ve müşteri raporları kırılmalı dönemde oran yerine durum açıklaması döndürür.
- Özel rol matrisinde satış ve alış/maliyet için iki bağımsız okuma kutusu bulunur. Özel rolde hazır rol listelerinden bağımsız çalışır; Raporlar izni ve plan kapsamı üst sınırdır. Özel rolü olmayan kullanıcıda hazır rol ayarları korunur. Göç, mevcut özel rollerin fiili erişimini yeni kutulara taşır.
- Seri kullanımında her firma/seri için tek gözlenen kullanım kaydı tutulur. Platform ekranında benzersiz kullanan firma sayısı görünür. Kullanım tablosu RLS ile yalıtılmıştır; platform rolü firma kimliklerini okuyamaz, yalnız toplu sayım işlevini çağırabilir. Tekrarlı çağrılar firma sayısını artırmaz.

## Veri geçişleri

1. `20261117210000_endeks_tamamlama`: satış serileri, kullanım ve birim tarihçesi tabloları, katsayı sütunu ve tetikleyiciler; mevcut özel rollerin erişimini koruma.
2. `20261117211000_onay_fiyat_islemi`: ONY işlem kısıtına fiyat listesi güncellemesini ekleme.
3. `20261117212000_birim_tarihcesi_cascade`: kullanılmamış stok kartı birimleriyle silinirken tarihçenin silmeyi engellememesi.
4. `20261117213000_fatura_birim_katsayi_kesinlesme`: taslak açıldıktan sonra katsayı değişirse kesinleşme anındaki katsayının sabitlenmesi.

Göçler önce ayrı `tekirextra_kabul` veritabanında denenmiş, ardından 17 Kasım pilot yayınında yedek alınarak uygulanmıştır. Prisma client üretimi ve shared/API/web üretim derlemeleri tamamlanmıştır. Yeni kur serileri pilotta worker tarafından 121'er aylık veriyle doldurulmuştur.

## Tarihçe ve ölçüm sınırları

- Önceki birim değişiklikleri geriye dönük tahmin edilmez. Yeni satırların katsayısı saklanır; eski satırların geçmiş katsayısı bilinmiyorsa mevcut dönüşüm bilgisi kullanılır. Eski dönemlerin doğruluğu için olmayan tarihçe üretilmez.
- Firma sayısı, göçten sonra ekran, rapor, araç veya otomasyonda gözlenen kullanımdır; geçmiş kullanım sayısı değildir. Destek oturumu salt okunur kaldığından kullanım yazmaz.
- Satış kuru seçeneğinin gerçek EVDS hesabındaki çekimi bu çalışmada dış ağa çağrı yapılarak denenmemiştir; katalog ve günlük kur/değer okuma yolları kabul testleriyle doğrulanmıştır.

## Doğrulama

Kabul senaryoları: onay öncesi yazmama, son onayda atomik yazma, değişen hedefi reddetme, tek kalemle kapıyı aşamama, yetki daraltılınca yürütmeme, plan/endeks erişimi kapanınca yürütmeme, iki özel rolün farklı tarafları görmesi, satış/alış kur ayrımı, birim kırılmasında oran vermeme, kullanımın tekilleştirilmesi ve platformun ham kiracı kimliklerine erişememesi. RLS kapsam denetimi yeni tabloları da kontrol eder.

Tarayıcı testi: önizleme → kullanıcı onayı → tek toplu istek → ONY bekleme mesajı. API taklit edilir; gerçek ONY yürütmesi PostgreSQL kabulünde ayrıca sınanır.

Sonuçlar (hedefli koşuların toplamı): **94 API birim/kapsam testi, 48 shared testi, 40 PostgreSQL kabul testi ve 1 Chromium testi geçti.** Son iki kabul senaryosu ayrıca ad filtresiyle çalıştırıldı: onay beklerken plan/özel rol izninin kapanması ve katsayının kesinleşmede sabitlenmesi. Gerçek sağlayıcı/model çağrısı yapılmadı.

Shared derlemesi, API tip kontrolü, web kaynak tip kontrolü, değişen kaynakların ESLint denetimi ve `git diff --check` başarılıdır. Web kaynak kontrolünde daha önce üretilmiş `.next-e2e`/`.next-platform-e2e` rota türleri dışarıda bırakıldı; ana yapılandırma bu klasörlerle `.next` rota türlerini birlikte yüklediğinde mevcut `/saha` uyuşmazlığını bildiriyor. Kalıcı tsconfig değiştirilmedi. Eşzamanlı ağır kontroller sırasında tarayıcı koşusu sayfa açılışında süre aşımına uğradı; tek başına tekrarında geçti.

## Pilot yayını sonrası END-04 doğrulaması

`20261117214000_endeks_revizyon_gorevi` göçü ayrı `tekirextra_kabul` veritabanında doğrulandı. Hedefli PostgreSQL kabul testinde kısmi ay güncellemesinin görev açmadığı, geçmiş ayı aynı değerle güncelleyen eşzamanlı iki çekimin ise tek revizyon ve ona bağlı tek açık sistem görevi oluşturduğu görüldü. Hedefli koşuda 1 senaryo geçti, 25 senaryo ad filtresiyle atlandı. Bu göç 17 Kasım pilot yayın paketinden sonra eklendi.
