import type { PazaryeriAdaptoru, SiparisSayfasi } from "./adaptor";
import { doviz, EK_UCRET_SKU, guvenliIstek, ILK_CEKIM_GUN, IPTAL_DURUMU, KARGO_SKU, kurus, sayi, siteKoku, vknTcknBul } from "./eticaret-ortak";
import type { NormalizeSiparis, PazaryeriConfig, PazaryeriStokFiyat } from "./trendyol.adapter";

/**
 * ETC-12: İdeaSoft Admin API (REST, apidoc.ideasoft.dev). Yetki OAuth2 authorization_code:
 * firma panelden "İdeaSoft'ta yetki ver"e basar, İdeaSoft dönüş adresine `code` gönderir, kod
 * 30 sn içinde anahtara çevrilir. Erişim anahtarı 24 saat, yenileme anahtarı 2 ay geçerlidir ve
 * HER yenilemede değişir (eskisi geçersiz olur) → yenileme bağlantı kaydında kilit altında yapılır
 * (`anahtarDeposu`), iki süreç aynı anahtarı harcamaz.
 *
 * Config: `servisAdresi` mağaza adresi, `saticiId` Client ID, `parola` Client Secret;
 * yetkiden sonra `erisimAnahtari`, `erisimBitis`, `yenilemeAnahtari`.
 *
 * Sipariş listesinde değişiklik zamanı süzgeci yok (yalnız `startCreatedAt` gün ve `sinceId`):
 * imleç son görülen sipariş kimliğidir; ödemesi/onayı bekleyen siparişler imleçte tutulur ve her
 * çalıştırmada `ids=` ile yeniden sorulur (30 gün sonra bırakılır).
 */
const SAYFA = 100;
const BEKLEYEN_UST = 100;
const BEKLEME_GUN = 30;

export interface IdeasoftAnahtar { erisimAnahtari: string; erisimBitis: string; yenilemeAnahtari: string }

export function ideasoftKok(config: Pick<PazaryeriConfig, "servisAdresi">): string {
  return siteKoku(config.servisAdresi);
}

/** Dönüş adresi yalnız panelin İdeaSoft dönüş sayfası olabilir (İdeaSoft'ta kayıtlı adresle aynı olmalı). */
export const IDEASOFT_DONUS_YOLU = "/panel/ayarlar/pazaryerleri/ideasoft";
export function ideasoftDonusAdresiGecerli(adres: string): boolean {
  try {
    const u = new URL(adres);
    return (u.protocol === "https:" || u.protocol === "http:") && u.pathname === IDEASOFT_DONUS_YOLU && !u.search && !u.hash && !u.username && !u.password;
  } catch { return false; }
}

export function ideasoftYetkiAdresi(config: PazaryeriConfig, state: string, donusAdresi: string): string {
  if (!config.saticiId) throw new Error("İdeaSoft Client ID zorunludur");
  const u = new URL(`${ideasoftKok(config)}/panel/auth`);
  u.searchParams.set("client_id", config.saticiId); u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state); u.searchParams.set("redirect_uri", donusAdresi);
  return u.toString();
}

