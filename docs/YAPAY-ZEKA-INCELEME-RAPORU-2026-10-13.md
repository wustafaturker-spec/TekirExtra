# Yapay Zeka Modülü İnceleme Raporu

**Tarih:** 13 Ekim 2026
**İnceleme türü:** Kod okuma + modülün birim testleri (`vitest src/ai`: 6 dosya, 29 test, hepsi geçti). Yerel
servisler kapalı olduğu için canlı deneme **yapılmadı**; aşağıdaki P0 bulguları kodda açıkça görülüyor ama
uçtan uca kanıtlanmadı. Kod değişikliği yapılmadı.
**Kapsam:** 12 Ekim'de gelen yapay zekâ paketi (69d184d) ve dört düzeltmesi (1666747, 362051c, 40e8d83,
34bff29): sağlayıcı katmanı (Gemini/OpenAI/Anthropic/Ollama/Mock), OCR + cari çıkarımı, dinamik fiyat motoru,
dış kanal ajanı (WhatsApp/web), ChatBI + "AI CFO" brifingi, kiracı AI ayarları + görevler, MCP sunucusu,
ilgili ekranlar ve göçler.
**Dosyalar:** `apps/api/src/ai/**`, `apps/api/src/stok/stok.service.ts` (`tavsiyeFiyat`),
`apps/api/prisma/migrations/20261012110000_*`, `20261012130000_*`,
`apps/web/src/app/{mobil/asistan,panel/ayarlar/yapay-zeka,panel/ai}/page.tsx`,
`apps/web/src/components/{ai-cfo-brifing-kart,ai-dis-kanal-asistan-modal,cari-ai-doldur-modal,fis-ai-doldur-modal}.tsx`,
`apps/web/src/app/panel/{layout,page,masraflar/page,cari/page}.tsx`.

## 1. Özet

Paket geniş bir alanı (OCR, fiyat, ajan, BI, MCP) tek seferde açıyor ve sağlayıcıdan bağımsız arayüz,
Zod şemasıyla doğrulanan çıktı, VKN/TCKN denetimi, LLM çağrısını DB işleminin dışına alma (40e8d83) gibi
doğru fikirler taşıyor. Ancak modül **bugünkü hâliyle üretime çıkamaz**:

1. **Kimlik doğrulamasız, kiracılar arası erişim.** `/mcp/rpc` ve `/mcp/messages` `@Public`; token
   verilmezse **ilk kiracıya**, bir UUID verilirse **o kiracıya**, imzası denetlenmeyen bir JWT verilirse
   **payload'daki kiracıya** bağlanıyor. Bu uçlardan cari bakiyesi, ciro, alacaklar, nakit okunuyor;
   teklif oluşturuluyor ve onaylanıyor. Ayrıca oturum açmış her kullanıcı `/ai/ajan/mesaj` gövdesine
   `tenantId`/`userId` yazarak başka kiracıda ya da başka kullanıcı adına işlem yapabiliyor.
2. **Yapılmayan işler "yapıldı" diye bildiriliyor.** Ajan "teklif PDF'i e-postayla iletildi", "ekstre
   WhatsApp'a gönderildi", "ödeme hatırlatması iletildi" diyor; hiçbir şey gönderilmiyor. Ses kaydı
   yazıya dökülmüyor, sabit bir cümleye çevriliyor ve bu cümle **veritabanına gerçek teklif yazıyor**.
   Varsayılan sağlayıcı `mock` olduğu için OCR her belgede aynı Migros fişini dönüyor — 93ede8b (5 Eylül)
   ile kaldırılan "simülasyonu gerçek gibi gösterme" sorunu geri gelmiş.
3. **Rakamlar uygulamanın geri kalanıyla çelişiyor.** ChatBI/brifing; raporlar incelemesinde (RPR-11…30)
   düzeltilen kuralları yok sayıyor: kâr kart alış fiyatıyla (ve maliyet bilinmezse "%70" varsayımıyla),
   vadesi geçen alacak ödenmiş borçlar dahil, nakit açılış bakiyesiz, döviz karışık toplanıyor, rol
   denetimi yok.

## 2. Durum

