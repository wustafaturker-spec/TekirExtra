import { firmaSayfasi } from "./platform-firma-fixture";
import { expect, test } from "@playwright/test";

/** PLT-32…37: platform ödeme raporu ekranı (API sahte yanıtlarla). */
const ozet = (toplam: string, matrah: string, kdv: string, adet: number, hesaplananVar = false, iade = "0.00") => ({
  adet, toplam, matrah, kdv, hesaplananVar, iade, net: (Number(toplam) - Number(iade)).toFixed(2),
  kanallar: adet ? [{ kanal: "elle", adet: 1, toplam: "5500.00" }, { kanal: "panel", adet: adet - 1, toplam: (Number(toplam) - 5500).toFixed(2) }] : [],
});
const rapor = {
  aralik: { baslangic: "2026-11-01", bitis: "2026-11-30" },
  ozet: ozet("6698.80", "5582.33", "1116.47", 2, true, "100.00"),
  onceki: { baslangic: "2026-10-02", bitis: "2026-10-31", ozet: ozet("5500.00", "4583.33", "916.67", 1) },
  kayitlar: [
    { odemeId: "o1", tenantId: "t1", unvan: "DENEME FİRMASI 2", vkn: "1234567890", zaman: "2026-11-01T13:34:57Z", aySayisi: 1, toplam: "1198.80", matrah: "999.00", kdv: "199.80", kdvHesaplandi: false, kaynak: "saglayici", saglayici: "iyzico", kanal: "panel", oncekiDonemSonu: "2026-11-05T00:00:00Z", yeniDonemSonu: "2026-12-05T00:00:00Z", not: null, kaydeden: null, fatura: { no: "ABF2026000000003", durum: "tahsil_edildi" }, iade: "100.00" },
    { odemeId: "o2", tenantId: "t2", unvan: "Araç Test", vkn: null, zaman: "2026-11-01T11:30:17Z", aySayisi: 3, toplam: "5500.00", matrah: "4583.33", kdv: "916.67", kdvHesaplandi: true, kaynak: "elle", saglayici: null, kanal: "elle", oncekiDonemSonu: null, yeniDonemSonu: "2027-02-01T00:00:00Z", not: "Havale ile ödendi", kaydeden: "Admin", fatura: null, iade: "5500.00" },
  ],
  toplamKayit: 2, sayfa: 1, adet: 50, saglayicilar: ["iyzico"],
};
const aylik = { aylar: Array.from({ length: 12 }, (_, i) => { const t = new Date(Date.UTC(2025, 11 + i, 1)); return { ay: t.toISOString().slice(0, 7), adet: i % 3, toplam: i === 11 ? "6698.80" : (i * 450).toFixed(2), matrah: "0.00" }; }) };
const sorunlu = {
  denemeler: [{ id: "d1", tenantId: "t1", unvan: "DENEME FİRMASI 2", zaman: "2026-11-01T10:00:00Z", saglayici: "iyzico", ortam: "test", kanal: "otomatik", aySayisi: 1, toplam: "1198.80", durum: "basarisiz", hata: "Yetersiz bakiye" }],
  kartlar: [{ tenantId: "t1", unvan: "DENEME FİRMASI 2", saglayici: "iyzico", son4: "0006", kartMarkasi: "MASTER_CARD", otomatikYenileme: true, aySayisi: 1, denemeSayisi: 2, sonDeneme: "2026-11-01T10:00:00Z", sonHata: "Yetersiz bakiye" }],
};
const yaklasan = {
  gun: 30,
  kayitlar: [
    { tenantId: "t1", unvan: "DENEME FİRMASI 2", planKodu: "profesyonel", planAdi: "Profesyonel", durum: "aktif", donemSonu: "2026-11-11T00:00:00Z", kalanGun: 10, kart: { saglayici: "iyzico", son4: "0006", kartMarkasi: "VISA", otomatikYenileme: true, aySayisi: 3 }, beklenen: { aySayisi: 3, matrah: "2997.00", kdv: "599.40", toplam: "3596.40" } },
    { tenantId: "t3", unvan: "Kurumsal A.Ş.", planKodu: "kurumsal", planAdi: "Kurumsal", durum: "askida", donemSonu: "2026-10-20T00:00:00Z", kalanGun: -12, kart: null, beklenen: null },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-odeme-raporu-test"));
  await page.route("**/api/v1/platform/**", (route) => {
    const url = new URL(route.request().url());
    const yol = url.pathname;
    if (yol.endsWith("/auth/ben")) return route.fulfill({ json: { kullaniciId: "p1", eposta: "ekip@example.test", rol: "yonetici" } });
    if (yol.endsWith("/odeme-raporu/aylik")) return route.fulfill({ json: aylik });
    if (yol.endsWith("/odeme-raporu/sorunlu")) return route.fulfill({ json: sorunlu });
    if (yol.endsWith("/odeme-raporu/yaklasan")) return route.fulfill({ json: yaklasan });
    if (yol.endsWith("/odeme-raporu/disari-aktar")) return route.fulfill({ body: "﻿Tarih;Firma\r\n", headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="platform-odemeleri-2026-11-01-2026-11-30.csv"' } });
    if (yol.endsWith("/odeme-raporu")) return route.fulfill({ json: rapor });
    return route.fulfill({ json: [] });
  });
});

test("ödemeler: özet, önceki dönem, tablo, süzgeç adres çubuğunda, firma bağlantısı ve CSV", async ({ page }) => {
  const istekler: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/platform/odeme-raporu?")) istekler.push(r.url()); });
  await page.goto("/platform/odeme-raporu?baslangic=2026-11-01&bitis=2026-11-30");
  await expect(page.getByRole("link", { name: "Ödeme raporu" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Abonelik ödemesi" })).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator(".stat").filter({ hasText: "Tahsilat (KDV dahil)" })).toContainText("6.698,80");
  await expect(page.locator(".stat").filter({ hasText: "Tahsilat (KDV dahil)" })).toContainText("+%21,8");
  await expect(page.getByText("Elle girilen ödemelerden hesaplanan KDV içerir")).toBeVisible();
  const elle = page.getByRole("row").filter({ hasText: "Araç Test" });
  await expect(elle).toContainText("hesaplanan");
  await expect(elle).toContainText("Faturasız");
  await expect(elle).toContainText("Admin");
  await expect(page.getByRole("row").filter({ hasText: "DENEME FİRMASI 2" })).toContainText("ABF2026000000003");
  await expect(page.getByRole("link", { name: "DENEME FİRMASI 2" })).toHaveAttribute("href", "/platform/firmalar?firma=t1");
  await expect(page.getByRole("img", { name: /Son 12 ay tahsilat/ })).toBeVisible();

  await page.getByLabel("Kaynak").selectOption("elle");
  await expect(page).toHaveURL(/kanal=elle/);
  await expect.poll(() => istekler.some((u) => u.includes("kanal=elle"))).toBe(true);
  await page.getByRole("button", { name: "Geçen ay" }).click();
  await expect(page).toHaveURL(/baslangic=\d{4}-\d{2}-01/);

  const indirme = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  expect((await indirme).suggestedFilename()).toBe("platform-odemeleri-2026-11-01-2026-11-30.csv");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: process.env.EKRAN_DIZINI ? `${process.env.EKRAN_DIZINI}/odeme-raporu-masaustu.png` : "/tmp/odeme-raporu-masaustu.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: process.env.EKRAN_DIZINI ? `${process.env.EKRAN_DIZINI}/odeme-raporu-mobil.png` : "/tmp/odeme-raporu-mobil.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("sorunlu tahsilatlar ve yaklaşan yenilemeler sekmeleri", async ({ page }) => {
  await page.goto("/platform/odeme-raporu?sekme=sorunlu");
  await expect(page.getByRole("tab", { name: /Sorunlu tahsilatlar/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("row").filter({ hasText: "Otomatik yenileme" }).first()).toContainText("Yetersiz bakiye");
  await expect(page.getByRole("row").filter({ hasText: "**** 0006" })).toContainText("2/3");

  await page.getByRole("tab", { name: "Yaklaşan yenilemeler" }).click();
  await expect(page).toHaveURL(/sekme=yaklasan/);
  await expect(page.locator(".stat").filter({ hasText: "Beklenen tahsilat" })).toContainText("3.596,40");
  await expect(page.getByText("1 firma fiyatsız planda (elle fiyatlanır)")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Kurumsal A.Ş." })).toContainText("12 gün geçti");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: process.env.EKRAN_DIZINI ? `${process.env.EKRAN_DIZINI}/odeme-raporu-yaklasan.png` : "/tmp/odeme-raporu-yaklasan.png", fullPage: true });
});

test("firma kartı ödeme raporundaki bağlantıyla açılır", async ({ page }) => {
  await page.route("**/api/v1/platform/firmalar/sayfali?*", (route) => firmaSayfasi(route, [{ tenantId: "t1", unvan: "DENEME FİRMASI 2", vkn: "1234567890", kayitTarihi: "2026-01-01T00:00:00Z", planKodu: "profesyonel", durum: "aktif", donemSonu: "2026-12-05T00:00:00Z", iptalTarihi: null, aktifKullanici: 1, sonGiris: null, ebelgeSaglayici: null, bekleyenTalep: null, sonOdemeAt: null, askiyaAlinacak: false }]));
  await page.route("**/api/v1/platform/firmalar/t1/gecmis", (route) => route.fulfill({ json: { degisiklikler: [], talepler: [], odemeler: [], basarisizDenemeler: [] } }));
  await page.goto("/platform/firmalar?firma=t1");
  await expect(page.getByRole("dialog")).toContainText("DENEME FİRMASI 2");
});

test("PLT-42/46: rapordan iade — kısmi iade satırı ve özeti, form gövdesi, tam iade edilmiş satırda düğme yok", async ({ page }) => {
  let govde: Record<string, unknown> | null = null;
  await page.route("**/api/v1/platform/abonelik-odemeleri/o1/iade", async (route) => {
    govde = route.request().postDataJSON();
    await route.fulfill({ json: { mesaj: "50,00 TL kısmi iade kaydedildi; para iyzico üzerinden iade edildi (ref R1)." } });
  });
  await page.goto("/platform/odeme-raporu?baslangic=2026-11-01&bitis=2026-11-30");
  await expect(page.locator(".stat").filter({ hasText: "İade" })).toContainText("Net tahsilat (iadeler düşülmüş): ₺6.598,80");
  const kartli = page.getByRole("row").filter({ hasText: "DENEME FİRMASI 2" });
  await expect(kartli).toContainText("İade 100,00");
  await expect(page.getByRole("row").filter({ hasText: "Araç Test" })).toContainText("İade edildi");
  await expect(page.getByRole("row").filter({ hasText: "Araç Test" }).getByRole("button", { name: "İade et" })).toHaveCount(0);

  await kartli.getByRole("button", { name: "İade et" }).click();
  const pencere = page.getByRole("dialog");
  await expect(pencere).toContainText("iade edilebilir 1.098,80 TL");
  await expect(pencere.getByLabel("İade tutarı (TL)")).toHaveValue("1098.80");
  await expect(pencere).toContainText("Tam iade: firmanın dönem sonu bu ödemenin süresi kadar (1 ay) geri alınır.");
  await pencere.getByLabel("İade tutarı (TL)").fill("50");
  await expect(pencere).toContainText("Kısmi iade: abonelik dönemi değişmez.");
  await expect(pencere.getByRole("button", { name: "50,00 TL iade et" })).toBeDisabled();
  await pencere.getByLabel("Neden").fill("Kısmi indirim");
  await expect(pencere.getByLabel("Parayı iyzico üzerinden müşteriye iade et")).toBeChecked();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: process.env.EKRAN_DIZINI ? `${process.env.EKRAN_DIZINI}/odeme-raporu-iade.png` : "/tmp/odeme-raporu-iade.png" });
  await pencere.getByRole("button", { name: "50,00 TL iade et" }).click();
  await expect(page.getByText("50,00 TL kısmi iade kaydedildi")).toBeVisible();
  expect(govde).toMatchObject({ tutar: "50.00", neden: "Kısmi indirim", saglayiciyaGonder: true, islemAnahtari: expect.stringMatching(/^[A-Za-z0-9]{16,}$/) });
});

test("PLT-46: firma kartında ödemenin iadeleri görünür, kalan için satır altında iade formu açılır", async ({ page }) => {
  await page.route("**/api/v1/platform/firmalar/sayfali?*", (route) => firmaSayfasi(route, [{ tenantId: "t1", unvan: "DENEME FİRMASI 2", vkn: "1234567890", kayitTarihi: "2026-01-01T00:00:00Z", planKodu: "profesyonel", durum: "aktif", donemSonu: "2026-12-05T00:00:00Z", iptalTarihi: null, aktifKullanici: 1, sonGiris: null, ebelgeSaglayici: null, bekleyenTalep: null, sonOdemeAt: null, askiyaAlinacak: false }]));
  await page.route("**/api/v1/platform/firmalar/t1/gecmis", (route) => route.fulfill({ json: { degisiklikler: [], talepler: [], basarisizDenemeler: [], odemeler: [
    { id: "o1", zaman: "2026-11-01T13:34:57Z", aySayisi: 1, tutar: 1198.8, kdv: 199.8, kaynak: "saglayici", saglayici: "iyzico", not: null, yeniDonemSonu: "2026-12-05T00:00:00Z", fatura: null,
      iadeler: [{ id: "i1", zaman: "2026-11-01T15:00:00Z", tutar: 100, neden: "Kısmi indirim", saglayiciyaGonderildi: true, ref: "R1", kaydeden: "Admin", faturalayanDurumu: "yazildi", faturalayanHata: null }] },
  ] } }));
  await page.goto("/platform/firmalar?firma=t1");
  const pencere = page.getByRole("dialog");
  const satir = pencere.getByRole("row").filter({ hasText: "1 ay" });
  await expect(satir).toContainText("İade 100,00 TL");
  await expect(satir).toContainText("iyzico üzerinden · faturalayana işlendi");
  await satir.getByRole("button", { name: "İade et" }).click();
  await expect(pencere.getByRole("form", { name: "Abonelik ödemesini iade et" })).toContainText("iade edilebilir 1.098,80 TL");
  await pencere.getByRole("button", { name: "Vazgeç" }).click();
  await expect(pencere.getByRole("form", { name: "Abonelik ödemesini iade et" })).toHaveCount(0);
});


test("sorunlu ödeme kapsamı ve sayfalama URL ile korunur", async ({ page }) => {
  const firma = "00000000-0000-4000-8000-000000000301";
  const sorgular: URLSearchParams[] = [];
  await page.route("**/api/v1/platform/odeme-raporu/sorunlu?*", (r) => {
    const p = new URL(r.request().url()).searchParams; sorgular.push(p);
    return r.fulfill({ json: { ...sorunlu, denemeler: Number(p.get("sayfa")) > 1 ? [] : sorunlu.denemeler,
      kartlar: [], kartKapsami: "gizli", sayilar: { basarisiz: 507, sonuclanmadi: 1 }, toplam: 507, sayfa: Number(p.get("sayfa")), sayfaBoyutu: 50 } });
  });
  await page.goto(`/platform/odeme-raporu?sekme=sorunlu&baslangic=2026-10-01&bitis=2026-10-02&plan=profesyonel&firma=${firma}&durum=basarisiz`);
  await expect(page.getByLabel("Deneme durumu")).toHaveValue("basarisiz");
  await expect(page.getByText("507 deneme · Sayfa 1")).toBeVisible();
  await page.getByRole("button", { name: "Sonraki", exact: true }).click();
  await expect(page).toHaveURL(/sayfa=2/);
  await expect(page.getByRole("button", { name: "İlk sayfaya dön" })).toBeVisible();
  expect(sorgular.at(-1)?.get("plan")).toBe("profesyonel"); expect(sorgular.at(-1)?.get("firma")).toBe(firma);
  await page.getByLabel("Deneme durumu").selectOption("sonuclanmadi");
  await expect(page).not.toHaveURL(/sayfa=2/);
  await expect(page.getByText("507 deneme · Sayfa 1")).toBeVisible();
});
