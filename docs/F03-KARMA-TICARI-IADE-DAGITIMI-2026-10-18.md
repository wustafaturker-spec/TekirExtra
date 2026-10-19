# F03 — Karma faturada açık ticari iade dağıtımı

**19 Ekim güncellemesi:** [Çok kaynaklı iade ve genel satış özeti doğrulaması](F03-COK-KAYNAKLI-IADE-DOGRULAMA-2026-10-19.md) tamamlandı: üç gerçek HTTP/üretim tarayıcı senaryosu ve dört regresyon testi geçti. Kaynak kanıtı uyuşmazlığı düzeltildi ve yerel API'ye uygulandı. Aşağıdaki eski başarısız koşum/yayın notları tarihsel kayıt olarak korunur; kalan sınırlar güncel belgede belirtilir.

18 Ekim 2026. Fırsat ekranına ticari iade dağıtımı eklendi. Yönetici veya muhasebe, tek satış faturasına referans veren kesin satış iadesinin **KDV hariç matrahını** o faturanın kaynak satırlarıyla doğrulanan fırsatlarına gerekçeyle ayırabilir. Bu dağıtım muhasebe faturalarını, stokları veya kapama defterini değiştirmez. Kapama payına ve otomatik tam fatura iade hesabına eklenmez.

## Veri ve sınırlar

`FirsatIadePayi`, satış/iade/fırsat, matrah, sürüm, kaynak kanıtı, tekrar anahtarı, gerekçe ve kullanıcıyı tutar. Her revizyon yeni satırdır; sıfır matrah önceki payı kaldırır. Geçmiş uygulama rolüyle değiştirilemez/silinemez. Tenant/cari bileşik foreign key'leri, FORCE RLS ve aktif muhasebe/yönetici kontrolü uygulanır.

`GET/POST /crm/firsatlar/:firsatId/belgeler/faturalar/:faturaId/iade-paylari` mevcut mod ve rol sınırlarını kullanır. Yazma, cari ve satış faturası kilidi altında Serializable işleminde güncel kaynaklarla yeniden doğrulanır. Aynı istek tek dağıtım/audit üretir; farklı içerikle anahtar tekrarı veya eski sürüm 409 verir. Audit hatasında dağıtım da geri alınır.

Toplam pay iadenin matrahını, fırsatın bütün iadelerdeki payı kendi satış matrahını aşamaz. Otomatik orantılama yapılmaz. Birden fazla kaynak faturaya referans veren, dövizi/carisi uyuşmayan, tutarsız veya kesin olmayan iade dağıtılamaz. Referanssız iade kapsam dışıdır; referansı doğrulanamayan iade kapaması varsa net sonuç hesaplanmaz.

Kaynak fatura, iade satırları, referanslar veya fırsat sahipliği değişince eski kanıttaki pay hesapta kullanılmaz. İade başka kaynak faturaya taşınırsa yeni kaynakta ayrı sürüm oluşturulabilir. Bağ çözülse bile geçmiş faturası listede kalır. Kaynak ve dağıtım okumaları 5000 kayıtla sınırlıdır; eksik sonuç yerine çatışma döner.

## Sonuç ve ekran

Satış matrahı ve belirtilen güncel iade matrahı ayrı gösterilir. **Dağıtım sonrası satış matrahı**, yalnız bütün kesin referanslı iadeler fırsatlara tam dağıtılmış ve kaynaklar geçerliyse hesaplanır. Eksik dağıtım NULL kalır. İptal edilen iade, kaynakta geçerli bir kapama bırakmıyorsa sonucu artık azaltmaz. Referanssız iadeleri kapsayan genel net ciro iddiası yoktur.

Ortak faturanın fırsat belge listesindeki genel `netSatis` alanı yalnız faturanın bütün satırları aynı fırsata kanıtlanmışsa hesaplanır. Kısmi/karma fatura için bu genel alan belirsiz kalır; fırsata ayrılmış net matrah, yukarıdaki fatura bazlı iade dağıtımı sonucunda gösterilir. Ekran bu ayrımı kullanıcıya açıkça belirtir.

