# TekirExtra — Ek yapay zekâ entegrasyonu iş planı

Tarih: 5 Kasım 2026

Durum: Plan kaydedildi; aşağıdaki iş paketleri için uygulama başlamadı.

Amaç: Mevcut asistan altyapısını satış, satın alma ve finans süreçlerinde kaynak gösteren, kullanıcıya karar hazırlayan ve onaylanan işleri tamamlayan bir yardımcıya dönüştürmek.

## 1. Mevcut temel ve kapsam

Kod tabanında sağlayıcı adaptörleri, araç kullanımı, işlem onayları, OCR, e-postadan teklif hazırlama, hafıza, günlük brifing, risk araçları ve maliyet takibi bulunuyor. Bu plan bu altyapıları genişletir; aynı işlevleri ikinci kez kurmayı hedeflemez. Kodda bulunmak, her sağlayıcı ve gerçek iş akışı için canlı kabulün tamamlandığı anlamına gelmez.

İlgili kaynaklar:

- `apps/api/src/ai/ai.module.ts`
- `apps/api/src/ai/teklif-talebi/`
- `apps/api/src/ai/ajan/araclar/`
- `apps/api/src/ai/kalite/kalite-senaryolari.ts`
- `apps/api/src/ai/hafiza/`
- `apps/api/src/ai/icgoru/`
- `docs/AI-KALITE-TESTLERI.md`

Bu plan, V3.2 dijital çalışan mimarisine giden aşamalı ürün geliştirmesidir. Mevcut iş akışlarının başarısı ve maliyeti ölçülmeden kapsamlı bir çalışan/ajan yönetim katmanına geçilmez.

## 2. Uygulama ilkeleri

- Tutar, vergi, kur ve belge eşleştirme hesapları doğrulanabilir iş servislerinden gelir. Model açıklama, belirsizlik çözme ve öneri üretir.
- Her öneri ilgili kayıt, belge veya hesaplama kaynağına bağlanır. Bilgi eksikse kullanıcıya sorulur; kesin sonuç gibi sunulmaz.
- Firma, rol, paket ve kayıt erişimi mevcut API ve araç denetimlerinden geçer.
- Dış iletişim ve finansal sonuç doğuran işlemler mevcut önizleme/onay akışını kullanır. Onaylanan içerik değişirse yeniden onay gerekir.
- E-posta ve belge içeriği güvenilmeyen veri olarak işlenir; bu içerik kendiliğinden işlem yetkisi vermez.
- İş paketleri özellik bayrağıyla ve sınırlı pilot kapsamıyla açılır. Süre tahminleri başlangıç ölçümü ve ayrıntılı iş kırılımından sonra belirlenir.

## 3. İş paketleri ve sıra

| Sıra | Kod | İş paketi | Bağımlılık | İlk teslim |
|---|---|---|---|---|
| 1 | YZE-00 | Kalite ve başarı ölçümü | Mevcut kalite altyapısı | Senaryo seti ve başlangıç raporu |
| 2 | YZE-01 | Satış teklif yardımcısı | YZE-00 | Kaynaklı teklif ve yanıt taslağı |
| 3 | YZE-02 | Satın alma karşılaştırma yardımcısı | YZE-00, YZE-01'in ortak bileşenleri | Eşitlenmiş karşılaştırma ve gerekçe |
| 4 | YZE-03 | Belge uyuşmazlığı inceleme masası | YZE-00, YZE-02 | Sipariş–irsaliye–fatura fark kartları |
| 5 | YZE-04 | Şirket belgelerinde kaynaklı arama | YZE-00, belge erişimi/sürüm sözleşmesi | Kaynak ve sayfa bağlantılı cevaplar |
| 6 | YZE-05 | Tahsilat ve nakit akışı senaryoları | YZE-00, mevcut finans kaynakları | Varsayımları görünür senaryo karşılaştırması |
| 7 | YZE-06 | Role göre uzman çalışma ekranları | İlgili YZE-01…05 akışlarının pilot kabulü | Rol bazlı görev ve öneri kuyrukları |

### YZE-00 — Kalite ve başarı ölçümü

Kapsam: İncelenen canlı model kalite paketindeki üç senaryoyu, anonimleştirilmiş 50–100 satış/satın alma iş örneğine genişletmek. Belirsiz cari/ürün, farklı birim ve döviz, eksik teslim tarihi, çelişkili belgeler, yinelenen istek ve yetkisiz kayıt örnekleri kapsanır. Geliştirmede kullanılan örneklerle ayrı değerlendirme örnekleri ayrılır.

