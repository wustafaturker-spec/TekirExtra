# F02 — Özellik kapatma ve yeniden açma provası

16 Ekim 2026. Gerçek takip kaydı kullanıcı isteğiyle ertelenmişken mevcut adayın özellik kapatma/yeniden açma davranışı izole PostgreSQL'de sınandı. **8 kontrol geçti.** Çalışan servisler ve gerçek şirket ayarları değiştirilmedi; manuel pilot açık, otomasyon/bildirimler kapalı kaldı.

Bu kanıt mevcut adayda özellik kapatma ve yeniden açma içindir. Tam eski API/web/worker paketiyle servis/altyapı geri dönüşü kabulü değildir.

## Kimlik ve sınırlar

- Aday: `f02-20261016T070519121Z-c0319aa2`, `.release-candidates/f02-pilot-20261016-4`.
- Kaynak/dosya SHA-256: `70a4f6d6411b76864941d9bdd753174330a50d581fda3c7eae7afda4b2a63e95` / `6e2637c9b7feb85ce4e40cc4a5f3971ce13d375d48c09fe6bb37f4b575bd237c`.
- [Çalıştırılan betik](../.release-candidates/f02-pilot-20261016-4/f02-kapatma-geri-acma-prova.cjs), SHA-256 `e14279007c5eb9f50acde1af1c045e8e26b5d903deba357d097b59e366ac25d4`.
- [Sonuç raporu](../.release-candidates/f02-pilot-20261016-4/f02-kapatma-geri-acma-prova.json), 17:36–17:37 TRT; `testAdedi: 8`, `smtpCagrisi: 0`, `geciciDbSilindi: true`.

Betik canlı DB ortam değişkenleri verilirse durur; `.env` yüklemez. Yeni nonce/parola ve loopback üzerindeki rastgele portla yalnız geçici `f02_kapatma_<nonce>` PostgreSQL açar, migration'ları burada uygular. Gerçek derlenmiş servisler `tekir_app` rolüyle çalışır; DB adı/nonce, superuser ve BYPASSRLS yokluğu doğrulanır. Şirket modu/otomasyon ayar değişiklikleri izole fixture'a aittir. SMTP taşıyıcısı gerçek gönderim yapmayan ve çağrılırsa hata veren test nesnesidir; hiçbir senaryoda çağrılmadı.

## Sonuçlar

| Kontrol | Kanıt |
| --- | --- |
| Başlangıç pilot durumu | Sentetik açık itiraz takibi, görüşme ve gecikmiş söz hazırlandı. Worker mevcut takibe bir söz bağı ekledi; bir uygulama içi bildirim/teslimat oluştu; teslimat e-postası kapalı |
| Yalnız otomasyonu kapatma | Worker iş üretmedi; manuel pilot yazma erişimi korundu; geçmiş ve finans özetleri aynı |
| Salt okunur mod | Söz/takip okunabiliyor; yazma kontrolü 403; worker iş üretmiyor; geçmiş ve finans özetleri aynı |
| Kapalı mod | Takip okuma/yazma 403; bildirim görünürlüğü kapanıyor; worker iş üretmiyor; kayıtlar silinmiyor |
| Mevcut hatırlatma bileşeni | F02 kapalıyken de açık itiraz önizlemeyi 409 ile engelliyor; ihtar gönderimi hata sonucu veriyor; SMTP çağrısı sıfır |
| Önceki hatırlatma bileşeni karşılaştırması | Git'teki önceki bileşen, aynı açık itiraz ve kapalı F02 ayarında hatırlatma önizlemesini üretebiliyor. Bu, eski bileşende yeni itiraz engelinin olmadığını doğrular; güvenli eski sürüm kabulü değildir |
| Yeniden açma | Aynı söz/takip/görüşme/bağ ve iş audit geçmişi korunuyor; worker tekrarında yeni bağ/bildirim oluşmuyor; aynı bildirim ID'si yeniden görünür |
| Duraklama sırasında gelen söz | Otomasyon kapalıyken yalnız fixture'da ikinci fatura/söz eklendi. Kapalı tarama bunu bağlamadı. Yeniden açılışta aynı takibe bir kez bağlandı; eski bağ değişmedi, görüşme korundu, bildirim/teslimat çoğalmadı. Sonraki tur iş üretmedi |

