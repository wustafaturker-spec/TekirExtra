import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PlatformRol, Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import * as bwipjs from "bwip-js";
import { createHash, randomBytes } from "node:crypto";
import { createTransport } from "nodemailer";
import { generateSecret, generateURI, verifySync } from "otplib";
import { parolaSemasi } from "../auth/parola-kurali";
import { coz, sifrele } from "../core/kripto";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformPrismaService } from "./platform-prisma.service";

export type DavetTuru = "hesap" | "iki_adim";
export const PLATFORM_DAVET_GECERLILIK_SAAT = 72;

const ozetle = (anahtar: string) => createHash("sha256").update(anahtar).digest("hex");
const ROL_ADI: Record<PlatformRol, string> = { yonetici: "platform yöneticisi", mevzuat_editoru: "mevzuat editörü" };

const SECIM = {
  id: true, eposta: true, adSoyad: true, rol: true, aktif: true, sonGiris: true, createdAt: true, davetTuru: true, davetSonGecerlilik: true,
} as const;

/**
 * PLT-07: platform kullanıcılarını platform yöneticisi yönetir. Yeni kullanıcı
 * davet bağlantısıyla parolasını belirler ve 2FA'yı kurar; 2FA sıfırlanınca
 * aynı yolla yeniden kurar. Bağlantı kullanılana kadar hesap giriş yapamaz.
 * En az bir aktif (kurulumu bitmiş) platform yöneticisi kalır; kimse kendi
 * rolünü ya da durumunu değiştiremez. Her işlem platform olay kaydına yazılır.
 */
@Injectable()
export class PlatformKullanicilarService {
  private readonly logger = new Logger(PlatformKullanicilarService.name);

  constructor(private readonly platform: PlatformPrismaService) {}

  listele() {
    return this.platform.db.platformKullanici.findMany({ select: SECIM, orderBy: { createdAt: "asc" } });
  }

  async olustur(girdi: { eposta: string; adSoyad: string; rol: PlatformRol }) {
    const { kullaniciId } = aktifPlatformBaglam();
    const eposta = girdi.eposta.trim().toLowerCase();
    if (await this.platform.db.platformKullanici.findUnique({ where: { eposta }, select: { id: true } })) {
      throw new ConflictException("Bu e-postayla bir platform kullanıcısı zaten var");
    }
    const anahtar = randomBytes(32).toString("base64url");
    // Davet kullanılana kadar girilemeyen rastgele parola ve 2FA anahtarı durur.
    const k = await this.platform.db.platformKullanici.create({
      data: {
        eposta, adSoyad: girdi.adSoyad.trim(), rol: girdi.rol,
        parolaHash: await argon2.hash(randomBytes(32).toString("base64url")),
        totpSecretSifreli: sifrele(generateSecret()),
        ...this.davetAlanlari("hesap", anahtar),
      },
      select: SECIM,
    });
    await this.olay(kullaniciId, "platform_kullanicisi_acildi", { eposta, rol: girdi.rol });
    return { kullanici: k, davet: await this.davetGonder(k, "hesap", anahtar) };
  }

  /** Kurulumu bekleyen kullanıcıya yeni bağlantı; öncekisi geçersizleşir. */
  async davetYenile(id: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    const k = await this.bul(id);
    if (!k.davetTuru) throw new BadRequestException("Bu kullanıcının bekleyen kurulumu yok");
    if (!k.aktif) throw new BadRequestException("Pasif kullanıcıya davet gönderilemez; önce aktif edin");
    const anahtar = randomBytes(32).toString("base64url");
    await this.platform.db.platformKullanici.update({ where: { id }, data: this.davetAlanlari(k.davetTuru as DavetTuru, anahtar) });
    await this.olay(kullaniciId, "platform_daveti_yenilendi", { eposta: k.eposta, tur: k.davetTuru });
    return this.davetGonder(k, k.davetTuru as DavetTuru, anahtar);
  }

