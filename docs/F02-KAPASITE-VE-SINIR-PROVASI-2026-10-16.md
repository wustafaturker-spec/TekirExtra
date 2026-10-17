# F02 — İzole PostgreSQL kapasite ve sınır provası

16 Ekim 2026. İlk gerçek takip kaydı kullanıcı isteğiyle ertelenmişken bağımsız teknik sınır kontrolleri tamamlandı. Ürün kaynakları, çalışan servisler ve gerçek şirket ayarları değiştirilmedi. Manuel pilot açık, otomasyon/bildirimler kapalı kalıyor. Bu kayıt üretim kapasitesi veya doğal iş örneği kabulü değildir.

## Aday ve koşum

- Aday: `f02-20261016T070519121Z-c0319aa2`, `.release-candidates/f02-pilot-20261016-4`.
- Kaynak SHA-256: `70a4f6d6411b76864941d9bdd753174330a50d581fda3c7eae7afda4b2a63e95`.
- Dosya SHA-256: `6e2637c9b7feb85ce4e40cc4a5f3971ce13d375d48c09fe6bb37f4b575bd237c`.
- [Çalıştırılan betik](../.release-candidates/f02-pilot-20261016-4/f02-kapasite-prova.cjs), SHA-256 `3efaf95a467c57c3e382e2637aa06098dc300e2b866d346abc29ab3d1c7e20bf`.
- [Makine tarafından üretilen sonuç raporu](../.release-candidates/f02-pilot-20261016-4/f02-kapasite-prova.json): **12 kontrol geçti**, 15:23–15:24 TRT.

Betik başlangıçta adayın kaynak/dosya özetlerini doğrular. Canlı `DATABASE_URL` veya `DATABASE_URL_MIGRATE` verilirse durur; `.env` yüklemez. Her koşum yeni nonce, parola, `f02_kapasite_<nonce>` veritabanı ve geçici PostgreSQL 16 konteyneri üretir. Port yalnız loopback üzerinde rastgele seçilir; 5432/5433 reddedilir. Migration bağlantısı yalnız bu geçici DB'ye gider. Kontrollerde uygulama rolünün superuser/BYPASSRLS olmadığı ve DB adı/nonce işareti doğrulanır.

Gerçek derlenmiş `OdemeSozuService`, `TahsilatTakibiService`, `GecikenSozZamanlayiciService` ve `nakitSozleriniOku` kullanıldı. Test Nest uygulaması veya sahte HTTP oturumu kurmaz; açık test kimlik bağlamıyla uygulama rolünden gerçek PostgreSQL'e erişir. Kaynak kodu değiştirmeden doğrulanan adaya bağlanan ek bir operasyon provasındadır; önceki 107 kabul testinin tekrar koşumu değildir. Betik/rapor aday kökünde ayrı kanıtlardır, dağıtılan API/web dosyalarının parçası değildir.

## Sınır ve tutarlılık sonuçları

| Kontrol | Doğrulanan sonuç |
| --- | --- |
| 1.000 söz geçmişi | 999 iptal + 1 aktif söz tam okunur; on tekrarlı okumada tam 1.000 kayıt gelir ve DB sayımları değişmez |
| 1.000 söz varken yeni söz | Ayrı uygun faturaya yeni söz isteği 400 alır; söz/audit sayıları değişmez |
| 1.001 söz geçmişi | 400 döner; kısmi liste sunulmaz, DB sayımları değişmez |
| 5.000 ayrı kasa/banka kaynağı | 10.000 TRY sentetik sözün gerçekleşmesi 5.000, kalanı 5.000 TRY hesaplanır; on tekrarda aynı sonuç ve değişmeyen sayımlar |
| Başka fatura payıyla 5.001 toplam kapama | Kaynağın başka faturadaki payı da sınıra dahildir; 400 döner |
| Hedef faturada 5.001 kapama | 400 döner; kısmi gerçekleşme sunulmaz |
| 100 uygun gecikmiş cari | Worker tam turda 100 takip, 100 söz bağı, 200 audit üretir; hatalı cari ve bildirim sıfır |
| Aynı worker turunun tekrarı | Yeni takip/bağ/audit üretilmez; sayımlar aynı kalır |
| 101 uygun gecikmiş cari | Worker 400 ile durur; hiçbir takip/bağ/audit üretilmez |
| Nakit planında 100 cari | Tek RepeatableRead transaction'ında 100 faturalık söz haritası tam okunur; her söz kalanı 10.000 TRY; sayımlar değişmez |
| Nakit planında 101 cari | 400 döner; kısmi söz haritası/tahmin üretilmez |
| 15 saniyelik transaction sınırı | Takip/audit/bağ eklemesinden sonra test adaptörüyle 16 saniyelik `pg_sleep` uygulanır. Gerçek 15 saniye transaction sınırı P2028 hatası üretir; takip, bağ ve audit birlikte rollback olur; önceki söz korunur |

