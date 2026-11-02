import { expect, test, type Page } from "@playwright/test";

const firmaId = "11111111-1111-4111-8111-111111111111";
const eskiId = "22222222-2222-4222-8222-222222222222";
const dosya = { name: "yeni-kase.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII=", "base64") };
async function kur(page: Page, yuklemeHatasi = false, silmeHatasi = false) {
  const state = { yazilar: [] as string[], kase: { id: eskiId, dosyaAdi: "eski-kase.png" }, yenilendi: false };
  const gorunum = { anaRenk: "#0f766e", ikincilRenk: "#1f2937", yaziTipi: "dejavu", yaziBoyutu: "normal", logoYeri: "sol", logoBoyutu: "orta", tabloBaslik: "dolu", zebra: true, kose: "yuvarlak", taslakFiligrani: true, metinler: {}, bolumler: Object.fromEntries(["teklif", "siparis", "proforma", "irsaliye", "makbuz", "fatura"].map(tur => [tur, { banka: true, yaziyla: true, imza: true, kodSutunu: true, kase: false }])) };
  page.on("pageerror", error => { throw error; });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async route => {
    const req = route.request(), url = new URL(req.url()), yol = url.pathname.replace("/api/v1", "");
    expect(url.origin).toBe(new URL(page.url()).origin);
    if (yol === "/ekler" && req.method() === "POST") {
      state.yazilar.push("yukle");
      expect(url.searchParams.get("sahipId")).toBe(firmaId);
      expect(url.searchParams.get("sahipTur")).toBe("firma_kase");
      expect(req.headers()["content-type"]).toContain("multipart/form-data; boundary=");
      expect(req.headers().authorization).toBeUndefined();
      expect(req.headers()["x-tekir-istek"]).toBe("1");
      if (yuklemeHatasi) return route.fulfill({ status: 413, json: { message: "Görsel çok büyük" } });
      state.kase = { id: "33333333-3333-4333-8333-333333333333", dosyaAdi: dosya.name };
      return route.fulfill({ status: 201, json: state.kase });
    }
    if (yol === `/ekler/${eskiId}` && req.method() === "DELETE") {
      state.yazilar.push("sil");
      return route.fulfill(silmeHatasi ? { status: 403, json: { message: "Eski görsel silinemedi" } } : { status: 204 });
    }
    if (yol === "/belge-gorunumu/onizleme") return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
    if (yol === "/belge-gorunumu") return route.fulfill({ json: { gorunum, firmaId, kase: state.kase } });
    if (yol === "/auth/ben") return route.fulfill({ json: { rol: "yonetici", userId: eskiId, tenantId: firmaId } });
    return route.fulfill({ json: yol === "/bildirimler/ozet" ? { okunmamis: 0, acik: 0, kritik: 0 } : yol === "/ebelge/uygulamalar" ? { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } } : [] });
  });
  await page.goto("/panel/ayarlar/belge-gorunumu");
  await expect(page.getByText("📎 eski-kase.png", { exact: true })).toBeVisible();
  return state;
}

test("başarısız kaşe yüklemesi mevcut görseli silmez", async ({ page }) => {
  const state = await kur(page, true);
  await page.locator('input[type="file"]').setInputFiles(dosya);
  await expect(page.getByText("Görsel çok büyük", { exact: true })).toBeVisible();
  expect(state.yazilar).toEqual(["yukle"]);
  await expect(page.getByText("📎 eski-kase.png", { exact: true })).toBeVisible();
});

test("kaşe aynı origin üzerinden yüklenir ve ancak başarıdan sonra eskisi silinir", async ({ page }) => {
  const state = await kur(page);
  await page.locator('input[type="file"]').setInputFiles(dosya);
  await expect(page.getByText("📎 yeni-kase.png", { exact: true })).toBeVisible();
  expect(state.yazilar).toEqual(["yukle", "sil"]);
  await page.reload();
  await expect(page.getByText("📎 yeni-kase.png", { exact: true })).toBeVisible();
});

test("eski görsel silinemese de yeni kaşe kullanılır ve kullanıcı bilgilendirilir", async ({ page }) => {
  const state = await kur(page, false, true);
  await page.locator('input[type="file"]').setInputFiles(dosya);
  await expect(page.getByText("📎 yeni-kase.png", { exact: true })).toBeVisible();
  await expect(page.getByText(/Önceki görsel silinemedi ve ekte korunuyor/)).toBeVisible();
  expect(state.yazilar).toEqual(["yukle", "sil"]);
});
