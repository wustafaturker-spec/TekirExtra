import { ServiceUnavailableException } from '@nestjs/common';
import type { AiProviderTuru } from './ai-provider.interface';

const BITIS = new Set(['FINISH_REASON_UNSPECIFIED', 'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'LANGUAGE', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_OTHER', 'NO_IMAGE', 'IMAGE_RECITATION', 'UNEXPECTED_TOOL_CALL', 'TOO_MANY_TOOL_CALLS', 'MISSING_THOUGHT_SIGNATURE', 'MALFORMED_RESPONSE', 'ESCALATION', 'PUP_LIMITED_DISABLED', 'CONTINUATION']);
const ENGEL = new Set(['BLOCK_REASON_UNSPECIFIED', 'SAFETY', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY']);
const kod = (v: unknown, liste: Set<string>) => v == null ? null : typeof v === 'string' && liste.has(v) ? v : 'BILINMIYOR';

/** Yalnız enum ve sayımlar: ham metin/finishMessage/safetyRatings/token/anahtar yok. */
export function geminiYanitTanisi(veri: any) {
  const adaylar = Array.isArray(veri?.candidates) ? veri.candidates : [];
  const parcalar = Array.isArray(adaylar[0]?.content?.parts) ? adaylar[0].content.parts : [];
  return { bitisKodu: kod(adaylar[0]?.finishReason, BITIS), engellemeKodu: kod(veri?.promptFeedback?.blockReason, ENGEL),
    adaySayisi: adaylar.length, parcaSayisi: parcalar.length };
}
export type BosYanitTanisi = ReturnType<typeof geminiYanitTanisi>;
export function geminiYanitEngelli(t: BosYanitTanisi): boolean {
  return Boolean(t.engellemeKodu && t.engellemeKodu !== 'BLOCK_REASON_UNSPECIFIED') || Boolean(t.bitisKodu && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(t.bitisKodu));
}

export class AiBosYanitHatasi extends ServiceUnavailableException {
  readonly telemetriSinifi: string;
  readonly tekrarDenenebilir: boolean;
  /** AI-102: sağlayıcı katmanı zaten bir kez tekrar denedi; üst katman yeniden denemez. */
  tekrarlandi = false;
  constructor(readonly saglayici: AiProviderTuru, readonly tani: BosYanitTanisi = { bitisKodu: null, engellemeKodu: null, adaySayisi: 0, parcaSayisi: 0 }) {
    const sebep = tani.engellemeKodu && tani.engellemeKodu !== 'BLOCK_REASON_UNSPECIFIED' ? `ENGEL_${tani.engellemeKodu}` : tani.bitisKodu ?? 'NEDEN_YOK';
    const sinif = `AI_BOS_YANIT_${sebep}`;
    super({ statusCode: 503, message: `${saglayici === 'gemini' ? 'Gemini' : 'Yapay zekâ sağlayıcısı'} kullanılabilir yanıt üretmedi. Tanı kodu: ${sinif}.`, hataKodu: sinif, tani });
    this.telemetriSinifi = sinif;
    this.tekrarDenenebilir = !geminiYanitEngelli(tani);
  }
}
