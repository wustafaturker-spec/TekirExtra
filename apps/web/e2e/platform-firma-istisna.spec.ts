import { expect, test, type Page } from "@playwright/test";
import { PAKET_MODUL_KODLARI } from "@tekirextra/shared";

const tenantId = "00000000-0000-4000-8000-000000000901", paketSurumId = "00000000-0000-4000-8000-000000000902", id = "00000000-0000-4000-8000-000000000903";
const kosullar = { planAdi: "Kabul paketi", limitler: { kullanici: 5, cari: 100, stok: 200, aylikFatura: 50 }, fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", donemler: [{ aySayisi: 1, matrah: "399.00" }] }, kapsamSozlesmesi: { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: { kullanici: { sinir: 5, uyariYuzdesi: 80 }, cari: { sinir: 100, uyariYuzdesi: 80 }, stok: { sinir: 200, uyariYuzdesi: 80 }, aylikFatura: { sinir: 50, uyariYuzdesi: 80 } } } };
async function kur(page: Page, cakisma = false) {
  const yazmalar: { yol: string; veri: unknown }[] = [];
  let onay = false, iptal = false;
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const yol = new URL(r.request().url()).pathname;
    if (yol.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "admin@invalid.test", rol: "yonetici" } });
    if (yol.endsWith("/ek-hacmi")) return r.fulfill({ json: { tenantId, olcumAt: "2026-11-04T00:00:00Z", dosyaAdedi: "0", bayt: "0", kotaUygulaniyor: false, dagilim: [] } });
    if (yol.includes("/firma-istisnalari/")) {
      if (r.request().method() === "POST") {
        const veri = r.request().postData() ? r.request().postDataJSON() : null; yazmalar.push({ yol, veri });
        if (yol.endsWith("/onayla")) { if (cakisma) return r.fulfill({ status: 409, json: { message: "Kaynak abonelik değişti." } }); onay = true; }
        if (yol.endsWith("/iptal")) iptal = true;
        return r.fulfill({ json: { id, tekrar: false } });
      }
      if (yol.endsWith("/kaynak")) return r.fulfill({ json: { paketSurumId, kosullar } });
      return r.fulfill({ json: { toplam: 1, kayitlar: [{ id, baslangic: "2026-01-01T00:00:00Z", bitis: "2099-01-01T00:00:00Z", onay_at: onay ? "2026-11-04T00:00:00Z" : null, iptal_at: iptal ? "2026-11-04T00:00:00Z" : null, iptal_nedeni: iptal ? "Anlaşma sona erdi" : null, veri: { neden: "Geçici özel fiyat", fiyatlandirma: kosullar.fiyatlandirma }, kaynak_kosullar: kosullar, hedef_kosullar: { ...kosullar, fiyatlandirma: { ...kosullar.fiyatlandirma, donemler: [{ aySayisi: 1, matrah: "299.00" }] } } }] } });
    }
    if (yol.endsWith("/firmalar/sayfali")) return r.fulfill({ json: { kayitlar: [{ tenantId, unvan: "İstisna ekranı kabul", vkn: "1234567890", planKodu: "baslangic", planAdi: "Kabul paketi", durum: "aktif", aktifKullanici: 1, kayitTarihi: "2026-01-01", donemSonu: "2026-12-01", sonGiris: null, bekleyenTalep: null }], toplam: 1 } });
    if (yol.endsWith("/takip")) return r.fulfill({ json: { durum: "acik", surum: 0, sorumluId: null } });
    if (yol.endsWith("/takip-sorumlulari")) return r.fulfill({ json: [] });
    if (yol.endsWith("/gecmis")) return r.fulfill({ json: { degisiklikler: [], talepler: [], odemeler: [] } });
    return r.fulfill({ json: { kayitlar: [], toplam: 0, sayilar: {} } });
  });
  await page.goto(`/platform/firmalar/${tenantId}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await expect(page.getByText("Firmaya özel koşul taslakları", { exact: true })).toBeVisible({ timeout: 30000 });
  return yazmalar;
}

test("istisna onayı ayrı adım ister; vazgeçme yazmaz, onay ve iptal doğru uçlara gider", async ({ page }) => {
  test.setTimeout(180000); const yazmalar = await kur(page);
  await page.getByRole("button", { name: "Özel koşul onayını aç" }).click();
  await expect(page.getByRole("region", { name: "Özel koşul onayı" })).toContainText("Başlamış ödemeler");
  expect(yazmalar).toHaveLength(0);
  await page.getByRole("region", { name: "Özel koşul onayı" }).getByRole("button", { name: "Vazgeç" }).click();
  expect(yazmalar).toHaveLength(0);
  await page.getByRole("button", { name: "Özel koşul onayını aç" }).click();
  await page.getByRole("button", { name: "Özel koşulları onayla", exact: true }).click();
  await expect(page.getByText(/Özel koşullar onaylandı/)).toBeVisible();
  expect(yazmalar[0].yol).toBe(`/api/v1/platform/firma-istisnalari/${tenantId}/${id}/onayla`);
  await page.getByRole("button", { name: "Özel koşulları iptal et", exact: true }).click();
  await page.getByLabel("İptal gerekçesi").fill("Anlaşma sona erdi");
  await page.getByRole("button", { name: "İptali onayla" }).click();
  await expect(page.getByText(/Özel koşullar iptal edildi/)).toBeVisible();
  expect(yazmalar[1]).toEqual({ yol: `/api/v1/platform/firma-istisnalari/${tenantId}/${id}/iptal`, veri: { neden: "Anlaşma sona erdi" } });
});

test("taslak formu fiyat, sınırsız kota ve kaynak sürümünü doğru gönderir", async ({ page }) => {
  test.setTimeout(180000); const yazmalar = await kur(page);
  await page.getByLabel("Başlangıç (bu cihazın yerel saati)", { exact: true }).fill("2030-01-01T10:00");
  await page.getByLabel("Bitiş (bu cihazın yerel saati)", { exact: true }).fill("2030-02-01T10:00");
  await page.getByLabel("Özel dönem fiyatı hazırla").check();
  await page.getByLabel("1 ay · TRY, KDV hariç", { exact: true }).fill("299.00");
  await page.getByLabel("Özel modül ve kullanım kotaları hazırla").check();
  await page.getByLabel("Aktif cari", { exact: true }).fill("");
  await page.getByLabel("Depolama sınırı tanımla", { exact: true }).check();
  await page.getByLabel("Depolama sınırı (bayt)", { exact: true }).fill("10485760");
  await page.getByLabel("Depolama uyarı eşiği (%)", { exact: true }).fill("90");
  await page.getByLabel("Gerekçe", { exact: true }).fill("Dönemsel ek kota anlaşması");
  await page.getByRole("button", { name: "Koşulları taslak olarak kaydet" }).click();
  await expect(page.getByText(/Özel koşullar taslak olarak kaydedildi/)).toBeVisible();
  expect(yazmalar[0].veri).toMatchObject({ tenantId, paketSurumId, fiyatlandirma: { donemler: [{ aySayisi: 1, matrah: "299.00" }] }, kapsamSozlesmesi: { moduller: [...PAKET_MODUL_KODLARI], depolama: { sinirBayt: "10485760", uyariYuzdesi: 90 }, kotalar: { cari: { sinir: null, uyariYuzdesi: 80 } } } });
});

test("kaynak çakışması eski onayı kapatır ve kaydedilmemiş formu korur", async ({ page }) => {
  test.setTimeout(180000); const yazmalar = await kur(page, true);
  await page.getByLabel("Gerekçe", { exact: true }).fill("Kaydedilmemiş yeni anlaşma");
  await page.getByRole("button", { name: "Özel koşul onayını aç" }).click();
  await page.getByRole("button", { name: "Özel koşulları onayla", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Kaynak abonelik değişti" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Özel koşul onayı" })).toHaveCount(0);
  await expect(page.getByLabel("Gerekçe", { exact: true })).toHaveValue("Kaydedilmemiş yeni anlaşma");
  expect(yazmalar).toHaveLength(1);
});
