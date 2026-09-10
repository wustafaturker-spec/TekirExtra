import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Baglanti } from "@prisma/client";
import {
  MockEntegratorAdapter,
  NesEntegratorAdapter,
  SovosEntegratorAdapter,
  type EntegratorAdapter,
  type EntegratorConfig,
} from "@tekirextra/baglanti";
import { BAGLANTI_AILELERI, BANKA_SAGLAYICILARI, EBELGE_SAGLAYICILARI, PAZARYERI_SAGLAYICILARI, POS_SAGLAYICILARI, SMS_SAGLAYICILARI } from "@tekirextra/shared";
import { z } from "zod";
import { coz, sifrele } from "../core/kripto";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

/**
 * Gerçek entegratör adaptörü bulunan sağlayıcılar. Buradaki bir sağlayıcı
 * üretimde de kullanılabilir; listede olmayan yalnızca mock ile çalışır.
 */
const GERCEK_ADAPTORLER: Record<string, () => EntegratorAdapter> = {
  sovos: () => new SovosEntegratorAdapter(),
  nes: () => new NesEntegratorAdapter(),
};

export const baglantiOlusturSemasi = z.object({
  aile: z.enum(BAGLANTI_AILELERI),
  saglayici: z.string(),
  config: z.object({
    kullaniciAdi: z.string().min(1),
    parola: z.string().optional(),
    apiAnahtari: z.string().optional(),
    servisAdresi: z.string().optional(),
    earsivServisAdresi: z.string().optional(),
    irsaliyeServisAdresi: z.string().optional(),
    vknTckn: z.string().regex(/^\d{10,11}$/).optional(),
    gondericiBirimEtiketi: z.string().optional(),
    belgeSeriOneki: z.string().min(1).max(8).optional(),
    earsivSeriOneki: z.string().min(1).max(8).optional(),
    eirsaliyeSeriOneki: z.string().length(3, "e-İrsaliye seri öneki 3 harf olmalıdır").optional(),
    eirsaliyeYanitSeriOneki: z.string().length(3, "e-İrsaliye yanıt seri öneki 3 harf olmalıdır").optional(),
    testOrtami: z.boolean().optional(),
    postaKutusuEtiketi: z.string().optional(),
    saticiId: z.string().optional(),
    magazaId: z.string().optional(),
    gondericiAdi: z.string().optional(),
    bankaHesapId: z.string().uuid().optional(),
  }),
}).superRefine((girdi, ctx) => {
  const izinli = girdi.aile === "ebelge" ? EBELGE_SAGLAYICILARI : girdi.aile === "pazaryeri" ? PAZARYERI_SAGLAYICILARI : girdi.aile === "pos" ? POS_SAGLAYICILARI : girdi.aile === "sms" ? SMS_SAGLAYICILARI : girdi.aile === "banka" ? BANKA_SAGLAYICILARI : [];
  if (!(izinli as readonly string[]).includes(girdi.saglayici)) ctx.addIssue({ code: "custom", path: ["saglayici"], message: "Sağlayıcı bağlantı ailesiyle uyumlu değil" });
  // GİB e-Fatura ve e-Arşiv serilerinin farklı olmasını ister; aynı önek
  // girilirse hata gönderim anında entegratörden döner, formda yakalamak daha
  // ucuz.
  // Yanıt belgesi irsaliyeden ayrı bir belge; aynı seriden numara alırlarsa
  // seri içinde numara çakışır.
  if (girdi.config.eirsaliyeYanitSeriOneki && girdi.config.eirsaliyeYanitSeriOneki === girdi.config.eirsaliyeSeriOneki) ctx.addIssue({ code: "custom", path: ["config", "eirsaliyeYanitSeriOneki"], message: "Yanıt serisi e-İrsaliye serisinden farklı olmalıdır" });
  if (girdi.config.earsivSeriOneki && girdi.config.earsivSeriOneki === girdi.config.belgeSeriOneki) ctx.addIssue({ code: "custom", path: ["config", "earsivSeriOneki"], message: "e-Arşiv serisi e-Fatura serisinden farklı olmalıdır" });
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
 * Dış bağlantı yönetimi (ENT-01, EBLG-01a/01b). Gerçek adaptörü bulunan
 * sağlayıcı doğrudan ona çözümlenir. Mock adapter yalnızca geliştirme/testte
 * veya açıkça ALLOW_MOCK_ENTEGRATIONS=true ile kullanılabilir; production'da
 * yanlışlıkla başarılı görünen sahte gönderim varsayılan olarak engellenir.
 */
@Injectable()
export class BaglantilarService {
  /** Adaptörler durumsuzdur; sağlayıcı başına tek örnek yeter. Mock adaptör
   * gönderim durumunu bellekte tuttuğu için tekil örnek ayrıca şarttır:
   * her istekte yeni örnek üretilirse belge durumu (EBLG-04) izlenemez. */
  private readonly adapterler = new Map<string, EntegratorAdapter>();

  constructor(private readonly prisma: PrismaService) {}

  adapterCoz(saglayici: string): EntegratorAdapter {
    const uret = GERCEK_ADAPTORLER[saglayici];
    const mockaIzinVar = process.env.ALLOW_MOCK_ENTEGRATIONS === "true" || process.env.NODE_ENV !== "production";
    if (!uret && !mockaIzinVar) {
      throw new BadRequestException(
        `${saglayici} sağlayıcısı için gerçek entegrasyon henüz etkin değil. Üretimde mock entegrasyon kullanılamaz.`,
      );
    }
    let adapter = this.adapterler.get(saglayici);
    if (!adapter) {
      adapter = uret ? uret() : new MockEntegratorAdapter(saglayici as EntegratorConfig["saglayici"]);
      this.adapterler.set(saglayici, adapter);
    }
    return adapter;
  }

  /**
   * Aktif e-Belge entegratörünün belge numarasını kendisinin atayıp atmadığını
   * söyler (EBLG-16). Sağlayıcı otomatik seri kullanıyorsa numarayı biz
   * üretmeyiz — iki sayaç aynı anda çalışamaz. Çağıranın açık işlemi içinde
   * okunabilsin diye `tx` dışarıdan verilir.
   */
  async numaralandirma(tx: Prisma.TransactionClient): Promise<{ saglayiciAtar: boolean; seriOneki?: string }> {
    const { tenantId } = aktifBaglam();
    const baglanti = await tx.baglanti.findFirst({
      where: { tenantId, aile: "ebelge", durum: "aktif" },
      select: { saglayici: true, sifreliConfig: true },
    });
    if (!baglanti) return { saglayiciAtar: false };
    if (!GERCEK_ADAPTORLER[baglanti.saglayici]) return { saglayiciAtar: false };
    if (!this.adapterCoz(baglanti.saglayici).belgeNoAtar) return { saglayiciAtar: false };
    // Sağlayıcı yetenekli olsa da devir ancak seri öneki tanımlıysa geçerlidir;
    // önek yoksa firma otomatik olmayan seri kullanıyor demektir.
    const seriOneki = (JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig).belgeSeriOneki;
    return seriOneki ? { saglayiciAtar: true, seriOneki } : { saglayiciAtar: false };
  }

  /**
   * e-İrsaliye seri öneki (EBLG-20). Numarayı fatura ve e-Arşiv'in aksine biz
   * üretiriz; burada yalnız hangi seriden üretileceği okunur. Tanımsızsa
   * belge modülünün varsayılanı kullanılır.
   */
  async irsaliyeSeriOneki(tx: Prisma.TransactionClient): Promise<string | undefined> {
    const { tenantId } = aktifBaglam();
    const baglanti = await tx.baglanti.findFirst({
      where: { tenantId, aile: "ebelge", durum: "aktif" },
      select: { sifreliConfig: true },
    });
    if (!baglanti) return undefined;
    return (JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig).eirsaliyeSeriOneki;
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

    // Test yalnızca sonucu raporlar, bağlantıyı **aktifleştirmez**.
    // Aktifleştirme ayrı bir eylemdir (`aktifEt`) ve e-Belgede tek aktif
    // sağlayıcı kuralını uygular. Burada doğrudan aktife çekmek, ikinci bir
    // e-Belge bağlantısı test edildiğinde iki aktif kayıt doğuruyor ve hangi
    // entegratörün kullanılacağını belirsiz bırakıyordu.
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.update({
        where: { id },
        data: { durum: sonuc.basarili ? (kayit.durum === "aktif" ? "aktif" : "pasif") : "hata" },
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
