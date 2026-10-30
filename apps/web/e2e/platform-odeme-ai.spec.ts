import { expect, test, type Page, type Route } from "@playwright/test";

const bosFatura = { faturalayan: null, kartHesap: null, elleHesap: null, baslangicAt: null, hesaplar: [], sorunlu: [] };
const firmalar = [{ tenantId: "a", unvan: "Firma A", vkn: "1234567890" }, { tenantId: "b", unvan: "Firma B", vkn: "9999999999" }, { tenantId: "c", unvan: "Firma C", vkn: "1111111111" }];
const hesap = (id: string, ad: string, doviz = "TRY") => ({ tur: "banka", id, ad, doviz });
const satir = (page: Page, unvan: string) => page.getByRole("row").filter({ has: page.getByRole("spinbutton", { name: `${unvan} özel tavan`, exact: true }) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-odeme-ai-test"));
  await page.route("**/api/v1/platform/**", (route) => {
    const yol = new URL(route.request().url()).pathname;
    return route.fulfill({ json: yol.endsWith("/auth/ben") ? { kullaniciId: "p1", eposta: "ekip@example.test", rol: "yonetici" } : yol.endsWith("/abonelik-fatura") ? bosFatura : yol.endsWith("/firmalar") ? firmalar : [] });
  });
});

test("AI tavan kaydı diğer taslakları korur, sıfır ve boş değer ayrı kaydedilir", async ({ page }) => {
  const kiracilar = [
    { tenantId: "a", unvan: "Firma A", saglayici: "varsayilan", platformAnahtari: true, kiraciButcesiUsd: 20, buAyUsd: 20, tahminiCagri: 2, ozelTavanUsd: 100 as number | null, uygulananTavanUsd: 100 },
    { tenantId: "b", unvan: "Firma B", saglayici: "varsayilan", platformAnahtari: true, kiraciButcesiUsd: null, buAyUsd: 5, tahminiCagri: 0, ozelTavanUsd: null, uygulananTavanUsd: 50 },
  ];
  const kayitlar: unknown[] = [];
  await page.route("**/api/v1/platform/ai/kiracilar", (route) => route.fulfill({ json: { ayBaslangici: "2026-10-01", platformSaglayicisi: "openai", varsayilanTavanUsd: 50, fiyat: { giris: 2, cikis: 8 }, kiracilar } }));
  await page.route("**/api/v1/platform/ai/kiracilar/a/tavan", async (route) => { const body = route.request().postDataJSON(); kayitlar.push(body); kiracilar[0].ozelTavanUsd = body.aylikTavanUsd; kiracilar[0].uygulananTavanUsd = body.aylikTavanUsd ?? 50; await route.fulfill({ json: {} }); });
  await page.goto("/platform/yapay-zeka");
  await expect(satir(page, "Firma A").getByText("Limit doldu")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Firma B özel tavan" }).fill("12.5");
  await page.getByRole("spinbutton", { name: "Firma A özel tavan" }).fill("0");
  await satir(page, "Firma A").getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Firma B özel tavan" })).toHaveValue("12.5");
  await expect(page.getByRole("spinbutton", { name: "Firma A özel tavan" })).toHaveValue("0");
  await page.getByRole("spinbutton", { name: "Firma A özel tavan" }).fill("");
  await satir(page, "Firma A").getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(satir(page, "Firma A").getByText("Varsayılan", { exact: true })).toBeVisible();
  expect(kayitlar).toEqual([{ aylikTavanUsd: 0 }, { aylikTavanUsd: null }]);
  await expect(page.getByRole("spinbutton", { name: "Firma B özel tavan" })).toHaveValue("12.5");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-ai-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-ai-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("spinbutton", { name: "Firma B özel tavan" }).fill("-1");
  await expect(page.getByRole("spinbutton", { name: "Firma B özel tavan" })).toHaveAttribute("aria-invalid", "true");
  await expect(satir(page, "Firma B").getByRole("button", { name: "Kaydet", exact: true })).toBeDisabled();
  await page.getByLabel("Kullanım filtresi").selectOption("dolu");
  await expect(page.getByRole("spinbutton", { name: "Firma B özel tavan" })).toHaveCount(0);
});

test("fatura hesabı yüklenemediğinde kayıt engellenir ve geciken eski firma hesabı yeni seçimi değiştirmez", async ({ page }) => {
  let ilkIstegiAl!: (route: Route) => void;
  const ilkIstek = new Promise<Route>((resolve) => { ilkIstegiAl = resolve; });
  let govde: unknown;
  await page.route("**/api/v1/platform/abonelik-fatura/hesaplar/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    if (id === "a") { ilkIstegiAl(route); return; }
    return route.fulfill(id === "c" ? { status: 503, json: { message: "Hesap servisi kapalı." } } : { json: [hesap("b1", "B tahsilat"), hesap("usd", "Dolar hesabı", "USD")] });
  });
  await page.route("**/api/v1/platform/abonelik-fatura", async (route) => { if (route.request().method() === "PUT") { govde = route.request().postDataJSON(); await route.fulfill({ json: { mesaj: "Fatura ayarı kaydedildi." } }); } else await route.fulfill({ json: bosFatura }); });
  page.on("dialog", (d) => void d.accept());
  await page.goto("/platform/odeme");
  const kart = page.locator(".platform-invoice-card");
  await kart.getByLabel("Faturalayan firma").selectOption("a");
  const eski = await ilkIstek;
  await kart.getByLabel("Faturalayan firma").selectOption("b");
  const secim = kart.getByLabel("Kartla alınan ödemelerin hesabı");
  await expect(secim.locator("option")).toHaveText(["— Seçilmedi (tahsilat açılmaz) —", "Banka · B tahsilat"]);
  await eski.fulfill({ json: [hesap("a1", "A tahsilat")] }).catch(() => undefined);
  await expect(secim.locator("option")).toHaveCount(2);
  await kart.getByLabel("Faturalayan firma").selectOption("c");
  await expect(kart.getByText(/Hesap servisi kapalı/)).toBeVisible();
  await expect(kart.getByRole("button", { name: "Kaydet", exact: true })).toBeDisabled();
  await kart.getByLabel("Faturalayan firma").selectOption("b");
  await secim.selectOption("banka:b1");
  await kart.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Fatura ayarı kaydedildi.")).toBeVisible();
  expect(govde).toEqual({ faturalayanTenantId: "b", kartHesap: { tur: "banka", id: "b1" }, elleHesap: null });
});

