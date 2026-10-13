import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("tekir_access") && !localStorage.getItem("tekir_access")) {
      sessionStorage.setItem("tekir_access", "e2e-token");
    }
  });
  await page.route("**/api/v1/**", async (route) => {
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
    if (url.pathname.endsWith("/depo") || url.pathname.endsWith("/projeler") || url.pathname.endsWith("/fiyat-listeleri") || url.pathname.includes("/kasa-banka/")) {
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

test("standart form alanları görünür etiketleriyle programatik olarak ilişkilidir", async ({ page }) => {
  const sayfaHatalari: string[] = [];
  page.on("pageerror", (hata) => sayfaHatalari.push(hata.message));
  await page.goto("/panel/fatura?yon=satis&yeni=1");
  await expect(page.getByLabel("Fatura Tarihi")).toBeVisible();
  await expect(page.getByLabel("Fatura Tipi")).toBeVisible();

  await page.goto("/panel/cari");
  await page.getByRole("button", { name: /Yeni Cari/ }).click();
  expect(sayfaHatalari).toEqual([]);
  await expect(page.getByLabel("Cari kodu")).toBeVisible();
  await expect(page.getByLabel("Ünvan / Ad soyad")).toBeVisible();

  await page.goto("/panel/kasa-banka");
  await page.getByRole("button", { name: /Fiş Girişi/ }).click();
  await expect(page.getByLabel("Kasa / Banka Seçimi")).toBeVisible();
  await expect(page.getByLabel("İşlem Tipi")).toBeVisible();
  await expect(page.getByLabel("Tutar")).toBeVisible();
});

test("işlem sonuçları ekran okuyucu canlı bölgeleriyle duyurulur", async ({ page }) => {
  await page.goto("/dogrula");
  const hata = page.getByRole("alert").filter({ hasText: "Doğrulama token'ı eksik" });
  await expect(hata).toContainText("Doğrulama token'ı eksik");
  await expect(hata).toHaveAttribute("aria-live", "assertive");
  await expect(hata).toHaveAttribute("aria-atomic", "true");

  await page.route("**/api/v1/auth/eposta-dogrula**", (route) =>
    route.fulfill({ json: { mesaj: "E-posta adresiniz doğrulandı." } }),
  );
  await page.goto("/dogrula?token=e2e-token");
  const basari = page.getByRole("status");
  await expect(basari).toContainText("E-posta adresiniz doğrulandı.");
  await expect(basari).toHaveAttribute("aria-live", "polite");
  await expect(basari).toHaveAttribute("aria-atomic", "true");
});

test("sekmeler rollerini bildirir ve ok tuşlarıyla gezilebilir", async ({ page }) => {
  await page.route("**/api/v1/cari**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/cari/etiketler")) return route.fulfill({ json: [] });
    if (pathname.endsWith("/cari/c1/ekstre")) {
      return route.fulfill({ json: { cari: { id: "c1", kod: "C001", unvan: "Klavye Müşterisi" }, satirlar: [] } });
    }
    if (pathname.endsWith("/cari/c1")) {
      return route.fulfill({ json: {
        id: "c1", kod: "C001", unvan: "Klavye Müşterisi", tip: "musteri", sektor: null,
        vknTckn: null, eposta: null, telefon: null, karaListe: false, bakiyeler: [],
        kisaAd: null, kisiTipi: "tuzel", vergiDairesi: null, mersisNo: null,
        ticaretSicilNo: null, webSitesi: null, faks: null, karaListeNotu: null,
        riskLimiti: null, varsayilanVadeGun: null, bankaHesaplari: [], etiketler: [],
        adresler: [], kisiler: [],
        risk: { cekSenetRiski: "0", mevcutRisk: "0", limit: null, kalanLimit: null, asim: false },
        finansalOzet: { sonIslemTarihi: null, sonTahsilatTarihi: null, sonOdemeTarihi: null, vadesiGecmisBakiye: "0" },
      } });
    }
    return route.fulfill({ json: { kayitlar: [{
      id: "c1", kod: "C001", unvan: "Klavye Müşterisi", tip: "musteri", sektor: null,
      vknTckn: null, eposta: null, telefon: null, karaListe: false, bakiyeler: [],
    }], sonrakiImlec: null } });
  });
  await page.goto("/panel/cari");

  const filtreGrubu = page.getByRole("group", { name: "Görünüm seçenekleri" });
  await expect(filtreGrubu.getByRole("button", { name: "Tümü" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Detay/ }).click();

  const sekmeler = page.getByRole("tablist", { name: "Cari hesap bölümleri" });
  const genel = sekmeler.getByRole("tab", { name: "Genel Bakış" });
  const ekstre = sekmeler.getByRole("tab", { name: "Ekstre" });
  await expect(genel).toHaveAttribute("aria-selected", "true");
  await expect(genel).toHaveAttribute("aria-controls", "cari-detay-panel-genel");
  await expect(page.getByRole("tabpanel", { name: "Genel Bakış" })).toBeVisible();
  await genel.focus();
  await genel.press("ArrowRight");
  await expect(ekstre).toBeFocused();
  await expect(ekstre).toHaveAttribute("aria-selected", "true");
  await expect(ekstre).toHaveAttribute("aria-controls", "cari-detay-panel-ekstre");
  await expect(page.getByRole("tabpanel", { name: "Ekstre" })).toBeVisible();
  await expect(genel).toHaveAttribute("tabindex", "-1");
});

test("fatura doğrulama hataları ilgili seçiciye bağlanır ve ilk hataya odaklanır", async ({ page }) => {
  await page.route("**/api/v1/cari**", (route) => {
    const { pathname } = new URL(route.request().url());
    return route.fulfill({ json: pathname.endsWith("/cari/c1")
      ? { id: "c1", kod: "C001", unvan: "Test Müşteri", bakiyeler: [], risk: { mevcutRisk: "0", limit: null, kalanLimit: null, asim: false } }
      : { kayitlar: [{ id: "c1", kod: "C001", unvan: "Test Müşteri" }], sonrakiImlec: null }
    });
  });
  await page.route("**/api/v1/stok**", (route) => route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } }));
  await page.goto("/panel/fatura?yon=satis&yeni=1");

  await page.getByRole("button", { name: "Taslak faturayı kaydet" }).click();
  const cariSecici = page.getByRole("combobox", { name: "Müşteri ara" });
  await expect(cariSecici).toBeFocused();
  await expect(cariSecici).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Faturayı kaydetmek için müşteri veya tedarikçi seçin.")).toBeVisible();

  await cariSecici.click();
  await page.getByRole("option", { name: /Test Müşteri/ }).click();
  await page.getByRole("button", { name: "Taslak faturayı kaydet" }).click();
  const urunSecici = page.getByRole("combobox", { name: "1. satır ürün veya hizmet seçimi" });
  await expect(urunSecici).toBeFocused();
  await expect(urunSecici).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Bu satır için ürün veya hizmet seçin.")).toBeVisible();
});

test("hızlı panel odağı içine alır, sınırlar ve kapanınca tetikleyiciye döndürür", async ({ page }) => {
  await page.goto("/panel/fatura?yon=satis&yeni=1");
  const musteriSecici = page.getByRole("combobox", { name: "Müşteri ara" });
  await musteriSecici.click();
  await page.getByRole("button", { name: /Yeni müşteri oluştur/ }).click();

  const panel = page.getByRole("dialog", { name: "Yeni müşteri" });
  await expect(panel).toBeVisible();
  await expect(page.getByLabel("Ünvan / Ad soyad")).toBeFocused();

  await page.getByRole("button", { name: "Oluştur ve seç" }).focus();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "Kapat" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(musteriSecici).toBeFocused();
});

test("geri bildirim diyaloğu odağı sınırlar ve tetikleyiciye geri verir", async ({ page }) => {
  await page.goto("/panel/satis");
  const tetikleyici = page.getByRole("button", { name: "Geri bildirim ver" });
  await tetikleyici.click();

  const diyalog = page.getByRole("dialog", { name: "Deneyiminizi paylaşın" });
  await expect(diyalog).toBeVisible();
  await expect(diyalog.getByRole("button", { name: "Geri bildirim formunu kapat" })).toBeFocused();

  const besPuan = diyalog.getByRole("radio", { name: "5", exact: true });
  const dortPuan = diyalog.getByRole("radio", { name: "4", exact: true });
  await besPuan.focus();
  await besPuan.press("ArrowLeft");
  await expect(dortPuan).toBeFocused();
  await expect(dortPuan).toHaveAttribute("aria-checked", "true");
  await expect(besPuan).toHaveAttribute("tabindex", "-1");
  await dortPuan.press("Home");
  await expect(diyalog.getByRole("radio", { name: "1", exact: true })).toBeFocused();

  await diyalog.getByRole("button", { name: "Gönder" }).focus();
  await page.keyboard.press("Tab");
  await expect(diyalog.getByRole("button", { name: "Geri bildirim formunu kapat" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(diyalog).toBeHidden();
  await expect(tetikleyici).toBeFocused();
});

test("azaltılmış hareket tercihi uygulanır ve klavye odağı görünür kalır", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/panel/satis");

  const gecisSuresi = await page.getByRole("link", { name: /Satış faturası/ }).first().evaluate((oge) =>
    Number.parseFloat(getComputedStyle(oge).transitionDuration) || 0,
  );
  expect(gecisSuresi).toBeLessThanOrEqual(0.001);

  await page.locator("body").press("Tab");
  const odakGorunumu = await page.evaluate(() => {
    const oge = document.activeElement;
    if (!(oge instanceof HTMLElement)) return null;
    const stil = getComputedStyle(oge);
    return { etiket: oge.tagName, outline: stil.outlineStyle, golge: stil.boxShadow };
  });
  expect(odakGorunumu?.etiket).not.toBe("BODY");
  expect(odakGorunumu?.outline !== "none" || odakGorunumu?.golge !== "none").toBe(true);
});

test("klavye kullanıcısı tekrarlanan menüyü atlayıp ana içeriğe geçebilir", async ({ page }) => {
  await page.goto("/panel/satis");
  await page.locator("body").press("Tab");

  const atlamaBaglantisi = page.getByRole("link", { name: "Ana içeriğe geç" });
  await expect(atlamaBaglantisi).toBeFocused();
  await expect(atlamaBaglantisi).toBeInViewport();
  await atlamaBaglantisi.press("Enter");

  await expect(page.locator("#ana-icerik")).toBeFocused();
  await expect(page).toHaveURL(/#ana-icerik$/);
});

test("dekoratif ikonlar kontrol ve bağlantı adlarını kirletmez", async ({ page }) => {
  await page.goto("/panel/satis");

  await expect(page.getByRole("link", { name: "Cari Hesaplar", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kasa & Banka", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Güvenli çıkış", exact: true })).toBeVisible();
});

test("salt okunur rol yetkisiz yönetim sayfasını alt içerik çalışmadan göremez", async ({ page }) => {
  await page.route("**/api/v1/auth/ben", (route) =>
    route.fulfill({ json: { userId: "u2", tenantId: "t1", rol: "salt_okunur" } }),
  );
  await page.goto("/panel/ayarlar/kullanicilar");

  await expect(page.getByRole("heading", { name: "Bu sayfaya erişim yetkiniz yok" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Kullanıcılar/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Yeni kullanıcı/ })).toHaveCount(0);
});

test("proje seçeneklerini yükler ve yeni projeyi kaydeder", async ({ page }) => {
  let kaydedilen: Record<string, unknown> | null = null;
  await page.route("**/api/v1/projeler**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/projeler/secenekler")) {
      return route.fulfill({ json: {
        cariler: [{ id: "c1", unvan: "Örnek Müşteri" }],
        kullanicilar: [{ id: "u1", adSoyad: "Proje Sorumlusu" }],
      } });
    }
    if (route.request().method() === "POST") {
      kaydedilen = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, json: { id: "p1", ...kaydedilen } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/panel/projeler");
  await page.getByRole("button", { name: /Yeni Proje Oluştur/ }).click();
  await page.getByLabel("Proje Kodu *").fill("PRJ-E2E-001");
  await page.getByLabel("Proje Adı *").fill("E2E Projesi");
  await page.getByLabel("İşveren / Müşteri (Cari)").selectOption("c1");
  await page.getByLabel("Proje Sorumlusu").selectOption("u1");
  await page.getByRole("button", { name: "Projeyi Kaydet" }).click();

  await expect(page.getByText("Proje başarıyla oluşturuldu.")).toBeVisible();
  expect(kaydedilen).toMatchObject({
    kod: "PRJ-E2E-001",
    ad: "E2E Projesi",
    cariId: "c1",
    sorumluUserId: "u1",
  });
});

test("başarılı giriş access tokenı kaydeder ve panele yönlendirir", async ({ page }) => {
  await page.route("**/api/v1/auth/giris", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ eposta: "kullanici@example.com", parola: "guvenli-parola" });
    await route.fulfill({ json: { accessToken: "yeni-access-token", kullanici: { rol: "yonetici" } } });
  });
  await page.goto("/giris");
  await page.getByLabel("E-posta Adresi").fill("kullanici@example.com");
  await page.getByLabel("Parola", { exact: true }).fill("guvenli-parola");
  await page.getByRole("button", { name: "Giriş Yap" }).click();

  await expect(page).toHaveURL(/\/panel$/);
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_access"))).toBe("yeni-access-token");
  expect(await page.evaluate(() => localStorage.getItem("tekir_access"))).toBeNull();
});

