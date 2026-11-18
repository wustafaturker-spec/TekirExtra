import { expect, test } from "@playwright/test";
import { ortakYanit } from "./ortak-yanit";

test("stok fiyat ve endeks sonucu yalnız geçerli güncel filtrelerle görünür", async ({ page }) => {
  const stok = { id: "stok-1", kod: "STK-001", ad: "Test Ürün", tip: "urun", anaBirim: "adet", kdvOrani: "20",
    mevcutMiktar: "10", kullanilabilirMiktar: "10", rezerveMiktar: "0", yoldakiMiktar: "0", ortalamaMaliyet: "75",
    alisFiyati: "80", satisFiyati: "100", aktif: true, birimler: [], barkodlar: [], tedarikciler: [], izinliEylemler: [] };
  let hata = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const yol = url.pathname.replace("/api/v1", "");
    if (yol === "/auth/ben") return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol === "/stok/stok-1") return route.fulfill({ json: stok });
    if (yol === "/fiyat-endeks/secenekler") return route.fulfill({ json: {
      erisim: { satis: true, alis: false }, buAy: "2026-11",
      endeksler: [{ kod: "TUFE", ad: "TÜFE" }], fiyatListeleri: [{ id: "l1", ad: "Bayi", dovizCinsi: "TRY" }],
    } });
    if (yol === "/fiyat-endeks/urun/stok-1") {
      if (hata) return route.fulfill({ status: 503, json: { message: "Karşılaştırma alınamadı." } });
      const baz = url.searchParams.get("baz");
      return route.fulfill({ json: { stok, baz, aylar: [baz], esik: { enAzSatir: 3 }, seriler: [], endeksler: [],
        ekCizgiler: [], ekCizgiOlcegi: null, birimGecmisi: [], uyarilar: [] } });
    }
    return route.fulfill(ortakYanit(yol) ?? { json: [] });
  });
  await page.goto("/panel/stok/stok-1");
  await page.getByRole("tab", { name: "Fiyat ve endeks" }).click();
  const csv = page.getByRole("button", { name: "Excel (CSV) indir" });
  await expect(csv).toBeVisible();
  await page.getByRole("button", { name: "Özel", exact: true }).click();
  const baslangic = page.getByLabel("Başlangıç ayı");
  await page.getByLabel("Bitiş ayı").fill("2026-05");
  await expect(csv).toBeVisible();
  await baslangic.fill("2026-06");
  await expect(page.getByText("Başlangıç ayı bitiş ayından sonra olamaz.")).toBeVisible();
  await expect(csv).toHaveCount(0);
  await expect(page.getByText("Aylık veriler", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Karşılaştırma hesaplanıyor…")).toHaveCount(0);
  await baslangic.fill("");
  await expect(page.getByText("Başlangıç ve bitiş ayını seçin.")).toBeVisible();
  hata = true;
  await baslangic.fill("2026-04");
  await expect(page.getByRole("alert").filter({ hasText: "Karşılaştırma alınamadı." })).toBeVisible();
  await expect(csv).toHaveCount(0);
  hata = false;
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(csv).toBeVisible();
  await page.getByRole("button", { name: "Fiyat listesine göre", exact: true }).click();
  await expect(page.getByText("Fiyat listesine göre karşılaştırma için en az bir liste seçin.")).toBeVisible();
  await expect(csv).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Bayi" }).check();
  await expect(csv).toBeVisible();
  await page.getByRole("checkbox", { name: "TÜFE" }).uncheck();
  await expect(page.getByText("En az bir endeks seçin.")).toBeVisible();
  await expect(csv).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("endeks fiyat önerisi tek istekle ONY'ye gider ve bekleme sonucu gösterilir", async ({ page }) => {
  const listeId = "11111111-1111-4111-8111-111111111111";
  const stokId = "22222222-2222-4222-8222-222222222222";
  const surum = "a".repeat(64);
  const yazimlar: unknown[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (yol === "/auth/ben") return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol === "/fiyat-listeleri") return route.fulfill({ json: [{ id: listeId, ad: "Bayi", dovizCinsi: "TRY", aktif: true, kalemSayisi: 1, cariSayisi: 0 }] });
    if (yol === `/fiyat-listeleri/${listeId}`) return route.fulfill({ json: { id: listeId, ad: "Bayi", dovizCinsi: "TRY", aktif: true, cariSayisi: 0, kalemler: [{ id: "kalem1", stokId, kod: "UR1", ad: "Ürün", anaBirim: "adet", fiyat: "100.0000" }] } });
    if (yol === "/fiyat-endeks/secenekler") return route.fulfill({ json: { erisim: { satis: true, alis: true }, endeksler: [{ kod: "TUFE", ad: "TÜFE", tur: "endeks" }, { kod: "YIUFE", ad: "Yİ-ÜFE", tur: "endeks" }] } });
    if (yol === "/fiyat-endeks/fiyat-onerisi") return route.fulfill({ json: {
      liste: { id: listeId, ad: "Bayi" }, surum, endeks: { kod: "TUFE", ad: "TÜFE", tur: "endeks", bazYili: "2025=100", sonAy: "2026-10-01" },
      satirlar: [{ stokId, kod: "UR1", ad: "Ürün", birim: "adet", eskiFiyat: "100.0000", sonDegisim: "2026-01-01", durum: "oneri", bazAy: "2026-01-01", sonAy: "2026-10-01", endeksDegisim: "20.00", yeniFiyat: "120.0000", fark: "20.0000", neden: null }],
      ozet: { oneri: 1, toplam: 1 },
    } });
    if (yol === `/fiyat-listeleri/${listeId}/toplu-fiyat`) {
      yazimlar.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { kod: "ONAY_GEREKLI", message: "Fiyat değişikliği için onay talebi açıldı.", onayTalebiId: "talep1" } });
    }
    if (yol === "/stok") return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
    const ortak = ortakYanit(yol);
    return route.fulfill(ortak ?? { json: {} });
  });
  await page.goto("/panel/stok/fiyat-listeleri");
  await page.getByRole("button", { name: /Kalemler/ }).click();
  await page.getByText("Endekse göre fiyat güncelleme önerisi", { exact: true }).click();
  const onizle = page.getByRole("button", { name: "Önizle", exact: true });
  const uygula = page.getByRole("button", { name: "Seçilen 1 kalemi bu listeye uygula" });
  const onayla = page.getByRole("button", { name: "Evet, uygula", exact: true });
  const degisiklikler = [
    () => page.getByLabel("Endeks", { exact: true }).selectOption("YIUFE"),
    () => page.getByLabel("Yuvarlama", { exact: true }).selectOption({ index: 1 }),
    () => page.getByLabel("Fiyat geçmişi olmayan kalemlerde baz ay").fill("2026-01"),
  ];
  for (const degistir of degisiklikler) {
    await onizle.click();
    await uygula.click();
    await expect(onayla).toBeVisible();
    await degistir();
    await expect(onayla).toHaveCount(0);
    await expect(uygula).toHaveCount(0);
    await expect(page.getByText("Ayarlar değişti. Uygulamadan önce yeniden önizleyin.")).toBeVisible();
  }
  expect(yazimlar).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await onizle.click();
  await expect(uygula).toBeVisible();
  await uygula.click();
  await onayla.scrollIntoViewIfNeeded();
  await expect(onayla).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await onayla.click();
  await expect(page.getByText("Fiyat değişikliği için onay talebi açıldı.", { exact: true })).toBeVisible();
  expect(yazimlar).toEqual([{ surum, kaynak: "endeks", kalemler: [{ stokId, fiyat: "120.0000" }] }]);
  await expect(page.getByRole("button", { name: "Evet, uygula", exact: true })).toHaveCount(0);
});
