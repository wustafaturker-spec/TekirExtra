import { expect, test } from "@playwright/test";
import { ortakYanit } from "./ortak-yanit";

test("OCR listesi hatayı ayırır, mobil kart ve inceleme penceresi taşmaz", async ({ page }) => {
  const belge = { id: "b1", dosyaAdi: "uzun-dosya-adli-orneklendirilmis-alis-faturasi-2026-11.pdf",
    dosyaBoyutu: 1024, sayfaSayisi: 1, mimeTip: "application/pdf", durum: "INCELENECEK",
    guvenPuani: "0.6", mukerrerAdayId: null, createdAt: "2026-11-18T12:00:00Z",
    cikarilanVeri: { genelToplam: 1234.5, paraBirimi: "TRY", saticiUnvan: "Örnek Tedarikçi", belgeNo: "FT-101" } };
  let ilkIstegiBirak!: () => void;
  const ilkIstek = new Promise<void>((resolve) => { ilkIstegiBirak = resolve; });
  let listeHatasi = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (yol === "/auth/ben") return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol === "/ai/belge-kuyruk/isler") {
      await ilkIstek;
      if (listeHatasi) return route.fulfill({ status: 503, json: { message: "Belge kuyruğuna ulaşılamadı." } });
      return route.fulfill({ json: { kayitlar: [{ id: "i1", belgeler: [belge] }] } });
    }
    if (yol === "/ai/belge-kuyruk/belgeler/b1") return route.fulfill({ json: belge });
    return route.fulfill(ortakYanit(yol) ?? { json: [] });
  });
  await page.goto("/panel/belgeler/tarama", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Belgeler yükleniyor…", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Görüntülenen belgeler")).toHaveCount(0);
  ilkIstegiBirak();
  await expect(page.getByText("Belge kuyruğuna ulaşılamadı.", { exact: true })).toBeVisible();
  await expect(page.getByText("Henüz belge yok.", { exact: true })).toHaveCount(0);
  listeHatasi = false;
  await page.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  const kart = page.getByRole("row").filter({ hasText: belge.dosyaAdi });
  await expect(kart.getByText("1.234,50 TRY")).toBeVisible();
  await expect(kart.getByText("İncelenecek", { exact: true })).toBeVisible();
  await expect(kart.getByText("Örnek Tedarikçi")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await kart.getByRole("button", { name: "İncele" }).click();
  const inceleme = page.getByRole("dialog", { name: /Belge İnceleme/ });
  await expect(inceleme.getByLabel("Satıcı Ünvanı")).toHaveValue("Örnek Tedarikçi");
  await expect(inceleme.getByRole("button", { name: "Masraf Taslağı Oluştur" })).toBeVisible();
  await expect.poll(() => inceleme.evaluate((oge) => oge.scrollWidth <= oge.clientWidth)).toBe(true);
  await inceleme.getByRole("button", { name: "Kapat", exact: true }).last().click();
  await page.getByRole("combobox", { name: "Belge durumu" }).selectOption("ISLENDI");
  await expect(page.getByText("Bu duruma uyan belge yok.", { exact: true })).toBeVisible();
});
