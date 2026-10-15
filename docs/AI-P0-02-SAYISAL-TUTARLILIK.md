# P0-02 — Sayısal doğruluk ve kapsam tutarlılığı

14 Ekim 2026 — Kapsam/sayı gösterimi, olgu kimlikli finans yanıtı, PostgreSQL rapor eşitliği ve izole HTTP/Chromium kabulü geliştirildi. 21:56'da kullanıcı onayıyla yerel çalışan sürüme geçirildi; paket devam ediyor, pilot/canlı model kabulü ve diğer kalan işler açık.

Aşağıdaki geliştirme dilimlerindeki “henüz yayınlanmadı” ifadeleri o aşamanın tarihsel durumudur. Güncel yayın sonucu [geçiş kaydındadır](AI-P0-02-YAYIN-ADAYI-2026-10-14.md).

## Yapılan değişiklikler

Nakit akışı hesabı bazı bordro SGK/muhtasar kalemlerini zaten dahil ediyordu, fakat ekran/API kapsam metni bunların tamamen hariç olduğunu söylüyordu. Hesap motorunu veya vergiyi değiştirmeden açıklama gerçek davranışla hizalandı:

- KDV beyanname ödemeleri ve bordro dışındaki vergi/prim yükümlülüklerinin ayrıca hesaplanmadığı belirtildi; fatura genel toplamındaki KDV bununla karıştırılmıyor.
- Hesap özeti bulunan bordro dönemlerinin SGK/muhtasar kalemleri hesaplanan vade ufuktaysa dahil. Ayrı ödeme takibi olmadığı için kalem kesin, ödenmemiş borç olarak sunulmuyor. Geçmiş vadeler hariç; onaylanmamış bordro ve sonraki aylara tekrar tahmin olarak işaretleniyor.
- Ciro/teminat evrakı vade portföyünde görünse bile beklenen nakit hesabına eklenmiyor. Mevcut nakit sorgusu yalnız alınan portföy/tahsile verilmiş ve verilen/verildi durumlarını kullanmaya devam ediyor.
- Nakit senaryosu ile tahakkuk/kâr raporu ayrıldı; kalan genel toplam, ters iade yönü, taslak/iptal hariç tutma, vade yoksa belge tarihi ve kur esasları API metadata'sında açıklandı.
- Web'de “Hesap kapsamı ve varsayımlar” bölümü eklendi. Yeni `kapsamNotlari` alanı opsiyonel okunur; eski API cevabı ekranı bozmaz.

Finans kaynak kartlarında güvenli kuruş aralığını aşan JSON `number` değerleri artık güvenilir para değeri gibi gösterilmiyor. Uyarı içeren kaynak kartı korunuyor; büyük/negatif `decimal-string` değerleri değiştirilmeden gösterilmeye devam ediyor. Farklı dövizler yine ayrı; örnek satırlardan toplam hesaplanmıyor. Bir carinin hassasiyet uyarısı diğer kayda taşınmıyor.

Bu koruma daha önce number'a çevrilmiş veride kaybolan basamakları geri getirmez. Tüm rapor/API hesap motorlarının Decimal'e taşındığı veya tüm tutarların artık decimal-string döndüğü anlamına gelmez.

## Doğrulama

Hedefli test kümesi:

```bash
pnpm exec vitest run src/ai/ajan/finans-kaynaklari.test.ts src/nakit-akisi/nakit-akisi.service.test.ts src/nakit-akisi/nakit-akisi.hesap.test.ts src/kasa-banka/cek-vade-analizi.test.ts
```

Testler büyük/negatif tutar, döviz ayrımı, kesilmiş rapor, kur geri dönüşü, bordro kapsamı, gerçek yasal kalem üretimi, geçmiş vadeyi dışlama, tahmin işareti ve çek nakit/vade ayrımını kapsar. Bordro testinde mevcut motorun hafta sonu vadesini pazartesiye taşıması esas alındı; yeni bir yasal vade kuralı yazılmadı.

Sonuç: 4 dosyada 30 test başarılı. API ve web TypeScript kontrolleri başarılı; `git diff --check` temiz.

Bu dilimde canlı şirket kaydı değiştirilmedi, AI sağlayıcısı çağrılmadı; servis yeniden başlatılmadı. Kaynak kodundaki değişiklikler çalışan sürümde henüz yoktur.

## İkinci dilim — Olgu kimlikli finans yanıtı

Kaynaklar: [finans-aciklama.ts](../apps/api/src/ai/ajan/finans-aciklama.ts), [asistan döngüsü](../apps/api/src/ai/ajan/ai-ajan.service.ts).

