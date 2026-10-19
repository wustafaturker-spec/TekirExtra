import { expect, test, type Page } from "@playwright/test";
import { ortakYanit } from "./ortak-yanit";

const sayfalar = [
  { yol: "/panel/fatura", baslik: "Fatura Yönetimi" },
  { yol: "/panel/cari", baslik: "Cari Hesaplar" },
  { yol: "/panel/stok", baslik: "Stok Kartları" },
  { yol: "/panel/kasa-banka", baslik: "Kasa ve banka yönetimi" },
  { yol: "/panel/kasa-banka/ekstre", baslik: "Banka ekstresi çalışma alanı" },
] as const;

async function apiMockla(page: Page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("tekir_access") && !localStorage.getItem("tekir_access")) {
      sessionStorage.setItem("tekir_access", "e2e-token");
    }
  });
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/auth/ben")) {
      await route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
      return;
    }
    const ortak = ortakYanit(pathname);
    if (ortak) {
      await route.fulfill(ortak);
      return;
    }
    if (pathname.endsWith("/cari/etiketler") || pathname.endsWith("/fiyat-listeleri") || pathname.includes("/kasa-banka/") || pathname.endsWith("/depo") || pathname.endsWith("/projeler")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (pathname.endsWith("/fatura") || pathname.endsWith("/cari") || pathname.endsWith("/stok")) {
      await route.fulfill({ json: { kayitlar: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

const ornekFatura = {
  id: "fatura-1",
  no: "SF2026000123",
  tip: "satis",
  tarih: "2026-08-09",
  durum: "kesin",
  toplamMatrah: "10000.00",
  toplamKdv: "2000.00",
  genelToplam: "12000.00",
  cari: { id: "cari-1", kod: "CR-00124", unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti.", vknTckn: "1234567890", eFaturaMukellefi: true },
  dovizCinsi: "TRY",
  satirlar: [{ stokId: "stok-1", stokKod: "PRD-0042", stokAd: "A4 Fotokopi Kağıdı 80 gr", miktar: "10", birim: "paket" }],
  ebelge: {
    id: "ebelge-1",
    durum: "hata",
    tur: "efatura",
    entegratorRef: null,
    hataMesaji: "Alıcının posta kutusu etiketi doğrulanamadı. Cari e-Belge bilgilerini kontrol edin.",
    createdAt: "2026-08-09T09:00:00.000Z",
    updatedAt: "2026-08-09T09:05:00.000Z",
  },
  odemeOzeti: { durum: "kismi", odenen: "4000.00", kalan: "8000.00", hareketler: [] },
} as const;

async function veriDoluFaturaMockla(page: Page) {
  await page.route("**/api/v1/fatura**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const ortak = ortakYanit(pathname);
    if (ortak) {
      await route.fulfill(ortak);
      return;
    }
    await route.fulfill({
      json: pathname.endsWith("/fatura/fatura-1")
        ? ornekFatura
        : { kayitlar: [ornekFatura], sonrakiImlec: null },
    });
  });
}

async function veriDoluEkstreMockla(page: Page) {
  await page.route("**/api/v1/kasa-banka/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/kasa-banka/bankalar")) {
      await route.fulfill({ json: [{ id: "banka-1", ad: "İş Bankası TL", bankaAdi: "İş Bankası", dovizCinsi: "TRY" }] });
      return;
    }
    // Öneriler satır seçilince ayrı uçtan gelir.
    if (pathname.endsWith("/ekstre/satirlar/ekstre-1/oneriler")) {
      await route.fulfill({ json: {
        kural: null,
        onerilenCari: { id: "cari-1", kod: "CR-00124", unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti." },
        cariEslesmeKaynagi: "iban",
        faturalar: [{ id: "fatura-1", no: "SF2026000123", tarih: "2026-08-09", vadeTarihi: null, dovizCinsi: "TRY", genelToplam: "12000.00", kalan: "12000.00", tamEslesme: true }],
        mevcutFisler: [], cekler: [], kartlar: [], virmanHesaplari: [], dovizHesaplari: [], masrafKategorileri: [],
        gelirKategorileri: [], odemeTalimatlari: [], krediler: [],
      } });
      return;
    }
    if (!pathname.endsWith("/ekstre/satirlar")) {
      await route.fulfill(ortakYanit(pathname) ?? { json: [] });
      return;
    }
    await route.fulfill({
      json: [{
        id: "ekstre-1",
        bankaHesap: { id: "banka-1", ad: "İş Bankası TL", dovizCinsi: "TRY" },
        tarih: "2026-08-09",
        tutar: "12000.00",
        yon: "tahsilat",
        aciklama: "ABC MAKİNA FATURA ÖDEMESİ SF2026000123",
        dekontNo: "D-908172",
        karsiIban: "TR120006200000000123456789",
        karsiUnvan: "ABC MAKİNA LTD ŞTİ",
        bakiye: "184200.00",
        durum: "beklemede",
        cari: null,
        fatura: null,
        hareketId: null,
        onerilenCari: { id: "cari-1", kod: "CR-00124", unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti." },
        cariEslesmeKaynagi: "iban",
        onerilenFaturalar: [{ id: "fatura-1", no: "SF2026000123", tarih: "2026-08-09", genelToplam: "12000.00", odenen: "0.00", kalan: "12000.00", tamEslesme: true }],
      }],
    });
  });
  await page.route("**/api/v1/cari**", (route) => route.fulfill({
    json: { kayitlar: [
      { id: "cari-1", kod: "CR-00124", unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti." },
      { id: "cari-2", kod: "CR-00208", unvan: "ABC Endüstriyel Ürünler A.Ş." },
    ] },
  }));
}

async function faturaFormuMockla(page: Page) {
  await page.route("**/api/v1/cari**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/cari/cari-1")) {
      await route.fulfill({ json: {
        id: "cari-1", kod: "CR-00124", unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti.", vknTckn: "1234567890", telefon: "0212 555 01 24",
        bakiyeler: [{ dovizCinsi: "TRY", bakiye: "84200.00" }],
        risk: { mevcutRisk: "84200.00", limit: "150000.00", kalanLimit: "65800.00", asim: false },
        varsayilanVadeGun: 30, eFaturaMukellefi: true,
      } });
      return;
    }
    await route.fulfill({ json: { kayitlar: [{ id: "cari-1", kod: "CR-00124", unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti.", vknTckn: "1234567890", telefon: "0212 555 01 24" }], sonrakiImlec: null } });
  });
  await page.route("**/api/v1/stok**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/stok/stok-1/tavsiye-fiyat")) {
      await route.fulfill({ json: { kaynakFiyat: 185, kaynakDoviz: "TRY", iskontoOrani: 5, cevrilebilir: true } });
      return;
    }
    await route.fulfill({ json: { kayitlar: [{
      id: "stok-1", kod: "PRD-0042", ad: "A4 Fotokopi Kağıdı 80 gr", barkod: "8690000000042",
      tedarikciUrunKodlari: ["SUP-A4-80"], anaBirim: "paket", kullanilabilirMiktar: "124",
      alisFiyati: "145.00", satisFiyati: "185.00", kdvOrani: "20",
    }], sonrakiImlec: null } });
  });
}

async function veriDoluAnaKayitMockla(page: Page) {
  await page.route("**/api/v1/cari**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/cari/etiketler")) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: { kayitlar: [
      { id: "cari-1", kod: "CR-00124", unvan: "ABC Makina Sanayi ve Ticaret Limited Şirketi İstanbul Avrupa Yakası Şubesi", tip: "musteri", sektor: "Makine ve Endüstriyel Üretim", vknTckn: "1234567890", eposta: "muhasebe@abcmakina.example", telefon: "0212 555 01 24", karaListe: false, bakiyeler: [{ dovizCinsi: "TRY", bakiye: "84200.00", bakiyeTry: "84200.00" }] },
      { id: "cari-2", kod: "CR-00208", unvan: "Kuzey Tedarik A.Ş.", tip: "tedarikci", sektor: "Toptan Ticaret", vknTckn: "9876543210", eposta: null, telefon: null, karaListe: false, bakiyeler: [{ dovizCinsi: "TRY", bakiye: "-31850.50", bakiyeTry: "-31850.50" }] },
      { id: "cari-3", kod: "CR-00311", unvan: "Riskli Müşteri Ltd. Şti.", tip: "musteri", sektor: null, vknTckn: "1122334455", eposta: null, telefon: null, karaListe: true, bakiyeler: [{ dovizCinsi: "TRY", bakiye: "126400.00", bakiyeTry: "126400.00" }] },
    ], sonrakiImlec: null } });
  });
  await page.route("**/api/v1/stok**", (route) => route.fulfill({ json: { kayitlar: [
    { id: "stok-1", kod: "PRD-0042", ad: "A4 Fotokopi Kağıdı 80 gr Beyaz 500 Yaprak Ekonomik Ofis Paketi", tip: "urun", barkod: "8690000000042", anaBirim: "paket", kdvOrani: "20", alisFiyati: "145.00", satisFiyati: "185.00", mevcutMiktar: "124", ortalamaMaliyet: "141.75", alisFiyatiDoviz: "TRY", satisFiyatiDoviz: "TRY" },
    { id: "stok-2", kod: "PRD-0088", ad: "Endüstriyel Kesici Disk 115 mm", tip: "urun", barkod: "8690000000088", anaBirim: "adet", kdvOrani: "20", alisFiyati: "72.50", satisFiyati: "110.00", mevcutMiktar: "0", ortalamaMaliyet: "68.40", alisFiyatiDoviz: "TRY", satisFiyatiDoviz: "TRY" },
    { id: "stok-3", kod: "SRV-0012", ad: "Yerinde Kurulum ve Teknik Destek Hizmeti", tip: "hizmet", barkod: null, anaBirim: "saat", kdvOrani: "20", alisFiyati: null, satisFiyati: "1250.00", mevcutMiktar: "0", ortalamaMaliyet: "0", alisFiyatiDoviz: "TRY", satisFiyatiDoviz: "TRY" },
  ], sonrakiImlec: null } }));
}

