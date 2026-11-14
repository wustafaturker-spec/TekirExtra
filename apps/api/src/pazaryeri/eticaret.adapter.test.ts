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

import { adaptorCoz, ADAPTORLU_SAGLAYICILAR } from "./adaptor";
import { anahtarOnbelleginiSil, imlecOku, KARGO_SKU, kdvOraniTuret } from "./eticaret-ortak";
import { ikasSiparisDonustur } from "./ikas.adapter";
import { shopifyMagaza, shopifySiparisDonustur, type ShopifySiparis } from "./shopify.adapter";
import { ticimaxSiparisDonustur, ticimaxSiparisIstegi, ticimaxTarih } from "./ticimax.adapter";
import { wooSiparisDonustur, type WooSiparis } from "./woocommerce.adapter";

const json = (v: unknown, durum = 200) => () => new Response(JSON.stringify(v), { status: durum, headers: { "Content-Type": "application/json" } });
const xml = (v: string, durum = 200) => () => new Response(v, { status: durum, headers: { "Content-Type": "text/xml" } });
afterEach(() => { istekler.length = 0; yanitlar = []; anahtarOnbelleginiSil(); });

describe("ortak kurallar (ETC-03/04)", () => {
  it("kayıt dört siteyi ve dört pazaryerini içerir", () => {
    expect(ADAPTORLU_SAGLAYICILAR.sort()).toEqual(["amazon_tr", "hepsiburada", "ideasoft", "ikas", "n11", "shopify", "ticimax", "trendyol", "woocommerce"]);
    expect(adaptorCoz("trendyol")?.barkodZorunlu).toBe(true);
    expect(adaptorCoz("tsoft")).toBeNull();
  });

  it("ilk imleç son 30 gün; bozuk imleç baştan", () => {
    const simdi = new Date("2026-11-13T00:00:00Z");
    expect(imlecOku(null, simdi).sonra).toBe("2026-10-14T00:00:00.000Z");
    expect(imlecOku("{bozuk", simdi).sonra).toBe("2026-10-14T00:00:00.000Z");
    expect(imlecOku(JSON.stringify({ sonra: "2026-11-01T10:00:00.000Z", sayfa: 3 }), simdi)).toEqual({ sonra: "2026-11-01T10:00:00.000Z", sayfa: 3 });
  });

  it("KDV oranı tutardan standart orana yuvarlanır; vergisiz satırda null", () => {
    expect(kdvOraniTuret(100, 20)).toBe(20);
    expect(kdvOraniTuret(83.33, 16.67)).toBe(20);
    expect(kdvOraniTuret(100, 10.2)).toBe(10);
    expect(kdvOraniTuret(100, 0)).toBeNull();
  });

  it("kimlik kuralları: Shopify anahtar ya da istemci kimliği; Ticimax yetki kodu", () => {
    expect(eticaretKimlikHatasi("shopify", { kullaniciAdi: "magazam" })).toMatch(/erişim anahtarı/);
    expect(eticaretKimlikHatasi("shopify", { kullaniciAdi: "magazam.myshopify.com", apiAnahtari: "shpat_x" })).toBeNull();
    expect(eticaretKimlikHatasi("shopify", { kullaniciAdi: "magazam", saticiId: "id", parola: "s" })).toBeNull();
    expect(eticaretKimlikHatasi("ikas", { kullaniciAdi: "kötü ad", saticiId: "i", parola: "s" })).toMatch(/mağaza adı/);
    expect(eticaretKimlikHatasi("ticimax", { servisAdresi: "https://x.com" })).toMatch(/yetki kodu/);
    expect(eticaretKimlikHatasi("woocommerce", { servisAdresi: "https://x.com", kullaniciAdi: "ck_1", parola: "cs_1" })).toBeNull();
  });
});

