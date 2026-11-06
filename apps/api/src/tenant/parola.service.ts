import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { z } from "zod";
import { parolaSemasi } from "../auth/parola-kurali";
import { aktifBaglam, baglamlaCalistir } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "./eposta.service";

/** KLN-12: sıfırlama bağlantısı bir saat geçerlidir. */
export const SIFIRLAMA_GECERLILIK_DK = 60;
/** Yönetim P2-3: davet bağlantısı bir hafta geçerlidir. */
export const DAVET_GECERLILIK_GUN = 7;
/** Aynı kullanıcıya bu süre içinde ikinci bağlantı gönderilmez (posta kutusu bombardımanı). */
const YENIDEN_ISTEK_ARALIGI_DK = 2;

export const SIFIRLAMA_ISTEK_YANITI =
  "Bu e-posta adresiyle kayıtlı etkin bir hesap varsa parola sıfırlama bağlantısı gönderildi. Gelen kutunuzu ve istenmeyen klasörünü kontrol edin.";

const yoneticiSifirlamaSemasi = z.object({ parola: parolaSemasi });
const degistirmeSemasi = z.object({ mevcutParola: z.string().min(1).max(200), yeniParola: parolaSemasi });
const istekSemasi = z.object({ eposta: z.email() });
const sifirlamaSemasi = z.object({ token: z.string().min(20).max(200), parola: parolaSemasi });

function tokenHashle(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues[0]?.message ?? "Geçersiz parola bilgisi");
  return sonuc.data;
}

/**
 * Parola yönetimi (KLN-10…13). Parola hangi yoldan değişirse değişsin
 * kullanıcının açık oturumları (yenileme token'ları) kapanır; elde kalan
 * erişim token'ı en çok 15 dakika daha geçerlidir.
 */
@Injectable()
export class ParolaService {
  private readonly logger = new Logger(ParolaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eposta: EpostaService,
    private readonly durum: KullaniciDurumService,
  ) {}

