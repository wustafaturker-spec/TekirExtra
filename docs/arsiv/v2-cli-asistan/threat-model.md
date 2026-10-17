# TekirExtra CLI Assistant — Güvenlik Tasarımı ve Tehdit Modeli (Threat Model)

**Sürüm:** 1.0  
**Tarih:** 15 Ekim 2026  
**Durum:** P1 Fazı Güvenlik Şartnamesi  
**Referans Plan:** [TekirExtra_CLI_Assistant_Uretim_Plani_V1.md](TekirExtra_CLI_Assistant_Uretim_Plani_V1.md)

---

## 1. Güvenlik Hedefleri ve Değişmez Sınırlar

Asistanın temel prensibi **"Defensive by Design" (Tasarım Gereği Güvenlik)** olup şu mutlak sınırlara tabidir:
1. **Salt Okunur (Read-Only) Kuralı:** Asistan, mevcut hiçbir veritabanı kaydını, e-belgeyi, faturayı veya yüklenmiş dosyayı değiştiremez veya silemez (`SEC-003`). Yalnızca yeni görev kayıtları ve yeni `artifact` (PDF, Excel, analiz raporu) oluşturabilir.
2. **Uygulama ve Kaynak Kodu Yalıtımı:** Asistan ve onun çalıştırdığı Docker sandbox ortamı uygulama kaynak kodlarını okuyamaz veya değiştiremez (`SEC-004`).
3. **Host ve Docker Socket İzolasyonu:** Sandbox konteynerinin host dosya sistemine, Docker daemon soketine (`/var/run/docker.sock`) ve doğrudan veritabanına erişimi teknik olarak imkansız kılınır (`SEC-005`).
4. **Sunucu Taraflı Yetki Denetimi:** Kullanıcı/rol izinleri modelin kararına bırakılmaz. Her araç ve veri sorgusu sunucu tarafında bağımsız olarak doğrulanır (`SEC-001`, `SEC-008`).

---

## 2. Tehdit Analizi ve Karşı Tedbirler (Threat Matrix)

| Tehdit Kodu | Tehdit Tanımı | Olası Etki | Uygulanan Savunma Mekanizması | Doğrulama Testi |
| :--- | :--- | :--- | :--- | :--- |
| **TM-01** | **Doğrudan Prompt Injection** (Kullanıcının sistem promptunu delme girişimi) | Asistanın amacından sapması, yetkisiz araçları zorlaması | Modelin sistem talimatları ile kullanıcı girdileri ayrıştırılır. Güvenlik kararları modele bırakılmaz; sunucu Policy Engine her eylemi bağımsız yetkilendirir. | `SEC-006` |
| **TM-02** | **Dolaylı (Indirect) Prompt Injection** (Cari unvanı, fatura açıklaması veya e-posta ekinde gizlenen zararlı talimatlar) | Okunan veri üzerinden asistanın manipüle edilmesi | Veritabanından gelen tüm kayıtlar modele `<untrusted_record_data>` sınırlandırıcısı içinde "veri" olarak iletilir. Veri içeriğindeki talimatlar model tarafından yürütülebilir emir kabul edilmez. | `SEC-006` |
| **TM-03** | **Yetki Yükseltme & Çapraz Kiracı Sızıntısı (Cross-tenant)** | Başka şirketin finansal verilerinin okunması | PostgreSQL Row-Level Security (RLS) `tekir_app` rolü üzerinden zorunludur. `tenant_id` istemciden değil doğrulanmış JWT oturumundan (`istek-baglami`) alınır. | `SEC-001`, `SEC-002` |
| **TM-04** | **Rol ve Alan Bazlı Yetki Aşımı** | Satış personelinin personelin maaşını veya kâr-zarar raporunu görmesi | `UcCagirici` seviyesinde `@Roller` denetimi ve alan filtreleme (`sec(...)` DTO projeksiyonu) yapılır; izin verilmeyen alanlar model bağlamına hiç verilmez. | `SEC-008` |
| **TM-05** | **Docker Sandbox Kaçışı (Container Escape)** | Konteynerden host sisteme sızma | Rootless konteyner (`--user 1001:1001`), `read-only rootfs`, `cap-drop=ALL`, `no-new-privileges:true`, seccomp varsayılan profili ve `--network none`. Host dizinleri mount edilmez. | `SEC-005` |
| **TM-06** | **Kaynak Tüketimi ve DoS** | Aşırı bellek/CPU tüketimi veya sonsuz döngü | Konteyner başına CPU (`--cpus=1.5`), RAM (`--memory=1g`), PID (`--pids-limit=100`), tmpfs disk sınırı (`512m`) ve görev başına 15 dakika timeout uygulanır. | `REL-001` |
| **TM-07** | **Uzun Süreli Görevde Yetki İptali** | Görev çalışırken kullanıcının rolünün düşürülmesi veya yetkisinin alınması | Görev başlangıcında `permission_scope_version` damgalanır. Sonuç yayımlanmadan önce veya her yeni veri adımında yetki güncelliği tekrar doğrulanır. İptal durumunda çıktı gizlenir. | `SEC-007` |
| **TM-08** | **Mükerrer Görev Yürütme (Replay Attack)** | Aynı analiz görevinin defalarca tetiklenmesi ve kaynak israfı | `Idempotency-Key` başlığı ve görev seviyesinde benzersiz kilit uygulanır. | `FUNC-006` |