Satış rolü salt okur; muhasebe/yönetici pilot/açık modda yazar. Çatışma form taslağını ve tekrar anahtarını korur. Mobil görünüm ve geçmiş kontrol edildi.

## Doğrulama ve yayın sınırı

92 CRM/belge/fatura birim testi ve 15 F03 fixture tarayıcı senaryosu geçti. API ve web odaklı tür kontrolleri geçti. Son geçici PostgreSQL/RLS koşumunda 53 test geçti; kaynak-fatura düzeltmesi, FORCE RLS, başka tenant'a ait gerçek faturayla FK reddi ve veritabanındaki kullanıcı rolü kontrolü de doğrulandı. Geçici veritabanı otomatik silindi.

18 Ekim güncel çalışma ağacında tam API üretim derlemesi (`NODE_OPTIONS=--max-old-space-size=3072 pnpm build`) ve web üretim derlemesi (`pnpm build`) geçti. API birim paketi 255 dosyada 2.133 test; izole F03 PostgreSQL/RLS kabulü (`node apps/api/scripts/f01-yaris-kabul.mjs --f03`) 53 test geçti. DB senaryoları iki fırsata eksik/tam pay dağıtımı, eşzamanlı kapasite çatışması, eski kanıt, RLS/rol ve audit rollback'i kapsadı; geçici DB otomatik silindi. İlk API derlemesi varsayılan 2 GiB yığında OOM verdi; 3 GiB ile tamamlandı. Web derlemesinde mevcut CSS'te üç autoprefixer uyumluluk uyarısı ve Next.js ESLint eklentisi yapılandırma uyarısı vardı; derlemeyi engellemedi.

Migration `20261018120000_firsat_iade_paylari` yalnız geçici PostgreSQL koşumlarına uygulandı; ek indeks migration'ı hiçbir veritabanına uygulanmadı. Gerçek şirket veritabanı, ayarlar ve çalışan servisler değiştirilmedi. Fixture tarayıcı koşumunda 15 senaryonun tamamı panel oturumu/rota kurulumu nedeniyle başarısız oldu; gerçek birleşik runner `--f03-http` API derlemesini geçti ancak geçici Docker PostgreSQL başlatması 180 saniyede çıkış 143 ile zaman aşımına uğradı, bu nedenle HTTP/tarayıcı testleri başlamadı. Gerçek iade oluşturma/kesinleştirme HTTP akışı ve kullanıcı pilotu kanıtlanmış değildir. DB/RLS ve birim kabulü geçti; birleşik HTTP/tarayıcı ve gerçek pilot/yayın kapıları açık.

## Çok kaynaklı iadeler için uygulama ve kabul sınırı

Çok kaynaklı iade pay API'si ve net satış hesabı bu kuralları uygular. Çok kaynaklı destek, aynı iade matrahının her kaynak faturada tekrar kullanılabilir olması anlamına gelmez. Kabul sınırı şöyledir:

- İadenin bütün kaynak referansları bulunmalı; kaynak faturalar kesin satış faturası olmalı ve aynı tenant, cari ve dövizde kalmalıdır. Eksik, tekrar eden veya çelişkili kaynak varsa sonuç dağıtılamadı kalır.
- Muhasebe/yönetici, iade matrahını her kaynak fatura ve o kaynağın doğrulanmış fırsatları için elle paylaştırır. Otomatik oran veya satır eşleştirmesi yapılmaz; mevcut belge zinciri iade satırının hangi kaynak satış satırına ait olduğunu kanıtlamıyor.
- İade başına bütün kaynak faturalarındaki güncel geçerli fırsat paylarının toplamı, iadenin KDV hariç matrahına tam eşit olmadan dağıtım tamamlanmış sayılmaz. Eksik veya fazla toplamda net satış sonucu NULL kalır.
- Her kaynak fatura/fırsat payı, o faturadaki doğrulanmış satış matrahını aşamaz. Aynı fırsatın farklı kaynak faturalardaki payları kaynak fatura kimliği korunarak ayrı izlenir; bir kaynak faturadaki boşluk diğerine taşınmaz.
- Kaynak kanıtı değişince ilgili eski pay geçersiz olur, fakat geçmiş satırı silinmez. Yazma işlemi tüm kaynak faturalarını sıralı kimlik düzeninde kilitler; idempotency, gerekçe, sürüm ve audit tek transaction'da korunur.
- Uygulama, bütün kaynak faturaların satır sahipliğini sınırlandırılmış toplu okumayla doğrulamalı; kaynak/fırsat başına sorgu fanout'u yapmamalı. Kaynak, satır veya pay geçmişi sınır aşımında kısmi sonuç vermek yerine dağıtımı reddetmelidir. Bu toplu sahiplik okuyucusu çok kaynak desteğinin teknik ön koşuludur.