| Öncelik | Madde | Durum |
|---|---|---|
| P0-1 | MCP uçları kimliksiz ve kiracı seçimi istemcide | ✅ AI-01 (2026-10-13): `McpController` silindi, modüle bağlı değil; ayarlar ekranında MCP "Kapalı". Servis kodu (`mcp/mcp.service.ts`) erişim anahtarı tasarımı için duruyor |
| P0-2 | Ajan ucunda gövdeden `tenantId`/`userId` kabulü; tanınmayan gönderen ilk kullanıcıya eşleniyor | ✅ AI-01: kiracı/kullanıcı yalnız `aktifBaglam()`; kullanıcı kimliğiyle kiracı içinde aranır, yoksa 403; ilk kullanıcı/ilk kiracı yedekleri kalktı; kanal oturumu başka kullanıcıya aitse 403; web asistanı kullanıcı başına `web:<userId>` oturumu; `pin-dogrula` ve `oturum/:id` yalnız kendi oturumu |
| P0-3 | Kiracı ayarıyla platform API anahtarının dışarı sızdırılması + SSRF (`baseUrl`) | ✅ AI-01: kiracı adresi yalnız kiracının kendi anahtarıyla; adres https + alan adı + yerel/özel ad yok (`kiraciAdresiHatasi`), kayıtta 400; Ollama adresi yalnız `OLLAMA_BASE_URL`. Kalan: alan adının özel IP'ye çözülmesi (DNS rebinding) engellenmiyor |
| P0-4 | Sahte gönderim/transkripsiyon/OCR sonuçları gerçek gibi sunuluyor | ✅ AI-01: sağlayıcı/anahtar yoksa `TanimsizAiProvider` (503); mock yalnız ortamda `AI_PROVIDER=mock`; ayar okuma hatası yutulmuyor. Gönderim araçları "hiçbir şey gönderilmedi" deyip ekrana yönlendiriyor (uydurma alıcı kalktı); ses yazıya dökülemiyorsa komut çalışmaz; doğru PIN geçmişe yazılmaz. Ekranlar: sahte mikrofon, uydurma "850 TL" fiş kamerası kalktı; PIN yanlışken "doğrulandı" demiyor; hızlı komutlar yalnız kutuyu doldurur, taslak onay düğmesi teklif numarasıyla gönderir |
| P1-1 | Ajanın teklif akışı belge kurallarını atlıyor (KDV %20 sabit, numara biçimi, varyant, döviz, onay) | ✅ AI-02…07 (2026-10-13): araçlar ekranın denetleyici metotlarını çağırır (`UcCagirici`); KDV/birim karttan, fiyat ekranın fiyat önerisi ucundan (liste iskontosu ve döviz çevrimi dahil), numara onayda normal seriden (canlıda TKF2026000023). Regex/varsayılan cari-ürün kalktı |
| P1-2 | "ONAYLA" kiracıdaki herhangi bir kullanıcının son taslak teklifini onaylıyor | ✅ AI-04: kesinleştiren işlem yalnız onay talebi açar; talebi yalnız isteyen kullanıcı düğmeyle onaylar (yazı onay sayılmaz), 24 saat, tek sefer, denetim kaydı + bildirim |
| P1-3 | ChatBI/brifing rakamları yanlış ve rapor modülüyle tutarsız | ✅ AI-08: semantik katman silindi; asistan rapor araçlarıyla, yönetici özeti finansal özet + gelir-gider + vadesi geçenler uçlarından. Canlıda: 1–13 Ekim net kâr özet ve asistanda aynı (112.411,86 TL). Ek bulgu: Gemini `metinUret` sistem talimatını göndermiyordu (düzeltildi); model "bu ay" için ay sonunu seçip ileri tarihli tahakkukla farklı kâr veriyordu (araç bitişi bugüne çeker) |
| P1-4 | AI uçlarında rol denetimi yok | ✅ AI-02: araçlar ucun `@Roller` ve e-Belge uygulaması kuralıyla süzülür ve çağrılır; OCR `muhasebe`, ChatBI/brifing finans rolleri; `/panel/ai` iç rollere açık |
| P1-5 | PIN tasarımı işlevsiz ve zayıf | Kısmen (AI-10): PIN akışı ve uçları kodda kalktı; boş kolonlar AI-10 göçüyle silinecek |
| P1-6 | Dinamik fiyat motoru: para birimi karışıyor, girdiler sabit | Açık |
| P1-7 | API anahtarı düz metin; sağlayıcı hata gövdesi kullanıcıya dönüyor | Açık |
| P2-1 | Niyet çözümleme regex ile; "AI" adı yanıltıcı | ✅ AI-05: sağlayıcılara araç çağırma (Anthropic, OpenAI, Gemini, Ollama), en çok 8 tur; yanıt denetimi (aşağıda canlı bulgular) |
| P2-2 | Ekranlar: Tailwind sınıfları, satır içi renkler, dar ekran, 2 MB gövde sınırı | Kısmen: asistan penceresi, mobil sayfa ve `/panel/ai` tek `AsistanSohbet` bileşeninde, token'larla; fiş/cari modalları, CFO kartı ve ayarlar sayfası kaldı |
| P2-3 | OCR → masraf: çok oranlı KDV, belge görseli eklenmiyor, kategori eşleşmesi | Açık |
| P2-4 | Sağlayıcı katmanı: emekli model adı, anahtar URL'de, zaman aşımı/maliyet sınırı yok | Açık |
| P2-5 | KVKK: kişisel/ticari veri yurt dışı LLM'e onaysız gidiyor; sohbet kaydı süresiz | Açık |
| P2-6 | Ölü/kullanılmayan yapılar (`belge_ocr_kayitlari`, görev tetikleyicileri, WhatsApp webhook) | Kısmen: eski ajan araçları, MCP servisi, simülasyon/PIN uçları silindi; tablo ve görev tetikleyicileri kaldı |
| P2-7 | Testler sahte Prisma ile; güvenlik ve RLS testi yok | Açık |

