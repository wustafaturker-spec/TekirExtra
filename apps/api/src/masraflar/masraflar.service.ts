import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { kategoriGuncelleSemasi, kategoriOlusturSemasi, kiraDonemOlusturSemasi, kiraSozlesmeGuncelleSemasi, kiraSozlesmeOlusturSemasi, masrafGuncelleSemasi, masrafOdemeSemasi, masrafOlusturSemasi } from "./masraflar.semalar";

const D = (deger: string | number | Prisma.Decimal) => new Prisma.Decimal(deger);
const VARSAYILAN_KATEGORILER = ["Kira", "Elektrik, Su ve Doğalgaz", "Telefon ve İnternet", "Akaryakıt ve Ulaşım", "Yemek", "Ofis ve Kırtasiye", "Yazılım ve Abonelikler", "Reklam ve Pazarlama", "Bakım ve Onarım", "Kargo", "Banka ve POS Komisyonları", "Personel Giderleri", "Vergi, Harç ve Sigorta", "Demirbaş", "Diğer"];

@Injectable()
export class MasraflarService {
  constructor(private readonly prisma: PrismaService) {}

  async kategoriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (await tx.masrafKategori.count() === 0) {
        await tx.masrafKategori.createMany({ data: VARSAYILAN_KATEGORILER.map((ad) => ({ tenantId, ad })) });
      }
      return tx.masrafKategori.findMany({ where: { aktif: true }, include: { ust: { select: { id: true, ad: true } }, _count: { select: { altlar: true, masraflar: true } } }, orderBy: [{ ustId: "asc" }, { ad: "asc" }] });
    });
  }

  async kategoriOlustur(girdi: z.infer<typeof kategoriOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        if (girdi.ustId) {
          const ust = await tx.masrafKategori.findUnique({ where: { id: girdi.ustId } });
          if (!ust) throw new BadRequestException("Üst kategori bulunamadı");
          if (ust.ustId) throw new BadRequestException("En fazla iki kategori seviyesi kullanılabilir");
        }
        return tx.masrafKategori.create({ data: { tenantId, ad: girdi.ad, ustId: girdi.ustId || null, varsayilanKdvOrani: girdi.varsayilanKdvOrani == null ? null : D(girdi.varsayilanKdvOrani), muhasebeKodu: girdi.muhasebeKodu || null } });
      });
    } catch (hata) {
      if (hata instanceof BadRequestException) throw hata;
      throw new BadRequestException("Bu isimde bir masraf kategorisi zaten var");
    }
  }

  async kategoriGuncelle(id: string, girdi: z.infer<typeof kategoriGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kategori = await tx.masrafKategori.findUnique({ where: { id }, include: { _count: { select: { altlar: true } } } });
      if (!kategori) throw new NotFoundException("Masraf kategorisi bulunamadı");
      const ustId = girdi.ustId === "" ? null : girdi.ustId;
      if (ustId) {
        if (ustId === id) throw new BadRequestException("Kategori kendisinin altına taşınamaz");
        if (kategori._count.altlar > 0) throw new BadRequestException("Alt kategorileri bulunan bir grup başka grubun altına taşınamaz");
        const ust = await tx.masrafKategori.findUnique({ where: { id: ustId } });
        if (!ust) throw new BadRequestException("Üst kategori bulunamadı");
        if (ust.ustId) throw new BadRequestException("En fazla iki kategori seviyesi kullanılabilir");
      }
      try {
        return await tx.masrafKategori.update({ where: { id }, data: { ...(girdi.ad !== undefined ? { ad: girdi.ad } : {}), ...(girdi.ustId !== undefined ? { ustId: ustId || null } : {}), ...(girdi.varsayilanKdvOrani !== undefined ? { varsayilanKdvOrani: girdi.varsayilanKdvOrani == null ? null : D(girdi.varsayilanKdvOrani) } : {}), ...(girdi.muhasebeKodu !== undefined ? { muhasebeKodu: girdi.muhasebeKodu || null } : {}) } });
      } catch (hata) {
        if (hata instanceof BadRequestException) throw hata;
        throw new BadRequestException("Kategori güncellenemedi; aynı isimde kategori olabilir");
      }
    });
  }

  async listele(sorgu: { baslangic?: string; bitis?: string; kategoriId?: string; durum?: string; odemeDurumu?: string }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.findMany({
      where: {
        ...(sorgu.baslangic || sorgu.bitis ? { tarih: { ...(sorgu.baslangic ? { gte: new Date(sorgu.baslangic) } : {}), ...(sorgu.bitis ? { lte: new Date(sorgu.bitis) } : {}) } } : {}),
        ...(sorgu.kategoriId ? { kategoriId: sorgu.kategoriId } : {}),
        ...(sorgu.durum ? { durum: sorgu.durum as never } : {}),
        ...(sorgu.odemeDurumu ? { odemeDurumu: sorgu.odemeDurumu as never } : {}),
      },
      include: { kategori: true, cari: { select: { id: true, unvan: true } }, kasa: { select: { id: true, ad: true } }, bankaHesap: { select: { id: true, ad: true } }, odemeler: { include: { kasa: { select: { id: true, ad: true } }, bankaHesap: { select: { id: true, ad: true } } }, orderBy: [{ odemeTarihi: "desc" }, { createdAt: "desc" }] } },
      orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
    }));
  }

  async getir(id: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.findUnique({ where: { id }, include: { kategori: true, cari: { select: { id: true, unvan: true } }, kasa: true, bankaHesap: true, odemeler: { include: { kasa: { select: { id: true, ad: true } }, bankaHesap: { select: { id: true, ad: true } } }, orderBy: [{ odemeTarihi: "desc" }, { createdAt: "desc" }] } } }));
    if (!kayit) throw new NotFoundException("Masraf bulunamadı");
    return kayit;
  }

  private veri(girdi: z.infer<typeof masrafOlusturSemasi>) {
    return { ...girdi, cariId: girdi.cariId || null, belgeNo: girdi.belgeNo || null, saticiUnvan: girdi.saticiUnvan || null, vknTckn: girdi.vknTckn || null, vergiDairesi: girdi.vergiDairesi || null, iban: girdi.iban || null, aciklama: girdi.aciklama || null, matrah: D(girdi.matrah), kdvOrani: D(girdi.kdvOrani), kdvTutari: D(girdi.kdvTutari), toplam: D(girdi.toplam), stopajOrani: girdi.stopajOrani == null ? null : D(girdi.stopajOrani), stopajTutari: girdi.stopajTutari == null ? null : D(girdi.stopajTutari) };
  }

  async olustur(girdi: z.infer<typeof masrafOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await tx.masrafKategori.findUnique({ where: { id: girdi.kategoriId } }))) throw new BadRequestException("Masraf kategorisi bulunamadı");
      if (girdi.cariId && !(await tx.cariHesap.findUnique({ where: { id: girdi.cariId } }))) throw new BadRequestException("Cari hesap bulunamadı");
      return tx.masraf.create({ data: { tenantId, ...this.veri(girdi) }, include: { kategori: true, cari: { select: { id: true, unvan: true } } } });
    });
  }

  async guncelle(id: string, girdi: z.infer<typeof masrafGuncelleSemasi>) {
    const mevcut = await this.getir(id);
    if (mevcut.durum !== "taslak") throw new BadRequestException("Yalnızca taslak masraf düzenlenebilir");
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.update({ where: { id }, data: this.veri(girdi) }));
  }

  async onayla(id: string) {
    const mevcut = await this.getir(id);
    if (mevcut.durum !== "taslak") throw new BadRequestException("Yalnızca taslak masraf onaylanabilir");
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.update({ where: { id }, data: { durum: "onaylandi" } }));
  }

  async ode(id: string, girdi: z.infer<typeof masrafOdemeSemasi>) {
    const mevcut = await this.getir(id);
    if (mevcut.durum !== "onaylandi") throw new BadRequestException("Masraf ödeme öncesinde onaylanmalıdır");
    if (mevcut.odemeDurumu === "odendi") throw new BadRequestException("Masraf zaten ödenmiş");
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hesap = girdi.kasaId ? await tx.kasa.findUnique({ where: { id: girdi.kasaId } }) : await tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId! } });
      if (!hesap) throw new BadRequestException("Ödeme hesabı bulunamadı");
      if (hesap.dovizCinsi !== mevcut.dovizCinsi) throw new BadRequestException("Masraf ve ödeme hesabı para birimleri aynı olmalıdır");
      const netTutar = mevcut.toplam.sub(mevcut.stopajTutari ?? D(0));
      const kalanTutar = netTutar.sub(mevcut.odenenTutar);
      const odenecekTutar = D(girdi.tutar);
      if (kalanTutar.lte(0)) throw new BadRequestException("Masrafın kalan ödemesi bulunmuyor");
      if (odenecekTutar.gt(kalanTutar)) throw new BadRequestException(`Ödeme tutarı kalan ${kalanTutar.toFixed(2)} ${mevcut.dovizCinsi} tutarını aşamaz`);
      const aciklama = girdi.aciklama || `${mevcut.saticiUnvan ?? mevcut.cari?.unvan ?? "Masraf"} ödemesi`;
      const hareket = await tx.kasaBankaHareket.create({ data: { tenantId, kasaId: girdi.kasaId || null, bankaHesapId: girdi.bankaHesapId || null, tip: "tediye", tutar: odenecekTutar, dovizCinsi: mevcut.dovizCinsi, kur: D(1), tutarTry: odenecekTutar, tarih: girdi.odemeTarihi, aciklama, cariId: mevcut.cariId, kaynakTur: "masraf", kaynakRef: mevcut.id } });
      if (mevcut.cariId) await tx.cariHareket.create({ data: { tenantId, cariId: mevcut.cariId, tip: "borc", tutar: odenecekTutar, dovizCinsi: mevcut.dovizCinsi, kur: D(1), tutarTry: odenecekTutar, tarih: girdi.odemeTarihi, aciklama: "Masraf ödemesi", kaynakTur: "masraf", kaynakRef: mevcut.id } });
      await tx.masrafOdeme.create({ data: { tenantId, masrafId: mevcut.id, kasaId: girdi.kasaId || null, bankaHesapId: girdi.bankaHesapId || null, hareketId: hareket.id, tutar: odenecekTutar, odemeTarihi: girdi.odemeTarihi, aciklama: girdi.aciklama || null } });
      const yeniOdenen = mevcut.odenenTutar.add(odenecekTutar);
      const tamamenOdendi = yeniOdenen.gte(netTutar);
      return tx.masraf.update({ where: { id }, data: { odenenTutar: yeniOdenen, odemeDurumu: tamamenOdendi ? "odendi" : "kismi_odendi", odemeTarihi: girdi.odemeTarihi, kasaId: girdi.kasaId || null, bankaHesapId: girdi.bankaHesapId || null, ...(mevcut.hareketId ? {} : { hareketId: hareket.id }) }, include: { odemeler: true } });
    });
  }

  async iptal(id: string) {
    const mevcut = await this.getir(id);
    if (mevcut.odemeDurumu !== "odenmedi") throw new BadRequestException("Ödeme alınmış masraf iptal edilemez");
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.masraf.update({ where: { id }, data: { durum: "iptal" } }));
  }

  async kiraSozlesmeListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.kiraSozlesme.findMany({ include: { kategori: true, cari: { select: { id: true, unvan: true } }, masraflar: { select: { id: true, kiraDonemi: true, durum: true, odemeDurumu: true, toplam: true, stopajTutari: true, odenenTutar: true }, orderBy: { kiraDonemi: "desc" } }, _count: { select: { masraflar: true } } }, orderBy: [{ aktif: "desc" }, { baslik: "asc" }] }));
  }

  async kiraSozlesmeOlustur(girdi: z.infer<typeof kiraSozlesmeOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await tx.masrafKategori.findUnique({ where: { id: girdi.kategoriId } }))) throw new BadRequestException("Masraf kategorisi bulunamadı");
      if (girdi.cariId && !(await tx.cariHesap.findUnique({ where: { id: girdi.cariId } }))) throw new BadRequestException("Cari hesap bulunamadı");
      return tx.kiraSozlesme.create({ data: { tenantId, ...girdi, cariId: girdi.cariId || null, tasinmazAdresi: girdi.tasinmazAdresi || null, kirayaVeren: girdi.kirayaVeren || null, vknTckn: girdi.vknTckn || null, iban: girdi.iban || null, matrah: D(girdi.matrah), kdvOrani: D(girdi.kdvOrani), stopajOrani: D(girdi.stopajOrani) } });
    });
  }

  async kiraSozlesmeGuncelle(id: string, girdi: z.infer<typeof kiraSozlesmeGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (!(await tx.kiraSozlesme.findUnique({ where: { id } }))) throw new NotFoundException("Kira sözleşmesi bulunamadı");
      if (!(await tx.masrafKategori.findUnique({ where: { id: girdi.kategoriId } }))) throw new BadRequestException("Masraf kategorisi bulunamadı");
      if (girdi.cariId && !(await tx.cariHesap.findUnique({ where: { id: girdi.cariId } }))) throw new BadRequestException("Cari hesap bulunamadı");
      return tx.kiraSozlesme.update({ where: { id }, data: { ...girdi, cariId: girdi.cariId || null, tasinmazAdresi: girdi.tasinmazAdresi || null, kirayaVeren: girdi.kirayaVeren || null, vknTckn: girdi.vknTckn || null, iban: girdi.iban || null, matrah: D(girdi.matrah), kdvOrani: D(girdi.kdvOrani), stopajOrani: D(girdi.stopajOrani) } });
    });
  }

  async kiraSozlesmeSil(id: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayit = await tx.kiraSozlesme.findUnique({ where: { id }, include: { _count: { select: { masraflar: true } } } });
      if (!kayit) throw new NotFoundException("Kira sözleşmesi bulunamadı");
      if (kayit._count.masraflar > 0) throw new BadRequestException("Dönem kaydı bulunan sözleşme silinemez; pasife alabilirsiniz");
      if (await tx.ek.count({ where: { sahipTur: "kira_sozlesme", sahipId: id } })) throw new BadRequestException("Sözleşmeyi silmeden önce bağlı dosyaları kaldırın");
      return tx.kiraSozlesme.delete({ where: { id } });
    });
  }

  async kiraSozlesmeAktiflik(id: string, aktif: boolean) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.kiraSozlesme.findUnique({ where: { id } }));
    if (!kayit) throw new NotFoundException("Kira sözleşmesi bulunamadı");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.kiraSozlesme.update({ where: { id }, data: { aktif } }));
  }

  async kiraDonemiOlustur(id: string, girdi: z.infer<typeof kiraDonemOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sozlesme = await tx.kiraSozlesme.findUnique({ where: { id }, include: { cari: { select: { unvan: true } } } });
      if (!sozlesme) throw new NotFoundException("Kira sözleşmesi bulunamadı");
      if (!sozlesme.aktif) throw new BadRequestException("Pasif sözleşmeden dönem oluşturulamaz");
      const [yil, ay] = girdi.donem.split("-").map(Number);
      const donem = new Date(Date.UTC(yil, ay - 1, 1));
      const aySonu = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
      const vade = new Date(Date.UTC(yil, ay - 1, Math.min(sozlesme.odemeGunu, aySonu)));
      const baslangic = new Date(Date.UTC(sozlesme.baslangicTarihi.getUTCFullYear(), sozlesme.baslangicTarihi.getUTCMonth(), 1));
      const bitis = sozlesme.bitisTarihi ? new Date(Date.UTC(sozlesme.bitisTarihi.getUTCFullYear(), sozlesme.bitisTarihi.getUTCMonth(), 1)) : null;
      if (donem < baslangic || (bitis && donem > bitis)) throw new BadRequestException("Seçilen dönem sözleşme tarihleri dışında");
      const kdvTutari = sozlesme.matrah.mul(sozlesme.kdvOrani).div(100).toDecimalPlaces(2);
      const stopajTutari = sozlesme.matrah.mul(sozlesme.stopajOrani).div(100).toDecimalPlaces(2);
      try {
        return await tx.masraf.create({ data: { tenantId, kategoriId: sozlesme.kategoriId, cariId: sozlesme.cariId, belgeTuru: "kira", tarih: donem, vadeTarihi: vade, saticiUnvan: sozlesme.kirayaVeren || sozlesme.cari?.unvan, vknTckn: sozlesme.vknTckn, iban: sozlesme.iban, aciklama: `${sozlesme.baslik} - ${girdi.donem} kira dönemi`, matrah: sozlesme.matrah, kdvOrani: sozlesme.kdvOrani, kdvTutari, toplam: sozlesme.matrah.add(kdvTutari), dovizCinsi: sozlesme.dovizCinsi, stopajOrani: sozlesme.stopajOrani, stopajTutari, kiraSozlesmeId: sozlesme.id, kiraDonemi: donem } });
      } catch (hata) {
        if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") throw new BadRequestException("Bu sözleşme için seçilen kira dönemi zaten oluşturulmuş");
        throw hata;
      }
    });
  }
}
