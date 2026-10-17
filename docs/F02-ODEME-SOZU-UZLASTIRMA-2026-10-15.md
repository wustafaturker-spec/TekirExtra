# F02 — Ödeme sözü uzlaştırma çekirdeği

Sonraki teslim: [Kalıcı söz servisleri, gerçek kaynak okuması ve geçici DB kabulü](F02-KALICI-ODEME-SOZU-SERVISLERI-2026-10-15.md). Aşağıdaki metin önceki çekirdek tesliminin tarihli kapsamıdır.

15 Ekim 2026. F02-01 teknik başlangıcıdır. Servis, migration, RLS, API ve ekran henüz eklenmedi; çekirdek uygulamanın çalışan yollarına bağlanmadı. F01 gerçek şirket pilotu beklemeye devam ediyor. Canlı veri ve şirket ayarı değiştirilmedi.

## Kaynak incelemesinden çıkan kararlar

`FaturaKapama` tutarı kapanan faturanın dövizindedir. `fatura/denklestirme.ts` otomatik kapamaları her denkleştirmede silip yeniden oluşturur; elle kapama yazımı da önceki satırı değiştirebilir. Bu yüzden kapama UUID'si kalıcı ödeme kimliği değildir. Gerçekleşme hesabının anahtarı şirket kapsamındaki fatura + kaynak türü + kaynak ödeme kimliğidir; güncel kapama UUID'leri yalnız o hesap anının kanıtıdır. Eski ve yeni kapama snapshot'ları birleştirilmez.

İlk gerçekleşme kapsamı aynı dövizli satış faturası ve kasa/banka tahsilatıdır; POS'un ürettiği kasa/banka tahsilatı da bu kapsama girebilir. Tediye, alış/iade faturası mahsubu, çekin teslim alınması veya kredi kartı harcaması nakit tahsilatı kabul edilmez. Kur dönüşümü ve çek yaşam döngüsü bu dilime dahil değildir. İade faturası faturanın kalanını azaltabilir; bu, ödeme sözünün nakit gerçekleşmesi değildir.

Birden çok söz aynı faturayı hedefliyorsa kaynak havuzu önce sözün veriliş zamanı, eşitse söz kimliği sırasıyla paylaşılır. Her havuzun toplam payı güncel kapama tutarını, her sözün gerçekleşmesi söz tutarını aşamaz. İptal/revize söz havuz tüketmez. Revizyon yeni söz kimliği ve yeni veriliş zamanıyla değerlendirilir; eski tahsilat yeni sözün başarısı olarak taşınmaz. Bu politika alan sahibiyle pilot öncesi gözden geçirilecek teknik karardır.

## Zaman sınırı

`KasaBankaHareket.tarih` PostgreSQL `date` alanıdır; gerçek işlem saati içermez. `createdAt` kaynak kaydının oluşturulma zamanıdır; banka işleminin saati veya kapamanın oluşturulma zamanı yerine kullanılamaz.

Çekirdek açıkça `gun` veya `an` hassasiyeti ister. Gün hassasiyetinde tarih DB'den UTC gece yarısı temsiliyle aktarılır ve sözün Türkiye takvim gününden **sonraki gün** olmalıdır. Aynı günün sırası kanıtlanamadığından otomatik gerçekleşme sayılmaz. An hassasiyeti yalnız güvenilir gerçek işlem saati mevcutsa kullanılabilir; işlem ve kaynak kayıt zamanı sözden kesinlikle sonra olmalıdır. Eşit damga, geçmiş tarihli sonradan kayıt ve gelecekteki kaynak dışlanır. Gün hassasiyetinin aynı gün tahsilatlarını eksik gösterebilmesi bilinen sınırlamadır; pilot ekranı bu ayrımı göstermeli, tam saat olmadan gerçekleşti iddiasında bulunmamalıdır.

## Hesap ve durumlar

`apps/api/src/cari/odeme-sozu-uzlastirma.ts` saf, tekrar çalıştırılabilir hesap sağlar. Para girdileri sabit iki ondalıklı metindir; hesap `Prisma.Decimal` ile yapılır. Kaynakların doğrulanmış güncel snapshot'ı dışında olay birikimi, mali kayıt, nakit hareketi veya mesaj üretmez.

