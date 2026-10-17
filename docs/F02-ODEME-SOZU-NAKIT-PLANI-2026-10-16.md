# F02 — Ödeme sözlerinin nakit planına bağlanması

16 Ekim 2026. Aktif ödeme sözünün güncel gerçekleşmeden kalan tutarı aynı satış faturasının kalan alacağından ayrılır ve söz tarihine yerleşir. Söz ikinci bir alacak, kasa/banka hareketi veya mali vade değişikliği oluşturmaz. Tahsilat operasyonu kapalı veya ayarı geçersizse mevcut fatura vadesi kullanılır. Yeni migration ve yeni şirket ayarı yoktur.

## Davranış

- 2.000 TRY faturaya 1.000 TRY söz verilmiş ve sözden sonra 400 TRY ödenmişse, kalan 1.600 TRY alacağın 600 TRY'si söz tarihinde, 1.000 TRY'si faturanın eski vadesinde planlanır.
- Söz gerçekleşmesi mevcut kaynak adaptöründen okunur: güncel kapamalar, ödeme kapasitesi, POS/geri alma ve aynı gün sıralaması kuralları cari ekranıyla aynıdır. Kapama kaldırıldığında sonraki tahminde söz payı yeniden hesaplanır. Söz kalanı faturanın kalanını aşamaz; eski veya aynı gün ödemesi söz gerçekleşmesi olmasa bile fatura kalanı üst sınırdır.
- İptal, revize, gerçekleşmiş, kaynağı geçersiz ve günü geçmiş sözler nakit dağılımını değiştirmez. Bugün vadeli söz kullanılabilir. Gecikmiş sözden otomatik yeni tahsilat günü türetilmez.
- Ufuk dışındaki söz, eski vadeli faturanın ilgili payını ufuktan çıkarır. Fatura vadesi ufuk dışında ve söz ufuk içindeyse söz payı tahmine alınır; kalan fatura payı kendi vadesinde kalır.
- Söz tarihine müşteri gecikme profili uygulanır; söz tahsilat garantisi değildir. Kara liste ve kötümserdeki 90 gün sınırı korunur. 90 gün hesabı söz tarihiyle sıfırlanmaz; asıl fatura vadesi kullanılır.
- Kur çevrimi mevcut nakit akışı kurallarıyla yapılır; söz kendi dövizinde bölüştürülür. Pay toplamı Decimal ile korunur. Nakit motorunun mevcut kuruş ve kur çevrimi yaklaşımı devam eder.

## Kaynak ve erişim

Fatura kalanı, söz gerçekleşmesi, hesap bakiyesi ve diğer kaynaklar aynı `RepeatableRead` tenant transaction'ında okunur. `GET /nakit-akisi` yanıtı `Cache-Control: no-store` taşır. Hesap sürümü `nakit-kapsam-v2`; `odemeSozuEsasi=guncel_kalan_alacagin_tarih_dagilimi` döner.

Nakit ekranının mevcut yönetici/muhasebe sınırı korunur; söz adaptörü ayrıca rol ve tenant bağlamını doğrular. Tahsilat modunun salt okunur/pilot/açık durumları okumaya uygundur. Şirket modu açılmaz. Kaynak tutarsızlığı veya sınır aşımı eski vadeye sessiz dönüş yapmaz; tahmin hata verir.

İlk dilim en fazla 100 bugün veya gelecekte vadeli aktif söz taşıyan cari okur. Her caride mevcut adaptörün 1.000 söz ve 5.000 kaynak/pay/geri alma sınırları geçerlidir. Toplam transaction süresi 15 saniyeyle sınırlıdır. Bu sınırlar üretim kapasitesi kabulü değildir; büyüyen hacimde toplu kaynak adaptörü ve ölçüm gerekir.

## Ekran

Nakit tablosunda söz payı, söz günü ve asıl fatura vadesi görünür; bağlantı kaynak faturaya gider. Söz ve normal pay aynı fatura/gün olsa da ayrı satır olarak gösterilir. Yeni söz alanını taşımayan eski API yanıtları çalışmaya devam eder. Cari ödeme sözü ve günlük takip ekranları bu dilimde değiştirilmedi.

## Kabul durumu

Güncel kaynakla 150 API birim testi ve 56 geçici PostgreSQL/HTTP testi geçti. Nakit bağlantısının 30 yeni birim testi ve 9 yeni gerçek DB senaryosu bu sayılara dahildir. İki bağımsız bağlantıda kapama değişirken aynı tahminin eski söz gerçekleşmesiyle eski fatura kalanını birlikte okuduğu doğrulandı. PostgreSQL uygulama rolü superuser/BYPASSRLS değildir; konteyner koşu sonunda silindi. HTTP kabulü mevcut controller/guard testidir; JWT oturum açma testi değildir.

API tam strict TypeScript kontrolü (`NODE_OPTIONS=--max-old-space-size=4096 pnpm exec tsc -p tsconfig.json --noEmit`) geçti. Web TypeScript kontrolü ve üretim derlemesi başarılı: `.next-f02-nakit-release-20261016`, BUILD_ID `TK2saB1z7l0hz4Q4wPIFg`. Next'in ürettiği yerel `next-env.d.ts` ve `tsconfig.json` değişiklikleri koşu öncesi içeriklerine geri alındı; önceki çalışma alanı değişiklikleri korundu.

Bu üretim çıktısında 3 Chromium senaryosu geçti: aynı gün/faturadaki iki payın ayrı satırları ve kaynak bağlantısı, kötümserde dışarıda kalan söz payı, yeni alanı taşımayan eski yanıt. Tarayıcı senaryoları yönlendirilmiş sentetik API yanıtları kullanır; gerçek şirket pilotu değildir. Toplam **209 ayrı test** geçti. Kaynak hata sınırları, kapalılık/rol ve DB snapshot kabulü API testleriyle doğrulandı.

```sh
# apps/api
pnpm exec vitest run src/nakit-akisi src/cari/odeme-sozu-uzlastirma.test.ts src/cari/odeme-sozu.semalar.test.ts src/cari/tahsilat-takibi.semalar.test.ts src/ai/icgoru/nakit-tahsilat-analizi.test.ts --maxWorkers=1 --no-file-parallelism
node scripts/f01-yaris-kabul.mjs --f02
NODE_OPTIONS=--max-old-space-size=4096 pnpm exec tsc -p tsconfig.json --noEmit

# apps/web
NEXT_DIST_DIR=.next-f02-nakit-release-20261016 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F02_NAKIT_DIST=.next-f02-nakit-release-20261016 pnpm exec playwright test --config playwright.nakit-sozu.config.ts --max-failures=1
```

## Kalan F02 kapsamı

Gecikmiş sözlerden otomatik iş üretimi, kontrollü bildirim/itiraz iletişimi, doğrudan söz–takip bağı, gerçek şirket pilotu ve üretim kapasitesi kabulü henüz tamamlanmadı. Canlı yayın yapılmadı; F02 paketi tamamlanmış sayılmıyor.
