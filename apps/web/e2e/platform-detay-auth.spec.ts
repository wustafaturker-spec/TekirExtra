import { expect, test } from "@playwright/test";

const senaryo = () => ({ id: "k1", ad: "Net ücret kontrolü", girdiler: { brutUcret: 28075.5, primGunu: 30 }, beklenen: { netUcret: 22000 }, tolerans: 0.01, basarili: true as boolean | null, sonSonuc: { basarili: true, alanlar: { netUcret: { beklenen: 22000, hesaplanan: 22000, fark: 0 } } }, sonCalismaZamani: "2026-10-30T08:00:00Z" });
const detay = () => ({
  id: "d1", no: 12, baslik: "Dönem değerleri güncellemesi", dayanak: "Örnek Tebliğ", aciklama: null as string | null, yururlukBaslangic: "2026-11-01", durum: "taslak",
  retGerekcesi: null, yayinZamani: null, hazirlayan: { adSoyad: "Ayşe Yılmaz" }, yayinlayan: null,
  satirlar: [{ tur: "kdv_orani", anahtar: "20", islem: "degistir", deger: { aciklama: "Genel oran" } }], planHatalari: [], etki: { kalemler: [], hesaplanmayan: [] },
  kabulGerekli: true, kabulSenaryolari: [senaryo()], olaylar: [], izinler: { duzenle: true, onayaGonder: true, taslagaCek: false, yayinla: false, geriCevir: false },
  surum: 1,
});
const davet = (tur = "hesap") => ({ eposta: "editor@example.test", adSoyad: "Yeni Editör", tur, secret: "ORNEK-KURULUM-ANAHTARI", karekod: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/><path d="M10 10h50v50H10zM120 10h50v50h-50zM10 120h50v50H10zM80 80h20v20H80zM120 120h40v40h-40z" fill="black"/></svg>')}` });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-detay-test"));
  await page.route("**/api/v1/platform/**", (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/auth/ben") ? { kullaniciId: "p1", eposta: "ekip@example.test", rol: "yonetici" } : [] }));
});

test("bilgi, kalem ve senaryo kayıtları diğer bölümlerin taslaklarını korur", async ({ page }) => {
  const v = detay();
  // PLT-28: her yazım okunan sürümü gönderir; sunucu her kayıtta sürümü artırır.
  const surumler: number[] = [];
  const yaz = (govde: { surum: number }) => { surumler.push(govde.surum); v.surum++; };
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1", async (route) => {
    if (route.request().method() === "PATCH") { const g = route.request().postDataJSON(); yaz(g); const { surum: _s, ...alanlar } = g; Object.assign(v, alanlar); }
    await route.fulfill({ json: v });
  });
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1/satirlar", async (route) => { const g = route.request().postDataJSON(); yaz(g); v.satirlar = g.satirlar; await route.fulfill({ json: v }); });
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1/kabul-senaryolari", async (route) => { const g = route.request().postDataJSON(); yaz(g); v.kabulSenaryolari = g.senaryolar.map((s: object) => ({ ...senaryo(), ...s, basarili: null })); await route.fulfill({ json: v }); });
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
  expect(surumler).toEqual([1, 2, 3]);
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
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_platform_access"))).toBe("cerez");
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

test("PLT-25: çıkış oturumu sunucuda iptal ettirir; doğrulanamazsa giriş sayfası açıkça uyarır", async ({ page }) => {
  const basliklar: (string | undefined)[] = [];
  let ag = true;
  await page.route("**/api/v1/platform/auth/cikis", (route) => {
    basliklar.push(route.request().headers()["x-tekir-istek"]);
    return ag ? route.fulfill({ json: { sunucudaIptal: true } }) : route.abort("failed");
  });
  await page.goto("/platform/ozet");
  await page.getByRole("button", { name: "Çıkış", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/giris$/);
  expect(basliklar).toEqual(["1"]);
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_platform_access"))).toBeNull();
  await expect(page.getByText(/sunucuda kapatıldığı doğrulanamadı/)).toHaveCount(0);

  ag = false;
  await page.evaluate(() => sessionStorage.setItem("tekir_platform_access", "platform-detay-test"));
  await page.goto("/platform/ozet");
  await page.getByRole("button", { name: "Çıkış", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/giris\?cikis=dogrulanamadi$/);
  await expect(page.getByText(/sunucuda kapatıldığı doğrulanamadı/)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_platform_access"))).toBeNull();
});

test("PLT-25: tüm oturumlarımı kapat onayla çalışır, yerel token silinir ve giriş sayfası bildirir", async ({ page }) => {
  let istek = 0;
  await page.route("**/api/v1/platform/auth/oturumlari-kapat", (route) => { istek++; return route.fulfill({ json: { kapatilan: 3 } }); });
  await page.goto("/platform/ozet");
  await page.getByRole("button", { name: "Tüm oturumlarımı kapat" }).click();
  const pencere = page.getByRole("dialog", { name: "Tüm oturumlarımı kapat" });
  await pencere.getByRole("button", { name: "Vazgeç" }).click();
  expect(istek).toBe(0);
  await page.getByRole("button", { name: "Tüm oturumlarımı kapat" }).click();
  await pencere.getByRole("button", { name: "Oturumları kapat" }).click();
  await expect(page).toHaveURL(/\/platform\/giris\?cikis=tum$/);
  await expect(page.getByText("Tüm platform oturumlarınız kapatıldı.")).toBeVisible();
  expect(istek).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_platform_access"))).toBeNull();
});

test("PLT-30: e-postadaki #anahtar= bağlantısı açılır, anahtar sunucuya adresle gitmez ve adresten silinir", async ({ page }) => {
  const govdeler: unknown[] = [];
  const sayfaIstekleri: string[] = [];
  page.on("request", (r) => { if (r.resourceType() === "document") sayfaIstekleri.push(r.url()); });
  await page.route("**/api/v1/platform/auth/davet/bilgi", (route) => { govdeler.push(route.request().postDataJSON()); return route.fulfill({ json: davet() }); });
  await page.goto("/platform/davet#anahtar=parca-anahtari");
  await expect(page.getByRole("heading", { name: "Hesabınızı oluşturun", exact: true })).toBeVisible();
  expect(govdeler).toEqual([{ anahtar: "parca-anahtari" }]);
  expect(sayfaIstekleri.some((u) => u.includes("parca-anahtari"))).toBe(false);
  await expect(page).toHaveURL(/\/platform\/davet$/);
});

test("PLT-28: kayıt 409 alınca taslak korunur, güncel kayıt karşılaştırılır ve taslak güncel sürüme taşınıp kaydedilir", async ({ page }) => {
  const v = detay();
  const gonderilen: { baslik: string; surum: number }[] = [];
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1", async (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: v });
    const g = route.request().postDataJSON();
    gonderilen.push(g);
    if (gonderilen.length === 1) {
      // Bu arada başka bir editör kaydetmiş: sunucu sürüm 2'de, başlık değişmiş.
      Object.assign(v, { surum: 2, baslik: "Başka editörün başlığı" });
      return route.fulfill({ status: 409, json: { statusCode: 409, message: "Değişiklik bu arada başka biri tarafından güncellendi. Taslağınız korunuyor; güncel kaydı yükleyip karşılaştırın.", guncelSurum: 2 } });
    }
    Object.assign(v, { baslik: g.baslik, surum: v.surum + 1 });
    return route.fulfill({ json: v });
  });
  await page.goto("/platform/degisiklik?id=d1");
  await page.getByLabel("Başlık", { exact: true }).fill("Benim başlığım");
  await page.getByRole("button", { name: "Bilgileri kaydet" }).click();
  const panel = page.getByRole("region", { name: "Güncel kayıtla karşılaştırma" });
  await expect(panel).toContainText("sürüm 1 → 2");
  await expect(panel).toContainText("Başka editörün başlığı");
  await expect(panel).toContainText("sizin taslağınız: Benim başlığım");
  await expect(page.getByLabel("Başlık", { exact: true })).toHaveValue("Benim başlığım");
  await panel.getByRole("button", { name: "Taslağımı güncel sürüme taşı" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("Başlık", { exact: true })).toHaveValue("Benim başlığım");
  await page.getByRole("button", { name: "Bilgileri kaydet" }).click();
  await expect(page.getByText("Bilgiler kaydedildi.")).toBeVisible();
  expect(gonderilen.map((g) => [g.baslik, g.surum])).toEqual([["Benim başlığım", 1], ["Benim başlığım", 2]]);
});

test("PLT-28: taslağımı bırak seçeneği güncel kaydı açar; onaya gönderme sürümle gider", async ({ page }) => {
  const v = detay();
  const istekler: { yol: string; govde: unknown }[] = [];
  await page.route("**/api/v1/platform/mevzuat/degisiklikler/d1**", async (route) => {
    const u = new URL(route.request().url());
    const m = route.request().method();
    if (m === "GET") return route.fulfill({ json: v });
    istekler.push({ yol: `${m} ${u.pathname.replace(/.*\/d1/, "")}${u.search}`, govde: route.request().postDataJSON() });
    if (u.pathname.endsWith("/onaya-gonder")) { Object.assign(v, { surum: 5, baslik: "Sunucudaki başlık" }); return route.fulfill({ status: 409, json: { statusCode: 409, message: "Değişiklik bu arada başka biri tarafından güncellendi." } }); }
    return route.fulfill({ json: { durum: "ok" } });
  });
  page.on("dialog", (d) => void d.dismiss());
  await page.goto("/platform/degisiklik?id=d1");
  await page.getByRole("button", { name: "Onaya gönder", exact: true }).click();
  const panel = page.getByRole("region", { name: "Güncel kayıtla karşılaştırma" });
  await panel.getByRole("button", { name: "Taslağımı bırak, güncel kaydı aç" }).click();
  await expect(page.getByLabel("Başlık", { exact: true })).toHaveValue("Sunucudaki başlık");
  expect(istekler).toEqual([{ yol: "POST /onaya-gonder", govde: { surum: 1 } }]);
});
