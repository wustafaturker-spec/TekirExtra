import { createHmac, randomBytes } from "node:crypto";
import { disFetch } from "../core/guvenlik/dis-istek";

export interface IyzicoConfig { apiKey: string; secretKey: string; baseUrl: string }

export function iyzicoTelefonuDuzenle(telefon?: string | null): string | undefined {
  if (!telefon) return undefined;
  let rakamlar = telefon.replace(/\D/g, "");
  if (rakamlar.length === 11 && rakamlar.startsWith("0")) rakamlar = `90${rakamlar.slice(1)}`;
  else if (rakamlar.length === 10) rakamlar = `90${rakamlar}`;
  if (rakamlar.length < 10 || rakamlar.length > 15) return undefined;
  return `+${rakamlar}`;
}

const metin = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
const sayi = (v: unknown) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : String(v));

/**
 * KSB-37: ödeme ayrıntısındaki kesinti ve kart bilgisi. Tutarlar metin döner
 * (kayan nokta toplamı yapılmaz). BIN ilk 6 haneyle sınırlıdır; tam kart
 * numarası ve ham yanıt dışarı verilmez.
 */
export function iyzicoKesintisi(veri: any) {
  const kalemler: unknown[] = Array.isArray(veri?.itemTransactions) ? veri.itemTransactions : [];
  const paylar = kalemler.map((k) => sayi((k as { merchantPayoutAmount?: unknown })?.merchantPayoutAmount));
  const bin = metin(veri?.binNumber)?.replace(/\D/g, "").slice(0, 6);
  const son4 = metin(veri?.lastFourDigits)?.replace(/\D/g, "").slice(-4);
  const fraud = Number(veri?.fraudStatus);
  return {
    saglayiciKomisyonu: sayi(veri?.iyziCommissionRateAmount),
    saglayiciUcreti: sayi(veri?.iyziCommissionFee),
    // Bir kalemin payı eksikse toplam yanlış olur; o durumda hiç verilmez.
    isyerineGecenKalemleri: paylar.length && paylar.every((p) => p !== undefined) ? (paylar as string[]) : undefined,
    kartMarkasi: metin(veri?.cardAssociation),
    kartAilesi: metin(veri?.cardFamily),
    kartTuru: metin(veri?.cardType),
    kartBin: bin || undefined,
    kartSon4: son4 && son4.length === 4 ? son4 : undefined,
    fraudDurumu: [1, 0, -1].includes(fraud) && veri?.fraudStatus !== undefined && veri?.fraudStatus !== null ? fraud : undefined,
    provizyonKodu: metin(veri?.authCode),
    hostReferansi: metin(veri?.hostReference),
  };
}
export type IyzicoKesintisi = ReturnType<typeof iyzicoKesintisi>;

export class IyzicoAdapter {
  private async istek(config: IyzicoConfig, path: string, govde: Record<string, unknown>, method: "POST" | "DELETE" = "POST"): Promise<any> {
    const body = JSON.stringify(govde); const randomKey = `${Date.now()}${randomBytes(8).toString("hex")}`;
    const signature = createHmac("sha256", config.secretKey).update(randomKey + path + body).digest("hex");
    const auth = Buffer.from(`apiKey:${config.apiKey}&randomKey:${randomKey}&signature:${signature}`).toString("base64");
    const yanit = await disFetch(`${config.baseUrl}${path}`, { method, headers: { Authorization: `IYZWSv2 ${auth}`, "x-iyzi-rnd": randomKey, "Content-Type": "application/json" }, body });
    const veri = await yanit.json().catch(() => ({})) as any;
    if (!yanit.ok || veri.status !== "success") throw new Error(veri.errorMessage ?? `iyzico servisi HTTP ${yanit.status}`);
    return veri;
  }

  async odemeBaslat(config: IyzicoConfig, girdi: Record<string, unknown>) {
    const veri = await this.istek(config, "/payment/iyzipos/checkoutform/initialize/auth/ecom", girdi);
    if (!veri.token || !veri.paymentPageUrl) throw new Error("iyzico ödeme tokenı veya sayfa adresi dönmedi");
    return { token: String(veri.token), odemeSayfasiUrl: String(veri.paymentPageUrl) };
  }

