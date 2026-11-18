import { expect, test } from "@playwright/test";
import { ortakYanit } from "./ortak-yanit";

test("onay kuralları yüklenmeden değiştirilemez ve silme uygulama içinden onaylanır", async ({ page }) => {
  const kural = { id: "kural-1", ad: "Yüksek tutarlı ödemeler için yönetici onayı", islem: "kasa_banka_odeme",
    aktif: true, tutarEsigi: "50000", iskontoEsigi: null, riskAsimi: false, adimlar: [{ rol: "yonetici" }] };
  let ilkIstegiBirak!: () => void;
  const ilkIstek = new Promise<void>((resolve) => { ilkIstegiBirak = resolve; });
  let ilkOkumaHatasi = true;
  let silmeSayisi = 0;
  let esik: number | null = 75_000;
  const esikYazimlari: number[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (yol === "/auth/ben") return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol === "/kullanicilar") return route.fulfill({ json: [] });
    if (yol === "/onay-kurallari") {
      await ilkIstek;
      if (ilkOkumaHatasi) return route.fulfill({ status: 503, json: { message: "Kural listesine ulaşılamadı." } });
      return route.fulfill({ json: {
        kurallar: silmeSayisi ? [] : [kural], islemler: [{ islem: kural.islem, ad: "Kasa ve banka ödemesi" }],
        satinAlmaEsigi: esik, gorevAyriligiKapali: false, tekYonetici: false,
      } });
    }
    if (yol === "/onay-kurallari/satin-alma-esigi" && route.request().method() === "PUT") {
      esik = Number(route.request().postDataJSON().tutar);
      esikYazimlari.push(esik);
      return route.fulfill({ json: {} });
    }
    if (yol === "/onay-kurallari/kural-1" && route.request().method() === "DELETE") {
      silmeSayisi++;
      return route.fulfill({ json: {} });
    }
    return route.fulfill(ortakYanit(yol) ?? { json: [] });
  });
  await page.goto("/panel/ayarlar/onay-kurallari");
  const kaydet = page.getByRole("button", { name: "Kaydet", exact: true });
  const ekle = page.getByRole("button", { name: "Kural ekle", exact: true });
  const esikAlani = page.getByRole("textbox", { name: "Onay eşiği (TL)" });
  await expect(kaydet).toBeDisabled();
  await expect(ekle).toBeDisabled();
  ilkIstegiBirak();
  await expect(page.getByText("Kural listesine ulaşılamadı.")).toBeVisible();
  await expect(page.getByText("Kurallar yükleniyor…")).toHaveCount(0);
  await expect(kaydet).toBeDisabled();
  expect(esikYazimlari).toEqual([]);

  ilkOkumaHatasi = false;
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(esikAlani).toHaveValue("75000");
  await expect(ekle).toBeEnabled();
  await esikAlani.fill("80000");
  await kaydet.click();
  await expect(page.getByText("Satın alma eşiği kaydedildi.")).toBeVisible();
  await expect(kaydet).toBeEnabled();
  expect(esikYazimlari).toEqual([80_000]);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Sil", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Kuralı sil" });
  await expect(modal.getByText(kural.ad)).toBeVisible();
  await expect(modal.getByText(/Açık talepler etkilenmez/)).toBeVisible();
  await modal.getByRole("button", { name: "Vazgeç" }).click();
  expect(silmeSayisi).toBe(0);
  await page.getByRole("button", { name: "Sil", exact: true }).click();
  await modal.getByRole("button", { name: "Kuralı sil" }).click();
  await expect(page.getByText("Henüz onay kuralı yok", { exact: false })).toBeVisible();
  await expect(modal).toHaveCount(0);
  expect(silmeSayisi).toBe(1);
});
