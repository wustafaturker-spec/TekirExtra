import { expect, test } from "@playwright/test";

const id = "00000000-0000-4000-8000-000000000001";
test("fiyat etkisi dönem ve sayfayı URL'de korur; eksik fiyat ve eşlenmeyen planı açıklar", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar: string[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() !== "GET") yazmalar.push(u.pathname);
    if (u.pathname.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "test@example.invalid", rol: "yonetici" } });
    const sayfa = Number(u.searchParams.get("sayfa") ?? 1);
    return r.fulfill({ json: { toplam: 2, sayfa, sayfaBoyutu: 25, hedefSurumId: id, hedefSurumNo: 2, hedefPaketAdi: "Profesyonel", gecerlilikTarihi: "2026-12-01", uygulamaTarihi: null, atamaYapildi: false, kapsam: "Tüm abonelikler.",
      kayitlar: sayfa > 1 ? [] : [
        { tenantId: id, unvan: "Örnek firma", planKodu: "v1", karsilastirilabilir: true, neden: null,
          donemler: [{ aySayisi: 1, once: { matrah: "999.00", kdv: "199.80", toplam: "1198.80" }, sonra: { matrah: "1200.00", kdv: "120.00", toplam: "1320.00" }, fark: { matrah: "201.00", kdv: "-79.80", toplam: "121.20" } }, { aySayisi: 12, once: null, sonra: null, fark: null }] },
        { tenantId: "baska-firma", unvan: "Eşlenmeyen firma", planKodu: "ozel", karsilastirilabilir: false, neden: "farkli_veya_eslenmeyen_plan", donemler: [] },
      ] } });
  });
  await page.goto(`/platform/paketler/fiyat-etkisi?surumId=${id}&sayfa=99`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await expect(page.getByText("2 abonelik · Sayfa 99 / 1")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "İlk sayfaya dön" }).click();
  await expect(page.getByText("121,20 TRY", { exact: false })).toBeVisible();
  await expect(page.getByText("Farklı veya eşlenmeyen plan", { exact: true })).toBeVisible();
  await page.getByLabel("Karşılaştırılacak dönem").selectOption("12");
  await expect(page).toHaveURL(/ay=12/);
  await expect(page.getByRole("row").filter({ hasText: "Örnek firma" })).toContainText("Karşılaştırma yok");
  await page.reload();
  await expect(page.getByLabel("Karşılaştırılacak dönem")).toHaveValue("12");
  expect(yazmalar).toEqual([]);
});

test("kapsam sözleşmeli sürüm ayrı kapsam onayıyla sunulur", async ({ page }) => {
  test.setTimeout(180000);
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    if (new URL(r.request().url()).pathname.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "test@example.invalid", rol: "yonetici" } });
    return r.fulfill({ json: { toplam: 0, sayfa: 1, sayfaBoyutu: 25, hedefSurumId: id, hedefSurumNo: 2, hedefPaketAdi: "Kapsamlı paket", hedefKapsamVar: true,
      gecerlilikTarihi: "2026-11-01", kapsam: "Fiyat karşılaştırması", kayitlar: [] } });
  });
  await page.goto(`/platform/paketler/fiyat-etkisi?surumId=${id}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await expect(page.getByText(/Bu sürüm modül ve kota sözleşmesi içeriyor/)).toBeVisible();
  await expect(page.getByText("Seçili firmalara kapsam sürümü ata")).toBeVisible();
  await expect(page.getByRole("button", { name: "Atama önizlemesini hazırla" })).toBeVisible();
});
