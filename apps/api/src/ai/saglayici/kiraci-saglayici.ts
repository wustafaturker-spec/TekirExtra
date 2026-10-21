import type { TenantAiAyari } from "@prisma/client";
import type { PrismaService } from "../../core/prisma.service";
import { hassasCoz, hassasSifrele } from "../../personel/personel-hassas";
import { HttpException } from "@nestjs/common";
import type { z } from "zod";
import { baglamAl } from "../../core/istek-baglami";
import type { AiAracliSohbetGirdisi, AiAracliYanit, AiMultimodalGirdi, AiProviderTuru, IAiProvider } from "./ai-provider.interface";
import { TanimsizAiProvider } from "./tanimsiz-ai.provider";
import { AiProviderFactory, type TenantAiYapilandirma } from "./ai-provider.factory";
import { AI_AKTARIM_POLITIKA_SURUMU } from "../ayarlar/ai-aktarim-politikasi";
import { AiBosYanitHatasi } from './ai-bos-yanit';
import { AiSinirHatasi, buAyMaliyeti, butceDenetle, kiraciButceKurali, maliyetHesapla, type ButceKurali } from "./ai-butce";

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
export type AiOzelligi = "asistan" | "tarama" | "ozet" | "gorev" | "ekstre" | "hatirlatma" | "teklif" | "ondenetim" | "gelendenetim";

/** Kısa, ucuz işler ekonomik modele gider; geri kalanlar güçlü modele. */
export const EKONOMIK_OZELLIKLER: readonly AiOzelligi[] = ["ozet", "gorev", "hatirlatma", "ondenetim", "gelendenetim"];

/**
 * Özelliğin modeli: ekonomik işte ekonomik, diğerlerinde güçlü model; boş
 * alan ana modele düşer (o da boşsa sağlayıcının varsayılanı). 2026-10-20'ye
 * dek yalnız Ollama'da geçerliydi; EVREN gibi yavaş ana modeller için tüm
 * sağlayıcılara açıldı.
 */
export function ozellikModeli(ayar: Pick<TenantAiAyari, "modelAdi" | "ekonomikModelAdi" | "gucluModelAdi">, ozellik: AiOzelligi): string | null {
  return (EKONOMIK_OZELLIKLER.includes(ozellik) ? ayar.ekonomikModelAdi : ayar.gucluModelAdi)?.trim() || ayar.modelAdi || null;
}

/** Yurt dışı onayının kapsadığı modeller; birden çok model virgülle saklanır. */
export const onayModelleri = (deger: string | null | undefined) => new Set((deger ?? "").split(",").map((m) => m.trim()).filter(Boolean));

/** Ayarın kullanabileceği bütün modeller; onay hepsini kapsamalıdır. */
export function ayarModelleri(ayar: Pick<TenantAiAyari, "ekonomikModelAdi" | "gucluModelAdi">, anaModel: string | null | undefined): string[] {
  return [...new Set([anaModel, ayar.ekonomikModelAdi?.trim(), ayar.gucluModelAdi?.trim()].filter((m): m is string => Boolean(m)))];
}

/** AI-14: verinin yurt dışına çıktığı sağlayıcılar (platform anahtarıyla da). */
const DIS_SAGLAYICILAR: AiProviderTuru[] = ["gemini", "openai", "anthropic"];

export const ONAY_YOK_MESAJI =
  "Yurt dışındaki yapay zekâ sağlayıcısına veri aktarımı için yönetici onayı yok. Yönetici Ayarlar → Yapay Zeka ekranından onay verebilir.";