const woo = (ek: Partial<WooSiparis> = {}): WooSiparis => ({
  id: 727, number: "727", status: "processing", currency: "TRY", date_created_gmt: "2026-11-10T08:00:00", date_modified_gmt: "2026-11-10T09:30:00", total: "1580.00",
  billing: { first_name: "Ayşe", last_name: "Kaya", address_1: "Atatürk Cd. 1", city: "Kadıköy", state: "İstanbul", postcode: "34710", country: "TR", email: "ayse@example.com", phone: "05550000000" },
  line_items: [
    { id: 315, name: "Kahve Fincanı", sku: "FNC-01", quantity: 2, total: "1000.00", total_tax: "200.00" },
    { id: 316, name: "Kitap", sku: "KTP-9", quantity: 1, total: "200.00", total_tax: "20.00" },
  ],
  shipping_lines: [{ id: 1, method_title: "Yurtiçi Kargo", total: "133.33", total_tax: "26.67" }],
  meta_data: [{ key: "_billing_tc_kimlik_no", value: "12345678901" }],
  ...ek,
});

describe("WooCommerce (ETC-08)", () => {
  it("satır fiyatı KDV dahil, kargo ayrı satır, TC kimlik meta alanından", () => {
    const s = wooSiparisDonustur(woo())!;
    expect(s.satirlar).toEqual([
      { hariciSatirId: "315", sku: "FNC-01", urunAdi: "Kahve Fincanı", miktar: 2, birimFiyat: 600, kdvOrani: 20 },
      { hariciSatirId: "316", sku: "KTP-9", urunAdi: "Kitap", miktar: 1, birimFiyat: 220, kdvOrani: 10 },
      { hariciSatirId: "kargo-1", sku: KARGO_SKU, urunAdi: "Yurtiçi Kargo", miktar: 1, birimFiyat: 160, kdvOrani: 20 },
    ]);
    expect(s.satirlar.reduce((t, x) => t + x.birimFiyat * x.miktar, 0)).toBe(s.toplam);
    expect(s).toMatchObject({ musteriUnvani: "Ayşe Kaya", vknTckn: "12345678901", siparisTarihi: "2026-11-10T08:00:00Z", hariciDurum: "processing" });
  });

  it("ödenmemiş alınmaz; iade/iptal iptal olarak gelir", () => {
    expect(wooSiparisDonustur(woo({ status: "pending" }))).toBeNull();
    expect(wooSiparisDonustur(woo({ status: "refunded" }))?.hariciDurum).toBe("cancelled");
  });

  it("değişiklik zamanına göre sayfalar; son sayfada imleç en son değişikliği saklar", async () => {
    const a = adaptorCoz("woocommerce")!;
    const config = { kullaniciAdi: "ck_1", parola: "cs_1", servisAdresi: "https://magaza.example.com/" };
    yanitlar.push(json(Array.from({ length: 50 }, (_, i) => woo({ id: i + 1, date_modified_gmt: `2026-11-10T09:${String(i).padStart(2, "0")}:00` }))), json([woo({ id: 99, date_modified_gmt: "2026-11-11T12:00:00" })]));
    const s1 = await a.siparisleriCek(config, null);
    expect(s1.devamVar).toBe(true);
    const u = new URL(istekler[0].url);
    expect(u.pathname).toBe("/wp-json/wc/v3/orders");
    expect(u.searchParams.get("orderby")).toBe("modified");
    expect(String((istekler[0].init.headers as Record<string, string>).Authorization)).toBe(`Basic ${Buffer.from("ck_1:cs_1").toString("base64")}`);
    const s2 = await a.siparisleriCek(config, s1.sonrakiImlec);
    expect(new URL(istekler[1].url).searchParams.get("page")).toBe("2");
    expect(s2.devamVar).toBe(false);
    expect(JSON.parse(s2.sonrakiImlec!)).toEqual({ sonra: "2026-11-11T12:00:00.000Z" });
  });

  it("http site adresi reddedilir", async () => {
    await expect(adaptorCoz("woocommerce")!.siparisleriCek({ kullaniciAdi: "a", parola: "b", servisAdresi: "http://x.com" })).rejects.toThrow(/https/);
  });
});

