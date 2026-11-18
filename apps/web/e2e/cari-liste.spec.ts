import { expect, test } from "@playwright/test";
import { ortakYanit } from "./ortak-yanit";

test("cari listesi yeni filtrede eski kaydı gizler ve mobilde bakiye ile risk görünür", async ({ page }) => {
  const cari = {
    id: "cari-1", kod: "C001", unvan: "Örnek Makina Sanayi ve Ticaret Limited Şirketi İstanbul Avrupa Yakası Şubesi", tip: "musteri", aktif: true,
    karaListe: true, bakiyeler: [{ dovizCinsi: "TRY", bakiye: "2500", bakiyeTry: "2500" }],
  };
  let ilkIstegiBirak!: () => void;
  const ilkIstek = new Promise<void>((resolve) => { ilkIstegiBirak = resolve; });
  let aramaHatasi = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const yol = url.pathname.replace("/api/v1", "");
    if (yol === "/auth/ben") return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol === "/cari") {
      await ilkIstek;
      if (url.searchParams.has("arama")) {
        if (aramaHatasi) return route.fulfill({ status: 503, json: { message: "Cari listesi alınamadı." } });
        return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
      }
      return route.fulfill({ json: { kayitlar: [cari], sonrakiImlec: null } });
    }
    return route.fulfill(ortakYanit(yol) ?? { json: [] });
  });
  await page.goto("/panel/cari", { waitUntil: "domcontentloaded" });
  const bos = page.getByText("Arama kriterlerinize uygun cari hesap kaydı bulunamadı.");
  await expect(page.getByText("Cariler yükleniyor…", { exact: true })).toBeVisible();
  await expect(bos).toHaveCount(0);
  ilkIstegiBirak();
  const kayit = page.getByRole("link", { name: cari.unvan, exact: true });
  await expect(kayit).toHaveAttribute("href", "/panel/cari/cari-1");
  await expect(page.locator('td[data-label="Bakiye (TL)"]')).toBeVisible();
  await expect(page.locator('td[data-label="Risk durumu"]').getByText("Bloke")).toBeVisible();
  await expect(page.locator('td[data-label="Sektör"]')).toBeHidden();
  await expect(page.getByText("Yüklenen kayıtlar", { exact: true })).toBeVisible();
  const arama = page.getByPlaceholder(/Cari adı, kodu/);
  await expect(arama).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const secim = page.getByRole("checkbox", { name: `${cari.unvan} seç` });
  const adKonumu = await kayit.boundingBox();
  const secimKonumu = await secim.boundingBox();
  expect(adKonumu!.x + adKonumu!.width).toBeLessThan(secimKonumu!.x);
  await secim.check();
  await arama.fill("eşleşmeyen");
  await expect(kayit).toHaveCount(0);
  await expect(page.getByText("Cari listesi alınamadı.", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `${cari.unvan} seç` })).toHaveCount(0);
  await expect(bos).toHaveCount(0);
  aramaHatasi = false;
  await page.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  await expect(bos).toBeVisible();
});