Kabul ölçütleri:

- [ ] Her senaryonun beklenen araçları, karar noktaları ve doğrulanabilir sonuçları tanımlı.
- [ ] Doğru cari/ürün seçimi, tutar ve para birimi doğruluğu, belirsizlikte soru sorma, kullanıcı düzeltmesi, süre ve görev maliyeti ölçülüyor.
- [ ] Yalnız yanıt metni değil, oluşan kayıt/işlem sonucu da denetleniyor; canlı iş verisine yazılmıyor.
- [ ] Aynı senaryo birden fazla denemeyle ölçülüyor; sağlayıcı/model ve sürümler raporda kayıtlı.
- [ ] Başlangıç ölçümü çıkarıldı; pilot başarı hedefleri ve durdurma eşikleri bu ölçüm üzerinden kararlaştırıldı.

### YZE-01 — Satış teklif yardımcısı

Kapsam: Mevcut e-postadan teklif akışına stok, cari fiyat koşulları, teslim süresi ve önceki teklif bağlamını eklemek. Eksik bilgi soruları, teklif taslağı ve müşteri yanıt taslağı aynı inceleme akışında sunulur.

Kabul ölçütleri:

- [ ] Ürün, varyant veya birim belirsizliğinde seçim isteniyor; sessiz eşleştirme yapılmıyor.
- [ ] Fiyat/iskonto, döviz, stok ve teslim bilgileri kaynak ve kontrol zamanı ile gösteriliyor.
- [ ] Kaydetme/onay anında değişen fiyat veya stok yeniden değerlendiriliyor.
- [ ] Taslak ve yanıt kullanıcı tarafından düzenlenebiliyor; dış gönderim ayrı onayla yapılıyor.
- [ ] Aynı isteğin tekrarı mükerrer teklif veya gönderim oluşturmuyor.

### YZE-02 — Satın alma karşılaştırma yardımcısı

Kapsam: Tedarikçi tekliflerini ürün, miktar, birim, döviz ve vergi koşulları açısından karşılaştırılabilir hâle getirmek. Fiyatın yanında vade, teslimat, ek maliyet ve mevcutsa geçmiş performans açıklanır.

Kabul ölçütleri:

- [ ] Özgün teklif değerleri korunuyor; dönüşüm birimi, kur kaynağı ve tarihi görünür.
- [ ] Nakliye, minimum sipariş, vergi ve benzeri eksik koşullar sıfır varsayılmıyor.
- [ ] Karşılaştırılamayan kalemler gerekçeleriyle ayrılıyor.
- [ ] Tercih ölçütleri kullanıcıya gösteriliyor; öneri kaynak teklif satırlarına bağlanıyor.
- [ ] Seçim satın alma taslağına aktarılabiliyor; taahhüt oluşturan adım onaya tabi.

### YZE-03 — Belge uyuşmazlığı inceleme masası

Kapsam: Mevcut denetim ve eşleştirmeleri sipariş–irsaliye–fatura zincirinde birleştirmek. Miktar, fiyat, iskonto ve mükerrerlik farkları için kaynaklı açıklama ve düzeltme önerisi sunulur.

Kabul ölçütleri:

- [ ] Her fark kartı belge ve satır referanslarını, beklenen/gerçekleşen değeri gösteriyor.
- [ ] Kısmi teslim, birden fazla irsaliye/fatura ve iade senaryoları kapsanıyor.
- [ ] Aritmetik farklar iş servisinde hesaplanıyor; modelin açıklaması bu değerleri değiştirmiyor.
- [ ] Öneri, insan kararı ve uygulanan işlem ayrı izleniyor; mevcut kayıt otomatik düzeltilmiyor.

### YZE-04 — Şirket belgelerinde kaynaklı arama

Kapsam: Sözleşme, katalog, fiyat anlaşması ve prosedürlerde arama. Ürün kodu gibi kesin eşleşmeler ile anlamsal arama birlikte değerlendirilir. Mevcut hafıza modülüyle sınırlar netleştirilir.

Kabul ölçütleri:

