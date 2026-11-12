import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ozelRolIstegiKapali } from "@tekirextra/shared";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifBaglam } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";
import { TELEGRAM_MODULU, telegramAyariOku, telegramAyariSemasi, telegramBotAdi, type DusmeNedeni } from "./telegram-ayar";

/** CNL-02: bağlama kodu 10 dakika geçerlidir. */
export const KOD_SURESI_MS = 10 * 60 * 1000;
/** CNL-18: kullanıcı başına 10 dakikada en çok bu kadar kod. */
const KOD_SINIRI = 5;

export const kodOzeti = (kod: string) => createHash("sha256").update(kod, "utf8").digest("hex");

/** Yapay zekâ asistanının ucu; özel rol bu kutuyu kapattıysa Telegram da kapalıdır. */
const ASISTAN_YOLU = "ai/ajan/mesaj";
const DAR_ROLLER = ["calisan", "b2b_bayi"];

export interface BagKarari { neden: DusmeNedeni | null; rol: string | null; ozelRol: { id: string; kapali: string[] } | null; moduller: string[] | null; tutarGoster: boolean }

/**
 * CNL-02/05/14/20: panel tarafı — kullanıcının kendi bağı ve yöneticinin ürün ayarı.
 * Bağın geçerliliği (`bagKarari`) Telegram süreciyle ortaktır: aynı kurallar iki yerde ayrı yazılmaz.
 */
