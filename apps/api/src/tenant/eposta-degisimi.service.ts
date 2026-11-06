import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "./eposta.service";

/** KLN-23: yeni adrese giden doğrulama bağlantısı bir gün geçerlidir. */
export const EPOSTA_DEGISIMI_GECERLILIK_SAAT = 24;

const yeniEpostaSemasi = z.object({ eposta: z.string().trim().max(254).pipe(z.email("Geçerli bir e-posta adresi girin")).transform((deger) => deger.toLowerCase()) });
const kendiDegisimSemasi = yeniEpostaSemasi.extend({ mevcutParola: z.string().min(1, "Mevcut parolanızı girin").max(200) });
const onaySemasi = z.object({ token: z.string().min(20).max(200) });

const KULLANIMDA = "Bu e-posta adresi başka bir hesapta kullanılıyor";

function tokenHashle(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ayristir<T>(sema: z.ZodType<T>, govde: unknown): T {
  const sonuc = sema.safeParse(govde);
  if (!sonuc.success) throw new BadRequestException(sonuc.error.issues[0]?.message ?? "Geçersiz e-posta bilgisi");
  return sonuc.data;
}

/**
 * KLN-23: giriş e-postası değişikliği. Yeni adrese tek kullanımlık doğrulama
 * bağlantısı, eski adrese bilgilendirme gider; bağlantı kullanılana kadar
 * giriş adı değişmez. Adres tüm firmalarda tekildir (auth_kimlikler).
 */
@Injectable()
export class EpostaDegisimiService {
  private readonly logger = new Logger(EpostaDegisimiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eposta: EpostaService,
    private readonly durum: KullaniciDurumService,
  ) {}

  /** Yönetici, firmasındaki bir kullanıcının giriş e-postasını değiştirir. */
  async yoneticiBaslat(hedefId: string, govde: unknown): Promise<{ gonderildi: boolean; mesaj: string }> {
    const { eposta } = ayristir(yeniEpostaSemasi, govde);
    return this.baslat(hedefId, eposta);
  }

  /** Kullanıcı kendi giriş e-postasını mevcut parolasıyla değiştirir. */
  async kendiBaslat(govde: unknown): Promise<{ gonderildi: boolean; mesaj: string }> {
    const { eposta, mevcutParola } = ayristir(kendiDegisimSemasi, govde);
    const { tenantId, userId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { parolaHash: true } }));
    if (!k) throw new NotFoundException("Kullanıcı bulunamadı");
    // 401 değil 400: istemci 401'de oturumu yenilemeye çalışır.
    if (!(await argon2.verify(k.parolaHash, mevcutParola))) throw new BadRequestException("Mevcut parola hatalı");
    return this.baslat(userId, eposta);
  }

  private async baslat(hedefId: string, yeniEposta: string): Promise<{ gonderildi: boolean; mesaj: string }> {
    const { tenantId, userId } = aktifBaglam();
    const hedef = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kullanici = await tx.user.findUnique({ where: { id: hedefId }, select: { adSoyad: true, eposta: true, aktif: true } });
      if (!kullanici) throw new NotFoundException("Kullanıcı bulunamadı");
      if (!kullanici.aktif) throw new BadRequestException("Pasif kullanıcının e-postası değiştirilemez; önce aktif edin");
      if (kullanici.eposta.toLowerCase() === yeniEposta.toLowerCase()) throw new BadRequestException("Yeni adres mevcut adresle aynı");
      await tx.auditLog.create({
        data: { tenantId, userId, islem: "eposta_degisimi_istendi", varlik: "user", varlikId: hedefId, detay: { eskiEposta: kullanici.eposta, yeniEposta } },
      });
      return kullanici;
    });
    if (await this.adresKullanimda(yeniEposta)) throw new ConflictException(KULLANIMDA);

    // Önceki bekleyen bağlantılar geçersizleşir; yalnız en sonuncusu çalışır.
    await this.prisma.epostaDegisimi.updateMany({ where: { userId: hedefId, kullanildi: false }, data: { kullanildi: true } });
    const token = randomBytes(32).toString("base64url");
    await this.prisma.epostaDegisimi.create({
      data: { tenantId, userId: hedefId, yeniEposta, tokenHash: tokenHashle(token), gecerlilikSonu: new Date(Date.now() + EPOSTA_DEGISIMI_GECERLILIK_SAAT * 3_600_000) },
    });
    const adres = `${process.env.APP_URL ?? "http://localhost:3100"}/eposta-degistir?token=${token}`;
    try {
      await this.eposta.epostaDegisimiDogrulamaGonder(yeniEposta, hedef.adSoyad, adres, EPOSTA_DEGISIMI_GECERLILIK_SAAT);
    } catch (hata) {
      this.logger.warn(`E-posta değişikliği doğrulaması gönderilemedi: ${String(hata)}`);
      return { gonderildi: false, mesaj: `Doğrulama e-postası gönderilemedi (${hata instanceof Error ? hata.message : "e-posta hatası"}). E-posta ayarlarını kontrol edip yeniden deneyin.` };
    }
    try {
      await this.eposta.epostaDegisimiBilgilendir(hedef.eposta, hedef.adSoyad, yeniEposta);
    } catch (hata) {
      // Doğrulama gitti; bilgilendirme gitmezse değişiklik yine de yeni adresin onayını bekler.
      this.logger.warn(`E-posta değişikliği bilgilendirmesi gönderilemedi: ${String(hata)}`);
    }
    return { gonderildi: true, mesaj: `${yeniEposta} adresine doğrulama bağlantısı gönderildi (${EPOSTA_DEGISIMI_GECERLILIK_SAAT} saat geçerli). Bağlantı kullanılınca giriş e-postası değişir.` };
  }

  /** Bağlantıdaki tek kullanımlık anahtarla giriş adı yeni adres olur. */
  async onayla(govde: unknown): Promise<{ mesaj: string; eposta: string }> {
    const { token } = ayristir(onaySemasi, govde);
    const gecersiz = new BadRequestException("Doğrulama bağlantısı geçersiz veya süresi dolmuş; değişikliği yeniden isteyin");
    const kayit = await this.prisma.epostaDegisimi.findUnique({ where: { tokenHash: tokenHashle(token) } });
    if (!kayit || kayit.kullanildi || kayit.gecerlilikSonu < new Date()) throw gecersiz;
    // Aynı bağlantı iki kez gönderilirse yalnız ilki geçer.
    const { count } = await this.prisma.epostaDegisimi.updateMany({ where: { id: kayit.id, kullanildi: false }, data: { kullanildi: true } });
    if (count !== 1) throw gecersiz;
    if (await this.adresKullanimda(kayit.yeniEposta)) throw new ConflictException(KULLANIMDA);
    try {
      await this.prisma.tenantIslem(kayit.tenantId, async (tx) => {
        const kullanici = await tx.user.findUnique({ where: { id: kayit.userId }, select: { aktif: true, eposta: true } });
        if (!kullanici?.aktif) throw gecersiz;
        // Tekillik auth_kimlikler'in eposta anahtarıyla korunur; yarışta kaybeden P2002 alır.
        const yeniEposta = kayit.yeniEposta.trim().toLowerCase();
        await tx.authKimlik.update({ where: { userId: kayit.userId }, data: { eposta: yeniEposta } });
        await tx.user.update({ where: { id: kayit.userId }, data: { eposta: yeniEposta, epostaDogrulandi: true } });
        await tx.auditLog.create({
          data: { tenantId: kayit.tenantId, userId: kayit.userId, islem: "eposta_degisti", varlik: "user", varlikId: kayit.userId, detay: { eskiEposta: kullanici.eposta, yeniEposta } },
        });
      });
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") throw new ConflictException(KULLANIMDA);
      throw hata;
    }
    this.durum.unut(kayit.userId);
    return { mesaj: `Giriş e-postanız ${kayit.yeniEposta} oldu; bundan sonra bu adresle giriş yapın.`, eposta: kayit.yeniEposta };
  }

  /** Büyük/küçük harf farkı ayrı hesap sayılmaz. */
  private async adresKullanimda(eposta: string): Promise<boolean> {
    return (await this.prisma.authKimlik.count({ where: { eposta: { equals: eposta, mode: "insensitive" } } })) > 0;
  }
}