  async odemeSonucu(config: IyzicoConfig, token: string) {
    const veri = await this.istek(config, "/payment/iyzipos/checkoutform/auth/ecom/detail", { locale: "tr", token });
    return {
      basarili: veri.paymentStatus === "SUCCESS",
      odemeId: veri.paymentId ? String(veri.paymentId) : undefined,
      tutar: Number(veri.paidPrice ?? veri.price ?? 0),
      // KSB-36: sepet tutarı (tahsilat) ile müşterinin ödediği (vade farkı dahil) ayrı döner.
      fiyat: Number(veri.price ?? veri.paidPrice ?? 0),
      odenen: Number(veri.paidPrice ?? veri.price ?? 0),
      taksit: Number(veri.installment) >= 1 ? Number(veri.installment) : 1,
      kesinti: iyzicoKesintisi(veri),
      // KSB-43: iade sepet kalemi bazındadır; kalemlerin ödeme işlem numaraları.
      odemeIslemNolari: (Array.isArray(veri.itemTransactions) ? veri.itemTransactions : [])
        .map((k: { paymentTransactionId?: unknown }) => metin(k?.paymentTransactionId))
        .filter((x: string | undefined): x is string => Boolean(x)),
      dovizCinsi: String(veri.currency ?? "TRY"),
      // PLT-14: ödeyen ödeme sayfasında kartını kaydettiyse dolu gelir.
      kart: veri.cardUserKey && veri.cardToken
        ? { cardUserKey: String(veri.cardUserKey), cardToken: String(veri.cardToken), son4: veri.lastFourDigits ? String(veri.lastFourDigits) : undefined, marka: veri.cardAssociation ? String(veri.cardAssociation) : undefined }
        : undefined,
    };
  }

  /**
   * PLT-39: tamamlanmış ödemenin ayrıntısı ödeme numarasıyla (`/payment/detail`).
   * Kesinti, kart ve işlem numaraları ödeme sonucundakiyle aynı biçimde döner.
   */
  async odemeAyrintisi(config: IyzicoConfig, odemeId: string) {
    const veri = await this.istek(config, "/payment/detail", { locale: "tr", paymentId: odemeId });
    return {
      basarili: veri.paymentStatus === "SUCCESS",
      odemeId: veri.paymentId ? String(veri.paymentId) : odemeId,
      fiyat: Number(veri.price ?? veri.paidPrice ?? 0),
      odenen: Number(veri.paidPrice ?? veri.price ?? 0),
      taksit: Number(veri.installment) >= 1 ? Number(veri.installment) : 1,
      kesinti: iyzicoKesintisi(veri),
      odemeIslemNolari: (Array.isArray(veri.itemTransactions) ? veri.itemTransactions : [])
        .map((k: { paymentTransactionId?: unknown }) => metin(k?.paymentTransactionId))
        .filter((x: string | undefined): x is string => Boolean(x)),
      dovizCinsi: String(veri.currency ?? "TRY"),
    };
  }

  /** PLT-14: kayıtlı kartla, kullanıcı olmadan (non-3D) çekim. Başarısızlıkta hata fırlatır. */
  async kayitliKartlaOde(config: IyzicoConfig, girdi: Record<string, unknown>) {
    const veri = await this.istek(config, "/payment/auth", girdi);
    if (!veri.paymentId) throw new Error("iyzico ödeme numarası dönmedi");
    return { odemeId: String(veri.paymentId), tutar: Number(veri.paidPrice ?? veri.price ?? 0), dovizCinsi: String(veri.currency ?? "TRY") };
  }

  /**
   * KSB-43: sepet kalemi iadesi (`/payment/refund`). Kısmi iade desteklenir;
   * tutar kalemin ödenen tutarını ve iade edilebilir kalanı aşamaz. Başarısızlıkta
   * iyzico'nun iletisiyle hata fırlatır.
   */
  async iadeEt(config: IyzicoConfig, girdi: { odemeIslemNo: string; tutar: string; dovizCinsi: string; conversationId: string }) {
    const veri = await this.istek(config, "/payment/refund", {
      locale: "tr",
      conversationId: girdi.conversationId,
      paymentTransactionId: girdi.odemeIslemNo,
      price: girdi.tutar,
      currency: girdi.dovizCinsi,
    });
    return { ref: metin(veri.hostReference) ?? metin(veri.paymentTransactionId) ?? girdi.odemeIslemNo, tutar: String(veri.price ?? girdi.tutar) };
  }

  async kartSil(config: IyzicoConfig, cardUserKey: string, cardToken: string) {
    await this.istek(config, "/cardstorage/card", { locale: "tr", cardUserKey, cardToken }, "DELETE");
  }
}