- Başarılı, izinli finans araçlarından alınan kaynakların tutar ve tarih alanları `finans-olgu-v1` olgularına çevrilir. Kimlik araç, adres, kaynak zamanı ve alan/snapshot içeriğine bağlıdır; başka snapshot'ın kimliği kabul edilmez.
- Finans kaynağı alındıktan sonra modelin son cevabı yalnız `{"olguIdleri":["f-..."]}` seçimidir. En çok 20 benzersiz, bu turdaki bilinen kimlik kabul edilir. Yeni tutar/oran/tarih, serbest açıklama ve ilave alanlar reddedilir.
- Kullanıcıya gösterilen tutar/işaret/döviz/tarih uygulama tarafından kaynak olgusundan biçimlendirilir. Model parasal metni veya tarihi yazmaz. Mevcut sözleşmede oran olgusu yoktur; yeni oran hesabı yapılmaz.
- Bu ilk güvenli sürüm serbest finansal yorum değil, kaynaklı kalem seçimi ve uygulama şablonudur. Modelin seçtiği kalemlerin soruya en uygun olduğu veya ekonomik yorumun doğru olduğu kanıtlanmış sayılmaz. İleride sayısal olmayan yorum eklenirse ayrı anlamsal denetim gerekir.
- Geçersiz metin/JSON, bilinmeyen/yinelenen/eski kimlik, yeni alan veya finans kaynağı alındıktan sonraki model hatası güvenli kaynak özetine döner. Özet ilk 20 olguyla sınırlanır ve kısaltmayı belirtir; kaynak kartları korunur.
- Model hatası/yanıtı loga içerik olarak yazılmaz. Güvenli geri dönüş “hiçbir kayıt değişmedi” iddiası üretmez; daha önce bir araç çalışmış olabilir. Mevcut rol/onay/araç yürütme kuralları korunur.
- Olgular, seçilen kimlikler, doğrulama/geri dönüş durumu ve nedeni yanıt/sohbet metadata'sında saklanır. Yeni kolon veya migration gerekmedi. Geçmiş API'si metadata'yı geri döndürür; mevcut web kaynak kartı yanıt metninden bağımsız kalır.
- Kaynak tekilleştirme ve 20 kart sınırı model/olgu hazırlığından önce uygulanır. Böylece açıklamadaki kaynak indeksi dönen kaynak kartlarıyla uyumludur. Fazla kaynak için `kaynaklarKisaltildi` bilgisi korunur.
- Harici e-posta/OCR ve başarısız araç çıktıları finans kaynağı/olgusu değildir. Bu koruma yalnız mevcut finans kaynak adaptörlerinin kapsadığı alanlarda devrededir; tüm asistan serbest metnini ve tüm modülleri denetlediği iddia edilmez.

Doğrulama: 5 dosyada 63 test başarılı (10 yeni olgu testi, 33 asistan döngüsü testi, 8 kaynak kartı testi, 5 işlem iddiası denetimi ve 7 görev testi). Yeni döngü testleri doğru kimlik seçiminden kaynak tutarının gösterimini, model arızasında kart/özetin dönmesini, açıklama metadata'sının geçmişte korunmasını, harici e-postanın dışlanmasını ve 20 kart sınırında indeks eşitliğini sınar. Test sağlayıcısı ve sahte uç/DB kullanılır; canlı Gemini veya gerçek tarayıcı uçtan uca kabulü değildir.

```bash
pnpm exec vitest run src/ai/ajan/finans-aciklama.test.ts src/ai/ajan/ai-ajan.service.test.ts src/ai/ajan/finans-kaynaklari.test.ts src/ai/ajan/yanit-denetimi.test.ts src/ai/ayarlar/ai-gorev.test.ts
```

Bu dilimde de canlı ticari veri değiştirilmedi, dış model çağrısı veya yayın yapılmadı.

İkinci dilimin API TypeScript kontrolü başarılı; `git diff --check` temiz. Web kaynak kodu bu dilimde değiştirilmedi.

## Üçüncü dilim — Ekran API'si / AI aracı eşitliği

Test: [ai-rapor-esitligi.kabul.test.ts](../apps/api/test/ai-rapor-esitligi.kabul.test.ts).

Gerçek PostgreSQL uygulama rolünde, RLS altında çalışan üç senaryo hem İstanbul hem UTC süreç saat diliminde başarılı. Araçlar gerçek `UcCagirici`, `Reflector`, controller ve rapor servislerini kullanır; rapor sonucu veya veritabanı sorgusu mock değildir. Yalnız aracın “bugün” değeri 14 Ekim 2026 olarak sabitlenir; Date constructor değiştirilmez.

