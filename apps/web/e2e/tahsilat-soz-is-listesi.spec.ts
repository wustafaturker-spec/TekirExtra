import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("takipsiz ileri tarihli söz iş listesinde görünür ve yenilemede güncellenir", async ({ page }) => {
  const cariId = "11111111-1111-4111-8111-111111111111", id = "33333333-3333-4333-8333-333333333333";
  let kalan = "600.00"; const yazilar: string[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") yazilar.push(path);
    let json: unknown = {};
    if (path.endsWith("/auth/ben")) json = { rol: "muhasebe", userId: cariId };
    if (path.endsWith("/cari/tahsilat-takipleri")) json = { kullanimModu: "pilot", bugun: "2026-10-19", alindigiZaman: "2026-10-19T10:00:00Z", cariId: null, gorunum: "bugun", sorumluUserId: null, toplam: 0, sonrakiImlec: null, kayitlar: [] };
    if (path.endsWith("/cari/odeme-sozleri/is-listesi")) json = { sonrakiImlec: null, kayitlar: [{ cari: { id: cariId, unvan: "Gelecek söz müşterisi" }, kullanimModu: "pilot", alindigiZaman: "2026-10-19T10:00:00Z", zamanHassasiyeti: "gun", uyari: "Söz", sozler: [{ id, cariId, faturaId: "22222222-2222-4222-8222-222222222222", faturaNo: "SAT-001", dovizCinsi: "TRY", tutar: "1000.00", sozTarihi: "2035-01-20", verildigiZaman: "2026-10-19T10:00:00Z", aciklama: "Telefon sözü", kayitDurumu: "aktif", sonlandirmaNedeni: null, surum: 1, oncekiSozId: null, gerceklesme: { sozId: id, durum: "kismen_gerceklesti", gerceklesen: kalan === "600.00" ? "400.00" : "500.00", kalan } }] }] };
    await route.fulfill({ json });
  });
  await page.goto("/panel/cari/tahsilat");
  const bolum = page.getByRole("region", { name: "Tahsilat ödeme sözleri", exact: true });
  await expect(bolum.getByText("Gelecek söz müşterisi")).toBeVisible();
  await expect(bolum.getByText("20.01.2035")).toBeVisible();
  await expect(bolum.getByText("600,00 TRY", { exact: true })).toBeVisible();
  kalan = "500.00"; await bolum.getByRole("button", { name: "Ödeme sözlerini yenile" }).click();
  await expect(bolum.getByText("600,00 TRY", { exact: true })).toHaveCount(0);
  await expect(bolum.getByText("500,00 TRY", { exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(bolum.getByText("Gelecek söz müşterisi")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(yazilar).toEqual([]);
});

test("öncelikler, arama, takip detayı ve mobil görünüm", async ({ page }, testInfo) => {
  const user = randomUUID(), tenant = randomUUID(), customer = randomUUID(), followup = randomUUID();
  const zaman = "2026-10-19T10:00:00Z";
  const kayitlar = [
    { unvan: "Atlas Yapı Malzemeleri", tarih: "2026-10-16", durum: "gecikti", tutar: "45000.00", gerceklesen: "15000.00", kalan: "30000.00" },
    { unvan: "Marmara Teknoloji", tarih: "2026-10-21", durum: "kismen_gerceklesti", tutar: "18500.00", gerceklesen: "5000.00", kalan: "13500.00" },
    { unvan: "Nova Tasarım Atölyesi", tarih: "2026-10-18", durum: "gerceklesti", tutar: "8200.00", gerceklesen: "8200.00", kalan: "0.00" },
  ].map((v, i) => {
    const cariId = i === 0 ? customer : randomUUID(), id = randomUUID();
    return { cari: { id: cariId, unvan: v.unvan }, kullanimModu: "pilot", alindigiZaman: zaman, zamanHassasiyeti: "gun", uyari: "Güncel ödeme kaynaklarına göre hesaplandı.", sozler: [{ id, cariId, faturaId: randomUUID(), faturaNo: `SAT-2026-00${i + 1}`, dovizCinsi: "TRY", tutar: v.tutar, sozTarihi: v.tarih, verildigiZaman: "2026-10-14T10:00:00Z", aciklama: "Telefon görüşmesinde alınan ödeme sözü", kayitDurumu: "aktif", sonlandirmaNedeni: null, surum: 1, oncekiSozId: null, gerceklesme: { sozId: id, durum: v.durum, gerceklesen: v.gerceklesen, kalan: v.kalan } }] };
  });
  const takip = { id: followup, cari: { id: customer, unvan: "Atlas Yapı Malzemeleri" }, sorumlu: { id: user, adSoyad: "Ayşe Demir", aktif: true }, konu: "Ekim ayı tahsilat görüşmesi", neden: "tahsilat", durum: "acik", sonrakiIslemTarihi: "2026-10-19", sonrakiIslem: "Ödeme dekontu için müşteriyi arayın", sonIslemGerekcesi: null, surum: 1, createdAt: zaman, updatedAt: zaman };
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let json: unknown = {};
    if (path.endsWith("/auth/ben")) json = { rol: "muhasebe", userId: user, tenantId: tenant };
    else if (path.endsWith("/odeme-sozleri/is-listesi")) json = { kayitlar, sonrakiImlec: null };
    else if (path.endsWith(`/tahsilat-takipleri/${followup}`)) json = { kullanimModu: "pilot", kayit: takip, gorusmeSayisi: 1, olaySayisi: 0, gorusmeler: [{ id: randomUUID(), kanal: "telefon", gorusmeTarihi: "2026-10-16", not: "Müşteri kalan ödemenin pazartesi yapılacağını iletti. Dekont gönderildiğinde muhasebe kaydı kontrol edilecek.", createdAt: zaman }], olaylar: [] };
    else if (path.endsWith("/tahsilat-takipleri/sorumlular")) json = { kayitlar: [{ id: user, adSoyad: "Ayşe Demir" }], varsayilanUserId: user };
    else if (path.endsWith("/tahsilat-takipleri")) json = { kullanimModu: "pilot", bugun: "2026-10-19", alindigiZaman: zaman, cariId: null, gorunum: url.searchParams.get("gorunum") ?? "bugun", sorumluUserId: url.searchParams.get("sorumluUserId"), toplam: 1, sonrakiImlec: null, kayitlar: [takip] };
    else if (path.endsWith("/ebelge/uygulamalar")) json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    else if (path.endsWith("/bildirimler/ozet")) json = { okunmamis: 0, acik: 0, kritik: 0 };
    else if (path.endsWith("/bildirimler")) json = { kayitlar: [] };
    await route.fulfill({ json });
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/panel/cari/tahsilat");
  const promises = page.getByRole("region", { name: "Tahsilat ödeme sözleri", exact: true });
  await expect(promises.getByText("Marmara Teknoloji", { exact: true })).toBeVisible();
  await promises.getByRole("button", { name: "Gecikenler", exact: true }).click();
  await expect(promises.getByText("Atlas Yapı Malzemeleri", { exact: true })).toBeVisible();
  await expect(promises.getByText("Marmara Teknoloji", { exact: true })).toHaveCount(0);
  await promises.getByRole("button", { name: "Tümü", exact: true }).click();
  await promises.getByRole("textbox", { name: "Bu sayfadaki sözlerde ara" }).fill("MARMARA");
  await expect(promises.getByText("Atlas Yapı Malzemeleri", { exact: true })).toHaveCount(0);
  await expect(promises.getByText("Marmara Teknoloji", { exact: true })).toBeVisible();
  await promises.getByRole("textbox", { name: "Bu sayfadaki sözlerde ara" }).fill("");
  await page.screenshot({ path: testInfo.outputPath("tahsilat-masaustu.png"), fullPage: true });
  await page.getByRole("button", { name: "Takibi incele: Atlas Yapı Malzemeleri" }).click();
  const detail = page.getByRole("region", { name: "Tahsilat takip detayı", exact: true });
  await expect(detail.getByText("Ayşe Demir", { exact: true })).toBeVisible();
  await expect(detail.getByText(/Müşteri kalan ödemenin/)).toBeVisible();
  await detail.getByRole("button", { name: "Görüşme ekle", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Görüşme notu" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("takip-detay-masaustu.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("takip-detay-mobil.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
