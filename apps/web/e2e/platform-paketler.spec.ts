import { expect, test, type Page } from "@playwright/test";
import type { PaketFiyatlandirmasi, PaketSurumu } from "../src/lib/platform-paketler";

const id = "00000000-0000-4000-8000-000000000701", ilkId = "00000000-0000-4000-8000-000000000702", yeniId = "00000000-0000-4000-8000-000000000703";
const ilk: PaketSurumu = { id: ilkId, paketId: id, surumNo: 1, kilitSurumu: 1, durum: "yayinlandi", ad: "Profesyonel", aciklama: "Mevcut paket tanımı", ozellikler: ["Gelişmiş raporlar"], siralama: 20, createdAt: "2026-11-01T10:00:00Z", yayinlandiAt: "2026-11-01T10:00:00Z", arsivlendiAt: null };
async function kur(page: Page, editor = false, cakisma = false) {
  let surumler: PaketSurumu[] = [{ ...ilk }];
  const yazmalar: { yol: string; method: string; g: Record<string, unknown> }[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const url = new URL(r.request().url()), yol = url.pathname, method = r.request().method();
    if (yol.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "test@example.invalid", rol: editor ? "mevzuat_editoru" : "yonetici" } });
    if (method !== "GET") {
      const g = r.request().postDataJSON() as Record<string, unknown>; yazmalar.push({ yol, method, g });
      if (method === "POST" && yol.endsWith("/paketler")) {
        surumler = [{ ...ilk, id: yeniId, surumNo: 1, kilitSurumu: 1, durum: "taslak", ad: String(g.ad), aciklama: String(g.aciklama), ozellikler: g.ozellikler as string[], siralama: Number(g.siralama), fiyatlandirma: g.fiyatlandirma as PaketFiyatlandirmasi | null, kapsamSozlesmesi: g.kapsamSozlesmesi as PaketSurumu["kapsamSozlesmesi"], yayinlandiAt: null }];
        return r.fulfill({ json: { id, surum: surumler[0] } });
      }
      if (yol.endsWith("/taslak")) {
        const kaynak = surumler.find((s) => s.id === g.kaynakSurumId)!;
        const d: PaketSurumu = { ...kaynak, id: `00000000-0000-4000-8000-${String(surumler.length + 702).padStart(12, "0")}`, surumNo: kaynak.surumNo + 1, kilitSurumu: 1, durum: "taslak", yayinlandiAt: null, arsivlendiAt: null };
        surumler.unshift(d); return r.fulfill({ json: d });
      }
      const surumId = yol.split("/surumler/")[1]?.split("/")[0], s = surumler.find((s) => s.id === surumId)!;
      if (method === "PATCH") {
        if (cakisma) return r.fulfill({ status: 409, json: { message: "Sürüm başka biri tarafından değiştirildi. Taslağınızı koruyup güncel kaydı inceleyin." } });
        expect(Object.keys(g).sort()).toEqual(["aciklama", "ad", "denemeGunSayisi", "fiyatlandirma", "kapsamSozlesmesi", "kilitSurumu", "ozellikler", "siralama"]);
        Object.assign(s, g, { kilitSurumu: s.kilitSurumu + 1 }); return r.fulfill({ json: s });
      }
      if (yol.endsWith("/yayinla")) Object.assign(s, { durum: "yayinlandi", yayinlandiAt: "2026-11-03T10:00:00Z", kilitSurumu: s.kilitSurumu + 1 });
      if (yol.endsWith("/arsivle")) Object.assign(s, { durum: "arsiv", arsivlendiAt: "2026-11-03T12:00:00Z", kilitSurumu: s.kilitSurumu + 1 });
      return r.fulfill({ json: s });
    }
    if (yol.endsWith("/paketler")) {
      const arama = url.searchParams.get("arama") ?? "", sayfa = Number(url.searchParams.get("sayfa") ?? 1), s = surumler[0];
      return r.fulfill({ json: { kayitlar: arama === "yok" || sayfa > 1 ? [] : [{ id, kod: "profesyonel", eskiPlanKodu: "profesyonel", sonSurum: s }], toplam: arama === "yok" ? 0 : 1, sayfa, sayfaBoyutu: 25, satisEntegrasyonu: false } });
    }
    if (yol.endsWith(`/paketler/${id}`)) {
      const sayfa = Number(url.searchParams.get("sayfa") ?? 1);
      return r.fulfill({ json: { paket: { id, kod: "profesyonel", eskiPlanKodu: "profesyonel", createdAt: ilk.createdAt }, surumler: sayfa > 1 ? [] : surumler, toplam: surumler.length, sayfa, sayfaBoyutu: 25, taslakVar: surumler.some((s) => s.durum === "taslak"), satisEntegrasyonu: false,
        mevcutKosullar: { planKodu: "profesyonel", aylikFiyat: 999, paraBirimi: "TRY", kdvOrani: 20, limitler: { kullanici: 10, cari: 2500, stok: 5000, aylikFatura: 1000 } } } });
    }
    return r.fulfill({ json: [] });
  });
  return yazmalar;
}

