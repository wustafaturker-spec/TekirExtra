import { expect, test } from "@playwright/test";

/** PLT-40: abonelik tahsilatı POS işlem listesinde komisyon, kart ve işlem numarasıyla; iade platformdan. */
const pos = { id: "pos1", ad: "İyzico", saglayici: "iyzico", dovizCinsi: "TRY", aktif: true, bakiye: "0", komisyonOrani: "3.49", islemUcreti: "0.25", taksitOranlari: [], valorGun: 1, baglanti: { durum: "aktif" }, varsayilanBankaHesap: null };
const ortak = { cari: { id: "c1", kod: "C-0042", unvan: "DENEME FİRMASI 3" }, posHesap: { id: "pos1", ad: "İyzico", saglayici: "iyzico" }, dovizCinsi: "TRY", durum: "odendi", createdAt: "2026-11-01T14:12:29Z", odemeTarihi: "2026-11-01T14:04:00Z", sonKullanimTarihi: null, epostaGonderimTarihi: null, epostaHatasi: null, smsGonderimTarihi: null, smsHatasi: null, slipNo: null, gecOdeme: false, iptalNedeni: null, hataMesaji: null, iadeEdilen: "0", iadeler: [], taksitSayisi: 1, odemeSayfasiUrl: null, makbuzYolu: null, fraudDurumu: 1, kartTuru: "DEBIT_CARD", hostReferansi: "mock00023iyzihostrfn" };
const kayitlar = [
  { ...ortak, id: "t1", kanal: "abonelik", fatura: { id: "f1", no: "SNC2026000000052" }, tutar: "14385.60", odenenTutar: "14385.60", komisyonTutari: "158.49", netTutar: "14227.11", komisyonKaynagi: "saglayici", saglayiciKomisyonu: "158.24", saglayiciUcreti: "0.25", kartMarkasi: "VISA", kartAilesi: "Halkbank DC", kartBin: "447505", kartSon4: "0003", saglayiciOdemeId: "38614161", provizyonKodu: "686298" },
  { ...ortak, id: "t2", kanal: "baglanti", cari: { id: "c2", kod: "C-0007", unvan: "EMKA MAK." }, fatura: null, tutar: "1000.00", odenenTutar: "1000.00", komisyonTutari: "35.15", netTutar: "964.85", komisyonKaynagi: "saglayici", saglayiciKomisyonu: "34.90", saglayiciUcreti: "0.25", kartMarkasi: "MASTER_CARD", kartAilesi: "Paraf", kartBin: "552608", kartSon4: "0006", saglayiciOdemeId: "38611970", provizyonKodu: "138486" },
];

