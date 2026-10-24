# F04 — Migration, yedek/restore ve geri dönüş provası

22 Ekim 2026. Prova yalnız runner’ın oluşturduğu PostgreSQL 16 konteynerinde yürütüldü. Gerçek şirket veritabanına, çalışan yayın ayarına veya dış servise işlem yapılmadı. Bu çalışma yerel teknik kanıttır; alan pilotu ve tam yayın adayı kabulü değildir.

## Geçen kontroller

Yeni `--f04-prova` modu önce mevcut dört gerçek HTTP/tarayıcı senaryosunu çalıştırır: JWT/rol/tenant sınırları, parolalı üretim ataması ve plan geçmişi, plan–satın alma taslağı ve salt okunur pilot raporu. İlk boş şemaya migration uygulanır ve tekrar deploy edilir. Ardından iş kayıtları oluşmuş **dolu veritabanında** deploy bir kez daha çalıştırılır. Son logda 268 migration ve uygulanacak migration olmadığı görülür; iş kayıtları değişmez.

Prova bütün `public` tablolarını veritabanından listeler. Kimlik alanı olmayan veya bileşik anahtarlı tablolar da kapsanır; satırlar JSONB içeriğine göre sıralanıp sayı/içerik özeti alınır. **219 tablonun** içerik özeti dolu DB deploy tekrarından sonra ve yedekten dönüşte eşleşti. Bu, seçilmiş beş F04 tablosunun karşılaştırmasıyla sınırlı değildir.

`pg_dump -Fc --no-owner` çıktısı yalnız süreç belleğinde tutulur; diske yedek veya parola yazılmaz. Dump aynı izole konteynerdeki ikinci, boş veritabanına `pg_restore --exit-on-error --no-owner` ile açılır. Roller aynı test kümesinde önceden oluşturulmuştur; farklı sunucuda rol/altyapı kurtarma provası yapılmış sayılmaz. Test nonce’u yeni DB’ye test güvenlik kontrolü için ayrıca atanır.

Restore sonrasında dört ilave test gerçek uygulama DB rolüyle çalışır:

- Tarihsel plan, kaynak payı ve satın alma bağı yeni derlenmiş servislerle okunur; pay 7 ve tarihli açık 1 korunur.
- Aynı plan–talep isteği mevcut talebi döndürür; yeni talep, sayaç, olay veya audit yazmaz.
- Başka tenant planı okuyamaz; değişmez plan/bağ yazma izinleri, FK reddi ve beş yeni tablonun RLS/FORCE durumu korunur.
- 19 Ekim’den kalan derlenmiş anlık ihtiyaç controller/servisi, guard’ları ve istek bağlamı yeni şemada yerel HTTP üzerinden çalışır. Anonim istek reddedilir; bu eski modülde yeni plan rotası yoktur. Tarihsel kayıtlar korunur.

İşlevsel testlerden sonra **219 tablonun özeti tekrar aynı** kaldı. İlk dört HTTP/tarayıcı ve restore sonrası dört testin tamamı geçti. İki geçici DB konteynerle birlikte silindi; web, API ve tarayıcı kapatıldı.

## Eski API kontrolünün sınırı

Eski kod yeniden derlenmedi. Yüklenen dokuz yerel modülün SHA-256 değerleri `.release-candidates/f04-ihtiyac-20261019/runtime-manifest.json` ile eşleşti. Test, mevcut lockfile bağımlılıkları ve mevcut üretilmiş Prisma client ile bu eski derlenmiş ihtiyaç modülünü çalıştırır. Eski tam API container’ı, eski web paketi, worker, host servisleri veya ters proxy yayını çalıştırılmadı. Tam sürüm geri dönüşü kabulü açık kalır.

Aynı örnekte eski API’nin anlık açığı **0**, yeni planın tarihli açığı **1**’dir. Eski anlık hesap rezerv dışı tarihli üretim talebini içermediği için bu fark beklenir. Eski sonucu yeni tarihli uygunlukla eşdeğer veya teslim garantisi olarak sunmak doğru değildir.

Geri dönüşte API ve web sürümleri birlikte ele alınmalıdır. Yeni plan bağlı satın alma ekranının eski genel satın alma API’sine bağlanması bu provada kabul edilmedi. Yeni uçlara erişim ve plan–talep akışı geçiş sırasında kapalı tutulmalı; eski akışın yeni tekillik güvencesini taşıdığı söylenmemelidir.

## Gerçek geçişten önce doldurulacak kayıt

| Kapı | Gerekli kanıt | Güncel durum |
|---|---|---|
| G0 | Şirket/depo, sorumlu, doğal iş örnekleri, kapasite tercihi | Kullanıcı/alan kararı bekleniyor |
| G1 | Hesap, DB/RLS, gerçek HTTP ve tekrar güvenliği | Önceki 41 DB testi; bu provada 4 HTTP + 4 restore testi geçti |
| G2 | Doğal işlerde alan sahibi doğrulaması ve baz/sonuç ölçümü | Gerçek şirket pilotu yapılmadı |
| G3 | Somut tam API/web/worker paketi, bağımlılıklar, migration envanteri, yedek ve tam geri dönüş | Bu prova tek başına G3’ü kapatmaz |
| G4/G5 | Yetkili kontrollü geçiş, sürüm/örnek doğrulaması ve yayın sonrası kabul | Yapılmadı |

