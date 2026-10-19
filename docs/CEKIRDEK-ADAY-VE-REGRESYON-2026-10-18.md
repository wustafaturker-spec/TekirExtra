# F01/F02/F03 — Sabit kaynak adayı ve birleşik regresyon

18 Ekim 2026. Çekirdeğin API ve web üretim derlemeleri, çalışma alanından ayrı sabit kaynak kopyasında hazırlandı. Üçüncü adayın 190 birleşik testi ve 22 tabloda yedek/geri yükleme eşitliği geçti. Bu çalışma yerel aday ve teknik kabul içindir; gerçek şirket pilotu veya canlıya geçiş değildir.

## Düzeltilen derleme/üretim sorunları

- Dosya denetimindeki `red` yardımcısı açık `never` dönüşlü fonksiyon bildirimi yapıldı. TypeScript artık HTML/çalıştırılabilir/bilinmeyen türlerin reddinden sonra izinli dosya türünü daraltabiliyor; zorunlu tür iddiası kaldırıldı. Mevcut 8 dosya denetimi testi geçti.
- Ortak `Field`, Input/Select/SearchInput bileşenlerini fonksiyon adı yerine doğrudan bileşen kimliğiyle tanır. Üretim küçültmesinin e-posta etiketini alandan koparması giderildi. Üçüncü adayın statik giriş HTML'inde etiketin `for` bağı doğrulandı; web odaklı tür kontrolü geçti.
- Sabit kaynak listesine API betiklerinin tamamı ve ek `tsconfig` dosyaları alındı. Yeni HTTP testinin ayarları kopyada eksik kalmıyor. Çevrimdışı kurulumda 447 paket yeniden kullanıldı, ağdan paket indirilmedi.

## Kabul akışı

`node scripts/f02-sabit-kaynak-adayi.mjs --cikti .release-candidates/<yeni-ad>` yeni, üzerine yazılmayan bir kaynak kopyası ve yerel aday üretir. API/web derlemeleri seri çalışır; Next'in ürettiği ayarlar yalnız kopyada tutulur. API derlemesi için 4 GiB Node heap kullanılır. Kaynak ve çıktı dosyaları SHA-256 ile izlenir; standalone dizin öneki kontrol edilip düzeltilir.

Kopyanın kökünde `F02_API_DIST=<aday>/api F02_RELEASE_REPORT=<aday>/cekirdek-kabul.json node apps/api/scripts/f01-yaris-kabul.mjs --cekirdek` çalıştırılır. Kabul edilen kaynak, çalışma alanının sonradan değişen hali yerine bu sabit kopyadır.

Birleşik matris altı dosyayı içerir: F01 maliyet/yarış/hacim; F02 ödeme sözü ve tahsilat takibi; F03 belge/iade dağıtımı; derlenmiş F02 JWT/worker/nakit; derlenmiş F03 gerçek HTTP ve tarayıcı. F01/F02/F03 servis testleri sabit kopyanın kaynaklarını, derlenmiş testler adayın API dosyalarını kullanır.

F03 tarayıcısı `next dev` yerine adayın standalone sunucusunu başlatır. Aynı origin üzerindeki test proxy'si yalnız `/api/v1/` isteklerini izole gerçek API'ye taşır; yanıt taklidi veya tarayıcıya token yerleştirme yoktur. Bu proxy, gerçek dağıtımın 3001 yönlendirme ayarının kabulü değildir. Gelen e-belge kaynak referansı önceki provadaki gibi fixture'dır.

Migration'lar yalnız yeni Docker PostgreSQL'de uygulanır ve ikinci kez çalıştırılır. Başarılı testlerden sonra yedek ayrı geçici DB'ye yüklenir; F03 belge/satır/bağ/iade tabloları dahil 22 tabloda satır sayısı ve kayıt özetleri karşılaştırılır. Konteyner sonunda durdurulup otomatik silinir.

## Önceki adaylar

İlk kopya API tür hatası nedeniyle kabul edilmedi. İkinci adayın derlemeleri geçti, fakat birleşik koşumda 190 testin 188'i geçti: üretim giriş etiketinin kopması ve derlemeyle eşzamanlı 20.000 satırlık F01 sorgusunun 5 saniyelik transaction sınırını aşması nedeniyle iki test başarısız oldu. İkinci adayın geçici DB'si silindi. Ürün transaction sınırı artırılmadı; üçüncü adayın son koşumu derleme tamamlandıktan sonra yapıldı ve 190 testin tamamı geçti.

## Üçüncü yerel aday

