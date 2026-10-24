import { createHash } from "node:crypto";
import { bankaIstegi, SaglayiciKimlikHatasi, trTarihParcalari, type BankaSaglayicisi, type HareketAraligi, type SaglayiciHareketi, type SaglayiciHesabi } from "./banka-saglayici";

export interface VomsisConfig { appKey: string; appSecret: string; baseUrl?: string; }
export interface VomsisHareket { id: number; accounting_date: string; system_date: string; amount: number | string; type: "borclu" | "alacakli"; description: string; fis_no?: string | null; resource_code?: string | null; opponent_iban?: string | null; opponent_title?: string | null; current_balance?: number | string | null; }
export interface VomsisHesap { id: number; fec_name: string; account_number: string; iban?: string | null; status: number; bank?: { bank_title?: string }; }

/** KSB-15: sağlayıcı kimlik bilgisini reddetti (4xx); yeniden denemek düzeltmez, otomatik çekim durur. */
export class VomsisKimlikHatasi extends SaglayiciKimlikHatasi {}

/**
 * Erişim anahtarı önbelleği: her çekimde yeniden kimlik doğrulanıyordu. Süre
 * Vomsis'in belgelenmiş ömrünü bilmediğimiz için kısa tutulur; veri ucu 401
 * dönerse anahtar düşürülüp bir kez yenilenir.
 */
const TOKEN_OMRU_MS = 20 * 60 * 1000;
const tokenOnbellegi = new Map<string, { token: string; bitis: number }>();
export const vomsisTokenOnbelleginiTemizle = () => tokenOnbellegi.clear();
const onbellekAnahtari = (c: VomsisConfig) => createHash("sha256").update(`${c.baseUrl ?? ""}\n${c.appKey}\n${c.appSecret}`).digest("hex");

/** Bir çekimde en çok bu kadar sayfa; imleç ilerlemezse daha önce durulur. */
const EN_COK_SAYFA = 20;

export class VomsisAdapter {
  private kok(config: VomsisConfig) { return (config.baseUrl ?? "https://developers.vomsis.com/api/v2").replace(/\/$/, ""); }

