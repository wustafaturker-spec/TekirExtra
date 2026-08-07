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


test("kesinleştirme öncesi stok, cari, vergi ve e-Belge etkisi gösterilir", async ({ page }) => {
  await page.route("http://localhost:3001/api/v1/fatura", (route) => route.fulfill({ json: { kayitlar: [{
    id: "f1", no: null, tip: "satis", tarih: "2026-08-07", durum: "taslak",
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
    cari: { unvan: "Örnek Müşteri AŞ" }, odemeOzeti: { durum: "beklemede", odenen: "0", kalan: "1200" },
  }] } }));
  await page.route("http://localhost:3001/api/v1/fatura/f1", (route) => route.fulfill({ json: {
    id: "f1", no: null, tip: "satis", tarih: "2026-08-07", durum: "taslak", dovizCinsi: "TRY",
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
    cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri AŞ", vknTckn: "1234567890", eFaturaMukellefi: true },
    satirlar: [{ stokId: "s1", stokKod: "S001", stokAd: "Ürün", miktar: "2", birim: "adet" }],
    odemeOzeti: { durum: "beklemede", odenen: "0", kalan: "1200", hareketler: [] },
  } }));
  await page.route("http://localhost:3001/api/v1/cari/c1", (route) => route.fulfill({ json: {
    id: "c1", unvan: "Örnek Müşteri AŞ", bakiyeler: [],
    risk: { mevcutRisk: "300.00", limit: "5000.00", kalanLimit: "4700.00", asim: false },
  } }));

  await page.goto("/panel/fatura");
  await page.getByRole("button", { name: /Kesinleştir/ }).click();
  const panel = page.getByRole("dialog", { name: "Faturayı kesinleştir" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("KDV");
  await expect(panel).toContainText("200,00 TL");
  await expect(panel).toContainText("2 birim azalacak");
  await expect(panel).toContainText("1.200,00 TL borç yazılacak");
  await expect(panel).toContainText("e-Fatura kuyruğa alınacak");
  await expect(panel).toContainText("1.500,00 TL");
});


test("fatura kalemleri yalnız klavyeyle kesintisiz girilebilir", async ({ page }) => {
  await page.route("http://localhost:3001/api/v1/stok?adet=100", (route) => route.fulfill({ json: { kayitlar: [{
    id: "s1", kod: "STK-001", ad: "Klavye Ürünü", barkod: "8690000000001", anaBirim: "adet",
    kullanilabilirMiktar: "25", alisFiyati: "80.00", satisFiyati: "100.00", kdvOrani: "20",
    tedarikciUrunKodlari: ["TED-42"],
  }] } }));
  await page.route("http://localhost:3001/api/v1/stok/s1/tavsiye-fiyat**", (route) => route.fulfill({ json: { birimFiyat: 100, iskontoOrani: 0 } }));

  await page.goto("/panel/fatura?yon=satis&yeni=1");
  const urun = page.getByRole("combobox", { name: "1. satır ürün veya hizmet seçimi" });
  await urun.fill("TED-42");
  await urun.press("Enter");

  const miktar = page.getByLabel("Miktar").first();
  await expect(miktar).toBeFocused();
  await miktar.fill("3");
  await miktar.press("Tab");
  await expect(page.getByLabel("Birim fiyat").first()).toBeFocused();
  await page.getByLabel("Birim fiyat").first().fill("125");
  await page.getByLabel("Birim fiyat").first().press("Tab");
  await expect(page.getByLabel("İskonto yüzdesi").first()).toBeFocused();
  await page.getByLabel("İskonto yüzdesi").first().press("Tab");
  const kdv = page.getByLabel("KDV yüzdesi").first();
  await expect(kdv).toBeFocused();
  await kdv.press("Enter");

  await expect(page.getByRole("combobox", { name: "2. satır ürün veya hizmet seçimi" })).toBeFocused();
  await expect(page.getByLabel("Miktar")).toHaveCount(2);
  await expect(page.getByText("450,00 TL", { exact: true }).last()).toBeVisible();
});


test("hatalı e-Belge nedeni gösterilir ve yeniden gönderilebilir", async ({ page }) => {
  let yenidenGonderildi = false;
  const liste = {
    id: "f1", no: "SAT2026000002", tip: "satis", tarih: "2026-08-07", durum: "kesin",
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
    cari: { unvan: "Örnek Müşteri AŞ" },
    ebelge: { id: "e1", durum: "hata", tur: "efatura" },
    odemeOzeti: { durum: "odenmedi", odenen: "0", kalan: "1200" },
  };
  await page.route("http://localhost:3001/api/v1/fatura", (route) => route.fulfill({ json: { kayitlar: [liste] } }));
  await page.route("http://localhost:3001/api/v1/fatura/f1", (route) => route.fulfill({ json: {
    ...liste, dovizCinsi: "TRY", cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri AŞ", vknTckn: "1234567890", eFaturaMukellefi: true },
    satirlar: [], odemeOzeti: { ...liste.odemeOzeti, hareketler: [] },
    ebelge: { id: "e1", durum: yenidenGonderildi ? "kuyrukta" : "hata", tur: "efatura", entegratorRef: null,
      hataMesaji: yenidenGonderildi ? null : "Alıcı VKN bilgisi entegratör kaydıyla eşleşmiyor.",
      createdAt: "2026-08-07T08:00:00.000Z", updatedAt: "2026-08-07T08:05:00.000Z" },
  } }));
  await page.route("http://localhost:3001/api/v1/ebelge/gonder/f1", (route) => {
    yenidenGonderildi = true;
    return route.fulfill({ json: { kuyrugaAlindi: true } });
  });

  await page.goto("/panel/fatura");
  await page.getByTitle("e-Belge ayrıntısını aç").click();
  const panel = page.getByRole("dialog", { name: "e-Belge durumu" });
  await expect(panel).toContainText("Alıcı VKN bilgisi entegratör kaydıyla eşleşmiyor.");
  await panel.getByRole("button", { name: "Yeniden gönder" }).click();
  await expect(page.getByText("e-Belge yeniden gönderildi.")).toBeVisible();
  await expect(panel).toContainText("Kuyrukta");
  await expect(panel.getByRole("button", { name: "Yeniden gönder" })).not.toBeVisible();
  expect(yenidenGonderildi).toBe(true);
});
