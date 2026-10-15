# AI yanıt kalitesi

Asistan yanıtları kendi sahibi tarafından doğru, yanlış veya eksik olarak değerlendirilir. İsteğe bağlı not 500 karakterle sınırlıdır. Bir mesajın güncel değerlendirmesi tek kayıttır; değişiklikler sayacı çoğaltmaz. Yönetici `/ai/kalite` üzerinden son 30 günde değerlendirilmiş en fazla 1.000 yanıtı model ve kullanılan araçlara göre görür. Özet yanıt metni ve değerlendirme notlarını içermez. Araç kırılımı o aracı kullanan yanıtların değerlendirmesidir; aracın bağımsız başarı ölçümü değildir. Geri bildirim otomatik model eğitimi başlatmaz.

Mesajla birlikte sağlayıcı/model saklanır. Eski mesajların modeli bilinmiyorsa bu durum özet içinde gösterilir. Değerlendirme ve not aynı mesaj satırında bulunduğundan sohbet saklama politikasıyla birlikte temizlenir.

## Kalite senaryoları

- Belirsiz cari: cari arama aracını seçmeli; iki aday sonucu geldiğinde kullanıcıya seçim sormalı.
- Negatif stok: stok arama aracını seçmeli; sonuçtaki -5 adet değerinin işaretini korumalı.
- Vadesi geçen alacak: doğru rapor aracını seçmeli; 1.234,56 TRY değerini ve para birimini korumalı.

Gerçek model paketi uygulamanın mevcut araç tanımlarını ve yanıt denetimini kullanır. Araç sonuçları yapaydır; ERP sorgusu veya kayıt işlemi çalıştırmaz. Bu dar test paketi modelin araç seçimi ve sonuç yorumlamasını ölçer; tüm ajan döngüsü veya gerçek belge OCR kalitesinin yerine geçmez. Her senaryo iki kez denenir; süre ve varsa token kullanımı her denemede JSON olarak raporlanır. Başarısız denemeler testi başarısız yapar.

## Çalıştırma

Normal testler ücretli sağlayıcı çağrısı başlatmaz. Canlı paket için `apps/api` dizininden sağlayıcı/model açıkça seçilir:

```bash
AI_KALITE_CANLI=1 AI_KALITE_SAGLAYICI="SAGLAYICI_ADI" AI_KALITE_MODEL="MODEL_ADI" pnpm test:ai-kalite
```

Sağlayıcı `openai`, `anthropic`, `gemini` veya `ollama` olmalıdır. Model adı seçilen sağlayıcıda kullanılabilir olmalıdır. Anahtar mevcut sunucu ortam değişkeninden okunur (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`); tenant BYOK anahtarları okunmaz. Ollama için `OLLAMA_BASE_URL` tanımlanmalıdır. Canlı çağrılar sağlayıcı kullanım ücreti oluşturabilir.

`AI_KALITE_GIRIS_MILYON_USD` ve `AI_KALITE_CIKIS_MILYON_USD` seçilen modelin USD / bir milyon token fiyatlarıyla verilirse tahmini maliyet raporlanır. Tarife veya güncel token sayısı yoksa maliyet null gösterilir; sıfır maliyet varsayılmaz. Karşılaştırmalarda aynı senaryoları ve ayrı açık model seçimlerini kullanın. Altı denemelik paket başlangıç ölçümüdür; genel doğruluk oranı hakkında güçlü bir istatistiksel sonuç vermez.

Canlı çağrı açmadan ölçütleri doğrulamak için:

```bash
pnpm exec vitest run src/ai/kalite/kalite-senaryolari.test.ts
```

Sahiplik, tenant ayrımı, tekrar değerlendirmede tek kayıt, içeriksiz yönetici özeti ve saklama ilişkisi gerçek PostgreSQL'de `test/ai-tutarlilik.kabul.test.ts` ile doğrulanır. Bu test kendi verisini rollback eder. HTTP kabul paketi aynı yanıtın idempotent kimliğini ve değerlendirme uçlarını da doğrular.
