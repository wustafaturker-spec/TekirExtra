import type { TenantAiAyari } from "@prisma/client";
import { aiMetrik } from "../../core/observability/ai-metrikleri";
import type { AiOzellikAnahtari } from "@tekirextra/shared";
import { aiOzellikDurumu } from "../ozellik-kapisi";
import type { PrismaService } from "../../core/prisma.service";
import { hassasCoz, hassasSifrele } from "../../personel/personel-hassas";
import { HttpException } from "@nestjs/common";
import type { z } from "zod";
import { baglamAl } from "../../core/istek-baglami";
import { SAGLAYICI_ZAMAN_ASIMI_MS, type AiAracliSohbetGirdisi, type AiAracliYanit, type AiMultimodalGirdi, type AiProviderTuru, type IAiProvider } from "./ai-provider.interface";
import { TanimsizAiProvider } from "./tanimsiz-ai.provider";
import { AiProviderFactory, type TenantAiYapilandirma } from "./ai-provider.factory";
import { AI_AKTARIM_POLITIKA_SURUMU } from "../ayarlar/ai-aktarim-politikasi";
import { AiBosYanitHatasi } from './ai-bos-yanit';
import { AiIptalHatasi, SaglayiciHatasi, iptalEdildiyseDur, iptalSinyali, ozelZamanAsimi, zamanAsimiyla } from "./aracli-ortak";
import { bekle, denemeKarari, onarimTalimati, TOPLAM_SURE_MS, type DenemeNedeni } from "./dayaniklilik";
import { AiSinirHatasi, buAyMaliyeti, butceDenetle, kiraciButceKurali, maliyetHesapla, platformAnahtariMi, type ButceKurali } from "./ai-butce";

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
export type AiOzelligi = "asistan" | "tarama" | "ozet" | "gorev" | "ekstre" | "hatirlatma" | "teklif" | "ondenetim" | "gelendenetim" | "metin";

/**
 * AI-109: model çağrısında denetlenen özellik anahtarları. Asistan (web/Telegram/arka plan),
 * MCP ve zamanlanmış işler kanalı bilen giriş noktalarında denetlenir.
 */
const KAPI_OZELLIKLERI: Partial<Record<AiOzelligi, AiOzellikAnahtari>> = { tarama: "ocr", teklif: "teklif_otomasyonu", metin: "metin_tamamlama" };

/**
 * Kısa, ucuz işler ekonomik modele gider; geri kalanlar güçlü modele. Asistan
 * 2026-10-22'de eklendi: EVREN deepseek kısa yanıtı 4–22 sn'de, qwen ekonomik
 * model 0,5–2 sn'de üretiyor ve araç seçimleri aynı çıktı; "Derin analiz" ve
 * finans açıklaması düzeltmesi ana modelde kalır (`anaModel`, `derin`).
 */
// "ekstre" 2026-10-22: ekstre satırından yalnız karşı taraf adı çıkarılır (kısa iş), kullanıcı ekranda bekler.
export const EKONOMIK_OZELLIKLER: readonly AiOzelligi[] = ["ozet", "gorev", "hatirlatma", "ondenetim", "gelendenetim", "asistan", "ekstre", "metin"];

/**
 * Özelliğin modeli: ekonomik işte ekonomik, diğerlerinde güçlü model; boş
 * alan ana modele düşer (o da boşsa sağlayıcının varsayılanı). 2026-10-20'ye
 * dek yalnız Ollama'da geçerliydi; EVREN gibi yavaş ana modeller için tüm
 * sağlayıcılara açıldı.
 */
export function ozellikModeli(ayar: Pick<TenantAiAyari, "modelAdi" | "ekonomikModelAdi" | "gucluModelAdi"> & { gucluSaglayici?: string | null }, ozellik: AiOzelligi): string | null {
  // AI-81: ayrı güçlü sağlayıcı tanımlıysa güçlü model ona aittir; diğer işler ana modelde kalır.
  if (ayar.gucluSaglayici) return (EKONOMIK_OZELLIKLER.includes(ozellik) ? ayar.ekonomikModelAdi?.trim() : null) || ayar.modelAdi || null;
  return (EKONOMIK_OZELLIKLER.includes(ozellik) ? ayar.ekonomikModelAdi : ayar.gucluModelAdi)?.trim() || ayar.modelAdi || null;
}

