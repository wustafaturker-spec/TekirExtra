import { expect, test, type Page } from "@playwright/test";

/** ETC-01/02: entegrasyon kataloğu; API taklittir. */
async function kur(page: Page) {
  const istekler: Array<{ yol: string; yontem: string; govde: unknown }> = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  // Taklit edilmeyen istek gerçek API'ye gitmesin: en düşük öncelikli boş yanıt.
  await page.route("**/api/v1/**", (r) => r.fulfill({ status: 404, json: {} }));
  await page.route("**/api/v1/**", async (route) => {
    const r = route.request(), yol = new URL(r.url()).pathname.replace("/api/v1", "");
    const yontem = r.method();
    if (yontem !== "GET") istekler.push({ yol, yontem, govde: r.postDataJSON() });
    let json: unknown;
    if (yol === "/auth/ben") json = { userId: "u1", tenantId: "t1", rol: "yonetici" };
    else if (yol === "/baglantilar" && yontem === "GET") json = [{ id: "b-ty", aile: "pazaryeri", saglayici: "trendyol", durum: "aktif", kullaniciAdiMaskeli: "ab***" }];
    else if (yol === "/baglantilar" && yontem === "POST") json = { id: "b-sh", aile: "pazaryeri", saglayici: "shopify", durum: "pasif", kullaniciAdiMaskeli: "ma***" };
    else if (yol === "/pazaryeri/entegrasyon-talepleri") json = yontem === "GET" ? [] : { kaydedildi: true };
    else if (yol === "/pazaryeri/hakedis/baglantilar") json = [];
    else if (yol === "/cari") json = { kayitlar: [{ id: "00000000-0000-4000-8000-0000000000c1", kod: "PRK", unvan: "Perakende Müşteri" }], sonrakiImlec: null };
    else if (yol.endsWith("/test")) json = { basarili: true, mesaj: "Kimlik biçimi doğrulandı" };
    else if (yol.endsWith("/aktif-et")) json = { ok: true };
    else if (yol.endsWith("/varsayilan-alici")) json = { ok: true };
    else if (yol.endsWith("/sina")) json = { basarili: true, mesaj: "Magazam mağazasına bağlanıldı; son sipariş #1001." };
    else if (yol === "/ebelge/uygulamalar") json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    else return route.fallback();
    await route.fulfill({ json });
  });
  await page.goto("/panel/ayarlar/pazaryerleri");
  return istekler;
}

test("katalog: kategoriler, bağlı işareti ve Yakında talebi", async ({ page }) => {
  const istekler = await kur(page);
  await expect(page.getByRole("heading", { name: "Pazaryeri ve e-ticaret" })).toBeVisible();
  const trendyol = page.locator(".entegrasyon-kart", { hasText: "Trendyol" });
  await expect(trendyol.getByLabel("Bağlı ve aktif")).toBeVisible();
  await page.getByRole("button", { name: "E-ticaret sitesi", exact: true }).click();
  await expect(page.locator(".entegrasyon-kart", { hasText: "Trendyol" })).toHaveCount(0);
  await expect(page.locator(".entegrasyon-kart", { hasText: "WooCommerce" })).toBeVisible();
  const ideasoft = page.locator(".entegrasyon-kart", { hasText: "İdeaSoft" });
  await expect(ideasoft.getByText("Yakında")).toBeVisible();
  await ideasoft.getByRole("button", { name: "İlgileniyorum" }).click();
  await expect(ideasoft.getByText("Talep alındı")).toBeVisible();
  expect(istekler).toContainEqual({ yol: "/pazaryeri/entegrasyon-talepleri", yontem: "POST", govde: { saglayici: "ideasoft" } });
});

test("Shopify bağlantısı: alanlar, varsayılan cari, sınama", async ({ page }) => {
  const istekler = await kur(page);
  await page.locator(".entegrasyon-kart", { hasText: "Shopify" }).getByRole("button", { name: "Bağla", exact: true }).click();
  const pencere = page.getByRole("dialog", { name: "Shopify bağlantısı" });
  await expect(pencere.getByText("Anahtarı nereden alırım?")).toBeVisible();
  await pencere.getByLabel("Mağaza adı *").fill("magazam");
  await pencere.getByLabel("İstemci kimliği (Client ID)").fill("cid");
  await pencere.getByLabel("İstemci sırrı (Client secret)").fill("sec");
  await pencere.getByRole("combobox", { name: "Cari hesap" }).fill("Perakende");
  await page.getByRole("option", { name: /Perakende Müşteri/ }).click();
  await pencere.getByRole("button", { name: "Kaydet ve sına" }).click();
  await expect(pencere.getByText("Magazam mağazasına bağlanıldı; son sipariş #1001.")).toBeVisible();
  expect(istekler.map((i) => `${i.yontem} ${i.yol}`)).toEqual(["POST /baglantilar", "POST /pazaryeri/baglantilar/b-sh/varsayilan-alici", "POST /baglantilar/b-sh/test", "POST /baglantilar/b-sh/aktif-et", "POST /pazaryeri/baglantilar/b-sh/sina"]);
  expect(istekler[0].govde).toEqual({ aile: "pazaryeri", saglayici: "shopify", config: { kullaniciAdi: "magazam", saticiId: "cid", parola: "sec" } });
  expect(istekler[1].govde).toEqual({ cariId: "00000000-0000-4000-8000-0000000000c1" });
});
