# F01 — Satış maliyet kontrolü, ilk teslim

15.10.2026. Üretim planındaki ilk salt okunur dilim: kâr raporunun uyarısını kaynak satış satırlarına bağlamak. Bu teslim, F01 paketinin tamamı veya pilot kabulü değildir.

**Sonraki teslim:** [Filtreli Excel dışa aktarımı](F01-MALIYET-KONTROLU-DISA-AKTARIM-2026-10-15.md) da çalışma alanında tamamlandı. Aşağıdaki kapsam ve sonuçlar ilk teslimin kaydıdır; dışa aktarımın güncel durumu bağlantılı belgede bulunur.

## Kullanıcı akışı

1. Gelir-gider raporunda uyarının altındaki inceleme bağlantısı, gösterilen rapor yanıtının başlangıç ve bitiş tarihini taşır.
2. **Satış maliyet kontrolü** ekranında tarih, ürün ve kayıt bulgusu ile süzülür. Dönem ve filtre toplamları ayrıdır; sayfalama toplamı değiştirmez. Adresteki filtreler yenilemede korunur.
3. Yetkiye göre kaynak fatura veya stok kartı açılır. Yönetici seçilen ürünün mevcut maliyet önizlemesine geçebilir. Önizleme ve kullanıcı onaylı uygulama isteği aynı `stokId` ile sınırlanır; ilk açılışta tüm kartlar istenmez.

Ekran komut paletinde **Satış Maliyet Kontrolü** adıyla da bulunur.

## Hesap ve sözleşme

- `GET /api/v1/rapor/maliyet-eksikleri` → `/panel/raporlar/maliyet-eksikleri`.
- Zorunlu `baslangic`, `bitis`: gerçek takvim günü, `YYYY-MM-DD`, en fazla 366 gün. Tam gün sınırları mevcut raporla aynı UTC tarih kuralındadır.
- İsteğe bağlı `stokId` (UUID), `neden` (`hepsi`, `hareket_yok`, `sifir_maliyet`), `sayfa` (varsayılan 1), `sayfaBoyutu` (varsayılan 50, en fazla 100).
- Ortak kaynak `satisSatirlari`, ortak uyarı koşulu `maliyetBilinmiyor`: kesin satış, hizmet dışı kart, pozitif TL ciro, kayıtlı maliyet sıfır. İade, taslak ve iptal bu uyarı listesine girmez. Maliyet dağıtım/hesap formülü değiştirilmedi.
- Kaynak satır kimliği eklendi; fatura ve satır sırası sayfalama için sabitlendi. Aynı fatura/ürün maliyet paylaştırmasının mevcut davranışı korunur; varyant bazında yeni maliyet hesabı yapıldığı iddia edilmez.
- Parasal API alanları Decimal üzerinden iki basamaklı metindir. Dönem özeti, filtre ve sayfalama öncesinden gelir. Geçerli boş filtrede toplam sıfırdır; geçersiz giriş/yük sınırı hatası boş sonuç gibi sunulmaz.
- İlişkili hareket bulunmaması ile hareket toplamındaki sıfır kayıtlı maliyet ayrılır. Bunlar kayıt bulgusudur; alış kaynağının eksikliği, satış anındaki eksi stok veya hatalı birim gibi nedenler tahmin edilmez. Meşru sıfır maliyet bu ilk listeden otomatik çıkarılmaz.
- Güncel stok eksi işareti satış tarihinin stok kanıtı değildir. İlgili ciro eksik maliyet tutarı veya beklenen kâr düzeltmesi değildir.
- Dönemde 20.000'den fazla kesin satış/iade satırı varsa kaynak okumasından önce tarih daraltma hatası verilir. Bu koruma bir performans kabulü değildir; gerçek pilot hacmi ve gecikme ölçümü henüz yoktur.

## Yetkiler ve veri değişikliği

| Rol | Liste | Fatura bağlantısı | Stok bağlantısı | Mevcut maliyet önizlemesi / uygulaması |
|---|---|---|---|---|
| Yönetici | Evet | Evet | Evet | Evet; uygulama ayrıca kullanıcı onaylı |
| Muhasebe / salt okunur | Evet | Evet | Evet | Hayır |
| Mali müşavir | Evet | Evet | Hayır | Hayır |
| Maliyet muhasebesi | Evet | Hayır | Evet | Hayır |
| Satış / depo / üretim / bayi / çalışan | Hayır | — | — | Hayır |