/** Türkiye gününe göre bugünün tarihi (DATE kolonu için). */
const bugunGunu = () => new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })}T00:00:00Z`);

type Izleyici = (islem: string, baslangic: number, kullanim?: { girisToken?: number; cikisToken?: number }, hata?: unknown, tahmin?: { girdi: unknown; cikti: unknown }) => Promise<void>;

/**
 * AI-15: her model çağrısından önce kiracının günlük toplamı sınırla
 * karşılaştırılır, sonra kullanıcı + özellik sayacı artırılır. AI-28: aylık
 * bütçe (ve platform anahtarında platform tavanı) da aynı anda denetlenir.
 */
class SayacliSaglayici implements IAiProvider {
  constructor(
    private readonly temel: IAiProvider,
    private readonly say: () => Promise<void>,
    private readonly izle: Izleyici,
  ) {}
  get saglayiciAdi() { return this.temel.saglayiciAdi; }
  get modelAdi() { return this.temel.modelAdi; }
  get sonKullanim() { return this.temel.sonKullanim; }
  private async olc<T>(islem: string, girdi: unknown, calistir: () => Promise<T>): Promise<T> {
    await this.say();
    const baslangic = Date.now();
    const oncekiKullanim = this.temel.sonKullanim;
    const yeniKullanim = () => this.temel.sonKullanim !== oncekiKullanim ? this.temel.sonKullanim : undefined;
    try {
      const sonuc = await calistir();
      await this.izle(islem, baslangic, yeniKullanim(), undefined, { girdi, cikti: sonuc });
      return sonuc;
    } catch (hata) {
      await this.izle(islem, baslangic, yeniKullanim(), hata);
      throw hata;
    }
  }
  async yapilandirilmisUretim<T>(girdi: AiMultimodalGirdi, sema: z.ZodType<T>): Promise<T> {
    return this.olc("yapilandirilmis_uretim", girdi, () => this.temel.yapilandirilmisUretim(girdi, sema));
  }
  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    return this.olc("metin", girdi, () => this.temel.metinUret(girdi));
  }
  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    return this.olc("aracli_sohbet", girdi, () => this.temel.aracliSohbet(girdi));
  }
}

async function cagriSay(prisma: PrismaService, tenantId: string, ozellik: AiOzelligi, sinir: number, butce: ButceKurali): Promise<void> {
  const userId = baglamAl()?.userId;
  if (!userId) throw new Error("Yapay zekâ çağrısı kullanıcı bağlamı olmadan sayılamaz");
  const gun = bugunGunu();
  await prisma.tenantIslem(tenantId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${gun.toISOString().slice(0, 10)}`}, 0))`;
    const toplam = await tx.aiKullanim.aggregate({ where: { tenantId, gun }, _sum: { cagri: true } });
    if ((toplam._sum.cagri ?? 0) >= sinir) {
      throw new AiSinirHatasi(`Günlük yapay zekâ çağrı sınırına (${sinir}) ulaşıldı. Yönetici Ayarlar → Yapay Zeka ekranından sınırı değiştirebilir.`);
    }
    if (butce.sinirUsd !== null) butceDenetle(butce, await buAyMaliyeti(tx, tenantId));
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
  const yonlendirilmisModel = ayar ? ozellikModeli(ayar, secenek.ozellik) : undefined;
  const temel = ayar
    ? AiProviderFactory.uret({ ...ayardanYapilandirma(ayar), ...(yonlendirilmisModel ? { modelAdi: yonlendirilmisModel } : {}) })
    : (secenek.varsayilan ?? (() => AiProviderFactory.uret()))();
  const ozelTalimatlar = ayar?.ozelTalimatlar ?? null;
  if (ayar?.ozelliklerEtkin === false) return { saglayici: new TanimsizAiProvider("Yapay zekâ özellikleri bu firma için yönetici tarafından kapatıldı."), ozelTalimatlar };
  const onayGecerli = Boolean(ayar?.yurtDisiOnayAt
    && ayar.yurtDisiOnaySaglayici === temel.saglayiciAdi
    && Boolean(temel.modelAdi) && onayModelleri(ayar.yurtDisiOnayModel).has(temel.modelAdi!)
    && ayar.yurtDisiOnayPolitika === AI_AKTARIM_POLITIKA_SURUMU);
  if (DIS_SAGLAYICILAR.includes(temel.saglayiciAdi) && !onayGecerli) {
    return { saglayici: new TanimsizAiProvider(ONAY_YOK_MESAJI), ozelTalimatlar };
  }
  if (temel.saglayiciAdi === "tanimsiz") return { saglayici: temel, ozelTalimatlar };
  const sinir = ayar?.gunlukCagriSiniri ?? VARSAYILAN_GUNLUK_SINIR;
  // AI-31: kiracı kendi anahtarını girmemişse dış sağlayıcı çağrısını platform öder.
  const platformAnahtari = !ayar?.apiKey?.trim() && DIS_SAGLAYICILAR.includes(temel.saglayiciAdi);
  const butce = await prisma.tenantIslem(tenantId, (tx) => kiraciButceKurali(tx, tenantId, ayar, platformAnahtari));
  const izle: Izleyici = async (islem, baslangic, kullanim, hata, tahmin) => {
    const userId = baglamAl()?.userId;
    if (!userId) return;
    const hataSinifi = hata instanceof AiBosYanitHatasi ? hata.telemetriSinifi : hata instanceof HttpException ? `HTTP_${hata.getStatus()}` : hata instanceof Error ? hata.name.slice(0, 100) : hata ? "BilinmeyenHata" : null;
    // Başarısız çağrıda yalnız sağlayıcının bildirdiği token ücretlenir; tahmin yapılmaz.
    const maliyet = maliyetHesapla(butce.fiyat, kullanim, tahmin ?? null);
    await prisma.tenantIslem(tenantId, (tx) => tx.aiCagriIz.create({ data: {
      tenantId, userId, ozellik: secenek.ozellik, saglayici: temel.saglayiciAdi,
      model: temel.modelAdi ?? null, islem, sureMs: Math.max(0, Date.now() - baslangic), basarili: !hata, hataSinifi,
      girisToken: maliyet.girisToken, cikisToken: maliyet.cikisToken, maliyetUsd: maliyet.maliyetUsd, maliyetTahmini: maliyet.tahmini,
    } })).catch(() => undefined);
  };
  return { saglayici: new SayacliSaglayici(temel, () => cagriSay(prisma, tenantId, secenek.ozellik, sinir, butce), izle), ozelTalimatlar };
}

export const VARSAYILAN_GUNLUK_SINIR = 1000;
