# Gelen e-Fatura fiyat kontrolü

Gelen kutusunda belgeyi açın, ürün/varyant eşleşmelerini doğrulayın ve **Fiyatları karşılaştır** düğmesini kullanın. Analiz yalnız seçili/eşleşmiş satırları kapsar; fatura oluşturmaz, kabul/ret göndermez, fiyat değiştirmez. Bu sürüm yapay zekâ modülünün sayısal analiz altyapısıdır; üretken model yorumu ve dış servise veri aktarımı yoktur.

## Gösterilen karşılaştırmalar

- Gelen net birim fiyatı ile aynı tedarikçinin son kesin alış fiyatının yüzdelik farkı.
- Her tedarikçinin son 90 gün içindeki en son alış faturası: net fiyat, kaynak bağlantısı, gelen fiyata ve listedeki en ucuz tedarikçiye göre fark. Aynı faturadaki aynı ürün/varyant satırları miktar ağırlıklı birleştirilir. Aynı belge günündeki faturalar kayıt zamanına göre sıralanır.
- Belge tarihinden önceki son 12 ay ile ondan önceki 12 ayın miktar ağırlıklı fiyat ortalaması ve değişimi. Tüm tedarikçiler ve aynı tedarikçi ayrı gösterilir. Bu, takvim yılı ortalaması veya bugünkü fiyatın geçen yılın aynı günündeki fiyatına oranı değildir.

## Hesap ve sınırlar

Net fiyat = satırın iskontolar sonrası, KDV/ek vergiler hariç tutarı / miktar. UBL `LineExtensionAmount` satır iskontosunu zaten içerir; belge düzeyi iskonto net satır tutarlarına orantılı dağıtılır (kuruş farkı son satırda). Tarihi alışta kesinleşmiş `FaturaSatir.matrah` kullanılır; bu alan genel iskontoyu da içerir. Hesaplar Decimal kullanır; net birim fiyat 6, yüzdelik fark 2 ondalıkla gösterilir.

Yalnız aynı tenant, stok kartı, varyant, normalize edilmiş birim ve aynı döviz karşılaştırılır. Döviz dönüşümü ve alternatif birim katsayısı dönüşümü yapılmaz. Geçmiş sorgusu belge gününü içermez; sonradan işlenmiş kendi faturası da dışlanır. Taslak, iptal, satış, iade ve özel matrah faturaları geçmiş fiyat değildir. İade/özel matrah gelen belgeler ve belge düzeyi artırım içeren belgeler desteklenmez. Belge/satır tutarları tutarsızsa analiz durur. Sıfır/negatif miktar veya net bedel karşılaştırılmaz.

Gönderen VKN için birden fazla uygun cari varsa sistem birini tahmin etmez; aynı tedarikçi karşılaştırması boş kalır. Her eşleştirme tenant'a ait kart/varyantla doğrulanır. Bir istekte en çok 100 satır, her ürün/varyant için son iki yıldan en çok 2.000 geçmiş satır incelenir. Sınır aşılırsa açık uyarı gösterilir ve yıllık artış hesaplanmaz. Eşleştirme değişirse eski ekran sonucu kaldırılır.

Yıllık artış nominaldir; enflasyondan arındırılmaz. Tüm tedarikçi ortalamasındaki değişim, tedarikçi/miktar karmasının değişmesinden de kaynaklanabilir. Tarihi fiyat güncel teklif değildir; miktar, vade, kalite, navlun ve teslim koşullarının eşdeğer olduğu iddia edilmez. Yeterli geçmiş yoksa artış uydurulmaz.

## API ve doğrulama

`POST /ebelge/gelen/:id/fiyat-analizi` — e-Fatura uygulama kapısı ve muhasebe rolü. Gövde yalnız `satirEslesmeleri: [{siraNo, stokId, varyantId?}]` kabul eder; fiyat/tutar istemciden alınmaz. Okuma `tenantIslem` içinde RLS ile yapılır. Yeni tablo/migration gerekmez.

İlgili birim testleri: `fiyat-analizi.test.ts`, `gelen-fiyat-analizi.service.test.ts`. Gerçek PostgreSQL/UBL/tenant izolasyonu ve salt okunur davranış testi: `test/gelen-fiyat-analizi.kabul.test.ts`; yalnız kendi oluşturduğu verileri tek transaction sonunda rollback eder.

Sonraki aşamalar: kullanıcı tanımlı artış uyarı eşiği, tarihsel birim/kur normalizasyonu, aylık trend grafiği, miktar/vade segmentasyonu ve doğrulanmış veriler üzerinden isteğe bağlı yapay zekâ yorumu.