- [ ] Erişim kısıtları belge bulma ve cevap üretme aşamalarında uygulanıyor.
- [ ] Cevapta belge sürümü ve sayfa/bölüm bağlantısı bulunuyor.
- [ ] Eski, silinmiş, erişimi kaldırılmış veya çelişkili belgeler doğru ele alınıyor.
- [ ] Kaynak bulunmadığında veya yeterli olmadığında açıkça belirtiliyor.
- [ ] Belge içindeki talimatlar araç çalıştırma veya yetki genişletme sebebi olamıyor.

### YZE-05 — Tahsilat ve nakit akışı senaryoları

Kapsam: Mevcut risk, nakit ve brifing altyapısını “Bu tahsilat gecikirse hangi yükümlülükler etkilenir?” sorusunu cevaplayacak biçimde genişletmek. Görüşme ve hatırlatma taslakları hazırlanabilir.

Kabul ölçütleri:

- [ ] Gerçekleşmiş hareketler, planlanan ödemeler ve kullanıcı varsayımları ayrı gösteriliyor.
- [ ] Temel durum ile gecikme/erteleme senaryosu aynı kaynak ve tarih aralığında karşılaştırılıyor.
- [ ] Kesin tutar ile tahmin ayrılıyor; eksik veri sonucu görünür şekilde etkiliyor.
- [ ] Kullanıcı varsayımları değiştirebiliyor; ileti veya ödeme kendiliğinden gönderilmiyor.

### YZE-06 — Role göre uzman çalışma ekranları

Kapsam: Satış, satın alma ve finans sorumluları için öneri kartları, görev kuyrukları ve onay ekranları. Kullanıcı ilgili işlemde sohbeti tekrar tekrar tarif etmek zorunda kalmaz.

Kabul ölçütleri:

- [ ] Kartlar mevcut ekran/kayıt bağlamını kullanıyor ve ilgili işleme bağlantı veriyor.
- [ ] Kullanıcı yalnız yetkili olduğu veri ve eylemleri görüyor.
- [ ] Görevde bekleme sebebi, sorumlu, son durum ve onay ihtiyacı açık.
- [ ] Önerinin kabulü, düzenlenmesi ve reddi kalite ölçümüne bağlanıyor.
- [ ] Aynı işi yapan bağımsız ikinci bir sohbet/görev altyapısı kurulmadan mevcut bileşenler kullanılıyor.

## 4. Pilot ve teslim kapıları

1. YZE-00 başlangıç ölçümü ve senaryo seti tamamlanır.
2. Satış teklif akışı sınırlı pilotta açılır; gerçek kullanımda kabul/düzeltme, süre ve maliyet ölçülür.
3. Satın alma karşılaştırması ve belge uyuşmazlıkları aynı ölçüm düzeniyle sırayla açılır.
4. Kaynaklı arama ve nakit senaryoları, ilgili veri hazırlığı tamamlandığında eklenir.
5. Kabul edilmiş akışlar rol bazlı ekranlara taşınır; V3.2 kapsamı ölçülen ihtiyaçlara göre büyütülür.

Her teslimde örnek sonuçlar, değerlendirme raporu, yetki/tekrar davranışı, pilot kapsamı ve geri dönüş yöntemi kayıt altına alınır. Kullanıcıya sunulacak başarı yüzdeleri, süre veya maliyet kazanımları ölçüm yapılmadan vaat edilmez.

## 5. Takip

- [ ] YZE-00 — Kalite ölçümü
- [ ] YZE-01 — Satış teklif yardımcısı
- [ ] YZE-02 — Satın alma karşılaştırması
- [ ] YZE-03 — Belge uyuşmazlıkları
- [ ] YZE-04 — Kaynaklı belge arama
- [ ] YZE-05 — Nakit akışı senaryoları
- [ ] YZE-06 — Rol bazlı ekranlar

İlk uygulanacak iş: **YZE-00 kalite senaryo seti ve başlangıç ölçümü**. Bu dosyanın kaydedilmesi geliştirme, ücretli model çağrısı veya canlı veri işleme başlatmaz.

## 6. Tasarım referansları

- [Ajan sonuçlarının değerlendirilmesi](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
- [Kaynaklı aramada bağlam ve kesin/anlamsal eşleşme](https://www.anthropic.com/research/contextual-retrieval)
- [Basit iş akışlarından başlayarak ajan mimarisini büyütme](https://www.anthropic.com/research/building-effective-agents)
