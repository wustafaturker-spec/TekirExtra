import { BadRequestException, Injectable } from "@nestjs/common";
import { BORDRO_ANAHTARI } from "@tekirextra/shared";
import { PrismaService } from "../core/prisma.service";
import { bordroHesapla } from "./bordro-hesaplama";
import { donemBordroMevzuati, mevzuatYokMesaji } from "./bordro-mevzuati";

const gun = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Personel > Mevzuat (MVZ-14): bordro parametreleri Mevzuat Merkezi'nden salt
 * okunur gelir; kiracı set oluşturmaz, etkinleştirmez. Kabul senaryoları yayından
 * önce platformda çalıştırılır. Tablolar kiracıya ait olmadığı için RLS bağlamı gerekmez.
 */
@Injectable()
export class MevzuatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Geçmiş dahil bütün bordro parametresi kayıtları, dayanaklarıyla (en yeni önce). */
  async listele() {
    const kayitlar = await this.prisma.mevzuatKayit.findMany({
      where: { tur: "bordro_parametreleri", anahtar: BORDRO_ANAHTARI },
      orderBy: { yururlukBaslangic: "desc" },
      include: { degisiklik: { select: { no: true, baslik: true, dayanak: true } } },
    });
    return kayitlar.map((k) => ({ id: k.id, deger: k.deger, yururlukBaslangic: gun(k.yururlukBaslangic), yururlukBitis: gun(k.yururlukBitis), degisiklik: k.degisiklik }));
  }

  async donemeUygun(yil: number, ay: number) {
    const m = await donemBordroMevzuati(this.prisma, yil, ay);
    return m ? { id: m.id, yururlukBaslangic: gun(m.yururlukBaslangic), yururlukBitis: gun(m.yururlukBitis) } : null;
  }

  async hesapla(girdi: Parameters<typeof bordroHesapla>[1] & { yil: number; ay: number }) {
    const m = await donemBordroMevzuati(this.prisma, girdi.yil, girdi.ay);
    if (!m) throw new BadRequestException(mevzuatYokMesaji(girdi.yil));
    return {
      mevzuat: { id: m.id, yururlukBaslangic: gun(m.yururlukBaslangic), yururlukBitis: gun(m.yururlukBitis) },
      sonuc: bordroHesapla(m.parametreler, girdi),
      uyari: "Ön hesaplamadır; bordro tahakkuku puantaj, ücret geçmişi ve kümülatif matrahla ayrıca hesaplanır.",
    };
  }
}
