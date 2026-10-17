import { expect, test, type Page, type Route } from "@playwright/test";

const cariId = "11111111-1111-4111-8111-111111111111", f1 = "22222222-2222-4222-8222-222222222222", f2 = "44444444-4444-4444-8444-444444444444", s1 = "33333333-3333-4333-8333-333333333333";
const soz = () => ({ id: s1, cariId, faturaId: f1, faturaNo: "SAT-001", dovizCinsi: "TRY", tutar: "1000.00", sozTarihi: "2035-01-20", verildigiZaman: "2026-10-14T10:00:00.000Z", aciklama: "Telefon görüşmesi", kayitDurumu: "aktif", sonlandirmaNedeni: null as string | null, surum: 1, oncekiSozId: null as string | null, gerceklesme: { sozId: s1, durum: "kismen_gerceklesti", gerceklesen: "400.00", kalan: "600.00" } });
const cari = { id: cariId, kod: "C001", unvan: "Tahsilat müşterisi", tip: "musteri", aktif: true, sektor: null, vknTckn: null, eposta: null, telefon: null, karaListe: false, bakiyeler: [], kisaAd: null, kisiTipi: "tuzel", vergiDairesi: null, adresler: [], kisiler: [], bankaHesaplari: [], etiketler: [], grup: null, risk: { cekSenetRiski: "0", mevcutRisk: "0", limit: null, kalanLimit: null, asim: false }, finansalOzet: { sonIslemTarihi: null, sonTahsilatTarihi: null, sonOdemeTarihi: null, vadesiGecmisBakiye: "0" } };
const faturalar = [
  { id: f1, cari: { id: cariId }, tip: "satis", durum: "kesin", no: "SAT-001", dovizCinsi: "TRY", odemeOzeti: { kalan: "600.00" } },
  { id: f2, cari: { id: cariId }, tip: "satis", durum: "kesin", no: "SAT-002", dovizCinsi: "USD", odemeOzeti: { kalan: "2000.00" } },
  { id: "55555555-5555-4555-8555-555555555555", cari: { id: cariId }, tip: "satis", durum: "kesin", no: "KAPALI-01", dovizCinsi: "TRY", odemeOzeti: { kalan: "0.00" } },
];
type State = { sozler: ReturnType<typeof soz>[]; mod: string; okumalar: number; yazilar: { yol: string; govde: Record<string, any>; anahtar: string | undefined }[] };
async function kur(page: Page, rol = "muhasebe", ozel?: (r: Route, u: URL, state: State) => Promise<boolean>) {
  const state: State = { sozler: [soz()], mod: "pilot", okumalar: 0, yazilar: [] };
  page.on("pageerror", (e) => { throw e; });
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async (r) => {
    const u = new URL(r.request().url()), yol = u.pathname.replace("/api/v1", "");
    expect(u.origin).toBe("http://127.0.0.1:3105");
    const post = r.request().method() !== "GET";
    if (post) {
      expect(yol.startsWith("/cari/odeme-sozleri")).toBe(true);
      state.yazilar.push({ yol, govde: r.request().postDataJSON(), anahtar: r.request().headers()["idempotency-key"] });
    }
    if (yol === "/cari/odeme-sozleri" && !post) state.okumalar++;
    if (ozel && await ozel(r, u, state)) return;
    if (post) {
      const g = r.request().postDataJSON();
      if (yol.endsWith("/iptal")) {
        const s = state.sozler.find((s) => yol.includes(s.id))!;
        Object.assign(s, { kayitDurumu: "iptal", surum: s.surum + 1, sonlandirmaNedeni: g.gerekce, gerceklesme: { sozId: s.id, durum: "iptal", gerceklesen: "0.00", kalan: s.tutar } });
        await r.fulfill({ json: s }); return;
      }
      let eski: ReturnType<typeof soz> | undefined;
      if (yol.endsWith("/revize")) {
        eski = state.sozler.find((s) => yol.includes(s.id))!;
        Object.assign(eski, { kayitDurumu: "revize", surum: eski.surum + 1, sonlandirmaNedeni: g.gerekce, gerceklesme: { sozId: eski.id, durum: "revize", gerceklesen: "0.00", kalan: eski.tutar } });
      }
      const id = "66666666-6666-4666-8666-666666666666";
      const yeni = { ...soz(), id, faturaId: eski?.faturaId ?? g.faturaId, faturaNo: eski?.faturaNo ?? "SAT-002", dovizCinsi: eski?.dovizCinsi ?? g.dovizCinsi, tutar: g.tutar, sozTarihi: g.sozTarihi, aciklama: g.aciklama, oncekiSozId: eski?.id ?? null, gerceklesme: { sozId: id, durum: "aktif", gerceklesen: "0.00", kalan: g.tutar } };
      state.sozler.push(yeni); await r.fulfill({ json: yeni }); return;
    }
    let json: unknown = {};
    if (yol === "/auth/ben") json = { rol, userId: "u1", tenantId: "t1" };
    else if (yol === "/cari/odeme-sozleri") {
      expect(u.searchParams.get("cariId")).toBe(cariId);
      json = { cari: { id: cariId, unvan: cari.unvan }, kullanimModu: state.mod, alindigiZaman: "2026-10-15T12:00:00.000Z", zamanHassasiyeti: "gun", uyari: "Aynı gün verilen söz ve ödemenin sırası kanıtlanamaz; bu tahsilatlar otomatik gerçekleşme sayılmaz.", sozler: state.sozler };
    } else if (yol === "/fatura") {
      expect(u.searchParams.get("cariId")).toBe(cariId); expect(u.searchParams.get("tip")).toBe("satis"); expect(u.searchParams.get("durum")).toBe("kesin");
      json = { kayitlar: faturalar, sonrakiImlec: null };
    } else if (yol === `/cari/${cariId}`) json = cari;
    else if (yol === "/cari") json = { kayitlar: [cari], sonrakiImlec: null };
    else if (yol.endsWith("/crm")) json = { etkilesimler: [], gorevler: [], teklifler: [], kullanicilar: [] };
    else if (yol.endsWith("/davranis-analizi")) { await r.fulfill({ status: 403, json: { message: "Testte analiz kapalı" } }); return; }
    else if (yol.endsWith("/ekstre")) json = { cari, satirlar: [], dovizOzet: [] };
    else if (yol.endsWith("/teminatlar")) json = { satirlar: [], gecerliToplamTry: "0" };
    else if (["/cari/etiketler", "/cari/gruplar", "/fiyat-listeleri", "/ai/onay-talepleri"].includes(yol)) json = [];
    else if (yol === "/ebelge/uygulamalar") json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    await r.fulfill({ json });
  });
  return state;
}
async function ac(page: Page) { await page.goto(`/panel/cari/${cariId}`); await page.getByRole("tab", { name: "Tahsilat", exact: true }).click(); return page.getByRole("region", { name: "Ödeme sözleri", exact: true }); }
async function yeniDoldur(page: Page) {
  await page.getByRole("button", { name: "Yeni ödeme sözü", exact: true }).click();
  const form = page.getByRole("region", { name: "Ödeme sözü işlemi" });
  await form.getByLabel("Satış faturası").selectOption(f2);
  await form.getByLabel("Söz tutarı").fill("1250,50"); await form.getByLabel("Söz tarihi").fill("2035-01-21");
  await form.getByLabel("Söz açıklaması").fill("Müşteri telefon görüşmesinde taahhüt etti"); return form;
}

