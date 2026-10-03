export interface VomsisConfig { appKey: string; appSecret: string; baseUrl?: string; }
export interface VomsisHareket { id: number; accounting_date: string; system_date: string; amount: number | string; type: "borclu" | "alacakli"; description: string; fis_no?: string | null; resource_code?: string | null; opponent_iban?: string | null; opponent_title?: string | null; current_balance?: number | string | null; }
export interface VomsisHesap { id: number; fec_name: string; account_number: string; iban?: string | null; status: number; bank?: { bank_title?: string }; }

/** KSB-15: sağlayıcı kimlik bilgisini reddetti (4xx); yeniden denemek düzeltmez, otomatik çekim durur. */
export class VomsisKimlikHatasi extends Error {}

export class VomsisAdapter {
  private kok(config: VomsisConfig) { return (config.baseUrl ?? "https://developers.vomsis.com/api/v2").replace(/\/$/, ""); }
  async tokenAl(config: VomsisConfig): Promise<string> {
    const yanit = await fetch(`${this.kok(config)}/authenticate`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ app_key: config.appKey, app_secret: config.appSecret }) });
    const govde = await yanit.json().catch(() => ({})) as { status?: string; token?: string; message?: string };
    if (yanit.status >= 400 && yanit.status < 500) throw new VomsisKimlikHatasi(`Vomsis kimlik doğrulaması reddedildi: ${govde.message ?? yanit.statusText}`);
    if (!yanit.ok || govde.status !== "success" || !govde.token) throw new Error(`Vomsis kimlik doğrulaması başarısız: ${govde.message ?? yanit.statusText}`);
    return govde.token;
  }
  async hareketleriCek(config: VomsisConfig, token: string, disHesapId: string, baslangic: Date, bitis: Date, sonHareketId?: string | null): Promise<VomsisHareket[]> {
    const tarih = (d: Date) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()} 00:00:00`;
    const sorgu = new URLSearchParams({ beginDate: tarih(baslangic), endDate: tarih(bitis), dateType: "accounting_date" });
    if (sonHareketId) sorgu.set("lastId", sonHareketId);
    const yanit = await fetch(`${this.kok(config)}/accounts/${encodeURIComponent(disHesapId)}/transactions?${sorgu}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const govde = await yanit.json().catch(() => ({})) as { status?: string; transactions?: VomsisHareket[]; message?: string };
    if (!yanit.ok || govde.status !== "success" || !Array.isArray(govde.transactions)) throw new Error(`Vomsis hareketleri alınamadı: ${govde.message ?? yanit.statusText}`);
    return govde.transactions;
  }
  async hesaplariCek(config: VomsisConfig, token: string): Promise<VomsisHesap[]> {
    const yanit = await fetch(`${this.kok(config)}/accounts`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const govde = await yanit.json().catch(() => ({})) as { status?: string; accounts?: VomsisHesap[]; message?: string };
    if (!yanit.ok || govde.status !== "success" || !Array.isArray(govde.accounts)) throw new Error(`Vomsis hesapları alınamadı: ${govde.message ?? yanit.statusText}`);
    return govde.accounts.filter((h) => h.status === 1);
  }
}
