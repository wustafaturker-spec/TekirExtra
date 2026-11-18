import { expect, test } from "@playwright/test";
import { ortakYanit } from "./ortak-yanit";

test("onay kutusu liste hatasından toparlanır ve kararları uygulama içinde alır", async ({ page }) => {
  const talep = { id: "t1", islemAdi: "Satış faturasını kesinleştir", ozet: "SF-100 · Örnek müşteri", tutarTry: "2500",
    nedenler: ["Tutar eşiği"], durum: "bekliyor", adim: 0, kuralAdi: "Tutar kontrolü", adimlar: [{ rol: "yonetici" }],
    kararlar: [], talepEden: "Örnek kullanıcı", hata: null, createdAt: "2026-11-18T12:00:00Z", hedefTur: "fatura", hedefId: "f1" };
  let listeHatasi = true;
  const kararlar: { tur: string; gerekce: string | null }[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const yol = url.pathname.replace("/api/v1", "");
    if (yol === "/auth/ben") return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol === "/onaylar") {
      if (listeHatasi) return route.fulfill({ status: 503, json: { message: "Onay kutusuna ulaşılamadı." } });
      return route.fulfill({ json: { talepler: [talep], digerOnaylar: [] } });
    }
    if (yol.startsWith("/onaylar/t1/")) {
      const tur = yol.split("/").at(-1)!;
      kararlar.push({ tur, gerekce: route.request().postDataJSON().gerekce });
      return route.fulfill({ json: { ...talep, durum: tur === "onayla" ? "onaylandi" : "reddedildi" } });
    }
    return route.fulfill(ortakYanit(yol) ?? { json: [] });
  });
  await page.goto("/panel/onaylar", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Onay kutusuna ulaşılamadı.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Onaylar yükleniyor…")).toHaveCount(0);
  await expect(page.getByText("Onayınızı bekleyen talep yok.")).toHaveCount(0);
  listeHatasi = false;
  await page.getByRole("button", { name: "Tekrar dene" }).click();

  await page.getByRole("button", { name: "Onayla", exact: true }).click();
  const onay = page.getByRole("dialog", { name: "Talebi onayla" });
  await expect(onay.getByText(/Bu son onay/)).toBeVisible();
  await expect(onay.getByText("TL karşılığı 2.500,00 ₺")).toBeVisible();
  await expect(onay.getByRole("link", { name: /Hedef kaydı aç/ })).toHaveAttribute("href", "/panel/fatura?faturaId=f1");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await onay.getByRole("button", { name: "Vazgeç" }).click();
  expect(kararlar).toEqual([]);

  await page.getByRole("button", { name: "Reddet", exact: true }).click();
  const ret = page.getByRole("dialog", { name: "Talebi reddet" });
  const reddet = ret.getByRole("button", { name: "Talebi reddet" });
  await ret.getByLabel(/Ret gerekçesi/).fill(" a ");
  await expect(reddet).toBeDisabled();
  await ret.getByLabel(/Ret gerekçesi/).fill("  Fatura tutarını kontrol edin.  ");
  await reddet.click();
  await expect(page.getByText("Talep reddedildi.")).toBeVisible();
  expect(kararlar).toEqual([{ tur: "reddet", gerekce: "Fatura tutarını kontrol edin." }]);

  await page.getByRole("tab", { name: "Taleplerim" }).click();
  await page.getByRole("button", { name: "Geri çek", exact: true }).click();
  await page.getByRole("dialog", { name: "Talebi geri çek" }).getByRole("button", { name: "Talebi geri çek" }).click();
  await expect(page.getByText("Talep geri çekildi.")).toBeVisible();
  expect(kararlar.at(-1)).toEqual({ tur: "geri-cek", gerekce: null });

  await page.getByRole("tab", { name: "Onayımı bekleyenler" }).click();
  await page.getByRole("button", { name: "Onayla", exact: true }).click();
  await onay.getByRole("button", { name: "Talebi onayla" }).click();
  await expect(page.getByText("Onaylandı ve işlem yapıldı.")).toBeVisible();
  expect(kararlar.at(-1)).toEqual({ tur: "onayla", gerekce: null });
});
