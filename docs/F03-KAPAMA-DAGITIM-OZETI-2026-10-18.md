# F03 — Karma faturanın kapama dağıtım özeti

18 Ekim 2026. Mevcut açık kapama payı servisinin yanıtına `ozet` eklendi; fırsat ekranında kapama dağıtımı açıldığında görünür. Kasa/banka, iade ve diğer kapama payları ayrı toplanır. Otomatik tam fatura kapamasına eklenmez ve muhasebe defterini değiştirmez.

Yalnız güncel kaynak ve sahiplik kanıtıyla geçerli pay sürümleri kullanılır. Bir kapamanın toplamı bütün fırsatlar arasında tamamlanmamışsa özet `kismi` olur. Bütün kapamalar dağıtılmışsa `tam` olur; bu durum faturanın tamamen ödendiği anlamına gelmez. Sıfır tutarlı yeni sürüm eski payı kaldırır ve eksik dağıtım durumunu geri getirir.

`dagitilmamisPay`, fırsatın doğrulanan KDV dahil fatura payından açıkça belirtilen kapama paylarının çıkarılmasıdır. Gerçek alacak bakiyesi veya net satış değildir. Geçersiz kapama kaynağı, negatif/aşırı pay veya doğrulanamayan fatura payında özet tutarları NULL döner. İade kapaması net satıştan düşülmez; satır bazlı ticari iade kanıtı hâlâ ayrı iştir.

## Kabul kapsamı

- Geçici PostgreSQL üzerinde 41 CRM kabul testi geçti. Yeni kontroller iki fırsat arasında eksik/tam dağıtımı, payın sıfırla kaldırılmasını, iade payını ve iade iptalinde özetin gizlenmesini doğruluyor.
- Test uygulama rolü ve RLS ile çalıştı; geçici veritabanı durdurulup otomatik silindi. Finans kayıtlarının değişmediği karşılaştırıldı.
- API ve web için odaklı TypeScript kontrolleri geçti. İlk tam API tür kontrolü 2 GiB Node heap sınırına takıldı; bu koşum tam derleme kabulü değildir.
- API birim test paketinde 249 dosyada 2076 test geçti. Yeni tarayıcı senaryosu eksik dağıtımı, ayrı iade payını ve geçersiz kaynakta tutarların gizlenmesini doğruladı (1 geçti). Tarayıcı API yanıtları fixture'dır; gerçek şirket pilotu değildir.
- Tam API tür kontrolü 4 GiB heap ile tekrarlandı; F03 dışındaki mevcut `src/core/dosya-denetimi.ts:160` dosyasında TS2322 (`html`/`calistirilabilir` ile `DosyaTuru` uyumsuzluğu) nedeniyle başarısız oldu. Eşzamanlı başka çalışmanın dosyasına müdahale edilmedi. Tam API derlemesi geçmiş sayılmaz.

Gerçek şirket pilotu, canlıya geçiş, net satış/iade sonucu ve F03 birleşik satış kabulü tamamlanmış sayılmaz. Önceki pilot/yayın ertelemesi korunuyor.
