# Kişisel panel widget’ları

Kullanıcı panelini kendi günlük işine göre düzenleyebilmeli ve gördüğü rakamın kapsamını anlayabilmeli.

| Aşama | İş | Kabul ölçütü |
| --- | --- | --- |
| 1 | Kaynak, filtre ve gösterim seçimiyle widget oluşturma | Başlık ve görünüm önizlenebilir. Kayıt eklenebilir, düzenlenebilir, sıralanabilir ve silinebilir. |
| 1 | Firma ve kullanıcı bazında kayıt | Tercihler yeniden girişte ve başka cihazda yüklenir. Eski sürümle kaydetme mevcut düzeni ezmez. |
| 1 | Rakam doğrulama ve yetki | Kartlar yetkili kaynak uçlarından okur. Toplamlar liste sınırından bağımsızdır. Hata, yetki eksikliği ve sıfır farklı gösterilir. |
| 1 | Panel düzeni | Kişisel kartlar üst bölümde yer alır. Liste ve form dar ekranlarda tek sütuna iner. Mevcut iş ve finans kartları erişilebilir kalır. |
| 2 | Tahsilat dönemlerini genişletme | Bu hafta ve bu ay tarih aralıkları sunucuda hesaplanır. Açılış fişleri hariç tutulur, dönem içindeki çek portföy kaydı ve bağlı hareket çift sayılmaz. |
| 2 | Fatura vade dönemleri | Döneme göre kalan tutar ve adet, iadeler, döviz ve açılış kayıtlarıyla birlikte kaynak raporlarla karşılaştırılır. |
| 2 | Rol bazlı şablonlar | Kullanıcının yetkili olduğu kaynaklardan seçenekler gösterilir. Seçimin önizlemesi açılır ve taslak kaydetmeden önce düzenlenebilir. |
| 2 | Tahsilat trendi | Haftalık ve aylık TL tutarları günlere ayrılır. Günlük değerlerin toplamı dönem kartıyla eşleşir ve her günün kuruşlu tutarı incelenebilir. |

## İlk sürüm veri sözleşmesi

- Fatura ve açılış vadeleri. Gecikmiş, bu hafta veya bu ay vadesi olan açık alacak ve borçlar seçilir. Haftalık ve aylık vade aralıkları dönemin tamamını kapsar. Tutar, adet veya en fazla beş kayıt gösterilir. Fatura tutarı kapamalardan sonra fatura kuruyla TL’ye çevrilir. Açılışlarda ödeme, dönem dışındaki önceki kalemlere de vade sırasıyla uygulanır.
- Tahsilat. Bugün, dün, bu hafta veya bu ay Türkiye takvimine göre seçilir. Hafta pazartesi, ay ayın ilk günü başlar ve güncel dönemler bugün kapanır. TL tutarı veya kayıt adedi gösterilir. Açılış fişleri dışarıda kalır. Aynı dönem içinde çek veya senedin kasa/banka tahsilatı varsa portföy kaydı tekrar sayılmaz. Haftalık ve aylık günlük trend, dönemle aynı çek eşleştirmesini uygular. Tahsilatı bulunan senet veya çek, bağlı hareket günüyle gösterilir. Verisi olmayan günler sıfırdır. Ayrı ayrı sorgulanan günlük kartların toplamı, günler arasında tahsil edilen çekler nedeniyle dönem kartıyla farklı olabilir.
- Kritik stok. Kritik seviyedeki stok kartı sayısı stok özetinden alınır.
- Sabah Onay. Kullanıcı kapsamındaki geçerli bekleyen hazırlıkların tamamı sayılır veya ilk beşi gösterilir. Kullanıcıya ait ve ortak hazırlıklar aynı kapsamda değerlendirilir.
- Tercih kaydı yalnız widget tanımlarını saklar. Her veri isteği kaynak uçtaki oturum, rol ve firma denetimine tabidir.

