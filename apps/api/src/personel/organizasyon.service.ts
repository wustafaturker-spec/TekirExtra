import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod"

import type { Prisma } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import { departmanGuncelleSemasi, departmanOlusturSemasi, isyeriGuncelleSemasi, isyeriOlusturSemasi, personelOrganizasyonAtaSemasi, pozisyonGuncelleSemasi, pozisyonOlusturSemasi } from "./organizasyon.semalar";

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
  async isyeriOlustur(tenantId: string, girdi: z.infer<typeof isyeriOlusturSemasi>) { const v = isyeriOlusturSemasi.parse(girdi); return this.prisma.tenantIslem(tenantId, (tx) => tx.personelIsyeri.create({ data: { tenantId, ...v, adres: v.adres || null, sgkSicilNo: v.sgkSicilNo || null, csgbIsKolu: v.csgbIsKolu ?? null } })); }
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

  /** Etkin (işten ayrılmamış) personeli olan birim pasife alınamaz. */
  private async aktifPersonelVarsaEngelle(tx: Prisma.TransactionClient, kosul: Prisma.PersonelWhereInput, ad: string) {
    const sayi = await tx.personel.count({ where: { ...kosul, durum: { not: "isten_ayrildi" } } })
    if (sayi) throw new BadRequestException(`${ad} biriminde ${sayi} etkin personel var; önce onları başka birime atayın`)
  }

  async isyeriGuncelle(tenantId: string, id: string, girdi: z.infer<typeof isyeriGuncelleSemasi>) {
    const v = isyeriGuncelleSemasi.parse(girdi)
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const isyeri = await tx.personelIsyeri.findFirst({ where: { id, tenantId } })
      if (!isyeri) throw new NotFoundException("İşyeri bulunamadı")
      if (v.aktif === false) {
        await this.aktifPersonelVarsaEngelle(tx, { tenantId, isyeriId: id }, isyeri.ad)
        if (await tx.personelIsyeri.count({ where: { tenantId, aktif: true, id: { not: id } } }) === 0) throw new BadRequestException("En az bir etkin işyeri kalmalıdır")
      }
      return tx.personelIsyeri.update({ where: { id }, data: { ...(v.ad && { ad: v.ad }), ...(v.adres !== undefined && { adres: v.adres || null }), ...(v.sgkSicilNo !== undefined && { sgkSicilNo: v.sgkSicilNo || null }), ...(v.csgbIsKolu !== undefined && { csgbIsKolu: v.csgbIsKolu }), ...(v.aktif !== undefined && { aktif: v.aktif }) } })
    })
  }

  async departmanGuncelle(tenantId: string, id: string, girdi: z.infer<typeof departmanGuncelleSemasi>) {
    const v = departmanGuncelleSemasi.parse(girdi)
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const d = await tx.personelDepartman.findFirst({ where: { id, tenantId } })
      if (!d) throw new NotFoundException("Departman bulunamadı")
      if (v.ustDepartmanId) {
        if (v.ustDepartmanId === id) throw new BadRequestException("Departman kendi üst departmanı olamaz")
        const ust = await tx.personelDepartman.findFirst({ where: { id: v.ustDepartmanId, tenantId, isyeriId: d.isyeriId } })
        if (!ust) throw new BadRequestException("Üst departman aynı işyerinde olmalıdır")
        // Döngü: önerilen üstün atalarında bu departman olmamalı.
        let ata: string | null = ust.ustDepartmanId
        for (let i = 0; ata && i < 50; i += 1) {
          if (ata === id) throw new BadRequestException("Departman ağacında döngü oluşur")
          ata = (await tx.personelDepartman.findUnique({ where: { id: ata }, select: { ustDepartmanId: true } }))?.ustDepartmanId ?? null
        }
      }
      if (v.aktif === false) {
        await this.aktifPersonelVarsaEngelle(tx, { tenantId, departmanId: id }, d.ad)
        if (await tx.personelDepartman.count({ where: { tenantId, ustDepartmanId: id, aktif: true } })) throw new BadRequestException(`${d.ad} altında etkin departman var; önce onları pasife alın`)
      }
      return tx.personelDepartman.update({ where: { id }, data: { ...(v.ad && { ad: v.ad }), ...(v.ustDepartmanId !== undefined && { ustDepartmanId: v.ustDepartmanId || null }), ...(v.aktif !== undefined && { aktif: v.aktif }) } })
    })
  }

  async pozisyonGuncelle(tenantId: string, id: string, girdi: z.infer<typeof pozisyonGuncelleSemasi>) {
    const v = pozisyonGuncelleSemasi.parse(girdi)
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const p = await tx.personelPozisyon.findFirst({ where: { id, tenantId } })
      if (!p) throw new NotFoundException("Pozisyon bulunamadı")
      if (v.departmanId && !await tx.personelDepartman.findFirst({ where: { id: v.departmanId, tenantId, aktif: true } })) throw new NotFoundException("Departman bulunamadı")
      if (v.aktif === false) await this.aktifPersonelVarsaEngelle(tx, { tenantId, pozisyonId: id }, p.ad)
      const guncel = await tx.personelPozisyon.update({ where: { id }, data: { ...(v.ad && { ad: v.ad }), ...(v.departmanId !== undefined && { departmanId: v.departmanId || null }), ...(v.aktif !== undefined && { aktif: v.aktif }) } })
      // Kartlardaki unvan metni pozisyon adının kopyasıdır.
      if (v.ad) await tx.personel.updateMany({ where: { tenantId, pozisyonId: id }, data: { unvan: v.ad } })
      return guncel
    })
  }
}
