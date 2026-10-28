import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import * as bwipjs from "bwip-js";
import { generateSecret, generateURI, verifySync } from "otplib";
import { coz, sifrele } from "../core/kripto";
import { GirisDenemeSayaci } from "./giris-deneme-sayaci";
import { kurtarmaKodlariUret, kurtarmaKoduBicimindeMi, kurtarmaKoduOzeti } from "./kurtarma-kodlari";
import { aktifBaglam } from "../core/istek-baglami";
import { ikiAdimEksikMi, type GuvenlikPolitikasi } from "../core/guvenlik-politikasi";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";
import type { JwtYuku } from "./auth.guard";

const GUN_MS = 24 * 60 * 60 * 1000;
/** KLN-22: hareketsizlik denetiminde istemci saatine ve ağ gecikmesine pay. */
const HAREKETSIZLIK_PAYI_MS = 60_000;

export interface GirisSonucu {
  accessToken: string;
  refreshToken: string;
  /** KLN-22: yenileme çerezi en geç bu anda düşer. */
  gecerlilikSonu: Date;
  kullanici: { id: string; adSoyad: string; eposta: string; rol: string; ikiAdimKurulumuGerekli: boolean };
}

/** Yönetim P2-4: oturum listesinde gösterilen istemci bilgisi. */
export interface Istemci {
  ip?: string | null;
  tarayici?: string | null;
}

export interface OturumGorunumu {
  id: string;
  girisAt: Date;
  sonYenilemeAt: Date;
  ip: string | null;
  tarayici: string | null;
  buOturum: boolean;
}

