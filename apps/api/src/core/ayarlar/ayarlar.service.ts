import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { aktifBaglam } from "../istek-baglami";
import { PrismaService } from "../prisma.service";
import { ayarTanimiAl } from "./ayar-kayit";

@Injectable()
export class AyarlarService {
  constructor(private readonly prisma: PrismaService) {}

  /** Saklanan değerleri varsayılanların üstüne bindirerek döner. */
  async getir(modul: string): Promise<Record<string, unknown>> {
    const tanim = ayarTanimiAl(modul);
    if (!tanim) {
      throw new NotFoundException(`'${modul}' modülünün ayar tanımı yok`);
    }
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul } } }),
    );
    const saklanan = (kayit?.ayarlar ?? {}) as Record<string, unknown>;
    return { ...tanim.varsayilanlar, ...saklanan };
  }

  /** Tam ayar nesnesini şemayla doğrulayıp kaydeder. */
  async guncelle(
    modul: string,
    veri: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const tanim = ayarTanimiAl(modul);
    if (!tanim) {
      throw new NotFoundException(`'${modul}' modülünün ayar tanımı yok`);
    }
    const ayristirma = tanim.sema.safeParse(veri);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues
          .map((s) => `${s.path.join(".")}: ${s.message}`)
          .join("; "),
      );
    }
    const dogrulanmis = ayristirma.data as Record<string, unknown>;
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.modulAyar.upsert({
        where: { tenantId_modul: { tenantId, modul } },
        create: { tenantId, modul, ayarlar: dogrulanmis as Prisma.InputJsonValue },
        update: { ayarlar: dogrulanmis as Prisma.InputJsonValue },
      }),
    );
    return dogrulanmis;
  }
}