  async guncelle(id: string, girdi: { rol?: PlatformRol; aktif?: boolean }) {
    const { kullaniciId } = aktifPlatformBaglam();
    if (id === kullaniciId && girdi.rol !== undefined) throw new BadRequestException("Kendi rolünüzü değiştiremezsiniz; başka bir platform yöneticisi değiştirebilir");
    if (id === kullaniciId && girdi.aktif === false) throw new BadRequestException("Kendi hesabınızı pasife alamazsınız");
    return this.platform.db.$transaction(async (tx) => {
      // "En az bir yönetici" kuralı eşzamanlı iki değişiklikte de tutsun.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki', 0))::text`;
      const mevcut = await tx.platformKullanici.findUnique({ where: { id }, select: SECIM });
      if (!mevcut) throw new NotFoundException("Platform kullanıcısı bulunamadı");
      const yeniRol = girdi.rol ?? mevcut.rol;
      const yeniAktif = girdi.aktif ?? mevcut.aktif;
      if (mevcut.rol === "yonetici" && mevcut.aktif && (yeniRol !== "yonetici" || !yeniAktif)) {
        const digerleri = await tx.platformKullanici.count({ where: { rol: "yonetici", aktif: true, davetTuru: null, id: { not: id } } });
        if (!digerleri) throw new BadRequestException("En az bir aktif platform yöneticisi kalmalıdır; önce başka bir kullanıcıyı yönetici yapın");
      }
      const guncel = await tx.platformKullanici.update({ where: { id }, data: { rol: yeniRol, aktif: yeniAktif }, select: SECIM });
      if (mevcut.rol !== guncel.rol) {
        await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "platform_rolu_degisti", detay: { eposta: mevcut.eposta, eski: mevcut.rol, yeni: guncel.rol } } });
      }
      if (mevcut.aktif !== guncel.aktif) {
        await tx.mevzuatOlay.create({ data: { kullaniciId, olay: guncel.aktif ? "platform_kullanicisi_aktif_edildi" : "platform_kullanicisi_pasife_alindi", detay: { eposta: mevcut.eposta } } });
      }
      return guncel;
    });
  }

  /** Telefon kaybı: 2FA geçersizleşir, kullanıcı bağlantıyla (mevcut parolasıyla) yeniden kurana kadar giremez. */
  async ikiAdimSifirla(id: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    if (id === kullaniciId) throw new BadRequestException("Kendi 2FA'nızı sıfırlayamazsınız; başka bir platform yöneticisi sıfırlayabilir");
    const k = await this.bul(id);
    if (k.davetTuru === "hesap") throw new BadRequestException("Kullanıcı daveti henüz kabul etmedi; daveti yeniden gönderin");
    const anahtar = randomBytes(32).toString("base64url");
    await this.platform.db.platformKullanici.update({ where: { id }, data: { totpSecretSifreli: sifrele(generateSecret()), ...this.davetAlanlari("iki_adim", anahtar) } });
    await this.olay(kullaniciId, "platform_2fa_sifirlandi", { eposta: k.eposta });
    return this.davetGonder(k, "iki_adim", anahtar);
  }

  /**
   * Davet sayfası açılınca: yeni bir 2FA anahtarı üretilir (sayfa yeniden açılırsa
   * önceki geçersizleşir) ve karekodla döner. Oturum gerektirmez.
   */
  async davetBilgisi(anahtar: string) {
    const k = await this.davetliBul(anahtar);
    const secret = generateSecret();
    await this.platform.db.platformKullanici.update({ where: { id: k.id }, data: { totpSecretSifreli: sifrele(secret) } });
    const otpauthUrl = generateURI({ secret, issuer: "TekirExtra Platform", label: k.eposta });
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: otpauthUrl });
    return {
      eposta: k.eposta, adSoyad: k.adSoyad, rol: k.rol, tur: k.davetTuru as DavetTuru,
      secret, otpauthUrl, karekod: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
    };
  }

  /** "hesap": yeni parola belirlenir; "iki_adim": mevcut parola doğrulanır. İkisinde de ilk 2FA kodu zorunlu. */
  async davetTamamla(anahtar: string, girdi: { parola: string; kod: string }) {
    const k = await this.davetliBul(anahtar);
    const tur = k.davetTuru as DavetTuru;
    if (tur === "hesap") {
      const kural = parolaSemasi.safeParse(girdi.parola);
      if (!kural.success) throw new BadRequestException(kural.error.issues.map((i) => i.message).join("; "));
    }
    if (!verifySync({ secret: coz(k.totpSecretSifreli), token: girdi.kod }).valid) {
      throw new BadRequestException("Doğrulama kodu geçersiz; uygulamadaki güncel kodu girin");
    }
    let parolaHash = k.parolaHash;
    if (tur === "iki_adim") {
      if (!(await argon2.verify(k.parolaHash, girdi.parola))) throw new BadRequestException("Parola hatalı");
    } else {
      parolaHash = await argon2.hash(girdi.parola);
    }
    const { count } = await this.platform.db.platformKullanici.updateMany({
      where: { id: k.id, davetAnahtarOzeti: k.davetAnahtarOzeti },
      data: { parolaHash, davetTuru: null, davetAnahtarOzeti: null, davetSonGecerlilik: null },
    });
    if (!count) throw new BadRequestException("Bağlantı geçersiz veya süresi dolmuş");
    await this.olay(k.id, tur === "iki_adim" ? "platform_2fa_yeniden_kuruldu" : "platform_daveti_kabul_edildi", { eposta: k.eposta });
    return { eposta: k.eposta };
  }

  private davetAlanlari(tur: DavetTuru, anahtar: string) {
    return { davetTuru: tur, davetAnahtarOzeti: ozetle(anahtar), davetSonGecerlilik: new Date(Date.now() + PLATFORM_DAVET_GECERLILIK_SAAT * 3_600_000) };
  }

  private async davetliBul(anahtar: string) {
    const k = anahtar ? await this.platform.db.platformKullanici.findUnique({ where: { davetAnahtarOzeti: ozetle(anahtar) } }) : null;
    if (!k || !k.aktif || !k.davetTuru || !k.davetSonGecerlilik || k.davetSonGecerlilik < new Date()) {
      throw new BadRequestException("Bağlantı geçersiz veya süresi dolmuş; platform yöneticisinden yeni bağlantı isteyin");
    }
    return k;
  }

  private async bul(id: string) {
    const k = await this.platform.db.platformKullanici.findUnique({ where: { id }, select: SECIM });
    if (!k) throw new NotFoundException("Platform kullanıcısı bulunamadı");
    return k;
  }

  private olay(kullaniciId: string, olay: string, detay: Prisma.InputJsonValue) {
    return this.platform.db.mevzuatOlay.create({ data: { kullaniciId, olay, detay } });
  }

  /**
   * Sistem SMTP'siyle (firmanın ayarıyla değil). Gönderilemezse bağlantı
   * yöneticiye döner; kendisi güvenli bir yoldan iletir.
   */
  private async davetGonder(k: { eposta: string; adSoyad: string; rol: PlatformRol }, tur: DavetTuru, anahtar: string): Promise<{ gonderildi: boolean; mesaj: string; baglanti?: string }> {
    const baglanti = `${process.env.APP_URL ?? "http://localhost:3100"}/platform/davet?anahtar=${anahtar}`;
    const hesap = tur === "hesap";
    const konu = hesap ? "TekirExtra platform paneli daveti" : "TekirExtra platform paneli — iki adımlı doğrulamayı yeniden kurun";
    const giris = hesap
      ? `Sizin için TekirExtra platform panelinde ${ROL_ADI[k.rol]} hesabı açıldı. Parolanızı belirleyip iki adımlı doğrulamayı kurmak için:`
      : "Platform hesabınızın iki adımlı doğrulaması sıfırlandı. Mevcut parolanızla yeniden kurmak için:";
    try {
      const transport = createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false });
      await transport.sendMail({
        from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>",
        to: k.eposta,
        subject: konu,
        text: `Merhaba ${k.adSoyad},\n\n${giris}\n${baglanti}\n\nBağlantı ${PLATFORM_DAVET_GECERLILIK_SAAT} saat geçerlidir ve bir kez kullanılabilir.`,
        html: `<p>Merhaba ${k.adSoyad},</p><p>${giris}</p><p><a href="${baglanti}">Kurulumu başlat</a></p><p>Bağlantı ${PLATFORM_DAVET_GECERLILIK_SAAT} saat geçerlidir ve bir kez kullanılabilir.</p>`,
      });
      return { gonderildi: true, mesaj: `${k.eposta} adresine bağlantı gönderildi; ${PLATFORM_DAVET_GECERLILIK_SAAT} saat geçerli.` };
    } catch (hata) {
      this.logger.warn(`Platform daveti gönderilemedi: ${String(hata)}`);
      return { gonderildi: false, mesaj: "E-posta gönderilemedi; aşağıdaki bağlantıyı kullanıcıya güvenli bir yoldan iletin.", baglanti };
    }
  }
}
