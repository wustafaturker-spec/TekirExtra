import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Baglanti } from "@prisma/client";
import {
  MockEntegratorAdapter,
  SovosEntegratorAdapter,
  type EntegratorAdapter,
  type EntegratorConfig,
} from "@tekirextra/baglanti";
import { BAGLANTI_AILELERI, BANKA_SAGLAYICILARI, EBELGE_SAGLAYICILARI, PAZARYERI_SAGLAYICILARI, POS_SAGLAYICILARI, SMS_SAGLAYICILARI } from "@tekirextra/shared";
import { z } from "zod";
import { coz, sifrele } from "../core/kripto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

export const baglantiOlusturSemasi = z.object({
  aile: z.enum(BAGLANTI_AILELERI),
  saglayici: z.string(),
  config: z.object({
    kullaniciAdi: z.string().min(1),
    parola: z.string().optional(),
    apiAnahtari: z.string().optional(),
    servisAdresi: z.string().optional(),
    earsivServisAdresi: z.string().optional(),
    vknTckn: z.string().regex(/^\d{10,11}$/).optional(),
    gondericiBirimEtiketi: z.string().optional(),
    postaKutusuEtiketi: z.string().optional(),
    saticiId: z.string().optional(),
    magazaId: z.string().optional(),
    gondericiAdi: z.string().optional(),
    bankaHesapId: z.string().uuid().optional(),
  }),
}).superRefine((girdi, ctx) => {
  const izinli = girdi.aile === "ebelge" ? EBELGE_SAGLAYICILARI : girdi.aile === "pazaryeri" ? PAZARYERI_SAGLAYICILARI : girdi.aile === "pos" ? POS_SAGLAYICILARI : girdi.aile === "sms" ? SMS_SAGLAYICILARI : girdi.aile === "banka" ? BANKA_SAGLAYICILARI : [];
  if (!(izinli as readonly string[]).includes(girdi.saglayici)) ctx.addIssue({ code: "custom", path: ["saglayici"], message: "Sağlayıcı bağlantı ailesiyle uyumlu değil" });
  if (girdi.aile === "banka" && girdi.saglayici === "webhook" && (!girdi.config.apiAnahtari || girdi.config.apiAnahtari.length < 24)) ctx.addIssue({ code: "custom", path: ["config", "apiAnahtari"], message: "Banka bağlantısı erişim anahtarı en az 24 karakter olmalıdır" });
  if (girdi.aile === "banka" && girdi.saglayici === "webhook" && !girdi.config.bankaHesapId) ctx.addIssue({ code: "custom", path: ["config", "bankaHesapId"], message: "Banka hesabı zorunludur" });
  if (girdi.aile === "banka" && girdi.saglayici === "vomsis" && (!girdi.config.kullaniciAdi || !girdi.config.parola)) ctx.addIssue({ code: "custom", path: ["config"], message: "Vomsis App Key ve App Secret zorunludur" });
  if (girdi.aile === "ebelge" && girdi.saglayici === "sovos" && (!girdi.config.parola || !girdi.config.vknTckn || !girdi.config.gondericiBirimEtiketi || !girdi.config.servisAdresi)) ctx.addIssue({ code: "custom", path: ["config"], message: "Sovos için parola, VKN/TCKN, GB etiketi ve servis adresi zorunludur" });
});

export interface BaglantiGorunumu {
  id: string;
  aile: string;
  saglayici: string;
  durum: string;
  /** Kimlik bilgileri asla dönmez; yalnızca maskeli kullanıcı adı (EBLG-01b). */
  kullaniciAdiMaskeli: string;
}

function maskele(deger: string): string {
  if (deger.length <= 3) return "***";
  return `${deger.slice(0, 3)}***`;
}

/**
 * Dış bağlantı yönetimi (ENT-01, EBLG-01a/01b). Gerçek entegratör hesapları
 * Gerçek adaptörü bulunan sağlayıcı doğrudan ona, diğer sağlayıcılar mock
 * adaptöre çözümlenir.
 */
@Injectable()
export class BaglantilarService {
  /** Adaptörler durumsuzdur; sağlayıcı başına tek örnek yeter. Mock adaptör
   * gönderim durumunu bellekte tuttuğu için tekil örnek ayrıca şarttır:
   * her istekte yeni örnek üretilirse belge durumu (EBLG-04) izlenemez. */
  private readonly adapterler = new Map<string, EntegratorAdapter>();

  constructor(private readonly prisma: PrismaService) {}

  adapterCoz(saglayici: string): EntegratorAdapter {
    // T-01: gerçek adaptörler geldikçe burada sağlayıcıya göre dallanılır
    let adapter = this.adapterler.get(saglayici);
    if (!adapter) {
      adapter = saglayici === "sovos"
        ? new SovosEntegratorAdapter()
        : new MockEntegratorAdapter(saglayici as EntegratorConfig["saglayici"]);
      this.adapterler.set(saglayici, adapter);
    }
    return adapter;
  }