- Ödeme yoksa `aktif`, kısmi ödeme varsa `kismen_gerceklesti`, tamamsa `gerceklesti`.
- Türkiye takviminde söz günü geçip kalan varsa `gecikti`; gerçekleşen ve kalan ayrıca korunur.
- `iptal` / `revize` kayıtlar ayrı görünür; sıfır gerçekleşme ve özgün söz tutarı kadar kalan bilgi amaçlıdır, açık alacak üretmez.
- Taslağa alınmış/iptal fatura için `kaynak_gecersiz`; eski gerçekleşme korunmaz.
- Aynı kapama tekrar verilirse bir kez sayılır; aynı UUID'nin çelişkili içerikleri reddedilir. Aynı ödemenin çelişkili cari/döviz/zaman bilgisi reddedilir.
- Başka şirket/cari/döviz/faturanın kapaması hesaba girmez. Sözün hedef kapsamı yanlışsa hesap bütünü reddedilir.
- En fazla 1.000 fatura, 1.000 söz, 5.000 güncel kapama kabul edilir. Sınır aşımında kısmi sonuç üretilmez. Servis katmanı limit + 1 okumalı; sessiz kırpma yapmamalıdır.

Geri almada güncel kapamalar tekrar verilir: 1.000 söz / 400 kapama → 400 gerçekleşen, 600 kalan; ikinci 600 → tamamı; ilk 400 kaldırılırsa → 600 gerçekleşen, 400 kalan. Tam geri almada sıfıra döner. İade/ters kayıt düşümü bu çekirdeğin değil, gerçek kaynak adaptörünün sorumluluğudur.

## F02-02 entegrasyon gereksinimleri

Bu saf çekirdek bir yetkilendirme veya muhasebe bütünlüğü sınırı değildir. Girdiler istemciden kabul edilemez. Sonraki servis:

1. RLS ve açık tenant koşullarıyla, tek tutarlı transaction snapshot'ında tüm hedef sözleri ve güncel kaynakları okumalı; sonuçta gerçekleşmiş görünen ama mantıksal kaydı aktif olan sözleri okumadan çıkarmamalıdır. Aksi halde tüketilen pay yeni söze yeniden verilebilir.
2. Mevcut cari kilidi/denkleştirme sırasıyla uyumlu olarak söz yazımı ve kaynak uzlaştırmasını seri hale getirmeli; sürüm kontrolü ve audit eklemelidir.
3. Kaynak ödeme yönünü, desteklenen `kaynakTur` değerlerini, dövizi, gerçek işlem tarihini ve kayıt zamanını DB'den doğrulamalıdır. Ters kayıt/POS iadesi düşülmüş kapamalar üretmelidir; yalnız elle kapama toplamına güvenmemelidir. Gerekirse mevcut denkleştirme kaynağı düzeltilmelidir.
4. Bir ödemenin farklı faturalardaki toplam kapama payını gerçek net ödeme kapasitesiyle doğrulamalıdır. Çekirdek her fatura havuzunu sınırlar; yanlış mali kaynak verisini tek başına kanıtlayamaz.
5. Kalıcı gerçekleşme izini yalnız kapama UUID'sine cascade bağıyla kurmamalı; kaynak ödeme kimliği + fatura bağı ve hesap anındaki kapama kanıtını korumalıdır. Kaynak silinince başarı damgası kalmamalıdır.
6. İlk UI bir söz/bir fatura/aynı dövizle başlamalı. Görüşme, itiraz, sorumlu ve sonraki işlem mali bakiye üretmemelidir. İptal/revizyon gerekçesi ve geçmişi kalıcı olmalıdır.
7. Nakit planında söz tutarını yeni alacak olarak eklememeli; mevcut faturanın beklenen tarih/dağılımını güncellemelidir. Çekirdek henüz nakit planına bağlı değildir.

## Doğrulama

Yeni çekirdek için 50 birim senaryosu ve mevcut fatura ödeme/denkleştirme için 24 regresyon testi: toplam 74 test. Testler sentetiktir; gerçek DB, RLS, eşzamanlı servis, HTTP veya tarayıcı kabulü yerine geçmez.

Tam API derlemesinin ilk denemesi mevcut `assistant.module.ts` içindeki eksik `InsightLifecycleService` importunu buldu; import eklendi. İkinci tam deneme 15 dakikayı aştı ve yüksek bellek/takas kullanımı sırasında sonuç üretmediği için yalnız başlatılan derleme süreci durduruldu. Tam API derlemesi bu teslimde doğrulanmış değildir.

Yeni çekirdeğin bağımsız, strict TypeScript kontrolü ve `git diff --check` geçti:

```sh
node --max-old-space-size=1024 node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --strict --skipLibCheck src/cari/odeme-sozu-uzlastirma.ts
```

```sh
# apps/api
pnpm exec vitest run src/cari/odeme-sozu-uzlastirma.test.ts src/fatura/odeme-durumu.test.ts src/fatura/denklestirme.test.ts src/fatura/denklestirme-hesap.test.ts --maxWorkers=1 --no-file-parallelism
```

F02-01 devam ediyor; takip/itiraz geçişleri, kalıcı revizyon ve alan sahibi kabulü tamamlanmış sayılmıyor. F02-02/03/04 henüz başlamadı.
