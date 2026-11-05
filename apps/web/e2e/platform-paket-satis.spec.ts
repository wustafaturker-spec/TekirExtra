import { expect, test, type Page } from "@playwright/test";
import { PAKET_MODUL_KODLARI } from "@tekirextra/shared";
import type { PaketSurumu } from "../src/lib/platform-paketler";

const id = "00000000-0000-4000-8000-000000000801", surumId = "00000000-0000-4000-8000-000000000802";
const surum: PaketSurumu = { id: surumId, paketId: id, surumNo: 2, kilitSurumu: 3, durum: "yayinlandi", ad: "Satış paketi", aciklama: "Yeni satış sözleşmesi", ozellikler: ["Özellik"], siralama: 1,
  createdAt: "2026-11-01T00:00:00Z", yayinlandiAt: "2026-11-02T00:00:00Z", arsivlendiAt: null,
  fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: [{ aySayisi: 1, matrah: "100.00" }] },
  kapsamSozlesmesi: { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: { kullanici: { sinir: 5, uyariYuzdesi: 80 }, cari: { sinir: 100, uyariYuzdesi: 80 }, stok: { sinir: null, uyariYuzdesi: 80 }, aylikFatura: { sinir: 100, uyariYuzdesi: 80 } } },
};
async function kur(page: Page, cakisma = false, acik = false) {
  let rev = 1;
  const yazmalar: Record<string, unknown>[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const url = new URL(r.request().url()), yol = url.pathname;
    if (yol.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "admin@invalid.test", rol: "yonetici" } });
    if (yol.endsWith("/satis")) {
      if (r.request().method() === "POST") {
        const g = r.request().postDataJSON(); yazmalar.push(g);
        if (cakisma) { rev++; return r.fulfill({ status: 409, json: { message: "Satış durumu değişti. Kaydı yenileyip yeniden onaylayın." } }); }
        acik = g.acik; rev++; return r.fulfill({ json: { tekrar: false, kilitSurumu: rev } });
      }
      const sayfa = Number(url.searchParams.get("sayfa") ?? 1);
      return r.fulfill({ json: { acik, kilitSurumu: rev, surum: acik || rev > 1 ? surum : null, toplam: rev > 1 ? 1 : 0, sayfa, sayfaBoyutu: 25,
        kayitlar: rev > 1 && sayfa === 1 ? [{ id: "gecmis", kilitSurumu: rev, neden: "Yeni satış seçimi", createdAt: "2026-11-04T08:00:00Z", kullanici: { adSoyad: "Satış yöneticisi" }, onceki: { acik: false, surumId: null }, yeni: { acik, surumId, surumNo: 2, ad: surum.ad } }] : [], satisEntegrasyonu: false } });
    }
    return r.fulfill({ json: { paket: { id, kod: "satis_paketi", eskiPlanKodu: null, createdAt: surum.createdAt }, surumler: [surum, { ...surum, id: "taslak", surumNo: 3, durum: "taslak" }], toplam: 2, sayfa: 1, sayfaBoyutu: 25, taslakVar: true, mevcutKosullar: null, satisEntegrasyonu: false } });
  });
  await page.goto(`/platform/paketler/${id}`, { waitUntil: "domcontentloaded", timeout: 150000 });
  await expect(page.getByText("Katalog satış durumu", { exact: true })).toBeVisible({ timeout: 30000 });
  return yazmalar;
}
async function hazirla(page: Page) {
  await page.getByLabel("Satışa seçilecek sürüm").selectOption(surumId);
  await page.getByLabel("Satış değişikliği gerekçesi").fill("Yeni satış seçimi");
  await page.getByRole("button", { name: "Satış seçimini incele", exact: true }).click();
}
test("satış seçimi ayrı önizleme/onay ister; vazgeçmek istek göndermez", async ({ page }) => {
  test.setTimeout(180000); const yazmalar = await kur(page);
  await expect(page.getByText(/yeni firma kaydındaki paket listesini belirler/)).toBeVisible();
  await expect(page.getByLabel("Satışa seçilecek sürüm").getByRole("option")).toHaveCount(2);
  await hazirla(page);
  const onay = page.getByRole("region", { name: "Satış değişikliği onayı" });
  await expect(onay).toContainText("100,00"); await expect(onay).toContainText("Aktif kullanıcı");
  expect(yazmalar).toHaveLength(0);
  await page.getByRole("button", { name: "Satış onayından vazgeç" }).click(); expect(yazmalar).toHaveLength(0);
  await page.getByRole("button", { name: "Satış seçimini incele", exact: true }).click();
  await page.getByRole("button", { name: "Satış değişikliğini onayla" }).click();
  await expect(page.getByText("Katalog satış seçimi kaydedildi.", { exact: true })).toBeVisible();
  expect(yazmalar).toEqual([{ acik: true, surumId, surumKilitSurumu: 3, kilitSurumu: 1, neden: "Yeni satış seçimi" }]);
  await expect(page.getByRole("region", { name: "Satış değişikliği geçmişi" })).toContainText("Satış yöneticisi");
});
test("satışı durdurma hedef göndermez ve ayrı gerekçeli onay ister", async ({ page }) => {
  test.setTimeout(180000); const yazmalar = await kur(page, false, true);
  await expect(page.getByRole("button", { name: "Satışı durdurmayı incele" })).toBeDisabled();
  await page.getByLabel("Satış değişikliği gerekçesi").fill("Yeni satışları durdur");
  await page.getByRole("button", { name: "Satışı durdurmayı incele" }).click(); expect(yazmalar).toHaveLength(0);
  await page.getByRole("button", { name: "Satış değişikliğini onayla" }).click();
  await expect(page.getByText("Katalog satışı durduruldu.", { exact: true })).toBeVisible();
  expect(yazmalar[0]).toMatchObject({ acik: false, surumId: null, surumKilitSurumu: null });
});
test("çakışmada onay kapanır; gerekçe korunur ve yeni revizyonla tekrar incelenir", async ({ page }) => {
  test.setTimeout(180000); const yazmalar = await kur(page, true); await hazirla(page);
  await page.getByRole("button", { name: "Satış değişikliğini onayla" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Satış durumu değişti" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Satış değişikliği onayı" })).toHaveCount(0);
  await expect(page.getByLabel("Satış değişikliği gerekçesi")).toHaveValue("Yeni satış seçimi");
  await page.getByRole("button", { name: "Satış seçimini incele", exact: true }).click();
  await page.getByRole("button", { name: "Satış değişikliğini onayla" }).click();
  await expect.poll(() => yazmalar.length).toBe(2); expect(yazmalar[1].kilitSurumu).toBe(2);
});
test("satış geçmişinin boş sayfası toplamı ve diğer URL parametrelerini korur", async ({ page }) => {
  test.setTimeout(180000); await kur(page); await hazirla(page);
  await page.getByRole("button", { name: "Satış değişikliğini onayla" }).click();
  await expect(page.getByText("Katalog satış seçimi kaydedildi.", { exact: true })).toBeVisible();
  await page.goto(`/platform/paketler/${id}?satisSayfa=99&donus=%2Fplatform%2Fpaketler%3Farama%3Dsatis`);
  const gecmis = page.getByRole("region", { name: "Satış değişikliği geçmişi" });
  await expect(gecmis).toContainText("1 satış değişikliği · Sayfa 99 / 1");
  await page.getByRole("button", { name: "Satış geçmişinin ilk sayfasına dön" }).click();
  await expect(page).not.toHaveURL(/satisSayfa/); await expect(page).toHaveURL(/donus=/);
  await expect(gecmis).toContainText("Yeni satış seçimi");
});