function tokenHashle(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly denemeler: GirisDenemeSayaci,
    private readonly durum: KullaniciDurumService,
  ) {}

  async giris(eposta: string, parola: string, totpKodu?: string, istemci: Istemci = {}): Promise<GirisSonucu> {
    // Yönetim P1-3: kilit, parola doğrulanmadan (argon2 maliyeti harcanmadan) uygulanır.
    if (await this.denemeler.kilitliMi(eposta)) {
      throw new HttpException(
        "Bu hesap için çok fazla başarısız deneme yapıldı. 15 dakika sonra tekrar deneyin ya da parolanızı sıfırlayın.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Rehber RLS'siz: oturum açarken kiracı bağlamı henüz yok (MIMARI §7)
    const kimlik = await this.prisma.authKimlik.findUnique({ where: { eposta } });
    // Kullanıcı yok/parola yanlış ayrımı sızdırılmaz — tek mesaj; sayaç her durumda işler
    const hataliGiris = async () => {
      if ((await this.denemeler.hataKaydet("parola", eposta)) && kimlik) await this.kilitKaydet(kimlik.tenantId, kimlik.userId, "parola");
      return new UnauthorizedException("E-posta veya parola hatalı");
    };
    if (!kimlik) throw await hataliGiris();

    const kullanici = await this.prisma.tenantIslem(kimlik.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: kimlik.userId } }),
    );
    if (!kullanici || !kullanici.aktif) throw await hataliGiris();
    if (!(await argon2.verify(kullanici.parolaHash, parola))) throw await hataliGiris();

    if (!kullanici.epostaDogrulandi) {
      throw new UnauthorizedException(
        "E-posta adresiniz doğrulanmamış; gelen kutunuzdaki doğrulama linkine tıklayın",
      );
    }

    if (kullanici.totpAktif) {
      if (!totpKodu) {
        throw new UnauthorizedException("TOTP kodu gerekli");
      }
      const secret = coz(kullanici.totpSecretSifreli as string);
      const totpGecerli = !kurtarmaKoduBicimindeMi(totpKodu) && verifySync({ secret, token: totpKodu }).valid;
      // Yönetim P1-1: telefonu olmayan kullanıcı tek kullanımlık kurtarma koduyla girer.
      if (!totpGecerli && !(await this.kurtarmaKoduKullan(kullanici.tenantId, kullanici.id, totpKodu))) {
        if (await this.denemeler.hataKaydet("totp", eposta)) await this.kilitKaydet(kullanici.tenantId, kullanici.id, "totp");
        throw new UnauthorizedException("TOTP kodu geçersiz");
      }
    }

    await this.denemeler.temizle(eposta);
    // Yönetim P2-4: son giriş ve giriş kaydı (denetim izi).
    await this.prisma.tenantIslem(kullanici.tenantId, async (tx) => {
      await tx.user.update({ where: { id: kullanici.id }, data: { sonGirisAt: new Date() } });
      await tx.auditLog.create({
        data: { tenantId: kullanici.tenantId, userId: kullanici.id, islem: "giris_yapildi", varlik: "user", varlikId: kullanici.id, detay: { ip: istemci.ip ?? null, tarayici: istemci.tarayici ?? null } },
      });
    });

    const politika = await this.politikaGetir(kullanici.tenantId);
    return this.oturumAc(kullanici.tenantId, kullanici.id, kullanici.rol, kullanici.oturumSurumu, {
      adSoyad: kullanici.adSoyad,
      eposta: kullanici.eposta,
      ikiAdimKurulumuGerekli: ikiAdimEksikMi(politika, kullanici.rol, kullanici.totpAktif, kullanici.ozelRolId),
    }, istemci, new Date(), politika);
  }

  /** KLN-20: menüde gösterilen özel rol adı. */
  async ozelRolAdi(tenantId: string, id: string): Promise<string | null> {
    const r = await this.prisma.tenantIslem(tenantId, (tx) => tx.ozelRol.findUnique({ where: { id }, select: { ad: true } }));
    return r?.ad ?? null;
  }

  /** KLN-21/22: firmanın oturum ve 2FA politikası (kayıt yoksa varsayılanlar). */
  async politikaGetir(tenantId: string): Promise<GuvenlikPolitikasi> {
    const t = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { ikiAdimZorunluRoller: true, oturumSuresiGun: true, hareketsizlikDk: true } }),
    );
    return t ?? { ikiAdimZorunluRoller: [], oturumSuresiGun: 30, hareketsizlikDk: null };
  }

  /** Kilit başladığında yöneticinin Denetim İzi'nde görmesi için. */
  private async kilitKaydet(tenantId: string, userId: string, tur: "parola" | "totp"): Promise<void> {
    await this.prisma
      .tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId, islem: "giris_kilitlendi", varlik: "user", varlikId: userId, detay: { tur } } }))
      .catch(() => undefined);
  }

  async yenile(refreshToken: string, istemci: Istemci = {}): Promise<GirisSonucu> {
    const oturum = await this.prisma.oturum.findUnique({
      where: { refreshTokenHash: tokenHashle(refreshToken) },
    });
    if (!oturum || oturum.gecerlilikSonu < new Date()) {
      throw new UnauthorizedException("Oturum geçersiz; yeniden giriş yapın");
    }
    const kullanici = await this.prisma.tenantIslem(oturum.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: oturum.userId } }),
    );
    if (!kullanici || !kullanici.aktif) {
      throw new UnauthorizedException("Oturum geçersiz; yeniden giriş yapın");
    }
    // KLN-22: politika mevcut oturuma bu yenilemede uygulanır. Satır her yenilemede
    // yeniden yazıldığı için createdAt son yenileme anıdır.
    const politika = await this.politikaGetir(oturum.tenantId);
    const simdi = Date.now();
    const sureDoldu = oturum.girisAt.getTime() + politika.oturumSuresiGun * GUN_MS < simdi;
    const hareketsiz = politika.hareketsizlikDk !== null && oturum.createdAt.getTime() + politika.hareketsizlikDk * 60_000 + HAREKETSIZLIK_PAYI_MS < simdi;
    if (sureDoldu || hareketsiz) {
      await this.prisma.oturum.delete({ where: { id: oturum.id } }).catch(() => undefined);
      throw new UnauthorizedException(hareketsiz ? "Uzun süre işlem yapılmadığı için oturum kapandı; yeniden giriş yapın" : "Oturum süresi doldu; yeniden giriş yapın");
    }
    // Rotasyon: eski refresh token tek kullanımlıktır
    await this.prisma.oturum.delete({ where: { id: oturum.id } });
    return this.oturumAc(kullanici.tenantId, kullanici.id, kullanici.rol, kullanici.oturumSurumu, {
      adSoyad: kullanici.adSoyad,
      eposta: kullanici.eposta,
      ikiAdimKurulumuGerekli: ikiAdimEksikMi(politika, kullanici.rol, kullanici.totpAktif, kullanici.ozelRolId),
    }, istemci, oturum.girisAt, politika);
  }

  /** Yönetim P2-4: kullanıcının açık oturumları (süresi geçenler hariç), bu oturum işaretli. */
  async oturumlarim(refreshToken: string | undefined): Promise<OturumGorunumu[]> {
    const { userId } = aktifBaglam();
    const buHash = refreshToken ? tokenHashle(refreshToken) : null;
    const kayitlar = await this.prisma.oturum.findMany({ where: { userId, gecerlilikSonu: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    return kayitlar.map((o) => ({ id: o.id, girisAt: o.girisAt, sonYenilemeAt: o.createdAt, ip: o.ip, tarayici: o.tarayici, buOturum: o.refreshTokenHash === buHash }));
  }

  /** Tek oturumu (yalnız kendi oturumu) kapatır. Elde kalan erişim token'ı en çok 15 dk yaşar. */
  async oturumKapat(id: string): Promise<void> {
    const { userId } = aktifBaglam();
    const { count } = await this.prisma.oturum.deleteMany({ where: { id, userId } });
    if (!count) throw new BadRequestException("Oturum bulunamadı");
  }

  /** Bu oturum dışındakileri kapatır; sürüm artar, diğer cihazların erişim token'ı da hemen düşer. */
  async digerOturumlariKapat(refreshToken: string | undefined): Promise<{ kapatilan: number }> {
    const { tenantId, userId } = aktifBaglam();
    const buHash = refreshToken ? tokenHashle(refreshToken) : undefined;
    const { count } = await this.prisma.oturum.deleteMany({ where: { userId, ...(buHash ? { NOT: { refreshTokenHash: buHash } } : {}) } });
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { oturumSurumu: { increment: 1 } } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "diger_oturumlar_kapatildi", varlik: "user", varlikId: userId, detay: { kapatilan: count } } });
    });
    this.durum.unut(userId);
    return { kapatilan: count };
  }

  async cikis(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.oturum.deleteMany({
      where: { refreshTokenHash: tokenHashle(refreshToken) },
    });
  }

  async epostaDogrula(token: string): Promise<void> {
    const kayit = await this.prisma.epostaDogrulama.findUnique({
      where: { tokenHash: tokenHashle(token) },
    });
    if (!kayit || kayit.kullanildi || kayit.gecerlilikSonu < new Date()) {
      throw new BadRequestException("Doğrulama linki geçersiz veya süresi dolmuş");
    }
    await this.prisma.epostaDogrulama.update({
      where: { id: kayit.id },
      data: { kullanildi: true },
    });
    await this.prisma.tenantIslem(kayit.tenantId, (tx) =>
      tx.user.update({
        where: { id: kayit.userId },
        data: { epostaDogrulandi: true },
      }),
    );
  }

  /** TOTP kurulumu: şifreli secret kaydedilir, otpauth URL ve karekodu döner (KLN-05, KLN-23). */
  async totpKur(): Promise<{ otpauthUrl: string; secret: string; karekod: string }> {
    const { tenantId, userId } = aktifBaglam();
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (!kullanici) throw new UnauthorizedException();
    if (kullanici.totpAktif) {
      throw new BadRequestException("TOTP zaten etkin");
    }
    const secret = generateSecret();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.update({
        where: { id: userId },
        data: { totpSecretSifreli: sifrele(secret), totpAktif: false },
      }),
    );
    const otpauthUrl = generateURI({
      secret,
      issuer: "TekirExtra",
      label: kullanici.eposta,
    });
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: otpauthUrl });
    return { otpauthUrl, secret, karekod: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}` };
  }

  /** Kurulumdaki secret ile üretilen ilk kod doğrulanınca TOTP etkinleşir; kurtarma kodları bir kez döner. */
  async totpEtkinlestir(kod: string): Promise<{ kurtarmaKodlari: string[] }> {
    const { tenantId, userId } = aktifBaglam();
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (!kullanici?.totpSecretSifreli) {
      throw new BadRequestException("Önce TOTP kurulumu başlatın");
    }
    if (!verifySync({ secret: coz(kullanici.totpSecretSifreli), token: kod }).valid) {
      throw new BadRequestException("TOTP kodu geçersiz");
    }
    const { kodlar, ozetler } = kurtarmaKodlariUret();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { totpAktif: true, totpKurtarmaOzetleri: ozetler } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "iki_adimli_dogrulama_acildi", varlik: "user", varlikId: userId } });
    });
    // KLN-21: zorunlu 2FA'yı kuran kullanıcı beklemeden diğer ekranlara geçer.
    this.durum.unut(userId);
    return { kurtarmaKodlari: kodlar };
  }

  /** Hesap Güvenliği ekranı: 2FA açık mı, kaç kurtarma kodu kaldı. */
  async totpDurum(): Promise<{ aktif: boolean; kalanKurtarmaKodu: number }> {
    const { tenantId, userId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { totpAktif: true, totpKurtarmaOzetleri: true } }),
    );
    return { aktif: Boolean(k?.totpAktif), kalanKurtarmaKodu: k?.totpAktif ? k.totpKurtarmaOzetleri.length : 0 };
  }

  /** Kullanıcı geçerli bir 2FA kodu (ya da kurtarma kodu) ile kendi 2FA'sını kapatır. */
  async totpKapat(kod: string): Promise<void> {
    const { tenantId, userId, rol, ozelRol } = aktifBaglam();
    // KLN-21: zorunlu roldeki kullanıcı 2FA'sını kapatamaz (telefon kaybında yönetici sıfırlar).
    if (ikiAdimEksikMi(await this.politikaGetir(tenantId), rol, false, ozelRol?.id)) {
      throw new BadRequestException("Firmanız rolünüz için iki adımlı doğrulamayı zorunlu tuttuğundan kapatılamaz; telefonunuzu kaybettiyseniz yöneticiniz sıfırlayabilir");
    }
    await this.totpKoduDogrula(tenantId, userId, kod, true);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { totpAktif: false, totpSecretSifreli: null, totpKurtarmaOzetleri: [] } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "iki_adimli_dogrulama_kapatildi", varlik: "user", varlikId: userId } });
    });
    this.durum.unut(userId);
  }

  /** Eski kurtarma kodlarını geçersiz kılıp yenilerini verir; yalnız uygulamadaki kodla. */
  async kurtarmaKodlariniYenile(kod: string): Promise<{ kurtarmaKodlari: string[] }> {
    const { tenantId, userId } = aktifBaglam();
    await this.totpKoduDogrula(tenantId, userId, kod, false);
    const { kodlar, ozetler } = kurtarmaKodlariUret();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { totpKurtarmaOzetleri: ozetler } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "kurtarma_kodlari_yenilendi", varlik: "user", varlikId: userId } });
    });
    return { kurtarmaKodlari: kodlar };
  }

  private async totpKoduDogrula(tenantId: string, userId: string, kod: string, kurtarmaKoduOlur: boolean): Promise<void> {
    const k = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { totpAktif: true, totpSecretSifreli: true } }),
    );
    if (!k?.totpAktif || !k.totpSecretSifreli) throw new BadRequestException("İki adımlı doğrulama etkin değil");
    if (!kurtarmaKoduBicimindeMi(kod) && verifySync({ secret: coz(k.totpSecretSifreli), token: kod }).valid) return;
    if (kurtarmaKoduOlur && (await this.kurtarmaKoduKullan(tenantId, userId, kod))) return;
    // 401 değil 400: istemci 401'de oturumu yenilemeye çalışır.
    throw new BadRequestException("Doğrulama kodu geçersiz");
  }

  /** Kodu diziden atomik olarak düşürür; aynı kod iki kez geçmez. */
  private async kurtarmaKoduKullan(tenantId: string, userId: string, kod: string): Promise<boolean> {
    if (!kurtarmaKoduBicimindeMi(kod)) return false;
    const ozet = kurtarmaKoduOzeti(kod);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const satir = await tx.$queryRaw<{ kalan: number }[]>`
        UPDATE users SET totp_kurtarma_ozetleri = array_remove(totp_kurtarma_ozetleri, ${ozet})
        WHERE id = ${userId}::uuid AND ${ozet} = ANY(totp_kurtarma_ozetleri)
        RETURNING cardinality(totp_kurtarma_ozetleri) AS kalan`;
      if (!satir.length) return false;
      await tx.auditLog.create({
        data: { tenantId, userId, islem: "kurtarma_kodu_kullanildi", varlik: "user", varlikId: userId, detay: { kalan: Number(satir[0].kalan) } },
      });
      return true;
    });
  }

  /** Para çıkışı gibi kritik işlemlerde oturumdan bağımsız yeniden TOTP doğrulaması. */
  async kritikIslemTotpDogrula(kod: string): Promise<void> {
    const { tenantId, userId } = aktifBaglam();
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { totpAktif: true, totpSecretSifreli: true } }),
    );
    if (!kullanici?.totpAktif || !kullanici.totpSecretSifreli) {
      throw new BadRequestException("Ödeme talimatı onayı için TOTP etkin olmalıdır");
    }
    if (!verifySync({ secret: coz(kullanici.totpSecretSifreli), token: kod }).valid) {
      throw new UnauthorizedException("TOTP kodu geçersiz");
    }
  }

  private async oturumAc(
    tenantId: string,
    userId: string,
    rol: string,
    oturumSurumu: number,
    profil: { adSoyad: string; eposta: string; ikiAdimKurulumuGerekli: boolean },
    istemci: Istemci,
    girisAt: Date,
    politika: GuvenlikPolitikasi,
  ): Promise<GirisSonucu> {
    const yuk: JwtYuku = { sub: userId, tenantId, rol: rol as JwtYuku["rol"], sv: oturumSurumu };
    const accessToken = await this.jwt.signAsync(yuk);
    const refreshToken = randomBytes(48).toString("base64url");
    // KLN-22: açık kalma süresi girişten sayılır; yenileme onu uzatmaz.
    const gecerlilikSonu = new Date(girisAt.getTime() + politika.oturumSuresiGun * GUN_MS);
    await this.prisma.oturum.create({
      data: {
        tenantId, userId, refreshTokenHash: tokenHashle(refreshToken), gecerlilikSonu, girisAt,
        ip: istemci.ip?.slice(0, 64) ?? null, tarayici: istemci.tarayici?.slice(0, 200) ?? null,
      },
    });
    return {
      accessToken,
      refreshToken,
      gecerlilikSonu,
      kullanici: { id: userId, ...profil, rol },
    };
  }
}
