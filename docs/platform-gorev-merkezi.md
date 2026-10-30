# Platform görev merkezi

`/platform/gorevler` üzerinden görev oluşturulur, düzenlenir, tamamlanır ve yeniden açılır. Görevde başlık, açıklama, sorumlu, öncelik, son tarih ve isteğe bağlı mevzuat bağlantısı tutulur. Tamamlanan ve iptal edilen görevler silinmez.

Yönetim özeti, kullanıcıya atanmış açık görevlerin toplamını ve yetki kapsamındaki tüm geciken ekip görevlerini ayrı gösterir. Kişisel listede son tarih sırasındaki ilk beş görev bulunur. Görev kaynağı hata verirse diğer özet bölümleri kullanılabilir ve görev bölümü ayrıca yeniden denenebilir.

Doğrudan bağlantılar: `?benim=1` kişisel filtreyi, `?geciken=1` gecikenler filtresini açar. `?gorev=<UUID>` yetki kontrolünden sonra ilgili görevin düzenleme formunu açar.

Arama (`arama`), durum (`durum`) ve sayfa (`sayfa`) da adres çubuğunda korunur. Arama veya filtre değiştiğinde sayfa bire döner. Filtreleri temizleme düğmesi varsayılan açık işler görünümüne döndürür. Liste bağlantısını kopyalama, görev düzenleme veya yeni bağlı görev oluşturma parametrelerini paylaşım bağlantısından çıkarır. Bağlantıyı açan kişi kendi yetki kapsamındaki kayıtları görür.

## Yetki ve kayıt güvenliği

- Mevzuat editörleri yalnızca mevzuat kapsamındaki görevleri görür ve düzenler.
- Platform yöneticileri iki kapsamı da yönetir. Platform kapsamındaki görevler yalnızca yöneticilere atanabilir.
- Sorumlu olarak aktif ve davet sürecini tamamlamış kullanıcılar seçilebilir.
- Görevin kapsamı oluşturulduktan sonra değişmez. Platform görevlerine mevzuat bağlantısı eklenemez.
- Güncelleme isteği mevcut `surum` değerini içerir. Başka bir kullanıcı kaydı değiştirmişse API `409` döndürür; arayüz taslağı korur ve güncel kaydı yükleme seçeneği sunar.
- Oluşturma ve güncelleme işlemleri denetim kaydıyla aynı veritabanı işlemi içinde yazılır.

## API

Tüm uçlar platform oturumu gerektirir; taban yol `/api/v1/platform/gorevler`.

| Yöntem | Yol | İşlem |
| --- | --- | --- |
| GET | `/` | Sayfalı liste, kapsam içindeki durum sayıları |
| GET | `/katilimcilar` | Atanabilir kullanıcılar |
| GET | `/:id` | Yetki kapsamındaki görev |
| POST | `/` | Görev oluşturma |
| PATCH | `/:id` | Sürüm kontrollü güncelleme |

Liste; arama, durum, bana atananlar ve gecikenler filtrelerini birlikte uygular. Durum kartları filtrelerden bağımsız olarak kullanıcının yetkisindeki tüm görevleri sayar. Gecikme hesabı Türkiye tarihine göre yapılır.

## Çalıştırma ve doğrulama

API çalıştırılmadan önce `apps/api` altında Prisma istemcisi üretilmeli ve `20261030090000_platform_gorev_merkezi` dahil bekleyen migration'lar uygulanmalıdır. Tabloya `tekir_app` erişemez; `tekir_platform` rolünün okuma, oluşturma ve güncelleme yetkisi vardır.

Web varsayılan olarak aynı kaynaktaki `/api/v1` yolunu kullanır. Next.js proxy hedefi `API_PROXY_URL` ile değiştirilebilir; varsayılan hedef `http://127.0.0.1:3001` olur. Açıkça verilmiş `NEXT_PUBLIC_API_URL` önceliklidir.

Servis testleri `apps/api/src/mevzuat/platform-gorev.service.test.ts`, tarayıcı testleri `apps/web/e2e/platform-gorev.spec.ts` dosyasındadır. Bildirim e-postası veya zamanlanmış hatırlatma bu modülün mevcut kapsamına dahil değildir.