## 3. Bulgular

### P0-1 — MCP uçları kimliksiz ve kiracı istemcinin elinde

`apps/api/src/ai/mcp/mcp.controller.ts:24,53,77` — `sse`, `messages`, `rpc` `@Public()`. Kiracı
`tenantIdCoz` (`:118`) ile şöyle bulunuyor:

1. `Authorization`/`?token=` bir UUID ise **doğrudan kiracı kimliği** sayılıyor (`:129`).
2. Üç parçalı bir değer ise JWT payload'ı **imza denetlenmeden** çözülüyor, içindeki `tenantId` alınıyor (`:134`).
3. Hiçbir şey yoksa `SELECT id FROM "Tenant" ORDER BY "createdAt" LIMIT 1` — **ilk kiracı** (`:148`).

Sonuç: internetten herhangi biri `POST /api/v1/mcp/rpc` ile `tools/call bakiye_sorgula`,
`resources/read tekirextra://finans/cfo-brifingi` çağırıp ilk kiracının (ya da kimliğini bildiği
herhangi bir kiracının) finansal özetini okuyabilir; `teklif_taslagi_hazirla` / `teklif_onayla` ile yazabilir.
`/mcp/konfigurasyon` kiracı kimliğini "token" olarak dağıtıyor (`?token=${tenantId}`); kimlik gizli bir
değer değildir ve iptal edilemez. `/mcp/messages?sessionId=` başka bir SSE oturumuna yanıt basmaya da izin
veriyor; `sseBaglantilari` sınırsız büyüyor (açık bağlantı başına bellek).

**Öneri:** MCP'yi kiracıya özel, hash'lenmiş, iptal edilebilir, yetki kapsamlı (salt okuma / yazma) erişim
anahtarıyla aç; anahtar yoksa 401. Yazma araçları (teklif, onay) ilk sürümde MCP'de olmasın. Bu düzeltme
gelene kadar `McpController` modülden çıkarılmalı. Not: Claude Code'daki `tekirextra` MCP sunucusu da bu uca
bağlanmaya çalışıyor (bu oturumda bağlanamadı — API kapalı).

### P0-2 — Ajan ucunda kiracı/kullanıcı gövdeden geliyor

`ai-ajan.controller.ts:27` — `tenantId: body.tenantId || baglamTenantId`, `userId: body.userId || …`.
Oturumdaki değer yerine gövdedeki tercih ediliyor; `tenantIslem` bu kimliği RLS'e yazdığı için A
kiracısının kullanıcısı B kiracısında bakiye okuyup teklif açabilir.

`ai-ajan.service.ts:kullaniciyiTespitEt` — gönderen e-posta/telefonla eşleşmezse **kiracının ilk
kullanıcısı** (genellikle yönetici) seçiliyor (`:182`); kiracı da bulunmazsa **ilk kiracının ilk
kullanıcısı** (`:229`). Telefon eşleşmesi `contains` ile yapılıyor (7 haneli bir parça başka kullanıcının
numarasını tutabilir). Yani "WhatsApp'tan yazan kişi" hiçbir zaman güvenilir biçimde tanınmıyor; tanınmadığında
en yetkili kullanıcıya dönüşüyor.