---

## 3. Rol - Modül Yetki Matrisi (Permission Matrix)

Asistanın araçları tetiklerken uygulayacağı asgari rol seviyeleri:

| Modül / Veri Alanı | Yönetici (`yonetici`) | Muhasebe (`muhasebe`) | Satış (`satis`) | Salt Okunur (`salt_okunur`) | Çalışan (`calisan`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Cari Hesaplar & Bakiye** | ✅ Tam | ✅ Tam | ✅ Kendi carileri/liste | ✅ Tam | ❌ Yasak |
| **Faturalar & Ödemeler** | ✅ Tam | ✅ Tam | ✅ Satış faturaları | ✅ Tam | ❌ Yasak |
| **Stok & Fiyat Önerisi** | ✅ Tam | ✅ Tam | ✅ Satış fiyatları | ✅ Liste | ❌ Yasak |
| **Finansal Özet & Gelir-Gider** | ✅ Tam | ✅ Tam | ❌ Yasak | ✅ Rapor | ❌ Yasak |
| **Kasa & Banka Bakiyeleri** | ✅ Tam | ✅ Tam | ❌ Yasak | ✅ Liste | ❌ Yasak |
| **Personel & Bordro Verisi** | ✅ Tam | ✅ İzinli | ❌ Yasak | ❌ Yasak | ✅ Sadece kendi |
| **Hazır Rapor Kataloğu** | ✅ Tam | ✅ Tam | ✅ Satış raporları | ✅ Salt rapor | ❌ Yasak |
| **Docker Sandbox Rapor Üretimi**| ✅ Tam | ✅ Tam | ✅ Kısıtlı | ✅ Kısıtlı | ❌ Yasak |

---

## 4. Docker Sandbox İzolasyon Mimarisi

```
+------------------------------------------------------------------------+
| HOST SİSTEM (TekirExtra Worker / BullMQ)                               |
|                                                                        |
|  1. Yetkili veriyi hazırla -> /tmp/jobs/{id}/input/data.json          |
|  2. Docker Container'ı izole parametrelerle başlat                    |
|                                                                        |
|   +----------------------------------------------------------------+   |
|   | DOCKER SANDBOX (tekirextra-sandbox:1.0)                        |   |
|   |                                                                |   |
|   |  - Kullanıcı: 1001 (Non-root)                                  |   |
|   |  - Ağ: KAPALI (--network none)                                 |   |
|   |  - Kök Dosya Sistemi: READ-ONLY (--read-only)                  |   |
|   |  - İzinler: TÜMÜ DÜŞÜRÜLDÜ (--cap-drop=ALL)                    |   |
|   |  - Bellek: 1 GB Max (--memory=1g)                              |   |
|   |  - CPU: 1.5 Çekirdek Max (--cpus=1.5)                          |   |
|   |                                                                |   |
|   |  /input   (RO Mount)  <- data.json (Yalnızca filtrelenmiş veri)|   |
|   |  /scratch (tmpfs RAM) -> Geçici hesaplama ve rapor çıktısı     |   |
|   |  /app     (RO Image)  -> Güvenli Python/Node analiz betikleri  |   |
|   +----------------------------------------------------------------+   |
|                                                                        |
|  3. /scratch/output.{pdf|xlsx} çıktısını al                            |
|  4. MinIO S3 Nesne Deposuna Yükle (presigned URL)                      |
|  5. Geçici dizini güvenle temizle                                      |
+------------------------------------------------------------------------+
```

---

## 5. Kabul Kriterleri Doğrulama Tablosu

| Kabul Testi | Beklenen Sonuç | Doğrulama Yöntemi |
| :--- | :--- | :--- |
| `SEC-001` (Yetkisiz modül sorgusu) | `403 Forbidden` veya filtrelenmiş boş yanıt | API test (`roller.guard.test.ts`) |
| `SEC-002` (Farklı şirket kaydı) | Satır dönmez (0 kayıt) | PostgreSQL RLS izolasyon testi |
| `SEC-003` (Kayıt silme/değiştirme) | `Method Not Allowed` / Araç yok | Statik araç sözlüğü analizi |
| `SEC-004` (Kaynak kod okuma) | Sandbox içinde `/home`, `/app/src` erişilemez | Sandbox executor izolasyon testi |
| `SEC-005` (Docker socket erişimi) | `/var/run/docker.sock` mount edilmez | Container konfigürasyon denetimi |
| `SEC-006` (Prompt injection) | Zararlı girdi komut olarak işletilmez | E2E enjeksiyon simülasyonu |
| `SEC-007` (Yetki iptali senaryosu) | Görev askıya alınır, çıktı kapatılır | Task engine iptal testi |
| `SEC-008` (Alan bazlı gizlilik) | Hassas alanlar (örn. kâr marjı) DTO'dan çıkarılır | Zod / DTO şema testi |
