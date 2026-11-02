import { expect, test, type Page, type Route } from "@playwright/test";

const stokId = "11111111-1111-4111-8111-111111111111";
const satirlar = [
  { id: "s1", faturaId: "f1", faturaNo: "SAT-001", tarih: "2026-10-01", cariUnvan: "Test cari", stokId, kod: "U1", ad: "Test ürün", miktar: "1", ciro: "100.10", maliyet: "0.00", neden: "hareket_yok", guncelStokEksi: true },
  { id: "s2", faturaId: "f2", faturaNo: "SAT-002", tarih: "2026-10-15", cariUnvan: "Test cari", stokId, kod: "U1", ad: "Test ürün", miktar: "1", ciro: "40.00", maliyet: "0.00", neden: "sifir_maliyet", guncelStokEksi: true },
];
const veri = (rol: string, neden = "hepsi") => ({
  baslangic: "2026-10-01", bitis: "2026-10-15", donemOzeti: { satir: 2, ciro: "140.10" },
  filtreOzeti: neden === "hepsi" ? { satir: 2, ciro: "140.10" } : { satir: 1, ciro: "100.10" },
  sayfa: 1, sayfaBoyutu: 50, toplamSayfa: 1, satirlar: neden === "hepsi" ? satirlar : satirlar.slice(0, 1),
  izinler: { fatura: rol !== "maliyet_muhasebesi", stok: rol !== "mali_musavir", onizleme: rol === "yonetici", takipYazma: ["yonetici", "muhasebe"].includes(rol) },
});
const onizleme = { acikBaslangic: "2026-10-01", kartlar: [{ stokId, kod: "U1", ad: "Test ürün", mevcut: "-2", eskiOrtalama: "0", yeniOrtalama: "10", eskiDeger: "0", yeniDeger: "-20", degisenHareket: 1, uretimSarfiDegisen: 0, tanimsizBirimler: [] }], degisenHareket: 1, uretimSarfiDegisen: 0, eskiDeger: "0", yeniDeger: "-20", degerFarki: "-20" };
const donem = "baslangic=2026-10-01&bitis=2026-10-15";

const olcum = {
  surum: 1, olcumTuru: "anlik", firma: { id: "a1111111-1111-4111-8111-111111111111", unvan: "Test firma" }, baslangic: "2026-10-01", bitis: "2026-10-15", kullanimModu: "salt_okunur", alindigiZaman: "2026-10-15T09:00:00.000Z",
  kapsam: { malSatisSatiri: 10, takipliKaynakSatiri: 4, kaynakKimlikOzeti: "a".repeat(64) }, uyari: { satir: 2, ciro: "140.10", aktifTakipliSatir: 1, aktifTakipsizSatir: 1 },
  incelemeler: { toplam: 5, acik: 1, incelemede: 0, beklemede: 1, dogrulanmisKapanis: 2, digerKapanis: 1, yoksayildi: 0, medyanSureSaniye: "3600.000", sureOrnekSayisi: 2, sureDisiKayit: 0 },
};

async function kur(page: Page, rol: string, ozel?: (route: Route, url: URL) => Promise<boolean>) {
  await page.addInitScript(() => sessionStorage.setItem("tekir_access", "test-token"));
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()), yol = url.pathname;
    if (url.origin !== "http://127.0.0.1:3104") { await route.abort(); throw new Error("TEST_ORIGIN_DISI"); }
    if (ozel && await ozel(route, url)) return;
    let json: unknown = {};
    if (yol.endsWith("/auth/ben")) json = { userId: "u1", tenantId: "t1", rol };
    else if (yol.endsWith("/rapor/maliyet-eksikleri")) {
      expect(route.request().method()).toBe("GET");
      json = veri(rol, url.searchParams.get("neden") ?? "hepsi");
    } else if (yol.endsWith("/rapor/gelir-gider")) json = {
      baslangicTarihi: "2026-10-01", bitisTarihi: "2026-10-15",
      karZarar: { netSatis: 140.10, smm: 0, brutKar: 140.10, digerGelirler: 0, hizmetAlislari: 0, masraflar: 0, personel: 0, faaliyetGiderleri: 0, netKar: 140.10, maliyetsizSatis: { satir: 2, ciro: 140.10 } },
      ozet: { toplamGelir: "140.10", toplamGider: "0", netFark: "140.10", karMarjiYuzde: 100, satisHasilati: "140.10", faaliyetDisiGelirler: "0", mevcutStokDegeri: "0", alisMaliyeti: "0", masrafGiderleri: "0", personelGiderleri: "0" },
      uyarilar: ["2 mal satış satırının maliyeti kayıtlı değil"], gelirKategorileri: [], giderKategorileri: [], kalemler: [],
    };
    else if (yol.endsWith("/stok/maliyet/yeniden-hesapla")) throw new Error("BEKLENMEYEN_MALIYET_ISLEMI");
    else if (yol.endsWith("/ai/onay-talepleri")) json = [];
    else if (yol.endsWith("/ebelge/uygulamalar")) json = { efatura: { acik: false }, earsiv: { acik: false }, eirsaliye: { acik: false } };
    await route.fulfill({ json });
  });
}