test("eski kalıcı tokenı sekme oturumuna taşır ve localStorage kopyasını siler", async ({ page }) => {
  await page.goto("/giris");
  await page.evaluate(() => {
    sessionStorage.removeItem("tekir_access");
    localStorage.setItem("tekir_access", "eski-access-token");
  });
  await page.goto("/panel/satis");

  await expect(page.getByRole("heading", { level: 1, name: "Satış" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_access"))).toBe("eski-access-token");
  expect(await page.evaluate(() => localStorage.getItem("tekir_access"))).toBeNull();
});

test("faturasız gelir kaydı seçilen hesaba tahsilat oluşturur", async ({ page }) => {
  let kaydedilen: Record<string, unknown> | null = null;
  await page.route("**/api/v1/gelirler**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/gelirler/kategoriler")) {
      return route.fulfill({ json: [{ id: "kat1", ad: "Faiz Geliri", varsayilanStopajOrani: "15", varsayilanKdvOrani: "0", muhasebeKodu: "642", ustId: null }] });
    }
    if (route.request().method() === "POST") {
      kaydedilen = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, json: { id: "g1" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/v1/kasa-banka/kasalar", (route) =>
    route.fulfill({ json: [{ id: "k1", ad: "Merkez Kasa", dovizCinsi: "TRY", bakiye: "1000" }] }),
  );
  await page.route("**/api/v1/kasa-banka/bankalar", (route) => route.fulfill({ json: [] }));
  await page.goto("/panel/gelirler");
  await page.getByRole("button", { name: /Yeni Gelir Kaydı/ }).click();
  await page.getByLabel("Gelir Kategorisi").selectOption("kat1");
  await page.getByLabel("Tahsil Edilecek Kasa / Banka").selectOption("kasa:k1");
  await page.getByLabel("Brüt Gelir Tutarı").fill("1000");
  await page.getByRole("button", { name: "Kaydet ve Tahsil Et" }).click();

  await expect(page.getByText("Faturasız gelir kaydı ve kasa/banka tahsilat hareketi oluşturuldu.")).toBeVisible();
  expect(kaydedilen).toMatchObject({ kategoriId: "kat1", brutTutar: "1000", stopajOrani: "15", kasaId: "k1" });
});

test("kasa ödeme fişi doğru hesap ve işlem tipiyle kaydedilir", async ({ page }) => {
  let kaydedilen: Record<string, unknown> | null = null;
  await page.route("**/api/v1/kasa-banka/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/kasalar")) return route.fulfill({ json: [{ id: "k1", ad: "Merkez Kasa", dovizCinsi: "TRY", bakiye: "1000", borc: "0", alacak: "0", aktif: true }] });
    if (pathname.endsWith("/bankalar")) return route.fulfill({ json: [] });
    if (pathname.endsWith("/hareketler") && route.request().method() === "POST") {
      kaydedilen = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, json: { id: "h1" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/panel/kasa-banka");
  await page.getByRole("button", { name: "Fiş Girişi" }).click();
  await page.getByLabel("Kasa / Banka Seçimi").selectOption("kasa:k1");
  await page.getByLabel("İşlem Tipi").selectOption("tediye");
  await page.getByLabel("Tutar").fill("250");
  await page.getByRole("button", { name: "Fişi kaydet" }).click();

  await expect(page.getByText(/Tediye kaydedildi/)).toBeVisible();
  expect(kaydedilen).toMatchObject({ kasaId: "k1", bankaHesapId: null, tip: "tediye", tutar: "250" });
});

test("mobil menü ve bildirim düğmeleri kontrol ettikleri paneli bildirir", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/panel/satis");

  const menu = page.getByRole("button", { name: "Ana menüyü aç" });
  await expect(menu).toHaveAttribute("aria-controls", "ana-menu");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  const menuKapat = page.getByRole("button", { name: "Ana menüyü kapat" });
  await expect(menuKapat).toHaveAttribute("aria-expanded", "true");
  const yanMenu = page.locator("#ana-menu");
  const ilkMenuOgesi = yanMenu.getByRole("button", { name: /^Bildirimler/ });
  await expect(ilkMenuOgesi).toBeFocused();
  await yanMenu.getByRole("button", { name: "Güvenli çıkış" }).focus();
  await page.keyboard.press("Tab");
  await expect(ilkMenuOgesi).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Ana menüyü aç" })).toBeFocused();

  const bildirimler = page.getByRole("button", { name: /^Bildirimler/ }).first();
  await expect(bildirimler).toHaveAttribute("aria-controls", "bildirim-paneli");
  await expect(bildirimler).toHaveAttribute("aria-expanded", "false");
  await bildirimler.click();
  await expect(bildirimler).toHaveAttribute("aria-expanded", "true");
  const bildirimPaneli = page.getByRole("complementary", { name: "Bildirim merkezi" });
  await expect(bildirimPaneli).toBeVisible();
  await expect(bildirimPaneli.getByRole("button", { name: "Bildirimleri kapat" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(bildirimPaneli).toBeHidden();
  await expect(bildirimler).toBeFocused();
});

test("mobil temel form kontrolleri en az 44 piksel dokunmatik hedef sunar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/panel/fatura?yon=satis&yeni=1");
  const kontroller = [
    page.getByRole("combobox", { name: "Müşteri ara" }),
    page.getByLabel("Fatura Tipi"),
    page.getByLabel("Fatura Tarihi"),
    page.getByRole("button", { name: "Taslak faturayı kaydet" }),
  ];
  for (const [index, kontrol] of kontroller.entries()) {
    const kutu = await kontrol.boundingBox();
    expect(kutu?.height, `${index + 1}. mobil kontrol en az 44 px olmalı`).toBeGreaterThanOrEqual(44);
  }
});

test("değiştirilmiş fatura formu yanlışlıkla terk edilmez", async ({ page }) => {
  await page.goto("/panel/fatura?yon=satis&yeni=1");
  await page.getByLabel("Miktar").fill("3");

  const ayrilmaEngellendi = await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  expect(ayrilmaEngellendi).toBe(true);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("kaydedilmemiş değişiklikler silinecek");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Yeni satış faturası" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Yeni satış faturası" })).toBeHidden();

  await page.getByRole("button", { name: /Yeni Fatura/ }).click();
  await expect(page.getByLabel("Miktar")).toHaveValue("1");

  await page.getByLabel("Miktar").fill("2");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Cari Hesaplar" }).click();
  await expect(page).toHaveURL(/\/panel\/fatura/);
  await expect(page.getByLabel("Miktar")).toHaveValue("2");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Cari Hesaplar" }).click();
  await expect(page).toHaveURL(/\/panel\/cari/);
});

test("kullanıcı panelden geri bildirim gönderebilir", async ({ page }) => {
  let gonderilen: unknown;
  await page.route("**/api/v1/kullanim/geri-bildirim", async (route) => {
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

  const basari = page.getByRole("status");
  await expect(basari).toContainText("Geri bildiriminiz kaydedildi.");
  await expect(basari).toHaveAttribute("aria-live", "polite");
  await expect(basari.getByRole("button", { name: "Kapat" })).toBeFocused();
  expect(gonderilen).toEqual({
    puan: 4,
    kategori: "oneri",
    mesaj: "Kaydedilmiş görünümü ana sayfadan da açmak istiyorum.",
  });
});

test("başarısız geri bildirim formu veriyi korur ve yeniden gönderilebilir", async ({ page }) => {
  let deneme = 0;
  await page.route("**/api/v1/kullanim/geri-bildirim", async (route) => {
    deneme += 1;
    if (deneme === 1) {
      await route.fulfill({ status: 500, json: { mesaj: "Geçici sunucu hatası" } });
      return;
    }
    await route.fulfill({ json: { kaydedildi: true } });
  });

  await page.goto("/panel/satis");
  await page.getByRole("button", { name: "Geri bildirim ver" }).click();
  await page.getByRole("radio", { name: "2", exact: true }).click();
  await page.getByLabel("Konu").selectOption("hata");
  const aciklama = page.getByLabel(/Açıklama/);
  await aciklama.fill("Kaydetme sırasında bağlantı kesildi.");
  await page.getByRole("button", { name: "Gönder", exact: true }).click();

  const hata = page.getByRole("alert").filter({ hasText: "Geri bildirim gönderilemedi" });
  await expect(hata).toBeVisible();
  await expect(page.getByRole("radio", { name: "2", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Konu")).toHaveValue("hata");
  await expect(aciklama).toHaveValue("Kaydetme sırasında bağlantı kesildi.");

  await page.getByRole("button", { name: "Gönder", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Geri bildiriminiz kaydedildi.");
  expect(deneme).toBe(2);
});


test("ana panel kuyruk sayaçları tüm veri sayfalarını kapsar", async ({ page }) => {
  await page.route("**/api/v1/auth/ben", (route) =>
    route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "satis" } }),
  );
  await page.route("**/api/v1/firma", (route) => route.fulfill({ json: { unvan: "Test Firma" } }));
  const faturaIstekleri: string[] = []; const stokIstekleri: string[] = [];
  await page.route("**/api/v1/fatura**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/fatura/is-kuyrugu-ozeti")) {
      return route.fulfill({ json: { taslakSatis: 2, taslakAlis: 0, ebelgeHata: 0, acikTahsilat: 2, acikOdeme: 0 } });
    }
    const imlec = url.searchParams.get("imlec");
    if (url.searchParams.get("adet") === "200") faturaIstekleri.push(imlec ?? "ilk");
    const fatura = { tip: "satis", durum: "taslak", odemeOzeti: { durum: "odenmedi" }, ebelge: null };
    return route.fulfill({ json: imlec === "fatura-1"
      ? { kayitlar: [fatura], sonrakiImlec: null }
      : { kayitlar: [fatura], sonrakiImlec: "fatura-1" }
    });
  });
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/stok/kritik-ozeti") return route.fulfill({ json: { kritikStok: 2 } });
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const imlec = url.searchParams.get("imlec"); stokIstekleri.push(imlec ?? "ilk");
    const stok = { kritikSeviye: "5", mevcutMiktar: "3" };
    return route.fulfill({ json: imlec === "stok-1"
      ? { kayitlar: [stok], sonrakiImlec: null }
      : { kayitlar: [stok], sonrakiImlec: "stok-1" }
    });
  });

  await page.goto("/panel");
  await expect(page.getByRole("link", { name: /Taslak satış faturaları/ }).locator(".queue-row__count")).toHaveText("2");
  await expect(page.getByRole("link", { name: /Kritik stoklar/ }).locator(".queue-row__count")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Bildirimler 4" })).toBeVisible();
  expect(faturaIstekleri).toEqual([]);
  expect(stokIstekleri).toEqual([]);
});

test("stok sayımı tüm stok sayfalarını forma yükler", async ({ page }) => {
  const stok = (id: string, kod: string, ad: string) => ({
    id, kod, ad, tip: "urun", anaBirim: "adet", mevcutMiktar: "10",
  });
  const istekler: string[] = [];
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/stok/sayimlar") return route.fulfill({ json: [] });
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const imlec = url.searchParams.get("imlec");
    istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "stok-1"
      ? { kayitlar: [stok("stok-2", "STK-002", "İkinci Sayfa Ürünü")], sonrakiImlec: null }
      : { kayitlar: [stok("stok-1", "STK-001", "İlk Sayfa Ürünü")], sonrakiImlec: "stok-1" }
    });
  });

  await page.goto("/panel/stok/sayim");
  await page.getByRole("button", { name: /Yeni Sayım/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "İkinci Sayfa Ürünü" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "İlk Sayfa Ürünü" })).toBeVisible();
  expect([...new Set(istekler)]).toEqual(["ilk", "stok-1"]);
});

