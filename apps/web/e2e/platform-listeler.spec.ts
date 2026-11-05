import { firmaSayfasi } from "./platform-firma-fixture";
import { expect, test, type Route } from "@playwright/test";

const firma = (tenantId: string, unvan: string, gecikti: boolean) => ({
  tenantId, unvan, vkn: tenantId === "t1" ? "1234567890" : "9999999999", kayitTarihi: "2026-01-01T00:00:00Z",
  planKodu: "profesyonel", planAdi: "Profesyonel", durum: "aktif", donemSonu: "2026-11-01", iptalTarihi: null,
  aktifKullanici: 4, sonGiris: "2026-10-30T08:00:00Z", ebelgeSaglayici: "nes", bekleyenTalep: null, askiyaAlinacak: gecikti,
});
const talep = (id: string, durum = "acik") => ({
  id, kaynak: "kiraci_bildirimi", tur: "tevkifat_kodu", anahtar: "601", aciklama: id === "r1" ? "Yapım işlerinde eksik oran bildirimi" : "Tamamlanmış bildirim",
  gorulmeSayisi: 1, durum, cozumNotu: null, createdAt: "2026-10-30T08:00:00Z",
});
const deger = { id: "k1", anahtar: "601", deger: { ad: "Yapım işleri", oranlar: ["4/10"] }, yururlukBaslangic: "2026-01-01", yururlukBitis: null, degisiklikId: "d1", degisiklik: { no: 12, baslik: "Tevkifat güncellemesi", dayanak: "Örnek tebliğ" } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-listeler-test"));
  await page.route("**/api/v1/platform/**", (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/auth/ben") ? { eposta: "ekip@example.test", rol: "yonetici" } : [] }));
});

test("firma kartları ve arama birlikte filtreler, mobil yönetim penceresi taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/platform/firmalar/sayfali?*", (route) => firmaSayfasi(route, [firma("t1", "Örnek Makina A.Ş.", true), firma("t2", "Düzenli Ltd.", false)]));
  await page.route("**/api/v1/platform/firmalar/t1/gecmis", (route) => route.fulfill({ json: { degisiklikler: [], talepler: [], odemeler: [] } }));
  await page.goto("/platform/firmalar");
  await page.getByRole("button", { name: /Ödemesi geciken/ }).click();
  await expect(page.getByText("Örnek Makina A.Ş.", { exact: true })).toBeVisible();
  await expect(page.getByText("Düzenli Ltd.", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Firma ara" }).fill("9999999999");
  await expect(page.getByText("Eşleşen firma yok.")).toBeVisible();
  await page.getByRole("textbox", { name: "Firma ara" }).fill("");
  await page.screenshot({ path: "/tmp/platform-firmalar-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-firmalar-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Yönet", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Örnek Makina A.Ş." });
  await expect(modal.getByText("Abonelik geçmişi yok.")).toBeVisible();
  expect(await modal.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("geciken eski talep yanıtı seçili durumun sonuçlarını değiştirmez", async ({ page }) => {
  let ilkIstegiAl!: (route: Route) => void;
  const ilkIstek = new Promise<Route>((resolve) => { ilkIstegiAl = resolve; });
  await page.route("**/api/v1/platform/mevzuat/talepler?*", (route) => {
    if (new URL(route.request().url()).searchParams.get("durum") === "acik") { ilkIstegiAl(route); return; }
    return route.fulfill({ json: [talep("r2", "cozuldu")] });
  });
  await page.goto("/platform/talepler");
  const eski = await ilkIstek;
  await page.getByRole("group", { name: "Talep durumu" }).getByRole("button", { name: "Çözüldü", exact: true }).click();
  await expect(page.getByText("Tamamlanmış bildirim", { exact: true })).toBeVisible();
  // İptal edilmiş isteğin yanıtı artık görünümü güncellememeli.
  await eski.fulfill({ json: [talep("r1")] }).catch(() => undefined);
  await expect(page.getByText("Yapım işlerinde eksik oran bildirimi", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tamamlanmış bildirim", { exact: true })).toBeVisible();
});

test("talep çözüm notuyla kapatılır ve mobilde işlemler erişilebilir kalır", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let kapandi = false;
  let govde: unknown;
  await page.route("**/api/v1/platform/mevzuat/talepler?*", (route) => route.fulfill({ json: kapandi ? [] : [talep("r1")] }));
  await page.route("**/api/v1/platform/mevzuat/talepler/r1", async (route) => {
    govde = route.request().postDataJSON(); kapandi = true;
    await route.fulfill({ json: { mesaj: "Kaydedildi" } });
  });
  await page.goto("/platform/talepler");
  await page.getByRole("textbox", { name: "Çözüm notu" }).fill("#12 ile düzenlendi.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-talepler-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-talepler-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Çözümü kaydet", exact: true }).click();
  await expect(page.getByText("Talep çözüldü olarak işaretlendi.")).toBeVisible();
  await expect(page.getByText("Açık talep yok.")).toBeVisible();
  expect(govde).toEqual({ durum: "cozuldu", cozumNotu: "#12 ile düzenlendi." });
});

test("değer geçmişi hatadan sonra yeniden yüklenir, tarih silinince eski kayıtlar gizlenir", async ({ page }) => {
  const hatalar: string[] = [];
  page.on("pageerror", (e) => hatalar.push(e.message));
  let gecmisHatasi = true;
  let istekSayisi = 0;
  await page.route("**/api/v1/platform/mevzuat/kayitlar?*", (route) => {
    istekSayisi++;
    const gecmis = new URL(route.request().url()).searchParams.has("anahtar");
    return route.fulfill(gecmis && gecmisHatasi ? { status: 503, json: { message: "Geçmiş şu anda alınamadı." } } : { json: [deger] });
  });
  await page.goto("/platform/tablolar");
  await expect(page.getByRole("link", { name: "#12 Örnek tebliğ" })).toHaveAttribute("href", "/platform/degisiklik?id=d1");
  await page.getByRole("button", { name: "601 geçmişini göster" }).click();
  await expect(page.locator(".platform-value-history").getByRole("alert")).toContainText("Geçmiş şu anda alınamadı.");
  gecmisHatasi = false;
  await page.locator(".platform-value-history").getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.locator(".platform-value-history").getByText("Yapım işleri · 4/10")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-degerler-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-degerler-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const oncekiIstekSayisi = istekSayisi;
  await page.getByLabel("Geçerlilik tarihi").fill("");
  await expect(page.getByText("Bir geçerlilik tarihi seçin.")).toBeVisible();
  await expect(page.locator(".platform-value-history")).toHaveCount(0);
  await expect(page.getByText("Yapım işleri · 4/10")).toHaveCount(0);
  expect(istekSayisi).toBe(oncekiIstekSayisi);
  expect(hatalar).toEqual([]);
});

test("PLT-27: elle ödeme tutarı kuruşlu metin gider; yanıt kaybında yeniden deneme aynı işlem anahtarını kullanır", async ({ page }) => {
  const govdeler: { tutar: unknown; islemAnahtari: string; aySayisi: number }[] = [];
  await page.route("**/api/v1/platform/firmalar/sayfali?*", (route) => firmaSayfasi(route, [firma("t1", "Örnek Makina A.Ş.", false)]));
  await page.route("**/api/v1/platform/firmalar/t1/gecmis", (route) => route.fulfill({ json: { degisiklikler: [], talepler: [], odemeler: [] } }));
  await page.route("**/api/v1/platform/firmalar/t1/odeme", (route) => {
    govdeler.push(route.request().postDataJSON());
    // İlk yanıt kaybolur (ağ hatası); ikinci deneme başarılı.
    return govdeler.length === 1 ? route.abort("failed") : route.fulfill({ json: { mesaj: "Ödeme kaydedildi; dönem sonu 01.12.2026." } });
  });
  await page.goto("/platform/firmalar");
  await page.getByRole("row", { name: /Örnek Makina/ }).getByRole("button", { name: "Yönet" }).click();
  const kaydet = page.getByRole("button", { name: "Ödemeyi kaydet" });
  await page.getByLabel("Tutar (TL)").fill("1.500,555");
  await expect(kaydet).toBeDisabled();
  await page.getByLabel("Tutar (TL)").fill("1.500,50");
  await kaydet.click();
  await expect.poll(() => govdeler.length).toBe(1);
  await expect(kaydet).toBeEnabled();
  await kaydet.click();
  await expect(page.getByText("Ödeme kaydedildi; dönem sonu 01.12.2026.")).toBeVisible();
  expect(govdeler.map((g) => g.tutar)).toEqual(["1500.50", "1500.50"]);
  expect(govdeler[0].islemAnahtari).toMatch(/^[0-9a-f]{32}$/);
  expect(govdeler[1].islemAnahtari).toBe(govdeler[0].islemAnahtari);
});
