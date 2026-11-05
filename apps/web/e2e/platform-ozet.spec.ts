import { expect, test, type Page } from "@playwright/test";
import { firmaSayfasi } from "./platform-firma-fixture";

const onay = { id: "d1", no: 12, baslik: "Tevkifat oranları güncellemesi", dayanak: "Örnek Tebliğ", yururlukBaslangic: "2026-11-01", durum: "onay_bekliyor", satirSayisi: 2, hazirlayan: { adSoyad: "Ayşe Yılmaz" }, yayinlayan: null, retGerekcesi: null };
const taslak = { ...onay, id: "d2", no: 13, baslik: "Yeni dönem hazırlığı", durum: "taslak" };
const talep = { id: "t1", aciklama: "Eksik tevkifat oranı bildirimi", kaynak: "kiraci_bildirimi", createdAt: "2026-10-30T08:00:00Z" };
const takvim = [
  { tur: "kanuni_deger", anahtar: "kidem_tavani", ad: "Kıdem tazminatı tavanı", etki: "kıdem tazminatı hesaplanamaz", donem: "2026/2", baslangic: "2026-07-01", kalanGun: -121, kayitVar: false, durum: "eksik" },
  { tur: "bordro_parametreleri", anahtar: "genel", ad: "Bordro parametreleri", etki: "bordro hesaplanamaz", donem: "2027", baslangic: "2027-01-01", kalanGun: 30, kayitVar: false, durum: "yaklasiyor" },
  { tur: "kanuni_deger", anahtar: "tevkifat_alt_siniri", ad: "Tevkifat alt sınırı", etki: "tevkifat hesaplanamaz", donem: "2026", baslangic: "2026-01-01", kalanGun: -300, kayitVar: true, durum: "tamam" },
];
const firma = (id: string, unvan: string, plan = false, gecikme = false) => ({ tenantId: id, unvan, vkn: "1234567890", kayitTarihi: "2026-01-01", planKodu: "baslangic", planAdi: "Başlangıç", durum: "aktif", donemSonu: "2026-11-01", iptalTarihi: null, aktifKullanici: 3, sonGiris: null, ebelgeSaglayici: null, askiyaAlinacak: gecikme, bekleyenTalep: plan ? { id: "p1", istenenPlan: "kurumsal", istenenPlanAdi: "Kurumsal" } : null });
const faturalar = { faturalayan: null, kartHesap: null, elleHesap: null, baslangicAt: null, hesaplar: [], sorunlu: [{ odemeId: "o1", firma: "Örnek Makina", durum: "hata", hata: "Geçersiz VKN", faturaNo: null }] };

async function hazirla(page: Page, rol = "yonetici") {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "platform-ozet-test"));
  await page.route("**/api/v1/platform/**", (route) => {
    const url = new URL(route.request().url());
    const yol = url.pathname;
    if (yol.endsWith("/firmalar/sayfali")) return firmaSayfasi(route, [firma("f1", "Plan isteyen firma", true), firma("f2", "Ödemesi geciken firma", false, true), firma("f3", "Düzenli firma")]);
    const veri = yol.endsWith("/auth/ben") ? { kullaniciId: "p1", eposta: "ekip@example.test", rol }
      : yol.endsWith("/degisiklikler") ? (url.searchParams.get("durum") === "onay_bekliyor" ? [onay] : [onay, taslak])
      : yol.endsWith("/talepler") ? [talep]
      : yol.endsWith("/yayin-takvimi") ? takvim
      : yol.endsWith("/olaylar") ? [{ id: "o1", olay: "onaya_gonderildi", zaman: "2026-10-30T08:00:00Z", kullanici: "Ayşe Yılmaz", degisiklikId: "d1", degisiklik: { no: 12, baslik: onay.baslik } }]
      : yol.endsWith("/firmalar") ? [firma("f1", "Plan isteyen firma", true), firma("f2", "Ödemesi geciken firma", false, true), firma("f3", "Düzenli firma")]
      : yol.endsWith("/sistem-sagligi") ? { zaman: "2026-10-30T08:00:00Z", alarmlar: [{ anahtar: "a1", ozet: "Banka bağlantısı kontrol edilmeli", acik: true }, { anahtar: "a2", ozet: "Kapanmış alarm", acik: false }] }
      : yol.endsWith("/abonelik-fatura") ? faturalar : [];
    return route.fulfill({ json: veri });
  });
}
const panel = (page: Page, baslik: string) => page.locator(".platform-dashboard-panel").filter({ has: page.getByRole("heading", { name: baslik, exact: true }) });

