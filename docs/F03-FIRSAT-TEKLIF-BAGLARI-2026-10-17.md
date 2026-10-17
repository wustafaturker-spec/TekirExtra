# F03 — CRM fırsatına mevcut satış teklifi bağlama

17 Ekim 2026. Kullanıcı gerçek pilot kabulü ve canlıya geçişi sonraya bıraktı; geliştirme planındaki F03'ün ilk dilimine geçildi. Bu dilim mevcut satış tekliflerini bağlama/görüntüleme/çözmeyle sınırlıdır. Fırsattan yeni teklif açma, satır zincirinden sipariş/fatura/tahsilat payı çıkarma ve F03-K1/K2'nin birleşik satış pilotu sonraki dilimlerdir.

## Kullanım ve kurallar

CRM kartındaki **Teklifleri gör** bağlantısı fırsatın tekliflerini açar. Aynı şirket ve carinin satış teklifleri numara araması ve 50'lik sayfalama ile seçilir. Bağlı seçenekler seçilemez; iptal ve eski sürüm teklifler yeni bağ adayına alınmaz. Her belge için bir aktif birincil fırsat bağı bulunur; bir fırsatta birden fazla teklif olabilir. Teklif revizyon kökü/sırası kaynakta mevcut alanlardan döner; yeni sürümlere otomatik bağ aktarılmaz.

Yönetici ve satış, gerekçe vererek bağ kurabilir/çözebilir. Muhasebe yalnız okur. Para decimal-string ve dövizle gösterilir; tahmini fırsat tutarı, teklif tutarı, gerçekleşen satış ve tahsilat aynı ölçü değildir. Bu dilim gerçekleşen ciro/tahsilat hesaplamaz; maliyet veya cari kartının özel alanları yeni yanıtlara eklenmez.

Bağ çözmek belgeyi silmez. Oluşturan/çözen kullanıcı, zaman, gerekçe, sürüm ve istek özetleri korunur; audit aynı transaction'da yazılır. Eski istek yeniden gönderildiğinde kapanmış bağ yeniden açılmaz. Tekrar anahtarının farklı gövdeyle kullanımı ve eski fırsat/teklif güncelleme zamanı 409 döndürür. Çözme, bağın 1 numaralı sürümünü bekler; son durum 2'dir.

Bağ geçmişi olan fırsat/teklifin cari kimliği ve kaynağın silinmesi korunur; bağı çözmek geçmişin kaynak kimliğini değiştirme izni vermez. Gerekirse belgenin mevcut iptal akışı kullanılır. Fırsat cari/sorumlu güncellemesinde şirket kapsamı da doğrulanır.

## API ve şirket ayarı

- `GET /crm/firsatlar/:id/belgeler`: 200 kayda kadar tam bağ geçmişi; sınır aşılırsa kısmi liste yerine 409.
- `GET /crm/firsatlar/:id/belgeler/adaylar?arama=&imlec=`: aynı cari/şirketin satış teklifleri; 50 kayıt ve sonraki imleç.
- `POST /crm/firsatlar/:id/belgeler`: belge, gerekçe, istek anahtarı ve beklenen fırsat/belge güncelleme zamanıyla bağlama.
- `POST /crm/firsatlar/:id/belgeler/:bagId/coz`: gerekçe, istek anahtarı ve beklenen sürümle çözme.

`crm_belge_baglari` ayarı Modül Ayarları ekranındadır. Sürüm 1; varsayılan `kapali`. `salt_okunur` okumaya; `pilot`/`acik` yetkili yazmaya izin verir. İşlem sırasında ayar satırı `FOR SHARE` ile okunur; kapatma güncellemesi devam eden transaction bitmeden tamamlanmaz. Bu çalışma gerçek şirketin ayarını açmadı.

## Veri ve yarış kontrolü

Migration: `20261017100000_firsat_belge_baglari`. Yeni `firsat_belge_baglari` tablosunda RLS/FORCE RLS, tenant politikası ve DELETE yasağı var. Aktif belge tekilliği kısmi unique index ile; tenant/cari kapsamı bileşik foreign key'lerle; geçmişin değişmezliği ve kaynak kimliği tetikleyicilerle korunur. Ebeveyn silinmesi geçmişi silmez, reddedilir. Migration dosyası yalnız geçici PostgreSQL'de uygulandı.

Yazma kilit sırası: şirket ayarı → fırsat → teklif → bağ güncellemesi/audit. Aynı fırsatın işlemleri fırsat kilidinde, farklı fırsatların aynı teklife yazımı teklif kilidi ve unique index'te sıralanır. Transaction varsayılan süre sınırı korunur; başka bir tenant transaction'ı içinden bağımsız transaction açılmaz.

## Doğrulama

**85 test geçti:** 70 mevcut CRM/belge birim testi (yeni kaynak silme koruması dahil), 12 gerçek PostgreSQL/RLS/yarış/audit kontrolü ve 3 fixture tarayıcı senaryosu. Tarayıcıda bağlama–yenileme–çözme/geçmiş, 409'da taslağın/istek anahtarının korunması ve mobil salt okunur görünüm doğrulandı. Masaüstü ve mobil ekranlar ayrıca incelendi.

Değişen API dosyaları ve bunların bağımlılıkları için TypeScript kontrolü geçti. Web kaynak/e2e tür kontrolü ile ayrıca değişen web dosyalarının kontrolü geçti. Tarihsel Next çıktı dizinleri yerine ürün kaynakları/e2e açıkça kapsama alındı; üretim Next derlemesi yerine geçmez. İlk geniş API kontrolü 2 GiB Node heap sınırına takıldı; bellek baskısında kesilen koşumlar kabul sayılmadı. Son API kapsam kontrolü 4 GiB heap ile başarılı oldu. Formdaki belirsiz seçim etiketi açık `aria-label` ile düzeltildi; son 3 senaryoda başarısız/atlanan/kararsız test yok.

[Kabul özeti ve 21 kaynak SHA-256 kaydı](../.release-candidates/f03-ilk-dilim-20261017/kabul-ozeti.json), [PostgreSQL logu](../.release-candidates/f03-ilk-dilim-20261017/postgres-kabul.log), [birim sonucu](../.release-candidates/f03-ilk-dilim-20261017/api-birim.json), [tarayıcı sonucu](../.release-candidates/f03-ilk-dilim-20261017/tarayici.json), [masaüstü](../.release-candidates/f03-ilk-dilim-20261017/crm-teklif-masaustu.png), [mobil](../.release-candidates/f03-ilk-dilim-20261017/crm-teklif-mobil.png). Kesilen/başarısız tarayıcı koşumları ayrı raporlarla korunur.

Geçici DB runner'ı:

```sh
node apps/api/scripts/f01-yaris-kabul.mjs --f03
```

Bu test suite'i genel gerçek DB kabul listesinden çıkarıldı; yalnız nonce ile doğrulanmış geçici DB'de çalışır. Tarayıcı testleri API fixture'ları kullanır; gerçek oturum/şirket pilotu kanıtı değildir. Yeni özellik için üretim derlemesi/standalone yayın adayı bu dilimde üretilmedi. Önceki dokuzuncu aday F03'ü içermez.