**Öneri:** Panel uçlarında kiracı ve kullanıcı yalnız `aktifBaglam()`'dan. Dış kanal için ayrı, imza
doğrulamalı (Meta `X-Hub-Signature-256`) bir webhook; gönderen numara kiracı ayarlarında **önceden
eşlenmiş ve doğrulanmış** bir kullanıcıya bağlanmıyorsa yanıt verilmez.

### P0-3 — Platform API anahtarının sızdırılması ve SSRF

`saglayici/ai-provider.factory.ts:32-34` — OpenAI için `config.apiKey || process.env.OPENAI_API_KEY` ve
`config.baseUrl` birlikte kullanılıyor. Bir kiracı yöneticisi ayarlarda sağlayıcı "openai", anahtar boş,
`baseUrl` kendi sunucusu girip **Bağlantıyı test et**'e basarsa platformun `OPENAI_API_KEY`'i
`Authorization: Bearer` başlığıyla o sunucuya gider (aynısı Gemini/Anthropic ortam anahtarlarının kiracı
adına harcanması için de geçerli). Ollama'da `baseUrl` serbest: sunucu içinden iç ağa
(`http://postgres:5432`, bulut metadata `169.254.169.254` …) istek atılır ve hata/yanıt metni test
sonucunda kullanıcıya döner (`tenant-ai.service.ts:baglantiTestEt`).

**Öneri:** Kiracı kendi anahtarını girmediyse kiracının `baseUrl`'i yok sayılsın; ortam anahtarı yalnız
platformun sabit uç noktasıyla kullanılsın. `baseUrl` için izin listesi (https, özel/yerel IP yasak);
Ollama yalnız platform ayarıyla.

### P0-4 — Sahte sonuçlar gerçek gibi sunuluyor

- `ai-ajan.tools.ts:407,456,506` — belge gönderme, ekstre gönderme, ödeme hatırlatması **hiçbir şey
  göndermiyor**, yalnız "başarıyla iletildi" metni dönüyor. Alıcı bulunamazsa uydurma adres
  (`muhasebe@musteri.com`, `+90 532 000 0000`) yazılıyor. Kullanıcı müşteriye gittiğini sanıyor.
  Uygulamada gerçek gönderim zaten var (FTR-36 belge e-postası, CARI-24 ekstre) — kullanılmıyor.
- `ai-ajan.service.ts:284-287` — `sesTranskripsiyon` sesi işlemiyor; metin yoksa sabit
  "Yılmaz Ticarete 50 koli A4 Kağıt için 60 gün vadeli teklif açalım…" cümlesini dönüyor. Web asistanında
  mikrofona basınca `sesBase64: "mock-ses"` gidiyor ve bu cümle **gerçek bir taslak teklif kaydı
  oluşturuyor** (cari/ürün adı eşleşirse).
