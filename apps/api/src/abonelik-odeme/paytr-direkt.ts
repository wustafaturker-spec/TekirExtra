import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * PLT-13/14: PayTR Direkt API (abonelik tahsilatı). Kart formu tarayıcıdan
 * doğrudan PayTR'a gönderilir; kart verisi TekirExtra sunucusuna gelmez. Kart
 * saklama (utoken/ctoken) ve tekrarlayan ödeme mağazada PayTR'ın açtığı Non3D
 * ve tekrarlayan ödeme yetkisini ister. Belge: dev.paytr.com › Direkt API.
 */
export interface PaytrDirektConfig { merchantId: string; merchantKey: string; merchantSalt: string; testModu: boolean }

export const PAYTR_ODEME_ADRESI = "https://www.paytr.com/odeme";

const imza = (metin: string, anahtar: string) => createHmac("sha256", anahtar).update(metin).digest("base64");
const esit = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b ?? ""); return x.length === y.length && timingSafeEqual(x, y); };

/** merchant_oid yalnız harf-rakam, en çok 64: firma ve girişim kimliği tiresiz yan yana. */
export const merchantOid = (tenantId: string, denemeId: string) => `${tenantId}${denemeId}`.replace(/-/g, "");
export function merchantOidCoz(oid: string): { tenantId: string; denemeId: string } | null {
  if (!/^[0-9a-f]{64}$/i.test(oid)) return null;
  const uuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toLowerCase();
  return { tenantId: uuid(oid.slice(0, 32)), denemeId: uuid(oid.slice(32)) };
}

export interface PaytrOdemeGirdisi {
  merchantOid: string;
  userIp: string;
  eposta: string;
  /** "478.80" */
  tutar: string;
  urunAdi: string;
  adSoyad: string;
  adres: string;
  telefon: string;
  okUrl: string;
  failUrl: string;
}

function ortakAlanlar(c: PaytrDirektConfig, g: PaytrOdemeGirdisi, non3d: "0" | "1") {
  const alan = {
    merchant_id: c.merchantId, user_ip: g.userIp, merchant_oid: g.merchantOid, email: g.eposta, payment_amount: g.tutar,
    payment_type: "card", installment_count: "0", currency: "TL", test_mode: c.testModu ? "1" : "0", non_3d: non3d,
  };
  const paytr_token = imza(
    `${alan.merchant_id}${alan.user_ip}${alan.merchant_oid}${alan.email}${alan.payment_amount}${alan.payment_type}${alan.installment_count}${alan.currency}${alan.test_mode}${alan.non_3d}${c.merchantSalt}`,
    c.merchantKey,
  );
  return {
    ...alan, paytr_token, client_lang: "tr",
    merchant_ok_url: g.okUrl, merchant_fail_url: g.failUrl,
    user_name: g.adSoyad.slice(0, 60), user_address: g.adres.slice(0, 400), user_phone: g.telefon.slice(0, 20),
    user_basket: JSON.stringify([[g.urunAdi, g.tutar, 1]]),
  };
}

/** Kart formunun gizli alanları (kart alanlarını ödeyen doldurur). Kart kaydı istenirse store_card + varsa mevcut utoken. */
export function paytrFormAlanlari(c: PaytrDirektConfig, g: PaytrOdemeGirdisi, kart: { kaydet: boolean; utoken?: string }): Record<string, string> {
  return { ...ortakAlanlar(c, g, "0"), ...(kart.kaydet ? { store_card: "1", ...(kart.utoken ? { utoken: kart.utoken } : {}) } : {}) };
}

export interface PaytrBildirim {
  merchant_oid: string; status: string; total_amount: string; hash: string;
  failed_reason_code?: string; failed_reason_msg?: string; test_mode?: string; currency?: string; payment_amount?: string; utoken?: string;
}

/** Bildirim imzası: merchant_oid + salt + status + total_amount (total_amount kuruş). */
export function paytrBildirimDogrula(c: PaytrDirektConfig, b: PaytrBildirim): boolean {
  return esit(imza(`${b.merchant_oid}${c.merchantSalt}${b.status}${b.total_amount}`, c.merchantKey), b.hash);
}

export interface PaytrKart { ctoken: string; last_4?: string; require_cvv?: string | number; c_brand?: string; schema?: string }

export class PaytrDirektAdapter {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async form(yol: string, alanlar: Record<string, string>): Promise<any> {
    const yanit = await this.fetcher(`${PAYTR_ODEME_ADRESI}${yol}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(alanlar) });
    return yanit.json().catch(() => ({ status: "failed", reason: `PayTR HTTP ${yanit.status}` }));
  }

  async kartListesi(c: PaytrDirektConfig, utoken: string): Promise<PaytrKart[]> {
    const v = await this.form("/capi/list", { merchant_id: c.merchantId, utoken, paytr_token: imza(`${utoken}${c.merchantSalt}`, c.merchantKey) });
    if (Array.isArray(v)) return v as PaytrKart[];
    if (v?.status === "error") throw new Error(`PayTR kart listesi alınamadı: ${v.err_msg ?? "bilinmeyen hata"}`);
    return [];
  }

  async kartSil(c: PaytrDirektConfig, utoken: string, ctoken: string) {
    const v = await this.form("/capi/delete", { merchant_id: c.merchantId, ctoken, utoken, paytr_token: imza(`${ctoken}${utoken}${c.merchantSalt}`, c.merchantKey) });
    if (v?.status !== "success") throw new Error(`PayTR kartı silinemedi: ${v?.err_msg ?? v?.reason ?? "bilinmeyen hata"}`);
  }

  /**
   * Kayıtlı kartla tekrarlayan ödeme: yanıt eşzamanlı JSON. "wait_callback"
   * sonucu bildirimle gelir (aynı merchant_oid).
   */
  async tekrarlayanOdeme(c: PaytrDirektConfig, g: PaytrOdemeGirdisi, kart: { utoken: string; ctoken: string }): Promise<{ durum: "odendi" | "bekliyor" | "basarisiz"; hata?: string }> {
    const v = await this.form("", { ...ortakAlanlar(c, g, "1"), utoken: kart.utoken, ctoken: kart.ctoken, recurring_payment: "1" });
    if (v?.status === "success") return { durum: "odendi" };
    if (v?.status === "wait_callback") return { durum: "bekliyor" };
    return { durum: "basarisiz", hata: String(v?.msg ?? v?.reason ?? v?.err_msg ?? "PayTR ödemeyi onaylamadı").slice(0, 500) };
  }
}
