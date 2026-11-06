import { expect, test } from "@playwright/test";

// GİB büyükşehir dairelerini "Merkez" altında verir; ilçe listesi resmi listeden gelmeli.
const DAIRELER = [
  { kod: "34250", ilKodu: "34", il: "İstanbul", ilce: "Merkez", ad: "Kadıköy Vergi Dairesi Müdürlüğü" },
  { kod: "34251", ilKodu: "34", il: "İstanbul", ilce: "Merkez", ad: "Beşiktaş Vergi Dairesi Müdürlüğü" },
  { kod: "34201", ilKodu: "34", il: "İstanbul", ilce: "Adalar", ad: "Adalar Vergi Dairesi Müdürlüğü" },
  { kod: "06250", ilKodu: "06", il: "Ankara", ilce: "Merkez", ad: "Çankaya Vergi Dairesi Müdürlüğü" },
];

test("kayıtta İstanbul'un bütün ilçeleri gelir; daire il içinden, ilçeye yakın olan önde seçilir", async ({ page }) => {
  await page.route("**/api/v1/vergi-daireleri", (route) => route.fulfill({ json: DAIRELER }));
  await page.route("**/api/v1/tenant/kayit/paketler", (route) => route.fulfill({ json: [] }));
  let govde: Record<string, unknown> | null = null;
  await page.route("**/api/v1/tenant/kayit", async (route) => { govde = route.request().postDataJSON(); await route.fulfill({ status: 201, json: { mesaj: "Kayıt alındı" } }); });
  await page.goto("/kayit");

  const il = page.locator("select").filter({ has: page.locator("option", { hasText: "İl seçin" }) });
  const ilce = page.locator("select").filter({ has: page.locator("option", { hasText: "İlçe seçin" }) });
  const daire = page.locator("select").filter({ has: page.locator("option", { hasText: "Daire seçin" }) });
  await il.selectOption({ label: "İstanbul" });
  await expect(ilce.locator("option")).toHaveCount(40);
  await expect(ilce.locator("option", { hasText: "Kadıköy" })).toHaveCount(1);

  await ilce.selectOption("Adalar");
  await expect(daire).toHaveValue("34201");

  await ilce.selectOption("Kadıköy");
  await expect(daire).toHaveValue("");
  await expect(daire.locator("optgroup").first()).toHaveAttribute("label", "Kadıköy ilçesindeki daireler");
  await expect(daire.locator("optgroup").first().locator("option")).toHaveText(["Kadıköy Vergi Dairesi Müdürlüğü"]);
  await expect(daire.locator("option", { hasText: "Çankaya" })).toHaveCount(0);
  await daire.selectOption("34250");

  await page.locator('input[name="unvan"]').fill("Örnek Ticaret Ltd. Şti.");
  await page.locator('input[name="vkn"]').fill("1234567890");
  await page.locator('input[name="adSoyad"]').fill("Ada Yılmaz");
  await page.locator('input[name="eposta"]').fill("ada@example.com");
  await page.locator('input[name="parola"]').fill("GucluParola2026");
  await page.locator('form button[type="submit"]').click();
  await expect.poll(() => govde).toMatchObject({ il: "İstanbul", ilce: "Kadıköy", vergiDairesiKodu: "34250", vergiDairesi: "Kadıköy Vergi Dairesi Müdürlüğü" });
});