Snapshot karşılaştırması söz, takip, görüşme, bağ, bildirim, teslimat ve iş audit kayıtlarının ID'ye göre sıralı tam JSON SHA-256 özetlerini kullanır. Ayar değişikliğinin kendi audit kayıtları doğal olarak artar; `modul_ayar` auditleri geçmiş eşitliği özetinden çıkarılır. Finans özeti fatura, cari hareket, kasa/banka hareketi ve fatura kapamalarını kapsar. İkinci sentetik faturanın eklendiği son senaryoda finans karşılaştırması bu fixture eklemesinden sonra başlar. Gerçek şirkette bu kayıtların hiçbiri oluşturulmadı.

## Önceki bileşen neyi kanıtlıyor?

Karşılaştırma kaynağı `be810f68dac68af94444d1dec98c813d38243bc5` commit'indeki `apps/api/src/cari/vade-hatirlatma.service.ts`. Bu commit'in onaylı önceki üretim sürümü olduğu varsayılmadı.

Kaynak bellek içinde TypeScript ile tek bileşen olarak CommonJS'e çevrildi ve yeni adayın mevcut bağımlılıklarıyla yüklendi. Adayın API/web dosyaları değiştirilmedi. Kaynak SHA-256 `b2ba2fd35bcb6b4414178bab0931e7df70522792ce27d7f6410ab4f26c33f90f`; üretilen bileşen SHA-256 `985ed20bdfba2503ac38df9902fc8aff92c28cfa864f186194ad7b6e7718876b`.

Bu tek bileşen önizleme deneyi, tam eski binary derlemesi, bağımlılık uyumu veya gerçek SMTP gönderimi testi değildir. Eski bileşenin açık itirazı dikkate almaması, yalnız F02 modunu kapatıp eski göndericiyi yeniden başlatmanın korumayı sağlayamayacağını gösterir.

Mevcut AI aracı `odeme_hatirlatmasi_gonder`, `vadeHatirlatmaGonder` controller ucuna gider. `UcCagirici` controller metodunu süreç içinden `handler.apply` ile çalıştırır. Bu nedenle sadece HTTP/proxy yolunu kapatmak, ilgili API/worker içi AI yürütme yolunun durduğuna kanıt değildir. Eski göndericiyle servis devam edecekse bütün ilgili yürütme yollarının durdurulduğu ayrıca kanıtlanmalıdır.

## İşletim kaydı ve kalan kapı

[Genel V2 geri dönüş bölümü](arsiv/v2-cli-asistan/v2-release-runbook.md) güncellendi: porta göre süreç öldürme ve kirli çalışma alanında yerinde `git checkout` ile otomatik yeniden derleme adımları çıkarıldı. Ayrı doğrulanmış paket, kontrollü API/worker yönetimi, şema/bağımlılık uyumu, gönderim yollarının durdurulması ve sürüm/işlev doğrulaması şartları belirtildi. Bu belge değişikliği hiçbir süreci durdurmadı.

Yereldeki dört hazırlık adayı F02 içeriyor; birincisi kaynak tutarsızlığı, ikincisi geri yükleme hatası nedeniyle kabul edilmemişti. Bunlar onaylı F02 öncesi geri dönüş paketi yerine seçilmez. Tam eski sürüm provası için API/web/worker dosya kimliği ve bağımlılıkları belli önceki dağıtım paketi hâlâ gerekli. Gerçek takip örneği, üretim kapasitesi ve canlı yayın da açık kalır.

Sonraki araştırmada 20 Eylül tarihli üç tam Docker imajı bulundu ve [ayrı tam imaj provasına](F02-ESKI-IMAJ-UYUMU-VE-BAGIMLILIK-ENVANTERI-2026-10-16.md) alındı. Bunlar yeni şemada fatura detayı ve mevcut web API yönlendirmesi kontrollerini geçemedi; onaylı geri dönüş paketi olarak seçilmedi. Bu kaydın 8 başarılı özellik kapatma/yeniden açma kontrolüyle karıştırılmaz.

Yeniden üretme, depo kökünden ve canlı bağlantı değişkenleri yüklenmeden:

```sh
NODE_PATH="$PWD/apps/api/node_modules" node .release-candidates/f02-pilot-20261016-4/f02-kapatma-geri-acma-prova.cjs
```

Yeni koşum aynı rapor dosyasını yeniler; önceki rapor korunacaksa önce arşivlenir. Her koşum ayrı geçici DB açar. Betik sabit yerel depo yolunu kullanır; taşınırsa yol uyarlanmalıdır.
