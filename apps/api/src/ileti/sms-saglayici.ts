import { NetgsmAdapter, type NetgsmConfig } from "../pos/netgsm.adapter";

/** ILT-10: sağlayıcı arayüzü; yeni sağlayıcı buraya eklenir, çağıranlar değişmez. */
export interface SmsSaglayici { smsGonder(config: NetgsmConfig, telefon: string, mesaj: string): Promise<{ gorevId: string }> }
const SAGLAYICILAR: Record<string, SmsSaglayici> = { netgsm: new NetgsmAdapter() };
export const smsSaglayiciAl = (ad: string): SmsSaglayici | undefined => SAGLAYICILAR[ad];
