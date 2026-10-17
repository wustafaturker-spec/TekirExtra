# F01 — Filtreli Excel dışa aktarımı

15.10.2026. [İlk teslimin](F01-MALIYET-KONTROLU-ILK-TESLIM-2026-10-15.md) devamıdır. Satış maliyet kontrolüne **Excel'e aktar** eklendi. Bu teslim çalışma alanında hazırdır; canlı servisler değiştirilmedi.

**Sonraki teslim:** [Kalıcı inceleme/not/durum takibi](F01-MALIYET-INCELEME-TAKIBI-2026-10-15.md) de çalışma alanına eklendi. Aşağıdaki sonuç ve kalan işler, Excel tesliminin tarihsel kaydıdır.

## Davranış

- Dosya, seçili tarih/ürün/kayıt bulgusuna uyan tüm satırları içerir. Ekranın sayfa ve sayfa boyutu dosyayı kesmez. Liste ve dışa aktarım aynı kaynak, filtreleme ve maliyet uyarısı koşulunu kullanır.
- **Özet** sayfası firma, dönem, alınma zamanı (UTC), filtreler, dönem toplamları ve filtre toplamlarını içerir. **Satışlar** sayfasında belge, cari, ürün, ana birimde miktar, TRY ciro/maliyet, kayıt bulgusu, güncel eksi stok ve kaynak kimlikleri bulunur.
- İndirme sırasında kaynak yeniden okunur. Dosya, ekrandaki geçmiş yanıtın sabit kopyası değildir; ara işlemler tutarları değiştirebilir. Bu bilgi ekranda ve dosyada yazılıdır.
- Yeni filtre yüklenirken veya liste hata vermişken dışa aktarım yapılamaz. Düğme, son başarılı liste isteği ile mevcut filtrelerin eşleşmesini bekler. İndirme hatası dosya olarak kaydedilmez; hata görünür ve yeniden deneme açılır.
- Metin değerleri formüle çevrilmez. Sayısal değerler Excel'in 15 anlamlı basamak ve sayı dönüşümü sınırında güvenle korunabiliyorsa sayıdır; aksi halde tam metindir. Büyük parasal toplamların kuruşları sessizce yuvarlanmaz. Dosyada bu davranış açıklanır.

## API ve erişim

`GET /api/v1/rapor/maliyet-eksikleri/excel` mevcut liste sorgu sözleşmesini kullanır. `baslangic`/`bitis` zorunludur; `stokId`, `neden`, sayfalama alanları aynı doğrulamadan geçer. Dışa aktarım sayfalamayı uygulamaz. Dönem üst sınırı 366 gün, kaynak okuma koruması 20.000 kesin satış/iade satırıdır; sınır aşımında kısmi dosya verilmez.

Yönetici, muhasebe, salt okunur, mali müşavir ve maliyet muhasebesi erişebilir. Diğer roller doğrudan dosya adresinde de 403 alır. Tenant bağlamı ve RLS korunur; başka tenantın ürün filtresi o tenantın kayıtlarını getirmez. Yanıt XLSX MIME türü, tarih içeren dosya adı ve `Cache-Control: no-store` taşır.

Tarayıcı indirmesi mevcut `apiDosyaIndir` üzerinden aynı origin, Bearer kimliği ve oturum yenileme akışını kullanır. Yeni tablo, migration veya mali kayıt yazımı yoktur. Dosya üretimi, kaynak verisi okunduktan sonra DB işlemi dışında yapılır.

## Doğrulama sonuçları

41 ayrı test geçti:

- 33 API birim/gerileme testi: liste ve kâr hesabı, dosya yetkileri, yük sınırı, 103 satırın üçüncü sayfadan tam aktarımı, özetler, kaynak kimlikleri, boş filtre, formül benzeri metin ve büyük tutar hassasiyeti.
- 1 gerçek PostgreSQL + derlenmiş API HTTP senaryosu: dosyanın XLSX olarak açılması, liste/Excel/kâr eşitliği, sayfalama, ürün/bulgu filtreleri, iki tenant ve yabancı ürün filtresi, 401/403/400 yanıtları, izinli okuyucu rolleri. Mali verilerin okuma öncesi/sonrası eşitliği doğrulandı; sentetik test tenantları rollback edildi.
- 7 üretim Chromium senaryosu: önceki dört akışa ek olarak filtreli indirme ve 401 sonrası yenileme, dosya yetki hatası ve filtre yüklenirken eski listeyi indirememe. Tarayıcı finans API'leri taklittir; gerçek maliyet uygulaması çağrılmaz. Gerçek dosya içeriği DB/HTTP testinde ayrıca doğrulanır.

API TypeScript derlemesi ve web üretim derlemesi başarılı. Web çıktısı `.next-f01-export-release-20261015`; build kimliği `YFhiUH_S_DL9FwsbJkzTk`.

```sh
# apps/api
pnpm exec vitest run src/rapor/maliyet-eksikleri.test.ts src/rapor/maliyet-eksikleri-excel.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-f01-export-api-dist
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-f01-export-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-export-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-export-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Plan durumu

F01-02'nin liste, özet, rapor bağlantısı ve Excel geliştirmesi bu teslimle çalışma alanında hazırdır. Genel F01 kabulü, paket bazında kontrollü açılış ve pilot kabulü tamamlanmadığı için CSV'deki durum `devam_ediyor` olarak korunur. Sonraki iş kalıcı düzeltme/takip kaydıdır; kanıtlı kök nedenler, eşzamanlı çözüm kabulü ve pilot ölçümleri ayrıca açıktır. Üretim hacmi performans kabulü yapılmış sayılmaz.
