import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../core/prisma.service";
import { PlatformIletiService } from "./platform-ileti.service";
import { telefonE164 } from "./sms-kurallari";

export type SmsKodAmaci = "telefon_dogrula" | "parola_sifirla" | "giris";
const GECERLILIK_DK = 5;
const AZAMI_DENEME = 5;
const YENIDEN_GONDERME_SN = 60;
const SAATLIK_AZAMI = 5;

const ozet = (userId: string, amac: string, kod: string) => {
  const sir = process.env.JWT_SECRET;
  if (!sir) throw new Error("JWT_SECRET tanımlı değil");
  return createHmac("sha256", sir).update(`${userId}:${amac}:${kod}`).digest("hex");
};
export const telefonMaskele = (t: string | null) => (t ? `${t.slice(0, 6)}*****${t.slice(-2)}` : null);

/**
 * ILT-12: tek kullanımlık SMS kodu. Kod 6 hane, 5 dakika geçerli; yalnız anahtarlı özeti saklanır.
 * Kullanıcı ve telefon başına sınırlı gönderilir, 5 hatalı denemede geçersiz olur.
 * SMS platform hesabından çıkar. Tablo RLS'sizdir: giriş öncesi kullanılır.
 */
@Injectable()
export class SmsKodService {
  constructor(private readonly prisma: PrismaService, private readonly ileti: PlatformIletiService) {}

  /** `false`: sınıra takıldı, SMS gönderilmedi (önceki kod hâlâ geçerli olabilir). */
  async gonder(g: { tenantId: string; userId: string; amac: SmsKodAmaci; telefon: string }): Promise<boolean> {
    const telefon = telefonE164(g.telefon);
    if (!telefon) throw new HttpException("Geçerli bir Türkiye cep telefonu numarası gereklidir", HttpStatus.BAD_REQUEST);
    const kod = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const simdi = Date.now();
    const kayit = await this.prisma.$transaction(async (tx) => {
      // Eşzamanlı iki istek sınırı aşamasın; telefon kilidi farklı kullanıcıların aynı numarayı bombalamasını da sıralar.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"sms-kod:" + telefon}, 0))::text`;
      const saatOnce = new Date(simdi - 3_600_000);
      const [son, kullaniciSayisi, telefonSayisi] = await Promise.all([
        tx.smsDogrulamaKodu.findFirst({ where: { userId: g.userId, amac: g.amac }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        tx.smsDogrulamaKodu.count({ where: { userId: g.userId, createdAt: { gt: saatOnce } } }),
        tx.smsDogrulamaKodu.count({ where: { telefon, createdAt: { gt: saatOnce } } }),
      ]);
      if (son && simdi - son.createdAt.getTime() < YENIDEN_GONDERME_SN * 1000) return null;
      if (kullaniciSayisi >= SAATLIK_AZAMI || telefonSayisi >= SAATLIK_AZAMI) return null;
      await tx.smsDogrulamaKodu.updateMany({ where: { userId: g.userId, amac: g.amac, kullanildi: false }, data: { kullanildi: true } });
      return tx.smsDogrulamaKodu.create({ data: { tenantId: g.tenantId, userId: g.userId, amac: g.amac, telefon, kodOzeti: ozet(g.userId, g.amac, kod), sonGecerlilik: new Date(simdi + GECERLILIK_DK * 60_000) }, select: { id: true } });
    });
    if (!kayit) return false;
    try {
      await this.ileti.smsGonder({ tur: `sms_kod_${g.amac}`, telefon, mesaj: `TekirExtra doğrulama kodunuz: ${kod}. ${GECERLILIK_DK} dakika geçerlidir, kimseyle paylaşmayın.`, tenantId: g.tenantId });
    } catch (hata) {
      await this.prisma.smsDogrulamaKodu.update({ where: { id: kayit.id }, data: { kullanildi: true } });
      throw hata;
    }
    return true;
  }

  /** Doğruysa kodun gittiği telefonu döner ve kod bir daha kullanılamaz. */
  async dogrula(g: { userId: string; amac: SmsKodAmaci; kod: string }): Promise<{ telefon: string } | null> {
    if (!/^\d{6}$/.test(g.kod)) return null;
    const kayit = await this.prisma.smsDogrulamaKodu.findFirst({ where: { userId: g.userId, amac: g.amac, kullanildi: false, sonGecerlilik: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!kayit) return null;
    // Deneme hakkı karşılaştırmadan önce düşer: paralel istekler sınırı aşamaz.
    const hak = await this.prisma.smsDogrulamaKodu.updateMany({ where: { id: kayit.id, kullanildi: false, deneme: { lt: AZAMI_DENEME } }, data: { deneme: { increment: 1 } } });
    if (hak.count !== 1) return null;
    const beklenen = Buffer.from(kayit.kodOzeti, "hex"), gelen = Buffer.from(ozet(g.userId, g.amac, g.kod), "hex");
    if (!timingSafeEqual(beklenen, gelen)) {
      if (kayit.deneme + 1 >= AZAMI_DENEME) await this.prisma.smsDogrulamaKodu.updateMany({ where: { id: kayit.id }, data: { kullanildi: true } });
      return null;
    }
    const son = await this.prisma.smsDogrulamaKodu.updateMany({ where: { id: kayit.id, kullanildi: false }, data: { kullanildi: true } });
    return son.count === 1 ? { telefon: kayit.telefon } : null;
  }
}
