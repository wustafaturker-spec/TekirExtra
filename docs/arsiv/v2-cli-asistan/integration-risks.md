# TekirExtra Accounting Intelligence V2 — Entegrasyon Riskleri ve Kritik Sınırlar (P0)

**Tarih:** 15 Ekim 2026  
**Durum:** Tamamlandı (P0 Fazı Teslimatı)  
**Referans Plan:** [TekirExtra_Accounting_Intelligence_V2_Detayli_Uretim_Plani.md](file:///home/mustafat/Downloads/TekirExtra_Accounting_Intelligence_V2_Detayli_Uretim_Plani.md)  
**Tamamlayıcı Belgeler:** [v2-architecture-inventory.md](v2-architecture-inventory.md), [v2-module-map.md](v2-module-map.md)

---

## 1. Yönetici Özeti ve Temel İlke

TekirExtra Muhasebe Zekası V2 mimarisi, geleneksel "kod yazan / veritabanına doğrudan SQL atan serbest LLM" yaklaşımını kesin bir dille reddeder. Temel ilke şudur:
> **"Finansal hesaplamaları deterministik motorlar yapar; LLM yalnızca yorumlama, açıklama ve planlama katmanıdır. Yapay zeka çekirdeği muhasebe kayıtlarına müdahale edemez (L5 yasaktır)."**

Bu belgede, P0 keşif fazı sırasında tespit edilen teknik riskler, güvenlik sınırları, doğrulanmış mimari gerçekler ile varsayımlar arasındaki farklar ve alınacak somut önlemler belgelenmiştir.

---

## 2. Doğrulanmış Gerçekler vs. Varsayımlar vs. Kritik Boşluklar

| Alan | Doğrulanmış Gerçek (Verified Fact) | Varsayım / Risk | Kritik Eksik / Önlem |
|---|---|---|---|
| **Veri Tabanı & RLS** | PostgreSQL 16 + Prisma 6. RLS tabloları `isletme_kodu` ile yalıtılmıştır. `tekir_app` kullanıcısının `BYPASSRLS` yetkisi yoktur. | AI sorgularının `PrismaService` üzerinden RLS oturum parametresi (`app.current_isletme_kodu`) açılmadan çağrılması riski. | Tüm AI okuma adaptörleri Prisma RLS transaction wrapper (`prisma.$transaction`) veya `UcCagirici` üzerinden zorunlu kılınacaktır. |
| **İşlem Yetkileri (L5 Sınırı)** | Sistemde Fatura, Cari, Kasa, Banka vb. mutating (POST/PUT/DELETE) uçları vardır. | AI planlayıcısının yanlışlıkla mutating uçlara erişmesi veya ödeme tetiklemesi riski. | AI Tool Registry yalnızca `@IsReadonly` işaretli metodları kabul eder. Muhasebe defteri yazma uçları AI registry'sinde tamamen kara listeye alınır. |
| **Finansal Hesaplama** | `nakit-akisi.hesap.ts` kuruş (integer) hassasiyetinde 3 senaryolu (kötümser/taban/iyimser) projeksiyon üretir. `gecikmeGun` ağırlıklı ortalaması mevcuttur. | LLM'in prompt içinde matematiksel toplama yapmaya kalkması ve halüsinasyon görmesi riski. | Prompt'lara hiçbir zaman ham işlem listesi verilip "toplamı sen hesapla" denmez. Deterministik motorun hesapladığı özet JSON aktarılır. |
| **Olay İzleme (Event Source)** | BullMQ + Redis kuyruğu ve `ScheduleModule` (cron) mevcuttur. Ancak Debezium / CDC (Change Data Capture) veya Outbox tablosu yoktur. | Muhasebe hareketlerinin anlık olarak yakalanamaması, anlık analiz yerine gecikmeli kalma riski. | P4 fazında Outbox veya zamanlanmış periyodik kontrol (scheduled incremental polling) benimsenecektir. |
| **Docker Sandbox** | Host'ta Docker mevcuttur fakat non-root geliştirme ortamında `docker build` izni kullanıcı onayı gerektirmektedir. | Worker'ın her an docker container ayağa kaldıramaması veya host docker socket güvenliği. | Sandbox için host docker.sock ASLA verilmez; karmaşık analitik için containerize sandbox, standart analizler için ise izole Node.js worker process fallback'i sunulur. |
| **Çoklu Kiracı İzolasyonu** | Kullanıcı JWT'sinde `isletmeKodu` ve `rol` yer alır. | Bir kiracının içgörüsünün veya kanıtının (EvidenceRef) başka kiracıya bildirilmesi riski. | `InsightEngine` yayım anında hedef kullanıcının `isletmeKodu` ve `rol` iznini ikinci kez (double-check) doğrular. |

---

## 3. Detaylı Risk Analizi ve Azaltma Stratejileri

### Risk 1: Veritabanı Çoklu Kiracı İzolasyonu ve RLS Aşımı
- **Risk Tanımı:** TekirExtra PostgreSQL RLS mimarisi oturum bazlı `SET LOCAL app.current_isletme_kodu = '...'` değişkeniyle çalışır. AI arka plan görevleri (arka plan analiz worker'ı) bir HTTP isteği olmadan çalıştığında işletme kodunu set etmeyi unutursa boş veri dönebilir veya hatalı bir tenant sorgulanabilir.
- **Etki:** Kritik (Veri sızıntısı veya analiz başarısızlığı).
- **Azaltma Stratejisi:**
  1. `EffectiveScope` nesnesi oluşturulmadan hiçbir analiz görevi başlatılamaz (`isletmeKodu`, `userId`, `rol`, `allowedModules`).
  2. Her araç çalıştırmasında `ToolGateway`, Prisma sorgusunu RLS oturumu başlatan güvenli wrapper içinden yürütür:
     ```typescript
     await prisma.$transaction(async (tx) => {
       await tx.$executeRaw`SELECT set_config('app.current_isletme_kodu', ${scope.isletmeKodu}, true);`;
       return tool.execute(tx, scope, input);
     });
     ```
  3. `tenant_id` / `isletme_kodu` eksik olan görevler doğrudan `PolicyEngine` tarafından reddedilir ve denetim kütüğüne (audit log) yazılır.

---

### Risk 2: LLM Finansal Halüsinasyonu ve Yuvarlama Hataları (Rule 6 İhlali)
- **Risk Tanımı:** LLM'ler (özellikle küçük veya genel amaçlı modeller) büyük sayıları çarpma, kuruş basamaklarını yuvarlama ve bileşik faiz/gecikme hesabı yaparken güvenilmezdir. Bir müşteriye ait borcun 1.250.400,50 TL yerine 1.250.000 TL olarak özetlenmesi güven kaybına yol açar.
- **Etki:** Yüksek (Yanlış nakit akışı ve tahsilat kararları).
- **Azaltma Stratejisi:**
  1. **Deterministik Çekirdek Kuralı:** Tüm bakiye, vade, kuruş ve projeksiyon hesaplamaları `apps/api/src/nakit-akisi/` ve `apps/api/src/cari/` içindeki saf TypeScript fonksiyonlarıyla kuruş (krs) veya `Decimal` cinsinden hesaplanır.
  2. **Kanıt Bağlantısı (EvidenceRef):** LLM'e sadece hesaplanmış kesin sonuçlar ve `EvidenceRef` kimlikleri (örn. `fatura:clx123`, `tutar:1500000 krs`) verilir.
  3. **Yayım Öncesi Doğrulama (Post-Validation):** LLM çıktısındaki parasal tutarlar regex ile taranır ve deterministik motorun ürettiği rakamlarla eşleşmiyorsa içgörü yayımlanmaz; inceleme bayrağı (`NEEDS_REVIEW`) düşülür.

---

### Risk 3: Otonom Görev Döngüsü ve Analiz Kirliliği (Insight Flooding)
- **Risk Tanımı:** Muhasebe sisteminde her fatura kesildiğinde veya tahsilat yapıldığında otonom ajan tetiklenirse, sistem günde yüzlerce tekrarlayan veya önemsiz içgörü üretebilir ("Firma X faturayı 1 gün geciktirdi").
- **Etki:** Orta/Yüksek (Kullanıcıda bildirim yorgunluğu ve sunucu kaynak tükenmesi).
- **Azaltma Stratejisi:**
  1. **Eşik Değerleri (Threshold Evaluation):** Her olay doğrudan AI görevine dönüşmez. Minimum tutar (örn. toplam alacağın %5'inden büyük) ve gecikme eşiği (> 3 gün) kuralları uygulanır.
  2. **Yinelenenleri Bastırma (Deduplication & Cooldown):** Aynı cari veya nakit kalemi için son 24 saatte içgörü üretilmişse yeni görev açılmaz, mevcut içgörü güncellenir.
  3. **Kota ve Bütçe Denetimi:** Her tenant için günlük maksimum otonom analiz sayısı ve token kotası sınırlandırılır.

---

### Risk 4: L5 Yasaklı Eylemler ve Kaynak Kod / Muhasebe Defteri Müdahalesi
- **Risk Tanımı:** Asistanın bir SQL UPDATE/DELETE çalıştırması, veritabanı şemasını değiştirmesi veya banka transferi başlatması.
- **Etki:** Felaket (Mali uyumsuzluk, veri kaybı).
- **Azaltma Stratejisi:**
  1. **Kesin Read-Only:** Asistan mimarisine tanımlanan tüm araçlar salt-okunurdur.
  2. **Veritabanı Kullanıcısı:** Analiz motorunun kullandığı veritabanı bağlantı havuzu sadece SELECT yetkisine sahip olabilir veya Prisma seviyesinde mutating metodlar Tool context'inde engellenir.
  3. **Kod Modifikasyonu Yasağı:** Asistanın host dosya sistemine yazma izni yalnızca `/tmp/tekir-jobs/{jobId}/` ile sınırlıdır; `apps/` veya `packages/` dizinlerine kesinlikle erişemez.

---

### Risk 5: Docker Sandbox ve İzolasyon Sınırları
- **Risk Tanımı:** Arka plan analiz veya dışa aktarım (PDF/Excel) görevlerinde üçüncü parti Python/Node.js betiklerinin host sistemine kaçması veya aşırı bellek tüketmesi.
- **Etki:** Yüksek (Hizmet dışı kalma - DoS).
- **Azaltma Stratejisi:**
  1. Docker socket (`/var/run/docker.sock`) asla konteyner içine mount edilmez.
  2. `--network none`, `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true` bayrakları zorunludur.
  3. Kaynak kotaları: Azami 1.5 CPU, 1024 MB RAM, 100 PID limiti ve 60 saniye execution timeout.
  4. Docker daemon'a erişilemediği durumlarda, güvenli dahili Worker Fallback (bellek ve zaman limitli subprocess) devreye girer.

---

## 4. İlk Dikey Kesit (Vertical Slice) İçin Özel Riskler: Nakit Akışı & Tahsilat Riski

1. **Açılış Bakiyesi Yanılgısı:**
   - *Risk:* Yalnızca vadeli çek ve faturalar toplanıp "bu ay 100.000 TL açığımız var" denmesi; oysa kasada 150.000 TL nakit bulunması.
   - *Kural:* Açılış nakit pozisyonu (Kasa + Vadesiz Banka bakiyeleri) eklenmeden net nakit açığı/fazlası hesaplanamaz.
2. **Resmi Tatil Kaymaları:**
   - *Risk:* Vadesi Pazar gününe veya bayrama gelen çekin o gün tahsil edileceği varsayımıyla nakit projeksiyonu yapılması.
   - *Kural:* `packages/shared/src/resmi-tatiller.ts` ve `sonrakiIsGunu` fonksiyonları tüm projeksiyonlarda zorunlu girdi olarak çalıştırılır.
3. **Müşteri Alışkanlığı Sapması:**
   - *Risk:* Kağıt üzerindeki faturanın vadesi 30 gün görünürken, müşterinin ortalama 52 günde ödeme yapması.
   - *Kural:* `CariAnaliz.gecikmeGun` verisi taban ve kötümser senaryolarda otomatik olarak vade tarihine eklenir.

---

## 5. P0 Fazı Çıkış Kriterleri ve Sonuç Değerlendirmesi

- [x] Kod ağacı, NestJS 11 + Prisma 6 + PostgreSQL RLS mimarisi tam olarak doğrulandı.
- [x] Tüm mevcut finansal modüller (Cari, Fatura, Çek/Senet, Banka, Kasa) haritalandı.
- [x] Deterministik matematik fonksiyonları (`nakit-akisi.hesap.ts`, `cari-analiz.ts`) keşfedildi ve doğrulandı.
- [x] Event sourcing ve kuyruk mekanizmaları (BullMQ/Redis) arşivlendi; CDC eksikliği tespit edildi.
- [x] L0-L5 otonomi ve güvenlik sınırları netleştirildi; read-only ilkesi belgelendi.
- [x] `docs/v2-architecture-inventory.md`, `docs/v2-module-map.md` ve `docs/v2-integration-risks.md` tamamlandı.

**P0 Fazı Başarıyla Tamamlanmıştır. P1 Fazına (Modül Sözleşmeleri ve Veri Erişimi) geçiş için hazırdır.**
