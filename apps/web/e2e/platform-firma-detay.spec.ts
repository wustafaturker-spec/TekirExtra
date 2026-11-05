import { expect, test } from "@playwright/test";

const id = "00000000-0000-4000-8000-000000000201";
const kisi = "00000000-0000-4000-8000-000000000202";
const firma = { tenantId: id, unvan: "Takip Test Firması", vkn: "1234567890", planKodu: "baslangic", planAdi: "Başlangıç", durum: "aktif", aktifKullanici: 3, kayitTarihi: "2026-01-01T00:00:00Z", donemSonu: "2026-12-01T00:00:00Z", iptalTarihi: null, sonGiris: null, ebelgeSaglayici: null, bekleyenTalep: null };
const ilkTakip = { sorumluId: null, sorumluAdi: null, sorumluUygun: null, durum: "acik", sonrakiGorusme: null, surum: 0, gecikti: false, guncelleyen: null, updatedAt: null };
const liste = (kayitlar: unknown[] = []) => ({ kayitlar, toplam: kayitlar.length, sayfa: 1, sayfaBoyutu: 25 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/auth/ben", (r) => r.fulfill({ json: { eposta: "ekip@example.test", rol: "yonetici" } }));
  await page.route("**/api/v1/platform/firmalar/sayfali?*", (r) => r.fulfill({ json: { ...liste([firma]), sayilar: { toplam: 1, talep: 0, askiyaAlinacak: 0, askida: 0, iptal: 0 } } }));
  await page.route(`**/api/v1/platform/firmalar/${id}/gecmis`, (r) => r.fulfill({ json: { degisiklikler: [], talepler: [], odemeler: [] } }));
  await page.route("**/api/v1/platform/firmalar/takip-sorumlulari", (r) => r.fulfill({ json: [{ id: kisi, adSoyad: "Ayşe Yönetici" }] }));
  await page.route(`**/api/v1/platform/firmalar/${id}/takip`, (r) => r.fulfill({ json: ilkTakip }));
  await page.route(`**/api/v1/platform/firmalar/${id}/notlar?*`, (r) => r.fulfill({ json: liste() }));
  await page.route(`**/api/v1/platform/firmalar/${id}/olaylar?*`, (r) => r.fulfill({ json: liste() }));
  await page.route("**/api/v1/platform/gorevler?*", (r) => r.fulfill({ json: { ...liste(), bugun: "2026-11-02", sayilar: { acik: 0, devam_ediyor: 0, tamamlandi: 0, iptal: 0, geciken: 0, sorumluPasif: 0 } } }));
});

