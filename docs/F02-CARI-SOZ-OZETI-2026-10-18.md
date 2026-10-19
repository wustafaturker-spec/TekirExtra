# F02 — Cari bazında ödeme sözü özeti

## Devam dilimi: döviz bazında gerçekleşme oranı

Özet kartına her döviz için güncel gerçekleşenin geçerli aktif söz toplamına oranı eklendi. Hesap kuruş tam sayılarıyla yapılır ve yüzde iki ondalıkta yarım yukarı yuvarlanır. Dövizler birleştirilmez; iptal/revize ve faturası geçersiz sözler paya da paydaya da girmez. Bu oran güncel kaynak snapshot'ını anlatır; söz gününde tahsilat veya tarihsel kohort başarısı değildir. Bu küçük devam dilimi için otomatik test ve üretim derlemesi çalıştırılmadı; aşağıdaki test sonuçları oran alanını kapsamıyor.

18 Ekim 2026. Cari detayındaki Tahsilat sekmesine salt okunur söz özeti eklendi. Bu değişiklik çalışma alanındadır; önceki `cekirdek-aday-20261018-3` sabit paketine dahil değildir. Gerçek şirket pilotu ve yayın yapılmadı.

## Gösterilen kapsam

Özet, mevcut ödeme sözü liste yanıtındaki aynı carinin tüm geçmişini kullanır. Yeni sorgu, mali kayıt veya kalıcı özet tablosu oluşturmaz. Toplam kayıt ile aktif/iptal/revize sayıları birlikte görünür. Aktif, kaydın yaşam döngüsünü ifade eder; tamamen gerçekleşmiş bir söz de mantıksal olarak aktif olabilir. Tam/kısmi gerçekleşme ve söz günü geçmiş, kalanı olan kayıtlar ayrıca sayılır. İptal ve revizyon geçmişi sayıdan silinmez; eski revizyon tutarı yeni söze eklenmez.

Tutarlar yalnız faturası geçerli aktif sözlerden, döviz bazında ayrı hesaplanır: söz toplamı, güncel gerçekleşen, sözlerden kalan ve söz günü geçmiş kalan. Kur çevrimi veya farklı dövizleri toplayan genel tutar yoktur. Geçersiz fatura sayısı açıkça gösterilir ve bu kayıtların tutarı özete katılmaz. Geçerli aktif kayıt yoksa tutar uydurulmaz.

Tutarlar BigInt kuruşla toplanır; 1.000 adet azami büyüklükte sözün toplamı da kuruş kaybetmez. Tek söz girişinin para sınırı değiştirilmedi; yalnız özet biçimleyicisi toplamın daha büyük olmasını destekler. Gecikme günü tarayıcı saatinden değil API yanıtının ölçüm zamanının Türkiye gününden türetilir. Bugünkü söz, kalanı olsa da henüz gecikmiş sayılmaz. Liste yenilendiğinde ödeme geri alma dahil yeni gerçekleşme kaynağı özetin tamamını değiştirir; istemcide ayrı kalıcı başarı damgası yoktur.

Özet aynı mevcut rol ve şirket modu altında görünür. Kapalı mod/yanlış cari/tekrar kimlik/tutarsız tutar gibi doğrulanamayan yanıtlarda finansal özet üretilmez. Satış rolü için tahsilat sekmesi ve söz isteği açılmaz; salt okunur rol/modda özet görüntülenir, yeni yazma yetkisi verilmez.

## Metrik sınırı

Güncel gerçekleşme oranı, ödemenin söz tarihinde zamanında yapıldığını kanıtlamaz. Bu dilim zamanında tutulma oranı, takipten tahsilata dönüşüm veya takip süresi hesaplamaz. Bunlar için tarih/kohort ve kaynak sözleşmesi ile pilot baz/sonuç ölçümü gerekir. F02-03/04 tamamlanmış sayılmaz; cari özeti ilk ölçüm desteğidir.

Zamanında tutulma ölçümünden önce ürün ve muhasebe sahibi şu kuralları karara bağlamalıdır:

- Payda, vadesi gelmiş söz sürümlerinden mi oluşur? Revize/iptal edilen eski sözler başarısız sayılırsa haklı revizyonlar oranı düşürür; dışlanırsa yalnız güncel aktif sözleri saymak survivorship yanlılığı yaratabilir.
- Gerçekleşme, söz gününe kadar olan tahsilatın o günkü net tutarı mıdır? Bugünkü kapama snapshot'ı geçmişteki tam tahsilatı kanıtlamaz; daha sonra geri alınan tahsilatın tarihsel sonuçtan düşülmesi ayrıca tanımlanmalıdır.
- Takipten tahsilata dönüşümde takip mi, söz mü kohort birimidir; açık takipler paydada kalır mı; bir takipteki birden fazla söz/ödeme nasıl sayılır?
- Takip süresi başlangıcı takip oluşturma, ilk görüşme veya söz verme anı mıdır; bitişi ilk kısmi tahsilat, tam tahsilat ya da takip kapanışı mıdır?