## Pilot kabulü

Yönetici ve muhasebe kullanıcılarıyla oluşturma, düzenleme ve sıralama akışını masaüstünde ve mobilde kontrol et. Gerçek tutarları ayrı ayrı kaynak raporla karşılaştır. Bir kaynak başarısız olduğunda sıfır görünmediğini, yetki kaldırıldığında kaynak verisinin gösterilmediğini ve farklı firmaların aynı kullanıcı tercihlerini paylaşmadığını doğrula.

İlk aşama ile haftalık ve aylık tahsilat ve fatura vade filtreleri ile rol bazlı widget şablonları ve tahsilat trendi uygulandı. Masaüstü ve mobil tarayıcı testleri oluşturma, önizleme, yeniden yükleme, düzenleme ve kaldırmayı kontrollü API yanıtlarıyla doğruladı. Pilot kabulünde veritabanı göçünün uygulanması ve gerçek firma rakamlarının kaynak raporlarla karşılaştırılması gerekiyor.


19 Kasım 2026'da göç ayrı PostgreSQL kabul veritabanına uygulandı ve masaüstü/mobil Chromium widget senaryoları yeniden geçti. İki sentetik firma ve yönetici/muhasebe kullanıcılarıyla tercih ayrımı ve eski sürümün reddedilmesi doğrulandı. Haftalık ve aylık tahsilat toplamları Tahsilat/Ödeme Özeti raporuyla, vade toplamları kaydedilen açık faturayla eşleşti. Günlük trend toplamı dönem toplamını verdi ve açılış fişi tahsilata katılmadı. [PostgreSQL kabul senaryosu](../apps/api/test/panel-widget.kabul.test.ts)

Kabul ortamında tahsilat ve vade raporu HTTP uçları muhasebe rolüyle önce başarılı yanıt verdi. Rapora erişim özel rolle kapatılınca iki uç da 403 döndü. [HTTP kabul senaryosu](../apps/api/test/panel-widget.kabul.test.ts)

Masaüstü ve mobil Chromium testlerinde kontrollü HTTP 403 ve 503 yanıtları ayrı mesajlar gösterdi. Hata sırasında önceki tutar ve sıfır gizlendi. Tekrar denemede kaynak geçerli sıfır döndürünce ₺0,00 gösterildi. [Tarayıcı kabul senaryosu](../apps/web/e2e/responsive-layouts.spec.ts)

## TekirExtra Demo Şirketi pilot yayını

19 Kasım 2026’da `panel-widget-demo-izole-20261119` paketi yerel pilota yayınlandı. Widget tercih API’si Demo şirketiyle sınırlı. Yayın öncesi PostgreSQL yedeği bütünlük denetiminden geçti ve `20261119090000_panel_widget_tercihleri` göçü uygulandı. Tercih tablosunda RLS ve FORCE RLS açık. Yayın sonrası API, web ve worker sağlık kontrolleri geçti.

Yayındaki API paketiyle yapılan salt okunur karşılaştırmada Demo şirketinin haftalık ve aylık tahsilat ve vade sonuçları kaynak kayıtlarla eşleşti. Her iki dönemde de tahsilat ve açık vade adedi sıfırdı. Sıfırdan farklı tutarlar ayrı kabul veritabanındaki senaryoda doğrulandı.

Uygulama paketine geri dönüş için `python3 scripts/pilot-yayin.py geri-don panel-widget-demo-izole-20261119` kullanılır. Ekleyici widget göçü veritabanında kalır.

## Tüm firmalara açılış

19 Kasım 2026’da yerel pilot API’sinden firma kısıtı kaldırıldı. API sağlık kontrolü ve Demo hesabıyla widget tercih isteği HTTP 200 döndü. Tercih kayıtları firma ve kullanıcı bazında yalıtılmaya devam ediyor. Kartların kaynak verileri mevcut rol ve paket yetkilerine tabi.
