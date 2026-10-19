# F03 — Kapama dağıtımı hacim kabulü

19 Ekim 2026. İade hacim kabulünden sonraki açık kapama hacim işi tamamlandı. Mevcut servis korumalarına kalıcı regresyon eklendi; uygulama kodu ve mali kayıtlar değiştirilmedi.

## Gerçek PostgreSQL

59/59 CRM/belge kabul testi geçti. Önceki 57 senaryoya eklenen iki yeni test:

- Aynı faturada 5000 ayrı gerçek kasa/banka tahsilatı ve kapama fixture'ı oluşturulur. Toplam 50 TRY, doğrulanmış 100,10 TRY satış payının altındadır. Bütün 5000 kapama geçerli okunur, birine 0,01 TRY pay yazılır. 5001'inci kapama eklenince okuma ve yeni istek anahtarlı yazma 409 ile bütünüyle reddedilir; pay ve audit sayıları değişmez.
- 25 kapamada 200'er sürümle 5000 pay geçmişi oluşturulur. Tam geçmiş okunur; sıfır sürümlü ayrı bir kapamaya yeni pay yazımı doğrudan geçmiş limiti gerekçesiyle reddedilir. 5001'inci geçmiş kaydında okuma da 409 olur. Hacim sınırı, kanıtı güncel olmayan geçmişi de sayar. Yeni audit oluşmaz.

Veriler nonce, uygulama rolü ve geçici DB portu denetlenen izole PostgreSQL'dedir. Rol superuser/BYPASSRLS değildir. Geçici DB durdurulup silindi; gerçek şirket verisi kullanılmadı.

## Okuyucu ve ekran

Üç birim testi geçti: normal kaynakta satış payının korunması, kapama sorgusunda ve geçmiş sorgusunda 5001 satırın kısmi sonuç yerine 409 üretmesi. DB yanıtları bu katmanda sahtelenir; üstteki iki senaryo gerçek DB davranışını doğrular.

Hazır üretim standalone web paketinde 17/17 CRM tarayıcı senaryosu geçti. Yeni test, kapama hacim hatasının ilk yüklemede açık gösterildiğini, boş liste/tutar veya yazılabilir form sunulmadığını ve yazma isteği oluşmadığını doğrular. Diğer senaryolar teklif, kapama/iade dağıtımı, çatışma taslağı, rol ve mobil görünümü kapsar. Tarayıcı uçları fixture yanıtları kullanır; gerçek HTTP birleşik kabulü önceki teslimde ayrı doğrulanmıştır.

## Kanıtlar ve kapsam

- `.release-candidates/f03-kapama-hacim-20261019/db-kabul.log`: 59 DB senaryosu ve temizlik.
- Aynı dizinde `tarayici/sonuc.json` ve `kabul-ozeti.json`.
- Kalıcı testler: `apps/api/src/crm/crm-kapama-hacim.test.ts`, `apps/api/test/crm-belge.kabul.test.ts`, `apps/web/e2e/crm-belge.spec.ts`.
- Ortak üretim paketi tarayıcı koşucusu: `apps/web/playwright.crm-hacim.config.ts`; kanıt dizini `F03_TEST_EVIDENCE` ile ayrılır.

Bu teslim kapasite/p95 garantisi veya bütün fiziksel stok/seri/lot senaryolarının kabulü değildir. Gerçek şirket alan pilotu açık kalır. Çalışan yerel paket `.release-candidates/f03-iade-revizyon-20261019/compose.json` olarak korunur; yeni yayın veya migration gerekmemiştir.
