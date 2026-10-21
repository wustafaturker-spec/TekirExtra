import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { z } from "zod";
import { AiGorevYurutucu } from "./ai-gorev-yurutucu";
import { PrismaService } from "../../core/prisma.service";
import { AiProviderFactory, TenantAiYapilandirma, kiraciAdresiHatasi } from "../saglayici/ai-provider.factory";
import { apiAnahtariMaskele, apiAnahtariSifrele, ayardanYapilandirma, ayarModelleri, kiraciSaglayicisi, maskeliMi, onayModelleri, VARSAYILAN_GUNLUK_SINIR } from "../saglayici/kiraci-saglayici";
import { aktifBaglam } from "../../core/istek-baglami";
import { hassasCoz } from "../../personel/personel-hassas";
import { AI_AKTARIM_POLITIKA_SURUMU } from "./ai-aktarim-politikasi";
import { istanbulAyBaslangici } from "../ai-zaman";
import { kiraciButceKurali, platformAnahtariMi } from "../saglayici/ai-butce";

export interface TenantAiAyariGirdi {
  saglayici?: string;
  apiKey?: string | null;
  modelAdi?: string | null;
  ekonomikModelAdi?: string | null;
  gucluModelAdi?: string | null;
  baseUrl?: string | null;
  ozelTalimatlar?: string | null;
  guvenlikKurallari?: Record<string, unknown> | null;
  /** AI-15: 1–100.000. */
  gunlukCagriSiniri?: number;
  /** Mevcut sağlayıcı/model için manuel fiyat; USD / 1 milyon token. */
  girisTokenMilyonUsd?: number | null;
  cikisTokenMilyonUsd?: number | null;
  /** Takvim ayı için maliyet izleme eşiği (USD); otomatik çağrı kesmez. */
  aylikMaliyetButcesiUsd?: number | null;
  ozelliklerEtkin?: boolean;
  telemetriSaklamaGun?: number;
  sohbetSaklamaGun?: number | null;
  telemetriHataEsigiYuzde?: number;
  telemetriGecikmeEsigiMs?: number;
}

/** AI-16: görev alanları (varsayılansız: kısmi güncelleme verilmeyen alanı değiştirmez). */
const gorevAlanlari = z.object({
  ad: z.string().trim().min(2).max(100),
  /** AI-23: NAKIT_TAHSILAT deterministik analizdir, talimat almaz. */
  tur: z.enum(["ASISTAN", "NAKIT_TAHSILAT", "BRIFING"]),
  tetikleyici: z.enum(["ZAMANLANMIS", "VADE_GECIKMESI", "KASA_KRITIK"]),
  saat: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat SS:DD biçiminde olmalıdır"),
  gunler: z.array(z.number().int().min(1).max(7)).max(7),
  esikTutar: z.number().positive().nullable(),
  gorevTalimati: z.string().trim().max(2000),
  aktif: z.boolean(),
});
type GorevKurali = { tur?: string; tetikleyici?: string; esikTutar?: number | null; gorevTalimati?: string };
const gorevKurallari = <T extends z.ZodType<GorevKurali>>(sema: T) =>
  sema
    .refine((g) => g.tetikleyici !== "KASA_KRITIK" || (g.esikTutar ?? 0) > 0, { message: "Kasa kritik görevinde eşik tutarı zorunludur", path: ["esikTutar"] })
    .refine((g) => g.tur === "NAKIT_TAHSILAT" || g.tur === "BRIFING" || (g.gorevTalimati ?? "").length >= 5, { message: "Görev talimatı en az 5 karakter olmalıdır", path: ["gorevTalimati"] });
const gorevTamSemasi = gorevKurallari(gorevAlanlari);
/** Oluşturma: sahibi oluşturan kullanıcıdır; tür asistan, saat 09:00, her gün, etkin varsayılır. */
export const gorevSemasi = gorevKurallari(gorevAlanlari.partial({ tur: true, saat: true, gunler: true, esikTutar: true, gorevTalimati: true, aktif: true }));
export type TenantAiGorevGirdi = z.input<typeof gorevSemasi>;