test("kategori ürün sayıları tüm stok sayfalarını kapsar", async ({ page }) => {
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/stok/kategoriler") {
      return route.fulfill({ json: [{ id: "kat-1", ad: "Elektronik", ustId: null, ust: null }] });
    }
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const imlec = url.searchParams.get("imlec");
    return route.fulfill({ json: imlec === "stok-1"
      ? { kayitlar: [{ kategoriId: "kat-1" }], sonrakiImlec: null }
      : { kayitlar: [{ kategoriId: "kat-1" }], sonrakiImlec: "stok-1" }
    });
  });

  await page.goto("/panel/stok/kategoriler");
  const kategori = page.getByRole("listitem").filter({ hasText: "Elektronik" });
  await expect(kategori.getByText("2 ürün")).toBeVisible();
  await expect(kategori.getByRole("button", { name: "Sil" })).toBeDisabled();
});

// "Tüm sayfaları yükler" testleri istenen imleç kümesini doğrular, istek sayısını değil:
// geliştirme sunucusunda React strict mode efektleri iki kez çalıştırır ve her sayfa
// iki kez istenir. Üretim derlemesinde her sayfa bir kez istenir (2026-09-13 ölçümü).
test("kasa banka fişi tüm cari sayfalarını seçime yükler", async ({ page }) => {
  await page.route("**/api/v1/kasa-banka/**", (route) => route.fulfill({ json: [] }));
  const istekler: string[] = [];
  await page.route("**/api/v1/cari**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    const imlec = url.searchParams.get("imlec");
    istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "cari-1"
      ? { kayitlar: [{ id: "cari-2", unvan: "İkinci Sayfa Cari" }], sonrakiImlec: null }
      : { kayitlar: [{ id: "cari-1", unvan: "İlk Sayfa Cari" }], sonrakiImlec: "cari-1" }
    });
  });

  await page.goto("/panel/kasa-banka");
  await page.getByRole("button", { name: /Fiş Girişi/ }).click();
  // Cari seçimi aranabilir seçicidir; seçenekler odaklanınca listelenir.
  await page.getByRole("combobox", { name: "Cari bağlantısı" }).click();
  await expect(page.getByRole("option", { name: /İkinci Sayfa Cari/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /İlk Sayfa Cari/ })).toHaveCount(1);
  expect([...new Set(istekler)]).toEqual(["ilk", "cari-1"]);
});

test("fiyat listesi tüm stok sayfalarını ürün seçimine yükler", async ({ page }) => {
  await page.route("**/api/v1/fiyat-listeleri**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/fiyat-listeleri/liste-1") {
      return route.fulfill({ json: { id: "liste-1", ad: "Bayi", dovizCinsi: "TRY", aktif: true, cariSayisi: 0, kalemler: [] } });
    }
    return route.fulfill({ json: [{ id: "liste-1", ad: "Bayi", dovizCinsi: "TRY", aktif: true, kalemSayisi: 0, cariSayisi: 0 }] });
  });
  const istekler: string[] = [];
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const imlec = url.searchParams.get("imlec");
    istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "stok-1"
      ? { kayitlar: [{ id: "stok-2", kod: "STK-002", ad: "İkinci Sayfa Ürünü" }], sonrakiImlec: null }
      : { kayitlar: [{ id: "stok-1", kod: "STK-001", ad: "İlk Sayfa Ürünü" }], sonrakiImlec: "stok-1" }
    });
  });

  await page.goto("/panel/stok/fiyat-listeleri");
  await page.getByRole("button", { name: /Kalemler/ }).click();
  const urunSecimi = page.getByLabel("Ürün ekle / güncelle");
  await expect(urunSecimi.locator("option", { hasText: "İkinci Sayfa Ürünü" })).toHaveCount(1);
  await expect(urunSecimi.locator("option", { hasText: "İlk Sayfa Ürünü" })).toHaveCount(1);
  expect([...new Set(istekler)]).toEqual(["ilk", "stok-1"]);
});

test("belge formu tüm cari ve stok sayfalarını seçime yükler", async ({ page }) => {
  await page.route("**/api/v1/belgeler**", (route) =>
    route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } }),
  );
  const cariIstekleri: string[] = []; const stokIstekleri: string[] = [];
  await page.route("**/api/v1/cari**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    const imlec = url.searchParams.get("imlec"); cariIstekleri.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "cari-1"
      ? { kayitlar: [{ id: "cari-2", kod: "C002", unvan: "İkinci Belge Carisi" }], sonrakiImlec: null }
      : { kayitlar: [{ id: "cari-1", kod: "C001", unvan: "İlk Belge Carisi" }], sonrakiImlec: "cari-1" }
    });
  });
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const imlec = url.searchParams.get("imlec"); stokIstekleri.push(imlec ?? "ilk");
    const stok = (id: string, kod: string, ad: string) => ({ id, kod, ad, kdvOrani: "20", satisFiyati: "100", alisFiyati: "80" });
    return route.fulfill({ json: imlec === "stok-1"
      ? { kayitlar: [stok("stok-2", "STK-002", "İkinci Belge Ürünü")], sonrakiImlec: null }
      : { kayitlar: [stok("stok-1", "STK-001", "İlk Belge Ürünü")], sonrakiImlec: "stok-1" }
    });
  });

  await page.goto("/panel/belgeler?yeni=1");
  await page.getByLabel("Müşteri ara").fill("İkinci Belge Carisi");
  await expect(page.getByText("İkinci Belge Carisi", { exact: true })).toBeVisible();
  await page.getByLabel("1. satır ürün veya hizmet seçimi").fill("İkinci Belge Ürünü");
  await expect(page.getByText("İkinci Belge Ürünü", { exact: true })).toBeVisible();
  expect([...new Set(cariIstekleri)]).toEqual(["ilk", "cari-1"]);
  expect([...new Set(stokIstekleri)]).toEqual(["ilk", "stok-1"]);
});

test("fatura formu tüm cari ve stok sayfalarını seçime yükler", async ({ page }) => {
  const cariIstekleri: string[] = [];
  const stokIstekleri: string[] = [];
  await page.route("**/api/v1/cari**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    const imlec = url.searchParams.get("imlec"); cariIstekleri.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "cari-1"
      ? { kayitlar: [{ id: "cari-2", kod: "C002", unvan: "İkinci Sayfa Cari" }], sonrakiImlec: null }
      : { kayitlar: [{ id: "cari-1", kod: "C001", unvan: "İlk Sayfa Cari" }], sonrakiImlec: "cari-1" }
    });
  });
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const imlec = url.searchParams.get("imlec"); stokIstekleri.push(imlec ?? "ilk");
    const stok = (id: string, kod: string, ad: string) => ({ id, kod, ad, kdvOrani: "20", satisFiyati: "100", alisFiyati: "80", kullanilabilirMiktar: "10" });
    return route.fulfill({ json: imlec === "stok-1"
      ? { kayitlar: [stok("stok-2", "STK-002", "İkinci Sayfa Ürünü")], sonrakiImlec: null }
      : { kayitlar: [stok("stok-1", "STK-001", "İlk Sayfa Ürünü")], sonrakiImlec: "stok-1" }
    });
  });

  await page.goto("/panel/fatura?yeni=1");
  await page.getByLabel("Müşteri ara").fill("İkinci Sayfa Cari");
  await expect(page.getByText("İkinci Sayfa Cari", { exact: true })).toBeVisible();
  await page.getByLabel("1. satır ürün veya hizmet seçimi").fill("İkinci Sayfa Ürünü");
  await expect(page.getByText("İkinci Sayfa Ürünü", { exact: true })).toBeVisible();
  expect([...new Set(cariIstekleri)]).toEqual(["ilk", "cari-1"]);
  expect([...new Set(stokIstekleri)]).toEqual(["ilk", "stok-1"]);
});