  async tokenAl(config: VomsisConfig, onbellekKullan = false): Promise<string> {
    const anahtar = onbellekAnahtari(config);
    const kayit = onbellekKullan ? tokenOnbellegi.get(anahtar) : undefined;
    if (kayit && kayit.bitis > Date.now()) return kayit.token;
    const yanit = await bankaIstegi("Vomsis", `${this.kok(config)}/authenticate`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ app_key: config.appKey, app_secret: config.appSecret }) });
    const govde = await yanit.json().catch(() => ({})) as { status?: string; token?: string; message?: string };
    if (yanit.status >= 400 && yanit.status < 500) throw new VomsisKimlikHatasi(`Vomsis kimlik doğrulaması reddedildi: ${govde.message ?? yanit.statusText}`);
    if (!yanit.ok || govde.status !== "success" || !govde.token) throw new Error(`Vomsis kimlik doğrulaması başarısız: ${govde.message ?? yanit.statusText}`);
    tokenOnbellegi.set(anahtar, { token: govde.token, bitis: Date.now() + TOKEN_OMRU_MS });
    return govde.token;
  }

  async hareketleriCek(config: VomsisConfig, token: string, disHesapId: string, baslangic: Date, bitis: Date, sonHareketId?: string | null): Promise<VomsisHareket[]> {
    // Tarihler Türkiye günüdür; sunucu UTC'de olsa da gece yarısı kaymaz.
    const tarih = (d: Date) => { const p = trTarihParcalari(d); return `${String(p.gun).padStart(2, "0")}-${String(p.ay).padStart(2, "0")}-${p.yil} 00:00:00`; };
    const sorgu = new URLSearchParams({ beginDate: tarih(baslangic), endDate: tarih(bitis), dateType: "accounting_date" });
    if (sonHareketId) sorgu.set("lastId", sonHareketId);
    const yanit = await bankaIstegi("Vomsis", `${this.kok(config)}/accounts/${encodeURIComponent(disHesapId)}/transactions?${sorgu}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const govde = await yanit.json().catch(() => ({})) as { status?: string; transactions?: VomsisHareket[]; message?: string };
    if (yanit.status === 401) throw new VomsisKimlikHatasi(`Vomsis erişim anahtarı reddedildi: ${govde.message ?? yanit.statusText}`);
    if (!yanit.ok || govde.status !== "success" || !Array.isArray(govde.transactions)) throw new Error(`Vomsis hareketleri alınamadı: ${govde.message ?? yanit.statusText}`);
    return govde.transactions;
  }

  async hesaplariCek(config: VomsisConfig, token: string): Promise<VomsisHesap[]> {
    const yanit = await bankaIstegi("Vomsis", `${this.kok(config)}/accounts`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const govde = await yanit.json().catch(() => ({})) as { status?: string; accounts?: VomsisHesap[]; message?: string };
    if (yanit.status === 401) throw new VomsisKimlikHatasi(`Vomsis erişim anahtarı reddedildi: ${govde.message ?? yanit.statusText}`);
    if (!yanit.ok || govde.status !== "success" || !Array.isArray(govde.accounts)) throw new Error(`Vomsis hesapları alınamadı: ${govde.message ?? yanit.statusText}`);
    return govde.accounts.filter((h) => h.status === 1);
  }
}

/** KSB-30: Vomsis, ortak sağlayıcı arayüzüyle. */
export class VomsisSaglayicisi implements BankaSaglayicisi {
  readonly kod = "vomsis";
  readonly ad = "Vomsis";
  constructor(private readonly adapter = new VomsisAdapter()) {}

  private ayar(a: Record<string, unknown>): VomsisConfig {
    return { appKey: String(a.kullaniciAdi ?? ""), appSecret: String(a.parola ?? ""), baseUrl: a.servisAdresi ? String(a.servisAdresi) : undefined };
  }

  /** Önbellekteki anahtarla çalışır; anahtar reddedilirse bir kez yenisini alıp tekrarlar. */
  private async anahtarla<T>(config: VomsisConfig, is: (token: string) => Promise<T>): Promise<T> {
    try {
      return await is(await this.adapter.tokenAl(config, true));
    } catch (hata) {
      if (!(hata instanceof VomsisKimlikHatasi)) throw hata;
      tokenOnbellegi.delete(onbellekAnahtari(config));
      return is(await this.adapter.tokenAl(config));
    }
  }

  async hesaplar(a: Record<string, unknown>): Promise<SaglayiciHesabi[]> {
    const config = this.ayar(a);
    const hesaplar = await this.anahtarla(config, (token) => this.adapter.hesaplariCek(config, token));
    return hesaplar.map((h) => ({ id: String(h.id), ad: h.account_number, iban: h.iban ?? null, dovizCinsi: h.fec_name === "TL" ? "TRY" : h.fec_name, bankaAdi: h.bank?.bank_title ?? null }));
  }

  /**
   * Artımlı çekim: `lastId` ile başlar, gelen en büyük kimlikten devam eder;
   * yanıt boş gelene ya da imleç ilerlemeyene kadar (en çok 20 sayfa). Sağlayıcı
   * tek yanıtta sınırlı satır verirse aradaki hareketler kaçmaz.
   */
  async hareketler(a: Record<string, unknown>, disHesapId: string, aralik: HareketAraligi) {
    const config = this.ayar(a);
    const tumu: VomsisHareket[] = [];
    let imlec = aralik.imlec ?? null;
    for (let sayfa = 0; sayfa < EN_COK_SAYFA; sayfa++) {
      const gelen = await this.anahtarla(config, (token) => this.adapter.hareketleriCek(config, token, disHesapId, aralik.baslangic, aralik.bitis, imlec));
      const enBuyuk = gelen.reduce((m, h) => Math.max(m, Number(h.id)), Number(imlec ?? 0));
      tumu.push(...gelen);
      if (!gelen.length || enBuyuk <= Number(imlec ?? 0)) break;
      imlec = String(enBuyuk);
    }
    const hareketler: SaglayiciHareketi[] = tumu.map((h) => ({
      id: String(h.id),
      tarih: (h.accounting_date || h.system_date).slice(0, 10),
      tutar: (h.type === "borclu" ? -1 : 1) * Math.abs(Number(h.amount)),
      aciklama: h.description || "Vomsis banka hareketi",
      dekontNo: h.fis_no ?? h.resource_code ?? undefined,
      karsiIban: h.opponent_iban ?? undefined,
      karsiUnvan: h.opponent_title ?? undefined,
      bakiye: h.current_balance == null ? undefined : Number(h.current_balance),
    }));
    return { hareketler, imlec };
  }
}
