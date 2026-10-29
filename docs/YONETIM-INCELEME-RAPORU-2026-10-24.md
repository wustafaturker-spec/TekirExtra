# Firma İçi Yönetim İnceleme Raporu

**Tarih:** 24 Ekim 2026
**Durum (2026-10-29):** P0–P3 kapandı. P0–P2 pilotta canlı denendi (yonetim-20261024); P3, KLN-20…23 isterleriyle kodlandı (af7cb44, a7322f1, e7c0284).
**İnceleme türü:** Kod okuma + pilot API'de (3001) canlı deneme. Demo kiracıda (TEKİR EKTRA ÖN MUHASEBE)
yalnız okuma ve yetkisiz yazma denemesi yapıldı (403 gövde işlenmeden döner, veri değişmez); roller
`muhasebe@`, `depo@` ve `admin@tekirextra.local` ile denendi. Kod değişikliği yapılmadı.
**Kapsam:** Ayarlar altındaki 25 ekran, kullanıcı ve rol yönetimi, oturum/kimlik güvenliği, iki adımlı
doğrulama, abonelik sınırları, denetim izi, web menü yetkileri ile API rol korumasının uyumu.
Platform paneli (tüm firmaları yöneten ekip ekranı) bu incelemenin dışında; ayrıca ele alınacak.
**Dosyalar:** `apps/web/src/app/panel/ayarlar/*`, `apps/web/src/lib/{rol-yetkileri,menu}.ts`,
`apps/api/src/auth/*`, `apps/api/src/tenant/{kullanicilar.controller,abonelik.service,parola.service}.ts`,
`apps/api/src/core/audit.interceptor.ts`, `apps/api/src/main.ts` (hız sınırı).

## 1. Özet