async function veriDoluKasaBankaMockla(page: Page) {
  await page.route("**/api/v1/kasa-banka/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/kasa-banka/kasalar")) {
      await route.fulfill({ json: [
        { id: "kasa-1", ad: "Merkez TL Kasası", dovizCinsi: "TRY", bakiye: "24500.00", aktif: true },
        { id: "kasa-2", ad: "Şube Nakit Kasası", dovizCinsi: "TRY", bakiye: "-1250.75", aktif: true },
      ] });
      return;
    }
    if (pathname.endsWith("/kasa-banka/bankalar")) {
      await route.fulfill({ json: [
        { id: "banka-1", ad: "İş Bankası Ticari TL Ana Hesabı", bankaAdi: "Türkiye İş Bankası", hesapNo: "1234-567890", iban: "TR120006200000000123456789", dovizCinsi: "TRY", bakiye: "184200.00", aktif: true },
        { id: "banka-2", ad: "İhracat USD Hesabı", bankaAdi: "Garanti BBVA", hesapNo: "7788-990011", iban: "TR330006200000000987654321", dovizCinsi: "USD", bakiye: "8250.50", aktif: true },
      ] });
      return;
    }
    if (!pathname.endsWith("/kasa-banka/hareketler")) {
      await route.fulfill(ortakYanit(pathname) ?? { json: [] });
      return;
    }
    // Hareket listesi sayfalıdır; toplamlar ilk sayfada gelir (KSB-13).
    await route.fulfill({ json: { sonrakiImlec: null, toplamlar: { adet: 2, dovizler: [] }, kayitlar: [
      { id: "hareket-1", tarih: "2026-08-09", tip: "tahsilat", tutar: "12000.00", dovizCinsi: "TRY", kur: "1", tutarTry: "12000.00", aciklama: "SF2026000123 numaralı satış faturası tahsilatı", kaynakTur: "fatura_kapama", karsiHareketId: null, kasa: null, bankaHesap: { id: "banka-1", ad: "İş Bankası Ticari TL Ana Hesabı", bankaAdi: "Türkiye İş Bankası" }, cari: { unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti." } },
      { id: "hareket-2", tarih: "2026-08-08", tip: "tediye", tutar: "31850.50", dovizCinsi: "TRY", kur: "1", tutarTry: "31850.50", aciklama: "Temmuz dönemi toplu tedarikçi ödemesi ve masraf kapaması", kaynakTur: "manuel", karsiHareketId: null, kasa: null, bankaHesap: { id: "banka-1", ad: "İş Bankası Ticari TL Ana Hesabı", bankaAdi: "Türkiye İş Bankası" }, cari: { unvan: "Kuzey Tedarik A.Ş." } },
    ] } });
  });
  await page.route("**/api/v1/cari**", (route) => route.fulfill({ json: { kayitlar: [
    { id: "cari-1", unvan: "ABC Makina Sanayi ve Ticaret Ltd. Şti." },
    { id: "cari-2", unvan: "Kuzey Tedarik A.Ş." },
  ], sonrakiImlec: null } }));
}

