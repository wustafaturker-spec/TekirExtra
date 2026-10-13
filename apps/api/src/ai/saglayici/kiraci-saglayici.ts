import type { TenantAiAyari } from "@prisma/client";
import type { PrismaService } from "../../core/prisma.service";
import { hassasCoz, hassasSifrele } from "../../personel/personel-hassas";
import { HttpException } from "@nestjs/common";
import type { z } from "zod";
import { baglamAl } from "../../core/istek-baglami";
import type { AiAracliSohbetGirdisi, AiAracliYanit, AiMultimodalGirdi, AiProviderTuru, IAiProvider } from "./ai-provider.interface";
import { TanimsizAiProvider } from "./tanimsiz-ai.provider";
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

/** AI-15: sayaçta görünen özellik. */
export type AiOzelligi = "asistan" | "tarama" | "ozet" | "gorev" | "ekstre" | "hatirlatma";

/** AI-14: verinin yurt dışına çıktığı sağlayıcılar (platform anahtarıyla da). */
const DIS_SAGLAYICILAR: AiProviderTuru[] = ["gemini", "openai", "anthropic"];

export const ONAY_YOK_MESAJI =
  "Yurt dışındaki yapay zekâ sağlayıcısına veri aktarımı için yönetici onayı yok. Yönetici Ayarlar → Yapay Zeka ekranından onay verebilir.";

/** Türkiye gününe göre bugünün tarihi (DATE kolonu için). */
const bugunGunu = () => new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })}T00:00:00Z`);

/**
 * AI-15: her model çağrısından önce kiracının günlük toplamı sınırla
 * karşılaştırılır, sonra kullanıcı + özellik sayacı artırılır.
 */
class SayacliSaglayici implements IAiProvider {
  constructor(
    private readonly temel: IAiProvider,
    private readonly say: () => Promise<void>,
  ) {}
  get saglayiciAdi() { return this.temel.saglayiciAdi; }
  async yapilandirilmisUretim<T>(girdi: AiMultimodalGirdi, sema: z.ZodType<T>): Promise<T> {
    await this.say();
    return this.temel.yapilandirilmisUretim(girdi, sema);
  }
  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    await this.say();
    return this.temel.metinUret(girdi);
  }
  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    await this.say();
    return this.temel.aracliSohbet(girdi);
  }
}

async function cagriSay(prisma: PrismaService, tenantId: string, ozellik: AiOzelligi, sinir: number): Promise<void> {
  const userId = baglamAl()?.userId;
  if (!userId) throw new Error("Yapay zekâ çağrısı kullanıcı bağlamı olmadan sayılamaz");
  const gun = bugunGunu();
  await prisma.tenantIslem(tenantId, async (tx) => {
    const toplam = await tx.aiKullanim.aggregate({ where: { tenantId, gun }, _sum: { cagri: true } });
    if ((toplam._sum.cagri ?? 0) >= sinir) {
      throw new HttpException(`Günlük yapay zekâ çağrı sınırına (${sinir}) ulaşıldı. Yönetici Ayarlar → Yapay Zeka ekranından sınırı değiştirebilir.`, 429);
    }
    await tx.aiKullanim.upsert({
      where: { tenantId_gun_userId_ozellik: { tenantId, gun, userId, ozellik } },
      create: { tenantId, gun, userId, ozellik, cagri: 1 },
      update: { cagri: { increment: 1 } },
    });
  });
}

/**
 * Kiracının kayıtlı sağlayıcısı; kayıt yoksa platform sağlayıcısı (ortam).
 * Okuma hatası yutulmaz — sessizce başka sağlayıcıya düşmek sonucu değiştirir.
 * Düz metin kalmış eski anahtar ilk kullanımda şifrelenir. Dış sağlayıcı
 * yönetici onayı olmadan kullanılmaz (AI-14); çağrılar sayılır ve günlük
 * sınıra tabidir (AI-15).
 */
export async function kiraciSaglayicisi(
  prisma: PrismaService,
  tenantId: string,
  secenek: { ozellik: AiOzelligi; varsayilan?: () => IAiProvider },
): Promise<{ saglayici: IAiProvider; ozelTalimatlar: string | null }> {
  const ayar = await prisma.tenantIslem(tenantId, async (tx) => {
    const kayit = await tx.tenantAiAyari.findUnique({ where: { tenantId } });
    if (kayit?.apiKey && !kayit.apiKey.startsWith("enc:")) {
      await tx.tenantAiAyari.update({ where: { tenantId }, data: { apiKey: apiAnahtariSifrele(kayit.apiKey) } });
    }
    return kayit;
  });
  const temel = ayar ? AiProviderFactory.uret(ayardanYapilandirma(ayar)) : (secenek.varsayilan ?? (() => AiProviderFactory.uret()))();
  const ozelTalimatlar = ayar?.ozelTalimatlar ?? null;
  if (DIS_SAGLAYICILAR.includes(temel.saglayiciAdi) && !ayar?.yurtDisiOnayAt) {
    return { saglayici: new TanimsizAiProvider(ONAY_YOK_MESAJI), ozelTalimatlar };
  }
  if (temel.saglayiciAdi === "tanimsiz") return { saglayici: temel, ozelTalimatlar };
  const sinir = ayar?.gunlukCagriSiniri ?? VARSAYILAN_GUNLUK_SINIR;
  return { saglayici: new SayacliSaglayici(temel, () => cagriSay(prisma, tenantId, secenek.ozellik, sinir)), ozelTalimatlar };
}

export const VARSAYILAN_GUNLUK_SINIR = 1000;
