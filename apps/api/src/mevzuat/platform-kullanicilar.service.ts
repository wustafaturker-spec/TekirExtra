import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { totpDogrula } from "../auth/totp-dogrula";
import type { PlatformRol, Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import * as bwipjs from "bwip-js";
import { createHash, randomBytes } from "node:crypto";
import { createTransport } from "nodemailer";
import { generateSecret, generateURI } from "otplib";
import { parolaSemasi } from "../auth/parola-kurali";
import { coz, sifrele } from "../core/kripto";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { PlatformOturumDurumService } from "./platform-oturum-durum.service";
import { PlatformPrismaService } from "./platform-prisma.service";

export type DavetTuru = "hesap" | "iki_adim";
export const PLATFORM_DAVET_GECERLILIK_SAAT = 72;

const ozetle = (anahtar: string) => createHash("sha256").update(anahtar).digest("hex");
/** PLT-30: davet e-postasına yazılan kullanıcı girdileri HTML olarak yorumlanmaz. */
const html = (metin: string) => metin.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ROL_ADI: Record<PlatformRol, string> = { yonetici: "platform yöneticisi", mevzuat_editoru: "mevzuat editörü" };

/** PLT-31: yalnız yöneticiye atanabilen, henüz kapanmamış platform görevleri. */
const ACIK_PLATFORM_GOREVI = { kapsam: "platform", durum: { in: ["acik", "devam_ediyor"] } } satisfies Prisma.PlatformGorevWhereInput;

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

  private readonly denemeler: GirisDenemeSayaci;

  constructor(
    private readonly platform: PlatformPrismaService,
    @Optional() private readonly oturumDurum?: PlatformOturumDurumService,
    @Optional() denemeler?: GirisDenemeSayaci,
  ) {
    this.denemeler = denemeler ?? GirisDenemeSayaci.bellekte();
  }

  /** PLT-25: sürüm artar ve açık oturumlar iptal edilir; eldeki token'lar 2FA yeniden kurulsa da tekrar geçmez. */
  private async oturumlariDusur(tx: Prisma.TransactionClient, id: string, neden: string) {
    await tx.platformKullanici.update({ where: { id }, data: { oturumSurumu: { increment: 1 } } });
    await tx.platformOturum.updateMany({ where: { kullaniciId: id, iptalAt: null }, data: { iptalAt: new Date(), iptalNedeni: neden } });
  }

  /** PLT-31: her kullanıcının üzerindeki açık platform görevi sayısı da döner; rol düşürme penceresi aktarımı buna göre ister. */
  async listele() {
    const [kullanicilar, gorevler] = await Promise.all([
      this.platform.db.platformKullanici.findMany({ select: SECIM, orderBy: { createdAt: "asc" } }),
      this.platform.db.platformGorev.groupBy({ by: ["sorumluId"], where: ACIK_PLATFORM_GOREVI, _count: { _all: true } }),
    ]);
    const sayilar = new Map(gorevler.map((g) => [g.sorumluId, g._count._all]));
    return kullanicilar.map((k) => ({ ...k, acikPlatformGorevi: sayilar.get(k.id) ?? 0 }));
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
    // PLT-30: yeniden başlatma eski kurulumu (bağlantı + karekod) iptal eder; o arada tamamlanmış ya da pasife alınmışsa dokunmaz.
    const { count } = await this.platform.db.platformKullanici.updateMany({
      where: { id, aktif: true, davetTuru: k.davetTuru },
      data: { totpSecretSifreli: sifrele(generateSecret()), ...this.davetAlanlari(k.davetTuru as DavetTuru, anahtar) },
    });
    if (!count) throw new ConflictException("Kullanıcının kurulum durumu değişti; listeyi yenileyip tekrar deneyin");
    await this.olay(kullaniciId, "platform_daveti_yenilendi", { eposta: k.eposta, tur: k.davetTuru });
    return this.davetGonder(k, k.davetTuru as DavetTuru, anahtar);
  }

  /**
   * PLT-31: yönetici editöre düşürülürken açık platform görevleri aynı işlemde
   * seçilen yöneticiye aktarılır; editör bu görevleri göremeyeceği için aktarım
   * hedefi yoksa rol değişmez. Pasife alma güvenlik işlemidir, bekletilmez;
   * pasif sorumlunun görevleri görev merkezinde işaretlenir.
   */
  async guncelle(id: string, girdi: { rol?: PlatformRol; aktif?: boolean; gorevAktarimHedefiId?: string }) {
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
      const aktarilacak = mevcut.rol === "yonetici" && yeniRol !== "yonetici"
        ? await tx.platformGorev.findMany({ where: { ...ACIK_PLATFORM_GOREVI, sorumluId: id }, select: { id: true, baslik: true }, orderBy: { createdAt: "asc" } })
        : [];
      let hedefId: string | null = null;
      if (aktarilacak.length) {
        if (!girdi.gorevAktarimHedefiId) throw new BadRequestException(`Kullanıcının ${aktarilacak.length} açık platform görevi var; rolü değiştirmeden önce görevlerin aktarılacağı yöneticiyi seçin`);
        const hedef = girdi.gorevAktarimHedefiId === id ? null : await tx.platformKullanici.findFirst({ where: { id: girdi.gorevAktarimHedefiId, rol: "yonetici", aktif: true, davetTuru: null }, select: { id: true } });
        if (!hedef) throw new BadRequestException("Görevler yalnız kurulumu tamamlanmış başka bir aktif platform yöneticisine aktarılabilir");
        hedefId = hedef.id;
      }
      const guncel = await tx.platformKullanici.update({ where: { id }, data: { rol: yeniRol, aktif: yeniAktif }, select: SECIM });
      if (mevcut.rol !== guncel.rol || mevcut.aktif !== guncel.aktif) await this.oturumlariDusur(tx, id, mevcut.aktif !== guncel.aktif ? "durum_degisti" : "rol_degisti");
      for (const g of aktarilacak) {
        const { surum } = await tx.platformGorev.update({ where: { id: g.id }, data: { sorumluId: hedefId, surum: { increment: 1 } }, select: { surum: true } });
        await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "platform_gorevi_guncellendi", detay: { gorevId: g.id, baslik: g.baslik, neden: "rol_dusurme_aktarimi", oncekiSorumluId: id, yeniSorumluId: hedefId, surum } } });
      }
      if (mevcut.rol !== guncel.rol) {
        await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "platform_rolu_degisti", detay: { eposta: mevcut.eposta, eski: mevcut.rol, yeni: guncel.rol, ...(aktarilacak.length ? { aktarilanGorev: aktarilacak.length, gorevAktarimHedefiId: hedefId } : {}) } } });
      }
      if (mevcut.aktif !== guncel.aktif) {
        await tx.mevzuatOlay.create({ data: { kullaniciId, olay: guncel.aktif ? "platform_kullanicisi_aktif_edildi" : "platform_kullanicisi_pasife_alindi", detay: { eposta: mevcut.eposta } } });
      }
      return guncel;
    }).finally(() => this.oturumDurum?.kullaniciUnut(id));
  }

  /** Telefon kaybı: 2FA geçersizleşir, kullanıcı bağlantıyla (mevcut parolasıyla) yeniden kurana kadar giremez. */
  async ikiAdimSifirla(id: string) {
    const { kullaniciId } = aktifPlatformBaglam();
    if (id === kullaniciId) throw new BadRequestException("Kendi 2FA'nızı sıfırlayamazsınız; başka bir platform yöneticisi sıfırlayabilir");
    const k = await this.bul(id);
    if (k.davetTuru === "hesap") throw new BadRequestException("Kullanıcı daveti henüz kabul etmedi; daveti yeniden gönderin");
    const anahtar = randomBytes(32).toString("base64url");
    await this.platform.db.$transaction(async (tx) => {
      await tx.platformKullanici.update({ where: { id }, data: { totpSecretSifreli: sifrele(generateSecret()), ...this.davetAlanlari("iki_adim", anahtar) } });
      await this.oturumlariDusur(tx, id, "2fa_sifirlandi");
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "platform_2fa_sifirlandi", detay: { eposta: k.eposta } } });
    });
    this.oturumDurum?.kullaniciUnut(id);
    return this.davetGonder(k, "iki_adim", anahtar);
  }

  /**
   * Davet sayfası açılınca kurulumun 2FA anahtarı karekodla döner. Oturum gerektirmez.
   * PLT-30: anahtar davet açılırken/yenilenirken bir kez üretilir; sayfayı yenilemek ya
   * da ikinci sekmede açmak onu değiştirmez (eskiden ilk sekmenin karekodu bozuluyordu).
   */
  async davetBilgisi(anahtar: string) {
    const k = await this.davetliBul(anahtar);
    const secret = coz(k.totpSecretSifreli);
    const otpauthUrl = generateURI({ secret, issuer: "TekirExtra Platform", label: k.eposta });
    const svg = bwipjs.toSVG({ bcid: "qrcode", text: otpauthUrl });
    return {
      eposta: k.eposta, adSoyad: k.adSoyad, rol: k.rol, tur: k.davetTuru as DavetTuru,
      secret, otpauthUrl, karekod: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
    };
  }

  /**
   * "hesap": yeni parola belirlenir; "iki_adim": mevcut parola doğrulanır. İkisinde de ilk 2FA kodu zorunlu.
   * PLT-30: hatalı kod/parola hesap başına (5) ve IP başına (20) 15 dakikalık pencerede sayılır.
   * Davet tek koşullu yazımla tüketilir: o an hâlâ aktif, süresi dolmamış, aynı bağlantı ve
   * doğrulanan sırla aynı kurulum olmalıdır; yenileme, pasife alma ve eşzamanlı ikinci
   * tamamlama bu yazımı boşa düşürür.
   */
  async davetTamamla(anahtar: string, girdi: { parola: string; kod: string }, ip = "bilinmiyor") {
    const k = await this.davetliBul(anahtar);
    const tur = k.davetTuru as DavetTuru;
    const hesapAnahtari = `davet:${k.id}`;
    const ipAnahtari = `davet-ip:${ip}`;
    if (await this.denemeler.kilitliMi(hesapAnahtari, ["platform_davet"]) || await this.denemeler.kilitliMi(ipAnahtari, ["platform_davet_ip"])) {
      throw new HttpException("Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const hatali = async (mesaj: string) => {
      await this.denemeler.hataKaydet("platform_davet", hesapAnahtari);
      await this.denemeler.hataKaydet("platform_davet_ip", ipAnahtari);
      return new BadRequestException(mesaj);
    };
    if (tur === "hesap") {
      const kural = parolaSemasi.safeParse(girdi.parola);
      if (!kural.success) throw new BadRequestException(kural.error.issues.map((i) => i.message).join("; "));
    }
    if (!totpDogrula(coz(k.totpSecretSifreli), girdi.kod)) throw await hatali("Doğrulama kodu geçersiz; uygulamadaki güncel kodu girin");
    let parolaHash = k.parolaHash;
    if (tur === "iki_adim") {
      if (!(await argon2.verify(k.parolaHash, girdi.parola))) throw await hatali("Parola hatalı");
    } else {
      parolaHash = await argon2.hash(girdi.parola);
    }
    const { count } = await this.platform.db.platformKullanici.updateMany({
      where: { id: k.id, aktif: true, davetTuru: tur, davetAnahtarOzeti: k.davetAnahtarOzeti, totpSecretSifreli: k.totpSecretSifreli, davetSonGecerlilik: { gt: new Date() } },
      data: { parolaHash, davetTuru: null, davetAnahtarOzeti: null, davetSonGecerlilik: null },
    });
    if (!count) throw new BadRequestException("Bağlantı geçersiz veya süresi dolmuş; platform yöneticisinden yeni bağlantı isteyin");
    await this.denemeler.temizle(hesapAnahtari, ["platform_davet"]);
    this.oturumDurum?.kullaniciUnut(k.id);
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
    // PLT-30: anahtar URL parçasında (#) taşınır; tarayıcı onu sunucuya, vekil ve erişim loglarına göndermez.
    const baglanti = `${process.env.APP_URL ?? "http://localhost:3100"}/platform/davet#anahtar=${anahtar}`;
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
        html: `<p>Merhaba ${html(k.adSoyad)},</p><p>${html(giris)}</p><p><a href="${html(baglanti)}">Kurulumu başlat</a></p><p>Bağlantı ${PLATFORM_DAVET_GECERLILIK_SAAT} saat geçerlidir ve bir kez kullanılabilir.</p>`,
      });
      return { gonderildi: true, mesaj: `${k.eposta} adresine bağlantı gönderildi; ${PLATFORM_DAVET_GECERLILIK_SAAT} saat geçerli.` };
    } catch (hata) {
      this.logger.warn(`Platform daveti gönderilemedi: ${String(hata)}`);
      return { gonderildi: false, mesaj: "E-posta gönderilemedi; aşağıdaki bağlantıyı kullanıcıya güvenli bir yoldan iletin.", baglanti };
    }
  }
}
