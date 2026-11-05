import { expect, test, type Page } from "@playwright/test";

const hedefId = "00000000-0000-4000-8000-000000000001", tenantId = "00000000-0000-4000-8000-000000000002", onayId = "00000000-0000-4000-8000-000000000003";
async function kur(page: Page, hata: "cakisma" | "ag" | null = null, kapsam = false) {
  const yazmalar: { yol: string; veri: unknown }[] = [];
  let uygulandi = false, ilkDeneme = true;
  const donemler = [1, 3, 6, 12].map((aySayisi) => ({ aySayisi,
    once: { matrah: String(999 * aySayisi), kdv: (199.8 * aySayisi).toFixed(2), toplam: (1198.8 * aySayisi).toFixed(2) },
    sonra: { matrah: String(1200 * aySayisi), kdv: String(120 * aySayisi), toplam: String(1320 * aySayisi) },
    fark: { matrah: String(201 * aySayisi), kdv: (-79.8 * aySayisi).toFixed(2), toplam: (121.2 * aySayisi).toFixed(2) },
  }));
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const yol = new URL(r.request().url()).pathname;
    if (yol.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "test@example.invalid", rol: "yonetici" } });
    if (r.request().method() === "POST") {
      yazmalar.push({ yol, veri: r.request().postDataJSON() });
      if (yol.endsWith("/atama-onizle")) return r.fulfill({ json: { id: onayId, uygulamaTarihi: r.request().postDataJSON().uygulamaTarihi, sonOnayAt: "2099-01-01T12:00:00Z", neden: "Yeni fiyat sözleşmesi", hedefSurumId: hedefId, hedefPaketAdi: "Profesyonel", hedefSurumNo: 2,
        atamaKapsami: kapsam ? "kapsam" : "fiyat",
        kayitlar: [{ tenantId, unvan: "Atama firması", kaynakSurumId: "eski", oncekiLimitler: { kullanici: 10, cari: 100, stok: null, aylikFatura: 100 }, sonrakiLimitler: { kullanici: 10, cari: 50, stok: null, aylikFatura: 100 },
          kullanim: kapsam ? { kullanici: 1, cari: 20, stok: 0, aylikFatura: 5 } : null, kapananModuller: kapsam ? ["stok"] : [], acilanModuller: [], donemler }] } });
      if (hata === "cakisma" && ilkDeneme) {
        ilkDeneme = false;
        return r.fulfill({ status: 409, json: { message: "Abonelik değişti. Yeni bir atama önizlemesi hazırlayın." } });
      }
      const tekrar = uygulandi; uygulandi = true;
      if (hata === "ag" && ilkDeneme) {
        ilkDeneme = false;
        return r.fulfill({ status: 503, json: { message: "Yanıt alınamadı. Yeniden deneyin." } });
      }
      return r.fulfill({ json: { id: onayId, tekrar, firmaAdedi: 1 } });
    }
    return r.fulfill({ json: { toplam: 1, sayfa: 1, sayfaBoyutu: 25, hedefSurumId: hedefId, hedefSurumNo: 2, hedefPaketAdi: "Profesyonel", hedefKapsamVar: kapsam, gecerlilikTarihi: "2026-01-01", kapsam: "Tüm abonelikler.", kayitlar: [
      { tenantId, unvan: "Atama firması", planKodu: "v1", kaynakSurumId: uygulandi ? hedefId : "eski", karsilastirilabilir: true, neden: null, donemler },
    ] } });
  });
  await page.goto(`/platform/paketler/fiyat-etkisi?surumId=${hedefId}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await expect(page.getByRole("checkbox", { name: "Atama firması", exact: true })).toBeVisible({ timeout: 30000 });
  return yazmalar;
}
async function hazirla(page: Page) {
  await page.getByRole("checkbox", { name: "Atama firması", exact: true }).check();
  await page.getByLabel("Atama nedeni").fill("Yeni fiyat sözleşmesi");
  await page.getByRole("button", { name: "Atama önizlemesini hazırla" }).click();
  await expect(page.getByRole("region", { name: "Atama onayı" })).toBeVisible();
}
test("kapsam önizlemesi kapanan modül ve kotayı gösterir; ayrı kapsam onayı gönderir", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page, null, true); await hazirla(page);
  const panel = page.getByRole("region", { name: "Atama onayı" });
  await expect(panel).toContainText("Stok ve Depo");
  await expect(panel).toContainText("20");
  expect(yazmalar[0].veri).toMatchObject({ atamaKapsami: "kapsam" });
  expect(yazmalar).toHaveLength(1);
  await page.getByRole("button", { name: "Modül, kota ve fiyat atamasını onayla" }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "firmanın kapsam sürümü" })).toContainText("1 firmanın");
  expect(yazmalar[1].veri).toEqual({ onizlemeId: onayId });
});
test("atama firma seçimi ve ayrı onay gerektirir; vazgeçmek atamaz", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page);
  await expect(page.getByRole("button", { name: "Atama önizlemesini hazırla" })).toBeDisabled();
  await hazirla(page);
  expect(yazmalar).toHaveLength(1);
  const panel = page.getByRole("region", { name: "Atama onayı" });
  await expect(panel.getByRole("row")).toHaveCount(5);
  await expect(panel).toContainText("Atama firması · 12 ay");
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  expect(yazmalar.filter((r) => r.yol.endsWith("/atama-uygula"))).toHaveLength(0);
  await page.getByRole("button", { name: "Atama önizlemesini hazırla" }).click();
  await page.getByRole("button", { name: "Seçili firmalara atamayı onayla" }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "firmanın fiyat sürümü" })).toContainText("1 firmanın fiyat sürümü uygulandı");
  expect(yazmalar.find((r) => r.yol.endsWith("/atama-onizle"))?.veri).toMatchObject({ surumId: hedefId, tenantIds: [tenantId], neden: "Yeni fiyat sözleşmesi" });
  expect(yazmalar.find((r) => r.yol.endsWith("/atama-uygula"))?.veri).toEqual({ onizlemeId: onayId });
});
test("kaynak çakışmasında yeni önizleme istenir; firma seçimi ve neden korunur", async ({ page }) => {
  test.setTimeout(180000);
  await kur(page, "cakisma"); await hazirla(page);
  await page.getByRole("button", { name: "Seçili firmalara atamayı onayla" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Yeni bir atama önizlemesi");
  await expect(page.getByRole("checkbox", { name: "Atama firması", exact: true })).toBeChecked();
  await expect(page.getByLabel("Atama nedeni")).toHaveValue("Yeni fiyat sözleşmesi");
  await expect(page.getByRole("button", { name: "Seçili firmalara atamayı onayla" })).toHaveCount(0);
});
test("yanıt kaybında aynı onay kimliğiyle tekrar denenir", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page, "ag"); await hazirla(page);
  await page.getByRole("button", { name: "Seçili firmalara atamayı onayla" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Yanıt alınamadı");
  await page.getByRole("button", { name: "Seçili firmalara atamayı onayla" }).click();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "firmanın fiyat sürümü" })).toContainText("daha önce uygulanmıştı");
  expect(yazmalar.filter((r) => r.yol.endsWith("/atama-uygula")).map((r) => r.veri)).toEqual([{ onizlemeId: onayId }, { onizlemeId: onayId }]);
});
