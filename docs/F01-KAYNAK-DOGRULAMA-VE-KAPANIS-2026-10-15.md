# F01 — Kaynak doğrulaması ve kontrollü inceleme kapanışı

**Son eşzamanlılık kabulü:** [Ayrı bağlantılarda yedi yarış ve ek birim kilidi](F01-ESZAMANLILIK-KABULU-2026-10-15.md).

**Sonraki doğrulama:** [API asistan derleme ve kapsam düzeltmesi](API-ASISTAN-DERLEME-VE-KAPSAM-DUZELTMESI-2026-10-15.md). Bu belgede aşağıda kaydedilen tam API derleme engeli sonraki teslimde giderildi; yeni başarılı çıktı ve kabul kanıtı bağlantıdadır. Aşağıdaki sonuçlar ilk kapanış tesliminin tarihsel kaydıdır.

15.10.2026. Kalıcı inceleme takibinin devamı. Çalışma alanında uygulanmıştır; canlı servisler değiştirilmemiştir. Bu teslim yeni tablo, migration veya mali kayıt değişikliği içermez.

## Kullanım ve sınır

İnceleme panelindeki kaynak doğrulaması, mevcut satış ve stok hareketlerini yeniden okur. Uygun sonuçtan sonra yönetici veya muhasebe kullanıcısı 2–2000 karakterlik notla incelemeyi açıkça kapatabilir. Mali müşavir, salt okunur ve maliyet muhasebesi rolleri doğrulamayı ve geçmişi okuyabilir; kapatma yazamaz.

Doğrulama, kayıtlı pozitif maliyetin ve hareket kapsamının tutarlılığını kontrol eder. Alış değerlemesinin bağımsız muhasebe doğrulaması veya maliyet düzeltmesi değildir. Kapatma yalnız inceleme durumunu `cozuldu` yapar. Fatura, stok hareketi, maliyet, dönem ve kâr hesaplarını değiştirmez. Kaynak uyarısının azalması, ayrı bir işlemde gerçek kaynak maliyetinin düzeltilmesine bağlıdır; not veya kapanış uyarıyı bastırmaz.

Kesin ve pozitif cirolu mal satışı, açık inceleme, pozitif kayıtlı maliyet, tanımlı birimler ve tam hareket miktarı gerekir. Aynı stok/fatura grubundaki miktarlar mevcut birim dönüşüm servisiyle ana birime çevrilir; tanımsız birim için katsayı varsayılmaz. Hareketler kayıtlı birim maliyetine göre netlenir. Tamamen terslenmiş dilimler etkisizdir; kalan her dilimde pozitif maliyet ve net çıkış bulunmalı, toplam çıkış satış miktarına eşit olmalıdır. Pozitif toplamın içindeki kısmi sıfır maliyet böylece kapanışa uygun sayılmaz. Sıfır/negatif maliyet, eksik hareket ve değişmiş belge reddedilir. Varyantlı kaynaklar bu teslimde ayrıntılı incelemeye bırakılır; kapatma açılmaz.

Uyarı listesinden çıkmış satışın incelemesi `?inceleme=<satirId>` bağlantısıyla açılır. Düzeltme Merkezi'ndeki bu kayıt türünün kaynak doğrulama eylemi de aynı panele gider. Kapanış ve sayfa yenilemesinden sonra geçmiş görünür kalır; kaynak artık uyarı değilse yeni inceleme başlatma önerilmez.

## API, sürüm ve denetim izi

- `GET /rapor/maliyet-eksikleri/:satirId/takip/dogrulama`: maliyet okuma rolleri. Uygunluk, gerekçe, kaynak kimliği, kayıtlı ciro/maliyet, hareket sayısı, kayıt sürümü ve uygun sonuçta kaynak özeti SHA-256 değeri döner.
- `POST /rapor/maliyet-eksikleri/:satirId/takip/kapat`: yönetici/muhasebe. Gövde `{ kayitId, beklenenGuncelleme, kanit, aciklama }`; bilinmeyen alanlar ve istemci mali tutarları kabul edilmez.

