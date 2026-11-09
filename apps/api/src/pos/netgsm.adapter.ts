import { disFetch } from "../core/guvenlik/dis-istek";
export interface NetgsmConfig {
  kullaniciAdi: string;
  parola: string;
  gondericiAdi: string;
  servisAdresi?: string;
}

export interface NetgsmGonderimSonucu { gorevId: string; }

/** Sağlayıcı isteği açıkça reddetti: SMS çıkmadı. Diğer hatalarda sonuç belirsizdir. */
export class SmsReddedildi extends Error {}

export function netgsmTelefonuDuzenle(telefon: string): string {
  let rakamlar = telefon.replace(/\D/g, "");
  if (rakamlar.startsWith("90") && rakamlar.length === 12) rakamlar = rakamlar.slice(2);
  if (rakamlar.startsWith("0") && rakamlar.length === 11) rakamlar = rakamlar.slice(1);
  if (!/^5\d{9}$/.test(rakamlar)) throw new Error("Netgsm için geçerli bir Türkiye cep telefonu numarası gereklidir");
  return rakamlar;
}

export class NetgsmAdapter {
  async smsGonder(config: NetgsmConfig, telefon: string, mesaj: string): Promise<NetgsmGonderimSonucu> {
    const adres = `${(config.servisAdresi ?? "https://api.netgsm.com.tr").replace(/\/$/, "")}/sms/rest/v2/send`;
    const yanit = await disFetch(adres, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.kullaniciAdi}:${config.parola}`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ msgheader: config.gondericiAdi, encoding: "TR", messages: [{ msg: mesaj, no: netgsmTelefonuDuzenle(telefon) }] }),
    });
    const govde = await yanit.json().catch(() => ({})) as { code?: string; jobid?: string; description?: string };
    if (!yanit.ok || govde.code !== "00" || !govde.jobid) throw new SmsReddedildi(`Netgsm SMS gönderilemedi${govde.code ? ` (${govde.code})` : ""}: ${govde.description ?? yanit.statusText}`);
    return { gorevId: govde.jobid };
  }
}