1. Gelir-gider: AI'nın varsayılan bitişi bugüne çekmesiyle oluşan etkin dönemde ekran controller'ı ve AI çıktısının özet/kâr-zarar alanları aynıdır. USD belge kuru 40 ile çevrilir, satış iadesi düşülür, taslak/iptal ve dönem dışı belgeler hariçtir. Test verisinde net satış 2050, hizmet gideri 300, net kâr 1750 TRY'dir. İleri tarih açıkça istendiğinde aynı ileri dönem ekranıyla eşitlik ve net kâr 2450 doğrulanır. Dar dönemde net kâr -200; olgu seçimi bunu -200,00 TRY olarak korur. Kaynak linki yeniden çalıştırıldığında aynı sonuç döner. Fatura tarihleri şemada `@db.Date` olduğundan bu sınır gün bazlıdır; timestamp saat hassasiyeti için genel bir garanti değildir.
2. Katalog raporu: tarih, belge tipi ve cari/tip gruplaması aynı ekran controller'ına iletilir. 36 satırlı sonuçta AI yalnız ilk 30'u görür, ama net satış toplamı tam 36 satır üzerinden 2085 olarak kalır. Kart “30 / 36” uyarısını verir; linkteki `f.*` süzgeçleri ve `g` gruplaması yeniden çalıştırıldığında toplamlar eşittir. Yalnız satış/tip süzgeci tek satır üretir; toplam satırı null iken kart gerçek satırdaki 2135.00 değerini gösterir.
3. Finansal özet: AI ve ekran controller'ının aynı hesabı döndürdüğü doğrulanır. Gerçek uç rol kontrolü depo rolünü finansal özetten, rapor servisinin rol kontrolü de kâr marjı raporundan reddeder. Başka bir test şirketinin 999999 tutarlı satışı ilk şirketin raporuna karışmaz.

Testlerin her biri yalnız iki rastgele test şirketi ve kendi sentetik kayıtlarını oluşturur. Tüm rapor tercih kayıtları dahil tek transaction sonunda bilinçli rollback yapılır; sonrasında iki şirketin de bulunmadığı ayrıca kontrol edilir. Var olan şirket kayıtları okunmaz/değiştirilmez, dış AI sağlayıcısı çağrılmaz. Test hedefi yalnız `tekirextra` veritabanıdır; RLS atlayan rol varsa test başta durur.

```bash
TZ=Europe/Istanbul pnpm exec vitest run --config vitest.kabul.config.ts test/ai-rapor-esitligi.kabul.test.ts
TZ=UTC pnpm exec vitest run --config vitest.kabul.config.ts test/ai-rapor-esitligi.kabul.test.ts
```

Önceki 63 birim/döngü testi de tekrar başarılı. Bu dilimde uygulama davranışı/şema değiştirilmedi; yalnız kabul testi ve ilerleme belgeleri eklendi. Bu, çalışan HTTP sunucusuna giriş yapan gerçek tarayıcı veya canlı model testi değildir. Ekranın kullandığı controller yoluyla AI'nın gerçek uç çağrısının DB sonuçları karşılaştırılmıştır. Tarayıcıdaki görünüm, oturum/HTTP guard'ları ve tüm ERP raporları için tam uçtan uca kabul hâlâ açıktır.

## Dördüncü dilim — Gerçek HTTP ve tarayıcı kabulü

Test: [ai-finans-http-tarayici.kabul.test.ts](../apps/api/test/ai-finans-http-tarayici.kabul.test.ts).

Tek senaryoda gerçek Nest HTTP sunucusu, `AuthGuard`/`RollerGuard`, imzalı test JWT'leri, `UcCagirici`, rapor/asistan controller ve servisleri, gerçek PostgreSQL uygulama rolü/RLS ve Chromium beraber çalıştırılır. Next web dinamik geçici portta `.next-ai-http-e2e` klasöründen açılır; canlı 3001/3100/worker servislerine dokunulmaz. Test sonunda Next/Chromium/HTTP sunucusu kapatılır.

Doğrulanan davranışlar:

- Kimliksiz ve bozuk token'lı gerçek HTTP çağrısı 401; depo rolünün mali rapor isteği 403.
- İki rastgele test şirketinin raporu ayrı: birinde 100 satış ve 300 hizmet gideri ile -200 net kâr; diğerinde 999999 satış ve 300 hizmet gideri ile 999699. Şirket bağlamı doğrulanmış JWT'den kurulur.
- Kullanıcı tarayıcıda gelir-gider ekranını seçili tarihlerle açar; negatif kâr görünür. Asistana mesaj gönderir; gerçek HTTP yanıtındaki kaynak kalemi ekran API hesabıyla eşittir ve doğrulanmış olgu durumundadır.
- Kaynak kartı -200,00 TRY'yi gösterir; rapor linki aynı başlangıç/bitiş tarihlerini taşır.
- Sentetik model ikinci istekte hata verir: HTTP yanıtı güvenli kaynak özetini ve kartı taşır; tarayıcı bunları gösterir.
- Sayfa yeniden yüklenip asistan açıldığında güvenli özet ve iki kaynak kartı gerçek geçmiş endpoint'inden geri gelir.

