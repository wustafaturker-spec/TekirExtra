# F03 — İade payı revizyonunda satış kapasitesi

19 Ekim 2026. Sıradaki sınır incelemesinde, mevcut ticari iade payı revize edilirken üst sınırın fazla hesaplandığı bulundu.

Mevcut pay zaten kullanılan toplamdan çıkarılıyordu; kalan satış kapasitesine aynı pay tekrar ekleniyordu. 100,10 TRY satış payı ve 80 TRY mevcut iade payında, 150 TRY iadeye karşı ekran 150 TRY revizyon limiti verebiliyordu. Başka iadede 20 TRY ve revize edilende 40 TRY kullanılmışken sınır 80,10 yerine 120,10 TRY çıkıyordu.

`crm-iade-paylari.ts` içindeki iki üst sınır hesabından ikinci ekleme kaldırıldı. Yeni payın azamisi, iadenin diğer kaynak/fırsatlardan kalan matrahı ve bu satış kaynağının diğer iadelerden kalan fırsat payının küçüğüdür. İstek kaydedilmeden önce mevcut kilitli/sürümlü transaction içinde yeniden hesaplanır. Geçmiş veya finans kayıtları değiştirilmez; kaynak kanıtı ve idempotency sözleşmesi aynı kalır.

## Kabul

İki yeni gerçek PostgreSQL regresyonu önce eski kodda beklenen sınır uyuşmazlığıyla başarısız oldu. Düzeltmeden sonra 55/55 CRM/belge PostgreSQL ve RLS kabul testi geçti. Yeni senaryolar:

- 100,10 TRY sınırı doğru gösterilir; 100,11 TRY revizyon 409 döner ve yeni pay/audit oluşturmaz; tam 100,10 TRY kabul edilir. Fatura ve mali kaynaklar değişmez.
- Başka iadede kullanılan 20 TRY, revize edilen payın limitinden düşülür. 80,11 reddedilir; 80,10 kabul edilir. Diğer iadenin 20 TRY payı ve sürümü korunur.

Üç gerçek HTTP/üretim Chromium senaryosu da geçti: tek kaynaklı karma fatura, JWT/rol/tenant/mod sınırları ve iki kaynaklı tek iade dağıtımı. API odaklı üretim derlemesi başarılı; geçici veritabanları otomatik temizlendi. Gerçek şirket verisine deneme kaydı yazılmadı.

## Sabit paket

- Runtime: `.release-candidates/f03-iade-revizyon-20261019/runtime`.
- Önceki çok kaynaklı net satış düzeltmesi korunur; yalnız `apps/api/dist/crm/crm-iade-paylari.js` değişir.
- JS SHA-256: `b23417386ec3d94540e0b3ab8d6445dfbe6d98c18e594dd4d9d9b2f798cbb7cf`.
- Runtime dosya özeti: `a7c2a0c8a1b11d5d6f5bddaf75355888d3f09e4eed67e66995c4a1abda920b69`.
- Compose: `.release-candidates/f03-iade-revizyon-20261019/compose.json`.
- Kanıtlar aynı dizinde `db-kabul.log`, `http-kabul.log`, `kabul-ozeti.json`, `cok-kaynakli-http-sonucu.json`, `runtime-manifest.json`.

## Yerel geçiş

Yalnız API servisi `--no-deps` ile yeni sabit pakete geçirildi. Çalışan JS dosyasının SHA-256 değeri yukarıdaki paketle eşleşti. API ready, web giriş ve ödeme sözü hatırlatma worker sağlık uçları 200. Web ve worker paketleri değiştirilmedi. Migration uygulanmadı; mali kayıt/geçmiş düzeltmesi yapılmadı.

Bu teslim revizyon üst sınırını kapatır. Diğer dağıtım uçlarının hacim sınırı kabulü ve gerçek şirket alan pilotu ayrı açık işlerdir.
