import { expect, test } from "@playwright/test";

const senaryo = () => ({ id: "k1", ad: "Net ücret kontrolü", girdiler: { brutUcret: 28075.5, primGunu: 30 }, beklenen: { netUcret: 22000 }, tolerans: 0.01, basarili: true as boolean | null, sonSonuc: { basarili: true, alanlar: { netUcret: { beklenen: 22000, hesaplanan: 22000, fark: 0 } } }, sonCalismaZamani: "2026-10-30T08:00:00Z" });
const detay = () => ({
  id: "d1", no: 12, baslik: "Dönem değerleri güncellemesi", dayanak: "Örnek Tebliğ", aciklama: null as string | null, yururlukBaslangic: "2026-11-01", durum: "taslak",
  retGerekcesi: null, yayinZamani: null, hazirlayan: { adSoyad: "Ayşe Yılmaz" }, yayinlayan: null,
  satirlar: [{ tur: "kdv_orani", anahtar: "20", islem: "degistir", deger: { aciklama: "Genel oran" } }], planHatalari: [], etki: { kalemler: [], hesaplanmayan: [] },
  kabulGerekli: true, kabulSenaryolari: [senaryo()], olaylar: [], izinler: { duzenle: true, onayaGonder: true, taslagaCek: false, yayinla: false, geriCevir: false },
});
const davet = (tur = "hesap") => ({ eposta: "editor@example.test", adSoyad: "Yeni Editör", tur, secret: "ORNEK-KURULUM-ANAHTARI", karekod: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/><path d="M10 10h50v50H10zM120 10h50v50h-50zM10 120h50v50H10zM80 80h20v20H80zM120 120h40v40h-40z" fill="black"/></svg>')}` });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-detay-test"));
  await page.route("**/api/v1/platform/**", (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/auth/ben") ? { kullaniciId: "p1", eposta: "ekip@example.test", rol: "yonetici" } : [] }));
});

test("bilgi, kalem ve senaryo kayıtları diğer bölümlerin taslaklarını korur", async ({ page }) => {
  const v = detay();
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1", async (route) => {
    if (route.request().method() === "PATCH") Object.assign(v, route.request().postDataJSON());
    await route.fulfill({ json: v });
  });
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1/satirlar", async (route) => { v.satirlar = route.request().postDataJSON().satirlar; await route.fulfill({ json: v }); });
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1/kabul-senaryolari", async (route) => { v.kabulSenaryolari = route.request().postDataJSON().senaryolar.map((s: object) => ({ ...senaryo(), ...s, basarili: null })); await route.fulfill({ json: v }); });
  await page.goto("/platform/degisiklik?id=d1");
  await page.getByLabel("Başlık", { exact: true }).fill("Yeni dönem düzenlemesi");
  await page.locator("#degisiklik-kalemleri").getByRole("textbox", { name: "Açıklama", exact: true }).fill("Kalem taslağı");
  await page.getByRole("textbox", { name: "Senaryo adı" }).fill("Kaydedilmeyen senaryo");
  await page.getByRole("button", { name: "Bilgileri kaydet" }).click();
  await expect(page.getByText("Bilgiler kaydedildi.")).toBeVisible();
  await expect(page.locator("#degisiklik-kalemleri").getByRole("textbox", { name: "Açıklama", exact: true })).toHaveValue("Kalem taslağı");
  await expect(page.getByRole("textbox", { name: "Senaryo adı" })).toHaveValue("Kaydedilmeyen senaryo");
  await page.getByRole("button", { name: "Kalemleri kaydet" }).click();
  await expect(page.getByText("Kalemler kaydedildi.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Senaryo adı" })).toHaveValue("Kaydedilmeyen senaryo");
  await expect(page.getByRole("button", { name: "Onaya gönder", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Senaryoları kaydet" }).click();
  await expect(page.getByText("Senaryolar kaydedildi.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Onaya gönder", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Başlık", { exact: true })).toHaveValue("Yeni dönem düzenlemesi");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-detay-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-detay-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("detay hatası yeniden denenir, kaydedilmemiş bilgi bağlantı ve çıkışta uyarır", async ({ page }) => {
  let hata = true;
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1", (route) => route.fulfill(hata ? { status: 503, json: { message: "Değişiklik şu anda alınamadı." } } : { json: detay() }));
  await page.goto("/platform/degisiklik?id=d1");
  await expect(page.getByText("Değişiklik şu anda alınamadı.")).toBeVisible();
  await expect(page.getByText("Değişiklik yükleniyor…")).toHaveCount(0);
  hata = false;
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("Henüz kaydedilmedi");
  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("button", { name: "Çıkış", exact: true }).click();
  await expect(page).toHaveURL(/degisiklik\?id=d1$/);
  page.once("dialog", (d) => void d.dismiss());
  await page.locator(".platform-back-link").click();
  await expect(page.getByLabel("Başlık", { exact: true })).toHaveValue("Henüz kaydedilmedi");
  page.once("dialog", (d) => void d.accept());
  await page.locator(".platform-back-link").click();
  await expect(page).toHaveURL(/\/platform$/);
});

test("senaryoda sayısal hata gönderilmez ve Türkçe sayı kayıtta sayıya çevrilir", async ({ page }) => {
  const v = detay();
  let govde: { senaryolar: { girdiler: { brutUcret: number } }[] } | null = null;
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1", (route) => route.fulfill({ json: v }));
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1/kabul-senaryolari", async (route) => { govde = route.request().postDataJSON(); await route.fulfill({ json: v }); });
  await page.goto("/platform/degisiklik?id=d1");
  await page.getByLabel("Brüt ücret", { exact: true }).fill("hatalı");
  await page.getByRole("button", { name: "Senaryoları kaydet" }).click();
  await expect(page.getByText(/Senaryo alanlarına geçerli sayılar/)).toBeVisible();
  expect(govde).toBeNull();
  await page.getByLabel("Brüt ücret", { exact: true }).fill("28.075,50");
  await page.getByRole("button", { name: "Senaryoları kaydet" }).click();
  await expect(page.getByText("Senaryolar kaydedildi.")).toBeVisible();
  expect(govde).toMatchObject({ senaryolar: [{ girdiler: { brutUcret: 28075.5 } }] });
});

test("platform girişinde parola görünürlüğü ve başarısız girişten sonra yeniden deneme çalışır", async ({ page }) => {
  let hata = true;
  let govde: unknown;
  await page.route("**/api/v1/platform/auth/giris", async (route) => { govde = route.request().postDataJSON(); await route.fulfill(hata ? { status: 401, json: { message: "Giriş bilgileri hatalı." } } : { json: { accessToken: "yeni-platform-token" } }); });
  await page.goto("/platform/giris");
  await page.getByLabel("E-posta", { exact: true }).fill("editor@example.test");
  const parola = page.getByLabel("Parola", { exact: true });
  await parola.fill("OrnekParola123");
  await expect(parola).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Parola alanını göster" }).click();
  await expect(parola).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Parola alanını gizle" }).click();
  await page.getByLabel("Doğrulama kodu", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByText("Giriş bilgileri hatalı.")).toBeVisible();
  await expect(parola).toHaveValue("OrnekParola123");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-giris-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-giris-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  hata = false;
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page).toHaveURL(/\/platform$/);
  expect(govde).toEqual({ eposta: "editor@example.test", parola: "OrnekParola123", totpKodu: "123456" });
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_platform_access"))).toBe("yeni-platform-token");
});

test("davet yüklemesi yeniden denenir, anahtar adresten silinir ve kurulum sonunda karekod kaldırılır", async ({ page }) => {
  let hata = true;
  let govde: unknown;
  let tamamlandi = 0;
  await page.route("**/api/v1/platform/auth/davet/bilgi", (route) => route.fulfill(hata ? { status: 503, json: { message: "Davet alınamadı." } } : { json: davet() }));
  await page.route("**/api/v1/platform/auth/davet/tamamla", async (route) => { govde = route.request().postDataJSON(); tamamlandi++; await route.fulfill({ json: {} }); });
  await page.goto("/platform/davet?anahtar=ornek-anahtar");
  await expect(page.getByText("Davet alınamadı.")).toBeVisible();
  await expect(page).toHaveURL(/\/platform\/davet$/);
  hata = false;
  await page.getByRole("button", { name: "Bağlantıyı yeniden dene" }).click();
  await expect(page.getByRole("heading", { name: "Hesabınızı oluşturun", exact: true })).toBeVisible();
  await page.getByLabel("Parola (en az 10 karakter, harf ve rakam)", { exact: true }).fill("OrnekParola123");
  await page.getByLabel("Parola (tekrar)", { exact: true }).fill("BaskaParola123");
  await page.getByLabel("Uygulamadaki doğrulama kodu").fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await expect(page.getByText("Parolalar birbirini tutmuyor.")).toBeVisible();
  expect(tamamlandi).toBe(0);
  await page.getByLabel("Parola (tekrar)", { exact: true }).fill("OrnekParola123");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-davet-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await expect(page.getByRole("heading", { name: "Kurulum tamamlandı", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "İki adımlı doğrulama karekodu" })).toHaveCount(0);
  expect(govde).toEqual({ anahtar: "ornek-anahtar", parola: "OrnekParola123", kod: "123456" });
});

test("2FA yeniden kurulumunda mevcut parola kullanılır ve eksik davet açık hata gösterir", async ({ page }) => {
  await page.goto("/platform/davet");
  await expect(page.getByText(/Bağlantı eksik/)).toBeVisible();
  await page.route("**/api/v1/platform/auth/davet/bilgi", (route) => route.fulfill({ json: davet("iki_adim") }));
  await page.route("**/api/v1/platform/auth/davet/tamamla", (route) => route.fulfill({ status: 400, json: { message: "Parola hatalı." } }));
  await page.goto("/platform/davet?anahtar=yeniden-kurulum");
  await page.getByLabel("Mevcut parolanız", { exact: true }).fill("OrnekParola123");
  await expect(page.getByLabel("Parola (tekrar)", { exact: true })).toHaveCount(0);
  await page.getByText("Karekodu okutamıyor musunuz?", { exact: true }).click();
  await expect(page.getByLabel("Elle kurulum anahtarı")).toHaveValue("ORNEK-KURULUM-ANAHTARI");
  await page.getByLabel("Uygulamadaki doğrulama kodu").fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await expect(page.getByText("Parola hatalı.")).toBeVisible();
  await expect(page.getByRole("img", { name: "İki adımlı doğrulama karekodu" })).toBeVisible();
});