test("paket araması ve boş sayfada toplam korunur; detaydan filtreli listeye dönülür", async ({ page }) => {
  test.setTimeout(90000);
  await kur(page);
  // Next dev'in soğuk detay derlemesini gezinme beklentisinden önce tamamla.
  await page.request.get(`/platform/paketler/${id}`);
  await page.goto("/platform/paketler?arama=profesyonel&sayfa=2");
  await expect(page.getByRole("heading", { name: "Paket kataloğu", exact: true })).toBeVisible();
  await expect(page.getByText("1 paket · Sayfa 2 / 1")).toBeVisible();
  await page.getByRole("button", { name: "İlk sayfaya dön" }).click();
  await page.getByRole("link", { name: "Profesyonel", exact: true }).click();
  await expect(page.getByRole("heading", { name: /profesyonel · Paket sürümleri/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("link", { name: "Paket listesine dön" })).toHaveAttribute("href", /arama=profesyonel/);
  await page.getByRole("link", { name: "Paket listesine dön" }).click();
  await expect(page.getByLabel("Kod veya son sürüm adı")).toHaveValue("profesyonel");
  await page.getByLabel("Kod veya son sürüm adı").fill("yok"); await page.getByRole("button", { name: "Ara", exact: true }).click();
  await expect(page.getByText("Bu kapsamda paket yok")).toBeVisible(); await page.reload(); await expect(page.getByLabel("Kod veya son sürüm adı")).toHaveValue("yok");
});

test("taslak kopyalama, düzenleme, yayın önizlemesi ve arşiv ayrı işlemlerdir", async ({ page }) => {
  const yazmalar = await kur(page); await page.goto(`/platform/paketler/${id}`);
  await expect(page.getByRole("button", { name: "Taslağı düzenle" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).click();
  await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await page.getByLabel("Paket adı", { exact: true }).fill("Profesyonel yeni tanım");
  await page.getByLabel("Paket özellikleri").fill("Raporlama\nYeni açıklayıcı özellik");
  await page.getByLabel("Yeni firma deneme süresi (gün)").fill("14");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText("Paket kataloğu kaydedildi.")).toBeVisible();
  expect(yazmalar.find((r) => r.method === "PATCH")?.g.denemeGunSayisi).toBe(14);
  await page.getByRole("button", { name: "Katalogda yayınla" }).click();
  await expect(page.getByText("Katalog yayınını onayla", { exact: true })).toBeVisible();
  await expect(page.getByText(/Mevcut abonelikler ve tahsilatlar etkilenmez/)).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click(); expect(yazmalar.filter((r) => r.yol.endsWith("/yayinla"))).toHaveLength(0);
  await page.getByRole("button", { name: "Katalogda yayınla" }).click(); await page.getByRole("button", { name: "Yayını onayla" }).click();
  await expect(page.getByRole("button", { name: "Taslağı düzenle" })).toHaveCount(0);
  expect(yazmalar.find((r) => r.yol.endsWith("/yayinla"))?.g).toEqual({ kilitSurumu: 2 });
  await page.getByRole("button", { name: "Sürümü arşivle" }).first().click(); await page.getByRole("button", { name: "Arşivlemeyi onayla" }).click();
  await expect(page.getByRole("region", { name: "Paket sürüm geçmişi" }).getByText("Arşiv", { exact: true })).toBeVisible();
  expect(yazmalar.every((r) => r.yol.includes("/paketler/"))).toBe(true);
});

test("çakışan kayıtta yazılan taslak alanları korunur", async ({ page }) => {
  await kur(page, false, true); await page.goto(`/platform/paketler/${id}`);
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).click(); await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await page.getByLabel("Paket adı", { exact: true }).fill("Kaybolmaması gereken metin"); await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Sürüm başka biri");
  await expect(page.getByLabel("Paket adı", { exact: true })).toHaveValue("Kaybolmaması gereken metin");
  await page.getByRole("button", { name: "Kaydı yenile" }).click();
  await expect(page.getByLabel("Paket adı", { exact: true })).toHaveValue("Kaybolmaması gereken metin");
});

test("yeni paket yalnız taslak oluşturur; yayın veya satış isteği göndermez", async ({ page }) => {
  const yazmalar = await kur(page); await page.goto("/platform/paketler");
  await page.getByRole("button", { name: "Yeni paket", exact: true }).click();
  await page.getByLabel("Paket kodu", { exact: true }).fill("yeni_paket"); await page.getByLabel("Paket adı", { exact: true }).fill("Yeni paket");
  await page.getByLabel("Paket özellikleri").fill("Özellik"); await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page).toHaveURL(new RegExp(`/platform/paketler/${id}`));
  expect(yazmalar).toHaveLength(1); expect(yazmalar[0].g).toMatchObject({ kod: "yeni_paket", ad: "Yeni paket", ozellikler: ["Özellik"] });
});

test("sürüm sayfalaması ve mobil/klavye akışı çalışır; dış dönüş adresi reddedilir", async ({ page }) => {
  await kur(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/platform/paketler/${id}?sayfa=99&donus=https://ornek.invalid`);
  await expect(page.getByText("1 sürüm · Sayfa 99 / 1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Paket listesine dön" })).toHaveAttribute("href", "/platform/paketler");
  await page.getByRole("button", { name: "İlk sayfaya dön" }).click();
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Taslağı düzenle" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("editör menüden ve doğrudan detaydan kataloğa erişemez", async ({ page }) => {
  await kur(page, true); await page.goto(`/platform/paketler/${id}`);
  await expect(page).toHaveURL(/\/platform$/, { timeout: 20000 }); await expect(page.getByRole("link", { name: "Paket kataloğu" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Paket sürümleri/ })).toHaveCount(0);
});

test("dönem fiyatı ve tarih taslakta korunur, yayın önizlemesinde görünür ve kopyalanır", async ({ page }) => {
  const yazmalar = await kur(page); await page.goto(`/platform/paketler/${id}`);
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).click();
  await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await page.getByLabel("Bu sürüm için fiyat tanımla").check();
  await page.getByLabel("Fiyat geçerlilik tarihi", { exact: true }).fill("2026-12-01");
  await page.getByLabel("12 aylık dönem bedeli (TRY, KDV hariç)", { exact: true }).fill("9990,00");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText("Paket kataloğu kaydedildi.")).toBeVisible();
  expect(yazmalar.find((r) => r.method === "PATCH")?.g.fiyatlandirma).toEqual({
    paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", gecerlilikTarihi: "2026-12-01", donemler: [{ aySayisi: 12, matrah: "9990.00" }],
  });
  await page.getByRole("button", { name: "Katalogda yayınla" }).click();
  const onay = page.locator(".card").filter({ has: page.getByText("Katalog yayınını onayla", { exact: true }) });
  await expect(onay.getByText("9990,00 TRY", { exact: true })).toBeVisible();
  await expect(onay.getByText(/01.12.2026/)).toBeVisible();
  await page.getByRole("button", { name: "Yayını onayla" }).click();
  await expect(page.getByRole("button", { name: "Katalogda yayınla" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).first().click();
  await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await expect(page.getByLabel("12 aylık dönem bedeli (TRY, KDV hariç)", { exact: true })).toHaveValue("9990.00");
  await expect(page.getByLabel("Fiyat geçerlilik tarihi", { exact: true })).toHaveValue("2026-12-01");
  await page.getByLabel("Bu sürüm için fiyat tanımla").uncheck();
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText("Paket kataloğu kaydedildi.")).toBeVisible();
  expect(yazmalar.filter((r) => r.method === "PATCH").at(-1)?.g.fiyatlandirma).toBeNull();
});

