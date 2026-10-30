import { expect, test, type Page } from "@playwright/test";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const EDITOR = "10000000-0000-4000-8000-000000000002";
const DEG = "20000000-0000-4000-8000-000000000001";
const GID = "30000000-0000-4000-8000-000000000001";
const kisi = (id: string) => ({ id, adSoyad: id === ADMIN ? "Platform Yöneticisi" : "Mevzuat Editörü", rol: id === ADMIN ? "yonetici" : "mevzuat_editoru", aktif: true });
const gorev = (ek: Record<string, unknown> = {}) => ({ id: GID, baslik: "Dönem kaydını hazırla", aciklama: "Dayanak ve yürürlük tarihini kontrol edin.", kapsam: "mevzuat", durum: "acik", oncelik: "yuksek", sonTarih: "2026-10-01", sorumluId: EDITOR, sorumlu: kisi(EDITOR), olusturan: kisi(ADMIN), degisiklikId: DEG, degisiklik: { id: DEG, no: 12, baslik: "Dönem düzenlemesi" }, surum: 1, createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", kapanisAt: null, ...ek });

async function hazirla(page: Page, ilk = [gorev()], rol = "yonetici") {
  const durum = { kayitlar: ilk, hata: false, cakisma: false, istekler: [] as { method: string; body: Record<string, unknown> }[] };
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-gorev-test"));
  await page.route("**/api/v1/platform/**", async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname; const method = route.request().method();
    if (path.endsWith("/auth/ben")) return route.fulfill({ json: { kullaniciId: rol === "yonetici" ? ADMIN : EDITOR, eposta: "ekip@example.test", rol } });
    if (path.endsWith("/katilimcilar")) return route.fulfill({ json: [kisi(ADMIN), kisi(EDITOR)] });
    if (path.endsWith("/mevzuat/degisiklikler") && url.searchParams.has("durum")) return route.fulfill({ json: [] });
    if (path.includes("/mevzuat/degisiklikler")) return route.fulfill({ json: path.endsWith(DEG) ? { id: DEG, no: 12, baslik: "Dönem düzenlemesi" } : [{ id: DEG, no: 12, baslik: "Dönem düzenlemesi" }] });
    if (path.endsWith("/gorevler") && method === "GET") {
      if (durum.hata) return route.fulfill({ status: 503, json: { message: "Görev listesi alınamadı." } });
      const scope = durum.kayitlar.filter((g) => rol === "yonetici" || g.kapsam === "mevzuat");
      const acik = (g: typeof scope[number]) => ["acik", "devam_ediyor"].includes(g.durum);
      const rows = scope.filter((g) => {
        const d = url.searchParams.get("durum");
        return (!d || d === "hepsi" || (d === "acik_isler" ? acik(g) : g.durum === d))
          && (url.searchParams.get("benim") !== "1" || g.sorumluId === (rol === "yonetici" ? ADMIN : EDITOR))
          && (url.searchParams.get("geciken") !== "1" || acik(g) && Boolean(g.sonTarih && g.sonTarih < "2026-10-30"))
          && `${g.baslik} ${g.aciklama}`.toLocaleLowerCase("tr-TR").includes((url.searchParams.get("arama") ?? "").toLocaleLowerCase("tr-TR"));
      });
      return route.fulfill({ json: { kayitlar: rows, toplam: rows.length, sayfa: 1, sayfaBoyutu: 25, bugun: "2026-10-30", sayilar: { acik: scope.filter((g) => g.durum === "acik").length, devam_ediyor: scope.filter((g) => g.durum === "devam_ediyor").length, tamamlandi: scope.filter((g) => g.durum === "tamamlandi").length, iptal: 0, geciken: scope.filter((g) => acik(g) && g.sonTarih && g.sonTarih < "2026-10-30").length } } });
    }
    if (path.endsWith("/gorevler") && method === "POST") {
      const body = route.request().postDataJSON(); durum.istekler.push({ method, body });
      const yeni = gorev({ ...body, sorumlu: body.sorumluId ? kisi(body.sorumluId) : null, id: GID, sonTarih: body.sonTarih, degisiklik: body.degisiklikId ? { id: DEG, no: 12, baslik: "Dönem düzenlemesi" } : null });
      durum.kayitlar.push(yeni); return route.fulfill({ json: yeni, status: 201 });
    }
    if (path.includes("/gorevler/") && method === "PATCH") {
      const body = route.request().postDataJSON(); durum.istekler.push({ method, body });
      if (durum.cakisma) { durum.cakisma = false; durum.kayitlar[0] = gorev({ baslik: "Başka kullanıcının güncellemesi", surum: 2 }); return route.fulfill({ status: 409, json: { message: "Görev başka biri tarafından değiştirildi." } }); }
      const i = durum.kayitlar.findIndex((g) => g.id === path.split("/").pop());
      durum.kayitlar[i] = { ...durum.kayitlar[i], ...body, surum: Number(body.surum) + 1 };
      return route.fulfill({ json: durum.kayitlar[i] });
    }
    if (path.includes("/gorevler/") && method === "GET") return route.fulfill({ json: durum.kayitlar.find((g) => g.id === path.split("/").pop()) });
    return route.fulfill({ json: [] });
  });
  return durum;
}

test("bağlı görev oluşturulur, yenilemede görünür ve tamamlanıp yeniden açılır", async ({ page }) => {
  const state = await hazirla(page, []);
  await page.goto(`/platform/gorevler?degisiklik=${DEG}`);
  const modal = page.getByRole("dialog", { name: "Yeni görev", exact: true });
  await modal.getByLabel("Görev başlığı").fill("Yıl sonu değerlerini kontrol et");
  await modal.getByLabel("Sorumlu", { exact: true }).selectOption(EDITOR);
  await modal.getByLabel("Son tarih").fill("2027-01-01");
  await expect(modal.getByLabel("İlgili mevzuat değişikliği")).toHaveValue(DEG);
  await modal.getByRole("button", { name: "Görevi kaydet" }).click();
  await expect(page.getByRole("row", { name: /Yıl sonu değerlerini kontrol et/ })).toBeVisible();
  expect(state.istekler[0]).toMatchObject({ method: "POST", body: { kapsam: "mevzuat", sorumluId: EDITOR, sonTarih: "2027-01-01", degisiklikId: DEG } });
  // Formu yeniden açan bağlantı parametresini kaldırarak sayfayı yenile.
  await page.goto("/platform/gorevler");
  await expect(page.getByRole("row", { name: /Yıl sonu değerlerini kontrol et/ })).toBeVisible();
  await page.getByRole("button", { name: "Tamamla", exact: true }).click();
  await expect(page.getByText("Görev tamamlandı.", { exact: true })).toBeVisible();
  await page.getByLabel("Görev durumu").selectOption("tamamlandi");
  await page.getByRole("button", { name: "Yeniden aç", exact: true }).click();
  await expect(page.getByText("Görev yeniden açıldı.", { exact: true })).toBeVisible();
  await page.getByLabel("Görev durumu").selectOption("acik_isler");
  await expect(page.getByRole("row", { name: /Yıl sonu değerlerini kontrol et/ })).toBeVisible();
});

test("sürüm çakışmasında taslak korunur ve güncel kayıt açık seçimle yüklenir", async ({ page }) => {
  const state = await hazirla(page); state.cakisma = true;
  await page.goto("/platform/gorevler");
  await page.getByRole("button", { name: "Düzenle", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Görevi düzenle" });
  await modal.getByLabel("Görev başlığı").fill("Benim kaydedilmemiş taslağım");
  await modal.getByRole("button", { name: "Görevi kaydet" }).click();
  await expect(modal.getByText("Görev başka biri tarafından değiştirildi.")).toBeVisible();
  await expect(modal.getByLabel("Görev başlığı")).toHaveValue("Benim kaydedilmemiş taslağım");
  await modal.getByRole("button", { name: "Taslağı bırak ve güncel kaydı yükle" }).click();
  await expect(modal.getByLabel("Görev başlığı")).toHaveValue("Başka kullanıcının güncellemesi");
  await modal.getByLabel("Görev başlığı").fill("Son düzenleme");
  await modal.getByRole("button", { name: "Görevi kaydet" }).click();
  await expect(page.getByRole("row", { name: /Son düzenleme/ })).toBeVisible();
  expect(state.istekler[1].body.surum).toBe(2);
});

test("görev filtreleri birleşir, editör yalnız mevzuat kapsamında yeni görev açar", async ({ page }) => {
  await hazirla(page, [gorev(), gorev({ id: "g2", baslik: "Platform iç işi", kapsam: "platform", sorumluId: ADMIN }), gorev({ id: "g3", baslik: "Tamamlanan iş", durum: "tamamlandi" })], "mevzuat_editoru");
  await page.goto("/platform/gorevler");
  await expect(page.getByText("Platform iç işi", { exact: true })).toHaveCount(0);
  await page.getByLabel("Bana atananlar").check();
  await page.getByLabel("Sadece gecikenler").check();
  await expect(page.getByRole("row", { name: /Dönem kaydını hazırla/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Görev ara" }).fill("bulunmayan");
  await expect(page.getByText("Bu görünümde görev yok.")).toBeVisible();
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Yeni görev", exact: true });
  await expect(modal.getByLabel("Görev kapsamı")).toBeDisabled();
  await expect(modal.getByLabel("Görev kapsamı").locator("option")).toHaveText(["Mevzuat ekibi"]);
});

test("liste hatası yeniden denenir, mobil formda taslak bırakma uyarısı çalışır", async ({ page }) => {
  const state = await hazirla(page); state.hata = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform/gorevler");
  await expect(page.getByText("Görev listesi alınamadı.")).toBeVisible();
  state.hata = false;
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("row", { name: /Dönem kaydını hazırla/ })).toBeVisible();
  await page.screenshot({ path: "/tmp/platform-gorev-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-gorev-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Yeni görev", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Yeni görev", exact: true });
  await modal.getByLabel("Görev başlığı").fill("Kaydedilmemiş görev");
  await modal.getByLabel("Görev kapsamı").selectOption("platform");
  await expect(modal.getByLabel("Sorumlu", { exact: true }).locator("option")).toHaveText(["Atanmadı", "Platform Yöneticisi"]);
  page.once("dialog", (d) => void d.dismiss());
  await modal.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(modal.getByLabel("Görev başlığı")).toHaveValue("Kaydedilmemiş görev");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await modal.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/platform-gorev-form-mobile.png", fullPage: true });
  page.once("dialog", (d) => void d.accept());
  await modal.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(modal).toHaveCount(0);
});

test("özet kişisel görevleri ve ekip gecikmesini ayırır, bağlantılar filtre ve kaydı açar", async ({ page }) => {
  await hazirla(page, [gorev({ sorumluId: ADMIN, sorumlu: kisi(ADMIN) }), gorev({ id: "30000000-0000-4000-8000-000000000002", baslik: "Başka kişinin görevi" })]);
  await page.goto("/platform/ozet");
  await expect(page.getByRole("link", { name: "Bana atanan açık görev: 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Geciken ekip görevi: 2", exact: true })).toBeVisible();
  const panel = page.locator(".platform-dashboard-panel").filter({ has: page.getByRole("heading", { name: "Bana atanan işler", exact: true }) });
  await expect(panel.getByText("Başka kişinin görevi")).toHaveCount(0);
  await panel.getByRole("link", { name: /Dönem kaydını hazırla/ }).click();
  await expect(page.getByRole("dialog").getByLabel("Görev başlığı")).toHaveValue("Dönem kaydını hazırla");
  await page.goto("/platform/ozet");
  await page.getByRole("link", { name: "Bana atanan açık görev: 1", exact: true }).click();
  await expect(page.getByLabel("Bana atananlar")).toBeChecked();
  await expect(page.getByText("Başka kişinin görevi", { exact: true })).toHaveCount(0);
  await page.goto("/platform/ozet");
  await page.getByRole("link", { name: "Geciken ekip görevi: 2", exact: true }).click();
  await expect(page.getByLabel("Sadece gecikenler")).toBeChecked();
  await expect(page.getByLabel("Bana atananlar")).not.toBeChecked();
});

test("özet görev hatasını sıfır gibi göstermez ve yalnız görev kaynağını yeniden dener", async ({ page }) => {
  const state = await hazirla(page, [], "mevzuat_editoru"); state.hata = true;
  await page.goto("/platform/ozet");
  await expect(page.getByRole("link", { name: "Bana atanan açık görev: veri alınamadı", exact: true })).toBeVisible();
  const panel = page.locator(".platform-dashboard-panel").filter({ has: page.getByRole("heading", { name: "Bana atanan işler", exact: true }) });
  await expect(panel.getByRole("alert")).toContainText("Görev listesi alınamadı.");
  state.hata = false;
  await panel.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(panel.getByText("Size atanmış açık görev yok.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Bana atanan açık görev: 0", exact: true })).toBeVisible();
});

test("liste filtreleri yenilemede korunur, paylaşılır ve temizlenir", async ({ page, context }) => {
  await hazirla(page, [gorev({ sorumluId: ADMIN, sorumlu: kisi(ADMIN) })]);
  await page.goto("/platform/gorevler?arama=D%C3%B6nem&durum=hepsi&benim=1&geciken=1&sayfa=3");
  await expect(page.getByLabel("Görev ara")).toHaveValue("Dönem");
  await expect(page.getByLabel("Görev durumu")).toHaveValue("hepsi");
  await expect(page.getByLabel("Bana atananlar")).toBeChecked();
  await expect(page.getByLabel("Sadece gecikenler")).toBeChecked();
  await page.getByLabel("Görev ara").fill("kaydını");
  await expect.poll(() => new URL(page.url()).searchParams.get("arama")).toBe("kaydını");
  expect(new URL(page.url()).searchParams.has("sayfa")).toBe(false);
  await page.reload();
  await expect(page.getByLabel("Görev ara")).toHaveValue("kaydını");
  await expect(page.getByLabel("Görev durumu")).toHaveValue("hepsi");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Liste bağlantısını kopyala" }).click();
  await expect(page.getByText("Liste bağlantısı kopyalandı.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  await page.getByRole("button", { name: "Filtreleri temizle" }).click();
  await expect(page.getByLabel("Görev ara")).toHaveValue("");
  await expect(page.getByLabel("Görev durumu")).toHaveValue("acik_isler");
  await expect(page.getByLabel("Bana atananlar")).not.toBeChecked();
  await expect(page.getByLabel("Sadece gecikenler")).not.toBeChecked();
  await expect(page).toHaveURL(/\/platform\/gorevler$/);
});

test("geçersiz filtre değerleri güvenli varsayılanlarla açılır", async ({ page }) => {
  await hazirla(page);
  await page.goto("/platform/gorevler?durum=bilinmiyor&sayfa=-3&benim=evet");
  await expect(page.getByLabel("Görev durumu")).toHaveValue("acik_isler");
  await expect(page.getByLabel("Bana atananlar")).not.toBeChecked();
  await expect(page.getByText("Sayfa 1 / 1", { exact: true })).toBeVisible();
});
