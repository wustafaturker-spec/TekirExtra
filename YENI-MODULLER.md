# TekirExtra — Ek Modüller Planlama Dokümanı

**Tarih:** 19 Ağustos 2026  
**Amaç:** TekirExtra SaaS ön muhasebe uygulaması için önerilen 5 adet yeni modülün detaylı mimari tasarımı, veritabanı modelleme taslakları, API uçları ve ekran tasarımlarının planlanması.

---

## 🚀 1. Personel, İK ve Maaş/Bordro Modülü (`apps/api/src/personel`)

### 1.1 Veri Modeli Taslağı (Prisma Schema)
```prisma
enum PersonelCalismaTipi {
  TAM_ZAMANLI
  YARI_ZAMANLI
  SOZLESMELI
}

model Personel {
  id              String             @id @default(uuid())
  tenantId        String             @map("tenant_id")
  ad              String
  soyad           String
  tckn            String?
  eposta          String?
  telefon         String?
  departman       String?
  unvan           String?
  calismaTipi     PersonelCalismaTipi @default(TAM_ZAMANLI)
  girisTarihi     DateTime           @map("giris_tarihi")
  cikisTarihi    DateTime?          @map("cikis_tarihi")
  netMaas         Decimal            @map("net_maas") @db.Numeric(15, 2)
  iban            String?
  cariId          String?            @unique @map("cari_id") // Cari hesap ilişkisi (Personel tipinde cari)
  aktif           Boolean            @default(true)
  created_at      DateTime           @default(now())
  updated_at      DateTime           @updated_at

  bordrolar       PersonelBordro[]
  avanslar        PersonelAvans[]

  @@map("personel")
}

model PersonelBordro {
  id              String    @id @default(uuid())
  tenantId        String    @map("tenant_id")
  personelId      String    @map("personel_id")
  donemYil        Int       @map("donem_yil")
  donemAy         Int       @map("donem_ay")
  brutMaas        Decimal   @map("brut_maas") @db.Numeric(15, 2)
  netMaas         Decimal   @map("net_maas") @db.Numeric(15, 2)
  prim            Decimal   @default(0) @db.Numeric(15, 2)
  kesinti         Decimal   @default(0) @db.Numeric(15, 2)
  odenecekTutar   Decimal   @map("odenecek_tutar") @db.Numeric(15, 2)
  odendi          Boolean   @default(false)
  odemeTarihi     DateTime? @map("odeme_tarihi")
  kasaBankaFiId   String?   @map("kasa_banka_fis_id")

  personel        Personel  @relation(fields: [personelId], references: [id], onDelete: Cascade)

  @@unique([tenantId, personelId, donemYil, donemAy])
  @@map("personel_bordro")
}

model PersonelAvans {
  id              String    @id @default(uuid())
  tenantId        String    @map("tenant_id")
  personelId      String    @map("personel_id")
  tutar           Decimal   @db.Numeric(15, 2)
  tarih           DateTime
  aciklama        String?
  odendi          Boolean   @default(false)
  kasaBankaFiId   String?   @map("kasa_banka_fis_id")

  personel        Personel  @relation(fields: [personelId], references: [id], onDelete: Cascade)

  @@map("personel_avans")
}
```

### 1.2 API Endpoints
- `GET /personel` - Personel listesi (Filtreleme & Arama)
- `POST /personel` - Yeni personel kartı oluşturma (Arka planda Personel tipinde Cari kartı açar)
- `GET/PUT /personel/:id` - Personel detay ve güncelleme
- `POST /personel/bordrolar/tahakkuk` - Belirtilen ay/yıl için dönemde çalışan aktif personele bordro tahakkuku oluşturma
- `POST /personel/bordrolar/:id/odemeler` - Onaylanmış maaş bordrosunu kasa/bankadan öde
- `GET/POST /personel/avanslar` - Avans talep ve bakiye listesi
- `POST /personel/avanslar/:id/onayla|reddet|odemeler` - Avans karar ve ödeme akışı
- `POST /personel/bordrolar/:id/avans-mahsuplari` - Bordrodan kısmi avans mahsubu

### 1.3 UI Ekranları (`apps/web/src/app/panel/personel`)
- `/panel/personel` - Personel Listesi ve Özlük Özeti
- `/panel/personel/bordro` - Aylık Bordro Tahakkuk ve Ödeme Ekranı (Tek tıkla toplu maaş ödeme)
- `/panel/personel/avanslar` - Avans ve Prim Takibi

---

## 📊 2. Mali Müşavir Entegrasyonu ve Veri Aktarım Modülü (`apps/api/src/mali-musavir`)

