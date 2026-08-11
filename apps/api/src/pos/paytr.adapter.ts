import { createHmac, timingSafeEqual } from "node:crypto";

export interface PaytrConfig { merchantId: string; merchantKey: string; merchantSalt: string; }
export interface PaytrCallback { hash: string; merchant_oid: string; status: string; total_amount: string; payment_amount: string; payment_type: string; currency: string; callback_id: string; merchant_id: string; }

const hmac = (metin: string, anahtar: string) => createHmac("sha256", anahtar).update(metin).digest("base64");
export class PaytrAdapter {
  async linkOlustur(config: PaytrConfig, girdi: { ad: string; tutarKurus: number; dovizCinsi: string; eposta: string; callbackUrl: string; callbackId: string }) {
    const currency = girdi.dovizCinsi === "TRY" ? "TL" : girdi.dovizCinsi; const price = String(girdi.tutarKurus); const maxInstallment = "1"; const linkType = "collection"; const lang = "tr";
    const token = hmac(`${girdi.ad}${price}${currency}${maxInstallment}${linkType}${lang}${girdi.eposta}${config.merchantSalt}`, config.merchantKey);
    const form = new URLSearchParams({ merchant_id: config.merchantId, name: girdi.ad, price, currency, max_installment: maxInstallment, link_type: linkType, lang, email: girdi.eposta, callback_link: girdi.callbackUrl, callback_id: girdi.callbackId, debug_on: "1", paytr_token: token });
    const yanit = await fetch("https://www.paytr.com/odeme/api/link/create", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form });
    const govde = await yanit.json().catch(() => ({})) as { status?: string; id?: string; link?: string; reason?: string };
    if (!yanit.ok || govde.status !== "success" || !govde.id || !govde.link) throw new Error(`PayTR ödeme linki oluşturulamadı: ${govde.reason ?? yanit.statusText}`);
    return { id: govde.id, link: govde.link };
  }
  callbackDogrula(config: PaytrConfig, girdi: PaytrCallback): boolean {
    const beklenen = hmac(`${girdi.callback_id}${girdi.merchant_oid}${config.merchantSalt}${girdi.status}${girdi.total_amount}`, config.merchantKey);
    const a = Buffer.from(beklenen); const b = Buffer.from(girdi.hash ?? ""); return a.length === b.length && timingSafeEqual(a, b);
  }
}
