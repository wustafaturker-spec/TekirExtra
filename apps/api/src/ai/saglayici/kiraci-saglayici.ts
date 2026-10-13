import type { TenantAiAyari } from "@prisma/client";
import type { PrismaService } from "../../core/prisma.service";
import { hassasCoz, hassasSifrele } from "../../personel/personel-hassas";
import type { IAiProvider } from "./ai-provider.interface";
import { AiProviderFactory, type TenantAiYapilandirma } from "./ai-provider.factory";

/** AI-11: kiracının API anahtarı şifreli saklanır; ekranda yalnız son 4 karakter. */
export const apiAnahtariSifrele = (anahtar: string | null | undefined) => hassasSifrele(anahtar?.trim() || null);

export function apiAnahtariMaskele(saklanan: string | null | undefined): string | null {
  const acik = hassasCoz(saklanan);
  return acik ? `••••${acik.slice(-4)}` : null;
}

/** Ekrandan geri gelen değer maskeyse (yeni biçim ya da eski "abcd...wxyz") anahtar değişmemiştir. */
export const maskeliMi = (deger: string) => deger.startsWith("••••") || deger.includes("...");

export function ayardanYapilandirma(ayar: Pick<TenantAiAyari, "saglayici" | "apiKey" | "modelAdi" | "baseUrl">): TenantAiYapilandirma {
  return { saglayici: ayar.saglayici, apiKey: hassasCoz(ayar.apiKey), modelAdi: ayar.modelAdi, baseUrl: ayar.baseUrl };
}

/**
 * Kiracının kayıtlı sağlayıcısı; kayıt yoksa platform sağlayıcısı (ortam).
 * Okuma hatası yutulmaz — sessizce başka sağlayıcıya düşmek sonucu değiştirir.
 * Düz metin kalmış eski anahtar ilk kullanımda şifrelenir.
 */
export async function kiraciSaglayicisi(
  prisma: PrismaService,
  tenantId: string,
  varsayilan: () => IAiProvider = () => AiProviderFactory.uret(),
): Promise<{ saglayici: IAiProvider; ozelTalimatlar: string | null }> {
  const ayar = await prisma.tenantIslem(tenantId, async (tx) => {
    const kayit = await tx.tenantAiAyari.findUnique({ where: { tenantId } });
    if (kayit?.apiKey && !kayit.apiKey.startsWith("enc:")) {
      await tx.tenantAiAyari.update({ where: { tenantId }, data: { apiKey: apiAnahtariSifrele(kayit.apiKey) } });
    }
    return kayit;
  });
  if (!ayar) return { saglayici: varsayilan(), ozelTalimatlar: null };
  return { saglayici: AiProviderFactory.uret(ayardanYapilandirma(ayar)), ozelTalimatlar: ayar.ozelTalimatlar };
}
