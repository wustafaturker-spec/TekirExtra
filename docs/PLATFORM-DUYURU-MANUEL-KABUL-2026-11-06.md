# Gerçek işletme hesabıyla duyuru kabulü

Durum: Kullanıcı manuel kabulü gerekli görmediğini belirtti; uygulanmadı. Bu belge hazırlanan planı saklar ve testin yapıldığına dair kanıt değildir.

## Hesaplar ve kapsam

- İşletme: henüz belirtilmedi.
- Platform yöneticisi: mevcut hesap; girişi kullanıcı yapar.
- Firma kullanıcısı ve rolü: girişten sonra doğrulanacak.
- Parola, 2FA kodu veya tarayıcı oturumu dışa aktarılmaz.
- Test için yeni işletme veya kullanıcı oluşturulmaz.

## Hazırlanacak duyuru

Başlık: `Duyuru sistemi — manuel pilot kabulü`

İçerik: `Bu duyuru, duyuru sisteminin kullanıcı kabulü için hazırlanmıştır. Görüntüleme, okudum, yönlendirme ve erteleme adımları kontrol edilecektir.`

Yönlendirme: `Duyuru merkezini aç` → `/panel/duyurular`.

Hedef yalnız kullanıcının belirttiği işletme ve doğrulanan firma hesabının rolüdür. Önizlemede gerçek alıcı sayısı görülmeden yayın yapılmaz. Yerleşimler merkez, üst bant, normal popup ve genel panel kartıdır. Yerleşimleri ayrı ayrı gözlemleyebilmek için ilk duyuruda tekrar politikası her görüntülemede, popup önceliği 1 ve erteleme 1 saattir. Bitiş saati yayın hazırlığında Türkiye saatine göre belirlenir; planlanan test süresi 1 saattir. Başka yayınların içeriği veya tercihleri değiştirilmez.

## Kabul adımları

1. Platform ve firma girişleri kullanıcı tarafından tamamlanır; doğru işletme ve rol doğrulanır.
2. Taslak hazırlanır; kullanıcıya ait olmayan veri içermeyen bir kabul görseli seçilir. Biçimlendirme, görsel ve düğme önizlemede kontrol edilir.
3. Firma/rol seçimi, gerçek alıcı sayısı, yerleşimler ve bitiş saati birlikte kontrol edilir. Yayın onayı ardından kayıt kimliği ve saat kabul kaydına yazılır.
4. Firma hesabında popup, üst bant, genel panel kartı ve merkez kontrol edilir.
5. Popup erteleme, merkezde okudum, yenileme sonrası kalıcılık ve yönlendirme kontrol edilir; kayıtlı tercih ve rapor birlikte değerlendirilir.
6. Platform raporunda hedef paydası, benzersiz gösterim, okudum, tıklama ve erteleme kontrol edilir. Gerçek işletmedeki diğer uygun alıcıların etkileşimi varsa sayılar test kullanıcısına indirgenmez.
7. Kabul duyurusu durdurulur; firma ekranı yenilendiğinde kaldırıldığı doğrulanır. Oluşmuş geçmiş ve olay kayıtları silinmez.

Bir kez tekrarının ayrıca kullanıcıyla doğrulanması istenirse yalnız popup yerleşimli ikinci bir kabul duyurusu hazırlanır ve aynı hedef önizlemesi kontrol edilir. Farklı otomatik yerleşimler arasında paylaşılan bir kez kuralı, ilk duyurunun bütün yerleşimlerini gözlemleme adımıyla karıştırılmaz.

## Sonuç kaydı

Kullanıcının 6 Kasım 2026 tarihli kararıyla manuel kabul yürütülmedi. Gerçek PostgreSQL ve izole gerçek HTTP/tarayıcı kabullerinin kanıtları ayrı kabul belgelerindedir.
