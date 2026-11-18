# e-Belge Modülü İncelemesi

**Tarih:** 2026-11-10 · **Kapsam:** `main` = `9aa6fce`

## Okunanlar ve sınır

Satır satır okunanlar: gönderim kuyruğu (`ebelge-kuyruk.service.ts`), gönderim, durum sorgusu, gelen belge çekimi, gelen belgenin faturaya işlenmesi, kabul/ret yanıtı ve e-Arşiv iptali (`ebelge.service.ts` içindeki ilgili bölümler), NES adaptörünün çağrı katmanı ile gönderim, arama, durum ve gelen çekim metotları, gömülü görünümün (XSLT) çizildiği kod.

Okunmayanlar: UBL üretimi (`xml-uretec.ts`) ve UBL okuma kuralları, e-İrsaliye servisi ayrıntısı, Sovos adaptörü, ön denetim ve gelen alış denetçisi kuralları, web ekranları. Bu alanlar için aşağıda bulgu yok; "sorunsuz" anlamına gelmez.

Hiçbir bulgu canlı arızayla doğrulanmadı; hepsi kod okumasına dayanır. Önceliklendirme benim değerlendirmemdir.

## Sağlam olan yerler

- **Mükerrer gönderim koruması.** Gönderimden önce veritabanında tekil rezervasyon açılıyor; yeniden denemede önce entegratöre "bu belge sizde var mı" diye soruluyor, varsa yeniden gönderilmeyip benimseniyor. Sorgu yapılamazsa gönderim duruyor. Aynı satışa iki belge kesilme riski iyi kapatılmış.
- **Kalıcı ve geçici hata ayrımı.** Şematron reddi gibi belgeye itirazlar yeniden denenmiyor, ilk hata mesajı korunuyor.
- **Durum takibi.** Entegratöre ulaşılamaması belgeyi "hata"ya çevirmiyor; portaldan yapılan iptal yakalanıp bildiriliyor; son duruma ulaşan belge sorulmuyor.
- **Gelen görünüm güvenliği.** Gönderenin gömdüğü XSLT çevrimdışı tarayıcı bağlamında, tüm ağ istekleri kesilerek, 10 saniye sınırıyla çalışıyor; betik, form ve dış bağlantı düğümleri atılıyor.
- **XML okuma.** Ayrıştırıcı dış varlık çözmüyor, sayısal değerler metin olarak okunuyor.
- **Yetki.** Yazma uçları muhasebe rolüne bağlı, okuma uçları ayrı tanımlı.

## Bulgular

### P1 — ilk gerçek müşterilerden önce

**E-1 · Entegratör çağrılarında zaman aşımı yok.**
`nes-adapter.ts:477` düz `fetch` kullanıyor, süre sınırı verilmiyor. Node'un varsayılanı başlık ve gövde için 300'er saniye. NES yanıt vermezse bir iş 5 dakika asılı kalır. Worker aynı anda 4 iş çalıştırıyor (`EBELGE_WORKER_CONCURRENCY`); dört asılı çağrı tüm firmaların gönderimini, durum sorgusunu ve gelen çekimini durdurur.
*Öneri:* çağrı türüne göre süre (durum ve arama 15 sn, gönderim 60 sn, XML indirme 30 sn). Gönderimde zaman aşımı zaten "belirsiz" sayılıp yeniden denemede arama ile çözülüyor, yani süre eklemek güvenli.

**E-2 · Entegratör çağrısı veritabanı işleminin içinde yapılıyor.**
Üç yerde:
- `durumSorgula` (`ebelge.service.ts:1309-1339`): çağrı `tenantIslem` içinde.
- Fatura iptali (`fatura.service.ts:1147-1249`): işlem içinden `earsivBelgesiniIptalEt` çağrılıyor; o da entegratöre önce durum, sonra iptal çağrısı yapıyor.
- Gitmemiş belgeyi kapatma ve taslağa geri alma (`gitmemisBelgeyiKapat`, `entegratoreUlasmadiginiDogrula`).

İşlemin varsayılan süresi 5 saniye. Entegratör 5 saniyeden geç yanıt verirse işlem düşer. İptalde sıra şu olabilir: entegratör iptali kabul eder, işlem süre aşımıyla geri alınır, fatura bizde canlı kalır. Kod bu durumu ikinci denemede toparlıyor (önce durum sorulup "zaten iptal" görülüyor), ama kullanıcı ilk denemede hata görür ve arada belge iki tarafta farklıdır. Ayrıca çağrı boyunca bir veritabanı bağlantısı tutulur.
*Öneri:* oku, işlemi kapat, entegratörü çağır, sonucu ayrı işlemde yaz. İptalde "iptal isteniyor" ara durumu.

**E-3 · Gelen çekimde tek belgenin hatası tüm taramayı durduruyor.**
`gelenBelgeleriCek` içindeki `isle` hata fırlatırsa (örneğin belge kaydı süre aşımına düşerse ya da metinde veritabanının kabul etmediği bir karakter varsa) tarama yarıda kesilir ve kursör ilerlemez. Sonraki tur aynı pencereyi baştan ister, aynı belgede yine düşer. O belgeden sonra gelen hiçbir fatura kutuya girmez; iş beş denemeden sonra kuyruktan düşer ve saatte bir aynı döngü tekrarlanır. Her turda pencere büyür ve bilinen belgelerin XML'i yeniden indirilir (e-İrsaliye taraması bilinenleri atlıyor, e-Fatura atlamıyor).
*Öneri:* belge başına hata yakalama, sorunlu belgeyi "okunamadı" olarak kaydetme ve bildirim; bilinen belgeyi yeniden indirmeme.

