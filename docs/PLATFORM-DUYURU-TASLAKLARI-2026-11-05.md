# Platform duyuru taslakları — 5 Kasım 2026

T4 / DY-01 için ilk uygulama teslimidir. Duyuru sistemi tamamlanmış değildir.

Bu belge taslak tesliminin tarihsel kapsamıdır. Sonraki [hedefleme ve yayın teslimi](PLATFORM-DUYURU-HEDEF-VE-YAYIN-2026-11-05.md) yayın, zamanlama, durdurma, tenant merkezi ve ölçüm ekler; güncel kapsam o belgede izlenir.

Platform yöneticisi `/platform/duyurular` üzerinden taslak oluşturur; `/platform/duyurular/[id]` doğrudan açılır. Başlık, düz metin içerik, isteğe bağlı buton metni ve bağlantısı düzenlenir. Önizleme aynı sunucu doğrulamasını kullanır. HTML, çalıştırılabilir URL şemaları, protokolsüz dış bağlantılar, HTTP ve kimlik bilgili adresler reddedilir. Bağlantılar HTTPS veya normalize edildiğinde `/panel` altında kalan uygulama yoludur. React metin çıktısı kullanılır; HTML çalıştırılmaz.

Taslak ve değişiklik geçmişi tek transaction içinde kaydedilir. Satır kilidi ve istemci sürümü eşzamanlı düzenlemede eski taslağın yeni kaydı ezmesini engeller. 409 yanıtında form korunur; güncel kayıt ancak kullanıcı taslağını bırakmayı seçince yüklenir. Arşivleme ayrı onay ister; kaydedilmemiş değişiklik varken kapalıdır. Arşiv veritabanı tetikleyicisiyle değişikliğe kapalıdır. Geçmiş, platform rolü için yalnız eklenebilir ve okunabilir; tenant veritabanı rolü her iki tabloya da erişemez. Fiziksel silme API'si yoktur.

API: liste/oluşturma, detay/düzenleme, `/onizleme`, `/:id/arsiv`, `/:id/gecmis`. Liste ve geçmiş 25 kayıtla sayfalanır. Mevzuat editörüne menü ve API kapalıdır. Migration: `20261105120000_platform_duyuru_taslaklari`.

Doğrulama: 26 birim testi ve gerçek PostgreSQL üzerinde 5 kabul testi geçti. Kabulde tüm migration zinciri geçici veritabanına uygulandı; yarış, arşiv değişmezliği, geçmişin atomik yazımı ve veritabanı rol yetkileri denetlendi. Geçici konteyner kaldırıldı. API TypeScript kontrolü (4 GiB Node heap), web TypeScript kontrolü, Prisma şema doğrulaması ve yeni kaynakların lint kontrolü geçti.

Tarayıcı: izole `playwright.platform.config.ts` ve kurulu Chromium ile 4 benzersiz senaryo doğrulandı. Önizleme/Escape, geçmiş, arşiv onayı ve çakışmada formun korunması ilk koşuda geçti. Yeni taslaktan kalıcı detaya geçiş ve editör yönlendirmesi, ilk rota derlemesini bekleyen süre düzeltmesinden sonra tekrar koşularak geçti. API yanıtları bu tarayıcı testlerinde taklittir; veritabanı davranışı yukarıdaki gerçek PostgreSQL kabulleriyle doğrulandı.

Kalan kapsam: güvenli biçimlendirilmiş içerik ve görsel yükleme, planlı/anlık yayın ve durdurma, hedefleme ve hedef önizlemesi, tenant duyuru merkezi/bant/popup/kart, tekrar ve etkileşim kuralları, raporlama. Bu teslimde yayın ucu yoktur; taslaklar tenantlara gösterilmez.

Mevcut veritabanına migration uygulanmadı; çalışan uygulama yeniden başlatılmadı. Kullanıma almak için standart yayın sürecinde migration, API ve web derlemesi birlikte uygulanmalıdır.