const para = (n: number) => ({ shopMoney: { amount: n.toFixed(2) } });
const shopify = (ek: Partial<ShopifySiparis> = {}): ShopifySiparis => ({
  id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-11-10T08:00:00Z", updatedAt: "2026-11-10T09:00:00Z", cancelledAt: null, displayFinancialStatus: "PAID",
  currencyCode: "TRY", taxesIncluded: true, email: "can@example.com", phone: null, note: null, totalPriceSet: para(1050),
  billingAddress: { name: "Can Demir", address1: "Cumhuriyet Mh.", city: "Çankaya", province: "Ankara", countryCodeV2: "TR" }, shippingAddress: null,
  customAttributes: [{ key: "TC Kimlik", value: "11111111110" }],
  lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", sku: "AYK-1", name: "Ayakkabı", quantity: 2, variant: { barcode: "8690001" }, originalTotalSet: para(1200), discountAllocations: [{ allocatedAmountSet: para(200) }], taxLines: [{ rate: 0.2, priceSet: para(166.67) }] }] },
  shippingLines: { nodes: [{ id: "gid://shopify/ShippingLine/1", title: "Standart", discountedPriceSet: para(50), taxLines: [{ rate: 0.2, priceSet: para(8.33) }] }] },
  ...ek,
});

describe("Shopify (ETC-09)", () => {
  it("indirim satıra dağıtılmış haliyle; KDV dahil mağazada vergi eklenmez", () => {
    const s = shopifySiparisDonustur(shopify())!;
    expect(s.satirlar).toEqual([
      { hariciSatirId: "gid://shopify/LineItem/1", sku: "AYK-1", barkod: "8690001", urunAdi: "Ayakkabı", miktar: 2, birimFiyat: 500, kdvOrani: 20 },
      { hariciSatirId: "gid://shopify/ShippingLine/1", sku: KARGO_SKU, urunAdi: "Standart", miktar: 1, birimFiyat: 50, kdvOrani: 20 },
    ]);
    expect(s).toMatchObject({ siparisNo: "#1001", toplam: 1050, vknTckn: "11111111110", musteriUnvani: "Can Demir" });
  });

  it("KDV hariç mağazada satıra vergi eklenir; iade iptal sayılır, bekleyen alınmaz", () => {
    const s = shopifySiparisDonustur(shopify({ taxesIncluded: false, totalPriceSet: para(1260) }))!;
    expect(s.satirlar[0].birimFiyat).toBe(583.34);
    expect(shopifySiparisDonustur(shopify({ displayFinancialStatus: "REFUNDED" }))?.hariciDurum).toBe("cancelled");
    expect(shopifySiparisDonustur(shopify({ displayFinancialStatus: "PENDING" }))).toBeNull();
  });

  it("istemci kimliğiyle anahtar alınır ve önbellekte tutulur", async () => {
    const a = adaptorCoz("shopify")!;
    const config = { kullaniciAdi: "Magazam", saticiId: "cid", parola: "sec" };
    const bos = json({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } });
    yanitlar.push(json({ access_token: "tok-1", expires_in: 86399 }), bos, bos);
    await a.siparisleriCek(config, null);
    await a.siparisleriCek(config, null);
    expect(istekler.map((i) => new URL(i.url).pathname)).toEqual(["/admin/oauth/access_token", "/admin/api/2025-10/graphql.json", "/admin/api/2025-10/graphql.json"]);
    expect(istekler[0].url).toBe("https://magazam.myshopify.com/admin/oauth/access_token");
    expect((istekler[1].init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("tok-1");
    expect(JSON.parse(String(istekler[1].init.body)).variables.q).toMatch(/^updated_at:>='/);
  });

  it("mağaza adı biçimi", () => {
    expect(shopifyMagaza("https://Magazam.myshopify.com/admin")).toBe("magazam.myshopify.com");
    expect(() => shopifyMagaza("evil.com/../x")).toThrow();
  });
});

describe("ikas (ETC-10)", () => {
  it("son fiyat KDV dahil, vergi oranı satırdan, iptal edilen satır atlanır", () => {
    const s = ikasSiparisDonustur({
      id: "o1", orderNumber: "1042", status: "CREATED", orderPaymentStatus: "PAID", orderedAt: Date.parse("2026-11-09T10:00:00Z"), updatedAt: Date.parse("2026-11-09T11:00:00Z"), currencyCode: "TRY", totalFinalPrice: 749.9,
      customer: { email: "el@example.com", fullName: "Elif Ak" },
      billingAddress: { firstName: "Elif", lastName: "Ak", taxNumber: "1234567890", taxOffice: "Kadıköy", company: "Ak Ltd", city: { name: "İstanbul" }, district: { name: "Kadıköy" } },
      orderLineItems: [
        { id: "l1", quantity: 1, finalPrice: 699.9, taxValue: 20, variant: { id: "v1", sku: "TS-M", barcodeList: ["869111"], name: "Tişört M" } },
        { id: "l2", quantity: 1, finalPrice: 99, taxValue: 20, status: "CANCELLED", variant: { id: "v2", sku: "X" } },
      ],
      shippingLines: [{ price: 50, title: "Kargo", taxValue: 20 }],
    })!;
    expect(s.satirlar).toEqual([
      { hariciSatirId: "l1", sku: "TS-M", barkod: "869111", urunAdi: "Tişört M", miktar: 1, birimFiyat: 699.9, kdvOrani: 20 },
      { hariciSatirId: "kargo-0", sku: KARGO_SKU, urunAdi: "Kargo", miktar: 1, birimFiyat: 50, kdvOrani: 20 },
    ]);
    expect(s).toMatchObject({ musteriUnvani: "Ak Ltd", vknTckn: "1234567890", siparisTarihi: "2026-11-09T10:00:00.000Z" });
  });

  it("anahtar mağazaya özgü adresten alınır; sipariş sorgusu sayfa ve tarihle", async () => {
    const a = adaptorCoz("ikas")!;
    yanitlar.push(json({ access_token: "ik-1", expires_in: 14400 }), json({ data: { listOrder: { hasNext: false, data: [] } } }));
    await a.siparisleriCek({ kullaniciAdi: "magazam", saticiId: "cid", parola: "sec" }, JSON.stringify({ sonra: "2026-11-01T00:00:00.000Z" }));
    expect(istekler[0].url).toBe("https://magazam.myikas.com/api/admin/oauth/token");
    expect(String(istekler[0].init.body)).toContain("grant_type=client_credentials");
    const govde = JSON.parse(String(istekler[1].init.body));
    expect(govde.variables).toEqual({ pagination: { page: 1, limit: 50 }, updatedAt: { gte: Date.parse("2026-11-01T00:00:00.000Z") } });
  });
});

describe("Ticimax (ETC-11)", () => {
  it("istek WSDL sırasıyla ve -1 süzgeçlerle; yetki kodu kaçışlı", () => {
    const x = ticimaxSiparisIstegi("A&B<1>", "2026-11-01T03:00:00", 50);
    expect(x).toContain("<UyeKodu>A&amp;B&lt;1&gt;</UyeKodu>");
    expect(x.indexOf("<a:DuzenlemeTarihiBas>")).toBeLessThan(x.indexOf("<a:EFaturaURL>"));
    expect(x.indexOf("<a:UrunGetir>true</a:UrunGetir>")).toBeLessThan(x.indexOf("<a:UyeID>-1</a:UyeID>"));
    expect(x).toContain("<a:BaslangicIndex>50</a:BaslangicIndex>");
  });

  it("birim tutar + KDV tutarı; kargo ayrı; iptal ve ön sipariş", () => {
    const s = ticimaxSiparisDonustur({
      ID: "22", SiparisNo: "TCX-22", Durum: "2", SiparisTarihi: "2026-11-10T12:00:00", AdiSoyadi: "Mert Su", Mail: "m@example.com", ParaBirimi: "TL", SiparisToplamTutari: "290", KargoTutari: "50",
      FaturaAdresi: { Adres: "Gül Sk. 3", Il: "İzmir", Ilce: "Bornova", VergiNo: "", isKurumsal: "false" },
      Urunler: { WebSiparisUrun: [{ ID: "5", StokKodu: "KLM-1", Barkod: "8691", UrunAdi: "Kalem", Adet: "2", Tutar: "100", KdvTutari: "20", KdvOrani: "20" }] },
    })!;
    expect(s.satirlar).toEqual([
      { hariciSatirId: "5", sku: "KLM-1", barkod: "8691", urunAdi: "Kalem", miktar: 2, birimFiyat: 120, kdvOrani: 20 },
      { hariciSatirId: "kargo", sku: KARGO_SKU, urunAdi: "Kargo", miktar: 1, birimFiyat: 50, kdvOrani: null },
    ]);
    expect(s).toMatchObject({ dovizCinsi: "TRY", toplam: 290, siparisTarihi: "2026-11-10T09:00:00.000Z", hariciDurum: "2" });
    expect(ticimaxSiparisDonustur({ ID: "1", Durum: "8" })?.hariciDurum).toBe("cancelled");
    expect(ticimaxSiparisDonustur({ ID: "1", Durum: "0" })).toBeNull();
    expect(ticimaxTarih("0001-01-01T00:00:00")).toBeUndefined();
  });

  it("SOAP yanıtı okunur; hata (Fault) mesajı iletilir", async () => {
    const a = adaptorCoz("ticimax")!;
    const config = { kullaniciAdi: "", apiAnahtari: "KOD", servisAdresi: "https://www.magaza.example.com" };
    yanitlar.push(xml(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><SelectSiparisResponse xmlns="http://tempuri.org/"><SelectSiparisResult xmlns:a="http://schemas.datacontract.org/2004/07/"><a:WebSiparis><a:Durum>1</a:Durum><a:DuzenlemeTarihi>2026-11-11T10:00:00</a:DuzenlemeTarihi><a:ID>7</a:ID><a:SiparisNo>S7</a:SiparisNo><a:SiparisToplamTutari>0</a:SiparisToplamTutari></a:WebSiparis></SelectSiparisResult></SelectSiparisResponse></s:Body></s:Envelope>`));
    const r = await a.siparisleriCek(config, null);
    expect(istekler[0].url).toBe("https://www.magaza.example.com/Servis/SiparisServis.svc");
    expect((istekler[0].init.headers as Record<string, string>).SOAPAction).toBe('"http://tempuri.org/ISiparisServis/SelectSiparis"');
    expect(r.siparisler.map((s) => s.siparisNo)).toEqual(["S7"]);
    expect(JSON.parse(r.sonrakiImlec!)).toEqual({ sonra: "2026-11-11T07:00:00.000Z" });
    yanitlar.push(xml(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>Yetkisiz üye kodu</faultstring></s:Fault></s:Body></s:Envelope>`, 500));
    await expect(a.siparisleriCek(config, null)).rejects.toThrow(/Yetkisiz üye kodu/);
  });

  it("stok stok koduyla, fiyat KDV dahil ve barkodla", async () => {
    const a = adaptorCoz("ticimax")!;
    yanitlar.push(xml("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><StokAdediGuncelleResponse/></s:Body></s:Envelope>"), xml("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><UpdateUrunFiyatResponse/></s:Body></s:Envelope>"));
    const r = await a.stokFiyatGonder({ kullaniciAdi: "", apiAnahtari: "KOD", servisAdresi: "https://www.magaza.example.com" }, [{ sku: "KLM-1", barkod: "8691", miktar: 7.9, fiyat: 120 }]);
    expect(r.gonderilen).toBe(1);
    expect(String(istekler[0].init.body)).toContain("<a:StokAdedi>7</a:StokAdedi><a:StokKodu>KLM-1</a:StokKodu>");
    expect(String(istekler[1].init.body)).toContain("<a:SatisFiyati>120.00</a:SatisFiyati>");
  });
});
