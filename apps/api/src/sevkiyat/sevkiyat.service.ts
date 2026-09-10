import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type {
  aracGuncelleSemasi,
  aracOlusturSemasi,
  soforGuncelleSemasi,
  soforOlusturSemasi,
} from "./sevkiyat.semalar";

/** Araç ve şoför kartları (EBLG-25); e-İrsaliyede tekrar tekrar veri girmemek için. */
const ARAC_ALANLARI = { id: true, plaka: true, dorsePlaka: true, aciklama: true, aktif: true } as const;
const SOFOR_ALANLARI = { id: true, ad: true, soyad: true, tckn: true, aktif: true } as const;

@Injectable()
export class SevkiyatService {
  constructor(private readonly prisma: PrismaService) {}

  private async islem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, fn);
  }

  araclar(yalnizAktif: boolean) {
    return this.islem((tx) =>
      tx.arac.findMany({ where: yalnizAktif ? { aktif: true } : {}, orderBy: { plaka: "asc" }, select: ARAC_ALANLARI }),
    );
  }

  async aracOlustur(girdi: z.infer<typeof aracOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.islem((tx) => tx.arac.create({ data: { tenantId, ...girdi }, select: ARAC_ALANLARI }));
    } catch (hata) {
      // Aynı plaka iki kez açılırsa irsaliyede hangisinin seçileceği belirsizleşir.
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
        throw new ConflictException(`${girdi.plaka} plakalı araç zaten kayıtlı`);
      }
      throw hata;
    }
  }

  async aracGuncelle(id: string, girdi: z.infer<typeof aracGuncelleSemasi>) {
    return this.islem(async (tx) => {
      if (!(await tx.arac.findUnique({ where: { id } }))) throw new NotFoundException("Araç bulunamadı");
      return tx.arac.update({ where: { id }, data: girdi, select: ARAC_ALANLARI });
    });
  }

  async aracSil(id: string) {
    await this.islem(async (tx) => {
      if (!(await tx.arac.findUnique({ where: { id } }))) throw new NotFoundException("Araç bulunamadı");
      // Belgeler kartı referans almadığı için silmek geçmişi bozmaz.
      await tx.arac.delete({ where: { id } });
    });
  }

  soforler(yalnizAktif: boolean) {
    return this.islem((tx) =>
      tx.sofor.findMany({ where: yalnizAktif ? { aktif: true } : {}, orderBy: [{ ad: "asc" }, { soyad: "asc" }], select: SOFOR_ALANLARI }),
    );
  }

  async soforOlustur(girdi: z.infer<typeof soforOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.islem((tx) => tx.sofor.create({ data: { tenantId, ...girdi }, select: SOFOR_ALANLARI }));
  }

  async soforGuncelle(id: string, girdi: z.infer<typeof soforGuncelleSemasi>) {
    return this.islem(async (tx) => {
      if (!(await tx.sofor.findUnique({ where: { id } }))) throw new NotFoundException("Şoför bulunamadı");
      return tx.sofor.update({ where: { id }, data: girdi, select: SOFOR_ALANLARI });
    });
  }

  async soforSil(id: string) {
    await this.islem(async (tx) => {
      if (!(await tx.sofor.findUnique({ where: { id } }))) throw new NotFoundException("Şoför bulunamadı");
      await tx.sofor.delete({ where: { id } });
    });
  }
}
