import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

@Injectable()
export class OdemeTalimatiService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  async listele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.findMany({ orderBy: { createdAt: "desc" }, include: { bankaHesap: { select: { ad: true, bankaAdi: true } }, olusturan: { select: { id: true, adSoyad: true } }, onaylayan: { select: { id: true, adSoyad: true } } } }));
  }

  async olustur(girdi: { bankaHesapId: string; aliciUnvan: string; aliciIban: string; tutar: string; aciklama: string }) {
    const { tenantId, userId } = aktifBaglam();
    const hesap = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } }));
    if (!hesap?.aktif) throw new NotFoundException("Aktif banka hesabı bulunamadı");
    const tutar = new Prisma.Decimal(girdi.tutar); if (!tutar.gt(0)) throw new BadRequestException("Tutar sıfırdan büyük olmalıdır");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.create({ data: { tenantId, bankaHesapId: hesap.id, aliciUnvan: girdi.aliciUnvan, aliciIban: girdi.aliciIban.replace(/\s/g, "").toUpperCase(), tutar, dovizCinsi: hesap.dovizCinsi, aciklama: girdi.aciklama, olusturanUserId: userId } }));
  }

  async onayla(id: string, totpKodu: string) {
    const { tenantId, userId } = aktifBaglam();
    const talimat = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.findUnique({ where: { id } }));
    if (!talimat) throw new NotFoundException("Ödeme talimatı bulunamadı");
    if (talimat.olusturanUserId === userId) throw new BadRequestException("Talimatı oluşturan kullanıcı onaylayamaz");
    if (talimat.durum !== "onay_bekliyor") throw new ConflictException("Talimat artık onay beklemiyor");
    await this.auth.kritikIslemTotpDogrula(totpKodu);
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.updateMany({ where: { id, durum: "onay_bekliyor", onaylayanUserId: null }, data: { durum: "onaylandi", onaylayanUserId: userId, onayZamani: new Date() } }));
    if (sonuc.count !== 1) throw new ConflictException("Talimat başka bir kullanıcı tarafından işlendi");
    return { basarili: true, durum: "onaylandi", mesaj: "Sağlayıcı gönderim adaptörü bekleniyor" };
  }

  async iptal(id: string) {
    const { tenantId, userId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaOdemeTalimati.updateMany({ where: { id, olusturanUserId: userId, durum: "onay_bekliyor" }, data: { durum: "iptal" } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnız oluşturan kullanıcı, onay bekleyen talimatı iptal edebilir");
    return { basarili: true };
  }
}