  /** KLN-10: yönetici başka bir kullanıcıya geçici parola verir. */
  async yoneticiSifirla(hedefId: string, govde: unknown): Promise<{ mesaj: string }> {
    const { parola } = ayristir(yoneticiSifirlamaSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    if (hedefId === userId) throw new BadRequestException("Kendi parolanızı Hesap Güvenliği ekranından değiştirin");
    const parolaHash = await argon2.hash(parola);
    const hedef = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanici = await tx.user.findUnique({ where: { id: hedefId }, select: { id: true, eposta: true, adSoyad: true } });
      if (!kullanici) throw new NotFoundException("Kullanıcı bulunamadı");
      await tx.user.update({ where: { id: hedefId }, data: { parolaHash } });
      await tx.auditLog.create({
        data: { tenantId, userId, islem: "kullanici_parolasi_sifirlandi", varlik: "user", varlikId: hedefId, detay: { eposta: kullanici.eposta } },
      });
      return kullanici;
    });
    await this.kimlikTemizle(tenantId, hedefId);
    return { mesaj: `${hedef.adSoyad} için yeni parola kaydedildi; açık oturumları kapatıldı.` };
  }

  /** Yönetim P1-1: telefonunu kaybeden kullanıcının 2FA'sı kapatılır; bir sonraki girişte yeniden kurabilir. */
  async yoneticiIkiAdimSifirla(hedefId: string): Promise<{ mesaj: string }> {
    const { tenantId, userId } = aktifBaglam();
    if (hedefId === userId) throw new BadRequestException("Kendi iki adımlı doğrulamanızı Hesap Güvenliği ekranından yönetin");
    const hedef = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanici = await tx.user.findUnique({ where: { id: hedefId }, select: { adSoyad: true, eposta: true, totpAktif: true } });
      if (!kullanici) throw new NotFoundException("Kullanıcı bulunamadı");
      if (!kullanici.totpAktif) throw new BadRequestException("Bu kullanıcıda iki adımlı doğrulama zaten kapalı");
      await tx.user.update({ where: { id: hedefId }, data: { totpAktif: false, totpSecretSifreli: null, totpKurtarmaOzetleri: [] } });
      await tx.auditLog.create({
        data: { tenantId, userId, islem: "kullanici_2fa_sifirlandi", varlik: "user", varlikId: hedefId, detay: { eposta: kullanici.eposta } },
      });
      return kullanici;
    });
    await this.kimlikTemizle(tenantId, hedefId);
    return { mesaj: `${hedef.adSoyad} için iki adımlı doğrulama kapatıldı; açık oturumları kapatıldı. Kullanıcı girişten sonra yeniden kurabilir.` };
  }

  /**
   * Yönetim P2-3: yöneticinin açtığı hesaba "parolanı belirle" bağlantısı.
   * Bağlantı kullanılana kadar hesap doğrulanmamış sayılır ve girilemez.
   * E-posta gitmezse hesap durur; yönetici daveti yeniden gönderebilir.
   */
  async davetGonder(hedefId: string): Promise<{ gonderildi: boolean; mesaj: string }> {
    const { tenantId, userId } = aktifBaglam();
    const { hedef, firma } = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanici = await tx.user.findUnique({ where: { id: hedefId }, select: { adSoyad: true, eposta: true, aktif: true, epostaDogrulandi: true } });
      if (!kullanici) throw new NotFoundException("Kullanıcı bulunamadı");
      if (!kullanici.aktif) throw new BadRequestException("Pasif kullanıcıya davet gönderilemez; önce aktif edin");
      if (kullanici.epostaDogrulandi) throw new BadRequestException("Kullanıcı daveti zaten kabul etmiş; gerekirse parolasını sıfırlayın");
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { unvan: true } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "kullanici_davet_edildi", varlik: "user", varlikId: hedefId, detay: { eposta: kullanici.eposta } } });
      return { hedef: kullanici, firma: t?.unvan ?? "Firmanız" };
    });
    // Önceki davet bağlantıları geçersizleşir; yalnız en sonuncusu çalışır.
    await this.prisma.parolaSifirlama.updateMany({ where: { userId: hedefId, kullanildi: false }, data: { kullanildi: true } });
    const token = randomBytes(32).toString("base64url");
    await this.prisma.parolaSifirlama.create({
      data: { tenantId, userId: hedefId, tokenHash: tokenHashle(token), gecerlilikSonu: new Date(Date.now() + DAVET_GECERLILIK_GUN * 24 * 60 * 60_000) },
    });
    const adres = `${process.env.APP_URL ?? "http://localhost:3100"}/parola-sifirla?token=${token}&davet=1`;
    try {
      await this.eposta.kullaniciDavetGonder(hedef.eposta, hedef.adSoyad, firma, adres, DAVET_GECERLILIK_GUN);
      return { gonderildi: true, mesaj: `${hedef.eposta} adresine davet gönderildi; bağlantı ${DAVET_GECERLILIK_GUN} gün geçerli.` };
    } catch (hata) {
      this.logger.warn(`Kullanıcı daveti gönderilemedi: ${String(hata)}`);
      return { gonderildi: false, mesaj: `Davet e-postası gönderilemedi (${hata instanceof Error ? hata.message : "e-posta hatası"}). E-posta ayarlarını kontrol edip daveti yeniden gönderin.` };
    }
  }

  /** Yönetim P2-4: yönetici kullanıcının bütün oturumlarını kapatır (kayıp cihaz, ayrılan çalışan). */
  async yoneticiOturumlariKapat(hedefId: string): Promise<{ mesaj: string }> {
    const { tenantId, userId } = aktifBaglam();
    if (hedefId === userId) throw new BadRequestException("Kendi oturumlarınızı Hesap Güvenliği ekranından kapatın");
    const hedef = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanici = await tx.user.findUnique({ where: { id: hedefId }, select: { adSoyad: true, eposta: true } });
      if (!kullanici) throw new NotFoundException("Kullanıcı bulunamadı");
      await tx.auditLog.create({ data: { tenantId, userId, islem: "kullanici_oturumlari_kapatildi", varlik: "user", varlikId: hedefId, detay: { eposta: kullanici.eposta } } });
      return kullanici;
    });
    await this.kimlikTemizle(tenantId, hedefId);
    return { mesaj: `${hedef.adSoyad} kullanıcısının bütün oturumları kapatıldı.` };
  }

  /** KLN-11: kullanıcı mevcut parolasıyla kendi parolasını değiştirir; bu oturum açık kalır. */
  async degistir(govde: unknown, refreshToken: string | undefined): Promise<{ mesaj: string }> {
    const { mevcutParola, yeniParola } = ayristir(degistirmeSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    const kullanici = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { parolaHash: true } }),
    );
    if (!kullanici) throw new NotFoundException("Kullanıcı bulunamadı");
    // 401 değil 400: istemci 401'de oturumu yenilemeye çalışır.
    if (!(await argon2.verify(kullanici.parolaHash, mevcutParola))) throw new BadRequestException("Mevcut parola hatalı");
    if (mevcutParola === yeniParola) throw new BadRequestException("Yeni parola mevcut paroladan farklı olmalıdır");
    const parolaHash = await argon2.hash(yeniParola);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { parolaHash } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "parola_degistirildi", varlik: "user", varlikId: userId } });
    });
    await this.kimlikTemizle(tenantId, userId, refreshToken ? tokenHashle(refreshToken) : undefined);
    return { mesaj: "Parolanız değiştirildi; diğer cihazlardaki oturumlarınız kapatıldı." };
  }

  /**
   * KLN-12: "Şifremi unuttum". Hesabın var olup olmadığı yanıttan anlaşılmaz;
   * bağlantı kiracının e-posta ayarıyla (yoksa sistem SMTP'siyle) gider.
   */
  async sifirlamaIste(govde: unknown): Promise<{ mesaj: string }> {
    const { eposta } = ayristir(istekSemasi, govde);
    const kimlik = await this.prisma.authKimlik.findFirst({ where: { eposta: { equals: eposta.trim(), mode: "insensitive" } } });
    if (!kimlik) return { mesaj: SIFIRLAMA_ISTEK_YANITI };
    const kullanici = await this.prisma.tenantIslem(kimlik.tenantId, (tx) =>
      tx.user.findUnique({ where: { id: kimlik.userId }, select: { aktif: true, adSoyad: true, eposta: true, rol: true } }),
    );
    if (!kullanici?.aktif) return { mesaj: SIFIRLAMA_ISTEK_YANITI };

    const simdi = Date.now();
    const yakin = await this.prisma.parolaSifirlama.findFirst({
      where: { userId: kimlik.userId, kullanildi: false, createdAt: { gt: new Date(simdi - YENIDEN_ISTEK_ARALIGI_DK * 60_000) } },
      select: { id: true },
    });
    if (yakin) return { mesaj: SIFIRLAMA_ISTEK_YANITI };

    const token = randomBytes(32).toString("base64url");
    await this.prisma.parolaSifirlama.create({
      data: {
        tenantId: kimlik.tenantId,
        userId: kimlik.userId,
        tokenHash: tokenHashle(token),
        gecerlilikSonu: new Date(simdi + SIFIRLAMA_GECERLILIK_DK * 60_000),
      },
    });
    const adres = `${process.env.APP_URL ?? "http://localhost:3100"}/parola-sifirla?token=${token}`;
    try {
      // Kiracı bağlamı: firmanın SMTP ayarı kullanılır ve gönderim geçmişine yazılır.
      await baglamlaCalistir({ tenantId: kimlik.tenantId, userId: kimlik.userId, rol: kullanici.rol }, () =>
        this.eposta.parolaSifirlamaGonder(kullanici.eposta, kullanici.adSoyad, adres, SIFIRLAMA_GECERLILIK_DK),
      );
    } catch (hata) {
      // Yanıt aynı kalır (hesap varlığı sızmaz); hata gönderim geçmişinde ve günlükte görünür.
      this.logger.warn(`Parola sıfırlama e-postası gönderilemedi: ${String(hata)}`);
    }
    return { mesaj: SIFIRLAMA_ISTEK_YANITI };
  }

  /** KLN-12: bağlantıdaki tek kullanımlık anahtarla yeni parola belirlenir. */
  async sifirla(govde: unknown): Promise<{ mesaj: string }> {
    const { token, parola } = ayristir(sifirlamaSemasi, govde);
    const gecersiz = new BadRequestException("Sıfırlama bağlantısı geçersiz veya süresi dolmuş; yeni bağlantı isteyin");
    const kayit = await this.prisma.parolaSifirlama.findUnique({ where: { tokenHash: tokenHashle(token) } });
    if (!kayit || kayit.kullanildi || kayit.gecerlilikSonu < new Date()) throw gecersiz;
    const parolaHash = await argon2.hash(parola);
    // Aynı bağlantı iki kez gönderilirse yalnız ilki geçer.
    const { count } = await this.prisma.parolaSifirlama.updateMany({ where: { id: kayit.id, kullanildi: false }, data: { kullanildi: true } });
    if (count !== 1) throw gecersiz;
    await this.prisma.tenantIslem(kayit.tenantId, async (tx) => {
      const kullanici = await tx.user.findUnique({ where: { id: kayit.userId }, select: { aktif: true } });
      if (!kullanici?.aktif) throw gecersiz;
      // Bağlantı posta kutusuna ulaştığı için adres de doğrulanmış olur.
      await tx.user.update({ where: { id: kayit.userId }, data: { parolaHash, epostaDogrulandi: true } });
      await tx.auditLog.create({
        data: { tenantId: kayit.tenantId, userId: kayit.userId, islem: "parola_baglantiyla_sifirlandi", varlik: "user", varlikId: kayit.userId },
      });
    });
    await this.kimlikTemizle(kayit.tenantId, kayit.userId);
    return { mesaj: "Parolanız güncellendi; yeni parolanızla giriş yapabilirsiniz." };
  }

  /**
   * KLN-13: oturumları (biri hariç tutulabilir) ve kullanılmamış sıfırlama
   * bağlantılarını kapatır; oturum sürümü artar, eldeki erişim token'ları da
   * düşer (yönetim P1-2). Korunan oturum yeni token'ını yenilemeyle alır.
   */
  private async kimlikTemizle(tenantId: string, userId: string, korunanRefreshHash?: string): Promise<void> {
    await this.prisma.tenantIslem(tenantId, (tx) => tx.user.update({ where: { id: userId }, data: { oturumSurumu: { increment: 1 } } }));
    this.durum.unut(userId);
    await this.prisma.oturum.deleteMany({
      where: { userId, ...(korunanRefreshHash ? { NOT: { refreshTokenHash: korunanRefreshHash } } : {}) },
    });
    await this.prisma.parolaSifirlama.updateMany({ where: { userId, kullanildi: false }, data: { kullanildi: true } });
  }
}
