import { expect, test, type Page } from "@playwright/test";

const surumId = "00000000-0000-4000-8000-000000000101", tenantId = "00000000-0000-4000-8000-000000000102", planId = "00000000-0000-4000-8000-000000000103";
const tarih = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
async function kur(page: Page, editor = false) {
  const yazmalar: { yol: string; veri: Record<string, unknown> }[] = [];
  let durum = "planlandi";
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const u = new URL(r.request().url()), yol = u.pathname;
    if (yol.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "test@example.invalid", rol: editor ? "mevzuat_editoru" : "yonetici" } });
    if (r.request().method() === "POST") {
      const veri = r.request().postDataJSON() as Record<string, unknown>; yazmalar.push({ yol, veri });
      if (yol.endsWith("/atama-onizle")) return r.fulfill({ json: { id: planId, uygulamaTuru: veri.uygulamaTuru, uygulamaTarihi: veri.uygulamaTarihi ?? tarih,
        uygulanacakAt: `${tarih}T09:30:00.000Z`, sonOnayAt: "2099-01-01T12:00:00Z", neden: veri.neden, hedefSurumId: surumId, hedefPaketAdi: "Profesyonel", hedefSurumNo: 2,
        kayitlar: [{ tenantId, unvan: "Planlı firma", kaynakSurumId: "eski", oncekiLimitler: { kullanici: 10 }, sonrakiLimitler: { kullanici: 10 }, donemler: [] }] } });
      if (yol.endsWith("/atama-uygula")) return r.fulfill({ json: { id: planId, durum: "planlandi", tekrar: false, firmaAdedi: 1 } });
      durum = "iptal"; return r.fulfill({ json: { id: planId, tekrar: false } });
    }
    if (yol.endsWith("/planli-atamalar")) {
      const sayfa = Number(u.searchParams.get("sayfa") ?? 1);
      return r.fulfill({ json: { toplam: 1, sayfa, sayfaBoyutu: 25, kayitlar: sayfa > 1 ? [] : [{ id: planId, hedefSurumId: surumId, hedefPaketAdi: "Profesyonel", hedefSurumNo: 2,
        uygulamaTuru: "donem_sonu", uygulanacakAt: `${tarih}T09:30:00Z`, neden: "Dönem sonu güncellemesi", durum, engelNedeni: null,
        iptalNedeni: durum === "iptal" ? "Müşteriyle yeniden görüşülecek" : null, firmalar: [{ tenantId, unvan: "Planlı firma" }] }] } });
    }
    return r.fulfill({ json: { toplam: 2, sayfa: 1, sayfaBoyutu: 25, hedefSurumId: surumId, hedefSurumNo: 2, hedefPaketAdi: "Profesyonel", gecerlilikTarihi: "2026-01-01", kapsam: "Tüm abonelikler.", kayitlar: [
      { tenantId, unvan: "Planlı firma", planKodu: "v1", kaynakSurumId: "eski", karsilastirilabilir: true, neden: null, donemler: [] },
      { tenantId: "00000000-0000-4000-8000-000000000104", unvan: "İkinci firma", planKodu: "v1", kaynakSurumId: "eski", karsilastirilabilir: true, neden: null, donemler: [] },
    ] } });
  });
  return yazmalar;
}
test("ileri tarih ayrı onayla planlanır; uygulandı mesajı verilmez", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page);
  await page.goto(`/platform/paketler/fiyat-etkisi?surumId=${surumId}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await page.getByRole("checkbox", { name: "Planlı firma", exact: true }).check();
  await page.getByLabel("Uygulama zamanı", { exact: true }).selectOption("tarih");
  await expect(page.getByLabel("Uygulama tarihi (Türkiye)")).toBeVisible({ timeout: 10000 });
  await page.getByLabel("Uygulama tarihi (Türkiye)").fill(tarih);
  await page.getByLabel("Atama nedeni").fill("Gelecek dönem fiyatı");
  await page.getByRole("button", { name: "Atama önizlemesini hazırla" }).click();
  await expect(page.getByRole("region", { name: "Atama onayı" })).toContainText("Planlanan uygulama zamanı (Türkiye)");
  expect(yazmalar).toHaveLength(1);
  expect(yazmalar[0].veri).toMatchObject({ uygulamaTuru: "tarih", uygulamaTarihi: tarih, tenantIds: [tenantId] });
  await page.getByRole("button", { name: "Seçili firmalara atamayı onayla" }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "fiyat geçişi planlandı" })).toBeVisible();
  await page.getByRole("link", { name: "Planlı atamaları ve sonuçlarını yönet" }).click();
  await expect(page.getByRole("cell").filter({ hasText: "Planlandı" })).toBeVisible({ timeout: 30000 });
});
test("dönem sonunda tek firma gerekir ve kesin zaman sunucudan gelir", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page);
  await page.goto(`/platform/paketler/fiyat-etkisi?surumId=${surumId}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await page.getByLabel("Uygulama zamanı", { exact: true }).selectOption("donem_sonu");
  await page.getByRole("checkbox", { name: "Planlı firma", exact: true }).check();
  await page.getByRole("checkbox", { name: "İkinci firma", exact: true }).check();
  await page.getByLabel("Atama nedeni").fill("Dönem sonunda yeni fiyat");
  await expect(page.getByRole("button", { name: "Atama önizlemesini hazırla" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "İkinci firma", exact: true }).uncheck();
  await page.getByRole("button", { name: "Atama önizlemesini hazırla" }).click();
  expect(yazmalar[0].veri).toMatchObject({ uygulamaTuru: "donem_sonu", uygulamaTarihi: null, tenantIds: [tenantId] });
  await expect(page.getByRole("region", { name: "Atama onayı" })).toContainText("12:30");
});
test("plan iptali neden ve açık onay ister; URL sayfalaması ve mobil görünüm çalışır", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform/paketler/planli-atamalar?planSayfa=99", { waitUntil: "domcontentloaded", timeout: 150000 });
  await expect(page.getByText("1 plan · Sayfa 99 / 1")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "İlk plan sayfasına dön" }).click();
  await expect(page).toHaveURL(/planSayfa=1/);
  await page.getByRole("button", { name: "Planı iptal et", exact: true }).click();
  await expect(page.getByRole("button", { name: "Planı iptal etmeyi onayla" })).toBeDisabled();
  await page.getByLabel("Plan iptal nedeni").fill("Müşteriyle yeniden görüşülecek");
  expect(yazmalar).toHaveLength(0);
  await page.getByRole("button", { name: "Planı iptal etmeyi onayla" }).click();
  await expect(page.getByRole("cell").filter({ hasText: "İptal edildi" })).toBeVisible();
  expect(yazmalar[0]).toEqual({ yol: `/api/v1/platform/paketler/planli-atamalar/${planId}/iptal`, veri: { neden: "Müşteriyle yeniden görüşülecek" } });
  await page.reload(); await expect(page.getByRole("cell").filter({ hasText: "İptal edildi" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
test("editör plan listesine doğrudan erişemez", async ({ page }) => {
  test.setTimeout(180000); await kur(page, true);
  await page.goto("/platform/paketler/planli-atamalar", { waitUntil: "domcontentloaded", timeout: 150000 });
  await expect(page).toHaveURL(/\/platform$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Planlı paket atamaları" })).toHaveCount(0);
});