test("sekme isteğe bağlı yüklenir; güncel gerçekleşme ve tarih uyarısı gösterilir", async ({ page }) => {
  const state = await kur(page); await page.goto(`/panel/cari/${cariId}`);
  await expect(page.getByRole("tab", { name: "Tahsilat", exact: true })).toBeVisible(); expect(state.okumalar).toBe(0);
  await page.getByRole("tab", { name: "Tahsilat", exact: true }).click();
  const panel = page.getByRole("region", { name: "Ödeme sözleri", exact: true });
  await expect(panel.getByText("400,00 TRY", { exact: true })).toBeVisible(); await expect(panel.getByText("600,00 TRY", { exact: true })).toBeVisible();
  await expect(panel.getByText("Aynı gün verilen söz", { exact: false })).toBeVisible();
  await expect(panel.getByRole("link", { name: "SAT-001" })).toHaveAttribute("href", `/panel/fatura?fatura=${f1}`); expect(state.yazilar).toEqual([]);
});
test("yeni söz doğru cari/fatura/döviz ve aynı tekrar anahtarıyla yazılır; geçmiş yenilenir", async ({ page }) => {
  const state = await kur(page); await ac(page); const form = await yeniDoldur(page);
  await expect(form.getByLabel("Satış faturası").getByRole("option", { name: /SAT-001|KAPALI-01/ })).toHaveCount(0);
  await form.getByRole("button", { name: "Sözü kaydet", exact: true }).click();
  await expect(page.getByRole("table", { name: "Ödeme sözü geçmişi" }).getByText("1.250,50 USD", { exact: true })).toHaveCount(2);
  expect(state.yazilar).toHaveLength(1); const w = state.yazilar[0];
  expect(w.govde).toMatchObject({ cariId, faturaId: f2, dovizCinsi: "USD", tutar: "1250.50", sozTarihi: "2035-01-21" });
  expect(w.anahtar).toBe(w.govde.istekAnahtari); expect(w.govde).not.toHaveProperty("tenantId");
  expect(state.okumalar).toBe(2);
});
test("revizyon gerekçesi ve beklenen sürüm gönderilir, eski söz korunur", async ({ page }) => {
  const state = await kur(page); await ac(page); await page.getByRole("button", { name: "Revize et", exact: true }).click();
  const form = page.getByRole("region", { name: "Ödeme sözü işlemi" });
  await form.getByLabel("Söz tutarı").fill("900,25"); await form.getByLabel("Revizyon gerekçesi").fill("Müşteri yeni tutar bildirdi");
  await form.getByRole("button", { name: "Revizyonu kaydet", exact: true }).click();
  await expect(page.getByText("Revize edildi", { exact: true })).toBeVisible();
  expect(state.yazilar[0].govde).toMatchObject({ tutar: "900.25", beklenenSurum: 1, gerekce: "Müşteri yeni tutar bildirdi" });
  expect(state.yazilar[0].yol).toBe(`/cari/odeme-sozleri/${s1}/revize`);
});
test("iptal açık onay ve gerekçe ister; fatura işlemi göndermez", async ({ page }) => {
  const state = await kur(page); await ac(page); await page.getByRole("button", { name: "Sözü iptal et", exact: true }).click();
  const form = page.getByRole("region", { name: "Ödeme sözü işlemi" });
  await form.getByLabel("İptal gerekçesi").fill("Müşteri sözünü geri çekti"); await form.getByRole("button", { name: "İptali onayla" }).click();
  await expect(page.getByText("İptal edildi", { exact: true })).toBeVisible();
  expect(state.yazilar).toHaveLength(1); expect(state.yazilar[0].govde).toEqual({ beklenenSurum: 1, gerekce: "Müşteri sözünü geri çekti" });
  await expect(page.getByRole("button", { name: "Revize et" })).toHaveCount(0);
});
for (const rol of ["salt_okunur", "mali_musavir"]) test(`${rol} geçmişi görür, yazma formu açamaz`, async ({ page }) => {
  const state = await kur(page, rol); const panel = await ac(page);
  await expect(panel.getByRole("table")).toBeVisible(); await expect(panel.getByRole("button", { name: "Yeni ödeme sözü" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Revize et" })).toHaveCount(0); expect(state.yazilar).toEqual([]);
});
test("salt okunur şirket modunda yönetici de yazamaz", async ({ page }) => {
  const state = await kur(page, "yonetici"); state.mod = "salt_okunur"; const panel = await ac(page);
  await expect(panel.getByRole("table")).toBeVisible(); await expect(panel.getByRole("button", { name: "Yeni ödeme sözü" })).toHaveCount(0);
});
test("satış rolünde tahsilat sekmesi ve finans isteği yok", async ({ page }) => {
  const state = await kur(page, "satis"); await page.goto(`/panel/cari/${cariId}`);
  await expect(page.getByRole("tab", { name: "CRM", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tahsilat", exact: true })).toHaveCount(0); expect(state.okumalar).toBe(0);
});
test("kapalı mod veya kaynak hatası boş geçmiş olarak sunulmaz", async ({ page }) => {
  await kur(page, "muhasebe", async (r, u) => {
    if (!u.pathname.endsWith("/odeme-sozleri")) return false;
    await r.fulfill({ status: 403, json: { message: "Tahsilat operasyonu bu şirket için kapalı" } }); return true;
  });
  const panel = await ac(page); await expect(panel.getByText("Tahsilat operasyonu bu şirket için kapalı")).toBeVisible();
  await expect(panel.getByText("Henüz ödeme sözü yok.")).toHaveCount(0); await expect(panel.getByRole("button", { name: "Yeni ödeme sözü" })).toHaveCount(0);
});
test("409 taslağı korur ve otomatik tekrar göndermeyi engeller", async ({ page }) => {
  const state = await kur(page, "muhasebe", async (r) => {
    if (r.request().method() !== "POST") return false;
    await r.fulfill({ status: 409, json: { message: "Ödeme sözü değişmiş; güncel kaydı okuyun" } }); return true;
  });
  await ac(page); await page.getByRole("button", { name: "Revize et", exact: true }).click();
  const form = page.getByRole("region", { name: "Ödeme sözü işlemi" });
  await form.getByLabel("Revizyon gerekçesi").fill("Taslak gerekçe korunmalı"); await form.getByRole("button", { name: "Revizyonu kaydet" }).click();
  await expect(form.getByLabel("Revizyon gerekçesi")).toHaveValue("Taslak gerekçe korunmalı"); await expect(form.getByRole("button", { name: "Revizyonu kaydet" })).toBeDisabled();
  await page.getByRole("button", { name: "Sözleri yenile" }).click(); await expect(form.getByRole("button", { name: "Revizyonu kaydet" })).toBeDisabled(); expect(state.yazilar).toHaveLength(1);
});
test("geçici hata sonrası aynı içerik aynı söz anahtarıyla yeniden denenir", async ({ page }) => {
  let deneme = 0;
  const state = await kur(page, "muhasebe", async (r) => {
    if (r.request().method() !== "POST" || deneme++ > 0) return false;
    await r.fulfill({ status: 503, json: { message: "Geçici bağlantı sorunu" } }); return true;
  });
  await ac(page); const form = await yeniDoldur(page); await form.getByRole("button", { name: "Sözü kaydet", exact: true }).click();
  await expect(form.getByText("Geçici bağlantı sorunu")).toBeVisible(); await expect(form.getByLabel("Söz tutarı")).toHaveValue("1250,50");
  await form.getByRole("button", { name: "Sözü kaydet", exact: true }).click(); await expect(form).toHaveCount(0);
  expect(state.yazilar).toHaveLength(2); expect(state.yazilar[0].govde.istekAnahtari).toBe(state.yazilar[1].govde.istekAnahtari);
});
test("yanlış cari yanıtı ve tutarsız tutarlar finans tablosuna taşınmaz", async ({ page }) => {
  await kur(page, "muhasebe", async (r, u) => {
    if (!u.pathname.endsWith("/odeme-sozleri")) return false;
    await r.fulfill({ json: { cari: { id: f1, unvan: "Başka cari" }, sozler: [soz()], kullanimModu: "pilot" } }); return true;
  });
  const panel = await ac(page); await expect(panel.getByText("Ödeme sözü yanıtının kapsamı", { exact: false })).toBeVisible(); await expect(panel.getByRole("table")).toHaveCount(0);
});
test("fatura seçim hatası boş liste değildir; taslak korunur", async ({ page }) => {
  await kur(page, "muhasebe", async (r, u) => {
    if (!u.pathname.endsWith("/fatura")) return false;
    await r.fulfill({ status: 503, json: { message: "Faturalar okunamadı" } }); return true;
  });
  await ac(page); await page.getByRole("button", { name: "Yeni ödeme sözü", exact: true }).click();
  const form = page.getByRole("region", { name: "Ödeme sözü işlemi" });
  await form.getByLabel("Söz açıklaması").fill("Taslak duruyor"); await expect(form.getByText("Faturalar okunamadı")).toBeVisible();
  await expect(form.getByRole("button", { name: "Sözü kaydet", exact: true })).toBeDisabled(); await expect(form.getByLabel("Söz açıklaması")).toHaveValue("Taslak duruyor");
});
test("fazla hassasiyet ve görüntülenen kalanı aşan tutar sunucuya gönderilmez", async ({ page }) => {
  const state = await kur(page); await ac(page); const form = await yeniDoldur(page);
  await form.getByLabel("Söz tutarı").fill("1.000"); await form.getByRole("button", { name: "Sözü kaydet", exact: true }).click();
  await expect(form.getByText("Tutarı binlik ayırıcı kullanmadan", { exact: false })).toBeVisible();
  await form.getByLabel("Söz tutarı").fill("2000,01"); await form.getByRole("button", { name: "Sözü kaydet", exact: true }).click();
  await expect(form.getByText("Söz tutarı faturanın görüntülenen kalanını aşamaz.", { exact: false })).toBeVisible(); expect(state.yazilar).toEqual([]);
});
test("bekleyen kayıtta tekrar gönderim ve formdan çıkış engellenir", async ({ page }) => {
  let birak!: () => void; const bekle = new Promise<void>((r) => { birak = r; });
  const state = await kur(page, "muhasebe", async (r) => { if (r.request().method() !== "POST") return false; await bekle; return false; });
  await ac(page); const form = await yeniDoldur(page);
  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/cari/odeme-sozleri"));
  await form.getByRole("button", { name: "Sözü kaydet", exact: true }).click(); await post;
  try {
    await expect(form.getByRole("button", { name: "Kaydediliyor…", exact: true })).toBeDisabled();
    await expect(form.getByRole("button", { name: "Vazgeç" })).toBeDisabled();
    await form.locator("form").dispatchEvent("submit"); expect(state.yazilar).toHaveLength(1);
  } finally { birak(); }
  await expect(form).toHaveCount(0);
});
test("ilk fatura sayfasında uygun kayıt yoksa sonraki sayfa seçilebilir", async ({ page }) => {
  await kur(page, "muhasebe", async (r, u) => {
    if (!u.pathname.endsWith("/fatura")) return false;
    await r.fulfill({ json: u.searchParams.has("imlec") ? { kayitlar: [faturalar[1]], sonrakiImlec: null } : { kayitlar: [faturalar[0]], sonrakiImlec: f1 } }); return true;
  });
  await ac(page); await page.getByRole("button", { name: "Yeni ödeme sözü", exact: true }).click();
  const form = page.getByRole("region", { name: "Ödeme sözü işlemi" });
  await expect(form.getByText("Yüklenen sayfalarda", { exact: false })).toBeVisible(); await form.getByRole("button", { name: "Daha fazla fatura" }).click();
  await form.getByLabel("Satış faturası").selectOption(f2); await expect(form.getByText("Fatura dövizi: USD", { exact: false })).toBeVisible();
});
