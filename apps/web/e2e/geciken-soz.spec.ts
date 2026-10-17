import { expect, test, type Page } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111";
async function kur(page: Page, hata = false) {
  const yazilar: unknown[] = [];
  page.on("pageerror", (e) => { throw e; });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async (r) => {
    const yol = new URL(r.request().url()).pathname.replace("/api/v1", "");
    if (r.request().method() !== "GET") {
      expect(r.request().method()).toBe("PUT"); expect(yol).toBe("/ayarlar/tahsilat_otomasyonu");
      const g = r.request().postDataJSON(); yazilar.push(g);
      if (hata) await r.fulfill({ status: 400, json: { message: "Otomatik takip için sorumlu seçilmeli" } });
      else await r.fulfill({ json: g });
      return;
    }
    let json: unknown = [];
    if (yol === "/auth/ben") json = { rol: "yonetici", userId, tenantId: "test" };
    else if (yol === "/ayarlar") json = { moduller: ["tahsilat_operasyonu", "tahsilat_otomasyonu"] };
    else if (yol === "/ayarlar/tahsilat_operasyonu") json = { surum: 1, mod: "pilot" };
    else if (yol === "/ayarlar/tahsilat_otomasyonu") json = { acik: false, sorumluUserId: null };
    else if (yol === "/kullanicilar") json = [
      { id: userId, adSoyad: "Aktif muhasebeci", rol: "muhasebe", aktif: true },
      { id: "pasif", adSoyad: "Pasif kullanıcı", rol: "muhasebe", aktif: false },
      { id: "satis", adSoyad: "Satış kullanıcısı", rol: "satis", aktif: true },
    ];
    else if (yol === "/bildirimler/ozet") json = { okunmamis: 0, acik: 0, kritik: 0 };
    else if (yol === "/bildirimler") json = { kayitlar: [] };
    else if (yol === "/ebelge/uygulamalar") json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    await r.fulfill({ json });
  });
  await page.goto("/panel/ayarlar/moduller");
  const kart = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Geciken Ödeme Sözü Takibi" }) });
  await expect(kart).toBeVisible();
  return { yazilar, kart };
}
test("otomasyon varsayılan kapalıdır; yalnız aktif yetkili sorumlular seçilebilir", async ({ page }) => {
  const { kart, yazilar } = await kur(page);
  await expect(kart.getByLabel("Geciken sözlerden otomatik takip oluştur")).not.toBeChecked();
  await expect(kart.getByLabel("Sorumluya uygulama içi bildirim oluştur")).not.toBeChecked();
  const secim = kart.getByLabel("Otomatik takip sorumlusu");
  await expect(secim.getByRole("option", { name: "Aktif muhasebeci" })).toHaveCount(1);
  await expect(secim.getByRole("option", { name: "Pasif kullanıcı" })).toHaveCount(0);
  await expect(secim.getByRole("option", { name: "Satış kullanıcısı" })).toHaveCount(0);
  expect(yazilar).toHaveLength(0);
});
test("açma ve sorumlu seçimi yalnız kaydet ile sunucuya gider", async ({ page }) => {
  const { kart, yazilar } = await kur(page);
  await kart.getByLabel("Geciken sözlerden otomatik takip oluştur").check(); await kart.getByLabel("Otomatik takip sorumlusu").selectOption(userId);
  await kart.getByLabel("Sorumluya uygulama içi bildirim oluştur").check();
  expect(yazilar).toHaveLength(0);
  await kart.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Geciken Ödeme Sözü Takibi ayarları kaydedildi.")).toBeVisible();
  expect(yazilar).toEqual([{ acik: true, sorumluUserId: userId, uygulamaIciBildirim: true }]);
});
test("sunucu doğrulama hatası görünür; ayar taslağı korunur", async ({ page }) => {
  const { kart } = await kur(page, true);
  await kart.getByLabel("Geciken sözlerden otomatik takip oluştur").check(); await kart.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Otomatik takip için sorumlu seçilmeli")).toBeVisible();
  await expect(kart.getByLabel("Geciken sözlerden otomatik takip oluştur")).toBeChecked();
});