async function tokenIstegi(config: PazaryeriConfig, alanlar: Record<string, string>, simdi = Date.now()): Promise<IdeasoftAnahtar> {
  if (!config.saticiId || !config.parola) throw new Error("İdeaSoft Client ID ve Client Secret zorunludur");
  const govde = new URLSearchParams({ client_id: config.saticiId, client_secret: config.parola, ...alanlar });
  const yanit = await guvenliIstek(`${ideasoftKok(config)}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: govde.toString() });
  const v = await yanit.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!yanit.ok || !v.access_token || !v.refresh_token) {
    const neden = v.error_description || v.error || `HTTP ${yanit.status}`;
    throw new Error(`İdeaSoft yetkisi alınamadı: ${String(neden).slice(0, 200)}`);
  }
  return { erisimAnahtari: v.access_token, yenilemeAnahtari: v.refresh_token, erisimBitis: new Date(simdi + (v.expires_in ?? 86_400) * 1000).toISOString() };
}

/** Yetki kodunu (30 sn geçerli) anahtara çevirir. */
export function ideasoftKoduAnahtaraCevir(config: PazaryeriConfig, kod: string, donusAdresi: string) {
  return tokenIstegi(config, { grant_type: "authorization_code", code: kod, redirect_uri: donusAdresi });
}

export function ideasoftAnahtarYenile(config: PazaryeriConfig) {
  if (!config.yenilemeAnahtari) throw new Error("İdeaSoft yetkisi verilmemiş; bağlantı penceresinde \"İdeaSoft'ta yetki ver\" düğmesine basın");
  return tokenIstegi(config, { grant_type: "refresh_token", refresh_token: config.yenilemeAnahtari });
}

const gecerli = (c: PazaryeriConfig, payMs = 120_000) => Boolean(c.erisimAnahtari && c.erisimBitis && Date.parse(c.erisimBitis) - payMs > Date.now());

// ---- Sipariş dönüştürme ----

interface IdeasoftAdres { firstname?: string; surname?: string; country?: string; location?: string; subLocation?: string; address?: string; phoneNumber?: string; mobilePhoneNumber?: string; zipCode?: string; invoiceType?: string; taxNo?: string; taxOffice?: string; identityRegistrationNumber?: string }
export interface IdeasoftSiparis {
  id: number; transactionId?: string; status?: string; paymentStatus?: string; createdAt?: string; currency?: string;
  customerFirstname?: string; customerSurname?: string; customerEmail?: string; customerPhone?: string;
  amount?: number; taxAmount?: number; generalAmount?: number; finalAmount?: number; shippingAmount?: number; additionalServiceAmount?: number;
  billingAddress?: IdeasoftAdres | null; shippingAddress?: IdeasoftAdres | null;
  orderItems?: Array<{ id: number; productName?: string; productSku?: string; productBarcode?: string; productPrice?: number; productQuantity?: number; productTax?: number; product?: { id?: number } | null }>;
}

const IPTAL = new Set(["cancelled", "refunded", "deleted"]);
/** Ödemesi ya da onayı beklenen sipariş: henüz faturalanmaz, imleçte bekletilir. */
export function ideasoftBekliyorMu(s: Pick<IdeasoftSiparis, "status" | "paymentStatus">): boolean {
  if (IPTAL.has(s.status ?? "")) return false;
  if (s.paymentStatus === "failed") return false;
  return s.status === "waiting_for_payment" || (s.status === "waiting_for_approval" && s.paymentStatus !== "success");
}

/** İdeaSoft tarihi `2018-02-21T09:36:03+0300` biçiminde gelir. */
function tarih(t?: string): string | undefined {
  if (!t) return undefined;
  const d = Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d) ? undefined : new Date(d).toISOString();
}

/**
 * Kalem birim fiyatı: belge `productPrice`ın KDV dahil olup olmadığını söylemiyor ve indirimler
 * (kalem, havale, kupon, promosyon) ayrı alanlarda. Fatura toplamının siparişle tutması için ürün
 * payı (genel toplam − kargo − ek hizmet) kalemlere KDV dahil ağırlıklarıyla dağıtılır.
 */
export function ideasoftSiparisDonustur(s: IdeasoftSiparis): NormalizeSiparis | null {
  const iptal = IPTAL.has(s.status ?? "");
  if (!iptal && (s.paymentStatus === "failed" || ideasoftBekliyorMu(s))) return null;
  const kalemler = s.orderItems ?? [];
  const kargo = kurus(sayi(s.shippingAmount));
  const ekHizmet = kurus(sayi(s.additionalServiceAmount));
  const genel = sayi(s.generalAmount) || kurus(sayi(s.amount) + sayi(s.taxAmount) + kargo + ekHizmet);
  const son = sayi(s.finalAmount) || genel;
  const vadeFarki = kurus(son - genel);
  const urunPayi = kurus(genel - kargo - ekHizmet);
  const agirlik = kalemler.map((k) => Math.max(0, sayi(k.productPrice)) * (sayi(k.productQuantity) || 1) * (1 + sayi(k.productTax) / 100));
  const toplamAgirlik = agirlik.reduce((a, b) => a + b, 0);
  const satirlar: NormalizeSiparis["satirlar"] = kalemler.map((k, i) => {
    const miktar = sayi(k.productQuantity) || 1;
    const pay = toplamAgirlik > 0 ? (urunPayi * agirlik[i]!) / toplamAgirlik : urunPayi / kalemler.length;
    return { hariciSatirId: String(k.id), sku: (k.productSku || k.productBarcode || String(k.product?.id ?? k.id)).trim(), barkod: k.productBarcode || undefined, urunAdi: k.productName || "Ürün", miktar, birimFiyat: kurus(pay / miktar), kdvOrani: k.productTax ?? null };
  });
  if (kargo > 0) satirlar.push({ hariciSatirId: "kargo", sku: KARGO_SKU, urunAdi: "Kargo", miktar: 1, birimFiyat: kargo, kdvOrani: null });
  if (ekHizmet > 0) satirlar.push({ hariciSatirId: "ek-hizmet", sku: EK_UCRET_SKU, urunAdi: "Ek hizmet (hediye paketi vb.)", miktar: 1, birimFiyat: ekHizmet, kdvOrani: null });
  if (vadeFarki > 0) satirlar.push({ hariciSatirId: "vade-farki", sku: EK_UCRET_SKU, urunAdi: "Taksit vade farkı", miktar: 1, birimFiyat: vadeFarki, kdvOrani: null });
  const b = s.billingAddress ?? {};
  const ad = [b.firstname, b.surname].filter(Boolean).join(" ") || [s.customerFirstname, s.customerSurname].filter(Boolean).join(" ");
  const kurumsal = b.invoiceType === "corporate";
  return {
    hariciId: String(s.id), siparisNo: String(s.id), hariciDurum: iptal ? IPTAL_DURUMU : (s.status ?? ""), siparisTarihi: tarih(s.createdAt) ?? new Date().toISOString(),
    musteriUnvani: (ad || s.customerEmail || "Web müşterisi").slice(0, 200), musteriEposta: s.customerEmail || undefined, musteriTelefon: s.customerPhone || b.mobilePhoneNumber || b.phoneNumber || undefined,
    vknTckn: kurumsal ? vknTcknBul(b.taxNo, b.identityRegistrationNumber) : vknTcknBul(b.identityRegistrationNumber, b.taxNo),
    dovizCinsi: doviz(s.currency), toplam: kurus(son),
    teslimatAdresi: { fatura: { ad, adres: b.address, il: b.location, ilce: b.subLocation, postaKodu: b.zipCode, ulke: b.country, vergiDairesi: b.taxOffice, faturaTipi: b.invoiceType, islemNo: s.transactionId }, teslimat: s.shippingAddress ?? undefined },
    satirlar,
  };
}

// ---- İmleç ----

export interface IdeasoftImlec { sinceId?: number; bekleyen?: Array<{ id: number; t: string }> }
export function ideasoftImlecOku(imlec: string | null | undefined): IdeasoftImlec {
  if (!imlec) return {};
  try {
    const v = JSON.parse(imlec) as IdeasoftImlec;
    return { sinceId: Number.isInteger(v.sinceId) && v.sinceId! > 0 ? v.sinceId : undefined, bekleyen: Array.isArray(v.bekleyen) ? v.bekleyen.filter((b) => Number.isInteger(b.id) && typeof b.t === "string") : [] };
  } catch { return {}; }
}

// ---- Ürün ----

export interface IdeasoftUrun { id: number; sku?: string; barcode?: string; stockAmount?: number; price1?: number; tax?: number; taxIncluded?: number; [alan: string]: unknown }

/** Gönderilecek `price1`: ürün "KDV dahil" işaretli değilse KDV hariç fiyata çevrilir. */
export function ideasoftFiyat(urun: Pick<IdeasoftUrun, "tax" | "taxIncluded">, kdvDahil: number): number {
  return urun.taxIncluded === 0 ? kurus(kdvDahil / (1 + sayi(urun.tax) / 100)) : kurus(kdvDahil);
}

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class IdeasoftAdapter implements PazaryeriAdaptoru {
  /** Geçerli erişim anahtarı; süresi dolmuşsa (ya da `zorla`) kayıt kilidi altında yenilenir. */
  private async anahtar(config: PazaryeriConfig, zorla = false): Promise<string> {
    if (!zorla && gecerli(config)) return config.erisimAnahtari!;
    const depo = config.anahtarDeposu;
    if (!depo) throw new Error("İdeaSoft anahtarı yenilenemiyor (kayıt erişimi yok)");
    const eski = config.erisimAnahtari;
    const guncel = await depo.kilitliGuncelle(async (kayitli) => {
      // Başka süreç kilitten önce yenilediyse onun anahtarı kullanılır.
      if (gecerli(kayitli) && (!zorla || kayitli.erisimAnahtari !== eski)) return null;
      return ideasoftAnahtarYenile(kayitli);
    });
    Object.assign(config, { erisimAnahtari: guncel.erisimAnahtari, erisimBitis: guncel.erisimBitis, yenilemeAnahtari: guncel.yenilemeAnahtari });
    if (!guncel.erisimAnahtari) throw new Error("İdeaSoft yetkisi verilmemiş; bağlantı penceresinde \"İdeaSoft'ta yetki ver\" düğmesine basın");
    return guncel.erisimAnahtari;
  }

  /** 429'da kısa bekleyip yeniden dener (İdeaSoft sınırı dinamik); 401'de anahtarı bir kez yeniler. */
  async istek<T>(config: PazaryeriConfig, yol: string, secenek: { method?: string; govde?: unknown; sorgu?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const url = new URL(`${ideasoftKok(config)}${yol}`);
    for (const [k, v] of Object.entries(secenek.sorgu ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    let yenilendi = false;
    for (let deneme = 0; ; deneme++) {
      const yanit = await guvenliIstek(url.toString(), { method: secenek.method ?? "GET", headers: { Authorization: `Bearer ${await this.anahtar(config)}`, Accept: "application/json", ...(secenek.govde !== undefined ? { "Content-Type": "application/json" } : {}) }, body: secenek.govde !== undefined ? JSON.stringify(secenek.govde) : undefined });
      if (yanit.status === 401 && !yenilendi) { yenilendi = true; await this.anahtar(config, true); continue; }
      if (yanit.status === 429 && deneme < 4) { const sn = Number(yanit.headers.get("retry-after")); await bekle(Number.isFinite(sn) && sn > 0 ? Math.min(sn, 30) * 1000 : 1500 * (deneme + 1)); continue; }
      if (!yanit.ok) {
        const govde = (await yanit.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        if (yanit.status === 401 || yanit.status === 403) throw new Error(`İdeaSoft: yetki reddedildi (HTTP ${yanit.status}); API izinlerini kontrol edip yeniden yetki verin`);
        throw new Error(`İdeaSoft: HTTP ${yanit.status}${govde ? ` · ${govde}` : ""}`);
      }
      return (yanit.status === 204 ? undefined : await yanit.json()) as T;
    }
  }

  async siparisleriCek(config: PazaryeriConfig, imlec?: string | null): Promise<SiparisSayfasi> {
    const durum = ideasoftImlecOku(imlec);
    const ham = await this.istek<IdeasoftSiparis[]>(config, "/admin-api/orders", { sorgu: durum.sinceId
      ? { sinceId: durum.sinceId, sort: "id", limit: SAYFA }
      : { startCreatedAt: new Date(Date.now() - ILK_CEKIM_GUN * 86_400_000).toISOString().slice(0, 10), sort: "id", limit: SAYFA } });
    const devamVar = ham.length === SAYFA;
    const simdi = new Date().toISOString();
    const sinir = Date.now() - BEKLEME_GUN * 86_400_000;
    const eskiBekleyen = (durum.bekleyen ?? []).filter((b) => Date.parse(b.t) > sinir);
    // Son sayfada bekleyen siparişler yeniden sorulur; dönmeyen (silinen) bırakılır.
    const sorgulanan: IdeasoftSiparis[] = [];
    if (!devamVar) {
      const sorulan = eskiBekleyen.filter((b) => !ham.some((s) => s.id === b.id)).map((b) => b.id);
      for (let i = 0; i < sorulan.length; i += SAYFA) sorgulanan.push(...await this.istek<IdeasoftSiparis[]>(config, "/admin-api/orders", { sorgu: { ids: sorulan.slice(i, i + SAYFA).join(","), limit: SAYFA } }));
    }
    const tumu = [...ham, ...sorgulanan];
    const zaman = new Map(eskiBekleyen.map((b) => [b.id, b.t]));
    const korunan = devamVar ? eskiBekleyen.filter((b) => !tumu.some((s) => s.id === b.id)) : [];
    const bekleyen = [...korunan, ...tumu.filter(ideasoftBekliyorMu).map((s) => ({ id: s.id, t: zaman.get(s.id) ?? simdi }))].slice(-BEKLEYEN_UST);
    const sinceId = Math.max(durum.sinceId ?? 0, ...ham.map((s) => s.id));
    const siparisler = tumu.map(ideasoftSiparisDonustur).filter((s): s is NormalizeSiparis => Boolean(s));
    return { siparisler, sonrakiImlec: JSON.stringify({ ...(sinceId > 0 ? { sinceId } : {}), bekleyen }), devamVar };
  }

  /** SKU (yoksa barkod) ile bulunan ürünün stok ve `price1` değeri; değişmeyen ürün gönderilmez, yeni ürün açılmaz. */
  async stokFiyatGonder(config: PazaryeriConfig, kalemler: PazaryeriStokFiyat[]): Promise<{ gonderilen: number; islemIdleri: string[]; bulunamayan: number }> {
    const urunler: IdeasoftUrun[] = [];
    let sinceId: number | undefined;
    for (let i = 0; i < 500; i++) {
      const sayfa = await this.istek<IdeasoftUrun[]>(config, "/admin-api/products", { sorgu: { sort: "id", limit: SAYFA, sinceId } });
      urunler.push(...sayfa);
      if (sayfa.length < SAYFA) break;
      sinceId = sayfa[sayfa.length - 1]!.id;
    }
    const bySku = new Map(urunler.filter((u) => u.sku).map((u) => [u.sku!.trim(), u]));
    const byBarkod = new Map(urunler.filter((u) => u.barcode).map((u) => [u.barcode!.trim(), u]));
    let gonderilen = 0, bulunamayan = 0;
    for (const k of kalemler) {
      const u = bySku.get(k.sku) ?? (k.barkod ? byBarkod.get(k.barkod) : undefined);
      if (!u) { bulunamayan++; continue; }
      const stok = Math.max(0, Math.floor(k.miktar));
      const fiyat = k.fiyat > 0 ? ideasoftFiyat(u, k.fiyat) : sayi(u.price1);
      if (sayi(u.stockAmount) === stok && Math.abs(sayi(u.price1) - fiyat) < 0.005) continue;
      // PUT tüm ürün nesnesini ister (zorunlu alanlar); okunan nesne yalnız stok ve fiyatı değişerek geri yazılır.
      await this.istek(config, `/admin-api/products/${u.id}`, { method: "PUT", govde: { ...u, stockAmount: stok, price1: fiyat } });
      gonderilen++;
    }
    return { gonderilen, islemIdleri: [], bulunamayan };
  }

  async sina(config: PazaryeriConfig) {
    const son = await this.istek<IdeasoftSiparis[]>(config, "/admin-api/orders", { sorgu: { sort: "-id", limit: 1 } });
    return { mesaj: son[0] ? `İdeaSoft bağlantısı çalışıyor; son sipariş #${son[0].id}.` : "İdeaSoft bağlantısı çalışıyor; henüz sipariş yok." };
  }
}
