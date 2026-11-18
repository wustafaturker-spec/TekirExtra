/**
 * CNL-01/18: Telegram Bot API istemcisi. Anahtar yalnız bu süreçte ve yalnız istek adresinde
 * bulunur; hata metinleri ve kayıtlar anahtarı içermez. Test için `TELEGRAM_API_URL` sahte
 * sunucuyu gösterir.
 */

export interface TelegramKullanici { id: number; is_bot?: boolean; username?: string; first_name?: string }
export interface TelegramMesaj {
  message_id: number;
  date: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from?: TelegramKullanici;
  text?: string;
  /** CNL-09: kullanıcı bir soru mesajını yanıtlayarak serbest yanıt verir. */
  reply_to_message?: { message_id: number };
  /** CNL-16: fotoğraf (boyutlara göre sıralı; sonuncu en büyük) ya da belge; açıklama `caption`. */
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  caption?: string;
  /** CNL-24: medya grubu (albüm) kimliği; aynı albümdeki fotoğraflar aynı kimliği taşır. */
  media_group_id?: string;
  /** CNL-15: sesli mesaj (ogg/opus) ve ses dosyası; süre saniye. */
  voice?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
}
/** CNL-09: satır içi düğmeye basma. `data` en çok 64 bayt. */
export interface TelegramDugme { id: string; from: TelegramKullanici; message?: { message_id: number; chat: TelegramMesaj["chat"] }; data?: string }
export interface TelegramGuncelleme { update_id: number; message?: TelegramMesaj; callback_query?: TelegramDugme }
export type Klavye = Array<Array<{ text: string; callback_data: string }>>;

/** Telegram'ın yanıtı: ağ hatası, sunucu reddi ya da hız sınırı. Mesaj anahtar içermez. */
export class TelegramHatasi extends Error {
  constructor(readonly tur: "ag" | "red" | "hiz_siniri" | "cakisma" | "yetki", mesaj: string, readonly bekleSn?: number) {
    super(mesaj);
  }
}

/** Telegram tek mesajda en çok 4096 karakter alır. */
export const MESAJ_SINIRI = 4096;

export class TelegramIstemci {
  private readonly taban: string;