/** Yurt dışı onayının kapsadığı modeller; birden çok model virgülle saklanır. */
export const onayModelleri = (deger: string | null | undefined) => new Set((deger ?? "").split(",").map((m) => m.trim()).filter(Boolean));

/**
 * AI-102: kullanılan modelden farklı ilk tanımlı model (önce ana, sonra ekonomik, sonra güçlü);
 * ayrı güçlü sağlayıcının modeli başka anahtar/onay taşıdığı için yedek olmaz.
 */
export function yedekModelSec(ayar: Pick<TenantAiAyari, "modelAdi" | "ekonomikModelAdi" | "gucluModelAdi"> & { gucluSaglayici?: string | null }, kullanilan: string | null | undefined): string | null {
  const adaylar = [ayar.modelAdi?.trim(), ayar.ekonomikModelAdi?.trim(), ayar.gucluSaglayici ? null : ayar.gucluModelAdi?.trim()];
  return adaylar.find((m): m is string => Boolean(m) && m !== kullanilan) ?? null;
}

/** Ayarın kullanabileceği bütün modeller; onay hepsini kapsamalıdır. */
export function ayarModelleri(ayar: Pick<TenantAiAyari, "ekonomikModelAdi" | "gucluModelAdi"> & { gucluSaglayici?: string | null }, anaModel: string | null | undefined): string[] {
  // AI-81: ayrı güçlü sağlayıcının modeli ana onaya girmez; onun onayı ayrıdır.
  return [...new Set([anaModel, ayar.ekonomikModelAdi?.trim(), ayar.gucluSaglayici ? null : ayar.gucluModelAdi?.trim()].filter((m): m is string => Boolean(m)))];
}

export const GUCLU_ONAY_YOK_MESAJI =
  "Derin analiz için güçlü sağlayıcıya veri aktarımı onayı yok. Yönetici Ayarlar → Yapay Zeka → Güçlü sağlayıcı bölümünden onay verebilir.";

/** AI-14: verinin yurt dışına çıktığı sağlayıcılar (platform anahtarıyla da). */
export const DIS_SAGLAYICILAR: AiProviderTuru[] = ["gemini", "openai", "anthropic"];

export const ONAY_YOK_MESAJI =
  "Yurt dışındaki yapay zekâ sağlayıcısına veri aktarımı için yönetici onayı yok. Yönetici Ayarlar → Yapay Zeka ekranından onay verebilir.";

/** Türkiye gününe göre bugünün tarihi (DATE kolonu için). */
const bugunGunu = () => new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" })}T00:00:00Z`);

type Izleyici = (saglayici: IAiProvider, islem: string, baslangic: number, kullanim?: { girisToken?: number; cikisToken?: number }, hata?: unknown, tahmin?: { girdi: unknown; cikti: unknown }, deneme?: { no: number; neden: DenemeNedeni | null }) => Promise<void>;

/**
 * AI-15: her model çağrısından önce kiracının günlük toplamı sınırla
 * karşılaştırılır, sonra kullanıcı + özellik sayacı artırılır. AI-28: aylık
 * bütçe (ve platform anahtarında platform tavanı) da aynı anda denetlenir.
 * AI-102: geçici hatada sınırlı yeniden deneme, onaylı yedek modele geçiş,
 * boş yanıtta tek tekrar ve şema onarımı; her deneme ayrıca sayılır,
 * bütçeden geçer ve ayrı iz satırı yazar. Yedeğe geçildiyse bu örnek
 * sonraki çağrılarda da yedekle devam eder.
 */