Mevcut model güncel takip durumunu ve söz bağlantısını tutar; kapanışın değişmez olay zaman çizelgesini, söz vade anındaki tahsilat snapshot'ını veya sonradan geri alınan ödemenin geçmiş sonucuna etkisini saklamaz. Fatura kapama/hareket kaynağı bugünkü bakiyeyi uzlaştırır, tarihsel ölçüm kaydı değildir. Bu kararlar ve kanıt kaynağı belirlenmeden oran yayınlanmamalı; ölçüm eklenirse finansal defterden ayrı, kaynak kimliği/sürümü ve ölçüm zamanı taşıyan bir analiz kaydı olmalı.

## Doğrulama yöntemi

Para/kapsam sözleşmesinin 36 mevcut ve özetin 15 yeni birim testi: 51 test geçti. Boş veri, döviz ayrımı, iptal/revizyon, geçersiz fatura, Türkiye gece yarısı, bugünkü vade, tamamlanmış söz, geri alma sonrası yenileme, 1.000 büyük tutar, kaynak değişmezliği ve tutarsız yanıt retleri kapsandı. Web tam TypeScript kontrolü yapıldı.

Tarayıcı için kaynaklar `.release-candidates/f02-soz-ozeti-20261018/apps/web` dizinine kopyalandı; Next geliştirme sunucusu bu kopyadan çalıştı. Ana çalışma alanının Next ayarlarına test çıktısı eklenmedi. Bu koşum API fixture'ları ve test oturumu kullanır; gerçek parola/API veya üretim standalone kabulü değildir. Önceki gerçek API kabulünün kanıtları korunur, bu yeni özeti kapsadığı iddia edilmez.

İlk koşumda eski fixture cari durum paneline boş `{}` yanıtı verdiği için ekran hata verdi; koşum durduruldu. Cari durum, AI kullanılabilirlik ve boş takip listesi sözleşmeleri fixture'a eklendi. İlk rapor ve trace'ler ayrı tutuldu; ikinci koşumun rapor/çıktı dizinleri farklıdır.

## Son kabul

İkinci tarayıcı koşumunda 19 senaryonun 18'i geçti; tek hata, geliştirme modundaki fazladan ilk GET nedeniyle eski testin sabit toplam okuma beklentisiydi. Beklenti mevcut sayıya göre bir artış olacak şekilde düzeltildi; yalnız bu test üçüncü koşumda geçti. Böylece 19 senaryo iki koşum birlikte değerlendirilerek doğrulandı; tek koşumda 19/19 iddiası değildir. Yeni üç senaryo ikinci koşumda geçti: geçmiş/döviz/geçersiz fatura ayrımı; geri alma sonrası yenileme; mobil salt okunur görünümde yazma isteği olmaması ve sayfa taşmaması.

[Birleşik kabul özeti](../.release-candidates/f02-soz-ozeti-20261018/kabul-ozeti.json), iki ham raporun ve son kaynakların SHA-256 değerlerini içerir. Son kaynaklar çalışma alanıyla karşılaştırıldı. [Mobil görüntü](../.release-candidates/f02-soz-ozeti-20261018/test-results-2/odeme-sozu-mobil-salt-okun-7ab3e-nür-ve-yazma-isteği-oluşmaz/soz-ozeti-mobil.png) incelendi. Web tam TypeScript kontrolü başarılı; `git diff --check` temiz.

Yeniden doğrulama, web dizininden:

```sh
pnpm exec vitest run src/lib/odeme-sozu.test.ts src/lib/odeme-sozu-ozeti.test.ts
pnpm exec tsc --noEmit --incremental false
pnpm exec playwright test --config playwright.odeme-sozu.config.ts
```

Bu son komut normal depo geliştirme testidir; kaydedilen kanıt, belgedeki ayrı kaynak kopyasında Chromium ile çalıştırılmıştır. Üretim derlemesi ve yeni sabit aday kabulü ayrıca gerekir. Gerçek pilot ölçümü, zamanında tutulma/dönüşüm oranı ve takip süresi açık kalır.
