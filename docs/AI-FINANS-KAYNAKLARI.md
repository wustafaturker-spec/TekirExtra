# Asistanın finans kaynakları

Web asistanındaki finans yanıtlarında **Kaynak verileri** bölümü, başarılı araç çağrılarından üretilen tutarları ve rapor/kayıt bağlantılarını gösterir. Kartlar modelin serbest metninden çıkarılmaz; ek model çağrısı yapılmaz ve tutarlar yeniden toplanmaz. Bu bölüm yanıtla karşılaştırılabilecek kaynak verisini gösterir; model metnindeki her rakamın otomatik olarak doğrulandığı anlamına gelmez.

Desteklenen araçlar: finansal özet, gelir-gider, vadesi geçen alacak/borç, rapor çalıştırma, cari arama/ayrıntı, fatura arama/ayrıntı ve belge arama/ayrıntı. Başarısız araçlar, e-posta/OCR içeriği ve yazma/onay araçları bu kaynak bölümüne dahil edilmez. Bağlantılar mevcut panel yollarıyla sınırlıdır; kayıt bağlantıları araç sonucundaki geçerli UUID'den kurulur.

Her kartın görüntülenme zamanı ve varsa gerçek rapor dönemi/belge tarihi bulunur. Gelir-giderde bugüne çekilen bitiş tarihi kaynakta da aynıdır. Bilinmeyen tarih veya para birimi uydurulmaz. Cari bakiyeleri farklı dövizlerde ayrı gösterilir. Raporun karışık döviz toplamı tek tutara çevrilmez. Tek satırlı raporda toplam satırı yoksa tutar o satırın kendi para birimiyle gösterilir. Büyük ve negatif tutarlar metin olarak korunur; arayüz biçimlendirmesi kayan nokta hesabı yapmaz.

Gelir-gider kaynağında net satış, SMM, brüt kâr, **diğer gelirler**, faaliyet giderleri ve net kâr raporun `karZarar` alanlarından alınır. Diğer gelirler, kaynak kartında ve asistanın seçebileceği kaynak olguları/güvenli özetinde bulunur; sıfır ve negatif tutarlar da korunur. Alan eski bir kaynakta yoksa net kâr farkından türetilmez. Mevcut sohbet snapshotları geriye dönük değiştirilmez. Eksik maliyet uyarıları korunur; bu ekleme maliyet kayıtlarını düzeltmez veya net kâr formülünü değiştirmez.

Genel rapor kartları raporun para kolonlarına ait toplamları ve bağlantısını gösterir. Modele ilk 30 satır verilmişse toplam satır sayısıyla birlikte belirtilir; kaynak kartı bütün satırların kopyası değildir. Yanıt başına en fazla 20 farklı kaynak kartı gösterilir; sınır aşılırsa arayüz açıkça belirtir. Kur/maliyet eksikliği gibi rapordan gelen uyarılar saklanır.

Kartlar sohbet yanıtına ve mesaj geçmişine birlikte kaydedilir. Aynı idempotency isteği aynı kaynak görünümünü döndürür. Kaynak verileri sohbet saklama politikasıyla birlikte temizlenir; başka tenant veya kullanıcı bu sohbet geçmişini okuyamaz. Bağlantı daha sonra açıldığında rapor güncel veriyi gösterebilir; kartın zamanı önceki görünümü ayırt etmek içindir.

Doğrulama: `finans-kaynaklari.test.ts`, `ai-ajan.service.test.ts`, PostgreSQL üzerindeki `ai-tutarlilik.kabul.test.ts` ve HTTP AI üretim kapısı senaryoları. Canlı sağlayıcı yanıtının dilsel/rakamsal başarısı ayrıca `docs/AI-KALITE-TESTLERI.md` içindeki opt-in kalite paketiyle ölçülür.

14 Ekim 2026 diğer gelirler eklemesi: 65 kaynak/olgu/ajan/kâr-zarar testi ve 4 gerçek PostgreSQL/HTTP/Chromium kabul testi başarılı (69 toplam). Pozitif, sıfır, negatif, büyük decimal-string ve eksik alan kontrol edildi; model seçimiyle ve model hatasında güvenli özetle 30.000 TRY kalemi/uyarı korunuyor. Tarayıcı kartının kalemi gerçek raporun sıfır değerine eşit; kabul senaryolarının izole kayıtları rollback edildi. API TypeScript kontrolü ve `git diff --check` başarılı. Bu ilk testler kaynak koduyla çalıştı, Gemini çağrısı yapılmadı. Web bileşeni zaten dinamik kalemleri gösterdiği için web kodu değişikliği gerekmedi.

## Diğer gelirler — kontrollü yayın, 14 Ekim 2026

Kullanıcı onayıyla API derlemesi başarılı (`NODE_OPTIONS=--max-old-space-size=4096 pnpm build`). 65 hedefli test yeniden geçti; ardından yeni derlenmiş API + mevcut üretim web artefaktıyla 7 PostgreSQL/RLS/rapor eşitliği/HTTP/Chromium kabul testi geçti (bu yayın turunda 72 test). Yeni kalem kaynak kartında rapor değeriyle eşit; eski kaynakların/model hatasının korunması ve boş yanıt tanısı da geçerli. İzole test kayıtları rollback edildi; manuel Gemini çağrısı yapılmadı.

API PID `1207529`, başlangıç 23:39:20 İstanbul, hazır doğrulaması 23:39:26. Worker PID `1207882`, başlangıç 23:39:33, hazır doğrulaması 23:39:40. Son kontrolde API `/health/ready` HTTP 200 / `ready`, worker `/health` HTTP 200 / `ready`, web `/giris` HTTP 200. Web PID `1073416` ve 21:56:44 başlangıcı değişmedi; web yeniden derlenmedi/başlatılmadı.

Önceki API/worker derlemesi `/tmp/tekirextra-diger-gelir-yayin-OWFFXJ/api-onceki-dist` altında korunuyor; geçici dizin kalıcı yedek değildir, geri dönüş mevcut bağımlılıkları gerektirir. Sekiz derlenmiş dosyanın SHA-256 manifesti ve kontrollü yeniden başlatma betiği aynı dizinde; hash kontrolü her servis durdurulmadan önce yapıldı. Yeni `finans-kaynaklari.js` SHA-256: `5bbce07863cf95427d8961d10a0a545e1aaf24ec8a10e2916c20347a6452ec35` (önceki: `e5b97277a0e48af29b01c67f5f691176e08bc26b56ef710680218966ffd5a1e0`).

Migration, sağlayıcı/model/onay değişikliği veya manuel ticari kayıt güncellemesi yapılmadı. Süreç ortamları yalnız bellekte korunup yeniden kullanıldı; gizli değerler yazdırılmadı/dosyaya alınmadı. Worker'ın olağan işleri devam eder; sağlık tüm görev teslimlerini kanıtlamaz. Kullanıcı sayfayı yenileyip yeni gelir-gider sorusu göndererek yeni kaynak kartını kontrol edebilir; eski sohbet snapshotları geriye dönük değişmez. Bu yayın turundaki canlı Gemini kullanıcı kabulü henüz yapılmadı.
