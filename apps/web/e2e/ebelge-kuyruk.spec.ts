import { expect, test } from "@playwright/test";
import { ortakYanit } from "./ortak-yanit";

test("e-Belge kuyruğu hatayı, son veriyi ve boş kuyruğu ayrı gösterir", async ({ page }) => {
  let durum: "hata" | "kayit" | "bos" = "hata";
  let ilkIstegiBirak!: () => void;
  const ilkIstek = new Promise<void>((resolve) => { ilkIstegiBirak = resolve; });
  await page.clock.install();
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (yol === "/auth/ben") return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol === "/ebelge/uygulamalar") return route.fulfill({ json: { efatura: { acik: true }, earsiv: { acik: true } } });
    if (yol === "/ebelge/kuyruk/ozet") return route.fulfill({ json: {
      sayilar: { waiting: 0, active: 0, delayed: 0, failed: durum === "kayit" ? 1 : 0, "dead-letter": 0, completed: 0 }, calisanWorker: 1,
    } });
    if (yol === "/ebelge/kuyruk") {
      await ilkIstek;
      if (durum === "hata") return route.fulfill({ status: 503, json: { message: "Kuyruk servisine ulaşılamadı." } });
      return route.fulfill({ json: durum === "bos" ? [] : [{
        id: "is-1", faturaId: null, isTuru: "ebelge-gonder", durum: "failed", deneme: 3, azamiDeneme: 3,
        hata: "Örnek entegratör hatası", kuyrugaAlinmaZamani: "2026-11-18T08:00:00Z", islenmeZamani: null, tamamlanmaZamani: null,
      }] });
    }
    return route.fulfill(ortakYanit(yol) ?? { json: [] });
  });

  await page.goto("/panel/ebelge/kuyruk");
  await expect(page.getByText("Kuyruk bilgileri yükleniyor…", { exact: true })).toBeVisible();
  await expect(page.getByText("Toplam görünür iş")).toHaveCount(0);
  ilkIstegiBirak();
  const hata = page.getByText("Kuyruk servisine ulaşılamadı.", { exact: true });
  await expect(hata).toBeVisible();
  await expect(page.getByText("Toplam görünür iş")).toHaveCount(0);
  await expect(page.getByText("Bu durumda iş bulunmuyor")).toHaveCount(0);

  durum = "kayit";
  await page.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  await expect(page.getByText("Örnek entegratör hatası")).toBeVisible();
  const yenidenDene = page.getByRole("button", { name: "Güvenle yeniden dene", exact: true });
  await expect(yenidenDene).toBeEnabled();

  durum = "hata";
  await page.clock.fastForward(10_000);
  await expect(page.getByText("Son başarılı güncellemenin verileri gösteriliyor.")).toBeVisible();
  await expect(page.getByText("Örnek entegratör hatası")).toBeVisible();
  await expect(yenidenDene).toBeDisabled();

  durum = "bos";
  await page.clock.fastForward(10_000);
  await expect(hata).toHaveCount(0);
  await expect(page.getByText("Bu durumda iş bulunmuyor")).toBeVisible();
  await expect(page.getByRole("button", { name: /Toplam görünür iş 0/ })).toBeVisible();
});