## Geçiş yönergesi

1. Somut adayın API/web/worker kimliklerini, lockfile ve üretilmiş Prisma client sürümünü sabitleyin. Bu provanın geçici API/web yolları doğrudan dağıtım paketi değildir. Özellikle farklı çalışma alanı değişiklikleri ayrıca kapsamlandırılmalıdır.
2. Seçilmiş pilot şirket/depo, alan sahibi ve kapasite tercihini kaydedin. Salt okunur pilot raporunu gerçek doğal örneklerle alın; alan sahibinin kontrolü olmadan G2 kapatmayın.
3. Hedefte mevcut migration durumunu ve bekleyen migration’ların **tam listesini** çıkarın. Prisma deploy yalnız aşağıdaki üç F04 migration’ını seçerek uygulamaz; başka bekleyen migration varsa ayrı değerlendirin.
4. Erişimi yetkili operasyon kapsamına göre durdurun veya bakım moduna alın; uzun transaction ve devam eden talep/sipariş işlemlerinin bitmesini bekleyin. Gerçek yedeği kurumun erişim/saklama kurallarıyla alın; hedef altyapıda geri açılabildiğini ve rollerin hazır olduğunu doğrulayın. Bu izole bellek dump’ı gerçek üretim yedeği değildir.
5. F04 için gerekli `20261022120000_siparis_giris_tarihi`, `20261022160000_ihtiyac_uretim_ve_plan` ve `20261022190000_ihtiyac_satin_alma_bagi` migration’larını envanter içinde doğrulayın. Migration’lar yeni API’den önce uygulanmalıdır; özellikle satın alma detayları yeni bağı okur. Gerçek mevcut verili şemaya ilk ileri geçişin kilit/süre etkisi bu boş-kurulum provasıyla ölçülmüş sayılmaz.
6. Somut API/web adayını aynı kapsamla açın. Sağlık yanıtına ek olarak seçili stok/depo hesabı, yeni plan okuması, eski kaynak reddi, mevcut bağlı talebe dönüş ve yetkisiz erişimi doğrulayın. Gerçek şirkette sentetik stok/fatura/talep yaratmayın; yazmalı pilot adımları doğal iş kapsamında yetkili kullanıcı yapmalıdır.
7. Yeni API’yi geri alma gerekirse yeni F04 yazma/aktarım akışını kapatın, eski tam paketin hedef şemayla kabulünü doğrulayın ve API/web’i birlikte geri alın. Yeni tabloları, tarihsel snapshot’ları veya bağları silmeyin; ters migration bu provanın yöntemi değildir.
8. Uygulama geri dönüşü ile DB yedeğine dönüşü ayırın. Yedek geri yüklemek yedekten sonraki işleri kaybettirebilir; gerçek ortamda ancak somut veri kaybı/kurtarma kararıyla yapılır. Bu prova o işlemi yetkilendirmez veya gerçekleştirmez.

Kaynaklar ve dağıtım bağımlılıkları doğrulanmadan “kurulumsuz hazır paket” veya “tam geri dönüş geçti” denmez. Kullanıcı bazlı/şirket bazlı F04 açılış ayarı bu dilimde eklenmedi; gerçek erişimin nasıl sınırlandırılacağı somut geçişte ayrıca kaydedilir.

## Tekrar çalıştırma

Hazır yeni API, önceki üretim web paketi ve 19 Ekim ihtiyaç API’si gerekir. Proje kökünde:

```sh
F04_API_DIST=/tmp/tekir-f04-pilot-http-api F04_ESKI_API_DIST=/home/mustafat/Desktop/TekirExtra/.release-candidates/f04-ihtiyac-20261019/api F04_WEB_ROOT=/tmp/tekir-f04-bag-web-vr3hvkyy/.next-bag-final/standalone F04_HTTP_EVIDENCE=../../.release-candidates/f04-gecis-prova-20261022 node apps/api/scripts/f01-yaris-kabul.mjs --f04-prova
```

Geçici yeni API paketi yoksa `node --max-old-space-size=3072 apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.ihtiyac-http.json --outDir /tmp/tekir-f04-pilot-http-api` ile yeniden derlenir. Web paketi yoksa ayrıca üretilmelidir. Docker, yerel portlar ve test Chromium’u gerekir. Runner gerçek bağlantı adresini kullanmaz; Prisma CLI’ye geçici URL zorunlu verilir. Prisma CLI `.env` dosyasını okuduğunu loglayabilir; logdaki veri kaynağı yalnız runner’ın oluşturduğu `f01_yaris_*` DB’sidir.

Kanıt dizini `.release-candidates/f04-gecis-prova-20261022/`: `http-kabul.log`, `migration-tekrar.log`, `restore-kabul.log`, `kabul-ozeti.json`, `geri-donus-ozeti.json`, `eski-api-kaynak-kaniti.json` ve `kaynak-kaniti.json`. İlk Docker sandbox reddinin özeti son başarılı koşum tarafından yenilendi; o deneme DB açmadı. Bu dilim uygulama/web kaynağı veya migration değiştirmedi; önceki paketler kaynak eşleşmesiyle yeniden kullanıldı. Yeni tam API/web derlemesi veya 41 DB testinin tamamı bu dilimde yeniden çalıştırılmadı.
