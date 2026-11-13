import { expect, test, type Page } from "@playwright/test";

/**
 * AI-13: fiş okuma penceresi. Çok oranlı fişte oran başına ayrı taslak açılır ve görsel her birine
 * eklenir; tek oranlı fişte form dolar ve masraf kaydedilince tarama kaydına bağlanır. API taklittir.
 */
const KATEGORI = { id: "00000000-0000-4000-8000-00000000000a", ad: "Mutfak & Sarf", ustId: null, _count: { altlar: 0 }, aktif: true };
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function tarama(kirilim: Array<{ oran: number; matrah: number; kdvTutari: number }>) {
  const matrah = kirilim.reduce((t, k) => t + k.matrah, 0), kdv = kirilim.reduce((t, k) => t + k.kdvTutari, 0);
  return {
    dogrulama: { gecerli: true, uyarilar: [], hatalar: [], veri: {
      belgeTuru: "FIS", belgeNo: "F-12", tarih: "2026-11-10", saticiUnvan: "Deneme Market", saticiVknTckn: null, paraBirimi: "TRY",
      toplamMatrah: matrah, toplamKdv: kdv, genelToplam: matrah + kdv, kdvKirilimi: kirilim, kalemler: [{ aciklama: "Su", miktar: 1, birim: "adet", birimFiyat: 1, toplamTutar: 1 }], guvenSkoru: 0.9,
    } },
    eslesenCari: null, onerilenMasrafKategorisi: "Mutfak & Sarf", ocrKayitId: "00000000-0000-4000-8000-0000000000ff",
  };
}

async function kur(page: Page, kirilim: Array<{ oran: number; matrah: number; kdvTutari: number }>) {
  const istekler = { oranlaraGore: [] as unknown[], ekler: [] as string[], masraf: [] as unknown[], ocrSonuc: [] as unknown[], tarama: [] as Record<string, unknown>[] };
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "e2e-token"));
  await page.route("**/api/v1/**", async (route) => {
    const r = route.request(), url = new URL(r.url()), yol = url.pathname;
    let json: unknown = {};
    // Kod listesi yoksa KDV seçici paketteki varsayılan listeye düşer (diğer testlerle aynı).
    if (yol.endsWith("/mevzuat/kod-tablosu")) return route.fulfill({ status: 503, json: { message: "varsayılan kod listesi" } });
    if (yol.endsWith("/auth/ben")) json = { userId: "u1", tenantId: "t1", rol: "muhasebe" };
    else if (yol.endsWith("/ebelge/uygulamalar")) json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    else if (yol.endsWith("/masraflar/kategoriler")) json = [KATEGORI];
    else if (yol.endsWith("/cari")) json = { kayitlar: [], sonrakiImlec: null };
    else if (/\/kasa-banka\/(kasalar|bankalar|kredi-kartlari)$/.test(yol)) json = [];
    else if (yol.endsWith("/ai/ocr/tara")) { istekler.tarama.push(r.postDataJSON()); json = tarama(kirilim); }
    else if (yol.endsWith("/masraflar/oranlara-gore")) { istekler.oranlaraGore.push(r.postDataJSON()); json = [{ id: "m1" }, { id: "m2" }]; }
    else if (yol.endsWith("/ekler")) { istekler.ekler.push(url.searchParams.get("sahipId") ?? ""); json = { id: "e1" }; }
    else if (yol.endsWith("/masraflar") && r.method() === "POST") { istekler.masraf.push(r.postDataJSON()); json = { id: "m9" }; }
    else if (/\/ai\/ocr\/kayitlar\/.+\/sonuc$/.test(yol)) { istekler.ocrSonuc.push(r.postDataJSON()); return route.fulfill({ status: 204, body: "" }); }
    else if (yol.endsWith("/masraflar/sayfa")) json = { kayitlar: [], sonrakiImlec: null, adet: 0, ozet: { toplam: 0, odenmemis: 0, kira: 0, taslak: 0 } };
    await route.fulfill({ json });
  });
  await page.goto("/panel/masraflar/yeni");
  await page.getByRole("button", { name: /Fiş \/ Fatura Tara/ }).click();
  const pencere = page.getByRole("dialog", { name: "Yapay zekâ ile fiş oku" });
  await pencere.locator("input[type=file]").setInputFiles({ name: "fis.png", mimeType: "image/png", buffer: PNG_1PX });
  await expect(pencere.getByAltText("Fiş önizlemesi")).toBeVisible();
  await pencere.getByRole("button", { name: "Fişi oku" }).click();
  return { istekler, pencere };
}

test("çok oranlı fişte oran başına taslak açılır, görsel her taslağa eklenir", async ({ page }) => {
  const { istekler, pencere } = await kur(page, [{ oran: 10, matrah: 300, kdvTutari: 30 }, { oran: 20, matrah: 700, kdvTutari: 140 }]);
  await expect(pencere.getByText("KDV kırılımı — her oran ayrı masraf taslağı olur")).toBeVisible();
  expect(istekler.tarama[0]).toMatchObject({ belgeTipi: "fis_fatura", mimeType: expect.stringMatching(/^image\//) });
  await expect(pencere.getByLabel("Ödeme")).toHaveCount(0);
  await pencere.getByRole("button", { name: "2 taslak aç" }).click();
  await expect(page.getByText(/2 ayrı masraf taslağına bölündü/)).toBeVisible();
  expect(istekler.oranlaraGore).toEqual([{
    ortak: expect.objectContaining({ kategoriId: KATEGORI.id, belgeTuru: "fis", belgeNo: "F-12", tarih: "2026-11-10", saticiUnvan: "Deneme Market", dovizCinsi: "TRY", kur: 1 }),
    oranlar: [{ kdvOrani: 10, matrah: 300, kdvTutari: 30 }, { kdvOrani: 20, matrah: 700, kdvTutari: 140 }],
    ocrKayitId: "00000000-0000-4000-8000-0000000000ff",
  }]);
  expect(istekler.ekler.sort()).toEqual(["m1", "m2"]);
});

test("tek oranlı fiş formu doldurur; kayıttan sonra tarama kaydına bağlanır", async ({ page }) => {
  const { istekler, pencere } = await kur(page, [{ oran: 20, matrah: 500, kdvTutari: 100 }]);
  await pencere.getByRole("button", { name: "Forma doldur" }).click();
  await expect(page.getByLabel("Satıcı / kiraya veren")).toHaveValue("Deneme Market");
  await page.getByRole("button", { name: "Masrafı kaydet" }).click();
  await expect.poll(() => istekler.ocrSonuc).toEqual([{ masrafIdler: ["m9"] }]);
  expect(istekler.masraf[0]).toMatchObject({ kdvOrani: "20", toplam: "600.00" });
  expect(istekler.ekler).toEqual(["m9"]);
});
