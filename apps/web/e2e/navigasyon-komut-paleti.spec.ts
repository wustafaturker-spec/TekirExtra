import { expect, test, type Page } from "@playwright/test";
import { metinNormalize } from "@tekirextra/shared";

/**
 * Yeni bilgi mimarisinin iki iddiasını doğrular:
 *
 *  1. Yan menü artık 55 bağlantıyı düz listelemiyor; sekiz çalışma alanı var ve
 *     ikinci seviye yalnız açık alan için görünüyor.
 *  2. Komut paleti (⌘K) hem sayfaları hem kayıtları buluyor, klavyeyle
 *     gezilebiliyor ve Türkçe küçültme kurallarına takılmıyor.
 */

const ALANLAR = ["Özet", "Satış", "Satın Alma", "Belgeler & e-Belge", "Finans", "Stok & Üretim", "Cari & Personel", "Raporlar"];

const CARILER = [{ id: "cari-1", kod: "CR-00124", unvan: "Şişli Makina Sanayi Ltd. Şti." }];
const STOKLAR = [{ id: "stok-1", kod: "PRD-0042", ad: "Şişli Vidalı Bağlantı", anaBirim: "adet" }];
const FATURALAR = [{ id: "fatura-1", no: "SF2026000123", tip: "satis", genelToplam: "12000.00", cari: { unvan: "Şişli Makina Sanayi Ltd. Şti." } }];

/**
 * Kayıt aramasını sunucu yapar. ARA-01'den beri sorgu, veritabanının ürettiği
 * `arama_normal` kolonunda aranır: terim de kolon da küçültülüp aksanları
 * katlanarak karşılaştırılır, yani "sisli" araması "Şişli Makina"yı bulur.
 * Sunucu terimi `metinNormalize` ile katladığı için sahte uç da aynı işlevi
 * kullanır — kural iki yerde ayrı ayrı yazılmaz.
 *
 * Sahte uç bu davranışı taklit etmezse test, aramanın çalıştığını değil sahte
 * uçun her sorguya kayıt döndürdüğünü doğrular.
 */
const sunucuKatlamasi = metinNormalize;

function sunucudaSuz<T>(kayitlar: T[], arama: string, alanlar: (kayit: T) => (string | null)[]): T[] {
  if (!arama) return [];
  const aranan = sunucuKatlamasi(arama);
  return kayitlar.filter((kayit) => alanlar(kayit).some((alan) => sunucuKatlamasi(alan ?? "").includes(aranan)));
}

