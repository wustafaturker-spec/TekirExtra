# F03 — Referanslı iade sonrası satış

18 Ekim 2026. Fırsatın belge listesinde her faturaya `netSatis` eklendi. Satışın bütün satırları kaynak zinciri üzerinden aynı fırsata ait olduğunda, satış matrahı ve tek kaynak faturaya referans veren kesin satış iadelerinin matrahı karşılaştırılır. Tutarlar KDV hariç decimal-string olarak döner; dövizler birleştirilmez.

Bu ölçüm yalnız kayıtlı kaynak referansları kapsamındadır; referanssız iadeleri kapsadığı veya şirketin genel net cirosu olduğu iddia edilmez. Ekran kapsamı açıkça belirtir. Mevcut `FaturaIadeReferansi` fatura düzeyinde kanıttır; yeni satır bağı veya tahmini stok/tutar eşleştirmesi eklenmedi.

## Kurallar

- Tam sahiplik ve satış satır matrahları/header toplamı doğrulanır. Karma faturada sonuç NULL kalır; açık kapama dağıtımı ticari iade dağıtımının yerine kullanılmaz.
- İadenin tenant, cari, tür ve dövizi doğrulanır. İade tek referansla bu satış faturasına bağlı olmalıdır; çok kaynaklı veya harici ek referanslı iadede sonuç dağıtılamadı olur.
- İade satırlarının matrahı ve ödenecek toplamı kendi fatura başlığıyla eşleşir; negatif satır ve satış matrahını aşan toplam iade engellenir.
- Kesin iade, kapama kaydı olmasa da sonucu azaltır. Taslak/iptal iade hesaba katılmaz. Referansı doğrulanamayan mevcut iade kapaması varsa sonuç bilinmez kalır.
- Tahsilat satış matrahını azaltmaz. Kapama tutarı iade matrahı olarak kullanılmaz.
- Referanslar ve iade satırları ayrı ayrı 5000 kayıtla sınırlıdır; aşımda 409 döner. Bütün okumalar mevcut RepeatableRead işleminde ve tenant kapsamında yapılır; finans kaydı değişmez.

## Kalan kapsam

Karma faturanın ticari iadesini fırsatlara dağıtmak için satır düzeyinde kaynak kanıtı veya ayrı onaylı dağıtım sözleşmesi gerekir. Mevcut kapama payı bu kanıtı sağlamaz. F03 birleşik satış kabulü ve gerçek pilot tamamlanmış sayılmaz. Kullanıcının gerçek pilot/canlıya geçiş ertelemesi korunuyor.

## Doğrulama

- 45 geçici PostgreSQL/RLS kabul testi geçti; geçici veritabanı otomatik silindi. Dört yeni senaryo tek/çok kaynak, döviz, iptal/taslak, karma sahiplik, referanssız kapama, aşırı iade, kuruş hassasiyeti, başka cari ve matrah tutarlılığını kapsar.
- İlk koşumda mevcut büyük zincir testinin veri hazırlığı 5 saniyelik transaction sınırını aştı (43 geçti, 1 başarısız); tekrar koşumunda 45 testin tamamı geçti. Ürün zaman aşımı sınırı değiştirilmedi.
- CRM/belge/fatura için 92 birim testi geçti. API ve web odaklı tür kontrolleri ile yeni tarayıcı senaryosu geçti. Tam üretim derlemesi yapılmadı. Tarayıcı yanıtları fixture'dır; gerçek şirket pilotu değildir.
- Finans ve fırsat kayıtlarının salt okunur sonuç sorgusunda değişmediği doğrulandı. Yeni migration yok; üretim veritabanı veya şirket ayarı değiştirilmedi.
