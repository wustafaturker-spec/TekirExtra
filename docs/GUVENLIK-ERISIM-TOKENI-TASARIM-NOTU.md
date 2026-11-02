# Erişim token'ının sessionStorage'dan çıkarılması — tasarım notu (SEC-14)

Tarih: 2026-11-02. Durum: **karar bekliyor, uygulanmadı.**

## Özet

- Öneri: erişim token'ını aynı origin üzerinden HttpOnly çereze taşımak (seçenek B). Next zaten `/api/v1`'i
  API'ye aktardığı için ayrı bir BFF katmanı gerekmez.
- Sıralama: önce CSP'deki `script-src 'unsafe-inline'` nonce ile kaldırılmalı. XSS'i önleyen adım odur; çerez
  modeli yalnız token'ın dışarı taşınmasını engeller.
- Değişiklik bütün oturum akışına dokunur, bu yüzden tek başına ve ayrı bir yayınla çıkmalı.

## Bugünkü durum

| Parça | Nerede | Ömür |
| --- | --- | --- |
| Firma erişim token'ı (JWT) | sessionStorage `tekir_access` (`apps/web/src/lib/api.ts`) | 15 dk |
| Yenileme token'ı | HttpOnly çerez `tekir_refresh`, SameSite=Lax, yol `/api/v1/auth` | politika (varsayılan 30 gün), her yenilemede döner |
| Rota koruması işareti | HttpOnly çerez, yol `/` | kısa; veri koruması değildir |
| Platform token'ı | sessionStorage `tekir_platform_access` (`platform-api.ts`) | 30 dk, yenileme yok |
| Destek token'ı | `/destek#t=…` → sessionStorage, yalnız o sekme | destek oturumu kadar |

API yalnız `Authorization: Bearer` okur (`auth.guard.ts`). Bu yüzden bugün CSRF yüzeyi yoktur: tarayıcı başlığı
kendiliğinden eklemez. `tkx_` MCP anahtarları ve banka webhook'u da başlıkla ya da kendi anahtarıyla çalışır.

## Kapatılmak istenen risk

Sayfada betik çalışırsa sessionStorage'daki token okunup dışarı taşınabilir. Gelen e-posta HTML'i bu yolla
kullanılabiliyordu; SEC-01 temizleme ekledi, SEC-10 `connect-src 'self'` ile dışarıya `fetch`'i kısıtladı. Yine de
`script-src 'unsafe-inline'` duruyor ve CSP her dışarı taşıma yolunu kapatmaz (örneğin görsel adresi: `img-src https:`).

**Çerezin sağlamadığı:** XSS engellenmez. Betik, sayfa açıkken kullanıcı adına API çağırmayı sürdürür.
Kazanç yalnız token'ın sayfa kapandıktan sonra başka yerden kullanılamamasıdır. Bu nedenle öncelik CSP'dedir.

**Asıl boşluk `/auth/yenile`:** uç, erişim token'ını yanıt gövdesinde döner. Betik `credentials: "include"` ile
çağırıp taze token alabilir. Gövdeden token kaldırılmadan depolama yeri değiştirmek (bellekte tutma dahil) bu
riski kapatmaz.

## Seçenekler