test("yönetim özeti kaynakları toplar ve plan talebi doğru firma filtresini açar", async ({ page }) => {
  await hazirla(page);
  await page.goto("/platform/ozet");
  await expect(page.getByRole("button", { name: "Tümünü yenile" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Onay bekleyen değişiklik: 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dönem kaydı eksik: 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Yaklaşan dönem: 1", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Açık sistem alarmı: 1", exact: true })).toBeVisible();
  await expect(panel(page, "Sistem uyarıları").getByText("Kapanmış alarm")).toHaveCount(0);
  await expect(panel(page, "Bekleyen onaylar").getByRole("link", { name: /Tevkifat oranları/ })).toHaveAttribute("href", "/platform/degisiklik?id=d1");
  await expect(page.getByRole("navigation", { name: "Platform menüsü" }).getByRole("link", { name: "Yönetim özeti" })).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-ozet-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/platform-ozet-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Bekleyen plan talebi: 1", exact: true }).click();
  await expect(page).toHaveURL(/firmalar\?goster=talep$/, { timeout: 30000 });
  await expect(page.getByLabel("Göster")).toHaveValue("talep");
  await expect(page.getByText("Plan isteyen firma", { exact: true })).toBeVisible();
  await expect(page.getByText("Düzenli firma", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Menüyü aç", exact: true }).click();
  await page.getByRole("navigation", { name: "Platform menüsü" }).getByRole("link", { name: "Firmalar", exact: true }).click();
  await expect(page.getByLabel("Göster")).toHaveValue("hepsi");
  await expect(page.getByText("Düzenli firma", { exact: true })).toBeVisible();
});

test("editör özetinde yönetici verileri istenmez ve operasyon kartları görünmez", async ({ page }) => {
  await hazirla(page, "mevzuat_editoru");
  const yoneticiIstekleri: string[] = [];
  page.on("request", (r) => { if (/\/platform\/(firmalar|sistem-sagligi|abonelik-fatura)(\?|$)/.test(new URL(r.url()).pathname)) yoneticiIstekleri.push(r.url()); });
  await page.goto("/platform/ozet");
  await expect(page.getByRole("button", { name: "Tümünü yenile" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Mevzuat gündemi" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Platform takibi" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Bekleyen plan talebi:/ })).toHaveCount(0);
  await expect(panel(page, "Sistem uyarıları")).toHaveCount(0);
  await page.getByRole("button", { name: "Tümünü yenile" }).click();
  await expect(page.getByRole("button", { name: "Tümünü yenile" })).toBeEnabled();
  expect(yoneticiIstekleri).toEqual([]);
});

test("bir kaynağın hatası diğer kartları gizlemez ve yalnız ilgili bölüm yeniden denenir", async ({ page }) => {
  await hazirla(page);
  let onayHatasi = true;
  let sistemHatasi = true;
  let sistemIstegi = 0;
  await page.route("**/api/v1/platform/mevzuat/degisiklikler?durum=onay_bekliyor", (route) => route.fulfill(onayHatasi ? { status: 503, json: { message: "Onay listesi alınamadı." } } : { json: [onay] }));
  await page.route("**/api/v1/platform/sistem-sagligi", (route) => { sistemIstegi++; return route.fulfill(sistemHatasi ? { status: 503, json: { message: "Sistem ölçümü alınamadı." } } : { json: { zaman: "2026-10-30T08:00:00Z", alarmlar: [] } }); });
  await page.goto("/platform/ozet");
  await expect(page.getByRole("button", { name: "Tümünü yenile" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Onay bekleyen değişiklik: veri alınamadı", exact: true })).toContainText("—");
  await expect(panel(page, "Bekleyen onaylar").getByRole("alert")).toContainText("Onay listesi alınamadı.");
  await expect(panel(page, "Açık mevzuat talepleri").getByText(talep.aciklama)).toBeVisible();
  await expect(panel(page, "Yayın takvimi").getByText("Kıdem tazminatı tavanı")).toBeVisible();
  const oncekiSistemIstegi = sistemIstegi;
  onayHatasi = false;
  await panel(page, "Bekleyen onaylar").getByRole("button", { name: "Tekrar dene" }).click();
  await expect(panel(page, "Bekleyen onaylar").getByText(/Tevkifat oranları/)).toBeVisible();
  expect(sistemIstegi).toBe(oncekiSistemIstegi);
  sistemHatasi = false;
  await page.getByRole("button", { name: "Tümünü yenile" }).click();
  await expect(panel(page, "Sistem uyarıları").getByText("Son ölçümde açık sistem alarmı yok.")).toBeVisible();
});

test("kayıt sınırı toplam gibi gösterilmez ve eksik yanıt sağlıklı durum sayılmaz", async ({ page }) => {
  await hazirla(page);
  await page.route("**/api/v1/platform/mevzuat/degisiklikler?durum=onay_bekliyor", (route) => route.fulfill({ json: Array.from({ length: 200 }, (_, i) => ({ ...onay, id: `d${i}`, no: i + 1 })) }));
  await page.route("**/api/v1/platform/mevzuat/talepler?durum=acik", (route) => route.fulfill({ json: Array.from({ length: 300 }, (_, i) => ({ ...talep, id: `t${i}` })) }));
  await page.route("**/api/v1/platform/abonelik-fatura", (route) => route.fulfill({ json: { sorunlu: Array.from({ length: 100 }, (_, i) => ({ ...faturalar.sorunlu[0], odemeId: `o${i}` })) } }));
  await page.route("**/api/v1/platform/sistem-sagligi", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/v1/platform/mevzuat/yayin-takvimi", (route) => route.fulfill({ json: null }));
  await page.goto("/platform/ozet");
  await expect(page.getByRole("link", { name: "Onay bekleyen değişiklik: 200 veya daha fazla", exact: true })).toContainText("200+");
  await expect(page.getByRole("link", { name: "Açık mevzuat talebi: 300 veya daha fazla", exact: true })).toContainText("300+");
  await expect(page.getByRole("link", { name: "İşlem bekleyen fatura: 100 veya daha fazla", exact: true })).toContainText("100+");
  await expect(panel(page, "Sistem uyarıları").getByRole("alert")).toContainText("Sistem ölçümleri eksik alındı.");
  await expect(panel(page, "Sistem uyarıları").getByText("Son ölçümde açık sistem alarmı yok.")).toHaveCount(0);
  await expect(panel(page, "Yayın takvimi").getByRole("alert")).toBeVisible();
});

test("hızlı taslak bağlantısı formu açar, onay kartı durum filtresini uygular", async ({ page }) => {
  await hazirla(page);
  await page.goto("/platform/ozet");
  await page.getByRole("link", { name: "Yeni mevzuat taslağı", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\?yeni=1$/);
  await expect(page.getByLabel("Başlık", { exact: true })).toBeFocused();
  await page.goto("/platform/ozet");
  await page.getByRole("link", { name: "Onay bekleyen değişiklik: 1", exact: true }).click();
  await expect(page.getByRole("group", { name: "Durum", exact: true }).getByRole("button", { name: "Onay bekliyor" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Tevkifat oranları güncellemesi", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Yeni dönem hazırlığı", exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Platform menüsü" }).getByRole("link", { name: "Değişiklikler", exact: true }).click();
  await expect(page.getByRole("group", { name: "Durum", exact: true }).getByRole("button", { name: "Hepsi", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Yeni dönem hazırlığı", exact: true })).toBeVisible();
});
