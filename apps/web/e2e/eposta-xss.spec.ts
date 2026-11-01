import { expect, test } from "@playwright/test";

/**
 * SEC-01: sunucu temizlemeden gelmiş (eski kayıt ya da atlatma) zararlı e-posta
 * HTML'i bile panelde betik çalıştırmaz; bağlantılar opener'sız yeni sekmede açılır.
 */
const zararli = [
  `<p>Fiyat teklifi</p>`,
  `<img src="x" onerror="window.__xss = 'img'">`,
  `<script>window.__xss = 'script'</script>`,
  `<svg><script>window.__xss = 'svg'</script></svg>`,
  `<a id="kotu" href="javascript:window.__xss='link'">Faturayı görüntüle</a>`,
  `<a id="iyi" href="https://ornek.com/teklif" target="_self">Teklif sayfası</a>`,
  `<style>body{display:none !important}</style>`,
  `<form action="https://kotu.example/parola"><input name="parola" placeholder="Parolanız"></form>`,
].join("");

const eposta = {
  id: "e1", mesajId: "<m1@kotu.example>", gonderenAdi: "Saldırgan", gonderenEposta: "a@kotu.example", aliciEposta: "satis@tekir.com",
  konu: "Acil teklif", icerikMetin: "Fiyat teklifi", icerikHtml: zararli, tarih: "2026-11-01T10:00:00Z", okundu: true, durum: "yeni",
  cariId: null, crmFirsatId: null, faturaId: null, cari: null, ekler: [], teklifIslemi: null, teklifBelge: null,
};

test("zararlı e-posta HTML'i panelde betik çalıştırmaz; style/form atılır; bağlantı noopener", async ({ page }) => {
  const diyaloglar: string[] = [];
  page.on("dialog", (d) => { diyaloglar.push(d.message()); void d.dismiss(); });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (yol.endsWith("/auth/ben")) json = { userId: "u1", tenantId: "t1", rol: "yonetici" };
    else if (yol.endsWith("/eposta/gelen")) json = { toplam: 1, sayfa: 1, adet: 20, sayfaSayisi: 1, satirlar: [eposta] };
    else if (yol.endsWith("/eposta/gelen/e1")) json = eposta;
    else if (yol.endsWith("/ebelge/uygulamalar")) json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    await route.fulfill({ json });
  });
  await page.goto("/panel/eposta?id=e1");
  const govde = page.locator(".email-body-content");
  await expect(govde.getByText("Fiyat teklifi")).toBeVisible();

  // Olaylar tetiklensin diye kısa bir süre tanınır, kötü bağlantı tıklanır.
  await page.waitForTimeout(500);
  await govde.locator("#kotu").click({ force: true }).catch(() => undefined);
  expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss)).toBeUndefined();
  expect(diyaloglar).toEqual([]);

  await expect(govde.locator("script, style, form, input, svg, [onerror]")).toHaveCount(0);
  await expect(govde.locator("#kotu")).not.toHaveAttribute("href", /javascript/i);
  const iyi = govde.locator("#iyi");
  await expect(iyi).toHaveAttribute("target", "_blank");
  await expect(iyi).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(page.locator("body")).toBeVisible();
});
