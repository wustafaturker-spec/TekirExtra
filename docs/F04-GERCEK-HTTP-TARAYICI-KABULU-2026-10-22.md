# F04 — Gerçek HTTP ve tarayıcı kabulü

22 Ekim 2026. Üretim ataması ve kalıcı ihtiyaç planı için izole PostgreSQL, derlenmiş API controller/servisleri ve önceki dilimde üretilmiş standalone web paketi birlikte doğrulandı. Gerçek şirket verisine bağlanılmadı; yayın yapılmadı.

## Doğrulanan akış

İki kabul testi geçti. İlk test gerçek JWT/rol guard’ları üzerinden anonim ve bozuk token için 401, satış rolü için 403, başka tenant’ın üretim kalemine 404, geçersiz plan UUID’sine 400 ve eski atama sürümü/olmayan liste imlecine 409 yanıtlarını doğrular.

İkinci test Chromium’da parola ile giriş yapar. API yanıtı taklidi veya tarayıcıya token enjeksiyonu kullanılmaz. Üretim kaleminin hammadde deposu başlangıçta boş görünür; kullanıcı depo, gün ve gerekçeyi girerek atar. Girdilerle açılan tarihli ihtiyaç ekranından hesaplanıp plan saklanır. Gerçek DB’de tek plan ve tek plan audit kaydı doğrulanır. Mevcut stok 10, önceki üretim ihtiyacı 3, yeni ihtiyaç 8 için tarihli açık 1 ve yeni ihtiyacın stok payı 7’dir.

Plan geçmişi güncel hesabı gösterir. Test üretim kaynağını DB’de 3’ten 4’e değiştirir; ekranın yeniden kontrolü planı eski olarak işaretler. Kaydedilen snapshot değişmez. Test miktarı geri alır; stok bakiyesi, stok hareketi, üretim kaleminin iş miktarları ve satın alma taleplerinin başlangıçla aynı kaldığını doğrular. Mobil 390 pikselde yatay taşma yoktur. Tarayıcıda 29 API isteği aynı origin’deki gerçek test API’sine gider ve yakalanan sayfa JavaScript hatası yoktur.

## Ortam ve sınırlar

Runner `--f04-http` kendi boş PostgreSQL 16 konteynerini açar, migration’ları uygular ve superuser/RLS bypass olmayan uygulama rolüyle çalışır. DB adı, yerel adres, kullanıcı, rastgele nonce ve rol özellikleri test başında denetlenir. Son koşumda geçici DB silindi; web/API/proxy ve tarayıcı kapatıldı.

Test modülü gerçek Auth, Stok, Depo ve İhtiyaç controller’larını, ilgili gerçek servisleri ve guard’ları kullanır. Tam uygulama modülünün açılışı, harici servisler, sayım/transfer işlemleri ve bildirim modülleri bu kabulün kapsamı değildir. İş fixture’ları yalnız geçici DB’de oluşturulur. Aynı origin proxy, üretim web paketinin API isteklerini yerel test API’sine taşır. Web paketinin kimliği `uitda57Sb9p76mfgZDerA`; kaynak eşleşme kanıtı önceki plan yönetimi kabul dizinindedir. Bu test dağıtım veya gerçek şirket pilotu değildir.

İlk deneme test modülünün başlangıcında durdu. İkinci denemede HTTP Decimal serileştirmesi `7` dönerken testin `7.000` beklemesi nedeniyle bir test başarısız oldu. Uygulama davranışı değiştirilmedi; test beklentisi gerçek sözleşmeye uyarlandı. Son koşum **2/2** geçti.

Tam API TypeScript kontrolü bu dilimde yeniden çalıştırıldı ve **başarılı** oldu. Önceki süre aşımı bu son sonuçla kapandı. Bu dilimde web uygulama kaynakları değişmedi; önceki 31 DB/RLS ve 21 fixture tarayıcı sonucu tarihsel kanıttır, yeniden koşulmuş sayılmaz.

## Tekrar çalıştırma

Önce hazır API paketini üretin:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-http-api
```

Ardından mevcut standalone web paketinin yolu ile proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-http-api F04_WEB_ROOT=/tmp/tekir-f04-ui-nudowv8a/.next/standalone node apps/api/scripts/f01-yaris-kabul.mjs --f04-http
```

Geçici web paketi kaldırılmışsa önce yeniden üretilmelidir. Test DB bilgileri runner tarafından sağlanır; `.env` okunmaz. Docker ve yerel servis portları gerekir. Tam API tür kontrolü:

```sh
node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
```

Kanıtlar `.release-candidates/f04-http-20261022/` altındadır: `http-kabul.log`, `kabul-ozeti.json` (DB temizliği dahil), `tarayici-ozeti.json`, `gercek-api-plan-mobil.png` ve `kaynak-kaniti.json`. Kaynak kanıtı derlenmiş API dosyalarının ve bu dilimdeki test kaynaklarının SHA-256 değerlerini içerir. Tür kontrolünün boş başarılı çıktısı ve komut/çıkış kodu ayrıca kaydedildi.

## Kalan işler

Plan–satın alma taslağı arasında atomik bağ/tekilleştirme, planlar arasında kapasite tahsisine ilişkin ürün kararı ve operasyon pilotu açıktır. Birleşik kabul yalnız bu belgede tarif edilen atama/plan akışını kapatır; tüm F04 modülünün bütün senaryolarının veya gerçek şirket yayınının kabulü sayılmaz.
