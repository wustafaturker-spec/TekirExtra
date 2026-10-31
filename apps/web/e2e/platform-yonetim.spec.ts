import { expect, test } from "@playwright/test";

const kullanici = (id: string, adSoyad: string, rol = "mevzuat_editoru", acikPlatformGorevi = 0) => ({ id, adSoyad, eposta: `${id}@example.test`, rol, aktif: true, sonGiris: "2026-10-30T08:00:00Z", createdAt: "2026-01-01", davetTuru: null, davetSonGecerlilik: null, acikPlatformGorevi });
const saglik = {
  zaman: "2026-10-30T08:00:00Z", esikler: { workerNabizDk: 10, saatlikYenidenBaslama: 2, kursorSaat: 3, ardisikHata: 3 },
  worker: { son: { basladiAt: "2026-10-30T07:00:00Z", sonNabizAt: "2026-10-30T07:59:00Z", rssMb: 150, heapMb: 80, heapSinirMb: 400 }, nabizGecikmesiDk: 1, acilis24s: 1, acilislar: [] }, api: null,
  isler: [{ isAdi: "banka-senkron", sonBaslangic: "2026-10-30T07:55:00Z", sonSureMs: 1000, sonBasariAt: "2026-10-30T07:55:01Z", sonHata: null, sonHataAt: null, ardisikHata: 0, calismaSayisi: 40 }],
  kuyruk: { sayilar: { waiting: 1 }, firmalar: [{ tenantId: "t1", unvan: "Örnek Makina", waiting: 1 }], oluIsler: [] }, gecikenKursorler: [], taranan: 2, baglantilar: [], alarmlar: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-yonetim-test"));
  await page.route("**/api/v1/platform/**", (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/auth/ben") ? { kullaniciId: "p1", eposta: "p1@example.test", rol: "yonetici" } : [] }));
});

test("denetim araması sayfa içinde çalışır, ayrıntı kesilmez ve filtreli listede sayfalama sürer", async ({ page }) => {
  const ayrinti = "Uzun açıklama ".repeat(40) + "SON AYRINTI";
  await page.route("**/api/v1/platform/mevzuat/olaylar?*", (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.get("sayfa") === "1" ? Array.from({ length: 100 }, (_, i) => ({ id: `o${i}`, olay: "guncellendi", zaman: "2026-10-30T08:00:00Z", kullanici: i === 0 ? "Ayşe Yılmaz" : "Sistem", degisiklikId: "d1", degisiklik: { no: 12, baslik: "Tevkifat düzenlemesi" }, detay: { aciklama: ayrinti } })) : [] }));
  await page.goto("/platform/denetim");
  await page.getByRole("textbox", { name: "Denetim kaydı ara" }).fill("Ayşe");
  await page.getByLabel("İşlem türü").selectOption("guncellendi");
  await expect(page.getByRole("button", { name: "Ayrıntıları göster" })).toHaveCount(1);
  await page.getByRole("button", { name: "Ayrıntıları göster" }).click();
  const modal = page.getByRole("dialog", { name: "İşlem ayrıntıları" });
  await expect(modal).toContainText("SON AYRINTI");
  await modal.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-denetim-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Daha eski" }).click();
  await expect(page.getByText("Bu sayfada eşleşen kayıt yok.")).toBeVisible();
  await page.getByRole("button", { name: "Daha yeni" }).click();
  await expect(page.getByText("Ayşe Yılmaz", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-denetim-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("kullanıcı kendi rolünü değiştiremez, başka kullanıcının rolü yalnız onayla kaydedilir", async ({ page }) => {
  let rol = "mevzuat_editoru";
  const istekler: unknown[] = [];
  await page.route("**/api/v1/platform/kullanicilar", (route) => route.fulfill({ json: [kullanici("p1", "Yönetici", "yonetici"), kullanici("p2", "Ayşe Yılmaz", rol)] }));
  await page.route("**/api/v1/platform/kullanicilar/p2", async (route) => { const body = route.request().postDataJSON(); istekler.push(body); rol = body.rol; await route.fulfill({ json: { mesaj: "Kaydedildi" } }); });
  await page.goto("/platform/kullanicilar");
  await expect(page.getByRole("row", { name: /Yönetici \(siz\)/ }).getByRole("combobox")).toHaveCount(0);
  await page.getByLabel("Ayşe Yılmaz rolü").selectOption("yonetici");
  await page.getByRole("dialog", { name: "Rol değişikliği" }).getByRole("button", { name: "Vazgeç" }).click();
  expect(istekler).toEqual([]);
  await page.getByLabel("Ayşe Yılmaz rolü").selectOption("yonetici");
  await page.getByRole("dialog", { name: "Rol değişikliği" }).getByRole("button", { name: "Onayla" }).click();
  await expect(page.getByText("Ayşe Yılmaz artık platform yöneticisi.")).toBeVisible();
  expect(istekler).toEqual([{ rol: "yonetici" }]);
  await page.getByRole("textbox", { name: "Platform kullanıcısı ara" }).fill("Ayşe");
  await page.getByLabel("Rol filtresi").selectOption("yonetici");
  await expect(page.getByLabel("Ayşe Yılmaz rolü")).toHaveValue("yonetici");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-kullanicilar-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("PLT-31: açık platform görevi olan yönetici editöre düşürülürken görevler seçilen yöneticiye aktarılır", async ({ page }) => {
  const istekler: unknown[] = [];
  await page.route("**/api/v1/platform/kullanicilar", (route) => route.fulfill({ json: [kullanici("p1", "Yönetici", "yonetici"), kullanici("p2", "Ayşe Yılmaz", "yonetici", 2), kullanici("p3", "Mehmet Demir", "yonetici"), { ...kullanici("p4", "Kurulumdaki Yönetici", "yonetici"), davetTuru: "hesap" }] }));
  await page.route("**/api/v1/platform/kullanicilar/p2", async (route) => { istekler.push(route.request().postDataJSON()); await route.fulfill({ json: { mesaj: "Kaydedildi" } }); });
  await page.goto("/platform/kullanicilar");
  await page.getByLabel("Ayşe Yılmaz rolü").selectOption("mevzuat_editoru");
  const pencere = page.getByRole("dialog", { name: "Rol değişikliği" });
  const hedef = pencere.getByLabel("2 açık platform görevinin aktarılacağı yönetici");
  await expect(hedef.locator("option")).toHaveText(["Yönetici seçin…", "Yönetici", "Mehmet Demir"]);
  await pencere.getByRole("button", { name: "Onayla" }).click();
  expect(istekler).toEqual([]);
  await hedef.selectOption({ label: "Mehmet Demir" });
  await pencere.getByRole("button", { name: "Onayla" }).click();
  await expect(page.getByText("Ayşe Yılmaz artık mevzuat editörü. 2 açık platform görevi Mehmet Demir kişisine aktarıldı.")).toBeVisible();
  expect(istekler).toEqual([{ rol: "mevzuat_editoru", gorevAktarimHedefiId: "p3" }]);
});

test("PLT-31: pasife alma görev aktarımı istemez, pasif sorumlu uyarısı gösterir", async ({ page }) => {
  const istekler: unknown[] = [];
  await page.route("**/api/v1/platform/kullanicilar", (route) => route.fulfill({ json: [kullanici("p1", "Yönetici", "yonetici"), kullanici("p2", "Ayşe Yılmaz", "yonetici", 1)] }));
  await page.route("**/api/v1/platform/kullanicilar/p2", async (route) => { istekler.push(route.request().postDataJSON()); await route.fulfill({ json: { mesaj: "Kaydedildi" } }); });
  await page.goto("/platform/kullanicilar");
  await page.getByRole("row", { name: /Ayşe Yılmaz/ }).getByRole("button", { name: "Pasife al" }).click();
  const pencere = page.getByRole("dialog", { name: "Kullanıcıyı pasife al" });
  await expect(pencere).toContainText("1 açık platform görevi görev merkezinde “Sorumlusu pasif” olarak işaretlenir");
  await pencere.getByRole("button", { name: "Onayla" }).click();
  expect(istekler).toEqual([{ aktif: false }]);
});

test("kimlik doğrulanmadan kullanıcı işlemleri açılmaz, davet e-postası gidemezse kurulum bağlantısı korunur", async ({ page }) => {
  let kimlikHazir = false;
  let davetEdildi = false;
  let govde: unknown;
  await page.route("**/api/v1/platform/auth/ben", (route) => route.fulfill({ json: { kullaniciId: kimlikHazir ? "p1" : undefined, eposta: "p1@example.test", rol: "yonetici" } }));
  await page.route("**/api/v1/platform/kullanicilar", async (route) => {
    if (route.request().method() === "POST") {
      govde = route.request().postDataJSON(); davetEdildi = true;
      await route.fulfill({ json: { davet: { gonderildi: false, mesaj: "E-posta gönderilemedi; kurulum bağlantısını kullanın.", baglanti: "http://localhost:3101/platform/davet?token=ornek" } } });
    } else await route.fulfill({ json: [kullanici("p1", "Yönetici", "yonetici"), ...(davetEdildi ? [{ ...kullanici("p3", "Yeni Editör"), davetTuru: "hesap" }] : [])] });
  });
  await page.goto("/platform/kullanicilar");
  await expect(page.getByRole("button", { name: "Kullanıcı davet et" })).toBeDisabled();
  await expect(page.getByText(/Oturum kimliği doğrulanamadı/)).toBeVisible();
  kimlikHazir = true;
  await page.getByRole("button", { name: "Kimliği yeniden doğrula" }).click();
  await page.getByRole("button", { name: "Kullanıcı davet et" }).click();
  const modal = page.getByRole("dialog", { name: "Platform kullanıcısı davet et" });
  await modal.getByLabel("Ad soyad").fill("Yeni Editör");
  await modal.getByLabel("E-posta").fill("p3@example.test");
  await modal.getByRole("button", { name: "Davet gönder" }).click();
  await expect(page.getByLabel("Kurulum bağlantısı (bir kez kullanılır)")).toHaveValue("http://localhost:3101/platform/davet?token=ornek");
  await expect(page.getByText("E-posta gönderilemedi; kurulum bağlantısını kullanın.")).toBeVisible();
  expect(govde).toEqual({ adSoyad: "Yeni Editör", eposta: "p3@example.test", rol: "mevzuat_editoru" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-kullanicilar-desktop.png", fullPage: true });
});

test("sağlık yenileme hatası son ölçümü korur ve eski veriyi güncelmiş gibi göstermez", async ({ page }) => {
  let hata = false;
  await page.route("**/api/v1/platform/sistem-sagligi", (route) => route.fulfill(hata ? { status: 503, json: { message: "Ölçüm servisine ulaşılamadı." } } : { json: saglik }));
  await page.goto("/platform/sistem-sagligi");
  await expect(page.getByText("Açık sorun yok.")).toBeVisible();
  hata = true;
  await page.getByRole("button", { name: "Şimdi yenile" }).click();
  await expect(page.getByText(/Aşağıdaki bilgiler son başarılı ölçüme aittir/)).toBeVisible();
  await expect(page.getByText("Açık sorun yok.")).toHaveCount(0);
  await expect(page.getByText("80 / 400 MB")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-saglik-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  hata = false;
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByText("Açık sorun yok.")).toBeVisible();
  await expect(page.getByText("Ölçüm servisine ulaşılamadı.")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-saglik-desktop.png", fullPage: true });
});
