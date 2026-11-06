# Duyuru sistemi — gerçek HTTP ve tarayıcı kabulü

6 Kasım 2026: pilotta çalışan üretim paketlerinin izole kopyalarıyla, 1440 × 900 ve 390 × 900 boyutlarında iki uçtan uca akış geçti. İş API yanıtları taklit edilmedi. Mevcut pilot paketi, verisi veya kullanıcı hesapları değiştirilmedi.

## Doğrulanan paketler

- API runtime: `.release-candidates/duzeltme-tarama-20261106/runtime`
- Web paketi: `.release-candidates/toplu-fatura-20261106/web`
- Web build ID: `j9vozHENuBWTxhTsztvBB`
- Başarılı koşu: `.release-candidates/platform-duyuru-design-20261106/http-kabul-05d81d6aa2`

Kabul hazırlanırken pilotun başka bir çalışmayla yeni paketlere geçtiği görüldü. Önceki duyuru tasarım paketiyle geçen kabulün ardından yukarıdaki güncel paketlerle de iki akış tekrarlandı. Diğer yayına müdahale edilmedi. Duyuru servisleri ve şemalarının derlenmiş kod özetleri iki API paketinde de aynıydı.

## Her iki ekran boyutunda geçen akış

1. Geçici platform hesabıyla gerçek parola ve TOTP doğrulaması üzerinden giriş.
2. Tarayıcıdan taslak oluşturma ve kalıcı detay adresine geçiş.
3. PNG yükleme, ayrı MinIO deposuna kaydetme, imzalı görsel adresinden görseli gerçekten çözümleme/görüntüleme.
4. Yönlendirme düğmesi ekleme ve taslağı kaydetme.
5. Seçili firma hedefleme; merkez, üst bant, popup ve genel panel modül kartını seçme; gerçek önizlemede 1 firma / 1 kullanıcı doğrulama ve ayrı yayın onayı.
6. Hedef firma hesabıyla giriş, popup'ı bir saat erteleme ve yenilemede ertelemenin korunması.
7. Merkezde okudum kaydı, yenilemede okunma durumunun korunması ve yönlendirme düğmesinin çalışması.
8. Panelde modül kartı ve üst bant gösterimi.
9. Hedef dışındaki başka firma hesabının doğrudan detay API'sinden 404 alması ve duyuruyu ekranda görememesi.
10. Gerçek raporda hedef firma, hedef kullanıcı, benzersiz gösterim, okudum, tıklama ve popup erteleme değerlerinin ayrı ayrı 1 olması.
11. Platformdan ayrı onayla yayını durdurma; hedef firmada içeriğin kaldırılması ve doğrudan API erişiminin 404 dönmesi.
12. Platform ekranında yatay taşma olmaması.

## İzolasyon ve tekrar çalıştırma

```sh
node apps/api/scripts/duyuru-http-tarayici-kabul.mjs \
  .release-candidates/duzeltme-tarama-20261106/runtime \
  .release-candidates/toplu-fatura-20261106/web
```

Her koşu ayrı PostgreSQL, Redis, MinIO ve API konteynerleri ile ayrı bir üretim web süreci açar. Tüm migration zinciri yalnız geçici DB'ye uygulanır. Parolalar, oturum/JWT ve şifreleme anahtarları rastgele üretilir. Platform için test hesabı ve iki firma/kullanıcı yalnız bu DB'de oluşturulur. Gerçek giriş uçları kullanılır; token veya oturum işareti elle üretilmez.

Tarayıcı yerel test proxy'sine bağlanır. Proxy istekleri gerçek API veya üretim web sürecine iletir; yanıt üretmez. Tarayıcının test adresi dışına istekleri engellenir. Koşucu localhost üzerindeki Secure çerezleri tarayıcı içinde kullanır ve giriş tamamlanmasını sorgu parametresinden değil gerçek sayfa yolundan doğrular.

Disk yoğunluğunun etkisini azaltmak için tek kullanımlık test PostgreSQL'i tmpfs ve kalıcılık garantisi aranmayan test ayarlarıyla açılır. Bu koşu veritabanı çökme/kurtarma provası değildir. Antivirüs motoru bu koşuda yapılandırılmadı; görsel kabulü MIME/içerik doğrulaması, S3 yükleme ve imzalı sunumu kapsar.

Başarılı koşu sonunda bütün geçici konteynerler, ağ ve web süreci kaldırıldı. Pilot API, web ve iki worker sağlıklı kaldı. İşletmenin gerçek pilot hesaplarıyla manuel kullanıcı kabulü ve geniş DY planının diğer açık maddeleri ayrıca izlenir.

Kanıtlar: koşu dizinindeki `sonuc.json`, `paket-kaniti.json`, `platform-1440.png` ve `platform-390.png`. Koşucu hazırlığındaki başarısız denemeler kendi ayrı koşu dizinlerinde korunur; başarılı kabul sayısına dahil edilmez.
