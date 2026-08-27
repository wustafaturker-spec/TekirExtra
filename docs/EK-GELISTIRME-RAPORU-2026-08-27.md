# TekirExtra Ek Geliştirme Raporu

Tarih: 27 Ağustos 2026

## Yönetici özeti

TekirExtra'nın çok kiracılık, finans, e-belge, stok, üretim, personel ve entegrasyon omurgası güçlüdür. İncelemede 41 controller, 46 servis, 92 web sayfası ve 91 migration tespit edilmiştir. API, web ve ortak paketlerde birim testleri; ayrıca kritik kullanıcı akışları için Playwright E2E altyapısı bulunmaktadır.

Son eklenen gelir ve proje özellikleri üretime alınmadan önce migration/RLS, rol yetkilendirmesi ve proje finans hesaplarının doğruluğu tamamlanmalıdır.

## Tamamlanan P0/P1 çalışmaları

1. Gelir/proje migration ve RLS politikaları oluşturuldu; tam migration zinciri boş veritabanında doğrulandı.
2. Gelir ve proje API'lerinde okuma/yazma rolleri sınırlandırıldı.
3. Proje kârlılığındaki çift sayım kaldırıldı; tahakkuk ve nakit özetleri ayrıldı.
4. Gelir/proje testleri, seçenek endpoint'i, ortak Zod 400 yanıtı ve rol bazlı panel menüsü eklendi.
5. Redis tabanlı dağıtık rate limiting, bellek yedeği ve standart limit başlıkları eklendi.
6. JSON/form gövde limiti 2 MB'a indirildi; eklerde MIME yanında dosya imzası doğrulaması eklendi.
7. API güvenlik başlıklarına CSP ve Cross-Origin-Resource-Policy eklendi.
8. Stok/cari XLSX aktarımları ve banka CSV/TXT ekstreleri uzantı + içerik imzasıyla doğrulanır hale getirildi.
9. Giriş, faturasız gelir tahsilatı, kasa ödeme fişi, proje oluşturma ve rol kısıtı Playwright senaryoları eklendi.
10. Beklenen HTTP 4xx kayıtları uyarı, beklenmeyen 5xx kayıtları hata seviyesine ayrıldı.
11. Access token kalıcı `localStorage` alanından sekme ömürlü `sessionStorage` alanına taşındı; eski tokenlar otomatik taşınıp kalıcı kopyaları siliniyor.
12. Rol yüklenmeden panel alt içeriğinin çalışması engellendi; yetkisiz doğrudan yönetim rotası E2E ile doğrulandı.

## Kalan P1 — Yüksek öncelikli işler

1. İstemci layout'u rol yüklenene kadar alt içeriği kapatmaktadır. Savunmayı güçlendirmek için yetkisiz rotalar ayrıca sunucu/middleware katmanında kesilmelidir.
2. E2E kapsamı tahsilat/ödeme ve gelir için eklendi; silme/iptal ve API hata geri kazanım senaryolarıyla genişletilmelidir.

## P2 — Teknik sürdürülebilirlik

1. Büyük istemci sayfaları veri hook'ları, form ve sunum bileşenlerine ayrılmalıdır.
2. Access token artık sekme ömürlü depodadır; JavaScript erişimini tamamen kaldırmak için HttpOnly cookie/BFF oturum modeli tasarlanmalıdır.
3. Access token bellek veya HttpOnly cookie modeline taşınırken mevcut doğrudan indirme/yükleme akışları uyarlanmalıdır.
4. Dosya yüklemelerinde zararlı yazılım taraması ve arşiv içi içerik denetimi üretim depolama akışına eklenmelidir.
5. Backend geliştirme komutu watch/hot-reload desteklemelidir.
6. CI sırasına migration deploy/drift, lint, typecheck, test, production build, Playwright ve container health kontrolleri eklenmelidir.

## Ürün geliştirme adayları

- Nakit ve tahakkuk esaslı rapor görünümleri
- Proje bütçe revizyon geçmişi ve onay akışları
- Dönem kapatma ve kapalı döneme kayıt engeli
- Kur farkı muhasebeleştirme fişleri
- Gelir kayıtlarında belge eki ve toplu aktarım
- Muhasebe fişi/yevmiye altyapısı
- Kullanıcıya özel dashboard, bildirim ve görev yönetimi
- Mobil kullanım ve erişilebilirlik iyileştirmeleri
- Yedek geri-yükleme ve felaket kurtarma tatbikatları

## Uygulama sırası

1. Migration ve RLS
2. Gelir/proje yetkilendirmesi
3. Proje finans hesapları
4. Yeni modül testleri
5. Proje sorumlusu endpoint'i
6. Rol bazlı menü ve 403 deneyimi
7. Temiz veritabanında kabul ve production build
8. Frontend E2E testleri
9. Frontend bileşenlerinin kademeli ayrıştırılması
10. CI/CD kalite kapıları
