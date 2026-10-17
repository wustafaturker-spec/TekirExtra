import { expect, test, type Page } from "@playwright/test";
const itirazli = "11111111-1111-4111-8111-111111111111", temiz = "22222222-2222-4222-8222-222222222222";
async function kur(page: Page) {
  const yazilar: any[] = [];
  page.on("pageerror", (e) => { throw e; });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async (r) => {
    const yol = new URL(r.request().url()).pathname.replace("/api/v1", "");
    if (r.request().method() !== "GET") {
      expect(yol).toBe("/cari/vade-hatirlatma/gonder");
      const g = r.request().postDataJSON(); yazilar.push(g); expect(g.cariIdler).toEqual([temiz]);
      await r.fulfill({ json: [{ cariId: temiz, kod: "C2", unvan: "Seçilebilir müşteri", durum: "hata", mesaj: "Carinin açık tahsilat itirazı var; gönderim durduruldu" }] }); return;
    }
    let json: unknown = [];
    if (yol === "/auth/ben") json = { rol: "muhasebe", userId: temiz, tenantId: itirazli };
    else if (yol === "/cari/vade-hatirlatma/adaylar") json = [itirazli, temiz].map((cariId, i) => ({ cariId, kod: `C${i+1}`, unvan: i ? "Seçilebilir müşteri" : "İtirazlı müşteri", eposta: "test@example.invalid", karaListe: false, aktif: true, faturaSayisi: 1, dovizler: [], toplamTry: "1000.00", enEskiVade: "2026-10-01", enUzunGecikme: 15, sonHatirlatma: null, siklikEngeli: false, itirazEngeli: i === 0, gonderimEngeli: i === 0 ? "Açık itiraz sonuçlanmalı" : null }));
    else if (yol === "/bildirimler/ozet") json = { okunmamis: 0, acik: 0, kritik: 0 };
    else if (yol === "/bildirimler") json = { kayitlar: [] };
    else if (yol === "/ebelge/uygulamalar") json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    await r.fulfill({ json });
  });
  await page.goto("/panel/cari/vade-hatirlatma");
  return yazilar;
}
test("itirazlı cari seçilemez ve önizlenemez; sıklık aşımı bunu değiştirmez", async ({ page }) => {
  const yazilar = await kur(page);
  await expect(page.getByLabel("İtirazlı müşteri seç", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("İtirazlı müşteri seç", { exact: true })).not.toBeChecked();
  await expect(page.getByRole("row").filter({ hasText: "İtirazlı müşteri" }).getByRole("button", { name: "Önizle" })).toBeDisabled();
  await page.getByLabel("Son 7 günde hatırlatma almış carilere de gönder").check();
  await expect(page.getByLabel("İtirazlı müşteri seç", { exact: true })).toBeDisabled();
  expect(yazilar).toHaveLength(0);
});
test("kullanıcı onayından sonra değişen itirazın sunucu hatası görünür", async ({ page }) => {
  const yazilar = await kur(page);
  await expect(page.getByLabel("Seçilebilir müşteri seç", { exact: true })).toBeChecked();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Hatırlatmayı gönder", exact: true }).click();
  await expect(page.getByText(/Carinin açık tahsilat itirazı var; gönderim durduruldu/)).toBeVisible();
  expect(yazilar).toHaveLength(1);
});