Her işlem tenant kapsamındadır. Kapatma önce stok kartını, faturayı, ilgili fatura satırlarını ve stok hareketlerini; ardından inceleme kaydını kilitler. Mevcut maliyet uygulamasının stok kartıyla başlayan kilit sırası korunur. Kaynak aynı transaction içinde yeniden okunur; uygunluk, kayıt kimliği, tam sürüm ve kaynak özeti tekrar karşılaştırılır. Eski kaynak/sürüm veya ikinci kapatma 409 verir. Arayüz not taslağını korur ve tekrar doğrulama ister.

Durum değişikliği, kullanıcı/zaman/not içeren `DuzeltmeOlayi` ve `AuditLog` aynı transaction içinde yazılır. Audit ayrıntısında kaynak satır/fatura/stok kimlikleri, doğrulama özeti, kayıtlı tutarlar ve hareket sayısı bulunur. Kullanıcı geçmişinde anlaşılır tutar ve açıklama gösterilir. Son inceleme seçiminde açık kayıt önceliklidir; kapanmış geçmişte oluşturulma zamanı esas alınır.

Bu mekanizma bütün uygulama yazma yollarının eşzamanlılık kabulünün tamamlandığı anlamına gelmez. Ayrı bağlantılarda gerçek maliyet uygulaması, belge geri alma, birim tanımı değişimi ve inceleme kapanışının yarış senaryoları pilot öncesinde ayrıca doğrulanmalıdır.

## Doğrulama ve yayın adayı

Tarayıcıda 13 üretim Chromium senaryosu geçti. Kaynak değişince kapanışın durması, taslağın korunması, kısmi maliyetin reddi, listeden çıkan kaynağın bağlantıyla açılması ve kapanış geçmişinin yenilemede korunması kapsanır. Tarayıcı API yanıtları taklittir; gerçek mali kayıt yazılmaz.

Toplam 75 ayrı test geçti: 61 birim/gerileme, 1 gerçek PostgreSQL/Nest HTTP kabul senaryosu ve 13 tarayıcı senaryosu. DB/HTTP senaryosu kaynak koduyla ve son TypeScript çalıştırmasının ürettiği F01 koduyla geçti; aynı senaryonun tekrar çalışması test sayısına ayrıca eklenmedi. Kabul senaryosu, fiyat değişiminden sonra eski kanıtın reddini, eksik hareket/birim/belge koşullarını, yeni doğrulamayla kapanışı, audit/olay kaydını, tekrar kapatmanın reddini ve kapanış öncesi/sonrası mali tutarların eşitliğini sınar. Sentetik tenant verileri rollback edilir; hareket silme/miktar değiştirme veritabanı korumaları gevşetilmez.

Web üretim derlemesi başarılıdır: `.next-f01-kapat-release-20261015`, build kimliği `K_tsH9z6yLJOPn3OWmKwv`. Son API çıktısı `/tmp/tekirextra-f01-kapat-api-dist` dizinindedir ve F01 kabulü bu çıktıyla geçmiştir. **Tam API derlemesi başarılı değildir:** çalışma alanındaki ayrı `assistant` modülünde `contracts/intelligence` dosyalarının `rootDir` dışında kalması (`TS6059`) ve Prisma alan/tip uyuşmazlıkları (`cari`, `isletmeKodu`, `bakiye`, `paraBirimi`, `bankaHesabi`) derlemeyi exit 2 ile durdurmuştur. TypeScript'in hata durumunda JavaScript üretmiş olması yayın kabulü sayılmaz. Bu ayrı dosyalar değiştirilmemiştir; tam API derlemesi düzelmeden bu çıktı canlıya alınmamalıdır.

```sh
# apps/api
pnpm exec vitest run src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-f01-kapat-api-dist
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-f01-kapat-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-kapat-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-kapat-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Kalan kabul

F01 CSV görevleri `devam_ediyor` kalır. Ayrıntılı varyant/birim ve kapalı dönem kabulü, ayrı bağlantılarda gerçek yarış testleri, paket bazında kontrollü açılış, pilot kullanıcı ölçümü ve canlı yayın tamamlanmadı. Mevcut yönetici maliyet önizleme/uygulama yetkileri korunur; bu teslim sıfır maliyeti otomatik doldurmaz ve genel taramayla inceleme kapatmaz.