Temel sağlam: Ayarlar ekranlarının çağırdığı 66 yazma ucunun hepsi API'de var ve hepsi doğru rolle
korunuyor (yalnız kişisel ayarlar — kendi bildirimi, parolası, 2FA'sı — her role açık; bu doğru).
Kiracı yalıtımı (RLS) bu alanda da eksiksiz; asistanın ve MCP'nin yönetim uçlarına erişen aracı yok.
Bugün parola yönetimi (KLN-10…13) eklendi.

Asıl sorunlar **güvenilirlik** ve **kurtarılabilirlik**:

1. **İzin Matrisi sahte.** "İzin Matrisini Kaydet" *"başarıyla güncellendi ve kaydedildi"* diyor; hiçbir
   yere kaydetmiyor, hiçbir şeyi kısıtlamıyor. Yönetici kısıtladığını sanıyor.
2. **Firma yöneticisiz kalabilir.** Yönetici kendi rolünü düşürebiliyor, son yöneticinin rolü
   değiştirilebiliyor; geri dönüş yalnız veritabanından.
3. **İki adımlı doğrulama kaybedilirse hesap kalıcı kilitlenir.** Telefonunu kaybeden kullanıcının
   2FA'sını ne kendisi ne yönetici kapatabiliyor.
4. **Yetki geri alma gecikmeli, denetim izi içeriksiz.** Pasife alınan ya da rolü düşürülen kullanıcı
   15 dakika eski yetkisiyle çalışmaya devam ediyor; denetim izi "kullanıcı X güncellendi" diyor ama
   neyin değiştiğini yazmıyor (9.139 kaydın 8.681'i içeriksiz).

## 2. Durum

| Öncelik | Madde | Durum |
|---|---|---|
| P0-1 | İzin Matrisi kaydetmiyor ve uygulanmıyor | ✅ bf01543 — salt okunur "Rol Yetkileri" |
| P0-2 | Son yönetici koruması yok | ✅ 40e3417 |
| P1-1 | 2FA kurtarma/sıfırlama yolu yok | ✅ 082ceee — kurtarma kodları, kendi kapatma, yönetici sıfırlama |
| P1-2 | Pasife alma ve rol düşürme 15 dk gecikmeli; parola değişiminde de erişim token'ı yaşar | ✅ dbc0b77 — en geç 10 sn |
| P1-3 | Hesap başına giriş/2FA deneme sınırı yok | ✅ dbc0b77 — 10 parola / 5 kod, 15 dk |
| P1-4 | Yetki değişikliklerinin denetim izi içeriksiz (KLN-04) | ✅ 40e3417 + c3d6de1 |
| P1-5 | Giriş ekranında herkese açık, çalışmayan "Hızlı Demo Giriş" | ✅ bf01543 — kaldırıldı |
| P2-1 | Menü yetkileri ile API rolleri uyumsuz (muhasebe banka çekimi yapamıyor, E-posta Ayarları 403) | ✅ 971ff70 |
| P2-2 | "Aktif Et" abonelik kullanıcı sınırını aşıyor | ✅ 40e3417 |
| P2-3 | Yeni kullanıcıyı davetle açma yok; yönetici parolayı yazıp iletiyor | ✅ 971ff70 |
| P2-4 | Giriş kaydı / son giriş zamanı / aktif oturumlar yok | ✅ c3d6de1 |
| P3-1 | Gerçek, düzenlenebilir yetki modeli (modül × işlem) | ✅ af7cb44 KLN-20 — özel roller: şablondan türetilir, yalnız daraltır (18 modül × 4 işlem); API, menü ve asistan aynı kaynaktan |
| P3-2 | Firma geneli güvenlik politikası (2FA zorunluluğu, oturum süresi) | ✅ a7322f1 KLN-21/22 — rol bazında zorunlu 2FA, oturum süresi, hareketsizlikte çıkış |
| P3-3 | Küçük kullanım sorunları (onaysız rol değişikliği, 2FA'da karekod yok) | ✅ e7c0284 KLN-23 — rol değişikliği onayı, 2FA karekodu, doğrulamalı e-posta değiştirme |

## 3. Bulgular

### P0-1 İzin Matrisi sahte

`/panel/ayarlar/izinler` (Kullanıcılar → İzin Matrisi) API çağırmıyor: matris sayfaya gömülü bir
sabitten geliyor, "Kaydet" yalnız `setBasari("... başarıyla güncellendi ve kaydedildi.")` çalıştırıyor.
Sayfa yenilenince değişiklik kayboluyor; API'de karşılığı yok. Gösterdiği roller (6 rol) ve kurallar
gerçek kurallarla da örtüşmüyor (gerçekte 13 rol var; kurallar `@Roller` etiketlerinde ve
`rol-yetkileri.ts`'de).

Bugün düzeltilen "Şifremi unuttum" uyarısıyla aynı sınıf: çalışıyormuş gibi görünen ekran.

**Öneri:** Hemen (küçük iş) ekranı **salt okunur "Rol yetkileri" özetine** çevir: gerçek kurallardan
üretilsin, "Kaydet" düğmesi kalksın, rolü değiştirmek için Kullanıcılar ekranına yönlendirsin.
Düzenlenebilir matris P3-1'de.

### P0-2 Son yönetici koruması yok

`PATCH /kullanicilar/:id` yalnız "kendi hesabını pasife alma"yı engelliyor. Şunlar serbest:
- yöneticinin **kendi rolünü** `satis`'e düşürmesi,
- iki yöneticiden birinin diğerini pasife alıp sonra kendi rolünü düşürmesi,
- son aktif yöneticinin başka bir yönetici tarafından pasife alınması/rolünün değiştirilmesi.

Sonuç: firmada yönetici kalmaz; kullanıcı, ayar, abonelik ekranlarına kimse giremez. Kurtarma yalnız
veritabanı müdahalesiyle.

**Öneri:** Sunucuda tek kural: işlem sonunda firmada **en az bir aktif yönetici** kalmalı (rol değişimi
ve pasife almada, aynı işlem içinde sayılarak). Ekranda kendi rol seçicisi kilitli.

### P1-1 2FA kurtarma yolu yok

`totp/kur` 2FA etkinse "zaten etkin" diyor; kapatma ucu yok; Kullanıcılar ekranı 2FA'yı yalnız
gösteriyor. Telefonunu kaybeden ya da değiştiren kullanıcı bir daha giremiyor (parola sıfırlama
2FA'yı aşmıyor — doğru olan da bu).

**Öneri:** (a) Yönetici başka kullanıcının 2FA'sını sıfırlayabilsin (denetim izine yazılsın, oturumları
kapansın); (b) kullanıcı mevcut kodla kendi 2FA'sını kapatabilsin/yeniden kurabilsin; (c) kurulumda
tek kullanımlık **kurtarma kodları** verilsin (yönetici kendi 2FA'sını kaybederse diğer yöneticiye
bağımlı kalmasın).

### P1-2 Yetki geri alma gecikmeli

Erişim token'ı (JWT, 15 dk) yalnız imzayla doğrulanıyor; guard kullanıcının hâlâ aktif olup olmadığına,
rolünün değişip değişmediğine bakmıyor. Yenileme (`/auth/yenile`) aktifliği denetlediği için en geç
15 dakikada kesiliyor. Etkisi:
- işten çıkarılıp pasife alınan kullanıcı 15 dakika daha fatura kesebilir, veri çekebilir;
- rolü `yonetici`'den düşürülen kullanıcı 15 dakika yönetici kalır;
- parola sıfırlamada (KLN-13) da elde kalan token 15 dakika yaşar.

**Öneri:** Kullanıcıya `oturumSurumu` (sayaç) ekle, token'a koy; pasife alma, rol değişimi, parola ve
2FA değişiminde artır; guard sürümü karşılaştırsın (Redis'te kısa önbellekle, her istekte DB sorgusu
olmadan).

### P1-3 Hesap başına deneme sınırı yok

Tek sınır IP başına dakikada 300 istek (`main.ts`). Hesap başına sayaç yok: aynı hesaba farklı
IP'lerden ya da dakikada 300 deneme yapılabilir; 2FA kodu (6 hane) için de aynı. Başarısız girişler
denetim izine ya da kullanıcıya yansımıyor.

**Öneri:** E-posta başına başarısız deneme sayacı (Redis): ör. 10 hatada 15 dk bekleme, 2FA için ayrı
5 hata sınırı; kilitlenince kullanıcıya e-posta bildirimi. Mesajlar hesap varlığını sızdırmamalı.

### P1-4 Denetim izi içeriksiz

`AuditInterceptor` her mutasyonu "YÖNTEM /yol" olarak yazıyor, gövdeyi (doğru olarak) yazmıyor; ama
hiçbir yer neyin değiştiğini eklemiyor. Canlı veride: 9.139 kaydın 8.681'inde `detay` boş;
`PATCH /api/v1/kullanicilar/<id>` kaydından rolün mü, aktifliğin mi, iskonto sınırının mı değiştiği
anlaşılmıyor. KLN-04 yetki değişikliğinin "ne yaptı" bilgisini istiyor.

**Öneri:** Yönetim işlemlerinde (kullanıcı rol/aktif/iskonto/bayi, firma, e-belge/e-posta/banka
bağlantısı, modül ayarları, abonelik) adlandırılmış olay + **eski → yeni** değerler (sırlar maskeli).
Denetim İzi ekranında bu ayrıntı ve dışa aktarma.

### P1-5 Herkese açık demo giriş düğmeleri

Giriş ekranı her ortamda "Hızlı Demo Giriş: Yönetici / Muhasebe" gösteriyor ve
`admin@tekirextra.com / 123456` ile giriş deniyor. Bu hesaplar yok (gerçek demo hesabı
`@tekirextra.local`), düğmeler hata veriyor; üretimde de görünecekler.

**Öneri:** Kaldır ya da yalnız geliştirme/demo ortamında (açık bir ortam bayrağıyla) göster.

### P2-1 Menü yetkileri ile API rolleri uyumsuz

Kurallar iki yerde elle tutuluyor (web `rol-yetkileri.ts`, API `@Roller`) ve kaymış:

| Rol | Ekran | Web | API | Sonuç |
|---|---|---|---|---|
| muhasebe | E-posta Ayarları | görür | okuma da yazma da 403 | Sayfa kırık |
| muhasebe | Banka Bağlantıları (hesap eşleme, "Senkronize et", otomatik çekim) | göremez | yetkili | Muhasebe banka hareketini elle çekemiyor |
| muhasebe | Depolar, Döviz Kurları | göremez | yetkili | İşi yalnız yönetici yapabiliyor |
| satış | Araçlar ve Şoförler | göremez | yetkili | Kullanılmayan yetki |

**Öneri:** Kısa vadede tabloyu düzelt (her satır için karar: ekranı aç ya da API'yi daralt). Kalıcı
çözüm P3-1: tek kaynaktan yetki.

### P2-2 "Aktif Et" kullanıcı sınırını aşıyor

`limitDogrula("kullanici")` yalnız yeni kullanıcı eklenirken çalışıyor; pasif kullanıcıyı "Aktif Et"
(`PATCH aktif: true`) sınırı saymıyor. Başlangıç planında (3 kullanıcı) 3 aktif kullanıcıyla bir
kişi pasife alınıp yeni kişi eklenir, sonra eski kişi aktif edilirse 4 aktif kullanıcı olur.

**Öneri:** Aktif etmede ve rolü `calisan`'dan çıkmayan değişikliklerde aynı sınır denetimi.

### P2-3 Davetle kullanıcı açma yok

Yönetici yeni kullanıcının parolasını kendisi yazıp iletmek zorunda; parola yöneticide kalıyor ve
kullanıcı değiştirmeye zorlanmıyor. Çalışan self-servisinde (PRS-21) davet altyapısı zaten var.

**Öneri:** "Davet gönder": e-postaya tek kullanımlık "parolanı belirle" bağlantısı (KLN-12 altyapısı);
yönetici parolası seçeneği istenirse "ilk girişte değiştir" işaretiyle kalır.

### P2-4 Giriş görünürlüğü yok

Başarılı/başarısız giriş kaydı, kullanıcı listesinde "son giriş", "aktif oturumlarım" ve "tüm
cihazlardan çıkış" yok. Platform kullanıcılarında `sonGiris` var, firma kullanıcılarında yok.

**Öneri:** `sonGirisAt` + giriş olayları (denetim izi), Hesap Güvenliği'nde oturum listesi ve tek tek /
toplu kapatma, yöneticiye kullanıcının oturumlarını kapatma.

### P3-1 Düzenlenebilir yetki modeli

13 sabit rol yeterli değilse: firma bazında modül × işlem (görüntüle, oluştur, düzenle, onayla,
dışa aktar) matrisi; API guard'ı, web menüsü ve asistan araç süzgeci aynı kaynaktan okur. Büyük iş;
P0-1/P2-1 sonrası, gerçek ihtiyaç görülürse.

### P3-2 Firma güvenlik politikası

Yöneticinin seçebileceği: belirli rollerde 2FA zorunlu, oturum süresi, hareketsizlikte çıkış.

### P3-3 Küçük kullanım sorunları

- Kullanıcılar ekranında rol açılır listesi değişince **onay sormadan** kaydediyor.
- 2FA kurulumunda karekod yok; gizli anahtar ve `otpauth` adresi metin olarak gösteriliyor.
- Kullanıcının e-posta adresi değiştirilemiyor (hesap yeniden açılmalı).

## 4. İyi çalışanlar

- 66 yönetim yazma ucunun tamamı doğru rolle korunuyor; yetkisiz istek gövde işlenmeden 403.
- Ayarlar ekranlarının çağırdığı her uç API'de mevcut (kırık adres yok).
- Denetim izi gövde kaydetmiyor (parola sızıntısı yok); Denetim İzi ekranı yalnız yöneticiye açık.
- Asistan/MCP yönetim uçlarına erişemiyor.
- Kullanıcı ekleme abonelik sınırını ve e-posta tekilliğini denetliyor; çalışan hesabı rolü korunuyor.
- Parola yönetimi (KLN-10…13) bugün tamamlandı ve canlıda denendi.

## 5. Önerilen sıra

1. **P0-1 + P1-5** — sahte ekran ve demo düğmeleri (küçük, hemen).
2. **P0-2** — son yönetici koruması (küçük).
3. **P1-1** — 2FA sıfırlama + kurtarma kodları.
4. **P1-2 + P1-3** — anında yetki geri alma, deneme sınırı.
5. **P1-4 + P2-4** — anlamlı denetim izi, giriş görünürlüğü.
6. **P2-1, P2-2, P2-3** — rol uyumu, sınır açığı, davet.
7. **P3** — karar sonrası.
