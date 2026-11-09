import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { PlatformIletiService } from "../ileti/platform-ileti.service";
import { SmsKodService, telefonMaskele } from "../ileti/sms-kod.service";

const kodGonderSemasi = z.object({ telefon: z.string().min(10).max(20), parola: z.string().min(1).max(200) });
const dogrulaSemasi = z.object({ kod: z.string().regex(/^\d{6}$/, "Kod 6 haneli olmalıdır") });
const parolaSemasi = z.object({ parola: z.string().min(1).max(200) });
const ikinciAdimSemasi = parolaSemasi.extend({ acik: z.boolean() });

/** ILT-12: kullanıcının kendi telefonu. Numara ve güvenlik ayarı değişikliği parola ister (ele geçirilmiş oturum numarayı değiştiremesin). */
@Controller("auth/telefon")
export class TelefonController {
  constructor(private readonly prisma: PrismaService, private readonly kod: SmsKodService, private readonly ileti: PlatformIletiService) {}

  private async parolaDogrula(parola: string) {
    const { tenantId, userId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { parolaHash: true } }));
    if (!k || !(await argon2.verify(k.parolaHash, parola))) throw new UnauthorizedException("Parola hatalı");
  }
  private iz(islem: string, detay: Record<string, string | boolean | null>) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId, islem, varlik: "user", varlikId: userId, detay } }));
  }

  @Get()
  async durum() {
    const { tenantId, userId } = aktifBaglam();
    const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { telefon: true, telefonDogrulandiAt: true, smsIkinciAdim: true, totpAktif: true } }));
    return { telefon: telefonMaskele(k?.telefon ?? null), dogrulandi: Boolean(k?.telefonDogrulandiAt), smsIkinciAdim: Boolean(k?.smsIkinciAdim), totpAktif: Boolean(k?.totpAktif), smsHazir: await this.ileti.smsHazir() };
  }

  @Post("kod")
  @HttpCode(200)
  async kodGonder(@Body() govde: unknown) {
    const g = kodGonderSemasi.parse(govde);
    await this.parolaDogrula(g.parola);
    const { tenantId, userId } = aktifBaglam();
    const gonderildi = await this.kod.gonder({ tenantId, userId, amac: "telefon_dogrula", telefon: g.telefon });
    return { gonderildi, mesaj: gonderildi ? "Kod telefonunuza gönderildi; 5 dakika geçerlidir." : "Kısa süre önce kod istendi; bir dakika sonra yeniden deneyin." };
  }

  @Post("dogrula")
  @HttpCode(200)
  async dogrula(@Body() govde: unknown) {
    const { kod } = dogrulaSemasi.parse(govde);
    const { tenantId, userId } = aktifBaglam();
    const s = await this.kod.dogrula({ userId, amac: "telefon_dogrula", kod });
    if (!s) throw new BadRequestException("Kod geçersiz ya da süresi dolmuş");
    await this.prisma.tenantIslem(tenantId, (tx) => tx.user.update({ where: { id: userId }, data: { telefon: s.telefon, telefonDogrulandiAt: new Date() } }));
    await this.iz("telefon_dogrulandi", { telefon: telefonMaskele(s.telefon) });
    return { dogrulandi: true };
  }

  @Post("ikinci-adim")
  @HttpCode(200)
  async ikinciAdim(@Body() govde: unknown) {
    const g = ikinciAdimSemasi.parse(govde);
    await this.parolaDogrula(g.parola);
    const { tenantId, userId } = aktifBaglam();
    if (g.acik) {
      const k = await this.prisma.tenantIslem(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, select: { telefonDogrulandiAt: true } }));
      if (!k?.telefonDogrulandiAt) throw new BadRequestException("Önce telefonunuzu doğrulayın");
      if (!(await this.ileti.smsHazir())) throw new BadRequestException("Sistem SMS hesabı henüz tanımlı değil");
    }
    await this.prisma.tenantIslem(tenantId, (tx) => tx.user.update({ where: { id: userId }, data: { smsIkinciAdim: g.acik } }));
    await this.iz("sms_ikinci_adim", { acik: g.acik });
    return { smsIkinciAdim: g.acik };
  }

  @Delete()
  async kaldir(@Body() govde: unknown) {
    const { parola } = parolaSemasi.parse(govde);
    await this.parolaDogrula(parola);
    const { tenantId, userId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) => tx.user.update({ where: { id: userId }, data: { telefon: null, telefonDogrulandiAt: null, smsIkinciAdim: false } }));
    await this.iz("telefon_kaldirildi", {});
    return { kaldirildi: true };
  }
}