@Injectable()
export class TenantAiService {
  private readonly logger = new Logger(TenantAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gorevYurutucu: AiGorevYurutucu,
  ) {}

  /**
   * Kiracının kayıtlı AI ayarlarını getirir (API anahtarını maskeler)
   */
  async ayarGetir(tenantId: string) {
    const ayar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiAyari.findUnique({
        where: { tenantId },
      }),
    );

    if (!ayar) {
      const varsayilan = AiProviderFactory.uret();
      return {
        saglayici: varsayilan.saglayiciAdi,
        apiKey: null,
        modelAdi: varsayilan.modelAdi ?? null,
        baseUrl: null,
        ozelTalimatlar: null,
        guvenlikKurallari: null,
        yurtDisiOnay: null,
        gunlukCagriSiniri: VARSAYILAN_GUNLUK_SINIR,
        girisTokenMilyonUsd: null,
        cikisTokenMilyonUsd: null,
        aylikMaliyetButcesiUsd: null,
        ozelliklerEtkin: true,
        telemetriSaklamaGun: 90,
        sohbetSaklamaGun: null,
        telemetriHataEsigiYuzde: 20,
        telemetriGecikmeEsigiMs: 10_000,
      };
    }
    const onaylayan = ayar.yurtDisiOnayUserId
      ? await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: ayar.yurtDisiOnayUserId! }, select: { adSoyad: true } }))
      : null;

    const etkin = AiProviderFactory.uret(ayardanYapilandirma(ayar));
    // Onay ana, ekonomik ve güçlü modelin hepsini kapsamalı; yeni model eklenince yeniden istenir.
    const onaylilar = onayModelleri(ayar.yurtDisiOnayModel);
    const onayGecerli = Boolean(ayar.yurtDisiOnayAt && ayar.yurtDisiOnaySaglayici === etkin.saglayiciAdi && ayarModelleri(ayar, etkin.modelAdi).every((m) => onaylilar.has(m)) && ayar.yurtDisiOnayPolitika === AI_AKTARIM_POLITIKA_SURUMU);
    return {
      ...ayar,
      // AI-11: yalnız son 4 karakter görünür.
      apiKey: apiAnahtariMaskele(ayar.apiKey),
      hasApiKey: Boolean(ayar.apiKey),
      yurtDisiOnay: onayGecerli ? { tarih: ayar.yurtDisiOnayAt, onaylayan: onaylayan?.adSoyad ?? null, saglayici: ayar.yurtDisiOnaySaglayici, model: ayar.yurtDisiOnayModel, politikaSurumu: ayar.yurtDisiOnayPolitika } : null,
    };
  }

  /**
   * Kiracı AI ayarlarını kaydeder veya günceller
   */
  async ayarKaydet(tenantId: string, girdi: TenantAiAyariGirdi) {
    if (girdi.gunlukCagriSiniri !== undefined && (!Number.isInteger(girdi.gunlukCagriSiniri) || girdi.gunlukCagriSiniri < 1 || girdi.gunlukCagriSiniri > 100_000)) {
      throw new BadRequestException("Günlük çağrı sınırı 1 ile 100.000 arasında bir tam sayı olmalıdır.");
    }
    if (girdi.telemetriSaklamaGun !== undefined && (!Number.isInteger(girdi.telemetriSaklamaGun) || girdi.telemetriSaklamaGun < 7 || girdi.telemetriSaklamaGun > 365)) throw new BadRequestException("Telemetri saklama süresi 7-365 gün olmalıdır.");
    if (girdi.sohbetSaklamaGun != null && (!Number.isInteger(girdi.sohbetSaklamaGun) || girdi.sohbetSaklamaGun < 7 || girdi.sohbetSaklamaGun > 365)) throw new BadRequestException("Sohbet saklama süresi 7-365 gün olmalıdır.");
    if (girdi.telemetriHataEsigiYuzde !== undefined && (!Number.isInteger(girdi.telemetriHataEsigiYuzde) || girdi.telemetriHataEsigiYuzde < 1 || girdi.telemetriHataEsigiYuzde > 100)) throw new BadRequestException("Hata oranı eşiği %1-%100 arasında olmalıdır.");
    if (girdi.telemetriGecikmeEsigiMs !== undefined && (!Number.isInteger(girdi.telemetriGecikmeEsigiMs) || girdi.telemetriGecikmeEsigiMs < 500 || girdi.telemetriGecikmeEsigiMs > 120_000)) throw new BadRequestException("Gecikme eşiği 500-120.000 ms arasında olmalıdır.");
    for (const [alan, deger] of [["Giriş token fiyatı", girdi.girisTokenMilyonUsd], ["Çıkış token fiyatı", girdi.cikisTokenMilyonUsd], ["Aylık maliyet bütçesi", girdi.aylikMaliyetButcesiUsd]] as const) {
      if (deger !== undefined && deger !== null && (!Number.isFinite(deger) || deger < 0 || deger > 1_000_000)) throw new BadRequestException(`${alan} 0 ile 1.000.000 USD arasında olmalıdır.`);
    }
    if (girdi.baseUrl?.trim()) {
      const hata = kiraciAdresiHatasi(girdi.baseUrl.trim());
      if (hata) throw new BadRequestException(`Sağlayıcı adresi: ${hata}`);
    }
    for (const [alan, deger] of [["Ekonomik model", girdi.ekonomikModelAdi], ["Güçlü model", girdi.gucluModelAdi]] as const) {
      if (deger !== undefined && deger !== null && (deger.trim().length > 120 || /[\r\n]/.test(deger))) throw new BadRequestException(`${alan} en fazla 120 karakter olabilir.`);
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.tenantAiAyari.findUnique({ where: { tenantId } });
      const yeniSaglayici = girdi.saglayici !== undefined ? (girdi.saglayici || "varsayilan") : (mevcut?.saglayici ?? "varsayilan");
      const yeniModel = girdi.modelAdi !== undefined ? (girdi.modelAdi || null) : (mevcut?.modelAdi ?? null);
      const yeniEkonomik = girdi.ekonomikModelAdi !== undefined ? girdi.ekonomikModelAdi?.trim() || null : (mevcut?.ekonomikModelAdi ?? null);
      const yeniGuclu = girdi.gucluModelAdi !== undefined ? girdi.gucluModelAdi?.trim() || null : (mevcut?.gucluModelAdi ?? null);
      const onayDegisti = Boolean(mevcut?.yurtDisiOnayAt && (mevcut.saglayici !== yeniSaglayici || mevcut.modelAdi !== yeniModel
        || (mevcut.ekonomikModelAdi ?? null) !== yeniEkonomik || (mevcut.gucluModelAdi ?? null) !== yeniGuclu));
      if (onayDegisti) await tx.aiVeriAktarimOnayi.create({ data: { tenantId, userId: aktifBaglam().userId, olay: "gecersiz_kildi", saglayici: mevcut!.yurtDisiOnaySaglayici ?? mevcut!.saglayici, model: mevcut!.yurtDisiOnayModel ?? mevcut!.modelAdi, politikaSurumu: mevcut!.yurtDisiOnayPolitika ?? "legacy" } });
      const girisFiyati = girdi.girisTokenMilyonUsd !== undefined ? girdi.girisTokenMilyonUsd : mevcut?.girisTokenMilyonUsd?.toNumber() ?? null;
      const cikisFiyati = girdi.cikisTokenMilyonUsd !== undefined ? girdi.cikisTokenMilyonUsd : mevcut?.cikisTokenMilyonUsd?.toNumber() ?? null;
      const butce = girdi.aylikMaliyetButcesiUsd !== undefined ? girdi.aylikMaliyetButcesiUsd : mevcut?.aylikMaliyetButcesiUsd?.toNumber() ?? null;

      // Maske geri geldiyse anahtar değişmemiştir; yeni anahtar şifrelenerek saklanır (AI-11).
      let yeniApiKey: string | null | undefined = girdi.apiKey === undefined ? undefined : apiAnahtariSifrele(girdi.apiKey);
      if (girdi.apiKey && maskeliMi(girdi.apiKey)) {
        yeniApiKey = mevcut?.apiKey ? apiAnahtariSifrele(hassasCoz(mevcut.apiKey)) : null;
      }

      // AI-31: platform anahtarında fiyat platformdan gelir ve bütçe platform tavanını aşamaz.
      const platformAnahtari = platformAnahtariMi({ saglayici: yeniSaglayici, apiKey: yeniApiKey !== undefined ? yeniApiKey : mevcut?.apiKey ?? null });
      if (butce !== null && !platformAnahtari && (girisFiyati === null || cikisFiyati === null)) throw new BadRequestException("Aylık bütçe takibi için giriş ve çıkış token fiyatlarını da tanımlayın.");
      if (butce !== null && platformAnahtari) {
        const { platformTavaniUsd } = await kiraciButceKurali(tx, tenantId, null, true);
        if (platformTavaniUsd !== null && butce > platformTavaniUsd) throw new BadRequestException(`Aylık bütçe, paketinizin platform tavanını (${platformTavaniUsd} USD) aşamaz.`);
      }

      return tx.tenantAiAyari.upsert({
        where: { tenantId },
        create: {
          tenantId,
          saglayici: girdi.saglayici || "varsayilan",
          apiKey: yeniApiKey || null,
          modelAdi: girdi.modelAdi || null,
          ekonomikModelAdi: girdi.ekonomikModelAdi?.trim() || null,
          gucluModelAdi: girdi.gucluModelAdi?.trim() || null,
          baseUrl: girdi.baseUrl || null,
          ozelTalimatlar: girdi.ozelTalimatlar || null,
          guvenlikKurallari: (girdi.guvenlikKurallari as any) || null,
          ...(girdi.gunlukCagriSiniri !== undefined ? { gunlukCagriSiniri: girdi.gunlukCagriSiniri } : {}),
          ...(girdi.girisTokenMilyonUsd !== undefined ? { girisTokenMilyonUsd: girdi.girisTokenMilyonUsd } : {}),
          ...(girdi.cikisTokenMilyonUsd !== undefined ? { cikisTokenMilyonUsd: girdi.cikisTokenMilyonUsd } : {}),
          ...(girdi.aylikMaliyetButcesiUsd !== undefined ? { aylikMaliyetButcesiUsd: girdi.aylikMaliyetButcesiUsd } : {}),
          ...(girdi.ozelliklerEtkin !== undefined ? { ozelliklerEtkin: girdi.ozelliklerEtkin } : {}),
          ...(girdi.telemetriSaklamaGun !== undefined ? { telemetriSaklamaGun: girdi.telemetriSaklamaGun } : {}),
          ...(girdi.sohbetSaklamaGun !== undefined ? { sohbetSaklamaGun: girdi.sohbetSaklamaGun } : {}),
          ...(girdi.telemetriHataEsigiYuzde !== undefined ? { telemetriHataEsigiYuzde: girdi.telemetriHataEsigiYuzde } : {}),
          ...(girdi.telemetriGecikmeEsigiMs !== undefined ? { telemetriGecikmeEsigiMs: girdi.telemetriGecikmeEsigiMs } : {}),
        },
        update: {
          // Gönderilmeyen alan değişmez (yalnız sınır kaydı sağlayıcıyı sıfırlıyordu).
          ...(girdi.saglayici !== undefined ? { saglayici: girdi.saglayici || "varsayilan" } : {}),
          ...(onayDegisti ? { yurtDisiOnayAt: null, yurtDisiOnayUserId: null, yurtDisiOnaySaglayici: null, yurtDisiOnayModel: null, yurtDisiOnayPolitika: null } : {}),
          ...(yeniApiKey !== undefined ? { apiKey: yeniApiKey || null } : {}),
          modelAdi: girdi.modelAdi !== undefined ? girdi.modelAdi || null : undefined,
          ekonomikModelAdi: girdi.ekonomikModelAdi !== undefined ? girdi.ekonomikModelAdi?.trim() || null : undefined,
          gucluModelAdi: girdi.gucluModelAdi !== undefined ? girdi.gucluModelAdi?.trim() || null : undefined,
          baseUrl: girdi.baseUrl !== undefined ? girdi.baseUrl || null : undefined,
          ozelTalimatlar: girdi.ozelTalimatlar !== undefined ? girdi.ozelTalimatlar || null : undefined,
          guvenlikKurallari: girdi.guvenlikKurallari !== undefined ? (girdi.guvenlikKurallari as any) || null : undefined,
          ...(girdi.gunlukCagriSiniri !== undefined ? { gunlukCagriSiniri: girdi.gunlukCagriSiniri } : {}),
          ...(girdi.girisTokenMilyonUsd !== undefined ? { girisTokenMilyonUsd: girdi.girisTokenMilyonUsd } : {}),
          ...(girdi.cikisTokenMilyonUsd !== undefined ? { cikisTokenMilyonUsd: girdi.cikisTokenMilyonUsd } : {}),
          ...(girdi.aylikMaliyetButcesiUsd !== undefined ? { aylikMaliyetButcesiUsd: girdi.aylikMaliyetButcesiUsd } : {}),
          ...(girdi.ozelliklerEtkin !== undefined ? { ozelliklerEtkin: girdi.ozelliklerEtkin } : {}),
          ...(girdi.telemetriSaklamaGun !== undefined ? { telemetriSaklamaGun: girdi.telemetriSaklamaGun } : {}),
          ...(girdi.sohbetSaklamaGun !== undefined ? { sohbetSaklamaGun: girdi.sohbetSaklamaGun } : {}),
          ...(girdi.telemetriHataEsigiYuzde !== undefined ? { telemetriHataEsigiYuzde: girdi.telemetriHataEsigiYuzde } : {}),
          ...(girdi.telemetriGecikmeEsigiMs !== undefined ? { telemetriGecikmeEsigiMs: girdi.telemetriGecikmeEsigiMs } : {}),
        },
      });
    });
  }

  /**
   * Sağlayıcı bağlantısını test eder
   */
  async baglantiTestEt(tenantId: string, girdi: TenantAiYapilandirma) {
    try {
      // Eğer apiKey maskeli gelmişse ve DB'de varsa gerçeğini çek
      let testKey = girdi.apiKey;
      if (!testKey || maskeliMi(testKey)) {
        const mevcut = await this.prisma.tenantIslem(tenantId, (tx) =>
          tx.tenantAiAyari.findUnique({ where: { tenantId } }),
        );
        if (mevcut?.apiKey) testKey = hassasCoz(mevcut.apiKey);
      }

      const provider = AiProviderFactory.uret({
        ...girdi,
        apiKey: testKey,
      });

      const yanit = await provider.metinUret({
        prompt: "TekirExtra ERP sistem testi: 'BAĞLANTI_BAŞARILI' yaz.",
      });

      return {
        basarili: true,
        saglayici: provider.saglayiciAdi,
        yanit: yanit.trim(),
      };
    } catch (hata) {
      this.logger.error("AI Bağlantı test hatası", hata);
      return {
        basarili: false,
        mesaj: hata instanceof Error ? hata.message : "Bağlantı kurulamadı",
      };
    }
  }

  // ─── GÖREVLER (AI-16) ──────────────────────────────────────────────────

  async gorevleriListele(tenantId: string) {
    const gorevler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
    );
    const sahipler = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findMany({ where: { id: { in: gorevler.map((g) => g.userId).filter((x): x is string => Boolean(x)) } }, select: { id: true, adSoyad: true } }),
    );
    const ad = new Map(sahipler.map((u) => [u.id, u.adSoyad]));
    return gorevler.map((g) => ({
      id: g.id, ad: g.ad, tur: g.tur, tetikleyici: g.tetikleyici, saat: g.zamanlamaCron ?? "09:00", gunler: g.gunler,
      esikTutar: g.esikTutar === null ? null : Number(g.esikTutar), gorevTalimati: g.gorevTalimati, aktif: g.aktif,
      sahip: g.userId ? ad.get(g.userId) ?? null : null, sonCalisma: g.sonCalisma, sonSonuc: g.sonSonuc, createdAt: g.createdAt,
    }));
  }

  async gorevOlustur(tenantId: string, girdi: unknown) {
    const g = this.gorevAyristir(gorevSemasi, girdi);
    const { userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.create({
        data: { tenantId, userId, ad: g.ad, tur: g.tur ?? "ASISTAN", tetikleyici: g.tetikleyici, zamanlamaCron: g.saat ?? "09:00", gunler: g.gunler ?? [], esikTutar: g.esikTutar ?? null, gorevTalimati: g.gorevTalimati ?? "", aktif: g.aktif ?? true, kanal: "PANEL" },
      }),
    );
  }

  async gorevGuncelle(tenantId: string, id: string, girdi: unknown) {
    const g = this.gorevAyristir(gorevAlanlari.partial(), girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.tenantAiGorev.findUnique({ where: { id } });
      if (!mevcut) throw new BadRequestException("Görev bulunamadı.");
      this.gorevAyristir(gorevTamSemasi, {
        ad: g.ad ?? mevcut.ad,
        tur: g.tur ?? mevcut.tur,
        tetikleyici: g.tetikleyici ?? mevcut.tetikleyici,
        saat: g.saat ?? mevcut.zamanlamaCron ?? "09:00",
        gunler: g.gunler ?? mevcut.gunler,
        esikTutar: g.esikTutar !== undefined ? g.esikTutar : mevcut.esikTutar === null ? null : Number(mevcut.esikTutar),
        gorevTalimati: g.gorevTalimati ?? mevcut.gorevTalimati,
        aktif: g.aktif ?? mevcut.aktif,
      });
      return tx.tenantAiGorev.update({
        where: { id },
        data: {
          ...(g.ad !== undefined ? { ad: g.ad } : {}),
          ...(g.tur !== undefined ? { tur: g.tur } : {}),
          ...(g.tetikleyici !== undefined ? { tetikleyici: g.tetikleyici } : {}),
          ...(g.saat !== undefined ? { zamanlamaCron: g.saat } : {}),
          ...(g.gunler !== undefined ? { gunler: g.gunler } : {}),
          ...(g.esikTutar !== undefined ? { esikTutar: g.esikTutar } : {}),
          ...(g.gorevTalimati !== undefined ? { gorevTalimati: g.gorevTalimati } : {}),
          ...(g.aktif !== undefined ? { aktif: g.aktif } : {}),
        },
      });
    });
  }

  async gorevSil(tenantId: string, id: string) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.tenantAiGorev.delete({ where: { id } }));
  }

  /** Elle çalıştırma: görev sahibinin kimliği ve güncel rolüyle, yalnız okuma (AI-16) ya da deterministik analiz (AI-23). */
  async gorevCalistir(tenantId: string, id: string) {
    const gorev = await this.prisma.tenantIslem(tenantId, (tx) => tx.tenantAiGorev.findUnique({ where: { id } }));
    if (!gorev) throw new BadRequestException("Görev bulunamadı.");
    const sonuc = await this.gorevYurutucu.yurut(tenantId, gorev);
    return { gorevId: gorev.id, ad: gorev.ad, raporIcerigi: sonuc.metin, tarih: new Date().toISOString() };
  }

  private gorevAyristir<T>(sema: z.ZodType<T>, girdi: unknown): T {
    const sonuc = sema.safeParse(girdi);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((x) => x.message).join("; "));
    return sonuc.data;
  }

  /**
   * AI-14: yurt dışı aktarım onayı. Onaylayan ve zaman kaydedilir; geri alınırsa
   * dış sağlayıcıya istek gitmez.
   */
  async yurtDisiOnay(tenantId: string, onay: boolean, politikaSurumu?: string) {
    if (onay && politikaSurumu !== AI_AKTARIM_POLITIKA_SURUMU) throw new BadRequestException("Aktarım onayı metni güncel değil. Ekranı yenileyip tekrar okuyun.");
    const { userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const ayar = await tx.tenantAiAyari.findUnique({ where: { tenantId } });
      const etkin = AiProviderFactory.uret(ayar ? ayardanYapilandirma(ayar) : undefined);
      const saglayici = etkin.saglayiciAdi;
      // Ekonomik ve güçlü model de onayın kapsamındadır (virgülle saklanır).
      const model = (ayar ? ayarModelleri(ayar, etkin.modelAdi) : [etkin.modelAdi].filter(Boolean)).join(", ") || null;
      const olay = { tenantId, userId, olay: onay ? "onaylandi" : "geri_alindi", saglayici, model, politikaSurumu: AI_AKTARIM_POLITIKA_SURUMU };
      await tx.aiVeriAktarimOnayi.create({ data: olay });
      const veri = onay
        ? { yurtDisiOnayAt: new Date(), yurtDisiOnayUserId: userId, yurtDisiOnaySaglayici: saglayici, yurtDisiOnayModel: model, yurtDisiOnayPolitika: AI_AKTARIM_POLITIKA_SURUMU }
        : { yurtDisiOnayAt: null, yurtDisiOnayUserId: null, yurtDisiOnaySaglayici: null, yurtDisiOnayModel: null, yurtDisiOnayPolitika: null };
      await tx.tenantAiAyari.upsert({ where: { tenantId }, create: { tenantId, saglayici, ...veri }, update: veri });
    });
    this.logger.log(`Yurt dışı aktarım onayı ${onay ? "verildi" : "geri alındı"} (kiracı ${tenantId}, kullanıcı ${userId})`);
    return this.ayarGetir(tenantId);
  }

  /** AI-15: son 30 günün çağrıları ve içerik barındırmayan operasyonel telemetri özeti. */
  async kalite(tenantId: string) {
    const satirlar = await this.prisma.tenantIslem(tenantId, tx => tx.ajanMesajGecmisi.findMany({
      where: { oturum: { tenantId }, rol: "assistant", geriBildirim: { not: null }, geriBildirimAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select: { saglayici: true, model: true, geriBildirim: true, aracCagrisi: true },
      orderBy: { geriBildirimAt: "desc" }, take: 1001,
    }));
    const modeller = new Map<string, { saglayici: string; model: string; dogru: number; yanlis: number; eksik: number }>();
    const araclar = new Map<string, { arac: string; dogru: number; yanlis: number; eksik: number }>();
    const secilen = satirlar.slice(0, 1000);
    for (const s of secilen) {
      const deger = s.geriBildirim;
      if (deger !== "dogru" && deger !== "yanlis" && deger !== "eksik") continue;
      const saglayici = s.saglayici ?? "Eski kayıt", model = s.model ?? "Bilinmiyor";
      const anahtar = JSON.stringify([saglayici, model]);
      const grup = modeller.get(anahtar) ?? { saglayici, model, dogru: 0, yanlis: 0, eksik: 0 };
      grup[deger]++; modeller.set(anahtar, grup);
      const iz = s.aracCagrisi as { araclar?: Array<{ ad?: string }> } | null;
      if (!Array.isArray(iz?.araclar)) continue;
      for (const ad of new Set(iz.araclar.map(a => a?.ad).filter((ad): ad is string => typeof ad === "string"))) {
        const arac = araclar.get(ad) ?? { arac: ad, dogru: 0, yanlis: 0, eksik: 0 };
        arac[deger]++; araclar.set(ad, arac);
      }
    }
    return { gun: 30, toplam: secilen.length, sinirli: satirlar.length > 1000, modeller: [...modeller.values()], araclar: [...araclar.values()] };
  }

  async kullanim(tenantId: string) {
    const baslangic = new Date(Date.now() - 30 * 86_400_000);
    const ayBaslangici = istanbulAyBaslangici();
    const [satirlar, ayar, izler, ayMaliyeti, tahminiCagri] = await this.prisma.tenantIslem(tenantId, (tx) =>
      Promise.all([
        tx.aiKullanim.groupBy({ by: ["gun", "ozellik"], where: { tenantId, gun: { gte: baslangic } }, _sum: { cagri: true }, orderBy: { gun: "desc" } }),
        tx.tenantAiAyari.findUnique({ where: { tenantId }, select: { gunlukCagriSiniri: true, telemetriSaklamaGun: true, sohbetSaklamaGun: true, telemetriHataEsigiYuzde: true, telemetriGecikmeEsigiMs: true, girisTokenMilyonUsd: true, cikisTokenMilyonUsd: true, aylikMaliyetButcesiUsd: true, saglayici: true, apiKey: true } }),
        tx.aiCagriIz.groupBy({
          by: ["userId", "ozellik", "saglayici", "model", "basarili"],
          where: { tenantId, createdAt: { gte: baslangic } },
          _count: { _all: true },
          _avg: { sureMs: true },
          _sum: { girisToken: true, cikisToken: true, maliyetUsd: true },
          orderBy: [{ userId: "asc" }, { saglayici: "asc" }, { ozellik: "asc" }],
        }),
        tx.aiCagriIz.aggregate({ where: { tenantId, createdAt: { gte: ayBaslangici } }, _sum: { maliyetUsd: true } }),
        tx.aiCagriIz.count({ where: { tenantId, createdAt: { gte: ayBaslangici }, maliyetTahmini: true } }),
      ]),
    );
    const butce = await this.prisma.tenantIslem(tenantId, (tx) => kiraciButceKurali(tx, tenantId, ayar, platformAnahtariMi(ayar)));
    const kullaniciIdleri = [...new Set(izler.map((x) => x.userId))];
    const kullanicilar = kullaniciIdleri.length ? await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({ where: { tenantId, id: { in: kullaniciIdleri } }, select: { id: true, adSoyad: true } })) : [];
    const kullaniciAdlari = new Map(kullanicilar.map((x) => [x.id, x.adSoyad]));
    const bugun = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    const gunler = satirlar.map((x) => ({ gun: x.gun.toISOString().slice(0, 10), ozellik: x.ozellik, cagri: x._sum.cagri ?? 0 }));
    return {
      gunlukSinir: ayar?.gunlukCagriSiniri ?? VARSAYILAN_GUNLUK_SINIR,
      maliyetButcesi: {
        paraBirimi: "USD",
        ayBaslangici: ayBaslangici.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }),
        buAyUsd: ayMaliyeti._sum.maliyetUsd?.toNumber() ?? null,
        aylikUsd: ayar?.aylikMaliyetButcesiUsd?.toNumber() ?? null,
        girisMilyonTokenUsd: ayar?.girisTokenMilyonUsd?.toNumber() ?? null,
        cikisMilyonTokenUsd: ayar?.cikisTokenMilyonUsd?.toNumber() ?? null,
        // AI-28…31: uygulanan sınır ve maliyetin hangi fiyatla ölçüldüğü.
        platformAnahtari: butce.platformAnahtari,
        platformTavaniUsd: butce.platformTavaniUsd,
        uygulananSinirUsd: butce.sinirUsd,
        olculebilir: butce.sinirUsd === null || butce.fiyat !== null,
        tahminiCagri,
        tahminUyarisi: butce.platformAnahtari
          ? "Platform anahtarıyla yapılan çağrılar platformun fiyatlarıyla hesaplanır; girdiğiniz token fiyatları kullanılmaz."
          : "Kayıtlı sağlayıcı/model için yöneticinin girdiği fiyatlarla hesaplanır; sağlayıcı faturasıyla birebir mutabakat garantisi vermez.",
      },
      telemetriAyarlari: {
        saklamaGun: ayar?.telemetriSaklamaGun ?? 90,
        sohbetSaklamaGun: ayar?.sohbetSaklamaGun ?? null,
        hataEsigiYuzde: ayar?.telemetriHataEsigiYuzde ?? 20,
        gecikmeEsigiMs: ayar?.telemetriGecikmeEsigiMs ?? 10_000,
      },
      bugunToplam: gunler.filter((g) => g.gun === bugun).reduce((t, g) => t + g.cagri, 0),
      gunler,
      telemetri: izler.map((x) => ({
        kullanici: kullaniciAdlari.get(x.userId) ?? "Kullanıcı",
        ozellik: x.ozellik,
        saglayici: x.saglayici,
        model: x.model,
        basarili: x.basarili,
        cagri: x._count._all,
        ortalamaSureMs: Math.round(x._avg.sureMs ?? 0),
        girisToken: x._sum.girisToken ?? 0,
        cikisToken: x._sum.cikisToken ?? 0,
        maliyetUsd: x._sum.maliyetUsd?.toNumber() ?? null,
      })),
    };
  }
}