async function veriDoluAnaPanelMockla(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/auth/ben")) {
      await route.fulfill({ json: { userId: "u1", tenantId: "t1", rol: "yonetici" } });
    } else if (pathname.endsWith("/bildirimler/ozet")) {
      await route.fulfill({ json: { okunmamis: 5, acik: 22, kritik: 2 } });
    } else if (pathname.endsWith("/bildirimler")) {
      await route.fulfill({ json: { kayitlar: [
        { id: "teslimat-1", durum: "yeni", bildirim: { baslik: "2 e-Belge gönderimi hatalı", aciklama: "Alıcı posta kutusu etiketi doğrulanamadı.", onem: "kritik", hedefYol: "/panel/fatura?ebelge=hata" } },
        { id: "teslimat-2", durum: "okundu", bildirim: { baslik: "6 ürün kritik stok seviyesinde", aciklama: "Tedarik süresi dolmadan sipariş verin.", onem: "uyari", hedefYol: "/panel/stok?kritik=1" } },
      ] } });
    } else if (pathname.endsWith("/firma")) {
      await route.fulfill({ json: { unvan: "TekirExtra Örnek Sanayi ve Ticaret Limited Şirketi" } });
    } else if (pathname.endsWith("/fatura/is-kuyrugu-ozeti")) {
      await route.fulfill({ json: { taslakSatis: 4, taslakAlis: 3, ebelgeHata: 2, acikTahsilat: 8, acikOdeme: 5 } });
    } else if (pathname.endsWith("/stok/kritik-ozeti")) {
      await route.fulfill({ json: { kritikStok: 6 } });
    } else if (pathname.endsWith("/rapor/gunluk")) {
      await route.fulfill({ json: { satis: { toplam: "128450.00", adet: 12 }, tahsilat: { toplam: "84200.00", adet: 8 } } });
    } else if (pathname.endsWith("/doviz-kurlari")) {
      await route.fulfill({ json: { kurTarihi: "2026-08-09", kurlar: { USD: 40.72, EUR: 47.46 } } });
    } else if (pathname.endsWith("/kasa-banka/ekstre/satirlar")) {
      await route.fulfill({ json: [{ id: "e1" }, { id: "e2" }, { id: "e3" }] });
    } else if (pathname.endsWith("/ebelge/gelen")) {
      await route.fulfill({ json: [{ id: "g1" }, { id: "g2" }] });
    } else if (pathname.endsWith("/kasa-banka/cek-senet")) {
      await route.fulfill({ json: [] });
    } else if (pathname.endsWith("/rapor/vadesi-gecenler")) {
      await route.fulfill({ json: { alacaklar: [], borclar: [], toplamAlacak: "0.00", toplamBorc: "0.00" } });
    } else if (pathname.endsWith("/rapor/ozet")) {
      await route.fulfill({ json: { nakitVarliklar: "208700.00", envanterDegeri: "486250.75", toplamAlacaklar: "342800.50", toplamBorclar: "198450.25", netVarlikDegeri: "839300.00" } });
    } else {
      await route.fulfill(ortakYanit(pathname) ?? { json: {} });
    }
  });
}

