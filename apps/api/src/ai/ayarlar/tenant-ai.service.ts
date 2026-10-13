import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../../core/prisma.service";
import { AiProviderFactory, TenantAiYapilandirma, kiraciAdresiHatasi } from "../saglayici/ai-provider.factory";
import { apiAnahtariMaskele, apiAnahtariSifrele, kiraciSaglayicisi, maskeliMi, VARSAYILAN_GUNLUK_SINIR } from "../saglayici/kiraci-saglayici";
import { aktifBaglam } from "../../core/istek-baglami";
import { hassasCoz } from "../../personel/personel-hassas";

export interface TenantAiAyariGirdi {
  saglayici?: string;
  apiKey?: string | null;
  modelAdi?: string | null;
  baseUrl?: string | null;
  ozelTalimatlar?: string | null;
  guvenlikKurallari?: Record<string, unknown> | null;
  /** AI-15: 1–100.000. */
  gunlukCagriSiniri?: number;
}

export interface TenantAiGorevGirdi {
  ad: string;
  tetikleyici: "ZAMANLANMIS" | "VADE_GECIKMESI" | "KASA_KRITIK";
  zamanlamaCron?: string | null;
  gorevTalimati: string;
  kanal?: "WHATSAPP" | "EMAIL" | "PANEL";
  hedefKimlik?: string | null;
  aktif?: boolean;
}

