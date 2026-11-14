import { afterEach, describe, expect, it, vi } from "vitest";
import { eticaretKimlikHatasi } from "@tekirextra/shared";

const istekler: Array<{ url: string; init: RequestInit }> = [];
let yanitlar: Array<(url: string, init: RequestInit) => Response> = [];
vi.mock("../core/guvenlik/dis-istek", () => ({
  disFetch: vi.fn(async (url: string, init: RequestInit) => {
    istekler.push({ url: String(url), init });
    const y = yanitlar.shift();
    if (!y) throw new Error(`beklenmeyen istek ${url}`);
    return y(String(url), init);
  }),
}));

import { IdeasoftAdapter, ideasoftBekliyorMu, ideasoftDonusAdresiGecerli, ideasoftFiyat, ideasoftSiparisDonustur, ideasoftYetkiAdresi, type IdeasoftSiparis } from "./ideasoft.adapter";
import type { AnahtarDeposu, PazaryeriConfig } from "./trendyol.adapter";

const json = (v: unknown, durum = 200) => () => new Response(JSON.stringify(v), { status: durum, headers: { "Content-Type": "application/json" } });
afterEach(() => { istekler.length = 0; yanitlar = []; });

const ileri = () => new Date(Date.now() + 3_600_000).toISOString();
const temel = (ek: Partial<PazaryeriConfig> = {}): PazaryeriConfig => ({ kullaniciAdi: "", servisAdresi: "https://deneme.myideasoft.com/", saticiId: "7_abc", parola: "sir", erisimAnahtari: "ERISIM", erisimBitis: ileri(), yenilemeAnahtari: "YENI1", ...ek });

/** Belgedeki alan adları (apidoc.ideasoft.dev Order/OrderItem/BillingAddress). */
const siparis = (ek: Partial<IdeasoftSiparis> = {}): IdeasoftSiparis => ({
  id: 120, transactionId: "c88728ce28151", status: "approved", paymentStatus: "success", createdAt: "2026-11-10T09:36:03+0300", currency: "TL",
  customerFirstname: "Ayşe", customerSurname: "Kaya", customerEmail: "ayse@example.com", customerPhone: "05550000000",
  amount: 250, taxAmount: 50, shippingAmount: 30, additionalServiceAmount: 0, generalAmount: 330, finalAmount: 330,
  billingAddress: { firstname: "Ayşe", surname: "Kaya", location: "İstanbul", subLocation: "Kadıköy", address: "Moda Cd. 1", invoiceType: "individual", identityRegistrationNumber: "12345678901" },
  orderItems: [
    { id: 1, productName: "Kupa", productSku: "KUPA-01", productBarcode: "869000000001", productPrice: 50, productQuantity: 2, productTax: 20 },
    { id: 2, productName: "Tabak", productSku: "TABAK-01", productPrice: 150, productQuantity: 1, productTax: 20 },
  ],
  ...ek,
});