Çok kaynaklı iade dağıtım API'si ve net satış doğrulaması toplu sahiplik okuyucusunu kullanıyor; kaynak/fırsat payları ayrı saklanıyor ve ekran kaynakları, her iadede tüm kaynaklar boyunca dağıtılan ve kalan toplamı gösteriyor. İade tüm referansları, para birimini, satırların KDV hariç matrah ve brüt toplamlarını ve kaynak satış sınırlarını doğrulamadan uygun sayılmıyor; güncel paylar tüm kaynaklar için toplam iade matrahına ulaşmadan net sonuç verilmiyor. Kaynak kanıt özeti fırsattan bağımsız üretildiği için farklı fırsatlardaki paylar aynı iade sürümüne bağlanır. Tam dağıtımda net satış, ilgili kaynak/fırsat payını düşer. Yazma işlemi cari kilidinden sonra iade ile bütün kaynak faturalarını tek sıralı kilit sorgusuyla alır ve kaynağı yeniden okuyup doğrular. Geçmiş sorgusuna bileşik indeks migration'ı eklendi; migration henüz hiçbir veritabanına uygulanmadı. Ekran her iade için `tam`, `eksik` veya `doğrulanamadı` durumunu ayrı gösterir; kapasite ihlali yalnız ilgili kaynak/fırsat payı olan iadeleri geçersiz etiketler ve bu ihlalle ilişkili net satış sonucunu belirsiz bırakır. Toplamın eşit görünmesi tek başına geçerli dağıtım sayılmaz. Prisma şema doğrulaması, odaklı API/web tür kontrolleri ve tam API/web üretim derlemeleri geçti; web derlemesi mevcut CSS/ESLint uyarıları verdi, API derlemesi 3 GiB yığınla tamamlandı. Bu son kapsam düzeltmesi için davranış kabulü, DB/RLS kabulü ve birleşik gerçek HTTP/tarayıcı kabulü açık.

## Çok kaynaklı kabul: son koşum ve kalanlar

İzole `--f03` koşumu çok kaynaklı ticari dağıtımın DB/RLS davranışını doğruladı. Önceki gerçek HTTP/tarayıcı provası tek kaynaklı iadeyi kapsıyordu; güncel `--f03-http` koşumu konteyner başlatma zaman aşımı nedeniyle testlere ulaşmadı. Aşağıdaki birleşik/ek kabul sonuçları hâlâ doğrulanmalı:

- Gerçek HTTP ve tarayıcıda iki fırsata ait iki kesin satış faturası, tek kesin iade ve her fırsata yalnız kendi payının yansıması; DB testi aynı hesaplamayı doğruladı.
- `--f03-http` gerçek iade oluşturma/kesinleştirme, yenileme sonrası sonuç ve mobil görünüm akışının tamamlanması; runner Docker başlangıcında durdu.
- Kapasite ihlalinin yalnız ilişkili iadeyi/net sonucu etkilemesi ve ilişkisiz tamamlanmış iadenin etkilenmemesi; kapasite/409 DB senaryoları geçti, bu izolasyon alt durumu ayrıca kontrol edilmeli.
- 5000/5001 sınırlarının karma dağıtım endpoint'lerinde sessiz kısmi sonuç vermediğinin doğrulanması.

İlk iade-pay migration'ı ile ek geçmiş indeksi gerçek şirket veritabanına uygulanmadı; pilot/yayın kapısı ayrıca açık.
