import { ServiceUnavailableException } from "@nestjs/common";
import { IAiProvider, AiProviderTuru, AiAracliYanit } from "./ai-provider.interface";

const VARSAYILAN_MESAJ =
  "Yapay zekâ sağlayıcısı tanımlı değil. Ayarlar → Yapay Zeka ekranından sağlayıcı ve API anahtarı girin.";

/**
 * Sağlayıcı ya da anahtar yokken seçilir: örnek veri üretmek yerine her
 * çağrıyı açık bir 503 ile reddeder.
 */
export class TanimsizAiProvider implements IAiProvider {
  readonly saglayiciAdi: AiProviderTuru = "tanimsiz";

  constructor(private readonly mesaj = VARSAYILAN_MESAJ) {}

  async yapilandirilmisUretim<T>(): Promise<T> {
    throw new ServiceUnavailableException(this.mesaj);
  }

  async metinUret(): Promise<string> {
    throw new ServiceUnavailableException(this.mesaj);
  }

  async aracliSohbet(): Promise<AiAracliYanit> {
    throw new ServiceUnavailableException(this.mesaj);
  }
}