  async listele(): Promise<BaglantiGorunumu[]> {
    const { tenantId } = aktifBaglam();
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findMany({ orderBy: { createdAt: "asc" } }),
    );
    return kayitlar.map((k) => this.gorunum(k));
  }

  async olustur(girdi: z.infer<typeof baglantiOlusturSemasi>): Promise<BaglantiGorunumu> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (girdi.aile === "banka" && girdi.saglayici === "webhook") {
        const hesap = await tx.bankaHesap.findUnique({ where: { id: girdi.config.bankaHesapId } });
        if (!hesap) throw new BadRequestException("Banka hesabı bulunamadı");
      }
      const mevcut = await tx.baglanti.findFirst({
        where: { aile: girdi.aile, saglayici: girdi.saglayici },
      });
      if (mevcut) {
        throw new BadRequestException(
          `'${girdi.saglayici}' entegratörü zaten tanımlı; güncellemek için düzenleyin.`,
        );
      }
      return tx.baglanti.create({
        data: {
          tenantId,
          aile: girdi.aile,
          saglayici: girdi.saglayici,
          sifreliConfig: sifrele(
            JSON.stringify({ saglayici: girdi.saglayici, ...girdi.config }),
          ),
        },
      });
    });
    return this.gorunum(kayit);
  }

  async guncelle(
    id: string,
    girdi: { config: z.infer<typeof baglantiOlusturSemasi>["config"] },
  ): Promise<BaglantiGorunumu> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.baglanti.findUnique({ where: { id } });
      if (!mevcut) throw new NotFoundException("Bağlantı bulunamadı");

      return tx.baglanti.update({
        where: { id },
        data: {
          sifreliConfig: sifrele(
            JSON.stringify({ saglayici: mevcut.saglayici, ...girdi.config }),
          ),
          durum: "pasif",
        },
      });
    });
    return this.gorunum(kayit);
  }

  async aktifEt(id: string): Promise<BaglantiGorunumu> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const hedef = await tx.baglanti.findUnique({ where: { id } });
      if (!hedef) throw new NotFoundException("Bağlantı bulunamadı");

      // e-Belgede tek aktif sağlayıcı vardır; pazaryerlerinde mağazalar birlikte çalışabilir.
      if (hedef.aile === "ebelge") await tx.baglanti.updateMany({
        where: { tenantId, aile: "ebelge", id: { not: id } }, data: { durum: "pasif" },
      });

      // Hedef bağlantıyı aktif yap
      return tx.baglanti.update({
        where: { id },
        data: { durum: "aktif" },
      });
    });
    return this.gorunum(kayit);
  }

  async test(id: string): Promise<{ basarili: boolean; mesaj?: string }> {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findUnique({ where: { id } }),
    );
    if (!kayit) throw new NotFoundException("Bağlantı bulunamadı");

    const config = JSON.parse(coz(kayit.sifreliConfig)) as EntegratorConfig & { saticiId?: string; magazaId?: string; apiAnahtari?: string; gondericiAdi?: string };
    const pazaryeriKimligiGecerli = kayit.saglayici === "amazon_tr"
      ? Boolean(config.kullaniciAdi && config.parola && config.apiAnahtari && config.saticiId && config.magazaId)
      : Boolean(config.kullaniciAdi && config.parola && (kayit.saglayici === "n11" || config.saticiId || config.magazaId));
    const posKimligiGecerli = kayit.saglayici === "paytr" ? Boolean(config.kullaniciAdi && config.parola && config.magazaId) : Boolean(config.kullaniciAdi && config.parola && (config.servisAdresi === "https://sandbox-api.iyzipay.com" || config.servisAdresi === "https://api.iyzipay.com"));
    const smsKimligiGecerli = Boolean(config.kullaniciAdi && config.parola && config.gondericiAdi);
    const bankaKimligiGecerli = kayit.saglayici === "vomsis" ? Boolean(config.kullaniciAdi && config.parola) : Boolean(config.kullaniciAdi && config.apiAnahtari && (config as any).bankaHesapId);
    const bicimGecerli = kayit.aile === "pos" ? posKimligiGecerli : kayit.aile === "sms" ? smsKimligiGecerli : kayit.aile === "banka" ? bankaKimligiGecerli : pazaryeriKimligiGecerli;
    const sonuc = ["pazaryeri", "pos", "sms", "banka"].includes(kayit.aile)
      ? { basarili: bicimGecerli, mesaj: bicimGecerli ? "Kimlik biçimi doğrulandı; canlı test ilk işlem sırasında yapılacaktır" : "Sağlayıcı için zorunlu kimlik alanları eksik" }
      : await this.adapterCoz(kayit.saglayici).baglantiTest(config);

    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.update({
        where: { id },
        data: { durum: sonuc.basarili ? "aktif" : "hata" },
      }),
    );
    return sonuc;
  }

  async sil(id: string): Promise<void> {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.deleteMany({ where: { id } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Bağlantı bulunamadı");
  }

  private gorunum(k: Baglanti): BaglantiGorunumu {
    let kullaniciAdi = "";
    try {
      kullaniciAdi = (JSON.parse(coz(k.sifreliConfig)) as EntegratorConfig)
        .kullaniciAdi;
    } catch {
      kullaniciAdi = "";
    }
    return {
      id: k.id,
      aile: k.aile,
      saglayici: k.saglayici,
      durum: k.durum,
      kullaniciAdiMaskeli: maskele(kullaniciAdi),
    };
  }
}
