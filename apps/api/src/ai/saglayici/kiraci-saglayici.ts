import type { PrismaService } from "../../core/prisma.service";
import type { IAiProvider } from "./ai-provider.interface";
import { AiProviderFactory } from "./ai-provider.factory";

/**
 * Kiracının kayıtlı sağlayıcısı; kayıt yoksa platform sağlayıcısı (ortam).
 * Okuma hatası yutulmaz — sessizce başka sağlayıcıya düşmek sonucu değiştirir.
 */
export async function kiraciSaglayicisi(
  prisma: PrismaService,
  tenantId: string,
  varsayilan: () => IAiProvider = () => AiProviderFactory.uret(),
): Promise<{ saglayici: IAiProvider; ozelTalimatlar: string | null }> {
  const ayar = await prisma.tenantIslem(tenantId, (tx) => tx.tenantAiAyari.findUnique({ where: { tenantId } }));
  if (!ayar) return { saglayici: varsayilan(), ozelTalimatlar: null };
  return {
    saglayici: AiProviderFactory.uret({ saglayici: ayar.saglayici, apiKey: ayar.apiKey, modelAdi: ayar.modelAdi, baseUrl: ayar.baseUrl }),
    ozelTalimatlar: ayar.ozelTalimatlar,
  };
}
