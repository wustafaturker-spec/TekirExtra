import { expect, test, type Route } from "@playwright/test";

const bugun = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
const ekle = (g: string, n: number) => new Date(Date.parse(`${g}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const id = "00000000-0000-4000-8000-000000000301";
function rapor(url: string, eksik = false) {
  const p = new URL(url).searchParams;
  const baslangic = p.get("baslangic") ?? ekle(bugun, -6), bitis = p.get("bitis") ?? bugun;
  const adet = Math.round((Date.parse(bitis) - Date.parse(baslangic)) / 86400000) + 1;
  const kurumsal = p.get("plan") === "kurumsal";
  const donem = { etkinFirma: kurumsal ? 0 : 2, etkinKullanici: kurumsal ? 0 : 3, giris: kurumsal ? 0 : 4, islem: kurumsal ? 0 : 6 };
  const buyumeDonemi = {
    tam: !eksik, baslangicFirma: eksik ? null : kurumsal ? 0 : 10, bitisFirma: eksik ? null : kurumsal ? 0 : 12,
    yeniFirma: eksik ? null : kurumsal ? 0 : 3, silinenFirma: eksik ? null : kurumsal ? 0 : 1,
    netDegisim: eksik ? null : kurumsal ? 0 : 2, iptalFirma: eksik ? null : kurumsal ? 0 : 1,
    deneme: { baslayan: eksik ? null : kurumsal ? 0 : 6, olgunlasan: eksik ? null : kurumsal ? 0 : 4, donusen: eksik ? null : kurumsal ? 0 : 2, bekleyen: eksik ? null : kurumsal ? 0 : 2, oran: eksik || kurumsal ? null : 50 },
  };
  const baslamaDurum = p.get("baslamaDurum") ?? "baslamayan";
  const operasyon = p.get("operasyon") ?? "hepsi";
  const adetler = { gorev: 2, fatura: 3, iade: 2 };
  const secilen = operasyon === "hepsi" ? adetler : { gorev: operasyon === "gorev" ? 2 : 0, fatura: operasyon === "fatura" ? 3 : 0, iade: operasyon === "iade" ? 2 : 0 };
  const opsToplam = secilen.gorev + secilen.fatura + secilen.iade;
  const gecmisGun = p.get("operasyonGun") ?? bitis;
  const gecmisSayfa = Number(p.get("operasyonGecmisSayfa") ?? 1);
  const sayilar = { firma: kurumsal ? 0 : 2, aktif: kurumsal ? 0 : 1, deneme: kurumsal ? 0 : 1, askida: 0, iptal: 0, geciken: 0, yaklasan: 0, baglantiHatali: 0,
    gorev: kurumsal ? 0 : 2, fatura: kurumsal ? 0 : 3, iade: kurumsal ? 0 : 2, hatali: kurumsal ? 0 : 2, toplam: kurumsal ? 0 : 7 };
  return {
    operasyonGecmisi: {
      olcumBaslangici: eksik ? null : baslangic, oncekiBitis: ekle(baslangic, -1), donemSonu: eksik ? null : sayilar, oncekiDonemSonu: eksik ? null : { ...sayilar, toplam: 5 },
      gunler: Array.from({ length: adet }, (_, n) => ({ gun: ekle(baslangic, n), hazir: !eksik, gecici: ekle(baslangic, n) === bugun, gozlemAt: eksik ? null : `${ekle(baslangic, n)}T12:00:00Z`, sayilar: eksik ? null : sayilar })),
      detay: { gun: gecmisGun, hazir: !eksik, gozlemAt: eksik ? null : `${gecmisGun}T12:00:00Z`, sayilar: eksik ? null : sayilar,
        toplam: eksik ? null : kurumsal ? 0 : 2, sayfa: gecmisSayfa, sayfaBoyutu: 25,
        kayitlar: eksik || kurumsal || gecmisSayfa > 1 ? [] : [
          { tenantId: id, unvan: "Tarihsel Test Firması", planKodu: "baslangic", durum: "aktif", geciken: false, yaklasan: false, baglantiHatali: false, gorev: 2, fatura: 3, iade: 2, hatali: 2, toplam: 7 },
          { tenantId: id.replace(/301$/, "399"), unvan: null, planKodu: "baslangic", durum: "deneme", geciken: false, yaklasan: false, baglantiHatali: false, gorev: 0, fatura: 0, iade: 0, hatali: 0, toplam: 0 },
        ] },
    },
    aralik: { baslangic, bitis, oncekiBaslangic: ekle(baslangic, -adet), oncekiBitis: ekle(baslangic, -1) },
    olcum: { baslangic: eksik ? bitis : ekle(baslangic, -adet), gunSayisi: adet, olculenGun: eksik ? 1 : adet, eksikGunler: eksik ? [baslangic] : [], bugunDahil: bitis === bugun, sonGuncelleme: `${bitis}T10:00:00Z` },
    donem: eksik ? { etkinFirma: null, etkinKullanici: null, giris: null, islem: null } : donem,
    onceki: { etkinFirma: 1, etkinKullanici: 2, giris: 2, islem: 3 },
    gunler: Array.from({ length: adet }, (_, n) => ({ gun: ekle(baslangic, n), etkinFirma: eksik && n === 0 ? null : 2, etkinKullanici: 3, giris: 4, islem: 6 })),
    moduller: [{ kod: "fatura", adet: 4 }, { kod: "cari", adet: 2 }],
    buyume: { olcumBaslangici: `${ekle(baslangic, -60)}T10:00:00Z`, hesaplandiAt: `${bugun}T10:00:00Z`, pencereGun: 14, donem: buyumeDonemi, onceki: buyumeDonemi },
    baslama: { kesimGunu: bitis === bugun ? ekle(bugun, -1) : bitis, hazir: !eksik, olcumBaslangici: ekle(baslangic, -60), sonUretim: `${bitis}T10:00:00Z`,
      sayilar: { baslamayan: eksik ? null : kurumsal ? 0 : 1, baslayan: eksik ? null : 1, belirsiz: eksik ? null : 1 }, durum: baslamaDurum, sayfa: Number(p.get("baslamaSayfa") ?? 1), sayfaBoyutu: 25, toplam: eksik ? null : kurumsal ? 0 : 1,
      kayitlar: eksik || kurumsal ? [] : [{ tenantId: id.replace(/301$/, "302"), unvan: "Başlama Test Firması", planKodu: "baslangic", kayitGunu: ekle(bitis, -5), sonEtkinGun: baslamaDurum === "baslayan" ? bitis : null }] },
    operasyon: { zaman: `${bugun}T10:00:00Z`, tur: operasyon, sayfa: Number(p.get("operasyonSayfa") ?? 1), sayfaBoyutu: 25,
      sayilar: { toplam: kurumsal ? 0 : 7, ...adetler, hatali: 2 }, filtreliIs: kurumsal ? 0 : opsToplam, firmaToplam: kurumsal ? 0 : 1,
      kayitlar: kurumsal ? [] : [{ tenantId: id.replace(/301$/, "303"), unvan: "Operasyon Test Firması", ...secilen, toplam: opsToplam, hatali: operasyon === "gorev" ? 0 : operasyon === "hepsi" ? 2 : 1 }] },
    odeme: { sayilar: { basarisiz: 507, sonuclanmadi: 1 } },
    guncel: { zaman: `${bitis}T10:00:00Z`, toplam: 2, aktif: 1, deneme: 1, askida: 0, iptal: 0, geciken: 1, talep: 0, yaklasan: 1, baglantiHatali: 1, basarisizOdeme7Gun: 2, planlar: [{ kod: "baslangic", adet: 1 }, { kod: "profesyonel", adet: 1 }] },
    firmalar: { kayitlar: kurumsal ? [] : [{ tenantId: id, unvan: "İstatistik Test Firması", etkinGun: 2, etkinKullanici: 3, giris: 4, islem: 6 }], toplam: kurumsal ? 0 : 1, sayfa: Number(p.get("sayfa") ?? 1), sayfaBoyutu: 25 },
  };
}
const yanit = (r: Route) => r.fulfill({ json: rapor(r.request().url()) });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("tekir_platform_access", "cerez"));
  await page.route("**/api/v1/platform/auth/ben", (r) => r.fulfill({ json: { eposta: "ekip@example.test", rol: "yonetici" } }));
  await page.route("**/api/v1/platform/istatistikler?*", yanit);
  await page.route("**/api/v1/platform/entegrasyon-talepleri", (r) => r.fulfill({ json: [
    { saglayici: "tsoft", ad: "T-Soft", firmaSayisi: 2, sonTalep: "2026-11-10T09:00:00Z" },
    { saglayici: "ideasoft", ad: "İdeaSoft", firmaSayisi: 5, sonTalep: "2026-11-12T09:00:00Z" },
  ] }));
});

test("dönem/paket filtreleri korunur, kart aynı kapsamın firma ayrıntısını açar", async ({ page }) => {
  await page.goto(`/platform/istatistikler?baslangic=${ekle(bugun, -8)}&bitis=${ekle(bugun, -2)}`);
  await expect(page.getByRole("heading", { name: "Firma istatistikleri", exact: true })).toBeVisible();
  const islem = page.getByRole("button", { name: /^Kayda geçen modül işlemi/ });
  await expect(islem.locator("strong")).toHaveText("6");
  await expect(islem).toContainText("+100%");
  await islem.click();
  await expect(page).toHaveURL(/olcut=islem/);
  await expect(page.getByLabel("Firma ayrıntı ölçütü")).toHaveValue("islem");
  await expect(page.getByRole("link", { name: "İstatistik Test Firması", exact: true })).toHaveAttribute("href", `/platform/firmalar/${id}`);
  await page.getByLabel("Paket", { exact: true }).selectOption("kurumsal");
  await expect(page).toHaveURL(/plan=kurumsal/);
  await expect(page.getByRole("button", { name: /^Etkin firma/ }).locator("strong")).toHaveText("0");
  await page.reload();
  await expect(page.getByLabel("Paket", { exact: true })).toHaveValue("kurumsal");
  await expect(page.getByLabel("Firma ayrıntı ölçütü")).toHaveValue("islem");
});

test("eksik ölçüm sıfır görünmez; anlık abonelik kartları ayrı kapsamda çalışır", async ({ page }) => {
  await page.route("**/api/v1/platform/istatistikler?*", (r) => r.fulfill({ json: rapor(r.request().url(), true) }));
  await page.goto("/platform/istatistikler?plan=baslangic");
  await expect(page.getByText(/Dönem toplamları bu nedenle gösterilmiyor/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Etkin firma/ }).locator("strong")).toHaveText("—");
  await expect(page.getByRole("button", { name: /Ölçüm eksik/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ödemesi geciken/ })).toHaveAttribute("href", /goster=askiyaAlinacak.*plan=baslangic/);
  await page.getByText("Günlük değerleri tablo halinde göster", { exact: true }).click();
  await expect(page.locator("details").filter({ has: page.getByText("Günlük değerleri tablo halinde göster", { exact: true }) }).getByRole("columnheader", { name: "Gün", exact: true })).toBeVisible();
});

test("geciken eski yanıt yeni paket filtresinin sonucunu değiştirmez", async ({ page }) => {
  let al!: (r: Route) => void;
  const ilk = new Promise<Route>((r) => { al = r; });
  await page.route("**/api/v1/platform/istatistikler?*", (r) => {
    if (!new URL(r.request().url()).searchParams.get("plan")) { al(r); return; }
    return yanit(r);
  });
  await page.goto("/platform/istatistikler");
  const eski = await ilk;
  await page.getByLabel("Paket", { exact: true }).selectOption("kurumsal");
  await expect(page.getByRole("button", { name: /^Etkin firma/ }).locator("strong")).toHaveText("0");
  await yanit(eski).catch(() => undefined);
  await expect(page.getByRole("button", { name: /^Etkin firma/ }).locator("strong")).toHaveText("0");
});

test("yeniden hesaplama ölçüm başlangıcına sınırlandırılır; bugün için yüzde üretilmez", async ({ page }) => {
  let govde: unknown;
  await page.route("**/api/v1/platform/istatistikler?*", (r) => r.fulfill({ json: rapor(r.request().url(), true) }));
  await page.route("**/api/v1/platform/istatistikler/yeniden-hesapla", async (r) => { govde = r.request().postDataJSON(); await r.fulfill({ json: { mesaj: "1 gün için istatistik hesaplama tamamlandı." } }); });
  await page.goto("/platform/istatistikler");
  await page.getByRole("button", { name: "Seçili günleri yeniden hesapla" }).click();
  await expect(page.getByText("1 gün için istatistik hesaplama tamamlandı.", { exact: true })).toBeVisible();
  expect(govde).toEqual({ baslangic: bugun, bitis: bugun });
  await page.unroute("**/api/v1/platform/istatistikler?*");
  await page.route("**/api/v1/platform/istatistikler?*", yanit);
  await page.getByRole("button", { name: "Bugün", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Etkin firma/ })).toContainText("Bugün devam ettiği için yüzde karşılaştırması yok");
});

test("grafik klavyeyle güne iner; mobil ekran taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform/istatistikler");
  const sutun = page.getByRole("button", { name: /2 etkin firma$/ }).first();
  await sutun.focus(); await sutun.press("Enter");
  const bas = await page.getByLabel("İstatistik başlangıcı").inputValue();
  await expect(page.getByLabel("İstatistik bitişi")).toHaveValue(bas);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/platform-istatistik-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/platform-istatistik-desktop.png", fullPage: true });
});

test("editör istatistik ekranını veya menü bağlantısını göremez", async ({ page }) => {
  let okundu = false;
  await page.route("**/api/v1/platform/auth/ben", (r) => r.fulfill({ json: { eposta: "editor@example.test", rol: "mevzuat_editoru" } }));
  await page.route("**/api/v1/platform/mevzuat/**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/v1/platform/istatistikler?*", (r) => { okundu = true; return yanit(r); });
  await page.goto("/platform/istatistikler");
  await expect(page.getByText("Mevzuat editörü", { exact: true })).toBeVisible();
  // next dev hedef sayfayı ilk kez yönlendirme sırasında derleyebilir.
  await expect(page).toHaveURL(/\/platform$/, { timeout: 15000 });
  await expect(page.getByRole("navigation", { name: "Platform menüsü" }).getByRole("link", { name: "Firma istatistikleri", exact: true })).toHaveCount(0);
  expect(okundu).toBe(false);
});

test("eşzamanlı hesaplama tamamlanmış gibi bildirilmez", async ({ page }) => {
  await page.route("**/api/v1/platform/istatistikler/yeniden-hesapla", (r) => r.fulfill({ json: { bekleyen: 1, tamamlanan: 0, mesaj: "0 gün tamamlandı; 1 gün için başka bir hesaplama sürüyor. Sonuçlar için sayfayı yenileyin." } }));
  await page.goto("/platform/istatistikler");
  await page.getByRole("button", { name: "Seçili günleri yeniden hesapla" }).click();
  await expect(page.getByText(/0 gün tamamlandı; 1 gün için başka bir hesaplama sürüyor/)).toBeVisible();
});

test("büyüme ayrı kaynaktan, deneme dönüşümü açık payda ve bekleyen sayısıyla gösterilir", async ({ page }) => {
  await page.goto(`/platform/istatistikler?baslangic=${ekle(bugun, -35)}&bitis=${ekle(bugun, -29)}`);
  const alan = page.getByRole("region", { name: "Büyüme ve deneme dönüşümü" });
  await expect(alan.getByText("Dönem başı firma", { exact: true }).locator("..").locator("strong")).toHaveText("10");
  await expect(alan.getByText("Net firma değişimi", { exact: true }).locator("..").locator("strong")).toHaveText("2");
  const secili = alan.getByRole("row").filter({ has: page.getByRole("cell", { name: "Seçili dönem", exact: true }) });
  await expect(secili.getByRole("cell")).toHaveText(["Seçili dönem", "6", "4", "2", "2", "%50"]);
  await expect(alan.getByText(/Oran = dönüşen \/ 14 günü tamamlayan firma/)).toBeVisible();
  await page.getByLabel("Paket", { exact: true }).selectOption("kurumsal");
  await expect(secili.getByRole("cell")).toHaveText(["Seçili dönem", "0", "0", "0", "0", "—"]);
  await expect(alan.getByText(/14 günlük gözlemi tamamlayan firma olmadığı/)).toBeVisible();
});

test("yaşam döngüsü başlangıcından önceki büyüme sıfır gibi gösterilmez", async ({ page }) => {
  await page.route("**/api/v1/platform/istatistikler?*", (r) => r.fulfill({ json: rapor(r.request().url(), true) }));
  await page.goto("/platform/istatistikler");
  const alan = page.getByRole("region", { name: "Büyüme ve deneme dönüşümü" });
  await expect(alan.getByText(/Büyüme ve dönüşüm değerleri sıfır yerine boş/)).toBeVisible();
  await expect(alan.getByText("Yeni firma", { exact: true }).locator("..").locator("strong")).toHaveText("—");
  const secili = alan.getByRole("row").filter({ has: page.getByRole("cell", { name: "Seçili dönem", exact: true }) });
  await expect(secili.getByRole("cell")).toHaveText(["Seçili dönem", "—", "—", "—", "—", "—"]);
});

test("başlama sınıfı URL'de kalır; kart kendi firma listesini süzer, paket değişimi sayfayı sıfırlar", async ({ page }) => {
  await page.goto("/platform/istatistikler?baslamaSayfa=2&operasyonSayfa=2");
  const alan = page.getByRole("region", { name: "Kullanıma başlama takibi" });
  await alan.getByRole("button", { name: /^Geçmişi yetersiz firma/ }).click();
  await expect(page).toHaveURL(/baslamaDurum=belirsiz/);
  expect(new URL(page.url()).searchParams.has("baslamaSayfa")).toBe(false);
  expect(new URL(page.url()).searchParams.get("operasyonSayfa")).toBe("2");
  await expect(alan.getByLabel("Kullanıma başlama durumu")).toHaveValue("belirsiz");
  await expect(alan.getByRole("link", { name: "Başlama Test Firması", exact: true })).toHaveAttribute("href", /\/platform\/firmalar\/.*302$/);
  await page.reload();
  await expect(alan.getByLabel("Kullanıma başlama durumu")).toHaveValue("belirsiz");
  await page.getByLabel("Paket", { exact: true }).selectOption("kurumsal");
  await expect(alan.getByText("Bu sınıfta firma yok.", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("operasyonSayfa")).toBe(false);
});

test("başlama için bilinmeyen geçmiş sıfır değildir; bekleyen iş türleri ve işlem bağlantıları tutarlıdır", async ({ page }) => {
  await page.route("**/api/v1/platform/istatistikler?*", (r) => r.fulfill({ json: rapor(r.request().url(), true) }));
  await page.goto("/platform/istatistikler");
  const baslama = page.getByRole("region", { name: "Kullanıma başlama takibi" });
  await expect(baslama.getByRole("button", { name: /^Etkinlik kaydı olmayan yeni firma/ }).locator("strong")).toHaveText("—");
  await expect(baslama.getByRole("button", { name: /^Etkinlik kaydı olmayan yeni firma/ })).toBeDisabled();
  await expect(baslama.getByText(/^0 firma · Sayfa/)).toHaveCount(0);
  const isler = page.getByRole("region", { name: "Bekleyen operasyon işleri" });
  await isler.getByRole("button", { name: /^Abonelik faturası işlemleri/ }).click();
  await expect(page).toHaveURL(/operasyon=fatura/);
  await expect(isler.getByLabel("Bekleyen iş türü")).toHaveValue("fatura");
  await expect(isler.getByText(/Seçili türde 3 iş · 1 firma/)).toBeVisible();
  await expect(isler.getByRole("link", { name: "Firma işlemleri", exact: true })).toHaveAttribute("href", /\/platform\/firmalar\/.*303$/);
  await expect(isler.getByRole("link", { name: "Görevleri aç", exact: true })).toHaveCount(0);
  await isler.getByRole("button", { name: /^Açık firma görevleri/ }).click();
  await expect(isler.getByText(/Seçili türde 2 iş · 1 firma/)).toBeVisible();
  await expect(isler.getByRole("link", { name: "Görevleri aç", exact: true })).toHaveAttribute("href", /\/platform\/gorevler\?firma=.*303$/);
});


test("ödeme ayrıntısı tarih, paket, firma ve başarısız durumunu taşır", async ({ page }) => {
  await page.goto(`/platform/istatistikler?baslangic=${ekle(bugun, -8)}&bitis=${ekle(bugun, -2)}&plan=profesyonel&firma=${id}`);
  const link = page.getByRole("link", { name: "Sorunlu tahsilat raporunu aç" });
  await expect(link).toBeVisible();
  const hedef = new URL((await link.getAttribute("href"))!, "http://localhost").searchParams;
  expect(Object.fromEntries(hedef)).toEqual({ sekme: "sorunlu", baslangic: ekle(bugun, -8), bitis: ekle(bugun, -2), plan: "profesyonel", firma: id, durum: "basarisiz" });
  await expect(page.getByText(/Seçili dönemde başarısız ödeme denemesi/)).toContainText("507");
});


test("tarihsel operasyon günü ve sayfası bağımsızdır; genel filtreler sıfırlar", async ({ page }) => {
  const bas = ekle(bugun, -5), bit = ekle(bugun, -1);
  await page.goto(`/platform/istatistikler?baslangic=${bas}&bitis=${bit}&operasyonGecmisSayfa=2&operasyonSayfa=3&baslamaSayfa=2`);
  const alan = page.getByRole("region", { name: "Tarihsel abonelik ve operasyon" });
  await expect(alan.getByText("Günlük operasyon eğilimi", { exact: true })).toBeVisible();
  await expect(alan.getByText("2 firma · Sayfa 2 / 1")).toBeVisible();
  await alan.getByRole("button", { name: "İlk sayfaya dön" }).click();
  await expect(alan.getByRole("link", { name: "Tarihsel Test Firması" })).toHaveAttribute("href", `/platform/firmalar/${id}`);
  const gunAdi = new Date(`${bas}T12:00:00Z`).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  await alan.getByRole("button", { name: gunAdi, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`operasyonGun=${bas}`));
  await expect(page).toHaveURL(/operasyonSayfa=3/); await expect(page).toHaveURL(/baslamaSayfa=2/);
  await expect(alan.getByRole("button", { name: gunAdi, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(alan.getByText("Arşiv firma", { exact: true })).toBeVisible();
  await expect(alan.getByRole("link", { name: "Arşiv firma" })).toHaveCount(0);
  await page.reload(); await expect(alan.getByRole("button", { name: gunAdi, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Paket", { exact: true }).selectOption("kurumsal");
  await expect(page).not.toHaveURL(/operasyonGun|operasyonGecmisSayfa|operasyonSayfa|baslamaSayfa/);
  await expect(alan.getByText("Bu gözlem kapsamında firma yok.")).toBeVisible();
});

test("tarihsel eksik gözlem sıfır veya canlı veriyle doldurulmaz", async ({ page }) => {
  await page.route("**/api/v1/platform/istatistikler?*", (r) => r.fulfill({ json: rapor(r.request().url(), true) }));
  await page.goto("/platform/istatistikler");
  const alan = page.getByRole("region", { name: "Tarihsel abonelik ve operasyon" });
  await expect(alan.getByText("Bu gün için geçerli gözlem yok.")).toBeVisible();
  await expect(alan.getByRole("status")).toContainText("Boş değerler sıfır anlamına gelmez");
  await expect(alan.getByText("Karşılaştırma için ölçüm eksik")).toHaveCount(13);
  await expect(alan.getByRole("button", { name: "Sonraki", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Bekleyen operasyon işleri" })).toContainText("7 iş");
});

test("entegrasyon talepleri platform başına firma sayısıyla, çoktan aza gösterilir (ETC-02)", async ({ page }) => {
  await page.goto("/platform/istatistikler");
  const kart = page.locator(".card", { has: page.getByText("Entegrasyon talepleri", { exact: true }) });
  await expect(kart.getByRole("row").nth(1)).toContainText("İdeaSoft");
  await expect(kart.getByRole("row").nth(1)).toContainText("5");
  await expect(kart.getByRole("row").nth(2)).toContainText("T-Soft");
});