async function apiMockla(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("tekir_access", "e2e-token");
  });
  await page.route("http://localhost:3001/api/v1/**", async (route) => {
    const { pathname, searchParams } = new URL(route.request().url());
    const arama = searchParams.get("arama") ?? "";

    if (pathname.endsWith("/auth/ben")) {
      await route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
      return;
    }
    if (pathname.endsWith("/firma")) {
      await route.fulfill({ json: { unvan: "Deneme Ticaret A.Ş." } });
      return;
    }
    if (pathname.endsWith("/cari")) {
      await route.fulfill({ json: { kayitlar: sunucudaSuz(CARILER, arama, (k) => [k.unvan, k.kod]), sonrakiImlec: null } });
      return;
    }
    if (pathname.endsWith("/stok")) {
      await route.fulfill({ json: { kayitlar: sunucudaSuz(STOKLAR, arama, (k) => [k.ad, k.kod]), sonrakiImlec: null } });
      return;
    }
    if (pathname.endsWith("/fatura")) {
      await route.fulfill({ json: { kayitlar: sunucudaSuz(FATURALAR, arama, (k) => [k.no, k.cari.unvan]), sonrakiImlec: null } });
      return;
    }
    if (pathname.endsWith("/donem-kapatma")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (pathname.endsWith("/fatura/is-kuyrugu-ozeti")) {
      await route.fulfill({ json: { taslakSatis: 0, taslakAlis: 0, ebelgeHata: 0, acikTahsilat: 0, acikOdeme: 0 } });
      return;
    }
    if (pathname.endsWith("/duzeltmeler/ozet")) {
      await route.fulfill({ json: { kritik: 0, slaAsan: 0 } });
      return;
    }
    if (pathname.includes("/kasa-banka/") || pathname.endsWith("/ebelge/gelen")) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test.describe("Çalışma alanı navigasyonu", () => {
  test.beforeEach(async ({ page }) => {
    await apiMockla(page);
    // Sınanan şey yan menü ve palet, yani panel yerleşimi. Gösterge panelinin
    // veri şekline bağlanmamak için hafif bir panel sayfası açılır.
    await page.goto("/panel/donem-kapatma");
    await expect(page.locator("#ana-menu").getByRole("button", { name: "Özet", exact: true })).toBeVisible();
  });

  test("sekiz çalışma alanı gösterir, ikinci seviyeyi yalnız açık alanda açar", async ({ page }) => {
    const yanMenu = page.locator("#ana-menu");
    for (const alan of ALANLAR) {
      await expect(yanMenu.getByRole("button", { name: alan, exact: true })).toBeVisible();
    }

    // Dönem Kapatma "Özet" alanındadır; yalnız o alan genişlemiş olmalı.
    await expect(yanMenu.getByRole("button", { name: "Özet", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(yanMenu.getByRole("link", { name: "Dönem Kapatma" })).toBeVisible();
    await expect(yanMenu.getByRole("link", { name: "Kasa & Banka" })).toHaveCount(0);

    // Başka bir alan açılınca öncekinin maddeleri kapanır (akordiyon).
    await yanMenu.getByRole("button", { name: "Finans", exact: true }).click();
    await expect(yanMenu.getByRole("link", { name: "Kasa & Banka" })).toBeVisible();
    await expect(yanMenu.getByRole("link", { name: "Dönem Kapatma" })).toHaveCount(0);
  });

  test("ayarlar ana navigasyondan çıkarılmış, alt bölümde toplanmıştır", async ({ page }) => {
    const yanMenu = page.locator("#ana-menu");
    await expect(yanMenu.getByRole("link", { name: "Kullanıcılar" })).toHaveCount(0);
    await yanMenu.getByRole("button", { name: "Ayarlar", exact: true }).click();
    await expect(yanMenu.getByRole("link", { name: "Kullanıcılar" })).toBeVisible();
    await expect(yanMenu.getByRole("link", { name: "Denetim İzi" })).toBeVisible();
  });
});

test.describe("Komut paleti", () => {
  test.beforeEach(async ({ page }) => {
    await apiMockla(page);
    // Sınanan şey yan menü ve palet, yani panel yerleşimi. Gösterge panelinin
    // veri şekline bağlanmamak için hafif bir panel sayfası açılır.
    await page.goto("/panel/donem-kapatma");
    await expect(page.locator("#ana-menu").getByRole("button", { name: "Özet", exact: true })).toBeVisible();
  });

  test("Ctrl+K ile açılır, Escape ile kapanır", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palet = page.getByRole("dialog", { name: "Komut paleti" });
    await expect(palet).toBeVisible();
    await expect(palet.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palet).toBeHidden();
  });

  test("Türkçe küçültme kuralına takılmadan sayfa bulur", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palet = page.getByRole("dialog", { name: "Komut paleti" });
    // "İ" ile başlayan sorgu, toLowerCase() kullanılsaydı eşleşmezdi.
    await palet.getByRole("combobox").fill("İZİN");
    await expect(palet.getByRole("option", { name: /Personel/ })).toBeVisible();
  });

  test("eşanlamlı sözcükle sayfaya götürür", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palet = page.getByRole("dialog", { name: "Komut paleti" });
    // Kullanıcı "tahsilat" der, sayfanın adı "Kasa & Banka"dır.
    await palet.getByRole("combobox").fill("tahsilat");
    await expect(palet.getByRole("option", { name: /Kasa & Banka/ })).toBeVisible();
    await page.keyboard.press("Enter");
    // Dev sunucusu hedef rotayı ilk gezinmede derler; URL o ana dek değişmez.
    await expect(page).toHaveURL(/\/panel\/kasa-banka$/, { timeout: 30_000 });
  });

  test("cari, stok ve fatura kayıtlarını birlikte arar", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palet = page.getByRole("dialog", { name: "Komut paleti" });
    await palet.getByRole("combobox").fill("şişli");

    await expect(palet.getByText("Cari hesaplar")).toBeVisible();
    await expect(palet.getByRole("option", { name: /^Şişli Makina Sanayi Ltd\. Şti\./ })).toBeVisible();
    await expect(palet.getByText("Stok kartları")).toBeVisible();
    await expect(palet.getByRole("option", { name: /^Şişli Vidalı Bağlantı/ })).toBeVisible();
    await expect(palet.getByText("Faturalar")).toBeVisible();
    // Tutar ortak biçimlendirmeden geçer.
    await expect(palet.getByRole("option", { name: /^SF2026000123.*₺12\.000,00/ })).toBeVisible();
  });

  test("kayıt aramasında aksan katlanır (ARA-01)", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palet = page.getByRole("dialog", { name: "Komut paleti" });
    // Klavyesinde Türkçe harf olmayan ya da acele eden kullanıcı "sisli" yazar;
    // kayıt sunucuda aksansız `arama_normal` kolonunda arandığı için bulunur.
    await palet.getByRole("combobox").fill("sisli");
    await expect(palet.getByText("Aranıyor…")).toHaveCount(0, { timeout: 10_000 });
    await expect(palet.getByRole("option", { name: /^Şişli Makina Sanayi Ltd\. Şti\./ })).toBeVisible();

    // Büyük/küçük harf farkı da katlanır — Türkçe "İ" ve "I" dahil.
    await palet.getByRole("combobox").fill("ŞİŞLİ MAKINA");
    await expect(palet.getByRole("option", { name: /^Şişli Makina Sanayi Ltd\. Şti\./ })).toBeVisible();
  });

  test("ok tuşlarıyla gezilip Enter ile kayda gidilir", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const palet = page.getByRole("dialog", { name: "Komut paleti" });
    await palet.getByRole("combobox").fill("şişli");
    const cariSecenegi = palet.getByRole("option", { name: /^Şişli Makina Sanayi Ltd\. Şti\./ });
    const stokSecenegi = palet.getByRole("option", { name: /^Şişli Vidalı Bağlantı/ });
    await expect(cariSecenegi).toBeVisible();

    // "şişli" hiçbir sayfa adıyla eşleşmez; ilk sonuç doğrudan cari kaydıdır.
    await expect(cariSecenegi).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(stokSecenegi).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(cariSecenegi).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/panel\/cari\/cari-1$/, { timeout: 30_000 });
  });
});