test("stok tedarikçi seçimi tüm cari sayfalarını yükler", async ({ page }) => {
  await page.route("**/api/v1/stok/stok-1**", (route) => {
    const yol = new URL(route.request().url()).pathname;
    if (yol.endsWith("/hareketler") || yol.endsWith("/depo-bakiyeleri")) return route.fulfill({ json: [] });
    return route.fulfill({ json: {
      id: "stok-1", kod: "STK-001", ad: "Test Ürün", kisaAd: null, aciklama: null, tip: "urun", marka: null, model: null, mensei: null,
      gtipKodu: null, ureticiUrunKodu: null, barkod: null, kategoriId: null, anaBirim: "adet", kdvOrani: "20",
      alisFiyati: "80", satisFiyati: "100", kritikSeviye: null, minStok: null, maksStok: null, guvenlikStogu: null,
      tedarikSuresiGun: null, gorselUrl: null, mevcutMiktar: "10", rezerveMiktar: "0", yoldakiMiktar: "0",
      kullanilabilirMiktar: "10", ortalamaMaliyet: "75", aktif: true, kategori: null, birimler: [], barkodlar: [], tedarikciler: [], izinliEylemler: [],
    } });
  });
  await page.route("**/api/v1/stok/kategoriler", (route) => route.fulfill({ json: [] }));
  const istekler: string[] = [];
  await page.route("**/api/v1/cari**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    const imlec = url.searchParams.get("imlec"); istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "cari-1"
      ? { kayitlar: [{ id: "cari-2", kod: "C002", unvan: "İkinci Sayfa Tedarikçi" }], sonrakiImlec: null }
      : { kayitlar: [{ id: "cari-1", kod: "C001", unvan: "İlk Sayfa Tedarikçi" }], sonrakiImlec: "cari-1" }
    });
  });

  await page.goto("/panel/stok/stok-1");
  const tedarikcilerSekmesi = page.getByRole("tab", { name: /Tedarikçiler/ });
  await expect(tedarikcilerSekmesi).toHaveAttribute("aria-controls", "stok-detay-panel-tedarikciler");
  await tedarikcilerSekmesi.click();
  await expect(page.getByRole("tabpanel", { name: /Tedarikçiler/ })).toBeVisible();
  const cariSecimi = page.getByLabel("Cari");
  await expect(cariSecimi.locator("option", { hasText: "İkinci Sayfa Tedarikçi" })).toHaveCount(1);
  await expect(cariSecimi.locator("option", { hasText: "İlk Sayfa Tedarikçi" })).toHaveCount(1);
  expect([...new Set(istekler)]).toEqual(["ilk", "cari-1"]);
});

test("çek senet formu tüm cari sayfalarını seçime yükler", async ({ page }) => {
  // Kalıp özet ucunu da yakalar; özet nesne bekler, dizi gelirse sayfa çöker.
  const bos = { adet: 0, toplamTry: "0" };
  await page.route("**/api/v1/kasa-banka/cek-senet**", (route) => route.fulfill({
    json: new URL(route.request().url()).pathname.endsWith("/cek-senet-ozet")
      ? { acik: { ...bos, dovizler: {} }, geciken: bos, yaklasan: bos, bankada: bos, ciro: bos, karsiliksiz: bos }
      : [],
  }));
  const istekler: string[] = [];
  await page.route("**/api/v1/cari**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    const imlec = url.searchParams.get("imlec"); istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "cari-1"
      ? { kayitlar: [{ id: "cari-2", kod: "C002", unvan: "İkinci Sayfa Çek Carisi" }], sonrakiImlec: null }
      : { kayitlar: [{ id: "cari-1", kod: "C001", unvan: "İlk Sayfa Çek Carisi" }], sonrakiImlec: "cari-1" }
    });
  });

  await page.goto("/panel/kasa-banka/cek-senet");
  await page.getByRole("button", { name: "+ Çek/Senet Al" }).click();
  await page.getByRole("combobox", { name: "İlgili Cari" }).click();
  await expect(page.getByRole("option", { name: /İkinci Sayfa Çek Carisi/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /İlk Sayfa Çek Carisi/ })).toHaveCount(1);
  expect([...new Set(istekler)]).toEqual(["ilk", "cari-1"]);
});

test("rapor filtreleri tüm cari ve stok sayfalarını yükler", async ({ page }) => {
  await page.route("**/api/v1/raporlar**", (route) => {
    const yol = new URL(route.request().url()).pathname;
    if (yol.endsWith("/gorunumler")) return route.fulfill({ json: [] });
    return route.fulfill({ json: [{
      kod: "test-raporu", modul: "genel", ad: "Test Raporu", aciklama: null, gruplamalar: [], kolonlar: [],
      filtreler: [{ alan: "cariId", ad: "Cari", tip: "cari" }, { alan: "stokId", ad: "Stok", tip: "stok" }],
    }] });
  });
  const sayfaliYanit = (url: URL, tur: "Cari" | "Stok") => {
    const imlec = url.searchParams.get("imlec");
    const onEk = tur === "Cari" ? "cari" : "stok";
    return imlec === onEk + "-1"
      ? { kayitlar: [{ id: onEk + "-2", ad: "İkinci Sayfa " + tur }], sonrakiImlec: null }
      : { kayitlar: [{ id: onEk + "-1", ad: "İlk Sayfa " + tur }], sonrakiImlec: onEk + "-1" };
  };
  await page.route("**/api/v1/cari**", (route) => route.fulfill({ json: sayfaliYanit(new URL(route.request().url()), "Cari") }));
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    return route.fulfill({ json: sayfaliYanit(url, "Stok") });
  });

  await page.goto("/panel/raporlar");
  await expect(page.getByLabel("Cari").locator("option", { hasText: "İkinci Sayfa Cari" })).toHaveCount(1);
  await expect(page.getByLabel("Stok").locator("option", { hasText: "İkinci Sayfa Stok" })).toHaveCount(1);
});

test("fatura listesinin sonraki sayfası mevcut kayıtlara eklenir", async ({ page }) => {
  const fatura = (id: string, no: string) => ({
    id, no, tip: "satis", tarih: "2026-08-07", durum: "kesin",
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
    cari: { unvan: "Örnek Müşteri" }, ebelge: null,
    odemeOzeti: { durum: "odenmedi", odenen: "0.00", kalan: "1200.00" },
  });
  const istekler: string[] = [];
  await page.route("**/api/v1/fatura**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("adet") === "200") return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
    const imlec = url.searchParams.get("imlec");
    istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "sonraki-1"
      ? { kayitlar: [fatura("f2", "SAT-002")], sonrakiImlec: null }
      : { kayitlar: [fatura("f1", "SAT-001")], sonrakiImlec: "sonraki-1" }
    });
  });

  await page.goto("/panel/fatura");
  await expect(page.getByRole("row").filter({ hasText: "SAT-001" })).toBeVisible();
  await page.getByRole("button", { name: "Daha fazla fatura yükle" }).click();
  await expect(page.getByRole("row").filter({ hasText: "SAT-002" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SAT-001" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Daha fazla fatura yükle" })).toHaveCount(0);
  expect(istekler.at(-1)).toBe("sonraki-1");
  expect(istekler.filter((istek) => istek === "sonraki-1")).toHaveLength(1);
});

test("açık ödeme filtresi eşleşme için sonraki fatura sayfasını tarar", async ({ page }) => {
  const fatura = (id: string, no: string, odemeDurumu: "odendi" | "odenmedi") => ({
    id, no, tip: "satis", tarih: "2026-08-07", durum: "kesin",
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00", cari: { unvan: "Örnek Müşteri" },
    ebelge: null, odemeOzeti: { durum: odemeDurumu, odenen: odemeDurumu === "odendi" ? "1200.00" : "0.00", kalan: odemeDurumu === "odendi" ? "0.00" : "1200.00" },
  });
  const istekler: string[] = [];
  await page.route("**/api/v1/fatura**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("adet") === "200") return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
    const imlec = url.searchParams.get("imlec");
    istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "sonraki-1"
      ? { kayitlar: [fatura("f2", "SAT-ACIK", "odenmedi")], sonrakiImlec: null }
      : { kayitlar: [fatura("f1", "SAT-ODENDI", "odendi")], sonrakiImlec: "sonraki-1" }
    });
  });

  await page.goto("/panel/fatura");
  await expect(page.getByRole("row").filter({ hasText: "SAT-ODENDI" })).toBeVisible();
  await page.getByLabel("Ödeme durumu").selectOption("acik");
  await expect(page.getByRole("row").filter({ hasText: "SAT-ACIK" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SAT-ODENDI" })).not.toBeVisible();
  expect(istekler.filter((istek) => istek === "sonraki-1")).toHaveLength(1);
});

test("geç dönen eski fatura filtresi güncel sonucu ezmez", async ({ page }) => {
  const fatura = (id: string, no: string, durum: string) => ({
    id, no, tip: "satis", tarih: "2026-08-07", durum,
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
    cari: { unvan: "Örnek Müşteri" }, ebelge: null,
    odemeOzeti: { durum: "odenmedi", odenen: "0.00", kalan: "1200.00" },
  });
  let yavasYanitla!: () => void; let yavasBasladi!: () => void; let yavasTamamlandi!: () => void;
  const yavasBekleme = new Promise<void>((resolve) => { yavasYanitla = resolve; });
  const yavasIstek = new Promise<void>((resolve) => { yavasBasladi = resolve; });
  const yavasBitti = new Promise<void>((resolve) => { yavasTamamlandi = resolve; });
  await page.route("**/api/v1/fatura**", async (route) => {
    const durum = new URL(route.request().url()).searchParams.get("durum");
    if (durum === "taslak") {
      yavasBasladi(); await yavasBekleme;
      await route.fulfill({ json: { kayitlar: [fatura("f1", "YAVAS-TASLAK", "taslak")], sonrakiImlec: null } });
      yavasTamamlandi(); return;
    }
    if (durum === "kesin") return route.fulfill({ json: { kayitlar: [fatura("f2", "HIZLI-KESIN", "kesin")], sonrakiImlec: null } });
    return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
  });

  await page.goto("/panel/fatura");
  await page.getByLabel("Fatura durumu").selectOption("taslak"); await yavasIstek;
  await page.getByLabel("Fatura durumu").selectOption("kesin");
  await expect(page.getByRole("row").filter({ hasText: "HIZLI-KESIN" })).toBeVisible();
  yavasYanitla(); await yavasBitti;
  await expect(page.getByRole("row").filter({ hasText: "HIZLI-KESIN" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "YAVAS-TASLAK" })).not.toBeVisible();
});

test("cari listesinin sonraki sayfası mevcut kayıtlara eklenir", async ({ page }) => {
  const cari = (id: string, kod: string, unvan: string) => ({
    id, kod, unvan, tip: "musteri", sektor: null, vknTckn: null, eposta: null, telefon: null,
    karaListe: false, bakiyeler: [{ dovizCinsi: "TRY", bakiye: "0.00" }],
  });
  const istekler: string[] = [];
  await page.route("**/api/v1/cari**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    const imlec = url.searchParams.get("imlec");
    istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "sonraki-1"
      ? { kayitlar: [cari("c2", "C002", "İkinci Cari")], sonrakiImlec: null }
      : { kayitlar: [cari("c1", "C001", "İlk Cari")], sonrakiImlec: "sonraki-1" }
    });
  });

  await page.goto("/panel/cari");
  await expect(page.getByRole("row").filter({ hasText: "İlk Cari" })).toBeVisible();
  await page.getByRole("button", { name: "Daha fazla cari yükle" }).click();
  await expect(page.getByRole("row").filter({ hasText: "İkinci Cari" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "İlk Cari" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Daha fazla cari yükle" })).toHaveCount(0);
  expect(istekler.at(-1)).toBe("sonraki-1");
  expect(istekler.filter((istek) => istek === "sonraki-1")).toHaveLength(1);
});

test("cari türü ve bloke filtreleri sunucu sorgusuna uygulanır", async ({ page }) => {
  const cari = (id: string, unvan: string, tip: string, karaListe: boolean) => ({
    id, kod: id, unvan, tip, sektor: null, vknTckn: null, eposta: null, telefon: null, karaListe,
    bakiyeler: [{ dovizCinsi: "TRY", bakiye: "0.00" }],
  });
  const istekler: URL[] = [];
  await page.route("**/api/v1/cari**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    istekler.push(url);
    const kayitlar = url.searchParams.get("durum") === "bloke"
      ? [cari("c3", "Bloke Cari", "musteri", true)]
      : url.searchParams.get("tip") === "tedarikci"
        ? [cari("c2", "Tedarikçi Cari", "tedarikci", false)]
        : [cari("c1", "Müşteri Cari", "musteri", false), cari("c2", "Tedarikçi Cari", "tedarikci", false)];
    return route.fulfill({ json: { kayitlar, sonrakiImlec: null } });
  });

  await page.goto("/panel/cari");
  await page.getByLabel("Cari türü").selectOption("tedarikci");
  await expect(page.getByRole("row").filter({ hasText: "Tedarikçi Cari" })).toBeVisible();
  await expect.poll(() => istekler.at(-1)?.searchParams.get("tip")).toBe("tedarikci");
  await page.getByLabel("Cari türü").selectOption("bloke");
  await expect(page.getByRole("row").filter({ hasText: "Bloke Cari" })).toBeVisible();
  await expect.poll(() => istekler.at(-1)?.searchParams.get("durum")).toBe("bloke");
});