  constructor(private readonly anahtar: string, taban = process.env.TELEGRAM_API_URL || "https://api.telegram.org") {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(anahtar)) throw new Error("Bot anahtarı biçimi geçersiz");
    this.taban = taban.replace(/\/+$/, "");
  }

  /** Hata metninden anahtarı ayıklar (undici bazı hatalarda adresi metne katabilir). */
  private temizle(metin: string): string {
    return metin.split(this.anahtar).join("***").slice(0, 300);
  }

  private async cagir<T>(yontem: string, govde: Record<string, unknown>, zamanAsimiMs: number): Promise<T> {
    let yanit: Response;
    try {
      yanit = await fetch(`${this.taban}/bot${this.anahtar}/${yontem}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(govde),
        signal: AbortSignal.timeout(zamanAsimiMs),
      });
    } catch (hata) {
      throw new TelegramHatasi("ag", `Telegram'a ulaşılamadı: ${this.temizle(hata instanceof Error ? hata.message : String(hata))}`);
    }
    const veri = (await yanit.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } } | null;
    if (yanit.ok && veri?.ok) return veri.result as T;
    const aciklama = this.temizle(veri?.description ?? `HTTP ${yanit.status}`);
    if (yanit.status === 429) throw new TelegramHatasi("hiz_siniri", aciklama, veri?.parameters?.retry_after ?? 5);
    if (yanit.status === 409) throw new TelegramHatasi("cakisma", aciklama);
    if (yanit.status === 401 || yanit.status === 404) throw new TelegramHatasi("yetki", aciklama);
    if (yanit.status >= 500) throw new TelegramHatasi("ag", aciklama);
    throw new TelegramHatasi("red", aciklama);
  }

  /** Uzun yoklama: `beklemeSn` boyunca yeni mesaj bekler. `offset` önceki güncellemeleri sunucuda onaylar. */
  guncellemeler(offset: number | undefined, beklemeSn = 25): Promise<TelegramGuncelleme[]> {
    return this.cagir("getUpdates", { ...(offset !== undefined ? { offset } : {}), timeout: beklemeSn, allowed_updates: ["message", "callback_query"] }, (beklemeSn + 15) * 1000);
  }

  ben(): Promise<TelegramKullanici> {
    return this.cagir("getMe", {}, 10_000);
  }

  /** CNL-19: webhook kurulu bot başka yerde kullanılıyordur (getUpdates de çalışmaz). */
  webhookBilgisi(): Promise<{ url?: string }> {
    return this.cagir("getWebhookInfo", {}, 10_000);
  }

  /** Düz metin (biçimlendirme yok: model çıktısındaki işaretler biçim enjeksiyonu yapamaz), bağlantı önizlemesi kapalı. */
  async gonder(sohbetId: bigint | number, metin: string): Promise<void> {
    await this.cagir("sendMessage", { chat_id: String(sohbetId), text: metin.slice(0, MESAJ_SINIRI), link_preview_options: { is_disabled: true } }, 15_000);
  }

  /** CNL-09: satır içi düğmeli mesaj; düğmeler sonradan kaldırılabilsin diye mesaj kimliği döner. */
  async klavyeliGonder(sohbetId: bigint | number, metin: string, klavye: Klavye): Promise<number> {
    const m = await this.cagir<{ message_id: number }>("sendMessage", { chat_id: String(sohbetId), text: metin.slice(0, MESAJ_SINIRI), link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: klavye } }, 15_000);
    return m.message_id;
  }

  async klavyeKaldir(sohbetId: bigint | number, mesajId: bigint | number): Promise<void> {
    await this.cagir("editMessageReplyMarkup", { chat_id: String(sohbetId), message_id: Number(mesajId), reply_markup: { inline_keyboard: [] } }, 10_000);
  }

  /** Düğmeye basıldığını Telegram'a bildirir (istemcideki bekleme göstergesi kapanır). */
  async dugmeYanitla(dugmeId: string, metin?: string): Promise<void> {
    await this.cagir("answerCallbackQuery", { callback_query_id: dugmeId, ...(metin ? { text: metin.slice(0, 190) } : {}) }, 10_000).catch(() => undefined);
  }

  /**
   * CNL-16: Telegram sunucusundaki dosyayı indirir (getFile + dosya adresi). Boyut sınırı indirmeden
   * önce ve indirirken uygulanır; adres anahtar içerdiği için hata metinlerinden ayıklanır.
   */
  async dosyaIndir(dosyaId: string, azamiBayt: number): Promise<Buffer> {
    const d = await this.cagir<{ file_path?: string; file_size?: number }>("getFile", { file_id: dosyaId }, 10_000);
    if (!d.file_path) throw new TelegramHatasi("red", "Dosya Telegram'da bulunamadı");
    if ((d.file_size ?? 0) > azamiBayt) throw new TelegramHatasi("red", "Dosya çok büyük");
    let yanit: Response;
    try {
      yanit = await fetch(`${this.taban}/file/bot${this.anahtar}/${d.file_path}`, { signal: AbortSignal.timeout(30_000) });
    } catch (hata) {
      throw new TelegramHatasi("ag", `Dosya indirilemedi: ${this.temizle(hata instanceof Error ? hata.message : String(hata))}`);
    }
    if (!yanit.ok) throw new TelegramHatasi("ag", `Dosya indirilemedi: HTTP ${yanit.status}`);
    const tampon = Buffer.from(await yanit.arrayBuffer());
    if (tampon.length > azamiBayt) throw new TelegramHatasi("red", "Dosya çok büyük");
    return tampon;
  }

  async yaziyor(sohbetId: bigint | number): Promise<void> {
    await this.cagir("sendChatAction", { chat_id: String(sohbetId), action: "typing" }, 5_000).catch(() => undefined);
  }

  /**
   * PDF veya Excel gibi belgeleri Telegram sohbetine gönderir (sendDocument).
   */
  async dosyaGonder(
    sohbetId: bigint | number,
    tampon: Buffer,
    dosyaAdi: string,
    aciklama?: string,
    mimeType = "application/pdf",
  ): Promise<number> {
    const form = new FormData();
    form.append("chat_id", String(sohbetId));
    const blob = new Blob([tampon], { type: mimeType });
    form.append("document", blob, dosyaAdi);
    if (aciklama) form.append("caption", aciklama.slice(0, 1024));

    let yanit: Response;
    try {
      yanit = await fetch(`${this.taban}/bot${this.anahtar}/sendDocument`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (hata) {
      throw new TelegramHatasi("ag", `Telegram'a dosya gönderilemedi: ${this.temizle(hata instanceof Error ? hata.message : String(hata))}`);
    }
    const veri = (await yanit.json().catch(() => null)) as { ok?: boolean; result?: { message_id: number }; description?: string; parameters?: { retry_after?: number } } | null;
    if (yanit.ok && veri?.ok && veri.result) return veri.result.message_id;
    const err = this.temizle(veri?.description ?? `HTTP ${yanit.status}`);
    if (yanit.status === 429) throw new TelegramHatasi("hiz_siniri", err, veri?.parameters?.retry_after ?? 5);
    throw new TelegramHatasi("red", err);
  }
}
