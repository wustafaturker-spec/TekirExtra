# F03 — İade dağıtımında hacim sınırı kabulü

19 Ekim 2026. Açık kalan 5000/5001 sınır kontrolleri için kalıcı regresyon ve gerçek PostgreSQL testleri eklendi. Ürün kodundaki mevcut korumalar doğrulandı; bu teslimde uygulama paketi veya migration güncellenmedi.

## Gerçek veritabanı kabulü

57/57 CRM/belge PostgreSQL/RLS senaryosu geçti; bunların ikisi yeni hacim senaryosudur:

- 5000 ayrı kesin satış iadesi, iade satırı ve kaynak referansı toplu fixture ile oluşturulur. Dağıtım servisi bütün 5000 iadeyi geçerli olarak okur ve bir payı kaydeder. 5001'inci iade eklendiğinde okuma ve yeni istek anahtarıyla yazma 409 verir. Pay ve audit sayıları değişmez.
- 25 iadede 200'er sürümle toplam 5000 geçmiş pay fixture'ı oluşturulur. Geçmişin tamamı okunur. Sürümü sıfır olan ayrı bir iadeye yeni pay yazımı, sürüm sınırına takılmadan doğrudan geçmiş sınırı gerekçesiyle reddedilir. Pay/audit artmaz. 5001'inci geçmiş kaydında hem okuma hem yazma kısmi sonuç yerine 409 döner.

Veriler yalnız nonce ve port kontrolü yapılan geçici PostgreSQL'dedir. Uygulama rolü superuser/BYPASSRLS değildir. Geçici veritabanı silindi; gerçek şirket kayıtlarına yazılmadı. Geçmiş fixture'larının eski kanıtları geçersizdir; hacim sınırı geçersiz geçmişi de sayar.

## Okuyucu ve ekran kabulü

9/9 birim testi geçti. Normal kaynak okumasına ek olarak satış satırları, kaynak referansları, iadeler, bütün referanslar, kaynak başlıkları, iade satırları, pay geçmişi ve iade kapamaları sorgularının her birinde 5001 satırın 409 verdiği doğrulandı. Bu katman testlerinde DB yanıtları sahtelenir; yukarıdaki iki senaryo gerçek DB kabulüdür.

Hazır üretim standalone web paketinde 16/16 CRM tarayıcı senaryosu geçti. Yeni hacim senaryosu, ilk yüklemede 409 sınır hatasının açıkça gösterildiğini; boş iade mesajı veya yazılabilir form sunulmadığını ve yazma isteği oluşmadığını doğrular. Diğer senaryolar teklif, kaynak bağlantısı, pay, çatışma taslağı, salt okunur rol ve mobil görünümü kapsar. API yanıtları bu tarayıcı paketinde fixture'dır; gerçek HTTP üçlü kabulü önceki teslimde ayrı doğrulandı.

Fixture iade DTO'su güncel dağıtılan/kalan/durum/kaynak alanlarıyla tamamlandı, test çerezine session `expires` alanı eklendi. İlk koşumda 15 test geçti; eski açıklama metnini bekleyen bir test başarısız oldu. Beklenti mevcut metne göre düzeltildikten sonraki temiz koşum 16/16 geçti. Ürün açıklaması değiştirilmedi.

## Kanıt ve sınır

- `.release-candidates/f03-iade-hacim-20261019/db-kabul.log`: 57 DB testi ve geçici DB temizliği.
- Aynı dizindeki `tarayici/sonuc.json`: 16 başarılı, sıfır başarısız/atlanan senaryo. `sonuc-ilk-deneme.json` ilk koşumdur.
- `kabul-ozeti.json`: birleşik sayımlar, kaynak hash'leri ve gerçek sisteme yazılmadığı kaydı.
- Test dosyaları: `apps/api/src/crm/crm-iade-hacim.test.ts`, `apps/api/test/crm-belge.kabul.test.ts`, `apps/web/e2e/crm-belge.spec.ts`, `apps/web/playwright.crm-hacim.config.ts`.

Bu testler üretim kapasitesi/p95 veya bütün veri dağılımları için performans kabulü değildir. Kapama dağıtımı için ayrı tüm hacim senaryoları ve fiziksel stok/seri/lot kapsamı bu teslimin dışındadır. F03 gerçek şirket alan pilotu açık kalır. Çalışan paket `.release-candidates/f03-iade-revizyon-20261019/compose.json` ile aynı kalır.