class SayacliSaglayici implements IAiProvider {
  private aktif: IAiProvider;
  private yedek: IAiProvider | null;
  constructor(
    temel: IAiProvider,
    private readonly say: () => Promise<void>,
    private readonly izle: Izleyici,
    yedek: IAiProvider | null = null,
  ) {
    this.aktif = temel;
    this.yedek = yedek;
  }
  get saglayiciAdi() { return this.aktif.saglayiciAdi; }
  get modelAdi() { return this.aktif.modelAdi; }
  get sonKullanim() { return this.aktif.sonKullanim; }
  private async olc<T>(islem: string, girdi: unknown, calistir: (p: IAiProvider, onarim: string | null) => Promise<T>, yapilandirilmis = false): Promise<T> {
    const ilk = Date.now();
    const ozelSure = ozelZamanAsimi();
    // Görsel girdide model değişmez: yedek model görseli okuyamayabilir (OCR kendi yedeğini yönetir).
    const yedekKullanilabilir = !(girdi as AiMultimodalGirdi | undefined)?.gorselBase64;
    const d = { ayniModelTekrar: 0, yedegeGecildi: false, bosTekrarYapildi: false, onarimYapildi: false };
    let onarim: string | null = null;
    let neden: DenemeNedeni | null = null;
    for (let no = 1; ; no++) {
      // AI-99: durdurulan istekte yeni deneme sayılmaz ve başlamaz.
      iptalEdildiyseDur();
      await this.say();
      const saglayici = this.aktif;
      const baslangic = Date.now();
      const oncekiKullanim = saglayici.sonKullanim;
      const yeniKullanim = () => saglayici.sonKullanim !== oncekiKullanim ? saglayici.sonKullanim : undefined;
      const sure = Math.min(ozelSure ?? SAGLAYICI_ZAMAN_ASIMI_MS, TOPLAM_SURE_MS - (baslangic - ilk));
      try {
        const sonuc = await zamanAsimiyla(sure, () => calistir(saglayici, onarim));
        await this.izle(saglayici, islem, baslangic, yeniKullanim(), undefined, { girdi, cikti: sonuc }, { no, neden });
        return sonuc;
      } catch (hata) {
        await this.izle(saglayici, islem, baslangic, yeniKullanim(), hata, undefined, { no, neden });
        const karar = denemeKarari(hata, {
          ...d, yapilandirilmis, ozelZamanAsimi: ozelSure !== undefined,
          yedekVar: yedekKullanilabilir && this.yedek !== null, kalanMs: TOPLAM_SURE_MS - (Date.now() - ilk),
        });
        if (!karar) {
          if (hata instanceof AiBosYanitHatasi && d.bosTekrarYapildi) hata.tekrarlandi = true;
          throw hata;
        }
        neden = karar.neden;
        if (karar.neden === "yeniden_deneme") d.ayniModelTekrar++;
        else if (karar.neden === "bos_yanit") d.bosTekrarYapildi = true;
        else if (karar.neden === "sema_onarimi") { d.onarimYapildi = true; onarim = onarimTalimati(hata); }
        else if (karar.neden === "yedek_model" && this.yedek) {
          d.yedegeGecildi = true;
          d.ayniModelTekrar = 0;
          this.aktif = this.yedek;
          this.yedek = null;
        }
        await bekle(karar.beklemeMs, iptalSinyali());
      }
    }
  }
  async yapilandirilmisUretim<T>(girdi: AiMultimodalGirdi, sema: z.ZodType<T>): Promise<T> {
    return this.olc("yapilandirilmis_uretim", girdi, (p, onarim) => p.yapilandirilmisUretim(onarim ? { ...girdi, prompt: girdi.prompt + onarim } : girdi, sema), true);
  }
  async metinUret(girdi: AiMultimodalGirdi): Promise<string> {
    return this.olc("metin", girdi, (p) => p.metinUret(girdi));
  }
  async aracliSohbet(girdi: AiAracliSohbetGirdisi): Promise<AiAracliYanit> {
    return this.olc("aracli_sohbet", girdi, (p) => p.aracliSohbet(girdi));
  }
  /**
   * AI-116: akışlı tur; aynı ölçüm, sınır ve yeniden deneme yolundan geçer. Yeniden denemede ya da
   * yedek modele geçişte önceki denemenin akmış parçaları `null` ile geçersiz kılınır. Akış
   * desteklemeyen model tek seferlik yanıt verir (parça akmaz).
   */
  async aracliSohbetAkis(girdi: AiAracliSohbetGirdisi, onParca: (metin: string | null) => void): Promise<AiAracliYanit> {
    let akti = false;
    return this.olc("aracli_sohbet", girdi, (p) => {
      if (akti) { onParca(null); akti = false; }
      if (!p.aracliSohbetAkis) return p.aracliSohbet(girdi);
      return p.aracliSohbetAkis(girdi, (m) => { if (m !== null) akti = true; onParca(m); });
    });
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
  secenek: {
    ozellik: AiOzelligi;
    varsayilan?: () => IAiProvider;
    /** AI-81: "Derin analiz": güçlü sağlayıcı tanımlıysa ona, yoksa güçlü/ana modele gider. */
    derin?: boolean;
    /** Ekonomik yönlendirmeyi atlar; ekonomik özelliğin ana modelle yapılması gereken çağrısı için. */
    anaModel?: boolean;
    /** Özellik ne olursa olsun ekonomik model (yoksa ana model); ör. OCR'da güçlü model görsel okuyamazsa. */
    ekonomikModel?: boolean;
  },
): Promise<{ saglayici: IAiProvider; ozelTalimatlar: string | null; derin?: boolean }> {
  const kapiOzelligi = KAPI_OZELLIKLERI[secenek.ozellik];
  const { ayar, kapi } = await prisma.tenantIslem(tenantId, async (tx) => {
    const kayit = await tx.tenantAiAyari.findUnique({ where: { tenantId } });
    if (kayit?.apiKey && !kayit.apiKey.startsWith("enc:")) {
      await tx.tenantAiAyari.update({ where: { tenantId }, data: { apiKey: apiAnahtariSifrele(kayit.apiKey) } });
    }
    return { ayar: kayit, kapi: kapiOzelligi ? await aiOzellikDurumu(tx, tenantId, kapiOzelligi) : null };
  });
  // AI-109: OCR ve e-postadan teklif model çağrısı düzeyinde durur (bütün giriş yolları buradan geçer).
  if (kapi?.kapali) return { saglayici: new TanimsizAiProvider(kapi.mesaj), ozelTalimatlar: ayar?.ozelTalimatlar ?? null };
  if (secenek.derin && ayar?.gucluSaglayici) return gucluSaglayicisi(prisma, tenantId, ayar, secenek.ozellik);
  const yonlendirilmisModel = !ayar ? undefined
    : secenek.derin ? ayar.gucluModelAdi?.trim() || ayar.modelAdi
    : secenek.anaModel ? ayar.modelAdi
    : secenek.ekonomikModel ? ayar.ekonomikModelAdi?.trim() || ayar.modelAdi
    : ozellikModeli(ayar, secenek.ozellik);
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
  // AI-102: yedek model aynı sağlayıcı/anahtarla firmanın tanımlı diğer modelidir; dış sağlayıcıda onay onu da kapsamalıdır.
  const yedekModel = ayar ? yedekModelSec(ayar, temel.modelAdi) : null;
  const yedek = yedekModel && (!DIS_SAGLAYICILAR.includes(temel.saglayiciAdi) || onayModelleri(ayar!.yurtDisiOnayModel).has(yedekModel))
    ? AiProviderFactory.uret({ ...ayardanYapilandirma(ayar!), modelAdi: yedekModel })
    : null;
  return { saglayici: sayacliSar(prisma, tenantId, secenek.ozellik, temel, sinir, butce, yedek), ozelTalimatlar };
}

/** AI-81: güçlü sağlayıcı; kendi anahtarı, onayı ve fiyatı; günlük sınır ve aylık bütçe ortaktır. */
async function gucluSaglayicisi(prisma: PrismaService, tenantId: string, ayar: TenantAiAyari, ozellik: AiOzelligi): Promise<{ saglayici: IAiProvider; ozelTalimatlar: string | null; derin: boolean }> {
  const ozelTalimatlar = ayar.ozelTalimatlar ?? null;
  if (ayar.ozelliklerEtkin === false) return { saglayici: new TanimsizAiProvider("Yapay zekâ özellikleri bu firma için yönetici tarafından kapatıldı."), ozelTalimatlar, derin: true };
  const temel = AiProviderFactory.uret({ saglayici: ayar.gucluSaglayici, apiKey: hassasCoz(ayar.gucluApiKey), modelAdi: ayar.gucluModelAdi, baseUrl: ayar.gucluBaseUrl });
  const onayGecerli = Boolean(ayar.gucluOnayAt && ayar.gucluOnaySaglayici === temel.saglayiciAdi
    && Boolean(temel.modelAdi) && onayModelleri(ayar.gucluOnayModel).has(temel.modelAdi!) && ayar.gucluOnayPolitika === AI_AKTARIM_POLITIKA_SURUMU);
  if (DIS_SAGLAYICILAR.includes(temel.saglayiciAdi) && !onayGecerli) return { saglayici: new TanimsizAiProvider(GUCLU_ONAY_YOK_MESAJI), ozelTalimatlar, derin: true };
  if (temel.saglayiciAdi === "tanimsiz") return { saglayici: temel, ozelTalimatlar, derin: true };
  const butce = await prisma.tenantIslem(tenantId, (tx) => kiraciButceKurali(tx, tenantId, {
    girisTokenMilyonUsd: ayar.gucluGirisTokenMilyonUsd, cikisTokenMilyonUsd: ayar.gucluCikisTokenMilyonUsd, aylikMaliyetButcesiUsd: ayar.aylikMaliyetButcesiUsd,
  }, false));
  return { saglayici: sayacliSar(prisma, tenantId, ozellik, temel, ayar.gunlukCagriSiniri ?? VARSAYILAN_GUNLUK_SINIR, butce), ozelTalimatlar, derin: true };
}

/** Çağrı sayacı, sınır/bütçe denetimi ve çağrı izi; iki sağlayıcı kolu da bundan geçer. */
function sayacliSar(prisma: PrismaService, tenantId: string, ozellik: AiOzelligi, temel: IAiProvider, sinir: number, butce: ButceKurali, yedek: IAiProvider | null = null): IAiProvider {
  const izle: Izleyici = async (saglayici, islem, baslangic, kullanim, hata, tahmin, deneme) => {
    // AI-112: metrik çağrı izinden bağımsızdır (kullanıcısız çağrılar da sayılır); etiketlerde firma yok.
    const metrikMaliyeti = maliyetHesapla(butce.fiyat, kullanim, tahmin ?? null);
    aiMetrik.artir("tekirextra_ai_cagri_toplam", { ozellik, saglayici: saglayici.saglayiciAdi, sonuc: hata ? "hata" : "basarili" });
    aiMetrik.gozlemle("tekirextra_ai_cagri_suresi_saniye", Math.max(0, Date.now() - baslangic) / 1000, { ozellik });
    aiMetrik.artir("tekirextra_ai_token_toplam", { yon: "giris" }, metrikMaliyeti.girisToken ?? 0);
    aiMetrik.artir("tekirextra_ai_token_toplam", { yon: "cikis" }, metrikMaliyeti.cikisToken ?? 0);
    aiMetrik.artir("tekirextra_ai_maliyet_usd_toplam", { saglayici: saglayici.saglayiciAdi }, metrikMaliyeti.maliyetUsd ?? 0);
    const userId = baglamAl()?.userId;
    if (!userId) return;
    const hataSinifi = hata instanceof AiBosYanitHatasi || hata instanceof SaglayiciHatasi || hata instanceof AiIptalHatasi ? hata.telemetriSinifi : hata instanceof HttpException ? `HTTP_${hata.getStatus()}` : hata instanceof Error ? hata.name.slice(0, 100) : hata ? "BilinmeyenHata" : null;
    // Başarısız çağrıda yalnız sağlayıcının bildirdiği token ücretlenir; tahmin yapılmaz.
    const maliyet = maliyetHesapla(butce.fiyat, kullanim, tahmin ?? null);
    await prisma.tenantIslem(tenantId, (tx) => tx.aiCagriIz.create({ data: {
      tenantId, userId, ozellik, saglayici: saglayici.saglayiciAdi,
      model: saglayici.modelAdi ?? null, islem, deneme: deneme?.no ?? 1, denemeNedeni: deneme?.neden ?? null, sureMs: Math.max(0, Date.now() - baslangic), basarili: !hata, hataSinifi,
      girisToken: maliyet.girisToken, cikisToken: maliyet.cikisToken, maliyetUsd: maliyet.maliyetUsd, maliyetTahmini: maliyet.tahmini,
    } })).catch(() => undefined);
  };
  return new SayacliSaglayici(temel, () => cagriSay(prisma, tenantId, ozellik, sinir, butce), izle, yedek);
}

export const VARSAYILAN_GUNLUK_SINIR = 1000;

/**
 * CNL-12: firmanın bu ayki yapay zekâ bütçesi dolu mu (model çağırmadan)? Kural çağrı anındaki
 * denetimin aynısıdır (`butceDenetle`); fiyatı tanımsız bütçe de çağrıyı durdurduğu için dolu sayılır.
 */
export async function aiButcesiDoldu(prisma: PrismaService, tenantId: string): Promise<boolean> {
  return prisma.tenantIslem(tenantId, async (tx) => {
    const ayar = await tx.tenantAiAyari.findUnique({ where: { tenantId } });
    const kural = await kiraciButceKurali(tx, tenantId, ayar, platformAnahtariMi(ayar));
    if (kural.sinirUsd === null) return false;
    try { butceDenetle(kural, await buAyMaliyeti(tx, tenantId)); return false; } catch (hata) {
      if (hata instanceof AiSinirHatasi) return true;
      throw hata;
    }
  });
}
