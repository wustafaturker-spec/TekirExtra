import { HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { totpDogrula } from "../auth/totp-dogrula";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { platformJwtAnahtari, type PlatformJwtYuku } from "../auth/auth.guard";
import { coz } from "../core/kripto";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { PlatformOturumDurumService } from "./platform-oturum-durum.service";
import { PlatformPrismaService } from "./platform-prisma.service";

/** Platform token'ı ve oturum kaydı aynı süre yaşar; yenileme yoktur. */
const OTURUM_SURESI_MS = 30 * 60_000;

/**
 * MVZ-04: platform ekibi girişi. Parola + iki adımlı doğrulama kodu birlikte
 * zorunludur; ilk kullanıcı `platform-kullanici-olustur` betiğiyle, sonrakiler
 * Platform kullanıcıları ekranından davetle açılır (PLT-07).
 * Oturum kısa ömürlüdür (30 dk), yenileme yoktur.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly platform: PlatformPrismaService,
    private readonly jwt: JwtService,
    private readonly denemeler: GirisDenemeSayaci,
    private readonly oturumDurum: PlatformOturumDurumService,
  ) {}

  async giris(eposta: string, parola: string, totpKodu: string) {
    const anahtar = platformJwtAnahtari();
    if (!anahtar) throw new UnauthorizedException("Platform paneli yapılandırılmamış");
    // Platform P1-2: bütün firmaları etkileyen hesap; firma girişinden sıkı sınır (5 hata / 15 dk).
    const sayacAnahtari = `platform:${eposta.trim().toLowerCase()}`;
    if (await this.denemeler.kilitliMi(sayacAnahtari, ["platform"])) {
      throw new HttpException("Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const kullanici = await this.platform.db.platformKullanici.findUnique({ where: { eposta: eposta.trim().toLowerCase() } });
    const hatali = async (neden: string) => {
      await this.denemeler.hataKaydet("platform", sayacAnahtari);
      await this.platform.db.mevzuatOlay.create({ data: { kullaniciId: kullanici?.id ?? null, olay: "giris_basarisiz", detay: { eposta: eposta.trim().toLowerCase(), neden } } });
      return new UnauthorizedException("E-posta, parola ya da doğrulama kodu hatalı");
    };
    if (!kullanici || !kullanici.aktif) throw await hatali(kullanici ? "pasif" : "hesap_yok");
    // PLT-07: davet ya da 2FA sıfırlaması bekleyen hesap bağlantıyla kurulmadan giremez.
    if (kullanici.davetTuru) throw await hatali("kurulum_bekliyor");
    if (!(await argon2.verify(kullanici.parolaHash, parola))) throw await hatali("parola");
    if (!totpDogrula(coz(kullanici.totpSecretSifreli), totpKodu)) throw await hatali("dogrulama_kodu");
    await this.denemeler.temizle(sayacAnahtari, ["platform"]);

    const simdi = new Date();
    // PLT-25: her giriş ayrı oturumdur; bir günden eski bitmiş oturum kayıtları bu sırada temizlenir.
    const oturum = await this.platform.db.$transaction(async (tx) => {
      await tx.platformKullanici.update({ where: { id: kullanici.id }, data: { sonGiris: simdi } });
      await tx.platformOturum.deleteMany({ where: { kullaniciId: kullanici.id, bitis: { lt: new Date(simdi.getTime() - 86_400_000) } } });
      const o = await tx.platformOturum.create({ data: { kullaniciId: kullanici.id, bitis: new Date(simdi.getTime() + OTURUM_SURESI_MS) }, select: { id: true } });
      await tx.mevzuatOlay.create({ data: { kullaniciId: kullanici.id, olay: "giris", detay: { oturumId: o.id } } });
      return o;
    });
    const yuk: PlatformJwtYuku = { sub: kullanici.id, eposta: kullanici.eposta, kapsam: "platform", rol: kullanici.rol, sv: kullanici.oturumSurumu, oid: oturum.id };
    return {
      accessToken: await this.jwt.signAsync(yuk, { secret: anahtar, expiresIn: OTURUM_SURESI_MS / 1000 }),
      kullanici: { id: kullanici.id, eposta: kullanici.eposta, adSoyad: kullanici.adSoyad, rol: kullanici.rol },
    };
  }

  /**
   * PLT-25: çıkış. Token geçerliyse yalnız bu oturum sunucuda iptal edilir; süresi
   * dolmuş ya da bozuk token'da iptal edilecek bir şey yoktur (`false`).
   */
  async cikis(token: string | undefined): Promise<boolean> {
    const anahtar = platformJwtAnahtari();
    if (!token || !anahtar) return false;
    let yuk: PlatformJwtYuku;
    try {
      yuk = await this.jwt.verifyAsync<PlatformJwtYuku>(token, { secret: anahtar });
    } catch {
      return false;
    }
    if (yuk.kapsam !== "platform" || !yuk.oid) return false;
    const { count } = await this.platform.db.platformOturum.updateMany({ where: { id: yuk.oid, kullaniciId: yuk.sub, iptalAt: null }, data: { iptalAt: new Date(), iptalNedeni: "cikis" } });
    if (count) await this.platform.db.mevzuatOlay.create({ data: { kullaniciId: yuk.sub, olay: "platform_cikis", detay: { oturumId: yuk.oid } } });
    this.oturumDurum.oturumUnut(yuk.oid);
    return true;
  }

  /** PLT-25: kullanıcının bütün oturumları (bu sekme dahil) kapanır; sürüm artar, eski token'lar geçmez. */
  async tumOturumlariKapat(): Promise<{ kapatilan: number }> {
    const { kullaniciId } = aktifPlatformBaglam();
    const kapatilan = await this.platform.db.$transaction(async (tx) => {
      await tx.platformKullanici.update({ where: { id: kullaniciId }, data: { oturumSurumu: { increment: 1 } } });
      const { count } = await tx.platformOturum.updateMany({ where: { kullaniciId, iptalAt: null }, data: { iptalAt: new Date(), iptalNedeni: "tum_oturumlar_kapatildi" } });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "platform_oturumlari_kapatildi", detay: { kapatilan: count } } });
      return count;
    });
    this.oturumDurum.kullaniciUnut(kullaniciId);
    return { kapatilan };
  }
}
