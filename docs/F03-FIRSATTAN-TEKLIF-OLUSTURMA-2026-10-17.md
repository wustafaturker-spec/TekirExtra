# F03 — Fırsattan yeni satış teklifi oluşturma

17 Ekim 2026. Aktif teklif bağı yazma yetkisi olan yönetici/satış kullanıcısı, fırsattaki **Yeni teklif oluştur** bağlantısıyla mevcut belge formunu açar. Müşteri fırsattan okunur; tür satış teklifi olarak sabitlenir. Kullanıcı kalemleri ve bağlama gerekçesini doldurur. Başarıda fırsata dönülür; teklif taslaktır, kendiliğinden onaylanmaz veya faturalanmaz.

`POST /crm/firsatlar/:id/belgeler/teklif` gövdesi `belge`, `gerekce`, `istekAnahtari` ve `beklenenFirsatZamani` alanlarını içerir. Belge, mevcut oluşturma şemasını kullanır; yalnız satış teklifi kabul edilir, fatura bağı kurulamaz. Müşteri fırsatın carisiyle aynı olmalıdır. İstemciden tenant/kullanıcı alanı alınmaz. Mod kapalı/salt okunur olduğunda, kullanıcı yetkisiz/pasif olduğunda veya fırsat başka şirkete ait olduğunda yazım reddedilir.

Mevcut `BelgelerService.olustur` yolu ve yeni CRM yolu aynı `olusturIslemde` hesaplama/yazma kodunu kullanır. Dönem ve merkezi KDV ön kontrolü transaction açılmadan yapılır; dönem, kullanıcı iskonto yetkisi, cari blokajı, birim/varyant ve kalem vergi kontrolleri mevcut servis üzerinden uygulanır. Dönem kontrolüne açık transaction aktarılır; iç içe tenant transaction açılmaz.

Şirket ayarı → fırsat kilidi sırasıyla yazım yapılır. Teklif, kalemleri, fırsat bağı ve `firsattan_teklif_olusturuldu` audit kaydı tek transaction'dadır. Bağ veya audit yazımı başarısızsa teklif ve satırları da geri alınır. Eski fırsat güncelleme zamanı 409 verir. Fırsat başına 200 bağ geçmişi sınırı korunur.

İstek özeti işlem türünü ve normalize edilmiş girdiyi içerir. Aynı anahtar ve aynı içerik önceki belgeyi döndürür; farklı içerik/işlem 409 verir. Eşzamanlı aynı istek fırsat kilidi altında tek belge üretir. Tekrar kontrolü dönem/vergi ön kontrollerinden önce yapılır; sonradan dönem kapanmışsa tamamlanmış isteğin sonucu yine okunabilir. Çözülmüş bağın eski oluşturma isteği yeniden gönderildiğinde bağ açılmaz, mevcut kapalı sürüm döner. Mevcut kullanıcı ve şirket ayarı yetkisi her tekrarda doğrulanır.

Form hata sonrası taslağı ve değişmeyen içerikte istek anahtarını korur; kaydetme sürerken ikinci gönderim engellenir. Belge oluşturulduktan sonra ek dosya yüklemesi hata verirse aynı formdaki tekrar mevcut belge kimliğini kullanır. Dosyalar belge/bağ transaction'ının dışındadır; bu aşamada oluşturulmuş teklifin içeriği değiştirilerek ikinci teklif açılmaz. Dosya yükleme için kullanılan mevcut ayrı servislerin davranışı değişmedi. Anahtar form belleğindedir; sayfayı yeniden açmak yeni işlem başlatır.

Yeni migration veya gerçek şirket ayarı değişikliği yoktur. Gerçek pilot/canlıya geçiş ertelenmiş durumdadır. Satır bazında fatura/iade/tahsilat dağıtımı ve birleşik F03-K1/K2 kabulü sonraki dilimlerdir. Önceki F02 yayın adayı bu değişiklikleri içermez.

## Doğrulama

**100 test geçti:** 70 CRM/belge birim testi, 24 geçici PostgreSQL testi ve 6 fixture tarayıcı senaryosu. PostgreSQL testleri gerçek hesaplama ve satır yazımı, eşzamanlı tekrar, audit hatasında tam geri alma, eski fırsat, tenant/cari/tür/yön, kullanıcı/mod, cari blokajı, iskonto/birim ve kapalı dönem kontrollerini içerir. Yeni testler PDF/depo servislerini çağırmaz; merkezi mevzuat servisi bu DB fixture'ında kurulmaz. Mevcut belge birim testleri vergi hesaplamalarını da kapsar.

Tarayıcıda mevcut form, sabit müşteri/tür/yön, tek birleşik oluşturma isteği, fırsata dönüş ve 409 sonrası form/istek anahtarı korunması doğrulandı. Önceki bağlama/çözme ve mobil salt okunur zincir senaryoları da geçti. Gerçek API oturumu/pilot yerine API fixture'ları kullanıldı. Ekran görüntüsü incelendi. İlk koşumlardaki zaman aşımları kabul sayılmadı; ayrıca yeni belge sayfasının kartları gizleyen stil kuralı için `create-page__keep` düzeltildi ve testte aynı adlı form/filtre alanları ayrıldı. Son koşumda başarısız/atlanan/kararsız test yoktur.

Odaklı API kaynakları, kabul testi ve bağımlılıklarının TypeScript kontrolü; değişen web kaynakları, e2e ve bağımlılıklarının kontrolü geçti. İlk API kontrolünün kaynak kökü ayarı test dizinini kapsamıyordu; kabul testi eklenirken bu kontrol yapılandırması düzeltildi. Bunlar tam üretim derlemesi veya yeni yayın adayı değildir. Geçici PostgreSQL koşum sonunda otomatik silindi.

[Kabul özeti ve kaynak SHA-256 kayıtları](../.release-candidates/f03-teklif-olusturma-20261017/kabul-ozeti.json), [PostgreSQL sonucu](../.release-candidates/f03-teklif-olusturma-20261017/postgres-kabul.log), [birim sonucu](../.release-candidates/f03-teklif-olusturma-20261017/api-birim.json), [tarayıcı sonucu](../.release-candidates/f03-teklif-olusturma-20261017/tarayici.json), [teklif formu](../.release-candidates/f03-teklif-olusturma-20261017/firsattan-teklif-formu.png). Önceki başarısız tarayıcı koşumları ayrı JSON dosyalarında korunur.
