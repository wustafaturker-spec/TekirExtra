import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../core/prisma.service";
import { departmanOlusturSemasi, isyeriOlusturSemasi, personelOrganizasyonAtaSemasi, pozisyonOlusturSemasi } from "./organizasyon.semalar";

@Injectable()
export class OrganizasyonService {
  constructor(private readonly prisma: PrismaService) {}
  async agac(tenantId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sayi = await tx.personelIsyeri.count({ where: { tenantId } });
      if (!sayi) await tx.personelIsyeri.create({ data: { tenantId, kod: "merkez", ad: "Merkez İşyeri" } });
      return tx.personelIsyeri.findMany({ where: { tenantId, aktif: true }, include: { departmanlar: { where: { aktif: true }, include: { pozisyonlar: { where: { aktif: true }, orderBy: { ad: "asc" } }, _count: { select: { personeller: true } } }, orderBy: { ad: "asc" } }, _count: { select: { personeller: true } } }, orderBy: { ad: "asc" } });
    });
  }
  async isyeriOlustur(tenantId: string, girdi: z.infer<typeof isyeriOlusturSemasi>) { const v = isyeriOlusturSemasi.parse(girdi); return this.prisma.tenantIslem(tenantId, (tx) => tx.personelIsyeri.create({ data: { tenantId, ...v, adres: v.adres || null } })); }
  async departmanOlustur(tenantId: string, girdi: z.infer<typeof departmanOlusturSemasi>) { const v = departmanOlusturSemasi.parse(girdi); return this.prisma.tenantIslem(tenantId, async (tx) => { const isyeri = await tx.personelIsyeri.findFirst({ where: { id: v.isyeriId, tenantId, aktif: true } }); if (!isyeri) throw new NotFoundException("İşyeri bulunamadı"); if (v.ustDepartmanId && !await tx.personelDepartman.findFirst({ where: { id: v.ustDepartmanId, tenantId, isyeriId: v.isyeriId } })) throw new BadRequestException("Üst departman aynı işyerinde olmalıdır"); return tx.personelDepartman.create({ data: { tenantId, ...v, ustDepartmanId: v.ustDepartmanId || null } }); }); }
  async pozisyonOlustur(tenantId: string, girdi: z.infer<typeof pozisyonOlusturSemasi>) { const v = pozisyonOlusturSemasi.parse(girdi); return this.prisma.tenantIslem(tenantId, async (tx) => { if (v.departmanId && !await tx.personelDepartman.findFirst({ where: { id: v.departmanId, tenantId, aktif: true } })) throw new NotFoundException("Departman bulunamadı"); return tx.personelPozisyon.create({ data: { tenantId, ...v, departmanId: v.departmanId || null } }); }); }
  async personelAta(tenantId: string, personelId: string, girdi: z.infer<typeof personelOrganizasyonAtaSemasi>) {
    const v = personelOrganizasyonAtaSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [personel, isyeri, departman, pozisyon] = await Promise.all([
        tx.personel.findFirst({ where: { id: personelId, tenantId } }), tx.personelIsyeri.findFirst({ where: { id: v.isyeriId, tenantId, aktif: true } }),
        v.departmanId ? tx.personelDepartman.findFirst({ where: { id: v.departmanId, tenantId, isyeriId: v.isyeriId, aktif: true } }) : null,
        v.pozisyonId ? tx.personelPozisyon.findFirst({ where: { id: v.pozisyonId, tenantId, aktif: true } }) : null,
      ]);
      if (!personel || !isyeri) throw new NotFoundException("Personel veya işyeri bulunamadı");
      if (v.departmanId && !departman) throw new BadRequestException("Departman seçilen işyerine ait değildir");
      if (pozisyon?.departmanId && pozisyon.departmanId !== v.departmanId) throw new BadRequestException("Pozisyon seçilen departmana ait değildir");
      if (v.yoneticiId) await this.yoneticiDongusuKontrol(tx, tenantId, personelId, v.yoneticiId);
      return tx.personel.update({ where: { id: personelId }, data: { isyeriId: v.isyeriId, departmanId: v.departmanId || null, pozisyonId: v.pozisyonId || null, yoneticiId: v.yoneticiId || null, departman: departman?.ad || null, unvan: pozisyon?.ad || null }, include: { isyeri: true, departmanKaydi: true, pozisyon: true, yonetici: { select: { id: true, ad: true, soyad: true } } } });
    });
  }
  private async yoneticiDongusuKontrol(tx: Parameters<Parameters<PrismaService["tenantIslem"]>[1]>[0], tenantId: string, personelId: string, yoneticiId: string) {
    if (personelId === yoneticiId) throw new BadRequestException("Personel kendi yöneticisi olamaz");
    let mevcut: string | null = yoneticiId;
    const gorulen = new Set<string>();
    for (let i = 0; mevcut && i < 100; i++) {
      if (mevcut === personelId) throw new BadRequestException("Yönetici ataması organizasyon döngüsü oluşturuyor");
      if (gorulen.has(mevcut)) throw new BadRequestException("Mevcut organizasyon hiyerarşisinde döngü var");
      gorulen.add(mevcut);
      const kayit: { yoneticiId: string | null } | null = await tx.personel.findFirst({ where: { id: mevcut, tenantId }, select: { yoneticiId: true } });
      if (!kayit) throw new NotFoundException("Yönetici bulunamadı");
      mevcut = kayit.yoneticiId;
    }
    if (mevcut) throw new BadRequestException("Yönetici hiyerarşisi izin verilen derinliği aşıyor");
  }
}