- `AI_PROVIDER` tanımlı değil (repo `.env`'lerinde yok) → varsayılan `MockAiProvider`. Kiracı anahtar
  girmedikçe fiş taramada her görsel için aynı "MİGROS TİCARET A.Ş. 120 TL" sonucu, kartvizitte aynı
  "KAYA ENDÜSTRİYEL" carisi dönüyor; ekranda bunun örnek veri olduğu yazmıyor. Bu, 93ede8b'de kapatılan
  sorunun aynısı. Ayrıca kiracı ayarı okunamazsa `getProviderForTenant` hatayı yutup platform
  sağlayıcısına (yani mock'a) düşüyor (`ai.service.ts:57`).
- Ajan araç sonuçları "AI dinamik fiyatlandırma uygulandı" diyor; motor deterministik bir formül (P2-1).

**Öneri:** Üretimde mock sağlayıcı hiç seçilmesin; sağlayıcı yoksa uç 503 + "yapay zekâ sağlayıcısı
tanımlı değil" dönsün. Gönderim araçları ya gerçek servisleri çağırsın ya da "hazırlandı, göndermek için
onaylayın" desin. Ses yazıya dökülemiyorsa reddedilsin.

### P1-1 — Ajanın teklif akışı belge kurallarını atlıyor

`ai-ajan.tools.ts:araciTeklifTaslagiHazirla` `tx.belge.create` ile doğrudan yazıyor, `BelgelerService`'i
kullanmıyor:

- **KDV %20 sabit** (`:220`); ürünün KDV oranı, KDV dışı vergiler (EBLG-120), istisnalar yok sayılıyor.
- Numara taslakta alınıyor ve `TKF-2026-0001` biçiminde; normal akış onayda `TKF2026000001` veriyor
  (`belgeler.service.ts:994`) ve FTR-34 gereği dolu numarayı koruyor → aynı seride iki biçim, taslakta
  tüketilen sayaç.
- Varyant zorunluluğu (stok varyantları), birim çevrimi (STK-01/10), döviz (FTR-28), cari işlem denetimi,
  risk limiti, fiyat listesi denetlenmiyor; `include: { grup }` ile ad "bayi" içeriyorsa bayi sayılıyor.
- Cari/ürün `contains` ile ilk eşleşen kayıt; "A4" → yanlış ürün, "Yılmaz" → yanlış cari sessizce seçilir.
  Bulunamazsa varsayılan "Yılmaz Ticaret" / "A4 Kağıt" deneniyor (`ai-ajan.service.ts` teklif dalı).
- Liste fiyatı yoksa `100 TL` varsayılıyor; maliyet yoksa liste × 0,7.
- `araciTeklifOnayla` (`:345`) yalnız `durum = onaylandi` yazıyor; `BelgelerService.onayla`'daki kontroller
  çalışmıyor.
- Teklif dalı `komutuYurut` içinde iki kez kopyalanmış (ikinci kopyaya hiç ulaşılmıyor).

**Öneri:** Ajan araçları yalnız mevcut servisleri çağırsın (`BelgelerService.olustur/onayla`), belirsiz
eşleşmede adayları listeleyip seçim istesin, varsayılan cari/ürün olmasın.

### P1-2 — "ONAYLA" yanlış teklifi onaylayabilir

`ai-ajan.service.ts:313` — mesajda "onayla" geçmesi yeterli ("onaylama!", "onaylanan teklifler ne?" de
tetikler). Numara yoksa kiracıdaki **herhangi bir kullanıcının** en son taslak teklifi onaylanıyor;
oturumun kendi hazırladığı teklifle sınırlı değil. MCP `teklif_onayla` da aynı.

### P1-3 — ChatBI/brifing rakamları

`rapor/ai-rapor.semantik.ts`:

- **Ciro/kâr** (`semantikCiroVeKarlilik`): maliyet = kart `alisFiyati` × miktar; kart alış fiyatı yoksa
  `satır matrahı × 0,7 × miktar` (`:64`) — matrah zaten satır toplamı, miktarla ikinci kez çarpılıyor.
  RPR-12'de birleştirilen SMM tabanlı kâr tanımı kullanılmıyor; brüt kâr `max(0, …)` ile eksi olamıyor;
  dövizli faturalar belge dövizinde (`toplamMatrah`) TL ile toplanıyor; iade düşülmüyor.
- **Vadesi geçen alacak**: vadesi geçmiş **bütün borç hareketleri** — ödenmiş/kapatılmış olanlar da —
  toplanıyor (`:183`). Uygulamada doğru hesap (`vadesi geçenler`, RPR-17) var.
- **Nakit** (`semantikNakitDurumu`): bütün kasa/banka hareketleri tip işaretiyle toplanıyor; açılış
  bakiyesi, pasif hesaplar, döviz hesap ayrımı yok; tabloda hesap bakiyesi yok. Panel özeti RPR-15
  `varlik-ozeti.ts` ile doğru hesaplıyor.
- **Masraf**: tüm zamanlar, iptal edilenler dahil, dövizli masraflar kur uygulanmadan.
- **Müşteri sıralaması**: tüm zamanlar, bütün kesin faturalar belleğe alınıyor (sayfa/sınır yok).
- Brifing "bu hafta" diyor, ciro ay başından bugüne; "AI CFO" adını taşıyor ama LLM kullanılmıyor,
  skor sabit eşiklerle (50.000 TL nakit vb.) hesaplanıyor.
- Soru yönlendirmesi anahtar kelimeyle: "para birimi" → nakit raporu, "müşteri sayısı" → ciro sıralaması.

**Öneri:** Semantik katman kendi hesabını yapmasın; `rapor` servisinin ve rapor kataloğunun (RPR) çıktısını
kullansın. LLM yalnız soruyu katalogdaki bir rapora + filtreye eşlesin ve sonucu yorumlasın.

### P1-4 — Rol denetimi yok

`AiController`, `AiAjanController`, `AiRaporController` `@Roller` taşımıyor (yalnız `TenantAiController`
yönetici). `depo` rolündeki kullanıcı `/ai/rapor/sor` ve `/ai/rapor/yonetici-brifingi` ile ciro, kâr, alacak,
nakit görebilir; ajandan cari bakiyesi sorabilir, teklif açıp onaylayabilir. Web'de brifing kartı
`finansalOzetGorebilir` ile sınırlanmış ama API açık — RPR-11'deki sorunun aynısı. Asistan düğmesi her
role görünüyor.

### P1-5 — PIN

- PIN'i ya da kullanıcı telefonunu tanımlayan hiçbir ekran/uç yok (`pinKodu` yalnız AI dosyalarında geçiyor)
  → PIN hiçbir zaman istenmiyor.
- `pinDogrula` oturum yoksa veya PIN tanımsızsa `true` dönüyor (`ai-ajan.service.ts:127`).
- PIN düz metin, hem `users` hem `ajan_oturumlari` tablosunda; 4 hane, deneme sınırı yok.

### P1-6 — Dinamik fiyat motoru

`stok.service.ts:tavsiyeFiyat` (`aiOneri`): `bazFiyat` belge dövizine çevrilmiş, `maliyet` ise kartın TL
alış fiyatı → USD faturada maliyet TL ile karşılaştırılıp "stop-loss" yanlış tetikleniyor. Ortalama satış
fiyatı sırasız rastgele 10 satırdan, döviz ve iade gözetmeden. `cariOrtalamaGecikmeGun` hep `null`;
aylık finansman %4,5, grup iskontoları (bayi %15, toptan %10, VIP %8) ve hacim eşikleri kodda sabit; grup
adı metin aramasıyla. Maliyet bilinmiyorsa "%30 marj" varsayımıyla öneri üretiliyor. Bu bir AI değil,
kurala dayalı öneri; ayarlanabilir değilse kullanıcı için yanıltıcı.

### P1-7 — Anahtar saklama ve hata sızıntısı

`tenant_ai_ayarlari.api_key` düz metin (projede `hassasSifrele` var, IBAN için kullanılıyor). Maskeleme
`ilk4...son4` — kısa anahtarlarda neredeyse tamamı görünür; maskeli değer geri gönderilince `"..."` içerip
içermediğine bakılıyor (gerçek bir anahtarda `...` geçerse eskisi korunur). Sağlayıcı hata gövdeleri
olduğu gibi `Error` mesajına giriyor ve MCP/test yanıtında kullanıcıya dönüyor.

### P2-1 — Niyet çözümleme

Ajan bir LLM ya da işlev çağrısı kullanmıyor; `komutuYurut` `includes` ve regex zinciri. Sıra hataları
var (ör. "Kaya Ltd'ye ekstre gönder" önce gönderim dalına, "ödeme hatırlat" içinde "gönder" yoksa başka
dala), cari adı regex'i Türkçe ekleri kısmen tanıyor. Commit mesajındaki "function calling" ve
"audio transcription" kodda yok. Mevcut sağlayıcı katmanı araç çağırma (tool use) desteklemiyor.

### P2-2 — Ekranlar

- `fis-ai-doldur-modal.tsx` (14) ve `cari-ai-doldur-modal.tsx` (9) Tailwind sınıfı kullanıyor; uygulamada
  Tailwind yok (bkz. `panel/ai/page.tsx` notu) → ham görünür.
- `ai-cfo-brifing-kart.tsx` 81, `ai-dis-kanal-asistan-modal.tsx` 45, `mobil/asistan` 29 satır içi hex renk;
  tasarım sistemi token'ları kullanılmıyor, koyu temada bozulur. Kenar çubuğuna eklenen iki düğme de
  satır içi renkli.
- Fiş modalı `minWidth: 480px` → telefonda yatay kaydırma.
- Ayarlar sayfası MCP adresini `http://localhost:3001` olarak sabit yazıyor.
- `next.config.ts`'e `127.0.0.1:3001` rewrite eklendi; üretimde API ayrı makinedeyse çalışmaz.
- Fotoğraflar base64 JSON olarak gidiyor, sunucu gövde sınırı 2 MB (`main.ts:17`); telefon kamerası
  fotoğrafı (3–5 MB, base64 ile +%33) 413 alır. İstemcide küçültme/boyut sınırı yok.
- `/panel/ai` sayfası hâlâ "OCR yakında" diyor; OCR ise masraf ve cari ekranlarında açık — çelişkili.

### P2-3 — OCR → masraf

- Çok oranlı fişte yalnız ilk oran alınıyor (`kdvKirilimi[0]`); %1 + %10 + %20 karışık market fişi tek
  oranla kaydedilir.
- Taranan görsel masrafa ek olarak kaydedilmiyor (VUK saklama yükümlülüğü); `belge_ocr_kayitlari` tablosu
  açılmış ama hiç yazılmıyor.
- Kategori önerisi sabit Türkçe kelime listesiyle ("total", "bim", "po ", "kalem") ve kiracının
  kategori adlarına metin benzerliğiyle eşleniyor; "kalem" her kalem açıklamasında geçebilir.
- "Hızlı ödeme" istemcide `onayla` + `ode` zinciri; ikincisi başarısız olursa masraf onaylı ama ödenmemiş
  kalır, mesaj belirsiz.
- Tutar/tarih doğrulaması uyarı üretiyor ama `gecerli` yalnız genel toplam ≤ 0'da false; para birimi
  her zaman `TRY` isteniyor.

### P2-4 — Sağlayıcı katmanı

- Anthropic varsayılanı `claude-3-5-sonnet-20241022` emekli bir model; çağrı hata verir. Güncel model
  adları ayarda seçilebilir olmalı.
- Gemini anahtarı URL sorgusunda (`?key=`) — proxy/erişim kayıtlarına düşer; `x-goog-api-key` başlığı
  kullanılmalı.
- `fetch` çağrılarında zaman aşımı yok; sağlayıcı asılırsa istek asılır. Kiracı/kullanıcı bazında kullanım
  ve maliyet sınırı, token sayımı, kayıt yok.
- Yapılandırılmış çıktı JSON'u metinden ayıklanıyor; sağlayıcıların yerleşik şema/araç modları
  kullanılmıyor. Gemini'deki snake_case → camelCase "köprüsü" (34bff29) iki şemaya özel elle yazılmış.
- Anthropic yanıtında yalnız ilk içerik bloğu okunuyor.

### P2-5 — KVKK ve veri

Cari adları, VKN'ler, tutarlar, kartvizitteki kişisel veriler yurt dışındaki sağlayıcıya gidiyor; kiracıya
bilgilendirme/açık onay adımı ve kayıt yok (KVKK md. 9 yurt dışı aktarım). `ozelTalimatlar` ve belge metni
doğrudan prompt'a ekleniyor (istem enjeksiyonu: fiş metnindeki "önceki talimatları yok say…" gibi içerik
çıktıyı yönlendirebilir — şema doğrulaması kısmen korur). `ajan_mesaj_gecmisi` süresiz tutuluyor; silme/saklama
süresi yok.

### P2-6 — Ölü yapılar

- `belge_ocr_kayitlari` tablosu hiç kullanılmıyor.
- `tenant_ai_gorevleri.tetikleyici` (`ZAMANLANMIS`, `VADE_GECIKMESI`, `KASA_KRITIK`) ve `zamanlamaCron`
  hiçbir zamanlayıcıya bağlı değil; görev yalnız elle çalışıyor ve **veri görmeden** yalnız talimat metninden
  LLM'e "rapor" yazdırıyor (uydurma rakam riski).
- `guvenlikKurallari` saklanıyor, hiçbir yerde okunmuyor.
- "WhatsApp Cloud webhook" yok: Meta doğrulama (`hub.challenge`) ucu, imza denetimi ve giden mesaj
  gönderimi yok; `/ai/ajan/mesaj` oturum ister, dolayısıyla Meta çağıramaz.

### P2-7 — Testler

29 test geçiyor ama hepsi sahte Prisma nesneleriyle; servis kodundaki `(tx as any)?.ajanOturumu ||
this.prisma.ajanOturumu` gibi yollar yalnız testlere uymak için var ve gerçek işlemde RLS dışına düşme
riski taşıyor. Kimliksiz MCP, gövdeden kiracı, rol, gerçek DB/RLS altında çalışma testleri yok
(raporlardaki `raporlar.kabul.test.ts` benzeri bir kabul testi gerekli).

## 4. Canlı deneme bulguları (AI-02…07, 2026-10-13)

Demo kiracıda kayıtlı Gemini 2.5 Flash ile, `admin` (yönetici), `muhasebe` ve `depo` kullanıcılarıyla
denendi. Sonuçlar:

- **Çalışan:** cari/stok sorgusu; taslak teklif (varyantlı, dövizli liste fiyatı TL'ye çevrilerek);
  onay talebi → başka kullanıcı onaylayamaz (403) → sahibi onaylar, teklif `TKF2026000023` aldı →
  ikinci onay 409 → red; denetim kaydında `AI POST …` + araç + talep; bildirim talep kapanınca kapandı.
  Depo rolüne taslak/onay araçları sunulmadı, silme isteği reddedildi. MCP uçları 404.
- **Model araç çağırmadan iş yapmış gibi konuştu** ("teklif taslağı oluşturuldu" + uydurma bağlantı;
  "onayınız gerekiyor, onayladığınızda iptal edilecek"). Sistem talimatı yetmedi → sunucuda
  **yanıt denetimi** (`yanit-denetimi.ts`): yanıttaki kimlik/`/panel` adresi araç sonuçlarında yoksa,
  talep yokken onay iddiası varsa ya da hiç araç çalışmadan işlem iddiası varsa bir kez düzeltme
  istenir, yine uydurursa güvenli yanıt gösterilir.
- **Gemini ara sıra içeriksiz yanıt dönüyor** (4 denemede 1) → aynı istek 2 kez yeniden denenir.
- **Araç adını kesik yazdı** (`belge_taslagi_olust`) → en yakın adı öneren hata mesajı.
- **Döviz hatası:** fiyat listesindeki 0,38 USD çevrilmeden 0,38 TL yazıldı (`cevrilebilir:false`
  göz ardı edildi) → ekran gibi ürün kuru alınıp yeniden çevriliyor, liste iskontosu uygulanıyor;
  çevrilemezse fiyat kullanıcıdan istenir.
- **Veri:** "KARSEL OTOMOTİV" araması kayıttaki "KARSEL OTOTMOTİV" yazım hatasına takıldı → çok
  kelimeli arama sonuçsuzsa ilk kelimeyle aday listesi.
- **E2e gerilemesi (69d184d):** web API adresi göreli `/api/v1`'e çevrilmiş, e2e testleri hâlâ
  `localhost:3001`'i taklit ediyordu; beş e2e dosyası kırıktı → desen `**/api/v1/**`.
  Bunun ardında daha eski bir kırılma çıktı: e2e taklitlerindeki e-Belge uygulamaları verisi eski
  biçimde (`uygulamaAcik` → `undefined.acik`), panel istemcide çöküyor. Yapay zekâ işinden bağımsız; ayrı ele alınmalı.

Test verisi: denemede açılan iki yanlış/geçici taslak silindi; `TKF2026000023` (Ayşen Benni, 600 TL)
onaylı kaldı.

## 5. Önerilen sıra

1. **Hemen (P0):** `McpController`'ı ve `/ai/ajan/mesaj`'ın gövde kimliğini kapat; ajan simülasyonunda
   sahte gönderim/transkripsiyonu kaldır; mock sağlayıcıyı üretimde devre dışı bırak; `baseUrl` + ortam
   anahtarı birleşimini engelle. Bunlar küçük değişiklikler, ayrı bir commit olarak gidebilir.
2. **P1:** AI uçlarına `@Roller`; ajan araçlarını `BelgelerService`/FTR-36/CARI-24/rapor servislerine
   bağla; ChatBI'ı rapor kataloğuna yönlendir; PIN'i ya tamamla ya kaldır; anahtarı şifrele.
3. **P2:** Ekranları tasarım sistemine taşı, görsel küçültme + ek kaydı, çok oranlı KDV, sağlayıcı zaman
   aşımı/kullanım sınırı, KVKK onay adımı, ölü tabloları/görevleri ya bağla ya kaldır.

Modül onay kapısı gereği (S-01) P1/P2 kapsamı — özellikle ajanın hangi işlemleri **onaysız** yapabileceği
ve MCP'de yazma araçlarının olup olmayacağı — kodlamadan önce kullanıcıyla netleştirilmeli.