test("geç dönen eski cari araması güncel sonucu ezmez", async ({ page }) => {
  const cari = (id: string, kod: string, unvan: string) => ({
    id, kod, unvan, tip: "musteri", sektor: null, vknTckn: null, eposta: null, telefon: null,
    karaListe: false, bakiyeler: [{ dovizCinsi: "TRY", bakiye: "0.00" }],
  });
  let yavasYanitla!: () => void; let yavasBasladi!: () => void; let yavasTamamlandi!: () => void;
  const yavasBekleme = new Promise<void>((resolve) => { yavasYanitla = resolve; });
  const yavasIstek = new Promise<void>((resolve) => { yavasBasladi = resolve; });
  const yavasBitti = new Promise<void>((resolve) => { yavasTamamlandi = resolve; });
  await page.route("**/api/v1/cari**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/cari") return route.fallback();
    const arama = url.searchParams.get("arama");
    if (arama === "Yavaş Cari") {
      yavasBasladi(); await yavasBekleme;
      await route.fulfill({ json: { kayitlar: [cari("c1", "YAVAS", "Yavaş Cari")], sonrakiImlec: null } });
      yavasTamamlandi(); return;
    }
    if (arama === "Hızlı Cari") return route.fulfill({ json: { kayitlar: [cari("c2", "HIZLI", "Hızlı Cari")], sonrakiImlec: null } });
    return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
  });

  await page.goto("/panel/cari");
  const arama = page.getByPlaceholder("Cari adı, kodu, VKN veya telefon ile ara...");
  await arama.fill("Yavaş Cari"); await yavasIstek;
  await arama.fill("Hızlı Cari");
  await expect(page.getByRole("row").filter({ hasText: "Hızlı Cari" })).toBeVisible();
  yavasYanitla(); await yavasBitti;
  await expect(page.getByRole("row").filter({ hasText: "Hızlı Cari" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Yavaş Cari" })).not.toBeVisible();
});

test("stok listesinin sonraki sayfası mevcut kayıtlara eklenir", async ({ page }) => {
  const stok = (id: string, kod: string, ad: string) => ({
    id, kod, ad, tip: "urun", barkod: null, anaBirim: "adet", kdvOrani: "20",
    alisFiyati: "100.00", satisFiyati: "120.00", mevcutMiktar: "10", ortalamaMaliyet: "90.00",
  });
  const istekler: string[] = [];
  await page.route("**/api/v1/stok**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const imlec = url.searchParams.get("imlec");
    istekler.push(imlec ?? "ilk");
    return route.fulfill({ json: imlec === "sonraki-1"
      ? { kayitlar: [stok("s2", "STK-002", "İkinci Ürün")], sonrakiImlec: null }
      : { kayitlar: [stok("s1", "STK-001", "İlk Ürün")], sonrakiImlec: "sonraki-1" }
    });
  });

  await page.goto("/panel/stok");
  await expect(page.getByRole("row").filter({ hasText: "İlk Ürün" })).toBeVisible();
  await page.getByRole("button", { name: "Daha fazla stok yükle" }).click();
  await expect(page.getByRole("row").filter({ hasText: "İkinci Ürün" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "İlk Ürün" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Daha fazla stok yükle" })).toHaveCount(0);
  expect(istekler.at(-1)).toBe("sonraki-1");
  expect(istekler.filter((istek) => istek === "sonraki-1")).toHaveLength(1);
});

test("geç dönen eski stok araması güncel sonucu ezmez", async ({ page }) => {
  const stok = (id: string, kod: string, ad: string) => ({
    id, kod, ad, tip: "urun", barkod: null, anaBirim: "adet", kdvOrani: "20",
    alisFiyati: "100.00", satisFiyati: "120.00", mevcutMiktar: "10", ortalamaMaliyet: "90.00",
  });
  let yavasYanitla!: () => void; let yavasBasladi!: () => void; let yavasTamamlandi!: () => void;
  const yavasBekleme = new Promise<void>((resolve) => { yavasYanitla = resolve; });
  const yavasIstek = new Promise<void>((resolve) => { yavasBasladi = resolve; });
  const yavasBitti = new Promise<void>((resolve) => { yavasTamamlandi = resolve; });
  await page.route("**/api/v1/stok**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/stok") return route.fallback();
    const arama = url.searchParams.get("arama");
    if (arama === "Yavaş Ürün") {
      yavasBasladi(); await yavasBekleme;
      await route.fulfill({ json: { kayitlar: [stok("s1", "YAVAS", "Yavaş Ürün")], sonrakiImlec: null } });
      yavasTamamlandi(); return;
    }
    if (arama === "Hızlı Ürün") return route.fulfill({ json: { kayitlar: [stok("s2", "HIZLI", "Hızlı Ürün")], sonrakiImlec: null } });
    return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
  });

  await page.goto("/panel/stok");
  const arama = page.getByPlaceholder("Stok adına, koduna, barkoduna veya tedarikçi koduna göre ara...");
  await arama.fill("Yavaş Ürün"); await yavasIstek;
  await arama.fill("Hızlı Ürün");
  await expect(page.getByRole("row").filter({ hasText: "Hızlı Ürün" })).toBeVisible();
  yavasYanitla(); await yavasBitti;
  await expect(page.getByRole("row").filter({ hasText: "Hızlı Ürün" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Yavaş Ürün" })).not.toBeVisible();
});

test("fatura, e-Belge ve ödeme durumları bağımsız izlenebilir", async ({ page }) => {
  const faturaIstekleri: URL[] = [];
  await page.route("**/api/v1/fatura**", async (route) => {
    faturaIstekleri.push(new URL(route.request().url()));
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
  await expect.poll(() => faturaIstekleri.at(-1)?.searchParams.get("durum")).toBe("kesin");
  expect(faturaIstekleri.at(-1)?.searchParams.get("ebelge")).toBe("hata");
});


test("ana sayfa role uygun iş kuyruklarını ve finansal görünürlüğü sunar", async ({ page }) => {
  let rol: "satis" | "yonetici" = "satis";
  await page.route("**/api/v1/**", async (route) => {
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
  await page.route("**/api/v1/fatura", (route) => route.fulfill({ json: { kayitlar: [{
    id: "f1", no: null, tip: "satis", tarih: "2026-08-07", durum: "taslak",
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
    cari: { unvan: "Örnek Müşteri AŞ" }, odemeOzeti: { durum: "beklemede", odenen: "0", kalan: "1200" },
  }] } }));
  await page.route("**/api/v1/fatura/f1", (route) => route.fulfill({ json: {
    id: "f1", no: null, tip: "satis", tarih: "2026-08-07", durum: "taslak", dovizCinsi: "TRY",
    toplamMatrah: "1000.00", toplamKdv: "200.00", genelToplam: "1200.00",
    cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri AŞ", vknTckn: "1234567890", eFaturaMukellefi: true },
    satirlar: [{ stokId: "s1", stokKod: "S001", stokAd: "Ürün", miktar: "2", birim: "adet" }],
    odemeOzeti: { durum: "beklemede", odenen: "0", kalan: "1200", hareketler: [] },
  } }));
  await page.route("**/api/v1/cari/c1", (route) => route.fulfill({ json: {
    id: "c1", unvan: "Örnek Müşteri AŞ", bakiyeler: [],
    risk: { mevcutRisk: "300.00", limit: "5000.00", kalanLimit: "4700.00", asim: false },
  } }));

  // Liste satır eylemi taşımaz; fatura açılır, eylem formun üstündeki çubuktadır.
  await page.goto("/panel/fatura/yeni?ac=f1");
  await page.getByRole("toolbar", { name: "Fatura eylemleri" }).getByRole("button", { name: /Kesinleştir/ }).click();
  const panel = page.getByRole("dialog", { name: "Faturayı kesinleştir" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("KDV");
  await expect(panel).toContainText("200,00 TL");
  await expect(panel).toContainText("2 birim azalacak");
  await expect(panel).toContainText("1.200,00 TL borç yazılacak");
  // e-Belge kesinleştirmeyle kuyruğa girmez; kesinleşen faturada sihirbazla oluşturulur.
  await expect(panel).toContainText("Kesinleştirme sonrası ayrıca wizard ile oluşturulacak");
  await expect(panel).toContainText("1.500,00 TL");
});


test("fatura kalemleri yalnız klavyeyle kesintisiz girilebilir", async ({ page }) => {
  await page.route("**/api/v1/stok?adet=200", (route) => route.fulfill({ json: { kayitlar: [{
    id: "s1", kod: "STK-001", ad: "Klavye Ürünü", barkod: "8690000000001", anaBirim: "adet",
    kullanilabilirMiktar: "25", alisFiyati: "80.00", satisFiyati: "100.00", kdvOrani: "20",
    tedarikciUrunKodlari: ["TED-42"],
  }], sonrakiImlec: null } }));
  await page.route("**/api/v1/stok/s1/tavsiye-fiyat**", (route) => route.fulfill({ json: { birimFiyat: 100, iskontoOrani: 0 } }));

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
  await page.route("**/api/v1/fatura", (route) => route.fulfill({ json: { kayitlar: [liste] } }));
  await page.route("**/api/v1/fatura/f1", (route) => route.fulfill({ json: {
    ...liste, dovizCinsi: "TRY", cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri AŞ", vknTckn: "1234567890", eFaturaMukellefi: true },
    satirlar: [], odemeOzeti: { ...liste.odemeOzeti, hareketler: [] },
    ebelge: { id: "e1", durum: yenidenGonderildi ? "kuyrukta" : "hata", tur: "efatura", entegratorRef: null,
      hataMesaji: yenidenGonderildi ? null : "Alıcı VKN bilgisi entegratör kaydıyla eşleşmiyor.",
      createdAt: "2026-08-07T08:00:00.000Z", updatedAt: "2026-08-07T08:05:00.000Z" },
  } }));
  await page.route("**/api/v1/ebelge/gonder/f1", (route) => {
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


test("belge dönüşümünden önce aktarılacak içerik onaylanır", async ({ page }) => {
  let donusumIstegi: unknown = null;
  const belge = {
    id: "b1", tur: "teklif", yon: "satis", durum: "onaylandi", no: "TK-001", tarih: "2026-08-07",
    genelToplam: "1200.00", dovizCinsi: "TRY", faturaId: null, gecerlilikTarihi: "2026-08-31",
    aciklama: null, notlar: null, kaynakBelge: null, turetilenler: [], fatura: null,
    cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri AŞ" },
    satirlar: [
      { stokId: "s1", miktar: "1", birim: "adet", birimFiyat: "500", iskontoOrani: "0", kdvOrani: "20" },
      { stokId: "s2", miktar: "1", birim: "adet", birimFiyat: "500", iskontoOrani: "0", kdvOrani: "20" },
    ],
  };
  await page.route("**/api/v1/belgeler", (route) => route.fulfill({ json: { kayitlar: [belge] } }));
  await page.route("**/api/v1/belgeler/b1", (route) => route.fulfill({ json: belge }));
  await page.route("**/api/v1/belgeler/b1/donustur", async (route) => {
    donusumIstegi = route.request().postDataJSON();
    await route.fulfill({ json: { id: "b2" } });
  });

  await page.goto("/panel/belgeler");
  await page.getByRole("row", { name: "Teklif TK-001 belgesini aç" }).click();
  await expect(page.getByRole("toolbar", { name: "Belge eylemleri" }).getByRole("button", { name: "→ Sipariş" })).toBeVisible();
  const zincir = page.getByLabel("Belge yaşam döngüsü");
  await expect(zincir.getByRole("button", { name: /Teklif Mevcut/ })).toBeDisabled();
  await zincir.getByRole("button", { name: /Sipariş Oluştur/ }).click();
  const panel = page.getByRole("dialog", { name: "Belgeyi dönüştür" });
  await expect(panel).toContainText("Teklif TK-001 → Sipariş");
  await expect(panel).toContainText("Örnek Müşteri AŞ");
  await expect(panel).toContainText("Aktarılacak kalem2");
  await expect(panel).toContainText("Cari, belge kalemleri, fiyatlar, iskontolar, vergiler ve kaynak belge referansı");
  await panel.getByRole("button", { name: "Dönüştür", exact: true }).click();
  await expect(page.getByText("Belge Sipariş'e dönüştürüldü.")).toBeVisible();
  expect(donusumIstegi).toEqual({ hedef: "siparis" });
});

test("görünür faturalanabilir belgeler topluca seçilir", async ({ page }) => {
  const belge = (id: string, no: string, tur: string, durum: string) => ({
    id, no, tur, durum, yon: "satis", tarih: "2026-08-07", genelToplam: "1200.00",
    dovizCinsi: "TRY", faturaId: null, cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
  });
  let gonderilen: unknown = null;
  await page.route("**/api/v1/belgeler", (route) => route.fulfill({ json: { kayitlar: [
    belge("b1", "SP-001", "siparis", "onaylandi"), belge("b2", "IRS-001", "irsaliye", "onaylandi"),
    belge("b3", "SP-TASLAK", "siparis", "taslak"),
  ], sonrakiImlec: null } }));
  await page.route("**/api/v1/belgeler/toplu-fatura", (route) => {
    gonderilen = route.request().postDataJSON();
    return route.fulfill({ json: { faturaId: "f1" } });
  });

  await page.goto("/panel/belgeler");
  const tumunuSec = page.getByRole("checkbox", { name: "Faturalanabilir belgelerin tümünü seç" });
  const ilkBelge = page.getByRole("checkbox", { name: "SP-001 belgesini seç" });
  await ilkBelge.check();
  await expect(tumunuSec).toHaveJSProperty("indeterminate", true);
  await expect(tumunuSec).toHaveAttribute("aria-checked", "mixed");
  await tumunuSec.click();
  await expect(ilkBelge).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "IRS-001 belgesini seç" })).toBeChecked();
  await expect(page.getByRole("row").filter({ hasText: "SP-TASLAK" }).getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Seçimi temizle" }).click();
  await expect(ilkBelge).not.toBeChecked();
  await expect(page.getByRole("button", { name: /Seçilenleri Faturala/ })).toHaveCount(0);
  await tumunuSec.check();
  await page.getByRole("button", { name: "🧾 Seçilenleri Faturala (2)" }).click();
  await expect(page.getByText("2 belge tek taslak faturada birleştirildi.")).toBeVisible();
  expect(gonderilen).toEqual({ belgeIds: ["b1", "b2"] });
  await expect(page.getByRole("link", { name: "Taslak faturayı aç" })).toHaveAttribute("href", "/panel/fatura?faturaId=f1");
});

test("uyumsuz belgelerin birlikte faturalanması seçimde engellenir", async ({ page }) => {
  const belge = (id: string, no: string, cariId: string, kur = "1.0000") => ({
    id, no, tur: "siparis", durum: "onaylandi", yon: "satis", tarih: "2026-08-07", genelToplam: "1200.00",
    dovizCinsi: "USD", kur, depoId: "d1", faturaId: null, cari: { id: cariId, kod: cariId, unvan: `Cari ${cariId}` },
  });
  await page.route("**/api/v1/belgeler", (route) => route.fulfill({ json: {
    kayitlar: [belge("b1", "SP-001", "c1", "32.0000"), belge("b2", "SP-002", "c1", "33.0000")], sonrakiImlec: null,
  } }));

  await page.goto("/panel/belgeler");
  const tumunuSec = page.getByRole("checkbox", { name: "Faturalanabilir belgelerin tümünü seç" });
  const ilkBelge = page.getByRole("checkbox", { name: "SP-001 belgesini seç" });
  const uyumsuzBelge = page.getByRole("checkbox", { name: "SP-002 belgesini seç" });
  await expect(tumunuSec).toBeDisabled();
  await expect(tumunuSec).toHaveAttribute("title", /filtre/i);
  await ilkBelge.check();
  await expect(uyumsuzBelge).toBeDisabled();
  await expect(uyumsuzBelge).toHaveAttribute("title", /aynı cari, döviz, kur, yön ve depoda/i);
  await expect(page.getByRole("button", { name: /Seçilenleri Faturala \(1\)/ })).toBeVisible();
});

test("toplu fatura oluşturulurken yinelenen gönderim engellenir", async ({ page }) => {
  const belge = {
    id: "b1", no: "SP-001", tur: "siparis", durum: "onaylandi", yon: "satis", tarih: "2026-08-07",
    genelToplam: "1200.00", dovizCinsi: "TRY", faturaId: null,
    cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
  };
  let istekSayisi = 0;
  let yanitla!: () => void;
  const beklet = new Promise<void>((resolve) => { yanitla = resolve; });
  await page.route("**/api/v1/belgeler", (route) => route.fulfill({ json: { kayitlar: [belge], sonrakiImlec: null } }));
  await page.route("**/api/v1/belgeler/toplu-fatura", async (route) => {
    istekSayisi += 1;
    await beklet;
    await route.fulfill({ json: { faturaId: "f1" } });
  });

  await page.goto("/panel/belgeler");
  await page.getByRole("checkbox", { name: "SP-001 belgesini seç" }).check();
  await page.getByRole("button", { name: /Seçilenleri Faturala/ }).click();
  const beklemeButonu = page.getByRole("button", { name: "Fatura oluşturuluyor…" });
  await expect(beklemeButonu).toBeDisabled();
  await beklemeButonu.click({ force: true });
  expect(istekSayisi).toBe(1);
  yanitla();
  await expect(page.getByText("1 belge tek taslak faturada birleştirildi.")).toBeVisible();
});

test("toplu fatura yarışı sonrası belge listesi yenilenir", async ({ page }) => {
  const belge = (durum: string) => ({
    id: "b1", no: "SP-001", tur: "siparis", durum, yon: "satis", tarih: "2026-08-07",
    genelToplam: "1200.00", dovizCinsi: "TRY", kur: "1.0000", depoId: "d1", faturaId: durum === "kapandi" ? "f1" : null,
    cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
  });
  let listeIstegi = 0;
  await page.route("**/api/v1/belgeler", (route) => {
    listeIstegi += 1;
    return route.fulfill({ json: { kayitlar: [belge(listeIstegi === 1 ? "onaylandi" : "kapandi")], sonrakiImlec: null } });
  });
  await page.route("**/api/v1/belgeler/toplu-fatura", (route) => route.fulfill({
    status: 409, json: { message: "Belge başka bir işlemde faturalanmış" },
  }));

  await page.goto("/panel/belgeler");
  await page.getByRole("checkbox", { name: "SP-001 belgesini seç" }).check();
  await page.getByRole("button", { name: /Seçilenleri Faturala/ }).click();
  await expect(page.getByText("Belge başka bir işlemde faturalanmış")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SP-001" }).getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Seçilenleri Faturala/ })).toHaveCount(0);
  expect(listeIstegi).toBe(2);
});

test("belge sayfası URL filtreleriyle tek sorguda açılır", async ({ page }) => {
  const istekler: URL[] = [];
  await page.route("**/api/v1/belgeler**", (route) => {
    istekler.push(new URL(route.request().url()));
    return route.fulfill({ json: { kayitlar: [{
      id: "b1", no: "SP-ALIS", tur: "siparis", durum: "onaylandi", yon: "alis", tarih: "2026-08-07",
      genelToplam: "1200.00", dovizCinsi: "TRY", kur: "1.0000", depoId: "d1", faturaId: null,
      cari: { id: "c1", kod: "C001", unvan: "Örnek Tedarikçi" },
    }], sonrakiImlec: null } });
  });

  await page.goto("/panel/belgeler?tur=siparis&yon=alis&durum=onaylandi&baslangic=2026-08-01&bitis=2026-08-10");
  await expect(page.getByRole("row").filter({ hasText: "SP-ALIS" })).toBeVisible();
  await expect.poll(() => istekler.length).toBe(1);
  const parametreler = istekler[0].searchParams;
  expect(Object.fromEntries(parametreler)).toEqual({
    tur: "siparis", yon: "alis", durum: "onaylandi", baslangic: "2026-08-01", bitis: "2026-08-10",
  });
});

test("belge filtresi değiştiğinde gizli toplu seçimler temizlenir", async ({ page }) => {
  const belge = (id: string, no: string, yon: string) => ({
    id, no, tur: "siparis", durum: "onaylandi", yon, tarih: "2026-08-07", genelToplam: "1200.00",
    dovizCinsi: "TRY", faturaId: null, cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
  });
  const listeIstekleri: string[] = [];
  await page.route("**/api/v1/belgeler**", (route) => {
    const url = new URL(route.request().url());
    listeIstekleri.push(url.toString());
    const kayitlar = url.searchParams.get("yon") === "alis"
      ? [belge("b2", "SP-ALIS", "alis")]
      : [belge("b1", "SP-SATIS", "satis"), belge("b2", "SP-ALIS", "alis")];
    return route.fulfill({ json: { kayitlar, sonrakiImlec: null } });
  });

  await page.goto("/panel/belgeler");
  await page.getByRole("checkbox", { name: "SP-SATIS belgesini seç" }).check();
  await expect(page.getByRole("button", { name: /Seçilenleri Faturala \(1\)/ })).toBeVisible();
  await page.getByLabel("Yön", { exact: true }).selectOption("alis");
  await page.getByLabel("Belge durumu", { exact: true }).selectOption("onaylandi");
  await expect(page.getByRole("button", { name: /Seçilenleri Faturala/ })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "SP-ALIS belgesini seç" })).not.toBeChecked();
  await expect.poll(() => listeIstekleri.at(-1)).toContain("yon=alis");
  expect(new URL(listeIstekleri.at(-1)!).searchParams.get("durum")).toBe("onaylandi");
});

test("başarısız belge listesi yeniden yüklenebilir", async ({ page }) => {
  let istekSayisi = 0;
  await page.route("**/api/v1/belgeler**", (route) => {
    istekSayisi += 1;
    if (istekSayisi === 1) return route.fulfill({ status: 500, json: { message: "Geçici servis hatası" } });
    return route.fulfill({ json: { kayitlar: [{
      id: "b1", no: "SP-001", tarih: "2026-08-07", tur: "siparis", yon: "satis", durum: "onaylandi",
      genelToplam: "1200.00", dovizCinsi: "TRY", faturaId: null, cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
    }], sonrakiImlec: null } });
  });

  await page.goto("/panel/belgeler");
  await expect(page.getByText("Belge listesi yüklenemedi.")).toBeVisible();
  await expect(page.getByText("Kayıtlı belge bulunmuyor.")).not.toBeVisible();
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByRole("row").filter({ hasText: "SP-001" })).toBeVisible();
  await expect(page.getByText("Belge listesi yüklenemedi.")).not.toBeVisible();
  expect(istekSayisi).toBe(2);
});

test("belge listesi yükleniyor ve filtrelenmiş boş durumlarını ayırır", async ({ page }) => {
  let yanitla!: () => void;
  const beklet = new Promise<void>((resolve) => { yanitla = resolve; });
  await page.route("**/api/v1/belgeler**", async (route) => {
    await beklet;
    await route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
  });

  await page.goto("/panel/belgeler");
  await expect(page.getByRole("status")).toHaveText("Belgeler yükleniyor…");
  await expect(page.getByText("Kayıtlı belge bulunmuyor.")).not.toBeVisible();
  yanitla();
  await expect(page.getByText("Kayıtlı belge bulunmuyor.")).toBeVisible();

  await page.getByPlaceholder("Belge no veya cari ile ara...").fill("bulunmayan");
  await expect(page.getByText("Filtrelere uygun belge bulunamadı.")).toBeVisible();
});

test("belgeler başlangıç ve bitiş tarihine göre filtrelenir", async ({ page }) => {
  const belge = (id: string, no: string, tarih: string) => ({
    id, no, tarih, tur: "siparis", yon: "satis", durum: "onaylandi", genelToplam: "1200.00",
    dovizCinsi: "TRY", faturaId: null, cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
  });
  const tumu = [belge("b1", "SP-001", "2026-07-31"), belge("b2", "SP-002", "2026-08-05"), belge("b3", "SP-003", "2026-08-12")];
  let sonParametreler = new URLSearchParams();
  await page.route("**/api/v1/belgeler**", (route) => {
    sonParametreler = new URL(route.request().url()).searchParams;
    const baslangic = sonParametreler.get("baslangic"); const bitis = sonParametreler.get("bitis");
    const kayitlar = tumu.filter((kayit) => (!baslangic || kayit.tarih >= baslangic) && (!bitis || kayit.tarih <= bitis));
    return route.fulfill({ json: { kayitlar, sonrakiImlec: null } });
  });

  await page.goto("/panel/belgeler");
  await page.getByLabel("Başlangıç tarihi").fill("2026-08-01");
  await page.getByLabel("Bitiş tarihi").fill("2026-08-10");
  await expect(page.getByRole("row").filter({ hasText: "SP-002" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SP-001" })).not.toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SP-003" })).not.toBeVisible();
  expect(sonParametreler.get("baslangic")).toBe("2026-08-01");
  expect(sonParametreler.get("bitis")).toBe("2026-08-10");
  await expect(page).toHaveURL(/baslangic=2026-08-01/);
  await expect(page).toHaveURL(/bitis=2026-08-10/);

  await page.getByRole("button", { name: "Görünümü kaydet" }).click();
  await page.getByLabel("Görünüm adı").fill("Ağustos ilk hafta");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await page.getByRole("button", { name: "Filtreleri temizle" }).click();
  await expect(page.getByRole("row").filter({ hasText: "SP-001" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SP-003" })).toBeVisible();

  await page.getByRole("combobox", { name: "Kaydedilmiş görünüm" }).selectOption({ label: "Ağustos ilk hafta" });
  await expect(page.getByLabel("Başlangıç tarihi")).toHaveValue("2026-08-01");
  await expect(page.getByLabel("Bitiş tarihi")).toHaveValue("2026-08-10");
  await expect(page.getByRole("row").filter({ hasText: "SP-002" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SP-003" })).not.toBeVisible();
});

test("geç dönen eski belge araması güncel sonucu ezmez", async ({ page }) => {
  const belge = (id: string, no: string, unvan: string) => ({
    id, no, tur: "siparis", yon: "satis", durum: "onaylandi", tarih: "2026-08-07", genelToplam: "1200.00",
    dovizCinsi: "TRY", faturaId: null, cari: { id: "c1", kod: "C001", unvan },
  });
  let yavasYanitla!: () => void; let yavasBasladi!: () => void; let yavasTamamlandi!: () => void;
  const yavasBekleme = new Promise<void>((resolve) => { yavasYanitla = resolve; });
  const yavasIstek = new Promise<void>((resolve) => { yavasBasladi = resolve; });
  const yavasBitti = new Promise<void>((resolve) => { yavasTamamlandi = resolve; });
  await page.route("**/api/v1/belgeler**", async (route) => {
    const arama = new URL(route.request().url()).searchParams.get("arama");
    if (arama === "Yavaş Cari") {
      yavasBasladi(); await yavasBekleme;
      await route.fulfill({ json: { kayitlar: [belge("b1", "SP-YAVAS", "Yavaş Cari")], sonrakiImlec: null } });
      yavasTamamlandi(); return;
    }
    if (arama === "Hızlı Cari") return route.fulfill({ json: { kayitlar: [belge("b2", "SP-HIZLI", "Hızlı Cari")], sonrakiImlec: null } });
    return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
  });

  await page.goto("/panel/belgeler");
  const arama = page.getByPlaceholder("Belge no veya cari ile ara...");
  await arama.fill("Yavaş Cari"); await yavasIstek;
  await arama.fill("Hızlı Cari");
  await expect(page.getByRole("row").filter({ hasText: "SP-HIZLI" })).toBeVisible();
  yavasYanitla(); await yavasBitti;
  await expect(page.getByRole("row").filter({ hasText: "SP-HIZLI" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SP-YAVAS" })).not.toBeVisible();
});

test("belge araması yüklenmemiş kayıtlarda sunucuda çalışır", async ({ page }) => {
  let aramaParametresi: string | null = null;
  await page.route("**/api/v1/belgeler**", (route) => {
    const arama = new URL(route.request().url()).searchParams.get("arama");
    aramaParametresi = arama;
    if (arama === "Uzak Cari") return route.fulfill({ json: { kayitlar: [{
      id: "b99", no: "SP-099", tur: "siparis", yon: "satis", durum: "onaylandi", tarih: "2026-08-07",
      genelToplam: "1200.00", dovizCinsi: "TRY", faturaId: null,
      cari: { id: "c99", kod: "C099", unvan: "Uzak Cari" },
    }], sonrakiImlec: null } });
    return route.fulfill({ json: { kayitlar: [], sonrakiImlec: null } });
  });

  await page.goto("/panel/belgeler");
  await page.getByPlaceholder("Belge no veya cari ile ara...").fill("Uzak Cari");
  await expect(page.getByRole("row").filter({ hasText: "SP-099" })).toBeVisible();
  expect(aramaParametresi).toBe("Uzak Cari");
});

test("belge listesinin sonraki sayfası mevcut kayıtlara eklenir", async ({ page }) => {
  const belge = (id: string, no: string) => ({
    id, no, tur: "siparis", yon: "satis", durum: "onaylandi", tarih: "2026-08-07",
    genelToplam: "1200.00", dovizCinsi: "TRY", faturaId: null, cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri" },
  });
  let ikinciSayfaIstendi = false;
  await page.route("**/api/v1/belgeler**", (route) => {
    const imlec = new URL(route.request().url()).searchParams.get("imlec");
    if (imlec === "sonraki-1") {
      ikinciSayfaIstendi = true;
      return route.fulfill({ json: { kayitlar: [belge("b2", "SP-002")], sonrakiImlec: null } });
    }
    return route.fulfill({ json: { kayitlar: [belge("b1", "SP-001")], sonrakiImlec: "sonraki-1" } });
  });

  await page.goto("/panel/belgeler");
  await expect(page.getByRole("row").filter({ hasText: "SP-001" })).toBeVisible();
  await page.getByRole("button", { name: "Daha fazla yükle" }).click();
  await expect(page.getByRole("row").filter({ hasText: "SP-002" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SP-001" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Daha fazla yükle" })).not.toBeVisible();
  expect(ikinciSayfaIstendi).toBe(true);
});

test("filtrelenmiş belgeler UTF-8 CSV olarak dışa aktarılır", async ({ page }) => {
  const belge = (id: string, no: string, unvan: string) => ({
    id, no, tur: "siparis", yon: "satis", durum: "onaylandi", tarih: "2026-08-07",
    genelToplam: "1200.00", dovizCinsi: "TRY", faturaId: null, cari: { id: "c1", kod: "C001", unvan },
  });
  await page.route("**/api/v1/belgeler", (route) => route.fulfill({ json: { kayitlar: [
    belge("b1", "SP-001", "Alfa Müşteri"), belge("b2", "SP-002", "Beta Müşteri"),
  ] } }));

  await page.goto("/panel/belgeler");
  await page.getByPlaceholder("Belge no veya cari ile ara...").fill("Alfa");
  const indirmeSozu = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV dışa aktar" }).click();
  const indirme = await indirmeSozu;
  expect(indirme.suggestedFilename()).toBe("belgeler.csv");
  const akis = await indirme.createReadStream();
  let icerik = "";
  for await (const parca of akis) icerik += parca.toString("utf8");
  expect(icerik).toContain("Belge No");
  expect(icerik).toContain("SP-001");
  expect(icerik).toContain("Alfa Müşteri");
  expect(icerik).not.toContain("SP-002");
});

test("belge zinciri bağlantısı ilgili faturayı doğrudan odaklar", async ({ page }) => {
  const fatura = (id: string, no: string, unvan: string) => ({
    id, no, tip: "satis", tarih: "2026-08-07", durum: "kesin", toplamMatrah: "1000.00",
    toplamKdv: "200.00", genelToplam: "1200.00", cari: { unvan }, ebelge: null,
    odemeOzeti: { durum: "odenmedi", odenen: "0", kalan: "1200" },
  });
  const odak = fatura("f1", "SAT-001", "Zincir Müşterisi");
  await page.route("**/api/v1/fatura", (route) => route.fulfill({ json: { kayitlar: [
    odak, fatura("f2", "SAT-002", "Diğer Müşteri"),
  ] } }));
  await page.route("**/api/v1/fatura/f1", (route) => route.fulfill({ json: {
    ...odak, dovizCinsi: "TRY", cari: { id: "c1", kod: "C001", unvan: "Zincir Müşterisi" }, satirlar: [],
    odemeOzeti: { durum: "odenmedi", odenen: "0", kalan: "1200", hareketler: [] },
  } }));

  await page.goto("/panel/fatura?faturaId=f1&panel=odeme");
  await expect(page.getByText("Belge zincirinden açılan fatura")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Ödeme durumu" })).toContainText("Kalan");
  await expect(page.getByText("SAT-001 · Zincir Müşterisi").first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SAT-001" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SAT-002" })).not.toBeVisible();

  await page.getByRole("dialog", { name: "Ödeme durumu" }).getByRole("button", { name: "Kapat" }).last().click();
  await page.getByRole("button", { name: "Tüm faturaları göster" }).click();
  await expect(page).toHaveURL("http://localhost:3100/panel/fatura");
  await expect(page.getByRole("row").filter({ hasText: "SAT-002" })).toBeVisible();
});

test("teklif, sipariş, irsaliye ve fatura zinciri bulunup gezilebilir", async ({ page }) => {
  const ortak = { yon: "satis", durum: "onaylandi", tarih: "2026-08-07", genelToplam: "1200.00", dovizCinsi: "TRY",
    cari: { id: "c1", kod: "C001", unvan: "Örnek Müşteri AŞ" }, gecerlilikTarihi: null, aciklama: null, notlar: null, satirlar: [] };
  await page.route("**/api/v1/belgeler", (route) => route.fulfill({ json: { kayitlar: [{
    ...ortak, id: "b2", tur: "siparis", no: "SP-001", faturaId: "f1",
  }] } }));
  await page.route("**/api/v1/belgeler/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    if (id === "b1") return route.fulfill({ json: {
      ...ortak, id: "b1", tur: "teklif", no: "TK-001", faturaId: "f1", kaynakBelge: null,
      turetilenler: [{ id: "b2", tur: "siparis", no: "SP-001", durum: "onaylandi" }],
      zincirBelgeleri: [
        { id: "b1", tur: "teklif", no: "TK-001", durum: "onaylandi" },
        { id: "b2", tur: "siparis", no: "SP-001", durum: "onaylandi" },
        { id: "b3", tur: "irsaliye", no: "IRS-001", durum: "onaylandi" },
      ],
      fatura: { id: "f1", no: "SAT-001", durum: "kesin", ebelge: { tur: "efatura", durum: "hata" }, odemeOzeti: { durum: "kismi", odenen: "400.00", kalan: "800.00" } },
    } });
    return route.fulfill({ json: {
      ...ortak, id: "b2", tur: "siparis", no: "SP-001", faturaId: "f1",
      kaynakBelge: { id: "b1", tur: "teklif", no: "TK-001", durum: "onaylandi" },
      turetilenler: [{ id: "b3", tur: "irsaliye", no: "IRS-001", durum: "onaylandi" }],
      zincirBelgeleri: [
        { id: "b1", tur: "teklif", no: "TK-001", durum: "onaylandi" },
        { id: "b2", tur: "siparis", no: "SP-001", durum: "onaylandi" },
        { id: "b3", tur: "irsaliye", no: "IRS-001", durum: "onaylandi" },
      ],
      fatura: { id: "f1", no: "SAT-001", durum: "kesin", ebelge: { tur: "efatura", durum: "kabul" }, odemeOzeti: { durum: "kismi", odenen: "400.00", kalan: "800.00" } },
    } });
  });

  await page.goto("/panel/belgeler");
  await page.getByRole("row").filter({ hasText: "SP-001" }).getByRole("button", { name: "Belge detayını aç" }).click();
  const zincir = page.getByLabel("Belge yaşam döngüsü");
  await expect(zincir).toContainText("TK-001");
  await expect(zincir.getByRole("button", { name: /Sipariş Mevcut/ })).toBeDisabled();
  await expect(zincir).toContainText("IRS-001");
  await expect(zincir).toContainText("SAT-001");
  await expect(zincir.getByRole("link", { name: /Fatura SAT-001/ })).toHaveAttribute("href", "/panel/fatura?faturaId=f1");
  const ebelgeAdimi = zincir.getByRole("link", { name: /e-Belge Kabul edildi/ });
  await expect(ebelgeAdimi).toHaveAttribute("href", "/panel/fatura?faturaId=f1&panel=ebelge");
  await expect(ebelgeAdimi).toHaveClass(/is-complete/);
  const odemeAdimi = zincir.getByRole("link", { name: /Tahsilat\/Ödeme Kısmi ödendi/ });
  await expect(odemeAdimi).toHaveAttribute("href", "/panel/fatura?faturaId=f1&panel=odeme");
  await expect(odemeAdimi).toHaveClass(/is-current/);

  await zincir.getByRole("button", { name: /Teklif TK-001/ }).click();
  await expect(page.getByRole("heading", { level: 3, name: /Teklif TK-001/ })).toBeVisible();
  await expect(zincir.getByRole("button", { name: /Teklif Mevcut/ })).toBeDisabled();
  await expect(zincir.getByRole("button", { name: /İrsaliye IRS-001/ })).toBeEnabled();
  await expect(zincir.getByRole("link", { name: /e-Belge Hata/ })).toHaveClass(/is-error/);
});

test("senaryo özeti kaydetmeden önce gönderilecek belgeyi gösterir", async ({ page }) => {
  await page.route("**/api/v1/cari**", (route) => {
    const { pathname } = new URL(route.request().url());
    return route.fulfill({ json: pathname.endsWith("/cari/c1")
      ? { id: "c1", kod: "C001", unvan: "Test Müşteri", efaturaProfili: "ticari", bakiyeler: [], risk: { mevcutRisk: "0", limit: null, kalanLimit: null, asim: false } }
      : { kayitlar: [{ id: "c1", kod: "C001", unvan: "Test Müşteri" }], sonrakiImlec: null }
    });
  });
  await page.goto("/panel/fatura?yon=satis&yeni=1");

  const ozet = page.locator(".scenario-summary");
  await expect(ozet).toContainText("Satış · SATIS");

  // Profil cari kartındaki varsayılandan gelir ama fatura üzerinde değiştirilebilir (FTR-19).
  await page.getByRole("combobox", { name: "Müşteri ara" }).click();
  await page.getByRole("option", { name: /Test Müşteri/ }).click();
  const profil = page.getByLabel("e-Fatura Profili");
  await expect(profil).toHaveValue("ticari");
  await expect(ozet).toContainText("TICARIFATURA");
  await profil.selectOption("temel");
  await expect(ozet).toContainText("TEMELFATURA");
  await profil.selectOption("ticari");

  // KDV sıfırlanınca istisna kodu zorunludur (FTR-17).
  await page.getByLabel("Birim fiyat").fill("1000");
  await page.getByLabel("KDV yüzdesi").fill("0");
  await expect(ozet.getByRole("alert")).toContainText("Satır 1: KDV oranı sıfır olan satırda GİB istisna kodu seçilmelidir");

  await page.getByRole("button", { name: "Satır ayrıntıları" }).click();
  await page.getByLabel("GİB istisna kodu").selectOption("351");
  await expect(ozet.getByRole("alert")).toHaveCount(0);
  await expect(ozet).toContainText("İstisna · ISTISNA");

  // Tevkifat oranı koddan gelir; özetteki tutar tevkifat sonrasıdır (FTR-18, FTR-20).
  await page.getByLabel("GİB istisna kodu").selectOption("");
  await page.getByLabel("KDV yüzdesi").fill("20");
  await page.getByLabel("GİB tevkifat kodu").selectOption("607");
  await expect(ozet).toContainText("Tevkifat · TEVKIFAT");
  await expect(ozet).toContainText("Tevkifat sonrası tahsil edilecek");
  await expect(ozet).toContainText("1.020,00 TL");
});
