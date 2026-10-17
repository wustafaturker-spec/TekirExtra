# F01 — Kalıcı maliyet inceleme kaydı

**Sonraki teslim:** [Kaynak doğrulaması ve kontrollü kapanış](F01-KAYNAK-DOGRULAMA-VE-KAPANIS-2026-10-15.md). Aşağıdaki kapsam ve 58 test sonucu bu önceki teslimin tarihsel kaydıdır.

15.10.2026. Liste ve Excel tesliminin devamı. Satış maliyet kontrolündeki **İnceleme kaydı** düğmesi, kaynak satış satırına bağlı bir inceleme açar; notlar ve durumlar mevcut Düzeltme Merkezi tablolarında saklanır. Yeni tablo veya migration yoktur. Çalışan canlı süreçler değiştirilmez.

## Kullanım ve anlam

Yönetici ve muhasebe ilk notla inceleme başlatır. Açık kayıt üzerinde not ve `incelemede`/`beklemede` durumu birlikte kaydedilir. Notlar kullanıcı ve zamanla işlem geçmişine eklenir; önceki notlar ezilmez. Aynı kaynak için açık kayıt varsa tekrar açılış ikinci kayıt/ilk olay üretmez; arayüz kullanıcıyı mevcut kayda not eklemeye yönlendirir.

Mali müşavir, salt okunur ve maliyet muhasebesi geçmişi okuyabilir; yazma formu ve doğrudan yazma API yetkisi yoktur. Düzeltme Merkezi'nin genel yetkileri genişletilmez. Maliyet okuyucularına yalnız bu kaynak türünün özel okuma ucu açılır.

Takip durumu maliyet doğrulaması değildir. Bu akış mali tutar, stok hareketi veya kâr hesabı yazmaz; liste uyarısını ve toplamlarını değiştirmez. Başlatma anında ortak satış kaynağı yeniden okunur; kayıt yalnız mevcut sıfır maliyet uyarısı koşuluna uyan kesin mal satışı için açılır. Meşru sıfır maliyet veya kesin kök neden otomatik kararlaştırılmaz.

Bu dilimde doğrulanmış çözüm kapatma yoktur. Kaynak sorun artık görünmedi diye kayıt otomatik çözülmez. Önceki merkezde kapanmış kayıtların geçmişi korunur; kaynak hâlâ uyarı veriyorsa yeni inceleme açılabilir. Okuma aktif kaydı, aktif yoksa en son kaydı gösterir. Her kaydın en son 50 olayı toplam olay sayısıyla birlikte gösterilir; eski olaylar silinmez.

## API ve bütünlük

- `GET /rapor/maliyet-eksikleri/:satirId/takip`: maliyet okuma rolleri. Yanıt `{ kayit }`; kayıt yoksa `null`.
- `POST` aynı yol: yönetici/muhasebe. Gövde `{ aciklama }`, kırpılmış 2–2000 karakter. Yanıt `{ kayit, zatenVardi }`.
- `PATCH` aynı yol: yönetici/muhasebe. Gövde `{ aciklama, durum, beklenenGuncelleme }`. Sürüm, GET/POST yanıtındaki `updatedAt` değerinin aynısıdır. `durum` yalnız `incelemede` veya `beklemede` olabilir. Maliyet/sahiplik alanları ve beklenmeyen alanlar kabul edilmez.

Kaynak kimliği UUID doğrulanır; her okuma ve yazmada kaynak tenant içinde aranır. Başka tenantın veya olmayan kaynağın kimliği 404 verir. Mevcut `duzeltme_kayitlari` ve `duzeltme_olaylari` RLS/FORCE politikaları kullanılır. Yazma yetkisi olmayan rol 403 alır.

Kaynak: `kaynakTur=fatura_satiri`, `kaynakRef=satirId`, `nedenKodu=SATIS_MALIYET_KONTROLU`. Açık kayıt tekillik anahtarı tenant ile birlikte kullanılır. Açılışta kaynak satırı, güncellemede inceleme kaydı işlem sonuna kadar kilitlenir. Kayıt ve olay aynı transaction içinde yazılır. Notların sürümü monoton `updatedAt` ile ilerler; eski sürüm 409 alır. Arayüz bu durumda taslak notu korur ve geçmiş yenilenmeden tekrar kaydetmez.

Bu, mevcut genel Düzeltme Merkezi'nin tüm yazma yollarına sürümleme eklenmiş olduğu anlamına gelmez. Yeni inceleme uçlarının kendi kayıt yazımı ve eski sürüm reddi bu teslim kapsamındadır. Gerçek maliyet değişimi/çözüm yarışı kabulü sonraki kapsamdadır.

## Doğrulama

Sonuç: 58 ayrı test geçti — 47 birim/gerileme, 1 gerçek DB/HTTP kabul senaryosu ve 10 üretim Chromium senaryosu. DB senaryosu kaynak koduyla ve son derlenmiş API ile geçti. API TypeScript ve web üretim derlemeleri başarılı. Son web build kimliği: `U9_Wc_KpsMW4qOwkkxv0O`.

Test kapsamı: girdi ve rol matrisi; kayıt açılışı/tekrar isteği, not ve durumun kalıcılığı, kaynak koşuluna uymayan satışın reddi, yabancı tenant kaynağının reddi, eski sürümle yazma, kapanmış geçmişin korunması, RLS/FORCE ve mali tutarların önce/sonra eşitliği. DB senaryosu sentetik tenantları işlem sonunda rollback eder.

Tarayıcı kapsamı: muhasebenin inceleme açıp not/durum kaydetmesi ve yenilemede geçmişi görmesi; panel açılınca klavye odağının inceleme bölümüne taşınması; salt okunur rolün form görmemesi; 409 sonrasında taslağın korunması, geçmişi yenileme ve yeni sürümle tekrar kaydetme. Önceki liste/Excel/önizleme senaryoları da korunur. Tarayıcıdaki yazma API'leri taklittir; gerçek DB yazımı yalnız rollback testindedir.

```sh
# apps/api
pnpm exec vitest run src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts
pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-f01-takip-api-dist
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-f01-takip-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-takip-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-takip-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Kalan kapsam

F01-03'ün kalıcı inceleme/not/durum kısmı uygulanır; CSV durumu tam kabul bitmediği için `devam_ediyor` kalır. Kanıtlı kaynak doğrulaması ve çözüm kapanışı, gerçek maliyet değişimiyle eşzamanlılık testleri, paket bazında kontrollü açılış ve pilot ölçümü henüz tamamlanmadı. Yeni kayıtların mevcut genel taramada otomatik kapanması eklenmedi. İnceleme notu kapalı dönem maliyetini açmaz/değiştirmez; mevcut yönetici maliyet önizleme/uygulama yetkileri korunur.