Doğrudan liste API'si rol guard'ı ile korunur. Okuma, `tenantIslem` ve mevcut PostgreSQL RLS üzerinden yapılır; başka tenantın `stokId` filtresi o tenantın verisini getirmez. Yeniden hesaplama endpoint'inin yönetici kısıtı korunur; web sayfası erişimi de buna eşlendi.

Yeni tablo, migration, maliyet yazımı, otomatik düzeltme, olay veya bildirim eklenmedi. Mevcut maliyet uygulamasının iş kuralları ve kapalı dönem koruması değişmedi. Önizleme ürünün geçmişini mevcut servis kurallarıyla inceler; liste dönemine özel düzeltme anlamına gelmez.

## Doğrulama

Sonuç: 40 ayrı test geçti — 29 API birim/gerileme, 6 web erişim matrisi, 1 gerçek DB/HTTP senaryosu ve 4 Chromium senaryosu. DB/HTTP senaryosu kaynak koduyla ve derlenmiş API ile ayrı koşularda geçti. API TypeScript derlemesi ve web üretim derlemesi başarılı. Son web build kimliği: `NI_x26ZrO4I3Y1ZtXqw6c`.

- Birim/gerileme: yeni sözleşme ve liste, mevcut satış özeti ve kâr hesabı; geçersiz tarih/filtre, hizmet/iade/sıfır ciro ayrımı, toplam/sayfalama, yük sınırı, izinli ve reddedilen roller.
- Gerçek PostgreSQL + izole Nest HTTP: JWT 401, rol 403, geçersiz tarih 400, liste–kâr eşitliği, kur, taslak/iptal/iade, iki tenant, yabancı ürün filtresi, sayfalama ve okuma öncesi/sonrası mali veri eşitliği. Sentetik kayıtlar transaction sonunda rollback edilir; gerçek şirket kayıtları değiştirilmez. Derlenmiş API ile aynı senaryo ayrıca çalıştırılır.
- Üretim Next artefaktında Chromium: rapor dönemi bağlantısı, salt okunur filtre/yenileme, yönetici önizleme ve uygulama kapsamı, hata görünümü ve depo rolünün reddi. Tarayıcı finans API'leri taklit edilir; gerçek maliyet uygulaması çağrılmaz.

Üretim tarayıcı kontrolünde raporun tarih etiketlerinin giriş alanlarıyla bağlı olmadığı görüldü; rapor ve yeni liste tarihlerine açık `id`/`htmlFor` bağları eklendi ve son üretim çıktısında doğrulandı.

Tekrar çalıştırma (belirtilen klasörlerden):

```sh
# apps/api
pnpm exec vitest run src/rapor/maliyet-eksikleri.test.ts src/stok/satis-ozeti.test.ts src/rapor/kar-zarar.test.ts
pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/tekirextra-f01-api-dist
NODE_PATH=/home/mustafat/Desktop/TekirExtra/apps/api/node_modules F01_API_DIST=/tmp/tekirextra-f01-api-dist pnpm exec vitest run --config vitest.kabul.config.ts test/maliyet-eksikleri.kabul.test.ts

# apps/web
NEXT_DIST_DIR=.next-f01-release-20261015 NODE_OPTIONS=--max-old-space-size=4096 pnpm build
F01_TEST_DIST=.next-f01-release-20261015 pnpm exec playwright test --config playwright.maliyet.config.ts
```

## Kalan işler ve yayın durumu

F01-01/02/03/04 kısmen ilerledi; hiçbirinin tüm kabul kapsamı kapatılmadı. Dışa aktarım, kalıcı düzeltme/takip kaydı, kanıtlı kök nedenler, kapalı dönem ve eşzamanlı çözüm kabulü, varyant/birim kenar durumları, pilot baz ölçümü ve paket bazında kontrollü açılış kalan işlerdir. Genel P00 altyapısı tamamlanmış sayılmaz.

Bu teslim çalışma alanında uygulanır ve ayrı derleme klasörlerinde doğrulanır. Çalışan API/web süreçleri bu adımda değiştirilmez; canlı yayın yapılmış sayılmaz.