Test sınırlamaları:

- Yalnız model sağlayıcısı sentetiktir; gerçek Gemini çağrısı, sağlayıcı kota/maliyet/aktarımı onayı veya model kalite ölçümü yapılmaz.
- HTTP sunucusu gerçek controller/servis/kimlik/rol bileşenlerini içeren minimal test modülüdür. Tam `AppModule`, dağıtılmış build, reverse proxy, rate limit, refresh-cookie, TOTP ve tüm üretim middleware'leri bu senaryonun kapsamı değildir.
- Tarayıcı gerçek imzalı test access token'ıyla başlatılır; parola giriş ekranı sınanmaz. Menü kimliği/bildirim/e-belge/boş onay listesi test yanıtlarıdır. Rapor ve asistan istekleri mock edilmez: tarayıcı test yönlendirmesi bunları gerçek izole HTTP sunucusuna iletir. Allowlist dışındaki API çağrıları 404 alır; canlı API'ye düşmez.
- Asistana yalnız gerçek yetki kontrolünden geçen gelir-gider okuma aracı sunulur. Mali kayıt yazma/onay aracı yoktur; sohbet/geçmiş kayıtları kendi test şirketi transaction'ında oluşur.
- İki test şirketi, faturalar ve sohbet kayıtlarının hepsi aynı transaction sonunda rollback edilir; şirketlerin artık bulunmadığı ayrıca denetlenir. Var olan şirket/ticari kayıtlarına dokunulmaz. Geçici Next dosyaları gitignore kapsamındadır; Next'in ürettiği tip/tsconfig güncellemeleri mevcut kullanıcı değişiklikleri korunarak bırakılır.

```bash
pnpm exec vitest run --config vitest.kabul.config.ts test/ai-finans-http-tarayici.kabul.test.ts
```

İlk koşu başarılı: 1 birleşik kabul senaryosu, yaklaşık 40 saniye. Yeni uygulama davranışı veya migration bu dilimde eklenmedi; test ve ilerleme belgeleri eklendi. Önceki P0-02 kaynak kodu değişiklikleri çalışan canlı sürüme henüz aktarılmadı.

Birlikte tekrar koşu da başarılı: 63 birim/döngü testi + 7 gerçek PostgreSQL kabul testi (1 HTTP/Chromium, 3 rapor eşitliği, 3 salt okunur envanter), toplam 70 test. Web TypeScript kontrolü ve `git diff --check` başarılı. Test sunucuları kapatıldı; test şirketlerinin bulunmadığı doğrulandı.

## Kalan işler

Yayın (14 Ekim): API ve ayrı üretim web derlemesi başarılı; derlenmiş API bileşenleri + üretim Next üzerinde izole HTTP/Chromium kabulü tekrar geçti. Bu koşuda 85 birim + 7 kabul testi, toplam 92 test başarılı. Kullanıcının “evet” onayıyla API/worker/web 21:56'da yeni sürüme geçirildi; sağlık, süreç ve web dosya kimliği doğrulandı. Aktarım onayı korundu; manuel Gemini testi yapılmadı. Dosya kimlikleri, geri dönüş adayları ve sonuç [yayın kaydında](AI-P0-02-YAYIN-ADAYI-2026-10-14.md).

1. P0-01'in ayrıntılı veri/alan uzmanı ve pilot kabulünü tamamlamak. Buna paralel bu dilimde yalnız mevcut hesap kapsamı ve güvenli kaynak gösterimi iyileştirildi.
2. Olgu kimlikli şablon için kontrollü canlı model ve dağıtılmış uygulama kabulü. İzole HTTP/tarayıcı akışı doğrulandı. Serbest finans yorumu bilinçli olarak henüz desteklenmiyor; oran olguları ancak uygulamanın doğrulanmış hesap çıktısından eklenebilir.
3. Controller/veritabanı eşitliği üç çekirdek rapor senaryosunda, gelir-gider/asistan akışı gerçek HTTP/Chromium ile doğrulandı. Tam uygulama ve diğer rapor/modüllere genişletmek; henüz eklenmeyen modül araçları için ilgili P1 paketlerine bağımlılık var.
4. Nakit hesaplarının büyük değerlerde tüm ara toplamları ve kur dönüşümü için sayısal sınır/Decimal incelemesi; bu dilim hesap motorunu yeniden yazmadı.
5. Yeni derleme, izole kabul ve kontrollü yerel geçiş tamamlandı. Yayın sonrası gerçek kullanıcı pilot kabulü, tüm AppModule/worker iş teslimleri ve operasyonun kalıcı süreç/geri dönüş yönetimi açık.

P0-02 tamamlandı işaretlenmez; tahmin/model doğruluğu veya canlı model başarısı iddia edilmez.
