import { expect, test } from "@playwright/test";

const liste = [
  { id: "d1", no: 1, baslik: "KDV oranları", dayanak: "Örnek tebliğ", yururlukBaslangic: "2026-11-01", durum: "taslak", satirSayisi: 2, hazirlayan: { adSoyad: "Editör" }, yayinlayan: null, retGerekcesi: null },
  { id: "d2", no: 2, baslik: "Bordro parametreleri", dayanak: "Örnek düzenleme", yururlukBaslangic: "2026-01-01", durum: "yayinlandi", satirSayisi: 1, hazirlayan: { adSoyad: "Editör" }, yayinlayan: null, retGerekcesi: null },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-test"));
  await page.route("**/api/v1/platform/**", (route) => {
    const url = new URL(route.request().url());
    const durum = url.searchParams.get("durum");
    return route.fulfill({ json: url.pathname.endsWith("/auth/ben") ? { eposta: "ekip@example.test", rol: "yonetici" } : url.pathname.endsWith("/degisiklikler") ? liste.filter((d) => !durum || d.durum === durum) : [] });
  });
});

test("durum ve arama birlikte çalışır, taslak formuna odak taşınır", async ({ page }) => {
  await page.goto("/platform");
  await expect(page.getByRole("link", { name: "KDV oranları", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Durum", exact: true }).getByRole("button", { name: "Yayınlandı" }).click();
  await expect(page.getByRole("link", { name: "KDV oranları", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Bordro parametreleri" })).toBeVisible();
  await page.getByRole("textbox", { name: "Değişiklik ara" }).fill("eşleşmeyen");
  await expect(page.getByText("Aramanıza uygun değişiklik yok")).toBeVisible();
  await page.getByRole("button", { name: "Yeni değişiklik", exact: true }).click();
  await expect(page.getByLabel("Başlık", { exact: true })).toBeFocused();
});

test("mobil menü açılır ve Escape ile kapanır, boş sonuç görünür kalır", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform");
  const menu = page.getByRole("navigation", { name: "Platform menüsü" });
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "Menüyü aç", exact: true }).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.getByRole("textbox", { name: "Değişiklik ara" }).fill("eşleşmeyen");
  await expect(page.getByText("Aramanıza uygun değişiklik yok")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("veri hatası boş sonuçla karışmaz ve yeniden deneme çalışır", async ({ page }) => {
  let hata = true;
  await page.route("**/api/v1/platform/mevzuat/degisiklikler", (route) => route.fulfill(hata ? { status: 503, json: { message: "Liste geçici olarak alınamadı" } } : { json: liste }));
  await page.route("**/api/v1/platform/mevzuat/yayin-takvimi", (route) => route.fulfill({ status: 503, json: { message: "Takvim alınamadı" } }));
  await page.goto("/platform");
  await expect(page.locator(".alert--error")).toContainText("Liste geçici olarak alınamadı");
  await expect(page.getByText(/Yayın takvimi yüklenemedi/)).toBeVisible();
  await expect(page.getByText("Henüz değişiklik yok")).toHaveCount(0);
  hata = false;
  await page.locator(".platform-inline-error").getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("link", { name: "KDV oranları", exact: true })).toBeVisible();
  await expect(page.locator(".alert--error")).toHaveCount(0);
});