@Injectable()
export class TenantAiService {
  private readonly logger = new Logger(TenantAiService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      return {
        saglayici: "varsayilan",
        apiKey: null,
        modelAdi: null,
        baseUrl: null,
        ozelTalimatlar: null,
        guvenlikKurallari: null,
        yurtDisiOnay: null,
        gunlukCagriSiniri: VARSAYILAN_GUNLUK_SINIR,
      };
    }
    const onaylayan = ayar.yurtDisiOnayUserId
      ? await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: ayar.yurtDisiOnayUserId! }, select: { adSoyad: true } }))
      : null;

    return {
      ...ayar,
      // AI-11: yalnız son 4 karakter görünür.
      apiKey: apiAnahtariMaskele(ayar.apiKey),
      hasApiKey: Boolean(ayar.apiKey),
      yurtDisiOnay: ayar.yurtDisiOnayAt ? { tarih: ayar.yurtDisiOnayAt, onaylayan: onaylayan?.adSoyad ?? null } : null,
    };
  }

  /**
   * Kiracı AI ayarlarını kaydeder veya günceller
   */
  async ayarKaydet(tenantId: string, girdi: TenantAiAyariGirdi) {
    if (girdi.gunlukCagriSiniri !== undefined && (!Number.isInteger(girdi.gunlukCagriSiniri) || girdi.gunlukCagriSiniri < 1 || girdi.gunlukCagriSiniri > 100_000)) {
      throw new BadRequestException("Günlük çağrı sınırı 1 ile 100.000 arasında bir tam sayı olmalıdır.");
    }
    if (girdi.baseUrl?.trim()) {
      const hata = kiraciAdresiHatasi(girdi.baseUrl.trim());
      if (hata) throw new BadRequestException(`Sağlayıcı adresi: ${hata}`);
    }
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.tenantAiAyari.findUnique({ where: { tenantId } });

      // Maske geri geldiyse anahtar değişmemiştir; yeni anahtar şifrelenerek saklanır (AI-11).
      let yeniApiKey: string | null | undefined = girdi.apiKey === undefined ? undefined : apiAnahtariSifrele(girdi.apiKey);
      if (girdi.apiKey && maskeliMi(girdi.apiKey)) {
        yeniApiKey = mevcut?.apiKey ? apiAnahtariSifrele(hassasCoz(mevcut.apiKey)) : null;
      }

      return tx.tenantAiAyari.upsert({
        where: { tenantId },
        create: {
          tenantId,
          saglayici: girdi.saglayici || "varsayilan",
          apiKey: yeniApiKey || null,
          modelAdi: girdi.modelAdi || null,
          baseUrl: girdi.baseUrl || null,
          ozelTalimatlar: girdi.ozelTalimatlar || null,
          guvenlikKurallari: (girdi.guvenlikKurallari as any) || null,
          ...(girdi.gunlukCagriSiniri !== undefined ? { gunlukCagriSiniri: girdi.gunlukCagriSiniri } : {}),
        },
        update: {
          // Gönderilmeyen alan değişmez (yalnız sınır kaydı sağlayıcıyı sıfırlıyordu).
          ...(girdi.saglayici !== undefined ? { saglayici: girdi.saglayici || "varsayilan" } : {}),
          ...(yeniApiKey !== undefined ? { apiKey: yeniApiKey || null } : {}),
          modelAdi: girdi.modelAdi !== undefined ? girdi.modelAdi || null : undefined,
          baseUrl: girdi.baseUrl !== undefined ? girdi.baseUrl || null : undefined,
          ozelTalimatlar: girdi.ozelTalimatlar !== undefined ? girdi.ozelTalimatlar || null : undefined,
          guvenlikKurallari: girdi.guvenlikKurallari !== undefined ? (girdi.guvenlikKurallari as any) || null : undefined,
          ...(girdi.gunlukCagriSiniri !== undefined ? { gunlukCagriSiniri: girdi.gunlukCagriSiniri } : {}),
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

  // ─── GÖREVLER & UYARILAR (OTOMASYON) ──────────────────────────────────

  async gorevleriListele(tenantId: string) {
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  async gorevOlustur(tenantId: string, girdi: TenantAiGorevGirdi) {
    if (!girdi.ad || !girdi.gorevTalimati) {
      throw new BadRequestException("Görev adı ve talimatı zorunludur.");
    }

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.create({
        data: {
          tenantId,
          ad: girdi.ad,
          tetikleyici: girdi.tetikleyici,
          zamanlamaCron: girdi.zamanlamaCron || null,
          gorevTalimati: girdi.gorevTalimati,
          kanal: girdi.kanal || "WHATSAPP",
          hedefKimlik: girdi.hedefKimlik || null,
          aktif: girdi.aktif ?? true,
        },
      }),
    );
  }

  async gorevGuncelle(tenantId: string, id: string, girdi: Partial<TenantAiGorevGirdi>) {
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.update({
        where: { id },
        data: {
          ...(girdi.ad ? { ad: girdi.ad } : {}),
          ...(girdi.tetikleyici ? { tetikleyici: girdi.tetikleyici } : {}),
          ...(girdi.zamanlamaCron !== undefined ? { zamanlamaCron: girdi.zamanlamaCron } : {}),
          ...(girdi.gorevTalimati ? { gorevTalimati: girdi.gorevTalimati } : {}),
          ...(girdi.kanal ? { kanal: girdi.kanal } : {}),
          ...(girdi.hedefKimlik !== undefined ? { hedefKimlik: girdi.hedefKimlik } : {}),
          ...(girdi.aktif !== undefined ? { aktif: girdi.aktif } : {}),
        },
      }),
    );
  }

  async gorevSil(tenantId: string, id: string) {
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.delete({
        where: { id },
      }),
    );
  }

  /**
   * Görevi manuel olarak tetikler ve simüle eder
   */
  async gorevCalistir(tenantId: string, id: string) {
    const gorev = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.findUnique({ where: { id } }),
    );

    if (!gorev) throw new BadRequestException("Görev bulunamadı.");

    // Kiracının AI yapılandırmasını al
    const ayar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiAyari.findUnique({ where: { tenantId } }),
    );

    // AI-14/15: görev de onay kapısından ve sayaçtan geçer.
    const { saglayici: provider } = await kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "gorev" });

    const sistemRol = `
Sen TekirExtra ön muhasebe ve ERP yöneticisinin otonom yapay zeka asistanısın.
Görevin: "${gorev.ad}"
Şirket Özel Kuralları: ${ayar?.ozelTalimatlar || "Özel kural tanımlanmamış."}
Verilen talimata göre profesyonel, net ve eyleme geçirilebilir bir yönetici özeti/uyarısı hazırla.
`.trim();

    const prompt = `
Aşağıdaki görevi yerine getir ve yönetici için gönderilecek mesajı oluştur:
Talimat: "${gorev.gorevTalimati}"
Kanal: ${gorev.kanal}
Hedef: ${gorev.hedefKimlik || "Yönetici"}
`.trim();

    const uretilenRapor = await provider.metinUret({
      sistemRol,
      prompt,
    });

    const sonucMetni = uretilenRapor.trim();

    // Sonucu veritabanına işle
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiGorev.update({
        where: { id },
        data: {
          sonCalisma: new Date(),
          sonSonuc: sonucMetni,
        },
      }),
    );

    return {
      gorevId: gorev.id,
      ad: gorev.ad,
      kanal: gorev.kanal,
      hedef: gorev.hedefKimlik,
      raporIcerigi: sonucMetni,
      tarih: new Date().toISOString(),
    };
  }

  /**
   * AI-14: yurt dışı aktarım onayı. Onaylayan ve zaman kaydedilir; geri alınırsa
   * dış sağlayıcıya istek gitmez.
   */
  async yurtDisiOnay(tenantId: string, onay: boolean) {
    const { userId } = aktifBaglam();
    const veri = onay ? { yurtDisiOnayAt: new Date(), yurtDisiOnayUserId: userId } : { yurtDisiOnayAt: null, yurtDisiOnayUserId: null };
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenantAiAyari.upsert({ where: { tenantId }, create: { tenantId, ...veri }, update: veri }),
    );
    this.logger.log(`Yurt dışı aktarım onayı ${onay ? "verildi" : "geri alındı"} (kiracı ${tenantId}, kullanıcı ${userId})`);
    return this.ayarGetir(tenantId);
  }

  /** AI-15: son 30 günün çağrıları (gün ve özellik bazında) ve bugünkü toplam. */
  async kullanim(tenantId: string) {
    const baslangic = new Date(Date.now() - 30 * 86_400_000);
    const [satirlar, ayar] = await this.prisma.tenantIslem(tenantId, (tx) =>
      Promise.all([
        tx.aiKullanim.groupBy({ by: ["gun", "ozellik"], where: { tenantId, gun: { gte: baslangic } }, _sum: { cagri: true }, orderBy: { gun: "desc" } }),
        tx.tenantAiAyari.findUnique({ where: { tenantId }, select: { gunlukCagriSiniri: true } }),
      ]),
    );
    const bugun = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
    const gunler = satirlar.map((x) => ({ gun: x.gun.toISOString().slice(0, 10), ozellik: x.ozellik, cagri: x._sum.cagri ?? 0 }));
    return {
      gunlukSinir: ayar?.gunlukCagriSiniri ?? VARSAYILAN_GUNLUK_SINIR,
      bugunToplam: gunler.filter((g) => g.gun === bugun).reduce((t, g) => t + g.cagri, 0),
      gunler,
    };
  }
}