test("kâr uyarısı yanıtın dönemini açar; muhasebe salt okunur listede filtreyi ve adresi korur", async ({ page }) => {
  const istekler: string[] = [];
  await kur(page, "muhasebe", async (_r, u) => { if (u.pathname.endsWith("/rapor/maliyet-eksikleri")) istekler.push(u.search); return false; });
  await page.goto(`/panel/raporlar/gelir-gider?${donem}`);
  const link = page.getByRole("link", { name: "Maliyeti kontrol edilecek 2 satış satırını incele" });
  await expect(link).toHaveAttribute("href", `/panel/raporlar/maliyet-eksikleri?${donem}`);
  // Ekrandaki giriş değişse de bağlantı gösterilen yanıtın dönemini taşır.
  await page.getByLabel("Bitiş Tarihi").fill("2026-10-16");
  await expect(link).toHaveAttribute("href", `/panel/raporlar/maliyet-eksikleri?${donem}`);
  await link.click();
  await expect(page.getByRole("heading", { name: "Satış maliyet kontrolü" })).toBeVisible();
  await expect(page.getByLabel("Başlangıç", { exact: true })).toHaveValue("2026-10-01");
  await expect(page.getByLabel("Bitiş", { exact: true })).toHaveValue("2026-10-15");
  await expect(page.getByRole("link", { name: "SAT-001" })).toHaveAttribute("href", "/panel/fatura?fatura=f1");
  await expect(page.getByRole("link", { name: "Maliyet önizlemesi" })).toHaveCount(0);
  expect(istekler[0]).toContain(donem);
  await page.getByLabel("Kayıt bulgusu").selectOption("hareket_yok");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page).toHaveURL(/neden=hareket_yok/);
  await page.reload();
  await expect(page.getByLabel("Kayıt bulgusu")).toHaveValue("hareket_yok");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("yönetici önizlemesi ve onaylı uygulama aynı ürünle sınırlıdır; liste açılışı yazmaz", async ({ page }) => {
  const okumalar: string[] = [], yazilar: unknown[] = [];
  await kur(page, "yonetici", async (r, u) => {
    if (!u.pathname.endsWith("/stok/maliyet/yeniden-hesapla")) return false;
    if (r.request().method() === "GET") okumalar.push(u.searchParams.get("stokId") ?? "TUMU");
    else yazilar.push(r.request().postDataJSON());
    await r.fulfill({ json: onizleme }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await page.getByRole("link", { name: "Maliyet önizlemesi" }).first().click();
  await expect(page.getByText("Kapsam: yalnız bağlantıdan seçilen stok kartı.", { exact: false })).toBeVisible();
  const uygula = page.getByRole("button", { name: "Uygula", exact: true });
  await expect(uygula).toBeEnabled();
  expect(okumalar).toEqual([stokId]); expect(yazilar).toEqual([]);
  page.once("dialog", d => d.accept());
  await uygula.click();
  await expect(page.getByText("1 kartın maliyeti düzeltildi (1 hareket).", { exact: true })).toBeVisible();
  expect(yazilar).toEqual([{ stokId }]); expect(okumalar.every(s => s === stokId)).toBe(true);
});

test("hata boş liste gibi sunulmaz; mali müşavire yönetici eylemi gösterilmez", async ({ page }) => {
  await kur(page, "mali_musavir", async (r, u) => {
    if (!u.pathname.endsWith("/rapor/maliyet-eksikleri")) return false;
    await r.fulfill({ status: 400, json: { message: "Tarih aralığını daraltın." } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await expect(page.getByText("Tarih aralığını daraltın.", { exact: true })).toBeVisible();
  await expect(page.getByText("Seçili dönem ve filtrelerde kontrol edilecek satış satırı yok.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Maliyet önizlemesi" })).toHaveCount(0);
});

test("dönem özeti istek üzerine açılır; ürün/bulgu filtresinden bağımsız ölçüm dosyası indirilir", async ({ page }) => {
  let okumalar = 0;
  await kur(page, "salt_okunur", async (r, u) => {
    if (!u.pathname.endsWith("/maliyet-eksikleri/izleme")) return false;
    okumalar++; expect(r.request().method()).toBe("GET");
    expect([...u.searchParams.keys()].sort()).toEqual(["baslangic", "bitis"]);
    expect(u.searchParams.get("baslangic")).toBe("2026-10-01"); expect(u.searchParams.get("bitis")).toBe("2026-10-15");
    await r.fulfill({ json: olcum }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}&neden=hareket_yok&stokId=${stokId}`);
  const button = page.getByRole("button", { name: "Dönem inceleme özeti", exact: true });
  await expect(button).toBeEnabled(); expect(okumalar).toBe(0); await button.click();
  const panel = page.getByRole("region", { name: "Dönem inceleme özeti" });
  await expect(panel.getByText("3.600 saniye", { exact: true })).toBeVisible();
  await expect(panel.getByText("Ürün, bulgu ve sayfa filtreleri bu özete uygulanmaz.", { exact: false })).toBeVisible();
  const download = page.waitForEvent("download"); await panel.getByRole("button", { name: "Ölçüm dosyasını indir (JSON)" }).click();
  const file = await download; expect(file.suggestedFilename()).toBe("maliyet-olcumu_2026-10-01_2026-10-15_2026-10-15T09-00-00-000Z.json");
  const chunks: Buffer[] = []; for await (const chunk of (await file.createReadStream())!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(olcum); expect(okumalar).toBe(1);
});

test("inceleme özeti hatası sıfır sonuç veya indirilebilir ölçüm gibi gösterilmez", async ({ page }) => {
  await kur(page, "mali_musavir", async (r, u) => {
    if (!u.pathname.endsWith("/maliyet-eksikleri/izleme")) return false;
    await r.fulfill({ status: 400, json: { message: "Bu dönemde 20.000 inceleme kaydı aşılıyor. Tarih aralığını daraltın." } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`); await page.getByRole("button", { name: "Dönem inceleme özeti", exact: true }).click();
  const panel = page.getByRole("region", { name: "Dönem inceleme özeti" });
  await expect(panel.getByText("Bu dönemde 20.000 inceleme kaydı aşılıyor.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Ölçüm dosyasını indir (JSON)" })).toHaveCount(0);
  await expect(panel.getByText("Henüz ölçüm yok", { exact: true })).toHaveCount(0);
});

test("önceki dosya tarayıcıda karşılaştırılır; büyük tutarda bir kuruş korunur ve bozuk seçim eski sonucu kaldırır", async ({ page }) => {
  const current = structuredClone(olcum); current.uyari.ciro = "9007199254740993.13";
  const onceki = structuredClone(current); onceki.alindigiZaman = "2026-10-15T08:00:00.000Z"; onceki.uyari.ciro = "9007199254740993.12"; onceki.kullanimModu = "pilot";
  const yazmalar: string[] = [];
  page.on("request", (r) => { if (!["GET", "HEAD"].includes(r.method())) yazmalar.push(r.url()); });
  await kur(page, "salt_okunur", async (r, u) => {
    if (!u.pathname.endsWith("/maliyet-eksikleri/izleme")) return false;
    await r.fulfill({ json: current }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`); await page.getByRole("button", { name: "Dönem inceleme özeti", exact: true }).click();
  await page.getByLabel("Önceki ölçüm dosyası").setInputFiles({ name: "baz.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(onceki)) });
  const panel = page.getByRole("region", { name: "Ölçüm karşılaştırması" });
  const row = panel.getByRole("row").filter({ hasText: "İlgili uyarı cirosu (TRY)" });
  await expect(row.getByRole("cell").nth(1)).toHaveText("9.007.199.254.740.993,12");
  await expect(row.getByRole("cell").nth(2)).toHaveText("9.007.199.254.740.993,13");
  await expect(row.getByRole("cell").nth(3)).toHaveText("0,01");
  await expect(panel.getByText("Şirket modu değişmiş: pilot → salt_okunur.")).toBeVisible();
  expect(yazmalar).toEqual([]);
  await page.getByLabel("Önceki ölçüm dosyası").setInputFiles({ name: "bozuk.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(panel.getByText("Dosya geçerli bir JSON ölçüm dosyası değil.")).toBeVisible();
  await expect(panel.getByRole("table")).toHaveCount(0);
  await panel.getByRole("button", { name: "Karşılaştırmayı temizle" }).click();
  await expect(panel.getByText("Dosya geçerli bir JSON ölçüm dosyası değil.")).toHaveCount(0);
  await expect(page.getByLabel("Önceki ölçüm dosyası")).toHaveValue("");
});

for (const kapsam of ["sirket", "kaynak"] as const) {
  test(`önceki ölçüm farklı ${kapsam} kapsamındaysa fark tablosu gösterilmez`, async ({ page }) => {
    const onceki = structuredClone(olcum); onceki.alindigiZaman = "2026-10-15T08:00:00.000Z";
    if (kapsam === "sirket") onceki.firma.id = "b1111111-1111-4111-8111-111111111111";
    else onceki.kapsam.kaynakKimlikOzeti = "b".repeat(64);
    await kur(page, "muhasebe", async (r, u) => {
      if (!u.pathname.endsWith("/maliyet-eksikleri/izleme")) return false;
      await r.fulfill({ json: olcum }); return true;
    });
    await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`); await page.getByRole("button", { name: "Dönem inceleme özeti", exact: true }).click();
    await page.getByLabel("Önceki ölçüm dosyası").setInputFiles({ name: "baz.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(onceki)) });
    const panel = page.getByRole("region", { name: "Ölçüm karşılaştırması" });
    await expect(panel.getByText(kapsam === "sirket" ? "Ölçümler farklı şirketlere ait; karşılaştırılamaz." : "Satış satırı kapsamı değişmiş; bu ölçümler karşılaştırılamaz.")).toBeVisible();
    await expect(panel.getByRole("table")).toHaveCount(0);
  });
}

test("geçersiz güncel ölçüm dosyası indirilemez ve karşılaştırmaya açılmaz", async ({ page }) => {
  await kur(page, "mali_musavir", async (r, u) => {
    if (!u.pathname.endsWith("/maliyet-eksikleri/izleme")) return false;
    await r.fulfill({ json: { ...olcum, incelemeler: { ...olcum.incelemeler, toplam: 99 } } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`); await page.getByRole("button", { name: "Dönem inceleme özeti", exact: true }).click();
  const panel = page.getByRole("region", { name: "Dönem inceleme özeti" });
  await expect(panel.getByText("Ölçüm biçimi geçersiz:", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Ölçüm dosyasını indir (JSON)" })).toHaveCount(0);
  await expect(panel.getByLabel("Önceki ölçüm dosyası")).toHaveCount(0);
});

test("depo rolüne finansal maliyet listesi açılmaz", async ({ page }) => {
  await kur(page, "depo");
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await expect(page.getByRole("heading", { name: "Bu sayfaya erişim yetkiniz yok" })).toBeVisible();
  await expect(page.getByRole("link", { name: "SAT-001" })).toHaveCount(0);
});

test("salt okunur kullanıcı filtreli Excel'i aynı origin ve yenilenen oturumla indirir", async ({ page }) => {
  let aktarim = 0;
  const icerik = Buffer.from("F01 indirme test verisi");
  await kur(page, "salt_okunur", async (r, u) => {
    if (u.pathname.endsWith("/auth/yenile")) { await r.fulfill({ json: { accessToken: "yenilenen-token" } }); return true; }
    if (!u.pathname.endsWith("/rapor/maliyet-eksikleri/excel")) return false;
    expect(r.request().method()).toBe("GET");
    expect(u.searchParams.get("baslangic")).toBe("2026-10-01");
    expect(u.searchParams.get("bitis")).toBe("2026-10-15");
    expect(u.searchParams.get("neden")).toBe("hareket_yok");
    expect(u.searchParams.get("stokId")).toBe(stokId);
    aktarim++;
    if (aktarim === 1) await r.fulfill({ status: 401, json: { message: "Oturum süresi doldu" } });
    else {
      expect(r.request().headers().authorization).toBeUndefined();
      await r.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: icerik });
    }
    return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}&neden=hareket_yok&stokId=${stokId}`);
  const buton = page.getByRole("button", { name: "Excel'e aktar", exact: true });
  await expect(buton).toBeEnabled();
  const indirme = page.waitForEvent("download");
  await buton.click();
  const dosya = await indirme;
  expect(dosya.suggestedFilename()).toBe("maliyet-kontrolu_2026-10-01_2026-10-15.xlsx");
  expect(await dosya.failure()).toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of (await dosya.createReadStream())!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(icerik);
  expect(aktarim).toBe(2);
  await expect(page.getByRole("link", { name: "Maliyet önizlemesi" })).toHaveCount(0);
});

test("Excel yetki hatası indirmeye dönüşmez ve yeniden deneme düğmesi açılır", async ({ page }) => {
  let aktarim = 0, indirme = 0;
  page.on("download", () => indirme++);
  await kur(page, "muhasebe", async (r, u) => {
    if (!u.pathname.endsWith("/rapor/maliyet-eksikleri/excel")) return false;
    aktarim++; await r.fulfill({ status: 403, json: { message: "Dosyaya erişim yetkiniz yok." } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  const buton = page.getByRole("button", { name: "Excel'e aktar", exact: true });
  await expect(buton).toBeEnabled(); await buton.click();
  await expect(page.getByText("Dosyaya erişim yetkiniz yok.", { exact: true })).toBeVisible();
  await expect(buton).toBeEnabled();
  expect(aktarim).toBe(1); expect(indirme).toBe(0);
  await expect(page.locator("tbody tr")).toHaveCount(2);
});

test("yeni filtre yüklenirken eski listenin Excel'i indirilemez", async ({ page }) => {
  let bekleyen: Route | undefined;
  await kur(page, "muhasebe", async (r, u) => {
    if (u.pathname.endsWith("/rapor/maliyet-eksikleri") && u.searchParams.get("neden") === "hareket_yok") { bekleyen = r; return true; }
    return false;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  const buton = page.getByRole("button", { name: "Excel'e aktar", exact: true });
  await expect(buton).toBeEnabled();
  await page.getByLabel("Kayıt bulgusu").selectOption("hareket_yok");
  await expect(buton).toBeDisabled();
  await expect.poll(() => Boolean(bekleyen)).toBe(true);
  await bekleyen!.fulfill({ json: veri("muhasebe", "hareket_yok") });
  await expect(buton).toBeEnabled();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

const inceleme = (durum = "acik", updatedAt = "2026-10-15T09:00:00.000Z", not = "Alış belgesi araştırılıyor") => ({
  id: "k1", durum, updatedAt, _count: { olaylar: 1 },
  olaylar: [{ id: "o1", aciklama: not, olayTuru: "maliyet_incelemesi", createdAt: updatedAt, user: { adSoyad: "Test muhasebe" } }],
});
const kaynakKaniti = { uygun: true, neden: "Kayıtlı pozitif maliyet ve hareket kapsamı doğrulandı.", kanit: "a".repeat(64), kayitId: "k1", kayitSurumu: "2026-10-15T09:00:00.000Z", maliyet: "10.00", ciro: "100.10", hareketSayisi: 1, alindigiZaman: "2026-10-15T09:10:00.000Z" };

test("salt okunur şirket modunda yönetici geçmişi okur; yazma ve maliyet uygulama bağlantısı görünmez", async ({ page }) => {
  await kur(page, "yonetici", async (r, u) => {
    if (u.pathname.endsWith("/rapor/maliyet-eksikleri")) {
      const json = veri("yonetici");
      await r.fulfill({ json: { ...json, kullanimModu: "salt_okunur", izinler: { ...json.izinler, takipYazma: false, onizleme: false } } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip")) { expect(r.request().method()).toBe("GET"); await r.fulfill({ json: { kayit: inceleme() } }); return true; }
    if (u.pathname.endsWith("/s1/takip/dogrulama")) { await r.fulfill({ json: kaynakKaniti }); return true; }
    return false;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}&inceleme=s1`);
  await expect(page.getByText("Şirket modu: salt okunur.", { exact: false })).toBeVisible();
  await expect(page.getByText("Alış belgesi araştırılıyor", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Not ve durumu kaydet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kayıtlı maliyetle incelemeyi kapat", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Maliyet önizlemesi" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Excel'e aktar", exact: true })).toBeEnabled();
});

test("kapalı şirket modu boş veya başarılı liste gibi sunulmaz", async ({ page }) => {
  await kur(page, "yonetici", async (r, u) => {
    if (!u.pathname.endsWith("/rapor/maliyet-eksikleri")) return false;
    await r.fulfill({ status: 403, json: { message: "Satış maliyet kontrolü bu şirket için kapalı. Yönetici, Modül Ayarları ekranından açabilir." } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await expect(page.getByText("Satış maliyet kontrolü bu şirket için kapalı.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Excel'e aktar", exact: true })).toBeDisabled();
  await expect(page.getByText("Seçili dönem ve filtrelerde kontrol edilecek satış satırı yok.")).toHaveCount(0);
});

test("yönetici şirketin pilot modunu modül ayarlarından kaydeder", async ({ page }) => {
  const yazilar: unknown[] = [];
  await kur(page, "yonetici", async (r, u) => {
    if (u.pathname.endsWith("/ayarlar")) { await r.fulfill({ json: { moduller: ["maliyet_kontrolu"] } }); return true; }
    if (u.pathname.endsWith("/ayarlar/maliyet_kontrolu")) {
      if (r.request().method() === "PUT") {
        yazilar.push(r.request().postDataJSON());
        await r.fulfill({ json: { surum: 1, mod: "pilot" } });
      } else await r.fulfill({ json: { surum: 1, mod: "kapali" } });
      return true;
    }
    return false;
  });
  await page.goto("/panel/ayarlar/moduller");
  await page.getByRole("combobox", { name: "Kullanım modu" }).selectOption("pilot");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Satış Maliyet Kontrolü ayarları kaydedildi.", { exact: true })).toBeVisible();
  expect(yazilar).toEqual([{ mod: "pilot" }]);
  await expect(page.getByText("Pilot, seçilen şirketin deneme kullanımını belirtir", { exact: false })).toBeVisible();
});

test("muhasebe kalıcı inceleme başlatır, not ve durum kaydeder; uyarı satırları kalır", async ({ page }) => {
  let kayit: ReturnType<typeof inceleme> | null = null;
  await kur(page, "muhasebe", async (r, u) => {
    if (!u.pathname.endsWith("/maliyet-eksikleri/s1/takip")) return false;
    const req = r.request();
    if (req.method() !== "GET") {
      expect(req.headers()["idempotency-key"]).toBeTruthy();
      const b = req.postDataJSON();
      if (req.method() === "POST") { expect(b).toEqual({ aciklama: "Alış belgesi araştırılıyor" }); kayit = inceleme(); }
      else {
        expect(b).toEqual({ aciklama: "Tedarikçiden belge bekleniyor", durum: "beklemede", beklenenGuncelleme: kayit!.updatedAt });
        kayit = inceleme("beklemede", "2026-10-15T09:01:00.000Z", b.aciklama);
      }
    }
    await r.fulfill({ json: { kayit } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await page.getByRole("button", { name: "İnceleme kaydı", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await expect(panel).toBeFocused();
  await panel.getByLabel("İnceleme notu").fill("Alış belgesi araştırılıyor");
  await panel.getByRole("button", { name: "İnceleme başlat", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Not ve durumu kaydet", exact: true })).toBeVisible();
  await panel.getByLabel("İnceleme durumu").selectOption("beklemede");
  await panel.getByLabel("İnceleme notu").fill("Tedarikçiden belge bekleniyor");
  await panel.getByRole("button", { name: "Not ve durumu kaydet", exact: true }).click();
  await expect(panel.getByText("Tedarikçiden belge bekleniyor", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "İnceleme kaydı", exact: true }).first().click();
  await expect(panel.getByLabel("İnceleme durumu")).toHaveValue("beklemede");
  await expect(panel.getByText("Tedarikçiden belge bekleniyor", { exact: true })).toBeVisible();
});

test("salt okunur rol inceleme geçmişini görür ve yazma formunu görmez", async ({ page }) => {
  await kur(page, "salt_okunur", async (r, u) => {
    if (u.pathname.endsWith("/maliyet-eksikleri/s1/takip/dogrulama")) { expect(r.request().method()).toBe("GET"); await r.fulfill({ json: kaynakKaniti }); return true; }
    if (!u.pathname.endsWith("/maliyet-eksikleri/s1/takip")) return false;
    expect(r.request().method()).toBe("GET");
    await r.fulfill({ json: { kayit: inceleme() } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await page.getByRole("button", { name: "İnceleme kaydı", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await expect(panel.getByText("Alış belgesi araştırılıyor", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("İnceleme notu")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "İnceleme başlat" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Kayıtlı maliyeti doğrula", exact: true }).click();
  await expect(panel.getByText("Kayıtlı pozitif maliyet ve hareket kapsamı doğrulandı.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Kayıtlı maliyetle incelemeyi kapat", exact: true })).toHaveCount(0);
});

test("eski sürümle not yazımı reddedilince taslak korunur ve geçmiş yenilenir", async ({ page }) => {
  let kayit = inceleme(), yazma = 0;
  await kur(page, "muhasebe", async (r, u) => {
    if (!u.pathname.endsWith("/maliyet-eksikleri/s1/takip")) return false;
    if (r.request().method() === "PATCH") {
      yazma++;
      if (yazma === 1) {
        kayit = inceleme("beklemede", "2026-10-15T09:05:00.000Z", "Başka kullanıcı belgeyi inceledi");
        await r.fulfill({ status: 409, json: { message: "İnceleme kaydı başka bir işlemle değişti. Geçmişi yenileyip tekrar deneyin." } }); return true;
      }
      expect(r.request().postDataJSON().beklenenGuncelleme).toBe("2026-10-15T09:05:00.000Z");
    }
    await r.fulfill({ json: { kayit } }); return true;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await page.getByRole("button", { name: "İnceleme kaydı", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await panel.getByLabel("İnceleme notu").fill("Benim inceleme notum");
  const buton = panel.getByRole("button", { name: "Not ve durumu kaydet", exact: true });
  await buton.click();
  await expect(panel.getByText("İnceleme kaydı başka bir işlemle değişti.", { exact: false })).toBeVisible();
  await expect(panel.getByLabel("İnceleme notu")).toHaveValue("Benim inceleme notum");
  await expect(buton).toBeDisabled();
  await panel.getByRole("button", { name: "Geçmişi yenile" }).click();
  await expect(panel.getByText("Başka kullanıcı belgeyi inceledi", { exact: true })).toBeVisible();
  await expect(buton).toBeEnabled(); await buton.click();
  await expect(panel.getByLabel("İnceleme notu")).toHaveValue("");
  expect(yazma).toBe(2);
});

test("uyarıdan çıkan satır doğrudan bağlantıyla doğrulanıp kapatılır ve geçmişte kalır", async ({ page }) => {
  let kayit = inceleme(), kapanis = 0;
  await kur(page, "muhasebe", async (r, u) => {
    if (u.pathname.endsWith("/rapor/maliyet-eksikleri")) {
      await r.fulfill({ json: { ...veri("muhasebe"), satirlar: [], donemOzeti: { satir: 0, ciro: "0.00" }, filtreOzeti: { satir: 0, ciro: "0.00" }, toplamSayfa: 0 } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip/dogrulama")) { await r.fulfill({ json: kaynakKaniti }); return true; }
    if (u.pathname.endsWith("/s1/takip/kapat")) {
      expect(r.request().method()).toBe("POST");
      expect(r.request().postDataJSON()).toEqual({ kayitId: "k1", beklenenGuncelleme: kaynakKaniti.kayitSurumu, kanit: kaynakKaniti.kanit, aciklama: "Kayıtlı maliyet ve kaynak incelendi" });
      kapanis++; kayit = inceleme("cozuldu", "2026-10-15T09:20:00.000Z", "Kayıtlı maliyet doğrulandı");
      await r.fulfill({ json: { kayit } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip")) { expect(r.request().method()).toBe("GET"); await r.fulfill({ json: { kayit } }); return true; }
    return false;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}&inceleme=s1`);
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await panel.getByLabel("İnceleme notu").fill("Kayıtlı maliyet ve kaynak incelendi");
  const kapat = panel.getByRole("button", { name: "Kayıtlı maliyetle incelemeyi kapat", exact: true });
  await expect(kapat).toBeDisabled();
  await panel.getByRole("button", { name: "Kayıtlı maliyeti doğrula", exact: true }).click();
  await expect(kapat).toBeEnabled(); await kapat.click();
  await expect(panel.getByText("Çözüldü", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByText("Çözüldü", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "İnceleme başlat", exact: true })).toHaveCount(0);
  expect(kapanis).toBe(1);
});

test("pozitif fakat kısmen maliyetsiz kaynak kapatmayı açmaz", async ({ page }) => {
  await kur(page, "muhasebe", async (r, u) => {
    if (u.pathname.endsWith("/s1/takip/dogrulama")) { await r.fulfill({ json: { ...kaynakKaniti, uygun: false, kanit: null, maliyet: "5.00", neden: "Hareket miktarı veya maliyet kapsamı eksik/belirsiz; inceleme kapatılamaz." } }); return true; }
    if (u.pathname.endsWith("/s1/takip")) { await r.fulfill({ json: { kayit: inceleme() } }); return true; }
    if (u.pathname.endsWith("/s1/takip/kapat")) throw new Error("UYGUN_OLMAYAN_KAPATMA");
    return false;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}&inceleme=s1`);
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await panel.getByLabel("İnceleme notu").fill("Kaynak yeniden incelendi");
  await panel.getByRole("button", { name: "Kayıtlı maliyeti doğrula", exact: true }).click();
  await expect(panel.getByText("Hareket miktarı veya maliyet kapsamı eksik/belirsiz; inceleme kapatılamaz.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Kayıtlı maliyetle incelemeyi kapat", exact: true })).toBeDisabled();
});

test("doğrulama sonrası kaynak değişirse kapatma durur ve not taslağı korunur", async ({ page }) => {
  let kapanis = 0;
  await kur(page, "muhasebe", async (r, u) => {
    if (u.pathname.endsWith("/s1/takip/dogrulama")) { await r.fulfill({ json: kaynakKaniti }); return true; }
    if (u.pathname.endsWith("/s1/takip")) { await r.fulfill({ json: { kayit: inceleme() } }); return true; }
    if (u.pathname.endsWith("/s1/takip/kapat")) { kapanis++; await r.fulfill({ status: 409, json: { message: "Kaynak veya inceleme değişti ya da kapatmaya uygun değil. Yeniden doğrulayın." } }); return true; }
    return false;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}&inceleme=s1`);
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await panel.getByLabel("İnceleme notu").fill("Benim kapatma notum");
  await panel.getByRole("button", { name: "Kayıtlı maliyeti doğrula", exact: true }).click();
  const kapat = panel.getByRole("button", { name: "Kayıtlı maliyetle incelemeyi kapat", exact: true });
  await expect(kapat).toBeEnabled(); await kapat.click();
  await expect(panel.getByText("Kaynak veya inceleme değişti ya da kapatmaya uygun değil.", { exact: false })).toBeVisible();
  await expect(panel.getByLabel("İnceleme notu")).toHaveValue("Benim kapatma notum");
  await expect(kapat).toBeDisabled(); expect(kapanis).toBe(1);
});

test("varyant görünür; eksik hareket kapsamı kapanışı açmaz", async ({ page }) => {
  await kur(page, "muhasebe", async (r, u) => {
    if (u.pathname.endsWith("/rapor/maliyet-eksikleri")) {
      await r.fulfill({ json: { ...veri("muhasebe"), satirlar: [{ ...satirlar[0], varyantKod: "MAVI-XL", varyantAd: "Mavi XL" }] } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip/dogrulama")) {
      await r.fulfill({ json: { ...kaynakKaniti, uygun: false, kanit: null, varyantKod: "MAVI-XL", varyantAd: "Mavi XL", neden: "Hareket miktarı veya maliyet kapsamı eksik/belirsiz; inceleme kapatılamaz." } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip")) { await r.fulfill({ json: { kayit: inceleme() } }); return true; }
    if (u.pathname.endsWith("/s1/takip/kapat")) throw new Error("VARYANT_KAPATILAMAZ");
    return false;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}`);
  await expect(page.getByRole("table").getByText("Varyant: MAVI-XL · Mavi XL", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "İnceleme kaydı", exact: true }).click();
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await panel.getByLabel("İnceleme notu").fill("Varyant hareketi incelenecek");
  await panel.getByRole("button", { name: "Kayıtlı maliyeti doğrula", exact: true }).click();
  await expect(panel.getByText("Varyant: MAVI-XL · Mavi XL", { exact: true })).toBeVisible();
  await expect(panel.getByText("Hareket miktarı veya maliyet kapsamı eksik/belirsiz; inceleme kapatılamaz.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Kayıtlı maliyetle incelemeyi kapat", exact: true })).toBeDisabled();
});

test("doğrulanmış varyant kapsamı gösterilir; yalnız seçilen inceleme kapanır", async ({ page }) => {
  let kayit = inceleme(), kapanis = 0;
  await kur(page, "muhasebe", async (r, u) => {
    if (u.pathname.endsWith("/rapor/maliyet-eksikleri")) {
      await r.fulfill({ json: { ...veri("muhasebe"), satirlar: [{ ...satirlar[1], varyantKod: "KIRMIZI", varyantAd: "Kırmızı" }] } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip/dogrulama")) {
      await r.fulfill({ json: { ...kaynakKaniti, varyantId: "v1", varyantKod: "MAVI", varyantAd: "Mavi", kapsamSatirSayisi: 2, kapsamMiktari: "3" } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip/kapat")) {
      expect(r.request().postDataJSON()).toEqual({ kayitId: "k1", beklenenGuncelleme: kaynakKaniti.kayitSurumu, kanit: kaynakKaniti.kanit, aciklama: "Mavi varyantın hareketleri doğrulandı" });
      kapanis++; kayit = inceleme("cozuldu", "2026-10-15T09:20:00.000Z", "MAVI varyantının kayıtlı maliyeti doğrulandı");
      await r.fulfill({ json: { kayit } }); return true;
    }
    if (u.pathname.endsWith("/s1/takip")) { await r.fulfill({ json: { kayit } }); return true; }
    if (u.pathname.endsWith("/s2/takip/kapat")) throw new Error("DIGER_VARYANT_KAPATILAMAZ");
    return false;
  });
  await page.goto(`/panel/raporlar/maliyet-eksikleri?${donem}&inceleme=s1`);
  const panel = page.getByRole("region", { name: "Maliyet inceleme kaydı" });
  await panel.getByLabel("İnceleme notu").fill("Mavi varyantın hareketleri doğrulandı");
  await panel.getByRole("button", { name: "Kayıtlı maliyeti doğrula", exact: true }).click();
  await expect(panel.getByText("Bu varyantın faturadaki 2 satış satırı birlikte kontrol edildi.", { exact: false })).toBeVisible();
  await expect(panel.getByText("Varyant: MAVI · Mavi", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Kayıtlı maliyetle incelemeyi kapat", exact: true }).click();
  await expect(panel.getByText("Çözüldü", { exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("Varyant: KIRMIZI · Kırmızı", { exact: true })).toBeVisible();
  await page.reload(); await expect(panel.getByText("MAVI varyantının kayıtlı maliyeti doğrulandı", { exact: true })).toBeVisible();
  expect(kapanis).toBe(1);
});
