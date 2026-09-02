# Düzeltme Merkezi Operasyon Runbook'u

Bu belge R1 düzeltme dedektörlerinin işletimi, izlenmesi ve güvenli müdahale adımlarını tanımlar.

## Çalışma biçimi

- Dedektörler yalnız `TEKIR_WORKER=1` olan worker sürecinde otomatik çalışır.
- Worker açılışında ilk tarama hemen başlar; sonraki taramalar en geç 15 dakikada bir yapılır.
- `DUZELTME_TARAMA_INTERVAL_MS` daha kısa bir aralık seçebilir, ancak 15 dakikadan uzun bir değer etkisizdir.
- Tenant listesine RLS dışından erişmek için worker'da `DATABASE_URL_MIGRATE` bulunmalıdır. Finansal tabloların tamamı tenant işlemi ve RLS bağlamı içinde okunur.
- Aynı neden, kaynak türü ve kaynak referansı tekrar bulunduğunda yeni kayıt açılmaz. Kaynak sorun kaybolduğunda açık kayıt otomatik çözülür.

## İzlenecek metrikler

Worker'ın `/metrics` ucunda aşağıdaki metrikler yayınlanır:

- `correction_scan_runs_total{result="success|failed"}`: tarama çalıştırma sonucu.
- `correction_findings_total`: taramalarda bulunan toplam istisna.
- `correction_auto_resolutions_total`: kaynağı düzelmiş olduğu için otomatik kapanan toplam kayıt.
- `correction_scan_duration_seconds`: son taramanın süresi.
- `correction_scan_tenants`: son taramada işlenen tenant sayısı.
- `correction_scan_last_success_timestamp_seconds`: son başarılı taramanın Unix zamanı.

Önerilen alarmlar:

1. Son başarılı taramanın üzerinden 20 dakika geçmişse kritik alarm.
2. `correction_scan_runs_total{result="failed"}` artıyorsa uyarı.
3. Tarama süresi yapılandırılmış aralığa yaklaşıyorsa kapasite uyarısı.
4. Kritik açık kayıt veya SLA aşan kayıt sayısı sıfırdan büyükse operasyon uyarısı.

## Müdahale

1. Worker `/health` ve `/metrics` uçlarını kontrol edin.
2. `correction_scan_failed` olayını worker loglarında bulun; hata mesajı ve süreyi inceleyin.
3. PostgreSQL erişimini ve `DATABASE_URL_MIGRATE` tanımını doğrulayın.
4. Worker'ı yeniden başlatın. Açılıştaki tarama idempotent olduğundan kayıt çoğaltmaz.
5. Gerekirse yönetici veya muhasebe rolüyle Düzeltme Merkezi'ndeki **Yeniden tara** eylemini kullanın.
6. Bir tenantta hata varsa diğer tenantların verisini elle değiştirmeyin; hatalı kaynak modülünü tenant bağlamında düzeltip yeniden tarayın.

## Güvenli geri alma

- Otomatik taramayı durdurmak için worker sürecini durdurun; API çalışmaya devam eder.
- Açılmış düzeltme kayıtlarını fiziksel olarak silmeyin. Kaynak düzeltildikten sonra yeniden tarama ile otomatik kapatın.
- Toplu yoksayma yalnız banka ekstresi bulgularında kullanılmalıdır ve gerekçe zorunludur.
- Kritik POS, stok, e-Belge veya fatura/cari tutarsızlıklarını yoksaymak yerine kaynak domain akışından düzeltin.
