# F02 — Kalıcı ödeme sözü servisleri

Sonraki teslim: [Cari detayında ödeme sözü ekranı ve tarayıcı kabulü](F02-CARI-ODEME-SOZU-EKRANI-2026-10-15.md). Aşağıdaki metin servis diliminin tarihli kapsamıdır.

15 Ekim 2026. F02-02'nin ilk servis dilimi çalışma alanında uygulandı. Önceki [saf uzlaştırma çekirdeği](F02-ODEME-SOZU-UZLASTIRMA-2026-10-15.md) gerçek tenant transaction'larına bağlandı. Ekran, takip/görüşme/itiraz kayıtları, nakit planı entegrasyonu ve gerçek şirket pilotu henüz yoktur. Migration yalnız her koşuda oluşturulan ve silinen geçici PostgreSQL'de uygulandı; canlıya veya yerel şirket veritabanına uygulanmadı.

## Kalıcı model ve geçmiş

`OdemeSozu` bir satış faturası, cari, döviz, tutar, söz günü, sunucunun ürettiği veriliş zamanı, kullanıcı ve açıklama taşır. `kayitDurumu` yalnız `aktif/iptal/revize` yaşam döngüsüdür. Mali gerçekleşme durumu saklanmaz; her okumada güncel kaynaklardan türetilir. Bir faturada aynı anda tek mantıksal aktif söz bulunabilir; kısmi unique index bu kuralı DB'de de korur. Gerçekleşmiş görünen söz de mantıksal olarak aktif kalır.

Revizyon eski kaydın tutarını veya tarihini değiştirmez. Eski kayıt gerekçe ve artan sürümle `revize` olur, yeni söz eski kimliğe bağlanır. İptal gerekçeli ve sürümlüdür. Söz miktarı, hedefi, yazarı ve veriliş zamanı sonradan değiştirilemez; DB trigger'ı da bunu denetler. Uygulama DB rolünün silme izni kaldırılmıştır. Söz ve audit aynı transaction'da yazılır; audit hatasında revizyonun iki tarafı da geri alınır.

Oluşturma/revizyon istekleri tenant kapsamındaki UUID `istekAnahtari` ile tekrarlanabilir. Aynı anahtar ve aynı doğrulanmış içerik mevcut kaydı döndürür; farklı içerik 409 üretir. Aynı anahtar iki bağlantıdan aynı anda gelirse advisory lock tek karar verir. Tekrar isteği, önceki kaydın son durumunu döndürür; sonradan iptal olmuş kaydı yeniden açmaz. İptalde eski sürümle tekrar 409 üretir.

## API sözleşmesi

| Yol | Girdi | Yetki |
|---|---|---|
| `GET /cari/odeme-sozleri?cariId=<uuid>` | Zorunlu cari; başka filtre kabul edilmez | yönetici, muhasebe, mali müşavir, salt okunur |
| `POST /cari/odeme-sozleri` | `cariId`, `faturaId`, `dovizCinsi`, `tutar`, `sozTarihi`, `aciklama`, `istekAnahtari` | yönetici, muhasebe |
| `POST /cari/odeme-sozleri/:id/revize` | `tutar`, `sozTarihi`, `aciklama`, `gerekce`, `beklenenSurum`, `istekAnahtari` | yönetici, muhasebe |
| `POST /cari/odeme-sozleri/:id/iptal` | `gerekce`, `beklenenSurum` | yönetici, muhasebe |

Tutar sabit iki ondalıklı pozitif metindir; sayısal JSON tutarı, bilimsel yazım ve fazla hassasiyet reddedilir. Söz tarihi gerçek bir `YYYY-MM-DD` günü olmalı ve Türkiye gününe göre geçmişte olmamalıdır. Açıklama ve gerekçe 2–2.000 karakterdir. Tenant, kullanıcı, gerçekleşme ve veriliş zamanı istemciden alınmaz. Hedef kesin satış faturası ve aynı döviz olmalıdır; tutar güncel fatura kalanını aşamaz.

Liste `Cache-Control: no-store` döndürür. Cari, mod, ölçüm zamanı, gün hassasiyeti uyarısı, söz geçmişi ve her sözün `gerceklesme` sonucu bulunur. Tekrar anahtarı ve girdi hash'i yanıta eklenmez. Söz tutarı, gerçekleşen ve kalan metindir. İptal/revize kayıtlardaki kalan tutar bilgi amaçlıdır; tahsil edilecek yeni bakiye değildir.

## Şirket açılışı ve yalıtım

`tahsilat_operasyonu` ayarı `{surum:1,mod:"kapali"}` varsayılanıyla kayıtlıdır. Modlar kapalı, salt okunur, pilot, açık şeklindedir. Saklı ayar yoksa/bozuksa/gelecek sürümdeyse erişim açılmaz; yönetici de kapalı veya salt okunur modda yazamaz. Servis kendi rol kontrolünü de yapar. Mevcut yetkili ayar API'sindeki değişiklik audit'e yazılır; bu teslimde ayar ekranına yeni kart eklenmedi ve gerçek şirkette açılmadı.

Yeni tabloda RLS ve FORCE RLS aktiftir. Bütün servis erişimleri `PrismaService.tenantIslem` içindedir. Hedef fatura/cari/döviz, oluşturan kullanıcının şirketi ve önceki revizyon bağı trigger ile de kontrol edilir. Şirket modu satırına transaction boyunca `FOR SHARE` uygulanır; kapanış ayarı devam eden söz yazımının commit'ini bekler.