test("fiyat alanları çakışmada ve yenilemede kaybolmaz", async ({ page }) => {
  await kur(page, false, true); await page.goto(`/platform/paketler/${id}`);
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).click();
  await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await page.getByLabel("Bu sürüm için fiyat tanımla").check();
  await page.getByLabel("Fiyat geçerlilik tarihi", { exact: true }).fill("2026-12-01");
  const bedel = page.getByLabel("1 aylık dönem bedeli (TRY, KDV hariç)", { exact: true });
  await bedel.fill("100,05");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Sürüm başka biri");
  await page.getByRole("button", { name: "Kaydı yenile" }).click();
  await expect(bedel).toHaveValue("100,05");
  await expect(page.getByLabel("Fiyat geçerlilik tarihi", { exact: true })).toHaveValue("2026-12-01");
});

test("abonelik geçişinde dönem ve limit karşılaştırması, bilinmeyen plan ve boş sayfa çalışır", async ({ page }) => {
  test.setTimeout(150000);
  const yazmalar = await kur(page);
  await page.route("**/api/v1/platform/paketler/gecis-durumu?*", (r) => {
    const sayfa = Number(new URL(r.request().url()).searchParams.get("sayfa") ?? 1);
    const fiyat = (toplam: string) => ({ matrah: "399.00", kdv: "79.80", toplam });
    return r.fulfill({ json: { toplam: 2, bagli: 1, bilinmeyenPlan: 1, sayfa, sayfaBoyutu: 25, kayitlar: sayfa > 1 ? [] : [
      { tenantId: "00000000-0000-4000-8000-000000000901", unvan: "Bilinmeyen firma", planKodu: "ozel_eski", paketSurumId: null, durum: "bilinmeyen_plan", kaynak: null, kosullarEsit: null, oncekiLimitler: null, sonrakiLimitler: null, donemler: [] },
      { tenantId: "00000000-0000-4000-8000-000000000902", unvan: "Bağlı firma", planKodu: "baslangic", paketSurumId: ilkId, durum: "bagli", kaynak: "eski_plan_gecisi", kosullarEsit: true, oncekiLimitler: { kullanici: 3, cari: 250, stok: 500, aylikFatura: 100 }, sonrakiLimitler: { kullanici: 3, cari: 250, stok: 500, aylikFatura: 100 }, donemler: [{ aySayisi: 1, once: fiyat("478.80"), sonra: fiyat("478.80"), esit: true }, { aySayisi: 12, once: fiyat("5745.60"), sonra: fiyat("5745.60"), esit: true }] },
    ] } });
  });
  await page.request.get("/platform/paketler/gecis");
  await page.goto("/platform/paketler/gecis?ay=12", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Abonelik katalog geçişi", exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("2 abonelik · 1 sürüme bağlı · 1 bilinmeyen plan")).toBeVisible();
  const bagli = page.getByRole("row").filter({ hasText: "Bağlı firma" });
  await expect(bagli).toContainText("5745,60 TRY");
  await bagli.getByText("Limitleri karşılaştır", { exact: true }).click();
  await expect(bagli.getByRole("cell", { name: "250", exact: true })).toHaveCount(2);
  await page.getByLabel("Karşılaştırılacak dönem").selectOption("1");
  await expect(bagli).toContainText("478,80 TRY");
  await expect(page.getByRole("row").filter({ hasText: "Bilinmeyen firma" })).toContainText("İnceleme bekliyor");
  await page.goto("/platform/paketler/gecis?sayfa=99&ay=12");
  await expect(page.getByText("2 abonelik · Sayfa 99 / 1")).toBeVisible();
  await page.getByRole("button", { name: "İlk sayfaya dön" }).click();
  await expect(page.getByLabel("Karşılaştırılacak dönem")).toHaveValue("12");
  expect(yazmalar).toHaveLength(0);
});

test("editör abonelik geçiş raporuna doğrudan erişemez", async ({ page }) => {
  await kur(page, true); await page.goto("/platform/paketler/gecis");
  await expect(page).toHaveURL(/\/platform$/, { timeout: 20000 });
  await expect(page.getByRole("heading", { name: "Abonelik katalog geçişi", exact: true })).toHaveCount(0);
});

test("modül ve kota sözleşmesi kaydedilir, yayın önizlemesinde görünür ve yeni taslağa kopyalanır", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page); await page.goto(`/platform/paketler/${id}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).click();
  await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await page.getByRole("checkbox", { name: "Bu sürüme modül ve kota sözleşmesi ekle" }).check();
  await page.getByLabel("Aktif stok kartı sınırı", { exact: true }).fill("1000");
  await page.getByLabel("Aktif stok kartı uyarı eşiği (%)", { exact: true }).fill("55");
  await page.getByRole("checkbox", { name: "Aktif cari · Sınırsız", exact: true }).check();
  await page.getByLabel("Aylık oluşturulan fatura sınırı", { exact: true }).fill("200");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText("Paket kataloğu kaydedildi.", { exact: true })).toBeVisible();
  const son = yazmalar.findLast((r) => r.method === "PATCH")!.g.kapsamSozlesmesi as { kotalar: Record<string, { sinir: number | null; uyariYuzdesi: number }> };
  expect(son.kotalar).toMatchObject({ kullanici: { sinir: 0 }, cari: { sinir: null }, stok: { sinir: 1000, uyariYuzdesi: 55 }, aylikFatura: { sinir: 200 } });
  await page.getByRole("button", { name: "Katalogda yayınla" }).click();
  await expect(page.getByText("Katalog yayınını onayla", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Aktif stok kartı" }).last()).toContainText("%55");
  await page.getByRole("button", { name: "Yayını onayla" }).click();
  await expect(page.getByRole("button", { name: "Taslağı düzenle" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).first().click();
  await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await expect(page.getByLabel("Aktif stok kartı sınırı", { exact: true })).toHaveValue("1000");
  await expect(page.getByRole("checkbox", { name: "Aktif cari · Sınırsız", exact: true })).toBeChecked();
});

test("modül bağımlılığı hatasında istek gönderilmez; kapsamı kaldırma açık null gönderir", async ({ page }) => {
  test.setTimeout(180000);
  const yazmalar = await kur(page); await page.goto(`/platform/paketler/${id}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).click(); await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await page.getByRole("checkbox", { name: "Bu sürüme modül ve kota sözleşmesi ekle" }).check();
  await page.getByRole("checkbox", { name: "Cari", exact: true }).uncheck();
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Fatura için Cari seçilmeli");
  expect(yazmalar.filter((r) => r.method === "PATCH")).toHaveLength(0);
  await page.getByRole("checkbox", { name: "Bu sürüme modül ve kota sözleşmesi ekle" }).uncheck();
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText("Paket kataloğu kaydedildi.", { exact: true })).toBeVisible();
  expect(yazmalar.findLast((r) => r.method === "PATCH")!.g.kapsamSozlesmesi).toBeNull();
});

test("kota alanları çakışmada ve kayıt yenilemesinde korunur", async ({ page }) => {
  test.setTimeout(180000);
  await kur(page, false, true); await page.goto(`/platform/paketler/${id}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await page.getByRole("button", { name: "Bu sürümden taslak aç" }).click(); await page.getByRole("button", { name: "Taslağı düzenle" }).click();
  await page.getByRole("checkbox", { name: "Bu sürüme modül ve kota sözleşmesi ekle" }).check();
  await page.getByLabel("Aktif kullanıcı sınırı", { exact: true }).fill("13");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("başka biri");
  await page.getByRole("button", { name: "Kaydı yenile" }).click();
  await expect(page.getByLabel("Aktif kullanıcı sınırı", { exact: true })).toHaveValue("13");
});
