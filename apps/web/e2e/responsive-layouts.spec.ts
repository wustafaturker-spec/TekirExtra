import { expect, test, type Page } from "@playwright/test";

const sayfalar = [
  { yol: "/panel/fatura", baslik: "Fatura Yönetimi" },
  { yol: "/panel/cari", baslik: "Cari Hesaplar" },
  { yol: "/panel/stok", baslik: "Stok Kartları" },
  { yol: "/panel/kasa-banka", baslik: "Kasa & Banka Yönetimi" },
  { yol: "/panel/kasa-banka/ekstre", baslik: "Banka Ekstresi" },
] as const;

async function apiMockla(page: Page) {
  await page.addInitScript(() => localStorage.setItem("tekir_access", "e2e-token"));
  await page.route("http://localhost:3001/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/auth/ben")) {
      await route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
      return;
    }
    if (pathname.endsWith("/cari/etiketler") || pathname.endsWith("/fiyat-listeleri") || pathname.includes("/kasa-banka/") || pathname.endsWith("/depo")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (pathname.endsWith("/fatura") || pathname.endsWith("/cari") || pathname.endsWith("/stok")) {
      await route.fulfill({ json: { kayitlar: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

for (const gorunum of [
  { ad: "masaüstü", width: 1440, height: 900 },
  { ad: "mobil", width: 390, height: 844 },
] as const) {
  test.describe(gorunum.ad, () => {
    test.use({ viewport: { width: gorunum.width, height: gorunum.height } });

    test("temel operasyon sayfaları görünür ve yatay taşma üretmez", async ({ page }) => {
      await apiMockla(page);
      for (const sayfa of sayfalar) {
        await page.goto(sayfa.yol);
        await expect(page.getByRole("heading", { level: 1, name: sayfa.baslik })).toBeVisible();
        const boyut = await page.evaluate(() => ({
          istemci: document.documentElement.clientWidth,
          icerik: document.documentElement.scrollWidth,
        }));
        expect.soft(boyut.icerik, `${sayfa.yol} belge düzeyinde yatay taşmamalı`).toBeLessThanOrEqual(boyut.istemci);
      }
    });
  });
}