### 2.1 İşlevsel Tasarım
- **Müşavir Rolü:** `MALİ_MÜŞAVİR` rolü eklenir. Bu rol yalnız fatura, cari ekstre ve KDV raporlarına salt-okunur erişebilir.
- **Dışa Aktarım Formatları:**
  - **Luca XML / Excel:** Fatura ve fişlerin Luca formatına uygun şablonla indirilmesi.
  - **Zirve / Logo / Mikro CSV Export:** Muhasebe fişleri formatında dışa aktarım.

### 2.2 API Endpoints
- `GET /mali-musavir/aktarim/fatura-xml` - Tarih aralığına göre Luca uyumlu fatura XML paketi
- `GET /mali-musavir/aktarim/fis-excel` - Kasa/Banka fişlerinin muhasebe kodlarıyla dışa aktarımı
- `GET /mali-musavir/kdv-beyanname-ozeti` - KDV 1 ve KDV 2 hazırlık raporu

### 2.3 UI Ekranları (`apps/web/src/app/panel/mali-musavir`)
- `/panel/mali-musavir/aktarim` - Dönem seçerek Luca/Zirve/Logo uyumlu fatura ve fiş paketlerini indirme paneli.

---

## 🤝 3. CRM ve Satış Fırsatları Modülü (`apps/api/src/crm`)

### 3.1 Veri Modeli Taslağı (Prisma Schema)
```prisma
enum FirsatAsamasi {
  YENI_LEAD
  ILETISIM_KURULDU
  TEKLIF_VERILDI
  PAZARLIK
  KAZANILDI
  KAYBEDILDI
}

model CrmFirsat {
  id              String        @id @default(uuid())
  tenantId        String        @map("tenant_id")
  baslik          String
  cariId          String        @map("cari_id")
  tahminiTutar    Decimal       @map("tahmini_tutar") @db.Numeric(15, 2)
  asama           FirsatAsamasi @default(YENI_LEAD)
  kapanisTarihi   DateTime?     @map("kapanis_tarihi")
  sorumluId       String?       @map("sorumlu_id")
  notlar          String?
  created_at      DateTime      @default(now())

  @@map("crm_firsat")
}
```

### 3.2 UI Ekranı (`apps/web/src/app/panel/crm`)
- `/panel/crm/kanban` - Drag-and-drop destekli Satış Hunisi (Kanban Board). Fırsatlar "Teklif Verildi" aşamasından "Kazanıldı"ya sürüklendiğinde otomatik Belge/Teklif veya Fatura dönüştürme seçeneği sunulur.

---

## 🛒 4. B2B Bayi Portalı (`apps/web/src/app/b2b` & `apps/api/src/b2b`)

### 4.1 İş Yapısı
- Bayiler (Cari kartındaki ilgili kişilere verilen giriş yetkisi ile) kendilerine ait özel portal adresi üzerinden sisteme girer.
- Bayi yalnızca kendi cari bakiyesini, geçmiş faturalarını ve `FiyatListeleriModule` üzerinden kendisine atanmış özel fiyatlı ürün kataloğunu görür.
- Sepete eklediği ürünler direkt olarak **Sipariş Belgesi** (`BelgelerModule`) olarak yetkilinin onayına düşer.

---

## 🤖 5. AI Destekli Finansal Asistan & Fiş OCR (`apps/api/src/ai`)

### 5.1 Öne Çıkan Yetenekler
1. **Nakit Akışı Tahminleme (Cash-flow Forecast Engine):**
   - Gelecek 30/60/90 günlük periyotta vadesi gelecek alacaklar, ödenecek çekler, tekrarlayan faturalar ve tahmini personel maaşlarını analiz ederek tahmini bakiye grafiği çizer.
2. **Fiş/Masraf OCR (Vision AI):**
   - Harcama fişi fotoğrafı yüklendiğinde Tutar, Tarih, VKN ve KDV oranını otomatik tespit edip Masraf Fişi formunu doldurur.

---

## 🗓️ Geliştirme Yol Haritası Önerisi

| Aşama | Modül | Öncelik | Tahmini Efor |
|---|---|---|---|
| **Faz 1** | **Personel & Bordro Modülü** | Yüksek | 1.5 Hafta |
| **Faz 2** | **Mali Müşavir Aktarım Modülü** | Yüksek | 1 Hafta |
| **Faz 3** | **CRM & Satış Hunisi** | Orta | 1 Hafta |
| **Faz 4** | **B2B Bayi Portalı** | Orta | 2 Hafta |
| **Faz 5** | **AI Nakit Akışı & Fiş OCR** | İleri Seviye | 2 Hafta |