Yazımlar mevcut denkleştirme gibi cari satırını kilitler. Revizyon/iptal bu kilitten sonra kaydı yeniden okuyup sürümü doğrular. Fatura satırı için ek kilit alınmaz; mali işlemlerin kilit sırasına yeni ters bağımlılık eklenmez. Eşzamanlı fatura geri alma sonucu söz daha sonra `kaynak_gecersiz` görünebilir; söz yazımı mali belgeyi kesinleştirmez veya koruma altına almaz.

## Güncel kaynak adaptörü

Liste, tüm söz geçmişini ve kaynakları tek `RepeatableRead` snapshot'ında okur. Mantıksal aktif sözler gerçekleşmiş görünseler de kaynak havuzundan çıkarılmaz. Her okumada mevcut kapamalardan hesap yapılır; eski ve yeni kapama kimlikleri biriktirilmez.

Yalnız aynı dövizli kasa/banka tahsilatları ve doğrulanmış ödenmiş POS tahsilatının kasa/banka hareketi sayılır. Çek, kredi kartı harcaması, iade faturası mahsubu, tediye ve kur dönüşümlü kaynaklar ilk dilimin nakit gerçekleşmesi değildir. POS'a ait hareketin kaynak durumu/cari/dövizi de doğrulanır.

Kaynak ödeme için diğer faturalara dağıtılmış kapamalar da okunur. Ters kayıt ve POS iadeleri düşülmüş net kapasite kontrol edilir. Güncel kapamalar bu kapasiteyi aşıyorsa 409 döner; bu okuma mali denkleştirmeyi otomatik çalıştırmaz. Ödemeyi yeniden dağıtma kararı mevcut mali işlem yolunda kalır.

Kasa/banka işlem günü `date` hassasiyetindedir. Kaydın `createdAt` değeri ödeme saati olarak sunulmaz. Aynı Türkiye gününde verilen söz ve ödeme arasındaki sıra kanıtlanamadığından otomatik gerçekleşme sayılmaz; yanıtta bu uyarı bulunur. Tam saati destekleyen kaynaklar için sonraki dilimde açık kaynak sözleşmesi gerekir.

Cari başına 1.000 söz geçmişi, her kaynak okumasında 5.000 kapama/geri alma/POS kayıt sınırı uygulanır. Okumalar limit + 1 yapar; aşımda kısmi başarı üretilmez. Limit sonrasında yeni söz/revizyon oluşturma da engellenir; iptal mümkündür. Kalıcı geçmişi sessiz silme veya arşivleme yoktur.

## Kabul ve kalan işler

28 geçici PostgreSQL/HTTP senaryosu geçti. Test rolü tablo sahibi değildir; superuser/BYPASSRLS taşımaz. Boş bağlam, farklı tenant, DB geçmiş/silme koruması, idempotent iki bağlantı, revizyon/iptal yarışı, audit hatasında atomik geri alma, kapama UUID yenilenmesi, 400 + 600 / 400 geri alma, POS kısmi iadesi, diğer faturanın kapasite payı, 1.001 geçmiş kayıtta sınır, gerçek RepeatableRead snapshot yarışı ve `pg_blocking_pids` ile şirket modu kilidi doğrulandı. HTTP testinde gerçek controller ve rol guard kullanılır; yalnız test kimliği middleware ile verilir, JWT oturum açma testi değildir.

50 uzlaştırma + 25 gövde/ayar + 24 mevcut ödeme/denkleştirme regresyon testi: 99 birim testi geçti. Prisma şeması doğrulandı ve istemci üretildi. Controller'dan başlayarak yeni servis/adapter bağımlılıklarının strict TypeScript kontrolü geçti.

Tam API TypeScript derlemesi de `/tmp/tekirextra-f02-api-dist` çıktısıyla geçti. Önceki teslimin sonuçlanmayan tam derleme kontrolü bu yeni çalışma alanı sürümünde başarıyla tamamlandı. Web kaynaklarında değişiklik yapılmadı; bu teslim için web derlemesi/tarayıcı testi çalıştırılmadı.

Ortak ayar ve migration değişiklikleri sonrasında mevcut F01 geçici PostgreSQL paketinin 45 senaryosu da geçti; 2.000/10.000/20.000 satır liste/Excel tutarlılığı ve 20.001 sınırı korundu. Bu teslimde toplam 172 ayrı test geçti (99 birim + 28 F02 DB/HTTP + 45 F01 DB). Hacim sayıları F01 içindir; F02 üretim kapasitesi kabulü değildir.

```sh
# apps/api
node scripts/f01-yaris-kabul.mjs --f02
node scripts/f01-yaris-kabul.mjs
pnpm exec vitest run src/cari/odeme-sozu-uzlastirma.test.ts src/cari/odeme-sozu.semalar.test.ts src/fatura/odeme-durumu.test.ts src/fatura/denklestirme.test.ts src/fatura/denklestirme-hesap.test.ts --maxWorkers=1 --no-file-parallelism
node --max-old-space-size=1536 node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --strict --skipLibCheck --experimentalDecorators --emitDecoratorMetadata src/cari/odeme-sozu.controller.ts
timeout 180s node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-f02-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-f02-api.tsbuildinfo
```

F02-02 devam ediyor. Sonraki dilim cari detayında söz oluşturma/revizyon/iptal ekranı; takip, görüşme, itiraz ve sorumlu alanlarıdır. Günlük operasyon listesi, nakit planında tek alacak ilkesi, kontrollü bildirim, gerçek pilot ve tam F02 kabulü tamamlanmış sayılmıyor.
