# API — Asistan sözleşme yolları ve güvenilir istek kapsamı

**Sonraki teslim:** [F01 ayrı bağlantılarda eşzamanlılık kabulü](F01-ESZAMANLILIK-KABULU-2026-10-15.md). Aşağıdaki 123 test sonucu bu derleme/kapsam tesliminin tarihsel kaydıdır.

15.10.2026. Önceki F01 tesliminde görülen tam API derleme engelinin devam incelemesi. Canlı servisler, mali kayıtlar ve şema değiştirilmedi.

## Uygulanan değişiklik

Çalışma alanında API içine alınmış sözleşmelerin gerçek dosya adları `*.contract.ts` biçimindedir. Asistanın servis, controller ve testlerindeki eski kısa import yolları bu adlara uyarlandı. Derleme kökü genişletilmedi; API başlangıç dosyalarının `dist/main.js` düzeni korundu. Önceki Prisma alan uyuşmazlıklarının bulunduğu adaptörlerde bu oturum başlamadan değişiklikler mevcuttu; bu teslim onların mali hesap doğruluğunu onaylamaz ve bu değişiklikleri kendisine mal etmez.

`IntelligenceController`, istek bağlamını artık mevcut `tenantId/userId/rol` alanlarından alır. Demo şirket, varsayılan kullanıcı ve yönetici rolüne düşmez. İstemcinin başka şirket, kullanıcı veya rol bildirmesi reddedilir. Modül listesi ve otonomi üst sınırı istemci gövdesinden alınmaz. Araç rol listeleri de uygulamanın tanımlı rolleriyle doğrulanır; tanınmayan istek/araç rolleri reddedilir. Finansal intelligence uçları sınıf düzeyinde yönetici, muhasebe ve salt okunur rollerle sınırlandı; rol denetimi mevcut `RollerGuard` üzerinden yürür.

Bellekteki görevler ve ürettikleri içgörüler tenant ve oluşturan kullanıcıyla sınırlandı. Başka tenant/kullanıcı görevini okuyamaz veya iptal edemez; içgörüsünü listeleyemez/okuyamaz. Olay ve audit okumaları ile risk taraması oturum tenantına bağlıdır. Bu teslim bellekteki plan/olay/audit altyapısını kalıcı kuyruğa veya veritabanına dönüştürmez.

## Doğrulama

18 test dosyasındaki 122 ayrı test doğrulandı. Bunların altısı yeni controller kapsam testidir: bağlamsız erişim, kimlik değiştirme girişimi, istemciden yetenek genişletme, yabancı tenant/kullanıcının görev ve içgörü erişimi, olay/audit/tarama tenant sınırı ve finansal uçların depo/satış rolüne kapalı olması. İki ek politika testi tanınmayan istek/araç rollerinin izin üretmediğini doğrular.

Asistanın mevcut politika, araç, adaptör, planlayıcı, olay, finans motoru ve sandbox testleri ile F01'in 61 birim/gerileme testi kapsama dahildir. İlk toplu koşuda bir kâr/zarar testi yoğun derleme sırasında 5 saniye sınırını aştı. Aynı dosya tek worker ve 30 saniye sınırıyla yeniden çalıştırıldı; beş testi de geçti, testlerin kendisi 747 ms sürdü. İlk süre aşımı gizlenmedi; test uygulaması ve kalıcı timeout ayarı değiştirilmedi. Asistan adaptör testleri taklit veri kullanır; gerçek mali kaynak uygunluğunun tamamlandığını göstermez.

Son tam API TypeScript derlemesi `--noEmitOnError` ile exit 0 döndü. Çıktı `/tmp/tekirextra-devam-api-dist` dizinindedir; `main.js` başlangıç düzeni korunmuştur. Bu çıktıyla gerçek PostgreSQL/Nest HTTP F01 kabul senaryosu da geçti; sentetik kayıtlar rollback edildi. Böylece 122 birim/gerileme ve 1 DB/HTTP senaryosu olmak üzere 123 ayrı test doğrulandı. Test tekrarları toplamda ayrıca sayılmadı. Web kaynakları değişmedi; önceki başarılı web çıktısı yeniden derlenmedi. Önceki başarısız API çıktısı yayın adayı olarak kullanılmaz.

```sh
# apps/api
pnpm exec vitest run src/assistant src/rapor/maliyet-dogrulama.test.ts src/rapor/maliyet-takibi.test.ts src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run src/rapor/kar-zarar.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
pnpm exec vitest run src/assistant/policy/policy-engine-p2.test.ts src/assistant/intelligence.controller.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=30000
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-devam-api-dist --noEmitOnError --incremental --tsBuildInfoFile /tmp/tekirextra-devam-api.tsbuildinfo
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-devam-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts
```

## Sonraki kapsam

F01'in ayrı bağlantılarla eşzamanlılık, varyant/kapalı dönem kabulü ve pilot/kademeli açılış işleri devam eder. Intelligence adaptörlerinin gerçek kaynak, para birimi, kuruş dönüşümü ve tutar tamlığı kabulü ayrıca yapılmalıdır. Bu derleme/kapsam düzeltmesi bütün asistanın üretim kabulü değildir. Canlı yayın yapılmadı.