| | A. Yalnız bellekte tutmak | B. HttpOnly erişim çerezi (öneri) | C. Tam BFF (oturum Next'te) |
| --- | --- | --- | --- |
| Token betikten okunur mu | Evet (`/auth/yenile` gövdesi) | Hayır | Hayır |
| CSRF önlemi gerekir mi | Hayır | Evet | Evet |
| Sayfa yenilemede ek istek | Evet | Hayır | Hayır |
| Değişiklik büyüklüğü | Küçük | Orta | Büyük: yeni oturum deposu, SSE ve dosya akışlarının vekillenmesi |
| Değerlendirme | Asıl riski kapatmıyor | Aynı origin yapısına oturuyor | B'nin üzerine ek kazancı bu risk için yok |

## Seçenek B'nin tasarımı

1. **Çerez:** `tekir_access`, HttpOnly, SameSite=Lax, üretimde Secure, yol `/api/v1`, ömür 15 dk.
   `/auth/giris` ve `/auth/yenile` yazar, `/auth/cikis` siler.
2. **Guard:** önce `Authorization` başlığına, yoksa çereze bakar. MCP, destek ve dış istemciler etkilenmez.
3. **Gövde:** `/auth/giris` ve `/auth/yenile` artık `accessToken` dönmez (geçiş sırasında bkz. Geçiş).
4. **CSRF:** yalnız çerezle kimliği doğrulanan yazma isteklerinde `Origin` (yoksa `Referer`) `APP_URL` ile
   eşleşmelidir; ek olarak `X-Tekir-Istek: 1` başlığı zorunlu olur. Bearer istekleri bu denetime girmez.
5. **Web:** `tokenAl()` 62 dosyada 94 kez çağrılıyor; çoğu "oturum var mı" denetimi, oturum işaretine dönüşür.
   Elle `Bearer` ekleyen 6 sayfa/bileşen (banka bağlantıları, firma, belgeler, stok ×2, MCP anahtarları) ortak istemciye taşınır.

### Çözülmesi gereken noktalar

- **Destek sekmesi:** sekme yalıtımına dayanıyor; çerez bütün sekmelerde ortak olduğundan firma oturumunun üstüne
  yazar. Destek token'ı Bearer ve sessionStorage'da kalmalı. Kısa ömürlü ve salt okunur olduğu için kabul edilebilir.
- **Platform paneli:** ayrı çerez adı ve `/api/v1/platform` yolu. Firma çereziyle karışmaması test edilmeli.
- **Sekmeler arası yenileme yarışı:** yenileme token'ı tek kullanımlık. Ortak çerezle bütün sekmelerin token'ı aynı
  anda dolar, iki sekmenin eşzamanlı yenilemesinde kaybeden 401 alıp girişe düşebilir. Kısa bir tolerans penceresi
  ya da `navigator.locks` ile sekmeler arası kilit gerekir. Bu yarış bugün de mümkün görünüyor; denenmedi.
- **SameSite=Lax ve GET:** dış siteden gelen üst düzey GET gezintisinde çerez gönderilir. Durum değiştiren oturumlu
  GET ucu kalmadığı taranmalı.
- **`NEXT_PUBLIC_API_URL`:** farklı bir origin'e ayarlı kurulumda çerez çalışmaz. Dağıtımların aynı origin olduğu doğrulanmalı.
- **`Authorization` bekleyen okuyucular:** `destekBaslat` token'ı başlıktan okuyor; sınır ve günlük katmanları taranmalı.

## Geçiş

Eski sekmelerin bozulmaması için iki yayın:

1. API her iki yolu kabul eder ve çerezi yazar; gövdede token sürer. Web çereze geçer.
2. En az bir erişim token'ı ömrü ve açık sekmelerin yenilenmesi için makul süre sonra gövdeden token kaldırılır,
   sessionStorage temizliği eklenir.

Geri dönüş birinci aşamada zararsızdır: eski web paketi Bearer ile çalışmayı sürdürür.

## Test kapsamı

- Betik `tekir_access`'e ulaşamaz; `/auth/yenile` gövdesinde token yoktur.
- Dış `Origin` ile yazma 403; aynı origin geçer; Bearer istemciler ve MCP etkilenmez.
- Firma + destek sekmesi aynı tarayıcıda birbirini bozmaz; firma + platform aynı.
- İki sekme aynı anda yenilerken oturum düşmez.
- Mevcut e2e akışları, SSE asistan ve dosya indirme/yükleme.

## Karar

1. `script-src` nonce çalışması: yapılacak mı, seçenek B'den önce mi?
2. Seçenek B: uygulanacak mı, hangi yayında?
