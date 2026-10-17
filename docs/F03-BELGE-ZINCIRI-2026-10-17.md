# F03 — Fırsatta bağlantılı satış belgeleri

17 Ekim 2026. F03'ün ikinci dilimi, aktif teklif bağlarının mevcut sipariş ve irsaliye dönüşümlerini ve bağlantılı faturaları fırsat ekranında gösterir. Sipariş/irsaliye ve fatura bağlantıları mevcut belge ekranlarını doğru kayıt odağıyla açar. Gerçek pilot ve canlıya geçiş kullanıcı isteğiyle ertelenmiş durumdadır.

`GET /crm/firsatlar/:id/belgeler` yanıtına `zincir.belgeler` ve `zincir.faturalar` eklendi. Önce aynı şirket/carinin aktif bağlı tekliflerinden `kaynakBelgeId` ile satış siparişleri, ardından bunların satış irsaliyeleri okunur. Bağlantılı faturalar `faturaId` üzerinden, aynı şirket/cari ve satış tipi kapsamında tekilleştirilir. Bu başlık bağlantıları ilişki kanıtıdır; satır payının veya gelirin kanıtı değildir. Özellikle sevkten önce düzenlenen faturalar için dönüşüm iddiası yapılmaz.

Çözülmüş teklif bağlarının alt zinciri aktif görünümden çıkar; bağ geçmişi korunur. İptal belgeleri durumlarıyla gösterilir. Revizyonlara bağ kendiliğinden aktarılmaz. Ortak faturanın bu zincir dışındaki kaynakları varsa `ortakKaynak` işareti döner; dış kaynakların kimliği, numarası veya ayrıntıları yanıta eklenmez. Birden fazla zincir belgesinden aynı faturaya ulaşılırsa fatura bir kez gösterilir.

Tutar, maliyet, ciro, tahsilat ve fırsat tahmini bu zincir yanıtında bulunmaz. Ortak faturanın bütün tutarı fırsata mal edilmez. Yeni teklif oluşturma/atomik bağlama, satır bazında fatura/iade/tahsilat payı ve birleşik F03-K1/K2 satış pilotu henüz tamamlanmadı.

Okuma, mevcut mod/rol kontrolü ve `RepeatableRead` transaction'ı içinde yapılır. Toplam 1000 alt belge veya 1000 fatura kaynağı sınırı aşılırsa eksik zincir yerine 409 döner. Yeni tablo, migration, ayar değişikliği veya belge/finans yazımı yoktur.

**91 test geçti:** 70 CRM/belge birim testi, 17 geçici PostgreSQL testi, 4 fixture tarayıcı senaryosu. [Kabul özeti ve kaynak özetleri](../.release-candidates/f03-belge-zinciri-20261017/kabul-ozeti.json), [DB logu](../.release-candidates/f03-belge-zinciri-20261017/postgres-kabul.log), [birim sonucu](../.release-candidates/f03-belge-zinciri-20261017/api-birim.json), [tarayıcı sonucu](../.release-candidates/f03-belge-zinciri-20261017/tarayici.json), [mobil görünüm](../.release-candidates/f03-belge-zinciri-20261017/crm-belge-zinciri-mobil.png).

PostgreSQL koşumu uygulama rolü ve RLS altında çalıştı; önceki 12 senaryoya kısmi/iptal irsaliye, ortak fatura/tekilleştirme, çözülmüş bağ, tenant/cari/yön sızıntısı ve sınır aşımı kontrolleri eklendi. Mobil ortak fatura uyarısı, kaynak bağlantıları ve yatay taşmama doğrulandı; ekran görüntüsü incelendi. API ve değişen web kaynakları/bağımlılıkları için odaklı TypeScript kontrolleri geçti. Tarayıcı testleri API fixture'ları kullanır; gerçek şirket pilotu değildir. Üretim derlemesi veya yeni yayın adayı hazırlanmadı; önceki F02 dokuzuncu adayı F03 kaynaklarını içermez.
