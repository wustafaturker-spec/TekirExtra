import { expect, test } from "@playwright/test";

/** SEC-16: tarayıcıda erişim token'ı betiklere görünmez; destek sekmesi kendi token'ıyla çalışır. */
const ben = { userId: "u1", tenantId: "t1", rol: "yonetici" };

test("girişte gövdedeki token saklanmaz, istekler Bearer göndermez, CSRF başlığı eklenir", async ({ page }) => {
  const istekler: { yol: string; yetki?: string; csrf?: string }[] = [];
  await page.route("**/api/v1/**", (route) => {
    const req = route.request(), yol = new URL(req.url()).pathname;
    istekler.push({ yol, yetki: req.headers().authorization, csrf: req.headers()["x-tekir-istek"] });
    if (yol.endsWith("/auth/yenile")) return route.fulfill({ status: 401, json: { message: "yok" } });
    if (yol.endsWith("/auth/giris")) return route.fulfill({ json: { accessToken: "GIZLI-TOKEN", kullanici: {} } });
    if (yol.endsWith("/auth/ben")) return route.fulfill({ json: ben });
    return route.fulfill({ json: [] });
  });
  await page.goto("/giris");
  await page.locator('input[name="eposta"]').fill("a@ornek.com");
  await page.locator('input[name="parola"]').fill("Parola12345");
  await page.getByRole("button", { name: /Giriş/ }).first().click();
  await expect(page).toHaveURL(/\/panel/);
  await expect.poll(() => istekler.some((i) => i.yol.endsWith("/auth/ben"))).toBe(true);
  const depo = await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  expect(depo).not.toContain("GIZLI-TOKEN");
  expect(istekler.filter((i) => i.yetki)).toEqual([]);
  expect(istekler.find((i) => i.yol.endsWith("/auth/giris"))?.csrf).toBe("1");
});

test("önceki sürümden kalan token silinir", async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem("tekir_access", "ESKI-TOKEN"); sessionStorage.setItem("tekir_platform_access", "ESKI-PLATFORM"); });
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/auth/ben") ? ben : [] }));
  await page.goto("/panel");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("tekir_access"))).toBe("cerez");
});

test("süresi dolan çerez bir kez yenilenir ve istek yinelenir", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "cerez"));
  let yenileme = 0, gecerli = false;
  await page.route("**/api/v1/**", (route) => {
    const yol = new URL(route.request().url()).pathname;
    if (yol.endsWith("/auth/yenile")) { yenileme++; gecerli = true; return route.fulfill({ json: {} }); }
    if (!gecerli) return route.fulfill({ status: 401, json: { message: "Oturum token'ı gerekli" } });
    return route.fulfill({ json: yol.endsWith("/auth/ben") ? ben : [] });
  });
  await page.goto("/panel/ayarlar/firma");
  await expect.poll(() => yenileme).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe("/panel/ayarlar/firma");
  expect(yenileme).toBe(1);
});

test("iki sekme aynı anda yenilerken sırayla çalışır", async ({ context }) => {
  const p1 = await context.newPage(), p2 = await context.newPage();
  let esZamanli = 0, enFazla = 0;
  await context.route("**/api/v1/auth/yenile", async (route) => {
    enFazla = Math.max(enFazla, ++esZamanli);
    await new Promise((ok) => setTimeout(ok, 300));
    esZamanli--;
    await route.fulfill({ json: {} });
  });
  await context.route("**/api/v1/auth/ben", (route) => route.fulfill({ json: ben }));
  await Promise.all([p1.goto("/giris"), p2.goto("/giris")]);
  const yenile = () => navigator.locks.request("tekir_oturum_yenileme", () => fetch("/api/v1/auth/yenile", { method: "POST" }).then((y) => y.status));
  const sonuc = await Promise.all([p1.evaluate(yenile), p2.evaluate(yenile)]);
  expect(sonuc).toEqual([200, 200]);
  expect(enFazla).toBe(1);
});

test("destek sekmesi kendi token'ını Bearer gönderir ve yenileme yapmaz", async ({ page }) => {
  const yetkiler: (string | undefined)[] = [];
  let yenileme = 0;
  await page.route("**/api/v1/**", (route) => {
    const yol = new URL(route.request().url()).pathname;
    if (yol.endsWith("/auth/yenile")) yenileme++;
    yetkiler.push(route.request().headers().authorization);
    return route.fulfill({ json: yol.endsWith("/auth/ben") ? { ...ben, destek: { ad: "Destek" } } : yol.endsWith("/destek/baslat") ? { ad: "Destek" } : [] });
  });
  await page.goto("/destek#t=DESTEK-TOKEN");
  await expect(page).toHaveURL(/\/panel/);
  await expect.poll(() => yetkiler.length).toBeGreaterThan(1);
  expect(await page.evaluate(() => sessionStorage.getItem("tekir_access"))).toBe("DESTEK-TOKEN");
  expect(new Set(yetkiler)).toEqual(new Set(["Bearer DESTEK-TOKEN"]));
  expect(yenileme).toBe(0);
});