test("fatura yeniden denemesi kaydedilmemiş ayarları korur", async ({ page }) => {
  await page.route("**/api/v1/platform/abonelik-fatura", (route) => route.fulfill({ json: { ...bosFatura, faturalayan: firmalar[0], sorunlu: [{ odemeId: "o1", firma: "Müşteri", durum: "hata", faturaNo: null, hata: "Geçersiz VKN", deneme: 2, guncellendi: "2026-10-30T08:00:00Z" }] } }));
  await page.route("**/api/v1/platform/abonelik-fatura/hesaplar/b", (route) => route.fulfill({ json: [hesap("b1", "B tahsilat")] }));
  await page.route("**/api/v1/platform/abonelik-fatura/o1/yeniden-dene", (route) => route.fulfill({ json: { mesaj: "İşleme alındı." } }));
  await page.goto("/platform/odeme");
  const kart = page.locator(".platform-invoice-card");
  await kart.getByLabel("Faturalayan firma").selectOption("b");
  await kart.getByLabel("Kartla alınan ödemelerin hesabı").selectOption("banka:b1");
  await kart.getByRole("button", { name: "Yeniden dene", exact: true }).click();
  await expect(page.getByText("İşleme alındı.")).toBeVisible();
  await expect(kart.getByLabel("Faturalayan firma")).toHaveValue("b");
  await expect(kart.getByLabel("Kartla alınan ödemelerin hesabı")).toHaveValue("banka:b1");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-fatura-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("sağlayıcı kaydından sonra gizli alan temizlenir, diğer sağlayıcının taslağı korunur", async ({ page }) => {
  let etkin = false;
  let govde: unknown;
  await page.route("**/api/v1/platform/odeme-saglayicilari", (route) => route.fulfill({ json: [
    { saglayici: "iyzico", ad: "iyzico", bagli: true, ortam: "test", etkin, guncellendi: null, alanlar: [{ anahtar: "secretKey", etiket: "Gizli anahtar", gizli: true, dolu: etkin }] },
    { saglayici: "paytr", ad: "PayTR", bagli: true, ortam: "test", etkin: false, guncellendi: null, bildirimAdresi: "https://api.example.test/bildirim", alanlar: [{ anahtar: "magazaId", etiket: "Mağaza no", gizli: false, dolu: false, deger: "" }] },
  ] }));
  await page.route("**/api/v1/platform/odeme-saglayicilari/iyzico", async (route) => { govde = route.request().postDataJSON(); etkin = true; await route.fulfill({ json: { mesaj: "iyzico etkinleştirildi." } }); });
  await page.goto("/platform/odeme");
  const iyzico = page.locator(".platform-provider-card").filter({ hasText: "iyzico" });
  const paytr = page.locator(".platform-provider-card").filter({ hasText: "PayTR" });
  await iyzico.getByLabel("Gizli anahtar").fill("ornek-gizli");
  await paytr.getByLabel("Mağaza no").fill("taslak-magaza");
  await iyzico.getByRole("button", { name: "Kaydet ve etkinleştir" }).click();
  await expect(page.getByText("iyzico etkinleştirildi.")).toBeVisible();
  await expect(iyzico.getByLabel("Gizli anahtar")).toHaveValue("");
  await expect(paytr.getByLabel("Mağaza no")).toHaveValue("taslak-magaza");
  expect(govde).toEqual({ ortam: "test", etkin: true, alanlar: { secretKey: "ornek-gizli" } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-odeme-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-odeme-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
