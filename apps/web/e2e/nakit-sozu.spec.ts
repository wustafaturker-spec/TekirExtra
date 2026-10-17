import { expect, test, type Page } from "@playwright/test";

const sonuc = { donemler: [], toplamGiris: 1600, toplamCikis: 0, sonBakiye: 1600, ilkEksi: null, enDusuk: { tarih: "2026-10-16", bakiye: 0 }, kaydirilanTahsilat: { adet: 0, tutar: 0 } };
const kalem = { kaynak: "fatura", kaynakId: "fatura-1", yon: "giris", vade: "2026-10-20", tutar: 600, dovizCinsi: "TRY", dovizTutar: 600, aciklama: "Satış faturası TEST-01 · ödeme sözü payı", cariUnvan: "Söz müşterisi", tahmin: false, baglanti: "/panel/fatura?fatura=fatura-1", tarihler: { iyimser: { tarih: "2026-10-20", neden: null }, baz: { tarih: "2026-10-20", neden: null }, kotumser: { tarih: null, neden: "Vadesi 90 günden fazla geçmiş" } }, odemeSozu: { id: "soz-1", tarih: "2026-10-20", faturaVadesi: "2026-01-01" } };
async function kur(page: Page, sozlu = true) {
  page.on("pageerror", (e) => { throw e; });
  page.on("console", (m) => { if (m.type() === "error") throw new Error(m.text()); });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async (r) => {
    const yol = new URL(r.request().url()).pathname.replace("/api/v1", "");
    expect(r.request().method()).toBe("GET");
    let json: unknown = [];
    if (yol === "/auth/ben") json = { rol: "muhasebe", userId: "u", tenantId: "t" };
    else if (yol === "/bildirimler/ozet") json = { okunmamis: 0, acik: 0, kritik: 0 };
    else if (yol === "/bildirimler") json = { kayitlar: [] };
    else if (yol === "/ebelge/uygulamalar") json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    else if (yol === "/nakit-akisi") json = {
      bugun: "2026-10-16", ufukGun: 30, ufukSonu: "2026-11-14", donemTipi: "gun", baslangicBakiye: 0, hesapSayisi: 0, kur: null,
      senaryolar: { iyimser: sonuc, baz: sonuc, kotumser: { ...sonuc, toplamGiris: 1000, sonBakiye: 1000 } },
      kalemler: sozlu ? [kalem, { ...kalem, tutar: 1000, dovizTutar: 1000, aciklama: "Satış faturası TEST-01", odemeSozu: undefined }] : [{ ...kalem, tutar: 1600, odemeSozu: undefined }],
      kapsamDisi: [], kapsamNotlari: ["Ödeme sözü ek alacak yaratmaz; tahsilat garantisi değildir."], uyarilar: [],
    };
    await r.fulfill({ json });
  });
  await page.goto("/panel/nakit-akisi");
}
test("söz payı ve kalan fatura aynı gün olsa da iki satır, söz ve mali vade ayrı görünür", async ({ page }) => {
  await kur(page);
  await expect(page.getByText("Ödeme sözü payı", { exact: true })).toBeVisible();
  const satir = page.getByRole("row").filter({ hasText: "ödeme sözü payı" });
  await expect(satir).toHaveCount(1);
  await expect(satir).toContainText("20.10.2026");
  await expect(satir).toContainText("01.01.2026");
  await expect(satir.getByRole("link")).toHaveAttribute("href", "/panel/fatura?fatura=fatura-1");
  await expect(page.getByRole("row").filter({ hasText: "TEST-01" })).toHaveCount(2);
});
test("kötümser senaryoda ufuk dışı kalan söz payı gizlenir", async ({ page }) => {
  await kur(page); await expect(page.getByText("Ödeme sözü payı", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kötümser", exact: true }).click();
  await expect(page.getByText("Ödeme sözü payı", { exact: true })).toHaveCount(0);
});
test("söz bilgisi olmayan eski yanıt çalışır", async ({ page }) => {
  await kur(page, false);
  await expect(page.getByRole("row").filter({ hasText: "TEST-01" })).toHaveCount(1);
  await expect(page.getByText("Ödeme sözü payı", { exact: true })).toHaveCount(0);
});