for (const gorunum of [
  { ad: "masaüstü", width: 1440, height: 900 },
  { ad: "mobil", width: 390, height: 844 },
] as const) {
  test.describe(gorunum.ad, () => {
    test.use({ viewport: { width: gorunum.width, height: gorunum.height } });

    test("temel operasyon sayfaları görünür ve yatay taşma üretmez", async ({ page }) => {
      // Beş sayfa sırayla açılır; dev sunucusu her birini ilk ziyarette derler.
      test.setTimeout(180_000);
      await apiMockla(page);
      for (const sayfa of sayfalar) {
        await page.goto(sayfa.yol);
        await expect(page.getByRole("heading", { level: 1, name: sayfa.baslik })).toBeVisible({ timeout: 30_000 });
        const boyut = await page.evaluate(() => ({
          istemci: document.documentElement.clientWidth,
          icerik: document.documentElement.scrollWidth,
        }));
        expect.soft(boyut.icerik, `${sayfa.yol} belge düzeyinde yatay taşmamalı`).toBeLessThanOrEqual(boyut.istemci);
        await expect(page).toHaveScreenshot(
          `${sayfa.yol.replaceAll("/", "-").replace(/^-/, "")}-${gorunum.ad}.png`,
          {
            animations: "disabled",
            caret: "hide",
            fullPage: true,
          },
        );
      }
    });

    test("veri dolu fatura ve hata paneli görsel olarak korunur", async ({ page }) => {
      await apiMockla(page);
      await veriDoluFaturaMockla(page);
      await page.goto("/panel/fatura?yon=satis");
      await expect(page.getByText("SF2026000123")).toBeVisible();
      await expect(page).toHaveScreenshot(`fatura-listesi-veri-dolu-${gorunum.ad}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
      });

      await page.locator('button[title="e-Belge ayrıntısını aç"]').click();
      await expect(page.getByText("Alıcının posta kutusu etiketi doğrulanamadı.", { exact: false })).toBeVisible();
      await expect(page).toHaveScreenshot(`fatura-ebelge-hata-paneli-${gorunum.ad}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
      });
    });

    test("banka ekstresi öneri ve cari seçimi görsel olarak korunur", async ({ page }) => {
      await apiMockla(page);
      await veriDoluEkstreMockla(page);
      await page.goto("/panel/kasa-banka/ekstre");
      await expect(page.getByLabel("Ekstre satırları").getByText("ABC MAKİNA FATURA ÖDEMESİ SF2026000123")).toBeVisible();
      await expect(page.getByText("IBAN eşleşti")).toBeVisible();
      await expect(page).toHaveScreenshot(`banka-ekstresi-oneri-${gorunum.ad}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        // Seçili cari yazılı arama kutusunun metni koşucuda koşudan koşuya alt piksel kayıyor
        // (300-550 px, tek satır); görünür bir fark değil.
        maxDiffPixels: 1000,
      });

      await page.getByRole("combobox", { name: "Cari hesap" }).click();
      await expect(page.getByRole("option", { name: /ABC Endüstriyel Ürünler A\.Ş\./ })).toBeVisible();
      await expect(page).toHaveScreenshot(`banka-ekstresi-cari-secimi-${gorunum.ad}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
      });
    });

    test("doldurulmuş fatura formu ve satır ayrıntısı görsel olarak korunur", async ({ page }) => {
      await apiMockla(page);
      await faturaFormuMockla(page);
      await page.goto("/panel/fatura?yon=satis&yeni=1");
      await expect(page.getByRole("heading", { level: 3, name: "Yeni satış faturası" })).toBeVisible();

      await page.getByRole("combobox", { name: "Müşteri ara" }).click();
      await page.getByRole("option", { name: /ABC Makina Sanayi/ }).click();
      await expect(page.getByText("84.200,00 TL").first()).toBeVisible();
      await page.getByLabel("Fatura Tarihi").fill("2026-08-09");

      await page.getByRole("combobox", { name: "1. satır ürün veya hizmet seçimi" }).click();
      await page.getByRole("option", { name: /A4 Fotokopi Kağıdı 80 gr/ }).click();
      // Ürün seçimi fiyatı satıra doğrudan yazmaz; önerilen fiyatla ürün penceresi açılır.
      const urunPenceresi = page.getByRole("dialog", { name: "Ürün veya hizmet ekle" });
      await urunPenceresi.getByLabel("Miktar").fill("12");
      await urunPenceresi.getByRole("button", { name: "+ Ekle" }).click();
      await expect(page.getByLabel("Birim fiyat")).toHaveValue("185");
      await expect(page.getByText("2.530,80 TL").first()).toBeVisible();
      await expect(page).toHaveScreenshot(`fatura-formu-doldurulmus-${gorunum.ad}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        // Seçili cari yazılı arama kutusunun metni koşucuda koşudan koşuya alt piksel kayıyor
        // (300-550 px, tek satır); görünür bir fark değil.
        maxDiffPixels: 1000,
      });

      await page.getByRole("button", { name: "Satır ayrıntıları" }).click();
      await expect(page.getByLabel("GİB istisna kodu")).toBeVisible();
      await expect(page).toHaveScreenshot(`fatura-satir-ayrintisi-${gorunum.ad}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
      });
    });

    test("veri dolu cari ve stok listeleri görsel olarak korunur", async ({ page }) => {
      await apiMockla(page);
      await veriDoluAnaKayitMockla(page);

      await page.goto("/panel/cari");
      await expect(page.getByText("ABC Makina Sanayi ve Ticaret Limited Şirketi İstanbul Avrupa Yakası Şubesi")).toBeVisible();
      await expect(page.getByRole("table").getByText("Bloke", { exact: true })).toBeVisible();
      await expect(page).toHaveScreenshot(`cari-listesi-veri-dolu-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });

      await page.goto("/panel/stok");
      await expect(page.getByText("A4 Fotokopi Kağıdı 80 gr Beyaz 500 Yaprak Ekonomik Ofis Paketi")).toBeVisible();
      await expect(page.getByText("1.250,00 TRY")).toBeVisible();
      await expect(page).toHaveScreenshot(`stok-listesi-veri-dolu-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });
    });

    test("kasa banka bakiyeleri ve tahsilat formu görsel olarak korunur", async ({ page }) => {
      await apiMockla(page);
      await veriDoluKasaBankaMockla(page);
      await page.goto("/panel/kasa-banka");
      await expect(page.getByText("₺184.200,00").first()).toBeVisible();
      await expect(page.getByText("SF2026000123 numaralı satış faturası tahsilatı")).toBeVisible();
      await expect(page).toHaveScreenshot(`kasa-banka-veri-dolu-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });

      await page.getByRole("button", { name: /Fiş Girişi/ }).click();
      // Fiş alanları etiketleriyle bulunur; cari aranabilir seçicidir.
      const fisFormu = page.locator("form").filter({ has: page.getByLabel("Kasa / banka hesabı") });
      await fisFormu.getByRole("group", { name: "İşlem tipi" }).getByRole("button", { name: "Tahsilat (para girişi)" }).click();
      await fisFormu.getByLabel("Kasa / banka hesabı").selectOption("banka:banka-1");
      await fisFormu.getByLabel(/^Tutar/).fill("12000");
      await fisFormu.getByLabel("Tarih").fill("2026-08-09");
      await fisFormu.getByRole("combobox", { name: "Cari hesap" }).click();
      await page.getByRole("option", { name: /ABC Makina/ }).click();
      await fisFormu.getByLabel("Açıklama").fill("SF2026000123 faturası banka tahsilatı");
      await expect(page).toHaveScreenshot(`kasa-banka-tahsilat-formu-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });
    });

    test("yönetici ana paneli ve bildirim merkezi görsel olarak korunur", async ({ page }) => {
      await apiMockla(page);
      await veriDoluAnaPanelMockla(page);
      // Panel bugünün tarihini ve son güncelleme saatini yazar; görüntü her gün değişmesin.
      await page.clock.setFixedTime(new Date("2026-08-09T10:30:00+03:00"));
      await page.goto("/panel");
      await expect(page.getByText("TekirExtra Örnek Sanayi ve Ticaret Limited Şirketi")).toBeVisible();
      await expect(page.getByText("₺839.300")).toBeVisible();
      await expect(page.getByText("Eşleşmemiş banka hareketleri")).toBeVisible();
      await expect(page).toHaveScreenshot(`yonetici-ana-paneli-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });

      const temaDugmesi = page.getByRole("button", { name: "Görünüm ve Tema Ayarlarını Aç" });
      await temaDugmesi.click();
      await expect(page.getByRole("dialog", { name: "Görünüm Ayarları" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Görünüm Ayarları" })).toBeHidden();
      await expect(temaDugmesi).toBeFocused();

      // Mobil üst çubukta arama düğmesi de aynı sınıfı taşır; bildirim düğmesi adıyla bulunur.
      await (gorunum.ad === "mobil"
        ? page.locator(".mobile-topbar").getByRole("button", { name: /^Bildirimler/ })
        : page.locator(".notification-nav")).click();
      await expect(page.getByLabel("Bildirim merkezi")).toBeVisible();
      await expect(page.getByText("22 açık kayıt")).toBeVisible();
      await expect(page).toHaveScreenshot(`bildirim-merkezi-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });
    });

    test("geri bildirim diyaloğu görsel olarak korunur", async ({ page }) => {
      await apiMockla(page);
      let gonderimDenemesi = 0;
      await page.route("**/api/v1/kullanim/geri-bildirim", (route) => {
        gonderimDenemesi += 1;
        return gonderimDenemesi === 1
          ? route.fulfill({ status: 500, json: { mesaj: "Geçici sunucu hatası" } })
          : route.fulfill({ json: { kaydedildi: true } });
      });
      await page.goto("/panel/satis");
      if (gorunum.ad === "mobil") {
        await page.getByRole("button", { name: "Ana menüyü aç" }).click();
      }
      await page.getByRole("button", { name: "Geri bildirim ver" }).click();
      await expect(page.getByRole("dialog", { name: "Deneyiminizi paylaşın" })).toBeVisible();
      await expect(page.locator("#ana-menu")).not.toHaveClass(/is-open/);
      await expect(page).toHaveScreenshot(`geri-bildirim-diyalogu-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });

      await page.getByRole("button", { name: "Gönder", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Geri bildirim gönderilemedi" })).toBeVisible();
      await expect(page).toHaveScreenshot(`geri-bildirim-hatasi-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });

      await page.getByRole("button", { name: "Gönder", exact: true }).click();
      const basari = page.getByRole("status");
      await expect(basari).toContainText("Geri bildiriminiz kaydedildi.");
      await expect(basari.getByRole("button", { name: "Kapat" })).toBeFocused();
      await expect(page).toHaveScreenshot(`geri-bildirim-basarili-${gorunum.ad}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
      });
    });
  });
}

for (const gorunum of [
  { ad: "kisa-dizustu", width: 1280, height: 720 },
  { ad: "tablet", width: 1024, height: 768 },
  { ad: "dar-mobil", width: 360, height: 800 },
] as const) {
  test(`${gorunum.ad} temel operasyon sayfaları görünür ve yatay taşma üretmez`, async ({ page }) => {
    // Beş sayfa sırayla açılır; dev sunucusu her birini ilk ziyarette derler.
    test.setTimeout(180_000);
    await page.setViewportSize({ width: gorunum.width, height: gorunum.height });
    await apiMockla(page);
    for (const sayfa of sayfalar) {
      await page.goto(sayfa.yol);
      await expect(page.getByRole("heading", { level: 1, name: sayfa.baslik })).toBeVisible({ timeout: 30_000 });
      const boyut = await page.evaluate(() => ({
        istemci: document.documentElement.clientWidth,
        icerik: document.documentElement.scrollWidth,
        tasanlar: Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((oge) => oge.getBoundingClientRect().right > window.innerWidth + 0.5)
          .slice(0, 5)
          .map((oge) => `${oge.tagName.toLowerCase()}.${oge.className} (${Math.round(oge.getBoundingClientRect().right)}px)`),
      }));
      expect.soft(boyut.icerik, `${sayfa.yol} belge düzeyinde yatay taşmamalı; taşanlar: ${boyut.tasanlar.join(", ") || "yok"}`).toBeLessThanOrEqual(boyut.istemci);
      await expect(page).toHaveScreenshot(
        `${sayfa.yol.replaceAll("/", "-").replace(/^-/, "")}-${gorunum.ad}.png`,
        { animations: "disabled", caret: "hide", fullPage: true },
      );
    }
  });
}