Okuma ve hata kontrolleri söz/takip/bağ/audit/fatura/kapama/kasa hareketi/bildirim sayımlarını önce–sonra karşılaştırır. Bunlar tüm satır içeriklerinin hash karşılaştırması değildir. Worker başarısı cari bazlı transaction'larla ilerler; bütün tenantın tek transaction içinde olduğu iddia edilmez. 101 cari kontrolü aday keşfinde durur; timeout kontrolü tek cari transaction'ının atomikliğini sınar.

## Yerel süre gözlemleri

Okuma ölçümlerinde bir ısınma çağrısından sonra tek istemciyle 10 örnek alındı. Her örnek sonuç doğrulamasını da içerir. Sentetik veri, yerel makine ve o anki kaynak yükü geçerlidir; eşzamanlı gerçek trafik veya üretim p95/SLA kabulü değildir.

| Senaryo | Örnek | En kısa | Medyan | En uzun |
| --- | ---: | ---: | ---: | ---: |
| 1.000 söz geçmişi okuma | 10 | 313,27 ms | 364,28 ms | 427,21 ms |
| 5.000 ödeme kaynağıyla okuma | 10 | 707,41 ms | 779,54 ms | 1.058,64 ms |

100 carilik worker üretim/doğrulama senaryosu yaklaşık 5,06 saniye; 100 carilik nakit haritası senaryosu yaklaşık 1,52 saniye sürdü. Bunlar birer koşumdur; worker'ın 15 dakikalık periyoduna ilişkin üretim taahhüdü çıkarılmaz. Gecikme enjekte edilen rollback senaryosu yaklaşık 16,11 saniyede tamamlandı.

Koşum sonunda uygulama bağlantısı kapatıldı; geçici PostgreSQL durduruldu ve otomatik silindi. Raporda `geciciDbSilindi: true`.

## Yeniden üretme ve kalan kapsam

Depo kökünden, canlı bağlantı ortam değişkenleri yüklenmeden:

```sh
NODE_PATH="$PWD/apps/api/node_modules" node .release-candidates/f02-pilot-20261016-4/f02-kapasite-prova.cjs
```

Betik aynı sonuç dosyasına yeni koşum raporu yazar; önceki kanıt saklanacaksa rapor önceden arşivlenir. Konteyner her seferinde yenidir. Test dosyaları yerel adayla saklanır; aday başka ortama taşınırsa betiğin sabit depo yolu uyarlanmalıdır. Ürün kaynağında değişiklik varsa yeni aday gerekir.

Üretim kabulü için gerçek veri dağılımı, eşzamanlı kullanıcı/worker yükü, tenant sayısı, kaynak türü karması, aynı caride çok sayıda aktif fatura/söz, uzun geçmiş, sorgu planları ve alan sahibinin süre hedefleri hâlâ değerlendirilmelidir. 100 cari sınırını kaldırma veya otomatik sayfalama bu provada eklenmedi. Gerçek takip örneği ve buna bağlı alan kabulü, [şirket pilot kaydında](F02-TEKIR-EKTRA-PILOT-KAYDI-2026-10-16.md) ertelenmiş durumdadır.