**E-4 · Gelen çekimde sayfa tavanı aşılırsa belge sessizce kayboluyor.**
`nes-adapter.ts:48-53`: sayfa boyu 100, tavan 50 sayfa, yani pencere başına en çok 5.000 belge. Tavana ulaşılınca döngü hata vermeden biter, servis kursörü pencerenin sonuna ilerletir. Kalan belgeler bir daha istenmez. Normal saatlik pencerede olmaz; uzun bir kesintiden sonra ya da yeni bağlanan büyük firmanın ilk 7 günlük penceresinde olabilir. Demo firmada toplam 7.300 gelen belge var.
*Öneri:* tavana ulaşılınca kursörü son işlenen belgenin zamanına ilerletmek ya da açık hata vermek.

**E-5 · Gönderimin yeniden deneme penceresi yaklaşık 75 saniye.**
Kuyruk varsayılanı 5 deneme, 5 saniyeden başlayan üstel bekleme (5, 10, 20, 40 sn). Entegratör iki dakika erişilemezse o sırada gönderilen tüm faturalar kuyruktan düşer ve her biri için elle "yeniden gönder" gerekir. Geçici hatalar için bu pencere kısa.
*Öneri:* geçici hatada denemeleri saatlere yaymak (örneğin 8 deneme, 30 sn başlangıç); kalıcı hata zaten yeniden denenmiyor.

### P2 — ölçek ve bakım

**E-6 · Kuyruk ekranı tüm firmaların işlerini tarıyor.** `ozet()` ve `listele()` kiracıya göre süzmek için kuyruktaki bütün işleri sayfa sayfa okuyor; tamamlanan işlerden 10.000'i saklanıyor, başarısız işler hiç silinmiyor (`removeOnFail: false`). Pilotta 149 tamamlanmış iş var, sorun yok; firma sayısı arttıkça her ekran açılışı binlerce Redis okuması olur ve başarısız işler birikir. *Öneri:* firma başına sayaç tutmak, başarısız işlere saklama süresi.

**E-7 · Gelen belgenin faturaya işlenmesi iki ayrı işlem.** Fatura önce oluşturuluyor, gelen belgeyle bağ ikinci işlemde kuruluyor; bağ kurulamazsa fatura siliniyor. Çift tıklama tekil kısıtla korunuyor. İki işlem arasında süreç çökerse bağsız bir taslak alış faturası kalır ve belge "beklemede" görünür; kullanıcı yeniden işlerse ikinci taslak oluşur. Olasılığı düşük. *Öneri:* tek işlem ya da açılışta bağsız taslak taraması.

**E-8 · Gömülü görünüm tarayıcının XSLT desteğine bağlı.** Gelen belgenin görünümü Chromium'un `XSLTProcessor` özelliğiyle çiziliyor. Chrome ekibi bu özelliği kaldırmayı planladığını duyurmuştu; tarih ve Playwright sürümlerine etkisi bu incelemede doğrulanmadı. Kaldırıldığında kod yedek görünüme düşer, PDF bozulmaz ama gönderenin tasarımı kaybolur. *Öneri:* Playwright sürümünü sabit tutmak ve sunucu tarafı bir XSLT işleyicisini denemek.

**E-9 · Planlayıcı firmaları sırayla ve tek süreçte dolaşıyor.** Beş dakikada bir her firma için birkaç sorgu çalışıyor ve iki worker aynı anda çalışırsa işler çift planlanabilir (iş kimlikleri sabit olduğu için çift gönderim olmaz, yalnız boşa sorgu). Genel incelemedeki tek worker maddesinin parçası.

**E-10 · `ebelge.service.ts` 2.949 satır.** Gönderim, gelen kutusu, e-Arşiv ve ön denetim aynı sınıfta. E-2 düzeltilirken gönderim ve iptal ayrı dosyaya alınabilir.

**E-11 · Elle XML yükleme 2 MB gövde sınırına takılabilir.** Gelen belgelerin 1,9 MB'a ulaştığı görülmüştü; JSON içinde gönderildiği için gömülü ekli belge sınırı aşar ve kullanıcı anlamsız bir hata görür. *Öneri:* dosya yükleme olarak almak ya da bu uçta sınırı yükseltip açık mesaj vermek.

### Gözlem

- Pilot kuyruğunda şu an 1 başarısız iş ve 1 kuyruktan düşmüş iş duruyor; içeriğine bakılmadı.
- Canlıda çalışan tek entegratör NES. Sovos adaptörü kodda var; canlı denenip denenmediği bu incelemede doğrulanmadı.

## Durum (2026-11-10)

E-1, E-3, E-4 ve E-5 düzeltildi. E-2 kısmen: durum sorgusu işlem dışına alındı; fatura iptali ve taslağa geri alma çağrıyı bilinçli olarak işlem içinde tutuyor, işlem süresi 90 saniyeye çıkarıldı. "İptal isteniyor" ara durumlu iki aşamalı akış yapılmadı. e-İrsaliye taramasında E-4 tavanı hâlâ var.

## Önerilen sıra

1. E-1 zaman aşımları (küçük iş, en geniş etki).
2. E-3 ve E-4 birlikte: gelen çekimin belge başına dayanıklı olması ve tavan davranışı.
3. E-2 entegratör çağrılarını işlem dışına almak (iptal akışı dikkat ister).
4. E-5 yeniden deneme aralıkları.
5. E-6 ve sonrası fırsat oldukça.
