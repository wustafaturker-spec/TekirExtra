import { expect, test, type Route } from "@playwright/test";

const firmalar = Array.from({ length: 215 }, (_, n) => ({
  tenantId: `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
  unvan: `Takip Firması ${String(n).padStart(3, "0")}`, vkn: String(1000000000 + n),
  kayitTarihi: "2026-11-02T00:00:00Z", planKodu: n % 2 ? "kurumsal" : "baslangic",
  planAdi: n % 2 ? "Kurumsal" : "Başlangıç", durum: "aktif", donemSonu: null,
  iptalTarihi: null, aktifKullanici: 1, sonGiris: null, ebelgeSaglayici: null, bekleyenTalep: null,
}));
function yanit(route: Route) {
  const p = new URL(route.request().url()).searchParams;
  const sayfa = Number(p.get("sayfa") ?? 1);
  const boyut = Number(p.get("sayfaBoyutu") ?? 25);
  const aranan = p.get("arama") ?? "";
  const uygun = firmalar.filter((f) => (!p.get("firma") || p.get("firma") === f.tenantId) && (!p.get("plan") || p.get("plan") === f.planKodu) && f.unvan.includes(aranan));
  return route.fulfill({ json: { kayitlar: uygun.slice((sayfa - 1) * boyut, sayfa * boyut), toplam: uygun.length, sayfa, sayfaBoyutu: boyut, sayilar: { toplam: 215, talep: 0, askiyaAlinacak: 0, askida: 0, iptal: 0 } } });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "firma-sayfalama-test"));
  await page.route("**/api/v1/platform/auth/ben", (r) => r.fulfill({ json: { eposta: "ekip@example.test", rol: "yonetici" } }));
  await page.route("**/api/v1/platform/firmalar/*/gecmis", (r) => r.fulfill({ json: { degisiklikler: [], talepler: [], odemeler: [] } }));
  await page.route("**/api/v1/platform/firmalar/sayfali?*", yanit);
});

test("dokuzuncu sayfadaki firma bulunur; filtre ve sıralama URL'de korunur", async ({ page }) => {
  await page.goto("/platform/firmalar?sayfa=9");
  await expect(page.getByText("Takip Firması 214", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Firma sayfaları" })).toContainText("Sayfa 9 / 9");
  await expect(page.getByRole("button", { name: "Sonraki", exact: true })).toBeDisabled();
  await page.getByLabel("Plan", { exact: true }).selectOption("kurumsal");
  await expect(page).not.toHaveURL(/sayfa=9/);
  await expect(page).toHaveURL(/plan=kurumsal/);
  await page.getByLabel("Sıralama", { exact: true }).selectOption("kayitYeni");
  await page.getByRole("textbox", { name: "Firma ara" }).fill("213");
  await expect(page.getByText("Takip Firması 213", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/arama=213/);
  await page.reload();
  await expect(page.getByLabel("Plan", { exact: true })).toHaveValue("kurumsal");
  await expect(page.getByLabel("Sıralama", { exact: true })).toHaveValue("kayitYeni");
  await expect(page.getByRole("textbox", { name: "Firma ara" })).toHaveValue("213");
  await page.getByRole("button", { name: "Filtreleri temizle" }).click();
  await expect(page).toHaveURL(/\/platform\/firmalar$/);
  await expect(page.getByText("Takip Firması 000", { exact: true })).toBeVisible();
});

test("liste dışında kalan firmanın bağlantısı açılır ve kapatılınca URL temizlenir", async ({ page }) => {
  await page.goto(`/platform/firmalar?firma=${firmalar[214].tenantId}&plan=kurumsal`);
  const pencere = page.getByRole("dialog", { name: "Takip Firması 214" });
  await expect(pencere).toBeVisible();
  await pencere.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(pencere).toHaveCount(0);
  await expect(page).toHaveURL(/plan=kurumsal/);
  await expect(page).not.toHaveURL(/firma=/);
});

test("geciken eski sorgu yeni filtre sonuçlarını değiştirmez", async ({ page }) => {
  let al!: (r: Route) => void;
  const ilk = new Promise<Route>((r) => { al = r; });
  await page.route("**/api/v1/platform/firmalar/sayfali?*", (r) => {
    if (!new URL(r.request().url()).searchParams.get("plan")) { al(r); return; }
    return yanit(r);
  });
  await page.goto("/platform/firmalar");
  const eski = await ilk;
  await page.getByLabel("Plan", { exact: true }).selectOption("kurumsal");
  await expect(page.getByText("Takip Firması 001", { exact: true })).toBeVisible();
  await yanit(eski).catch(() => undefined);
  await expect(page.getByText("Takip Firması 000", { exact: true })).toHaveCount(0);
});

test("boş sayfadan ilk sayfaya dönülür; mobil filtreler taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform/firmalar?sayfa=100");
  await page.getByRole("button", { name: "İlk sayfaya dön" }).click();
  await expect(page.getByText("Takip Firması 000", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/platform-firma-sayfalama-mobile.png", fullPage: true });
});
