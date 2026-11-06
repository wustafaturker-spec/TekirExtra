import { expect, test, type Page } from "@playwright/test";

const id = "00000000-0000-4000-8000-000000000001";
async function kur(page: Page, cakisma = false, editor = false) {
  let d = { id, baslik: "Bakım duyurusu", icerik: "Planlı bakım yapılacak.", icerikHtml: "<p>Planlı bakım yapılacak.</p>", butonMetni: null, butonUrl: null, durum: "taslak", surum: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const yazmalar: string[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "test"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const yol = new URL(r.request().url()).pathname;
    if (yol.endsWith("/auth/ben")) return r.fulfill({ json: { eposta: "test@example.invalid", rol: editor ? "mevzuat_editoru" : "yonetici" } });
    if (yol.endsWith("/firmalar/sayfali") || yol.endsWith("/paketler")) return r.fulfill({ json: { kayitlar: [], toplam: 0, sayfa: 1, sayfaBoyutu: 25 } });
    const method = r.request().method();
    if (method === "POST" || method === "PATCH") {
      yazmalar.push(yol);
      const g = r.request().postDataJSON();
      if (yol.endsWith("/onizleme")) return r.fulfill({ json: { ...g, icerikHtml: "<p>Planlı bakım yapılacak.</p>" } });
      if (cakisma && method === "PATCH") return r.fulfill({ status: 409, json: { message: "Duyuru değişti. Taslağınızı koruyup güncel kaydı yükleyin." } });
      d = { ...d, ...g, surum: d.surum + 1, ...(yol.endsWith("/arsiv") ? { durum: "arsiv" } : {}) };
      return r.fulfill({ json: d });
    }
    if (yol.endsWith("/gecmis")) return r.fulfill({ json: [{ surum: d.surum, zaman: d.updatedAt, icerik: d }] });
    if (yol.endsWith(`/duyurular/${id}`)) return r.fulfill({ json: d });
    return r.fulfill({ json: { kayitlar: [d], toplam: 1, sayfa: 1, sayfaBoyutu: 25 } });
  });
  return yazmalar;
}
test("yeni taslak kaydolur ve kalıcı detay açılır", async ({ page }) => {
  await kur(page); await page.goto("/platform/duyurular/yeni");
  await page.getByLabel("Duyuru başlığı").fill("Yeni bakım duyurusu");
  await page.getByLabel("Biçimlendirilmiş içerik").fill("Gece bakım yapılacaktır.");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  // Dev sunucusu kalıcı detay rotasını ilk kez burada derler.
  await expect(page).toHaveURL(`/platform/duyurular/${id}`, { timeout: 30000 });
  await expect(page.getByLabel("Duyuru başlığı")).toHaveValue("Yeni bakım duyurusu");
});
test("önizleme, klavye ile kapatma, geçmiş ve arşiv onayı çalışır", async ({ page }) => {
  const yazmalar = await kur(page); await page.goto(`/platform/duyurular/${id}`);
  await page.getByRole("button", { name: "Önizle", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Planlı bakım yapılacak.");
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Değişiklik geçmişi" }).click();
  await expect(page.locator("summary")).toContainText("Sürüm 1");
  await page.getByRole("button", { name: "Arşivle", exact: true }).click();
  expect(yazmalar.some((y) => y.endsWith("/arsiv"))).toBe(false);
  await page.getByRole("button", { name: "Arşivlemeyi onayla" }).click();
  await expect(page.getByLabel("Duyuru başlığı")).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Duyuru arşivlendi." })).toBeVisible();
});
test("sürüm çakışmasında girilen içerik korunur", async ({ page }) => {
  await kur(page, true); await page.goto(`/platform/duyurular/${id}`);
  await page.getByLabel("Duyuru başlığı").fill("Benim taslağım");
  await page.getByRole("button", { name: "Taslağı kaydet" }).click();
  await expect(page.getByText("Duyuru değişti.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Duyuru başlığı")).toHaveValue("Benim taslağım");
  await expect(page.getByRole("button", { name: "Taslağı bırak ve güncel kaydı yükle" })).toBeVisible();
});
test("mevzuat editörünün menüsünde duyuru yönetimi görünmez", async ({ page }) => {
  await kur(page, false, true); await page.goto("/platform/duyurular");
  await expect(page).toHaveURL("/platform", { timeout: 30000 });
  await expect(page.getByRole("link", { name: "Duyurular", exact: true })).toHaveCount(0);
});

test("hedef ve Türkiye saatleri önizlenir; ayrı onay yayınlar ve durdurma ayrı onay ister", async ({ page }) => {
  test.setTimeout(120000);
  const yazmalar: { yol: string; veri: Record<string, unknown> }[] = [];
  const firmaId = "00000000-0000-4000-8000-000000000002";
  let d = { id, baslik:"Planlı duyuru",icerik:"Kullanım bilgisi",icerikHtml:"<p>Kullanım bilgisi</p>",butonMetni:null,butonUrl:null,durum:"taslak",surum:1,yayinSurumu:null as number|null,hedef:null,baslangic:null as string|null,bitis:null as string|null };
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access","cerez"));
  await page.route("**/api/v1/platform/**", async (r) => {
    const yol = new URL(r.request().url()).pathname, method = r.request().method();
    if (yol.endsWith("/auth/ben")) return r.fulfill({ json:{ eposta:"test@example.invalid",rol:"yonetici" } });
    if (yol.endsWith("/firmalar/sayfali")) return r.fulfill({ json:{ kayitlar:[{ tenantId:firmaId,unvan:"Deneme firması" }],toplam:1,sayfaBoyutu:25 } });
    if (yol.endsWith("/paketler")) return r.fulfill({ json:{ kayitlar:[],toplam:0 } });
    if (yol.endsWith("/rapor")) return r.fulfill({ json:{ zaman:new Date().toISOString(),hedefPolitikasi:"Yayın onayındaki alıcılar",firma:1,kullanici:1,gosterim:0,okudum:0,tiklama:0,firmalar:[{tenantId:firmaId,hedef:1,gosterim:0,okudum:0,tiklama:0}] } });
    if (method === "POST") {
      const veri = r.request().postDataJSON(); yazmalar.push({yol,veri});
      if (yol.endsWith("/hedef-onizle")) return r.fulfill({ json:{ id, firmaSayisi:1,kullaniciSayisi:1,baslangic:veri.baslangic,bitis:veri.bitis,sonOnayAt:"2099-01-01T12:00:00Z" } });
      if (yol.endsWith("/yayinla")) d = { ...d,durum:"yayinlandi",surum:2,yayinSurumu:2,baslangic:"2099-01-01T07:00:00Z",bitis:"2099-01-02T07:00:00Z" };
      if (yol.endsWith("/durdur")) d = { ...d,durum:"durduruldu",surum:3 };
      return r.fulfill({json:d});
    }
    return r.fulfill({json:d});
  });
  await page.goto(`/platform/duyurular/${id}`);
  await page.getByRole("navigation", { name: "Duyuru bölümleri" }).getByRole("link", { name: "Hedef kitle", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${id}#duyuru-hedef-kitle$`));
  await page.getByLabel("Firma kapsamı").selectOption("secili");
  await page.getByLabel("Dahil et: Deneme firması").check();
  await page.getByLabel("Yayın başlangıcı",{exact:true}).selectOption("planli");
  await page.getByLabel("Başlangıç (Türkiye)",{exact:true}).fill("2099-01-01T10:00");
  await page.getByLabel("Bitiş (Türkiye)",{exact:true}).fill("2099-01-02T10:00");
  await page.getByRole("checkbox", { name: "Modül içinde kart", exact: true }).check();
  await expect(page.getByRole("button", { name: "Hedefi ve yayını önizle" })).toBeDisabled();
  await expect(page.getByText("Modül kartının gösterileceği en az bir modül seçin.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Finans", exact: true }).check();
  await expect(page.getByRole("button", { name: "Hedefi ve yayını önizle" })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Modül içinde kart", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Modül içinde kart", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Finans", exact: true })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Modül içinde kart", exact: true }).uncheck();
  // Enter, tarih alanları doluyken de yayın önizlemesi yerine firma araması yapar.
  await page.getByLabel("Firma ara", { exact: true }).fill("Deneme");
  await Promise.all([
    page.waitForRequest((r) => new URL(r.url()).pathname.endsWith("/firmalar/sayfali") && new URL(r.url()).searchParams.get("arama") === "Deneme"),
    page.getByLabel("Firma ara", { exact: true }).press("Enter"),
  ]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(yazmalar).toHaveLength(0);
  await expect(page.getByLabel("Hariç tut: Deneme firması")).toBeDisabled();
  await page.getByRole("button", { name: "Deneme firması firmasını dahil listesinden kaldır" }).click();
  await expect(page.getByLabel("Dahil et: Deneme firması")).not.toBeChecked();
  await expect(page.getByLabel("Hariç tut: Deneme firması")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Hedefi ve yayını önizle" })).toBeDisabled();
  await page.getByLabel("Dahil et: Deneme firması").check();
  await expect(page.getByRole("complementary", { name: "Seçim özeti" })).toContainText("1 seçili firma");
  await page.getByRole("button",{name:"Hedefi ve yayını önizle"}).click();
  await expect(page.getByRole("dialog")).toContainText("1 firma · 1 kullanıcı");
  expect(yazmalar).toHaveLength(1);
  expect(yazmalar[0].veri).toMatchObject({surum:1,hedef:{kapsam:"secili",firmaIds:[firmaId],roller:["yonetici"],yeniUygunlar:"katilmaz",gosterimYerleri:["merkez"],modulYollari:[],tekrarPolitikasi:"her_zaman",popupOnceligi:50,popupTuru:"normal",ertelemeDakika:1440},baslangic:"2099-01-01T07:00:00.000Z",bitis:"2099-01-02T07:00:00.000Z"});
  await page.getByRole("button",{name:"Duyuru yayınını onayla"}).click();
  await expect(page.getByLabel("Duyuru başlığı")).toBeDisabled();
  await expect(page.getByText("Planlı",{exact:true})).toBeVisible();
  await page.getByRole("navigation", { name: "Duyuru bölümleri" }).getByRole("link", { name: "Rapor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${id}#duyuru-rapor$`));
  await expect(page.getByRole("table", { name: "Duyuru etkileşimlerinin firma bazında dağılımı" })).toContainText("Firma detayını aç");
  await page.getByRole("button",{name:"Yayını durdur",exact:true}).click();
  expect(yazmalar).toHaveLength(2);
  await page.getByRole("button",{name:"Durdurmayı onayla"}).click();
  await expect(page.getByText("Durduruldu",{exact:true})).toBeVisible();
  expect(yazmalar[2].veri).toEqual({surum:2});
});

test("tenant duyuru merkezinde gösterim okuma sayılmaz; okudum kaydı yenilemede korunur", async ({ page }) => {
  test.setTimeout(120000);
  let okundu = false;
  let yayinda = true;
  const olaylar: string[] = [];
  await page.addInitScript(() => sessionStorage.setItem("tekir_access","cerez"));
  await page.route("**/api/v1/**", async (r) => {
    const u = new URL(r.request().url()),yol = u.pathname;
    if (yol.endsWith("/auth/ben")) return r.fulfill({json:{userId:"u1",tenantId:"t1",rol:"muhasebe"}});
    if (yol.endsWith("/bildirimler/ozet")) return r.fulfill({json:{okunmamis:0,acik:0,kritik:0}});
    if (yol.endsWith("/bildirimler")) return r.fulfill({json:{kayitlar:[]}});
    if (yol.endsWith("/olay")) { const g = r.request().postDataJSON();olaylar.push(g.tur); if (g.tur === "okudum") okundu=true;return r.fulfill({json:{kaydedildi:true}}); }
    if (yol.endsWith("/duyurular")) return r.fulfill({json:{kayitlar:!yayinda || u.searchParams.get("gecmis")==="true"?[]:[{id,baslik:"Firma duyurusu",icerik:"Size özel bilgilendirme",butonMetni:null,butonUrl:null,surum:2,baslangic:"2026-01-01T00:00:00Z",bitis:"2099-01-01T00:00:00Z",okundu}],toplam:yayinda?1:0,sayfa:1,sayfaBoyutu:25}});
    return r.fulfill({json:{}});
  });
  await page.goto("/panel/duyurular");
  await expect(page.getByRole("heading",{name:"Firma duyurusu"})).toBeVisible({timeout:30000});
  await expect.poll(() => olaylar.includes("gosterim")).toBe(true);
  expect(olaylar.includes("okudum")).toBe(false);
  await page.getByRole("button",{name:"Okudum",exact:true}).click();
  await expect(page.getByText("Okundu",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText("Okundu",{exact:true})).toBeVisible();
  yayinda = false;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading",{name:"Firma duyurusu"})).toHaveCount(0);
  await expect(page.getByText("Bu görünümde duyuru yok.")).toBeVisible();
  await page.getByRole("button", { name: "Süresi biten duyurular", exact: true }).click();
  await expect(page.getByRole("button", { name: "Süresi biten duyurular", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Bu görünümde duyuru yok.")).toBeVisible();
  await page.getByRole("button", { name: "Geçerli duyurulara dön", exact: true }).click();
  await expect(page.getByRole("button", { name: "Geçerli duyurular", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Bu görünümde duyuru yok.")).toBeVisible();
});
