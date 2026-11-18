import { expect, test } from "@playwright/test";

test("endeks listesi hata, boş liste ve seri ayrıntısını gösterir", async ({ page }) => {
  let durum: "hata" | "bos" | "dolu" = "hata";
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-endeks-test"));
  await page.route("**/api/v1/platform/**", (route) => {
    const yol = new URL(route.request().url()).pathname;
    if (yol.endsWith("/auth/ben")) return route.fulfill({ json: { eposta: "yonetici@example.test", rol: "yonetici" } });
    if (yol.endsWith("/USD/degerler")) return route.fulfill({ json: { degerler: [], revizyonlar: [] } });
    if (!yol.endsWith("/endeksler")) return route.fulfill({ json: [] });
    if (durum === "hata") return route.fulfill({ status: 503, json: { message: "Seriler alınamadı." } });
    return route.fulfill({ json: { anahtarTanimli: true, seriler: durum === "bos" ? [] : [{
      kod: "USD", evdsKodu: "TP.DK.USD.A", ad: "ABD doları", kaynakSiklik: "gunluk", tur: "kur",
      bazYili: null, kaynak: "TCMB", etkin: true, sonDonem: null, sonCekimAt: null,
      degerSayisi: 0, kiraciSayisi: 0, gorulmemisRevizyon: 0, elleDegerSayisi: 0,
    }] } });
  });
  await page.goto("/platform/endeksler");
  await expect(page.getByText("Seriler alınamadı.", { exact: true })).toBeVisible();
  await expect(page.getByText("0 seri", { exact: true })).toHaveCount(0);
  durum = "bos";
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByText("Henüz seri yok.", { exact: true })).toBeVisible();
  durum = "dolu";
  await page.reload();
  const ayrinti = page.getByRole("button", { name: "ABD doları ayrıntısı" });
  await expect(ayrinti).toHaveText("Ayrıntı");
  await ayrinti.press("Enter");
  await expect(page.getByText("USD — ABD doları", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(ayrinti).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