@Injectable()
export class TelegramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erisim: AbonelikErisimService,
    private readonly durum: KullaniciDurumService,
  ) {}

  /**
   * Bağ bu an kullanılabilir mi? (`bag` null: yeni bağ kurulurken; oturum sürümü o an okunur.) `neden` doluysa bağ düşürülmelidir (rol_kapali hariç: o yalnız
   * reddedilir). Erişim okunamazsa hata fırlatır; geçici veritabanı hatası bağ düşürmez.
   */
  async bagKarari(tenantId: string, userId: string, bag: { oturumSurumu: number } | null): Promise<BagKarari> {
    const [ayar, moduller, abonelik, kullanici] = await Promise.all([
      this.prisma.tenantIslem(tenantId, (tx) => telegramAyariOku(tx, tenantId)),
      this.erisim.modulleriGetir(tenantId),
      this.erisim.getir(tenantId),
      this.durum.getir(tenantId, userId, true),
    ]);
    const temel = { rol: kullanici.rol, ozelRol: kullanici.ozelRol, moduller, tutarGoster: ayar.tutarGoster };
    const neden: DusmeNedeni | null =
      !ayar.etkin ? "urun_kapali"
        : moduller !== null && !moduller.includes("yapay_zeka") ? "plan_kapali"
          : abonelik.kisitli ? "firma_kisitli"
            : !kullanici.aktif || !kullanici.rol ? "kullanici_pasif"
              : bag && kullanici.oturumSurumu !== bag.oturumSurumu ? "oturum_degisti"
                // Panelde de asistana giremeyen dar roller (çalışan, bayi) Telegram'da da yanıt almaz.
                : DAR_ROLLER.includes(kullanici.rol) || (kullanici.ozelRol && ozelRolIstegiKapali(kullanici.ozelRol.kapali, "POST", ASISTAN_YOLU)) ? "rol_kapali"
                  : null;
    return { neden, ...temel };
  }

  /** Bağı düşürür ve denetim izine yazar. Bağ zaten yoksa sessizce döner. */
  async bagDusur(tenantId: string, userId: string, neden: DusmeNedeni | "panel" | "telegram", yapan: string | null = null): Promise<boolean> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const silinen = await tx.telegramBagi.deleteMany({ where: { tenantId, userId } });
      if (!silinen.count) return false;
      await tx.auditLog.create({ data: { tenantId, userId: yapan ?? userId, islem: "telegram_bag_kaldirildi", varlik: "telegram_bag", varlikId: userId, detay: { neden } } });
      return true;
    });
  }

  private async planAcik(tenantId: string): Promise<boolean> {
    const moduller = await this.erisim.modulleriGetir(tenantId);
    return moduller === null || moduller.includes("yapay_zeka");
  }

  /** Kullanıcının kendi Telegram durumu ve (yöneticiye) ürün ayarı. Özellik yoksa yalnız `kullanilabilir: false`. */
  async durumGetir() {
    const { tenantId, userId, rol } = aktifBaglam();
    const botAdi = telegramBotAdi();
    if (!botAdi || !(await this.planAcik(tenantId))) return { kullanilabilir: false as const };
    const { ayar, bag } = await this.prisma.tenantIslem(tenantId, async (tx) => ({
      ayar: await telegramAyariOku(tx, tenantId),
      bag: await tx.telegramBagi.findUnique({ where: { userId }, select: { kullaniciAdi: true, createdAt: true, oturumSurumu: true } }),
    }));
    let gorunenBag = bag;
    // CNL-02: kendiliğinden düşmüş bağ panelde bağlı görünmez.
    if (bag) {
      const karar = await this.bagKarari(tenantId, userId, bag);
      if (karar.neden && karar.neden !== "rol_kapali") { await this.bagDusur(tenantId, userId, karar.neden); gorunenBag = null; }
    }
    return {
      kullanilabilir: true as const,
      botAdi,
      urunEkli: ayar.etkin,
      yonetici: rol === "yonetici",
      ...(rol === "yonetici" ? { tutarGoster: ayar.tutarGoster, bagliKullanici: await this.prisma.tenantIslem(tenantId, (tx) => tx.telegramBagi.count({ where: { tenantId } })) } : {}),
      bag: gorunenBag ? { kullaniciAdi: gorunenBag.kullaniciAdi, baglandiAt: gorunenBag.createdAt.toISOString() } : null,
    };
  }

  /**
   * CNL-02/18: tek kullanımlık, 10 dakika geçerli, tahmin edilemez (192 bit) bağlama kodu.
   * Rıza açıkça alınmadan kod üretilmez; kullanıcının önceki kullanılmamış kodları geçersizleşir.
   */
  async kodUret(govde: unknown) {
    const { tenantId, userId } = aktifBaglam();
    if (!z.object({ riza: z.literal(true) }).strict().safeParse(govde).success) {
      throw new BadRequestException("Mesajların Telegram sunucularında saklanacağını onaylamanız gerekir.");
    }
    const botAdi = telegramBotAdi();
    if (!botAdi || !(await this.planAcik(tenantId))) throw new ForbiddenException("Telegram kanalı kullanılamıyor.");
    const kod = randomBytes(24).toString("base64url");
    const simdi = new Date();
    const sonGecerlilik = new Date(simdi.getTime() + KOD_SURESI_MS);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await telegramAyariOku(tx, tenantId)).etkin) throw new ForbiddenException("Telegram kanalı firmanızda eklenmemiş; yöneticiniz ekleyebilir.");
      // Aynı kullanıcının eşzamanlı istekleri sayımı aşmasın.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-kod:${userId}`}, 0))::text`;
      const son = await tx.telegramBaglamaKodu.count({ where: { userId, createdAt: { gt: new Date(simdi.getTime() - KOD_SURESI_MS) } } });
      if (son >= KOD_SINIRI) throw new HttpException("Çok sayıda bağlantı istendi; birkaç dakika sonra yeniden deneyin.", HttpStatus.TOO_MANY_REQUESTS);
      await tx.telegramBaglamaKodu.updateMany({ where: { userId, kullanildiAt: null, sonGecerlilik: { gt: simdi } }, data: { sonGecerlilik: simdi } });
      await tx.telegramBaglamaKodu.create({ data: { tenantId, userId, kodOzeti: kodOzeti(kod), sonGecerlilik, rizaAt: simdi } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "telegram_baglama_kodu_uretildi", varlik: "telegram_bag", varlikId: userId, detay: { sonGecerlilik: sonGecerlilik.toISOString() } } });
    });
    return { kod, baglanti: `https://t.me/${botAdi}?start=${kod}`, komut: `/start ${kod}`, sonGecerlilik: sonGecerlilik.toISOString() };
  }

  /** CNL-02: kullanıcı kendi bağını panelden kaldırır. */
  async bagKaldir() {
    const { tenantId, userId } = aktifBaglam();
    return { kaldirildi: await this.bagDusur(tenantId, userId, "panel") };
  }

  /**
   * CNL-05/20: yönetici ürünü ekler/çıkarır ve tutar gösterimini seçer. Çıkarınca firmanın
   * bütün bağları ve açık bağlama kodları aynı işlemde düşer; geçmiş kayıtlar kalır.
   */
  async urunAyarla(govde: unknown) {
    const { tenantId, userId, rol } = aktifBaglam();
    if (rol !== "yonetici") throw new ForbiddenException("Telegram kanalını yalnız yönetici ekleyip çıkarabilir.");
    const girdi = telegramAyariSemasi.safeParse(govde);
    if (!girdi.success) throw new BadRequestException("Geçersiz Telegram ayarı.");
    if (!telegramBotAdi() || !(await this.planAcik(tenantId))) throw new ForbiddenException("Telegram kanalı kullanılamıyor.");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-urun:${tenantId}`}, 0))::text`;
      const onceki = await telegramAyariOku(tx, tenantId);
      await tx.modulAyar.upsert({
        where: { tenantId_modul: { tenantId, modul: TELEGRAM_MODULU } },
        create: { tenantId, modul: TELEGRAM_MODULU, ayarlar: girdi.data as Prisma.InputJsonValue },
        update: { ayarlar: girdi.data as Prisma.InputJsonValue },
      });
      let dusenBag = 0;
      if (!girdi.data.etkin) {
        dusenBag = (await tx.telegramBagi.deleteMany({ where: { tenantId } })).count;
        await tx.telegramBaglamaKodu.updateMany({ where: { tenantId, kullanildiAt: null, sonGecerlilik: { gt: new Date() } }, data: { sonGecerlilik: new Date() } });
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "telegram_urun_guncellendi", varlik: "modul_ayar", varlikId: TELEGRAM_MODULU, detay: { onceki, yeni: girdi.data, dusenBag } } });
      return { ...girdi.data, dusenBag };
    });
  }
}
