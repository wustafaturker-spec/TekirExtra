import { HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { totpDogrula } from "../auth/totp-dogrula";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { platformJwtAnahtari, type PlatformJwtYuku } from "../auth/auth.guard";
import { coz } from "../core/kripto";
import { GirisDenemeSayaci } from "../auth/giris-deneme-sayaci";
import { PlatformPrismaService } from "./platform-prisma.service";

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

    await this.platform.db.platformKullanici.update({ where: { id: kullanici.id }, data: { sonGiris: new Date() } });
    await this.platform.db.mevzuatOlay.create({ data: { kullaniciId: kullanici.id, olay: "giris" } });
    const yuk: PlatformJwtYuku = { sub: kullanici.id, eposta: kullanici.eposta, kapsam: "platform", rol: kullanici.rol };
    return {
      accessToken: await this.jwt.signAsync(yuk, { secret: anahtar, expiresIn: "30m" }),
      kullanici: { id: kullanici.id, eposta: kullanici.eposta, adSoyad: kullanici.adSoyad, rol: kullanici.rol },
    };
  }
}
