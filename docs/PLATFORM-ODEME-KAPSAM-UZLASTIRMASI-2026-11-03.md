# Ödeme raporu kapsam uzlaştırması

IS-04 / PLT-67. Firma istatistiklerindeki sorunlu ödeme sayıları ve ödeme raporunun deneme tablosu aynı `platform_sorunlu_odeme_kapsami` işlevini kullanır.

Seçili başlangıç/bitiş Türkiye günleri kapsayıcıdır. Denemenin başlatıldığı tarih esas alınır; gelecekte oluşturulmuş kayıtlar dışlanır. Başarısız denemeler ve bir saatten eski sonuçlanmamış denemeler ayrı sayılır. Test ve canlı ortam birlikte sayılır. Paket filtresi firmanın güncel aboneliğine dayanır; tarihsel paket dağılımı olduğu iddia edilmez. Firma filtresi aynı kaynaktan uygulanır.

İstatistik bağlantısı tarih, paket, firma ve başarısız durumunu rapora taşır. Rapor durum seçimi ve 50 kayıtlık sayfalama sunar. Toplamlar 500 kayıtla kesilmez; eşit tarihler UUID ile kararlı sıralanır. Boş ileri sayfada toplam görünür ve ilk sayfaya dönülebilir. Güncel kart sorunları tarihsel deneme toplamına eklenmez; paket/firma filtresi varken ayrı kart bölümü gizlenir ve nedeni açıklanır.

Yeni migration: `20261103190000_platform_odeme_kapsami`. Yalnız platform rolünün çağırabildiği dar SECURITY DEFINER işlevi; kiracı tablolarına ek doğrudan okuma yetkisi yoktur. İstatistik API yanıtı yalnız ödeme sayılarını taşır, ham deneme ayrıntısı taşımaz. Önceki 7 günlük alan geriye uyumluluk için korunur; ekranda seçili dönem sayıları kullanılır.

Doğrulama: 17 PostgreSQL kabul testi (istatistik, kullanım/operasyon ve ödeme kapsamı), 23 ilgili birim testi, 18 Chromium senaryosu geçti. API ve web TypeScript ve değişen uygulama dosyalarının ESLint kontrolleri temiz. API sayaç/rapor eşitliğini de içeren son 4 PostgreSQL testi ayrıca geçti. Yanlışlıkla genişleyen genel birim koşusunda 2945 test geçti, kapsam dışındaki dört test zaman aşımına uğradı; genel test paketinin tamamı geçtiği iddia edilmez.

Bu teslim mevcut yerel veritabanına veya 3100 derlemesine uygulanmadı. IS-04 tarihsel operasyon eğilimleri, T3 paket kataloğu ve T4 duyuruları kalan kapsamdır. T2 bütünü tamamlanmış sayılmaz.