test("kalıcı detay açılır, takip kaydedilir ve diğer bölümün taslağı korunur", async ({ page }) => {
  let govde: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/platform/firmalar/${id}/takip`, async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: ilkTakip });
    govde = r.request().postDataJSON();
    await r.fulfill({ json: { ...ilkTakip, ...govde, surum: 1, sorumluAdi: "Ayşe Yönetici" } });
  });
  await page.goto(`/platform/firmalar/${id}?donus=${encodeURIComponent("/platform/firmalar?plan=baslangic&sayfa=3")}`);
  await expect(page.getByRole("heading", { name: firma.unvan, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Firma listesine dön" })).toHaveAttribute("href", "/platform/firmalar?plan=baslangic&sayfa=3");
  await page.getByLabel("Yeni iç not", { exact: true }).fill("Kaydedilmeyen taslak");
  await page.getByLabel("Firma sorumlusu", { exact: true }).selectOption(kisi);
  await page.getByLabel("Sonraki görüşme tarihi").fill("2026-11-15");
  await page.getByLabel("Takip durumu", { exact: true }).selectOption("bekliyor");
  await page.getByRole("button", { name: "Takibi kaydet" }).click();
  await expect(page.getByText("Firma takibi kaydedildi.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Yeni iç not", { exact: true })).toHaveValue("Kaydedilmeyen taslak");
  expect(govde).toEqual({ sorumluId: kisi, durum: "bekliyor", sonrakiGorusme: "2026-11-15", surum: 0 });
});

test("409 çakışmasında taslak korunur; güncel sürümle devam açıkça seçilir", async ({ page }) => {
  let deneme = 0;
  const govdeler: Record<string, unknown>[] = [];
  await page.route(`**/api/v1/platform/firmalar/${id}/takip`, async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: deneme ? { ...ilkTakip, surum: 2, durum: "bekliyor" } : ilkTakip });
    deneme++; govdeler.push(r.request().postDataJSON());
    return deneme === 1 ? r.fulfill({ status: 409, json: { message: "Firma takibi başka biri tarafından değiştirildi." } }) : r.fulfill({ json: { ...ilkTakip, ...govdeler.at(-1), surum: 3 } });
  });
  await page.goto(`/platform/firmalar/${id}`);
  await page.getByLabel("Sonraki görüşme tarihi").fill("2026-12-10");
  await page.getByRole("button", { name: "Takibi kaydet" }).click();
  await expect(page.getByRole("button", { name: "Takibi kaydet" })).toBeDisabled();
  await page.getByRole("button", { name: "Güncel kaydı göster" }).click();
  await expect(page.getByText("Sunucudaki güncel takip", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sonraki görüşme tarihi")).toHaveValue("2026-12-10");
  await page.getByRole("button", { name: "Taslağı koruyarak devam et" }).click();
  await page.getByRole("button", { name: "Takibi kaydet" }).click();
  await expect(page.getByText("Firma takibi kaydedildi.", { exact: true })).toBeVisible();
  expect(govdeler.map((g) => g.surum)).toEqual([0, 2]);
});

test("not yanıtı kaybolunca aynı anahtarla denenir; kaydedilen not ve geçmiş gösterilir", async ({ page }) => {
  const govdeler: { metin: string; islemAnahtari: string }[] = [];
  let tamam = false;
  await page.route(`**/api/v1/platform/firmalar/${id}/notlar?*`, (r) => r.fulfill({ json: liste(tamam ? [{ id: "n1", metin: "Görüşme tamamlandı", yazar: "Ayşe Yönetici", zaman: "2026-11-02T12:00:00Z" }] : []) }));
  await page.route(`**/api/v1/platform/firmalar/${id}/notlar`, async (r) => {
    govdeler.push(r.request().postDataJSON());
    if (govdeler.length === 1) return r.abort("failed");
    tamam = true; return r.fulfill({ json: { id: "n1", mesaj: "İç not kaydedildi." } });
  });
  await page.goto(`/platform/firmalar/${id}`);
  await page.getByLabel("Yeni iç not", { exact: true }).fill("Görüşme tamamlandı");
  await page.getByRole("button", { name: "İç not ekle" }).click();
  await expect(page.getByText("Failed to fetch", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "İç not ekle" }).click();
  await expect(page.locator(".platform-firma-notes")).toContainText("Görüşme tamamlandı");
  expect(govdeler[0].islemAnahtari).toBe(govdeler[1].islemAnahtari);
});

test("firma görevi oluşturma mevcut görev merkezine firma kimliğiyle gider", async ({ page }) => {
  await page.route("**/api/v1/platform/gorevler/katilimcilar", (r) => r.fulfill({ json: [{ id: kisi, adSoyad: "Ayşe Yönetici", rol: "yonetici" }] }));
  let govde: Record<string, unknown> | null = null;
  await page.route("**/api/v1/platform/gorevler", async (r) => { govde = r.request().postDataJSON(); await r.fulfill({ json: { id: id, ...govde, surum: 1 } }); });
  await page.goto(`/platform/firmalar/${id}`);
  await Promise.all([
    page.waitForURL(new RegExp(`firma=${id}`), { timeout: 120000 }),
    page.getByRole("link", { name: "Firma görevi oluştur" }).click(),
  ]);
  await expect(page).toHaveURL(new RegExp(`firma=${id}`));
  await expect(page.getByLabel("Görev kapsamı")).toHaveValue("platform");
  await expect(page.getByLabel("Görev kapsamı")).toBeDisabled();
  await page.getByLabel("Görev başlığı").fill("Firma görüşmesini yap");
  await page.getByRole("button", { name: "Görevi kaydet", exact: true }).click();
  await expect(page.getByText("Firma görüşmesini yap: görev kaydedildi.")).toBeVisible();
  await expect(page).not.toHaveURL(/yeni=1/);
  expect(govde).toMatchObject({ tenantId: id, kapsam: "platform", baslik: "Firma görüşmesini yap" });
});

test("mobil detay taşmaz; dış kökenli dönüş adresi kabul edilmez", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/platform/firmalar/${id}?donus=https://ornek.invalid`);
  await expect(page.getByRole("heading", { name: firma.unvan, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Firma listesine dön" })).toHaveAttribute("href", "/platform/firmalar");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/platform-firma-detay-mobile.png", fullPage: true });
});

test("sayfa içindeki iki ayrı ödeme ayrı işlem anahtarı kullanır", async ({ page }) => {
  const anahtarlar: string[] = [];
  await page.route(`**/api/v1/platform/firmalar/${id}/odeme`, async (r) => {
    anahtarlar.push(r.request().postDataJSON().islemAnahtari);
    await r.fulfill({ json: { mesaj: "Ödeme kaydedildi." } });
  });
  await page.goto(`/platform/firmalar/${id}`);
  for (const tutar of ["100,00", "200,00"]) {
    await page.getByLabel("Tutar (TL)").fill(tutar);
    await page.getByRole("button", { name: "Ödemeyi kaydet", exact: true }).click();
    await expect(page.getByLabel("Tutar (TL)")).toHaveValue("");
  }
  expect(anahtarlar).toHaveLength(2);
  expect(anahtarlar[0]).not.toBe(anahtarlar[1]);
});
