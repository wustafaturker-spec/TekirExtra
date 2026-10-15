import { expect, test, type Page } from "@playwright/test";
const ozet = { acik: { adet: 0, toplamTry: "0", dovizler: {} }, geciken: { adet: 0, toplamTry: "0" }, yaklasan: { adet: 0, toplamTry: "0" }, bankada: { adet: 0, toplamTry: "0" }, ciro: { adet: 0, toplamTry: "0" }, karsiliksiz: { adet: 0, toplamTry: "0" } };
async function mockla(page: Page) {
  let yazma = 0;
  const listeIstekleri: string[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()), yol = url.pathname;
    let json: unknown = {};
    if (yol.endsWith("/auth/ben")) json = { userId: "u1", tenantId: "t1", rol: "yonetici" };
    else if (yol.endsWith("/ebelge/uygulamalar")) json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    else if (yol.endsWith("/cek-senet-ozet")) json = ozet;
    else if (yol.endsWith("/cek-senet-vade-analizi")) json = { bugun: "2026-10-14", uyari: "Dövizler ayrı toplanır.", gruplar: [
      { kod: "bugun", ad: "Bugün", baslangic: "2026-10-14", bitis: "2026-10-14",
        alinan: { adet: 1, dovizler: [{ doviz: "TRY", tutar: "100.01", adet: 1 }] }, verilen: { adet: 0, dovizler: [] } },
    ] };
    else if (yol.endsWith("/ai/cek/oku")) json = { veri: { belgeTuru: "CEK", cekNo: "00123", banka: "Test Banka", sube: "Merkez", hesapNo: "000123",
      borclu: "Test AŞ", kesideYeri: "İstanbul", tarih: "2026-12-31", tutar: "100.01", paraBirimi: "TRY", yaziylaTutar: null, guvenSkoru: 0.9 }, uyarilar: ["Bilgileri görüntüyle karşılaştırın."] };
    else if (yol.endsWith("/kasa-banka/cek-senet")) {
      if (route.request().method() === "POST") { yazma++; json = { id: "cek1" }; }
      else { listeIstekleri.push(url.search); json = []; }
    } else if (yol.endsWith("/cari")) json = { kayitlar: [], sonrakiImlec: null };
    else if (yol.endsWith("/kasalar") || yol.endsWith("/bankalar")) json = [];
    await route.fulfill({ json });
  });
  return { yazma: () => yazma, listeIstekleri };
}

test("görsel okuma formu doldurur fakat kullanıcı kontrol/onayı olmadan kayıt oluşturmaz", async ({ page }) => {
  const durum = await mockla(page);
  await page.goto("/panel/kasa-banka/cek-senet");
  await page.getByRole("button", { name: "+ Çek/Senet Al", exact: true }).click();
  await page.getByText("Çek/senet görüntüsünden yapay zekâ ile doldur", { exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "cek.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
  await page.getByRole("button", { name: "Görseli oku", exact: true }).click();
  await page.getByRole("button", { name: "Mevcut form alanlarını bu öneriyle doldur" }).click();
  await expect(page.getByPlaceholder("Çek üzerindeki seri/no")).toHaveValue("00123");
  await expect(page.getByPlaceholder("Çeki keşide eden kişi/firma")).toHaveValue("Test AŞ");
  await page.getByPlaceholder("CK-2026-001").fill("OCR-001");
  const kaydet = page.getByRole("button", { name: "Portföye Ekle", exact: true });
  await expect(kaydet).toBeDisabled(); expect(durum.yazma()).toBe(0);
  await page.getByRole("checkbox", { name: /Çek\/senet görüntüsüyle/ }).check();
  await expect(kaydet).toBeEnabled();
  await page.getByPlaceholder("Çek üzerindeki seri/no").fill("00124");
  await expect(kaydet).toBeDisabled();
  await page.getByRole("checkbox", { name: /Çek\/senet görüntüsüyle/ }).check();
  await kaydet.click(); await expect.poll(durum.yazma).toBe(1);
});

test("vade analizi bağlantısı yalnız açık evrak ve seçili tarih aralığını listeler", async ({ page }) => {
  const durum = await mockla(page);
  await page.goto("/panel/kasa-banka/cek-senet");
  await page.getByRole("button", { name: "1 evrak · 100.01 TRY", exact: true }).click();
  await expect.poll(() => durum.listeIstekleri.some((q) => {
    const s = new URLSearchParams(q); return s.get("acik") === "1" && s.get("baslangic") === "2026-10-14" && s.get("bitis") === "2026-10-14" && s.get("yon") === "alinan";
  })).toBe(true);
  await page.getByRole("button", { name: "Analiz filtresini kaldır" }).click();
  await expect.poll(() => new URLSearchParams(durum.listeIstekleri.at(-1)).has("acik")).toBe(false);
});

test("vade analizi mobilde sayfa genişliğini taşırmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockla(page); await page.goto("/panel/kasa-banka/cek-senet");
  await expect(page.getByText("Çek/senet vade analizi", { exact: true })).toBeVisible();
  const olcum = await page.evaluate(() => ({ genislik: window.innerWidth, sayfa: document.documentElement.scrollWidth,
    tasanlar: [...document.querySelectorAll("main *, .cheque-page *")].map((e) => ({ sinif: e.className, etiket: e.tagName, sag: Math.round(e.getBoundingClientRect().right), genislik: Math.round(e.getBoundingClientRect().width) }))
      .filter((e) => e.sag > window.innerWidth + 2).slice(0, 20) }));
  expect(olcum.sayfa, JSON.stringify(olcum)).toBeLessThanOrEqual(olcum.genislik + 2);
});
