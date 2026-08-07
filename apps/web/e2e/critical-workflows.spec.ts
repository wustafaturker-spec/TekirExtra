import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tekir_access", "e2e-token"));
  await page.route("http://localhost:3001/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/ben")) {
      await route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
      return;
    }
    if (url.pathname.endsWith("/fatura")) {
      await route.fulfill({ json: { kayitlar: [] } });
      return;
    }
    if (url.pathname.endsWith("/cari") || url.pathname.endsWith("/stok")) {
      await route.fulfill({ json: { kayitlar: [] } });
      return;
    }
    if (url.pathname.endsWith("/depo")) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: {} });
  });
});

test("satış ve satın alma çalışma alanları doğru belge bağlamını taşır", async ({ page }) => {
  await page.goto("/panel/satis");
  await expect(page.getByRole("heading", { level: 1, name: "Satış" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Satış faturası/ }).first()).toHaveAttribute(
    "href",
    "/panel/fatura?yon=satis&yeni=1",
  );
  await page.getByRole("link", { name: /Satış faturası/ }).first().click();
  await expect(page.getByRole("heading", { level: 3, name: "Yeni satış faturası" })).toBeVisible();
  await expect(page.getByLabel("Fatura Tipi")).toHaveValue("satis");

  await page.goto("/panel/satin-alma");
  await expect(page.getByRole("heading", { level: 1, name: "Satın Alma" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Alış faturası/ }).first()).toHaveAttribute(
    "href",
    "/panel/fatura?yon=alis&yeni=1",
  );
  await page.getByRole("link", { name: /Alış faturası/ }).first().click();
  await expect(page.getByRole("heading", { level: 3, name: "Yeni alış faturası" })).toBeVisible();
  await expect(page.getByLabel("Fatura Tipi")).toHaveValue("alis");
});

test("kullanıcı panelden geri bildirim gönderebilir", async ({ page }) => {
  let gonderilen: unknown;
  await page.route("http://localhost:3001/api/v1/kullanim/geri-bildirim", async (route) => {
    gonderilen = route.request().postDataJSON();
    await route.fulfill({ json: { kaydedildi: true } });
  });

  await page.goto("/panel/satis");
  await page.getByRole("button", { name: "Geri bildirim ver" }).click();
  await expect(page.getByRole("dialog", { name: "Deneyiminizi paylaşın" })).toBeVisible();
  await page.getByRole("radio", { name: /4/ }).click();
  await page.getByLabel("Konu").selectOption("oneri");
  await page.getByLabel(/Açıklama/).fill("Kaydedilmiş görünümü ana sayfadan da açmak istiyorum.");
  await page.getByRole("button", { name: "Gönder", exact: true }).click();

  await expect(page.getByText("Geri bildiriminiz kaydedildi.")).toBeVisible();
  expect(gonderilen).toEqual({
    puan: 4,
    kategori: "oneri",
    mesaj: "Kaydedilmiş görünümü ana sayfadan da açmak istiyorum.",
  });
});


test("fatura, e-Belge ve ödeme durumları bağımsız izlenebilir", async ({ page }) => {
  await page.route("http://localhost:3001/api/v1/fatura", async (route) => {
    await route.fulfill({ json: { kayitlar: [{
      id: "f1", no: "SAT2026000001", tip: "satis", tarih: "2026-08-07", durum: "kesin",
      toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
      cari: { unvan: "Örnek Müşteri AŞ" },
      ebelge: { id: "e1", durum: "hata", tur: "efatura" },
      odemeOzeti: { durum: "kismi", odenen: "400.00", kalan: "800.00" },
    }] } });
  });

  await page.goto("/panel/fatura");
  await expect(page.getByRole("columnheader", { name: "Durum", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "e-Belge", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ödeme", exact: true })).toBeVisible();

  const satir = page.getByRole("row").filter({ hasText: "SAT2026000001" });
  await expect(satir).toContainText("Kesinleşti");
  await expect(satir).toContainText("Hata");
  await expect(satir).toContainText("Kısmi ödendi");

  await page.getByLabel("Fatura durumu").selectOption("kesin");
  await page.getByLabel("e-Belge durumu").selectOption("hata");
  await page.getByLabel("Ödeme durumu").selectOption("acik");
  await expect(page.getByLabel("Fatura durumu")).toHaveValue("kesin");
  await expect(page.getByLabel("e-Belge durumu")).toHaveValue("hata");
  await expect(page.getByLabel("Ödeme durumu")).toHaveValue("acik");
  await expect(satir).toBeVisible();
});


test("ana sayfa role uygun iş kuyruklarını ve finansal görünürlüğü sunar", async ({ page }) => {
  let rol: "satis" | "yonetici" = "satis";
  await page.route("http://localhost:3001/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/auth/ben")) return route.fulfill({ json: { rol } });
    if (pathname.endsWith("/firma")) return route.fulfill({ json: { unvan: "Örnek Firma" } });
    if (pathname.endsWith("/fatura")) return route.fulfill({ json: { kayitlar: [
      { tip: "satis", durum: "taslak", ebelge: null, odemeOzeti: { durum: "odenmedi" } },
      { tip: "alis", durum: "kesin", ebelge: { durum: "hata" }, odemeOzeti: { durum: "kismi" } },
    ] } });
    if (pathname.endsWith("/stok")) return route.fulfill({ json: { kayitlar: [] } });
    if (pathname.endsWith("/kasa-banka/ekstre/satirlar")) return route.fulfill({ json: [{ id: "e1" }] });
    if (pathname.endsWith("/ebelge/gelen")) return route.fulfill({ json: [{ id: "g1" }] });
    if (pathname.endsWith("/rapor/ozet")) return route.fulfill({ json: {
      nakitVarliklar: "1000", envanterDegeri: "2000", toplamAlacaklar: "3000",
      toplamBorclar: "1500", netVarlikDegeri: "4500",
    } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/panel");
  await expect(page.getByText(/Satış · Satış belgeleri/)).toBeVisible();
  await expect(page.getByText("Taslak satış faturaları")).toBeVisible();
  await expect(page.getByText("Açık tahsilatlar")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finansal görünüm" })).not.toBeVisible();

  rol = "yonetici";
  await page.reload();
  await expect(page.getByText(/Yönetim · Nakit/)).toBeVisible();
  await expect(page.getByText("e-Belge hataları")).toBeVisible();
  await expect(page.getByText("Eşleşmemiş banka hareketleri")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finansal görünüm" })).toBeVisible();
  await expect(page.getByText("4.500,00 TL")).toBeVisible();
});