test("abonelik tahsilatı POS listesinde 'Abonelik' etiketiyle, kart/ödeme/provizyon no ve kesinti dökümüyle görünür; iade düğmesi yok", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (yol.endsWith("/auth/ben")) json = { userId: "u1", tenantId: "t1", rol: "yonetici" };
    else if (yol.endsWith("/kasa-banka/pos-hesaplari")) json = [{ ...pos, bakiye: "125.50" }, { ...pos, id: "pos2", ad: "Banka USD", saglayici: "banka", dovizCinsi: "USD", bakiye: "42.75" }];
    else if (yol.endsWith("/pos/tahsilatlar")) json = { kayitlar, toplam: 2, sayfa: 1, adet: 20, durumOzetleri: { odendi: 2 } };
    else if (yol.endsWith("/pos/hesap-ozetleri")) json = { hesaplar: [{ posHesapId: "pos1", dovizCinsi: "TRY", adet: 2, komisyonsuzAdet: 0, brut: "15385.60", komisyonSaglayici: "193.64", komisyonTahmin: "0", iade: "0", net: "15191.96", aktarilabilir: "0" }] };
    else if (yol.endsWith("/pos/bankaya-gececekler")) json = [{
      posHesap: pos, bakiye: "125.50", dagitilamayan: "0",
      gruplar: [{ valorTarihi: "2026-11-02", vadesiGeldi: true, adet: 1, brut: "125.50", onerilenKomisyon: "4.38", net: "121.12" }],
    }];
    else if (yol.endsWith("/cari")) json = { kayitlar: [], sonrakiImlec: null };
    else if (yol.endsWith("/ebelge/uygulamalar")) json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    await route.fulfill({ json });
  });
  await page.goto("/panel/kasa-banka/pos");
  await expect(page.getByRole("heading", { name: "POS tahsilatları" })).toBeVisible();
  const bakiyeler = page.locator(".pos-currency-balances");
  await expect(bakiyeler).toContainText("125,50 TRY");
  await expect(bakiyeler).toContainText("42,75 USD");
  const abonelik = page.getByRole("row").filter({ hasText: "DENEME FİRMASI 3" });
  await expect(abonelik.getByText("Abonelik", { exact: true })).toBeVisible();
  const ayrinti = page.locator(".pos-payment-detail");
  await expect(ayrinti).toHaveCount(0);
  await abonelik.getByRole("button", { name: "Ayrıntı", exact: true }).click();
  await expect(ayrinti).toContainText("Abonelik · iyzico");
  await expect(ayrinti).toContainText("VISA Halkbank DC 4475 05•• •••• 0003 · komisyon");
  await expect(ayrinti).toContainText("Ödeme no 38614161 · Provizyon 686298");
  await expect(ayrinti).toContainText("iyzico komisyonu 158,24 TRY + işlem ücreti 0,25 TRY");
  await expect(ayrinti).toContainText("komisyon 158,49 TRY · net 14.227,11 TRY");
  await expect(abonelik).toContainText("Fatura SNC2026000000052");
  await expect(abonelik.getByText("İade platformdan yapılır")).toBeVisible();
  await expect(abonelik.getByRole("button", { name: "İade", exact: true })).toHaveCount(0);
  // Bağlantıyla alınan normal tahsilat iade edilebilir kalır.
  await expect(page.getByRole("row").filter({ hasText: "EMKA MAK." }).getByRole("button", { name: "İade", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await abonelik.scrollIntoViewIfNeeded();
  await page.locator("table").filter({ has: abonelik }).screenshot({ path: process.env.EKRAN_DIZINI ? `${process.env.EKRAN_DIZINI}/pos-abonelik.png` : "/tmp/pos-abonelik.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(ayrinti.getByText("Ödeme bilgileri")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await abonelik.getByRole("button", { name: "Ayrıntıyı kapat" }).click();
  await expect(ayrinti).toHaveCount(0);
  await page.getByRole("tab", { name: "Bankaya geçecekler" }).click();
  await expect(page.getByRole("heading", { name: "Valör takvimi" })).toBeVisible();
  await expect(abonelik).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Aktar", exact: true }).click();
  await expect(page.locator('input[name="brutTutar"]')).toHaveValue("125.50");
  await expect(page.locator('input[name="komisyonTutar"]')).toHaveValue("4.38");
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.getByRole("tab", { name: "POS hesapları" }).click();
  await page.getByRole("button", { name: "POS hesabı aç" }).click();
  await expect(page.getByRole("heading", { name: "POS hesabı tanımla" })).toBeInViewport();
});

test("sanal POS ayarlarında sağlayıcı durumları ve formları dar ekranda açılır", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const yol = new URL(route.request().url()).pathname;
    if (yol.endsWith("/auth/ben")) return route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    if (yol.endsWith("/baglantilar")) return route.fulfill({ json: [{ id: "b1", aile: "pos", saglayici: "iyzico", durum: "aktif", kullaniciAdiMaskeli: "abc***" }] });
    return route.fulfill({ json: [] });
  });
  await page.goto("/panel/ayarlar/pos");
  await expect(page.getByRole("article", { name: "iyzico" }).getByText("Aktif", { exact: true })).toBeVisible();
  const paytr = page.getByRole("article", { name: "PayTR" });
  await expect(paytr.getByText("Kurulum bekliyor")).toBeVisible();
  await paytr.getByRole("button", { name: "Bağla" }).click();
  const modal = page.getByRole("dialog", { name: "PayTR bağlantısı" });
  await expect(modal.locator('input[name="merchantKey"]')).toHaveAttribute("type", "password");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await modal.getByRole("button", { name: "Vazgeç" }).click();
  await expect(modal).toHaveCount(0);
});