- Aday: `.release-candidates/cekirdek-aday-20261018-3`.
- Sabit kaynak: `.release-candidates/f02-kaynak-1792319370487-1218813e` (1540 kaynak dosyası).
- Kaynak SHA-256: `2ac7314b5e4ed3166d2fcab546b4bc6cdc331293fd7db0f02db2b64b494c9bef`.
- Dosya SHA-256: `b477fe11a54e380758bf2f09b4544ab548629400cd5fab7a7b7299be0505a290`.
- Web build ID: `aIwge1an3oYs0FjsNT3FB`.

API ve web tam üretim derlemeleri başarılıdır. Derleme sonu karşılaştırmasında çalışma alanındaki üç teklif-talebi dosyası sabit kopyadan farklıydı; sonraki değişiklikler bu adaya dahil sayılmaz. Ayrıntılar [sabit kaynak raporunda](../.release-candidates/cekirdek-aday-20261018-3/sabit-kaynak-raporu.json) ve [manifestte](../.release-candidates/cekirdek-aday-20261018-3/manifest.json) kayıtlıdır.

### Son kabul

190/190 test geçti: 45 F01, 63 ödeme sözü, 19 tahsilat takibi, 53 F03 belge/iade, 8 derlenmiş F02 ve 2 derlenmiş F03 HTTP/tarayıcı senaryosu. F03 tarayıcısı standalone paketten gerçek parolayla giriş yaptı; 20 API isteğinin tamamı izole API'ye gitti. Sonuçlar 80,05 ve 70,10 TRY olarak korundu. Mobil ekran görüntüsü incelendi.

Migration tekrarı geçti. Dump/restore sonrası 22 tabloda sayım ve kayıt özetleri eşitti; geçici PostgreSQL durdurulup otomatik silindi. Test sonrası aday doğrulayıcısı yeniden çalıştırıldı; kaynak ve paket dosya özetleri korundu. F01'de 20.000 satırlık üç liste ölçümü 1130/1059/1005 ms; tam Excel üretimi 4529 ms idi. Bunlar yerel koşumdur, üretim SLA/p95 kabulü değildir.

- [Birleşik kabul ve temizlik kaydı](../.release-candidates/cekirdek-aday-20261018-3/cekirdek-kabul.json).
- [Test logu ve yerel hacim ölçümleri](../.release-candidates/cekirdek-aday-20261018-3/http-kabul.log).
- [Standalone tarayıcı kaydı](../.release-candidates/cekirdek-aday-20261018-3/f03-standalone-sonucu.json), [mobil ekran](../.release-candidates/cekirdek-aday-20261018-3/f03-standalone-mobil.png).

## Yayın kapısında kalanlar

[Node 22 çalışma zamanı ve işletim provasında](CEKIRDEK-RUNTIME-VE-ISLETIM-2026-10-18.md) bağımsız üretim paketi hazırlandı; tam AppModule/API/worker ve yeniden başlatma dahil 12 ek kontrol geçti. Paket ve aday bütünlüğü korundu, geçici kaynaklar temizlendi. Önceki 190 test Node 24.14.0 ortamındaydı; ek kontroller Node 22.23.2 üzerinde yürütüldü.

Gerçek pilot ve alan kabulü ertelenmiş durumda. [PDF ve Node 22 birleşik web akışında](CEKIRDEK-NODE22-PDF-VE-TARAYICI-2026-10-18.md) 1 PDF ve 14 akış kontrolü de geçti. Hedef servis yönetimi/kapasitesi, onaylı önceki dağıtımla geri dönüş ve gerçek sağlayıcı kabulü açık kalır. REL görevleri otomatik tamamlanmış sayılmaz.

[İşletim ve toparlanma provası](CEKIRDEK-ISLETIM-VE-TOPARLANMA-2026-10-18.md): aynı sabit adayda 17 kontrol geçti; API/worker süreç hatasından otomatik döndü, Redis kesintisi readiness 503 üretti, 120 küçük sentetik HTTP isteği hatasız tamamlandı. Bu, hedef kapasite/reboot veya önceki sürüme dönüş kabulü değildir.

[Taşınabilir servis paketinde](CEKIRDEK-KALICI-SERVIS-PAKETI-2026-10-18.md) bağımsız dosya doğrulayıcı ve Compose/systemd tanımları hazırlandı. Yedi doğrulayıcı testi ve 17 Compose kontrolü geçti; servisleri kaldırıp aynı tanımdan yeniden kurma sonrası gerçek tarayıcı girişi ve geçmiş/tekillik korundu. Hedef systemd kurulumu veya gerçek reboot yapılmadı.