describe("İdeaSoft kimlik ve yetki (ETC-12)", () => {
  it("katalog kuralı mağaza adresi, Client ID ve Secret ister", () => {
    expect(eticaretKimlikHatasi("ideasoft", { saticiId: "a", parola: "b" })).toMatch(/Mağaza adresi/);
    expect(eticaretKimlikHatasi("ideasoft", { servisAdresi: "https://x.myideasoft.com", saticiId: "a" })).toMatch(/Client/);
    expect(eticaretKimlikHatasi("ideasoft", { servisAdresi: "https://x.myideasoft.com", saticiId: "a", parola: "b" })).toBeNull();
  });

  it("dönüş adresi yalnız panelin İdeaSoft sayfası olabilir", () => {
    expect(ideasoftDonusAdresiGecerli("http://localhost:3100/panel/ayarlar/pazaryerleri/ideasoft")).toBe(true);
    expect(ideasoftDonusAdresiGecerli("https://evil.example/panel/ayarlar/pazaryerleri/ideasoft?x=1")).toBe(false);
    expect(ideasoftDonusAdresiGecerli("https://evil.example/baska")).toBe(false);
    expect(ideasoftDonusAdresiGecerli("javascript:alert(1)")).toBe(false);
  });

  it("yetki adresi belgedeki parametrelerle mağaza alan adında üretilir", () => {
    const u = new URL(ideasoftYetkiAdresi(temel(), "STATE", "https://panel.example/panel/ayarlar/pazaryerleri/ideasoft"));
    expect(u.origin + u.pathname).toBe("https://deneme.myideasoft.com/panel/auth");
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: "7_abc", response_type: "code", state: "STATE", redirect_uri: "https://panel.example/panel/ayarlar/pazaryerleri/ideasoft" });
  });

  it("süresi dolan anahtar kilitli depo üzerinden yenilenir, yeni yenileme anahtarı yazılır", async () => {
    let kayitli = temel({ erisimAnahtari: "ESKI", erisimBitis: new Date(Date.now() - 1000).toISOString() });
    const depo: AnahtarDeposu = { kilitliGuncelle: async (is) => { const y = await is(kayitli); if (y) kayitli = { ...kayitli, ...y }; return kayitli; } };
    yanitlar = [json({ access_token: "YENI_ERISIM", refresh_token: "YENI2", expires_in: 86400 }), json([])];
    const r = await new IdeasoftAdapter().sina({ ...kayitli, anahtarDeposu: depo });
    expect(r.mesaj).toMatch(/henüz sipariş yok/);
    expect(istekler[0]!.url).toBe("https://deneme.myideasoft.com/oauth/v2/token");
    expect(Object.fromEntries(new URLSearchParams(String(istekler[0]!.init.body)))).toEqual({ client_id: "7_abc", client_secret: "sir", grant_type: "refresh_token", refresh_token: "YENI1" });
    expect((istekler[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer YENI_ERISIM");
    expect(kayitli.yenilemeAnahtari).toBe("YENI2");
  });

  it("başka süreç kilitten önce yenilediyse yenileme isteği atılmaz", async () => {
    const kayitli = temel({ erisimAnahtari: "BASKASI", erisimBitis: ileri(), yenilemeAnahtari: "YENI9" });
    const depo: AnahtarDeposu = { kilitliGuncelle: async (is) => { expect(await is(kayitli)).toBeNull(); return kayitli; } };
    yanitlar = [json([{ id: 7 }])];
    await new IdeasoftAdapter().sina(temel({ erisimBitis: new Date(0).toISOString(), anahtarDeposu: depo }));
    expect(istekler).toHaveLength(1);
    expect((istekler[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer BASKASI");
  });

  it("yetki verilmemiş bağlantı anlaşılır hata verir", async () => {
    const kayitli = temel({ erisimAnahtari: undefined, erisimBitis: undefined, yenilemeAnahtari: undefined });
    const depo: AnahtarDeposu = { kilitliGuncelle: async (is) => { await is(kayitli); return kayitli; } };
    await expect(new IdeasoftAdapter().sina({ ...kayitli, anahtarDeposu: depo })).rejects.toThrow(/yetki ver/);
  });

  it("401'de anahtar bir kez yenilenip istek tekrarlanır; 429'da beklenip yeniden denenir", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let kayitli = temel();
    const depo: AnahtarDeposu = { kilitliGuncelle: async (is) => { const y = await is(kayitli); if (y) kayitli = { ...kayitli, ...y }; return kayitli; } };
    yanitlar = [json({}, 401), json({ access_token: "T2", refresh_token: "R2", expires_in: 86400 }), () => new Response("", { status: 429, headers: { "retry-after": "1" } }), json([{ id: 9 }])];
    const p = new IdeasoftAdapter().sina({ ...kayitli, anahtarDeposu: depo });
    await vi.runAllTimersAsync();
    expect((await p).mesaj).toMatch(/#9/);
    vi.useRealTimers();
    expect(istekler.map((i) => new URL(i.url).pathname)).toEqual(["/admin-api/orders", "/oauth/v2/token", "/admin-api/orders", "/admin-api/orders"]);
  });
});

describe("İdeaSoft sipariş dönüştürme (ETC-12)", () => {
  it("ürün payı KDV dahil dağıtılır, kargo ayrı satır, toplam siparişle tutar", () => {
    const n = ideasoftSiparisDonustur(siparis())!;
    expect(n.siparisNo).toBe("120");
    expect(n.siparisTarihi).toBe("2026-11-10T06:36:03.000Z");
    expect(n.dovizCinsi).toBe("TRY");
    expect(n.vknTckn).toBe("12345678901");
    expect(n.satirlar).toEqual([
      { hariciSatirId: "1", sku: "KUPA-01", barkod: "869000000001", urunAdi: "Kupa", miktar: 2, birimFiyat: 60, kdvOrani: 20 },
      { hariciSatirId: "2", sku: "TABAK-01", barkod: undefined, urunAdi: "Tabak", miktar: 1, birimFiyat: 180, kdvOrani: 20 },
      { hariciSatirId: "kargo", sku: "KARGO", urunAdi: "Kargo", miktar: 1, birimFiyat: 30, kdvOrani: null },
    ]);
    expect(n.satirlar.reduce((t, s) => t + s.birimFiyat * s.miktar, 0)).toBe(n.toplam);
  });

  it("taksit vade farkı ve kurumsal VKN", () => {
    const n = ideasoftSiparisDonustur(siparis({ finalAmount: 340, billingAddress: { firstname: "ACME", surname: "Ltd", invoiceType: "corporate", taxNo: "1234567890", taxOffice: "Kadıköy", identityRegistrationNumber: "12345678901" } }))!;
    expect(n.vknTckn).toBe("1234567890");
    expect(n.toplam).toBe(340);
    expect(n.satirlar.at(-1)).toMatchObject({ sku: "EK-UCRET", birimFiyat: 10, urunAdi: "Taksit vade farkı" });
  });

  it("ödemesi beklenen sipariş atlanır, başarısız ödeme düşer, iptal iptal olarak gelir", () => {
    expect(ideasoftBekliyorMu({ status: "waiting_for_approval", paymentStatus: "in_transaction" })).toBe(true);
    expect(ideasoftBekliyorMu({ status: "waiting_for_payment", paymentStatus: "success" })).toBe(true);
    expect(ideasoftBekliyorMu({ status: "approved", paymentStatus: "in_transaction" })).toBe(false);
    expect(ideasoftSiparisDonustur(siparis({ status: "waiting_for_approval", paymentStatus: "in_transaction" }))).toBeNull();
    expect(ideasoftSiparisDonustur(siparis({ paymentStatus: "failed" }))).toBeNull();
    expect(ideasoftSiparisDonustur(siparis({ status: "cancelled" }))!.hariciDurum).toBe("cancelled");
  });
});

describe("İdeaSoft imleç ve stok/fiyat (ETC-12)", () => {
  it("ilk çekim son 30 gün; bekleyen sipariş imleçte tutulur ve sonra yeniden sorulur", async () => {
    const a = new IdeasoftAdapter();
    yanitlar = [json([siparis({ id: 5 }), siparis({ id: 6, status: "waiting_for_approval", paymentStatus: "in_transaction" })])];
    const ilk = await a.siparisleriCek(temel());
    const u = new URL(istekler[0]!.url);
    expect(u.searchParams.get("startCreatedAt")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(u.searchParams.get("sort")).toBe("id");
    expect(ilk.siparisler.map((s) => s.hariciId)).toEqual(["5"]);
    expect(ilk.devamVar).toBe(false);
    const imlec = JSON.parse(ilk.sonrakiImlec!);
    expect(imlec.sinceId).toBe(6);
    expect(imlec.bekleyen.map((b: { id: number }) => b.id)).toEqual([6]);

    istekler.length = 0;
    yanitlar = [json([]), json([siparis({ id: 6 })])];
    const ikinci = await a.siparisleriCek(temel(), ilk.sonrakiImlec);
    expect(new URL(istekler[0]!.url).searchParams.get("sinceId")).toBe("6");
    expect(new URL(istekler[1]!.url).searchParams.get("ids")).toBe("6");
    expect(ikinci.siparisler.map((s) => s.hariciId)).toEqual(["6"]);
    expect(JSON.parse(ikinci.sonrakiImlec!)).toEqual({ sinceId: 6, bekleyen: [] });
  });

  it("price1 ürünün KDV dahil işaretine göre gönderilir", () => {
    expect(ideasoftFiyat({ taxIncluded: 1, tax: 20 }, 120)).toBe(120);
    expect(ideasoftFiyat({ taxIncluded: 0, tax: 20 }, 120)).toBe(100);
  });

  it("SKU/barkodla eşleşen ve değişen ürün tüm nesnesiyle PUT edilir, değişmeyen atlanır", async () => {
    yanitlar = [json([
      { id: 1, name: "Kupa", sku: "KUPA-01", stockAmount: 3, price1: 100, tax: 20, taxIncluded: 0, status: 1 },
      { id: 2, name: "Tabak", sku: "TABAK-01", barcode: "8690002", stockAmount: 5, price1: 240, tax: 20, taxIncluded: 1, status: 1 },
    ]), json({})];
    const r = await new IdeasoftAdapter().stokFiyatGonder(temel(), [
      { sku: "KUPA-01", barkod: "", miktar: 7.6, fiyat: 120 },
      { sku: "YOK", barkod: "8690002", miktar: 5, fiyat: 240 },
      { sku: "HIC", barkod: "", miktar: 1, fiyat: 10 },
    ]);
    expect(r).toEqual({ gonderilen: 1, islemIdleri: [], bulunamayan: 1 });
    expect(istekler[1]!.url).toBe("https://deneme.myideasoft.com/admin-api/products/1");
    expect(istekler[1]!.init.method).toBe("PUT");
    expect(JSON.parse(String(istekler[1]!.init.body))).toEqual({ id: 1, name: "Kupa", sku: "KUPA-01", stockAmount: 7, price1: 100, tax: 20, taxIncluded: 0, status: 1 });
  });
});
