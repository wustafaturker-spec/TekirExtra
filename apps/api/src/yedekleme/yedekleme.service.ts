import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { totpDogrula } from "../auth/totp-dogrula";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { nabizla } from "../core/nabiz/nabiz";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { aylikDenemeGerekli, otomatikYedekGunu, silinecekYedekler, sonrakiOtomatikYedek, YEDEK_ESIK, type YedekDurumu } from "./yedek-kurallari";

const BES_DAKIKA_MS = 5 * 60_000;
const SAYFA_BOYU = 25;
const sayi = (b: bigint | null) => (b === null ? null : Number(b));
const cakisma = (h: unknown) => h instanceof Prisma.PrismaClientKnownRequestError && h.code === "P2002";

/**
 * PLT-111…117: API yalnız talep ve işaret yazar; yedeği ayrı servis alır.
 * Planlayıcı API sürecinde çalışır: worker düşse de yedek istenir ve alarm gider.
 */
@Injectable()
export class YedeklemeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(YedeklemeService.name);
  private zamanlayici?: NodeJS.Timeout;

  constructor(private readonly platform: PlatformPrismaService, private readonly denemeler: GirisDenemeSayaci) {}

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER === "1" || !process.env.DATABASE_URL_PLATFORM || process.env.NODE_ENV === "test" || process.env.YEDEK_PLANLAYICI_KAPALI === "1") return;
    const calistir = () => void nabizla("yedek-planlayici", () => this.planla(), BES_DAKIKA_MS).catch((h: unknown) => this.logger.error(JSON.stringify({ event: "yedek_plan_failed", error: h instanceof Error ? h.message : String(h) })));
    setTimeout(calistir, 30_000).unref();
    this.zamanlayici = setInterval(calistir, BES_DAKIKA_MS);
    this.zamanlayici.unref();
  }

  onModuleDestroy(): void { if (this.zamanlayici) clearInterval(this.zamanlayici); }

  /** PLT-111/114/116: gecelik talep, saklama işareti ve aylık geri yükleme denemesi. */
  async planla(simdi = new Date()): Promise<void> {
    const db = this.platform.db;
    const yakin = await db.platformYedek.findMany({ where: { tur: "otomatik", talepAt: { gt: new Date(simdi.getTime() - 2 * 86_400_000) } }, select: { gun: true, durum: true } });
    const gun = otomatikYedekGunu(simdi, yakin);
    if (gun) {
      try { await db.platformYedek.create({ data: { tur: "otomatik", gun: new Date(`${gun}T00:00:00Z`) } }); }
      // Çalışan başka yedek varsa sonraki turda yeniden denenir.
      catch (h) { if (!cakisma(h)) throw h; }
    }
    const basarililar = await db.platformYedek.findMany({ where: { durum: "basarili", silinecek: false }, select: { id: true, tur: true, bitisAt: true, korunuyor: true } });
    const silinecek = silinecekYedekler(basarililar.map((y) => ({ id: y.id, tur: y.tur, tarih: y.bitisAt ?? simdi, korunuyor: y.korunuyor })), simdi);
    if (silinecek.length) await db.platformYedek.updateMany({ where: { id: { in: silinecek }, korunuyor: false, durum: "basarili" }, data: { silinecek: true } });

    const [sonDeneme, aktif] = await Promise.all([
      db.platformYedek.aggregate({ _max: { denemeAt: true } }),
      db.platformYedek.count({ where: { OR: [{ durum: { in: ["bekliyor", "calisiyor"] } }, { denemeDurum: { in: ["bekliyor", "calisiyor"] } }] } }),
    ]);
    if (!aktif && aylikDenemeGerekli(simdi, sonDeneme._max.denemeAt)) {
      const son = await db.platformYedek.findFirst({ where: { durum: "basarili", silinecek: false }, orderBy: { bitisAt: "desc" }, select: { id: true } });
      if (son) await db.platformYedek.updateMany({ where: { id: son.id, durum: "basarili" }, data: { denemeDurum: "bekliyor", denemeTalepAt: simdi } });
    }
  }

  /** PLT-117: sistem sağlığı alarmının girdisi. */
  async durum(simdi = new Date()): Promise<YedekDurumu> {
    const db = this.platform.db;
    const [ilk, sonBasarili, sonBiten, aktif, ajan, sonDeneme] = await Promise.all([
      db.platformYedek.findFirst({ orderBy: { talepAt: "asc" }, select: { talepAt: true } }),
      db.platformYedek.findFirst({ where: { durum: "basarili" }, orderBy: { bitisAt: "desc" }, select: { bitisAt: true, boyutBayt: true } }),
      db.platformYedek.findFirst({ where: { durum: { in: ["basarili", "hatali"] } }, orderBy: { bitisAt: "desc" }, select: { durum: true, hata: true } }),
      db.platformYedek.findFirst({ where: { durum: { in: ["bekliyor", "calisiyor"] } }, select: { durum: true, baslangicAt: true, talepAt: true } }),
      db.platformYedekAjan.findUnique({ where: { id: 1 } }),
      db.platformYedek.findFirst({ where: { denemeAt: { not: null } }, orderBy: { denemeAt: "desc" }, select: { denemeDurum: true, denemeDetay: true } }),
    ]);
    return {
      simdi, ilkTalepAt: ilk?.talepAt ?? null, sonBasariliAt: sonBasarili?.bitisAt ?? null, sonBiten, aktif,
      ajan: ajan ? { sonNabizAt: ajan.sonNabizAt, diskBosBayt: ajan.diskBosBayt } : null,
      sonBoyutBayt: sonBasarili?.boyutBayt ?? null,
      sonDeneme: sonDeneme ? { durum: sonDeneme.denemeDurum ?? "", detay: sonDeneme.denemeDetay } : null,
    };
  }

  /** PLT-113: ekran. */
  async ekran(sayfa: number) {
    const simdi = new Date();
    const db = this.platform.db;
    const [toplam, satirlar, sonBasarili, aktif, ajan] = await Promise.all([
      db.platformYedek.count(),
      db.platformYedek.findMany({ orderBy: { talepAt: "desc" }, skip: (sayfa - 1) * SAYFA_BOYU, take: SAYFA_BOYU, include: { baslatan: { select: { adSoyad: true } } } }),
      db.platformYedek.findFirst({ where: { durum: "basarili" }, orderBy: { bitisAt: "desc" }, select: { bitisAt: true, boyutBayt: true } }),
      db.platformYedek.findFirst({ where: { OR: [{ durum: { in: ["bekliyor", "calisiyor"] } }, { denemeDurum: { in: ["bekliyor", "calisiyor"] } }] }, select: { durum: true, denemeDurum: true } }),
      db.platformYedekAjan.findUnique({ where: { id: 1 } }),
    ]);
    return {
      ozet: {
        sonBasariliAt: sonBasarili?.bitisAt ?? null,
        sonBoyutBayt: sayi(sonBasarili?.boyutBayt ?? null),
        sonrakiOtomatikAt: sonrakiOtomatikYedek(simdi),
        aktif: Boolean(aktif),
        servis: ajan ? { sonNabizAt: ajan.sonNabizAt, canli: simdi.getTime() - ajan.sonNabizAt.getTime() <= YEDEK_ESIK.ajanDk * 60_000, surum: ajan.surum, diskToplamBayt: sayi(ajan.diskToplamBayt), diskBosBayt: sayi(ajan.diskBosBayt) } : null,
      },
      sayfa, sayfaBoyu: SAYFA_BOYU, toplam,
      satirlar: satirlar.map((y) => ({
        id: y.id, tur: y.tur, durum: y.durum, neden: y.neden, baslatan: y.baslatan?.adSoyad ?? null,
        talepAt: y.talepAt, baslangicAt: y.baslangicAt, bitisAt: y.bitisAt, boyutBayt: sayi(y.boyutBayt), hata: y.hata, korunuyor: y.korunuyor, silinecek: y.silinecek,
        denemeDurum: y.denemeDurum, denemeAt: y.denemeAt, denemeDetay: y.denemeDetay,
      })),
    };
  }

  /** PLT-112: elle yedek. Tüm firmaların verisini etkilediği için yeniden iki adımlı doğrulama ister. */
  async talepEt(neden: string, totpKodu: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    const db = this.platform.db;
    const anahtar = `platform-yedek:${kullaniciId}`;
    if (await this.denemeler.kilitliMi(anahtar, ["platform"])) throw new HttpException("Çok fazla hatalı kod. 15 dakika sonra tekrar deneyin.", HttpStatus.TOO_MANY_REQUESTS);
    const kullanici = await db.platformKullanici.findUnique({ where: { id: kullaniciId }, select: { totpSecretSifreli: true } });
    if (!kullanici?.totpSecretSifreli || !totpDogrula(coz(kullanici.totpSecretSifreli), totpKodu)) {
      await this.denemeler.hataKaydet("platform", anahtar);
      await db.mevzuatOlay.create({ data: { kullaniciId, olay: "yedek_dogrulama_hatali", detay: {} } });
      throw new UnauthorizedException("Doğrulama kodu hatalı");
    }
    await this.denemeler.temizle(anahtar, ["platform"]);
    try {
      return await db.$transaction(async (tx) => {
        const yedek = await tx.platformYedek.create({ data: { tur: "elle", neden, baslatanId: kullaniciId }, select: { id: true } });
        await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "yedek_talep_edildi", detay: { yedekId: yedek.id, neden } } });
        return { id: yedek.id, mesaj: "Yedek sıraya alındı." };
      });
    } catch (h) {
      if (cakisma(h)) throw new ConflictException("Çalışan ya da bekleyen bir yedek var; bitmesini bekleyin.");
      throw h;
    }
  }

  /** PLT-113: korunan yedek saklama süresinden etkilenmez. */
  async koru(id: string, korunuyor: boolean) {
    const { kullaniciId } = aktifPlatformBaglam();
    return this.platform.db.$transaction(async (tx) => {
      const { count } = await tx.platformYedek.updateMany({ where: { id, durum: "basarili" }, data: { korunuyor, ...(korunuyor ? { silinecek: false } : {}) } });
      if (count !== 1) throw new BadRequestException("Yalnız başarılı ve silinmemiş yedek korunabilir.");
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: korunuyor ? "yedek_korundu" : "yedek_koruma_kaldirildi", detay: { yedekId: id } } });
      return { mesaj: korunuyor ? "Yedek korumaya alındı." : "Koruma kaldırıldı." };
    });
  }

  /** PLT-116: istendiğinde geri yükleme denemesi. */
  async denemeIste(id: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    return this.platform.db.$transaction(async (tx) => {
      const { count } = await tx.platformYedek.updateMany({
        where: { id, durum: "basarili", silinecek: false, OR: [{ denemeDurum: null }, { denemeDurum: { notIn: ["bekliyor", "calisiyor"] } }] },
        data: { denemeDurum: "bekliyor", denemeTalepAt: new Date() },
      });
      if (count !== 1) throw new BadRequestException("Bu yedek için deneme başlatılamıyor; yedek silinmiş ya da deneme zaten sürüyor olabilir.");
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "yedek_denemesi_istendi", detay: { yedekId: id } } });
      return { mesaj: "Geri yükleme denemesi sıraya alındı." };
    });
  }
}
