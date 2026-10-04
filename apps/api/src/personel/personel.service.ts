import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { 
  personelOlusturSemasi, 
  personelGuncelleSemasi, 
  bordroTahakkukSemasi, 
  bordroOdeSemasi, 
  avansOlusturSemasi 
} from "./personel.semalar";
import { personelIstenCikarSemasi, personelYenidenBaslatSemasi } from "./personel.semalar";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { bordroKalemOlusturSemasi } from "./personel.semalar";
import { avansMahsupSemasi, avansOdeSemasi } from "./personel.semalar";
import { hassasCoz, hassasSifrele, personelMaskele } from "./personel-hassas";
import { bordroHesapla } from "./bordro-hesaplama";
import { hesapOzetiTutari } from "./personel-rapor-yardimci";
import { donemCalismaSemasi } from "./personel.semalar";
import { sgkDevirleriniDonemeTasi, type SgkMatrahDevirKalemi } from "./sgk-matrah-devri";

const PERSONEL_GUVENLI_SECIM = { id: true, personelNo: true, ad: true, soyad: true, departman: true, unvan: true, calismaTipi: true, durum: true, netMaas: true, brutMaas: true, engellilikDerecesi: true, sgkTesvikOrani: true, cariId: true } as const;

function hesapOzetindenSgkDevirleri(ozet: Prisma.JsonValue | null, kaynakYil: number, kaynakAy: number, hedefYil: number, hedefAy: number) {
  if (!ozet || typeof ozet !== "object" || Array.isArray(ozet)) return [];
  const ham = (ozet as Record<string, Prisma.JsonValue>).sgkMatrahDevirleri;
  if (!Array.isArray(ham)) return [];
  const devirler = ham.flatMap((kalem): SgkMatrahDevirKalemi[] => {
    if (!kalem || typeof kalem !== "object" || Array.isArray(kalem)) return [];
    const kayit = kalem as Record<string, Prisma.JsonValue>;
    const tutar = kayit.tutar;
    const kalanAy = kayit.kalanAy;
    return (typeof tutar === "string" || typeof tutar === "number") && (kalanAy === 1 || kalanAy === 2)
      ? [{ tutar, kalanAy }]
      : [];
  });
  return sgkDevirleriniDonemeTasi(devirler, kaynakYil, kaynakAy, hedefYil, hedefAy);
}

@Injectable()
export class PersonelService {
  constructor(private readonly prisma: PrismaService) {}

  async listele(tenantId: string, arama?: string) {
    const personeller = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.personel.findMany({
        where: {
          tenantId,
          ...(arama ? {
            OR: [
              { ad: { contains: arama, mode: "insensitive" } },
              { soyad: { contains: arama, mode: "insensitive" } },
              { departman: { contains: arama, mode: "insensitive" } },
            ]
          } : {})
        },
        include: { cari: true },
        orderBy: { ad: "asc" }
      })
    );
    return personeller.map(personelMaskele);
  }

  async getir(tenantId: string, id: string) {
    const personel = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.personel.findFirst({
        where: { id, tenantId },
        include: {
          cari: true,
          bordrolar: { orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }] },
          avanslar: { orderBy: { tarih: "desc" } },
          istihdamDonemleri: { orderBy: { baslangicTarihi: "desc" } },
        }
      })
    );
    if (!personel) throw new NotFoundException("Personel bulunamadı");
    return personelMaskele(personel);
  }

  async bordroListele(tenantId: string, donemYil?: number, donemAy?: number) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findMany({
      where: {
        tenantId,
        ...(donemYil ? { donemYil } : {}),
        ...(donemAy ? { donemAy } : {}),
      },
      include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } } },
      orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }, { personel: { ad: "asc" } }],
    }));
  }

  async donemCalismaListele(tenantId: string, yil: number, ay: number) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personel.findMany({ where: { tenantId, durum: "aktif" }, select: { id: true, personelNo: true, ad: true, soyad: true, sgkTesvikOrani: true, donemCalismalari: { where: { yil, ay }, take: 1 } }, orderBy: { ad: "asc" } }));
  }

  async donemCalismaKaydet(tenantId: string, girdi: z.infer<typeof donemCalismaSemasi>) {
    const v = donemCalismaSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({ where: { id: v.personelId, tenantId, durum: "aktif" }, select: { id: true } });
      if (!personel) throw new NotFoundException("Aktif personel bulunamadı");
      const bordro = await tx.personelBordro.findUnique({ where: { tenantId_personelId_donemYil_donemAy: { tenantId, personelId: v.personelId, donemYil: v.yil, donemAy: v.ay } }, select: { id: true } });
      if (bordro) throw new BadRequestException("Tahakkuk oluşturulduktan sonra çalışma günü değiştirilemez");
      return tx.personelDonemCalisma.upsert({ where: { tenantId_personelId_yil_ay: { tenantId, personelId: v.personelId, yil: v.yil, ay: v.ay } }, create: { tenantId, ...v }, update: { primGunu: v.primGunu, eksikGunNedeni: v.eksikGunNedeni ?? null, aciklama: v.aciklama ?? null, sgkTesvikOrani: v.sgkTesvikOrani ?? null, sahisSigortaPrimi:v.sahisSigortaPrimi, hayatSigortaPrimi:v.hayatSigortaPrimi, sendikaAidati:v.sendikaAidati, fazlaMesaiBrut:v.fazlaMesaiBrut, primIkramiyeBrut:v.primIkramiyeBrut, nakitYemekYardimi:v.nakitYemekYardimi, fiiliCalismaGunu:v.fiiliCalismaGunu } });
    });
  }

  async bordroGetir(tenantId: string, id: string) {
    const bordro = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.findFirst({
      where: { id, tenantId },
      include: {
        personel: { select: PERSONEL_GUVENLI_SECIM },
        kalemler: { orderBy: [{ tip: "asc" }, { createdAt: "asc" }] },
        odemeler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] },
        mevzuatSeti: { select: { id: true, surum: true, ad: true, yururlukBaslangic: true, yururlukBitis: true } },
      },
    }));
    if (!bordro) throw new NotFoundException("Bordro bulunamadı");
    return bordro;
  }

  async olustur(tenantId: string, girdi: z.infer<typeof personelOlusturSemasi>) {
    const veri = personelOlusturSemasi.parse(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      let cariId: string | undefined = undefined;
      const sayac = await tx.personelSayac.upsert({
        where: { tenantId },
        create: { tenantId, sonSira: 1 },
        update: { sonSira: { increment: 1 } },
      });
      const personelNo = `PRS-${String(sayac.sonSira).padStart(6, "0")}`;

      if (veri.cariOlustur) {
        const yeniCari = await tx.cariHesap.create({
          data: {
            tenantId,
            kod: personelNo,
            unvan: `${veri.ad} ${veri.soyad}`,
            tip: "personel",
            kisiTipi: "gercek",
            ad: veri.ad,
            soyad: veri.soyad,
            eposta: veri.eposta || null,
            telefon: veri.telefon || null,
            iban: veri.iban || null,
            vknTckn: veri.tckn || null,
          }
        });
        cariId = yeniCari.id;
      }

      const personel = await tx.personel.create({
        data: {
          tenantId,
          personelNo,
          ad: veri.ad,
          soyad: veri.soyad,
          tckn: hassasSifrele(veri.tckn),
          eposta: veri.eposta || null,
          telefon: veri.telefon || null,
          departman: veri.departman || null,
          unvan: veri.unvan || null,
          calismaTipi: veri.calismaTipi,
          girisTarihi: veri.girisTarihi,
          cikisTarihi: veri.cikisTarihi || null,
          netMaas: veri.netMaas,
          brutMaas: veri.brutMaas ?? null,
          engellilikDerecesi: veri.engellilikDerecesi ?? null,
          sgkTesvikOrani: veri.sgkTesvikOrani,
          iban: hassasSifrele(veri.iban),
          cariId: cariId || null,
          istihdamDonemleri: {
            create: { tenantId, baslangicTarihi: veri.girisTarihi },
          },
        },
        include: { cari: true }
      });
      return personelMaskele(personel);
    });
  }

  async istenCikar(tenantId: string, id: string, girdi: z.infer<typeof personelIstenCikarSemasi>) {
    const veri = personelIstenCikarSemasi.parse(girdi);
    const personel = await this.getir(tenantId, id);
    if (personel.durum === "isten_ayrildi") {
      throw new BadRequestException("Personel zaten işten ayrılmıştır");
    }
    if (veri.cikisTarihi < personel.girisTarihi) {
      throw new BadRequestException("Çıkış tarihi işe giriş tarihinden önce olamaz");
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.personelIstihdamDonemi.updateMany({
        where: { tenantId, personelId: id, bitisTarihi: null },
        data: { bitisTarihi: veri.cikisTarihi, ayrilisNedeni: veri.ayrilisNedeni },
      });
      const personel = await tx.personel.update({
        where: { id },
        data: { durum: "isten_ayrildi", aktif: false, cikisTarihi: veri.cikisTarihi, ayrilisNedeni: veri.ayrilisNedeni },
        include: { cari: true },
      });
      return personelMaskele(personel);
    });
  }

  async yenidenBaslat(tenantId: string, id: string, girdi: z.infer<typeof personelYenidenBaslatSemasi>) {
    const veri = personelYenidenBaslatSemasi.parse(girdi);
    const personel = await this.getir(tenantId, id);
    if (personel.durum !== "isten_ayrildi") {
      throw new BadRequestException("Yalnızca işten ayrılmış personel yeniden başlatılabilir");
    }
    if (personel.cikisTarihi && veri.girisTarihi <= personel.cikisTarihi) {
      throw new BadRequestException("Yeni işe giriş tarihi önceki çıkış tarihinden sonra olmalıdır");
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.personelIstihdamDonemi.create({
        data: { tenantId, personelId: id, baslangicTarihi: veri.girisTarihi },
      });
      const personel = await tx.personel.update({
        where: { id },
        data: { durum: "aktif", aktif: true, girisTarihi: veri.girisTarihi, cikisTarihi: null, ayrilisNedeni: null },
        include: { cari: true },
      });
      return personelMaskele(personel);
    });
  }

  /**
   * P0-6: kart düzenleme. Bağlı cari (ad, iletişim, IBAN, TCKN) eşitlenir; işe
   * giriş tarihi açık istihdam dönemine de yazılır; değişen alanlar denetim
   * kaydına geçer (TCKN/IBAN değerleri yazılmaz, yalnız değiştiği; ücretin eski
   * ve yeni değeri yazılır). Ücret değişikliği sonraki tahakkuklarda geçerlidir.
   */
  async guncelle(tenantId: string, id: string, girdi: z.infer<typeof personelGuncelleSemasi>, userId?: string) {
    const veri = personelGuncelleSemasi.parse(girdi);

    const personel = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.personel.findFirst({ where: { id, tenantId } });
      if (!mevcut) throw new NotFoundException("Personel bulunamadı");
      if (veri.girisTarihi && mevcut.cikisTarihi && veri.girisTarihi > mevcut.cikisTarihi) throw new BadRequestException("İşe giriş tarihi çıkış tarihinden sonra olamaz");
      const tckn = veri.tckn !== undefined ? hassasSifrele(veri.tckn) : undefined;
      const iban = veri.iban !== undefined ? hassasSifrele(veri.iban) : undefined;
      const guncel = await tx.personel.update({
        where: { id },
        data: {
          ...(veri.ad && { ad: veri.ad }),
          ...(veri.soyad && { soyad: veri.soyad }),
          ...(tckn !== undefined && { tckn }),
          ...(veri.eposta !== undefined && { eposta: veri.eposta || null }),
          ...(veri.telefon !== undefined && { telefon: veri.telefon || null }),
          ...(veri.departman !== undefined && { departman: veri.departman || null }),
          ...(veri.unvan !== undefined && { unvan: veri.unvan || null }),
          ...(veri.calismaTipi && { calismaTipi: veri.calismaTipi }),
          ...(veri.girisTarihi && { girisTarihi: veri.girisTarihi }),
          ...(veri.cikisTarihi !== undefined && { cikisTarihi: veri.cikisTarihi || null }),
          ...(veri.netMaas && { netMaas: veri.netMaas }),
          ...(veri.brutMaas !== undefined && { brutMaas: veri.brutMaas }),
          ...(veri.engellilikDerecesi !== undefined && { engellilikDerecesi: veri.engellilikDerecesi }),
          ...(veri.sgkTesvikOrani !== undefined && { sgkTesvikOrani: veri.sgkTesvikOrani }),
          ...(iban !== undefined && { iban }),
        },
        include: { cari: true },
      });
      if (veri.girisTarihi && veri.girisTarihi.getTime() !== mevcut.girisTarihi.getTime()) {
        await tx.personelIstihdamDonemi.updateMany({ where: { tenantId, personelId: id, bitisTarihi: null }, data: { baslangicTarihi: veri.girisTarihi } });
      }
      if (guncel.cariId) {
        await tx.cariHesap.update({
          where: { id: guncel.cariId },
          data: {
            ...((veri.ad || veri.soyad) && { ad: guncel.ad, soyad: guncel.soyad, unvan: `${guncel.ad} ${guncel.soyad}` }),
            ...(veri.eposta !== undefined && { eposta: guncel.eposta }),
            ...(veri.telefon !== undefined && { telefon: guncel.telefon }),
            ...(veri.iban !== undefined && { iban: veri.iban || null }),
            ...(veri.tckn !== undefined && { vknTckn: veri.tckn || null }),
          },
        });
      }
      const alanlar = (Object.keys(veri) as (keyof typeof veri)[]).filter((k) => veri[k] !== undefined && k !== "cariOlustur");
      const ucret = (deger: Prisma.Decimal | null) => deger?.toFixed(2) ?? null;
      await tx.auditLog.create({
        data: {
          tenantId, userId: userId ?? null, islem: "personel_guncelle", varlik: "personel", varlikId: id,
          detay: {
            alanlar,
            ...(veri.netMaas && { netMaas: { onceki: ucret(mevcut.netMaas), yeni: ucret(guncel.netMaas) } }),
            ...(veri.brutMaas !== undefined && { brutMaas: { onceki: ucret(mevcut.brutMaas), yeni: ucret(guncel.brutMaas) } }),
          },
        },
      });
      return guncel;
    });
    return personelMaskele(personel);
  }

  async hassasVeriGetir(tenantId: string, id: string, userId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({ where: { id, tenantId }, select: { tckn: true, iban: true } });
      if (!personel) throw new NotFoundException("Personel bulunamadı");
      await tx.auditLog.create({ data: { tenantId, userId, islem: "HASSAS_VERI_GORUNTULE", varlik: "personel", varlikId: id, detay: { alanlar: ["tckn", "iban"] } } });
      return { tckn: hassasCoz(personel.tckn), iban: hassasCoz(personel.iban) };
    });
  }

  async hassasVerileriSifrele(tenantId: string, userId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.personel.findMany({ where: { OR: [{ tckn: { not: null } }, { iban: { not: null } }] }, select: { id: true, tckn: true, iban: true } });
      let donusturulen = 0;
      for (const kayit of kayitlar) {
        const tckn = hassasSifrele(kayit.tckn); const iban = hassasSifrele(kayit.iban);
        if (tckn !== kayit.tckn || iban !== kayit.iban) { await tx.personel.update({ where: { id: kayit.id }, data: { tckn, iban } }); donusturulen++; }
      }
      await tx.auditLog.create({ data: { tenantId, userId, islem: "HASSAS_VERI_SIFRELEME_GECISI", varlik: "personel", detay: { donusturulen } } });
      return { taranan: kayitlar.length, donusturulen };
    });
  }

  async bordroTopluTahakkuk(tenantId: string, userId: string, girdi: z.infer<typeof bordroTahakkukSemasi>) {
    const { donemYil, donemAy } = bordroTahakkukSemasi.parse(girdi);
    const donemBaslangici = new Date(Date.UTC(donemYil, donemAy - 1, 1));
    const donemSonu = new Date(Date.UTC(donemYil, donemAy, 0));

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const aktifPersoneller = await tx.personel.findMany({
        where: {
          tenantId,
          aktif: true,
          durum: "aktif",
          girisTarihi: { lte: donemSonu },
          OR: [{ cikisTarihi: null }, { cikisTarihi: { gte: donemBaslangici } }],
        }
      });

      let olusturulanSayi = 0;
      const calismalar = await tx.personelDonemCalisma.findMany({ where: { tenantId, yil: donemYil, ay: donemAy } });
      const calismaHaritasi = new Map(calismalar.map((c) => [c.personelId, c]));
      const mevzuat = aktifPersoneller.some((p) => p.brutMaas)
        ? await tx.bordroMevzuatSeti.findFirst({ where: { tenantId, durum: "aktif", yururlukBaslangic: { lte: donemBaslangici }, OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: donemBaslangici } }] }, orderBy: { surum: "desc" } })
        : null;
      if (aktifPersoneller.some((p) => p.brutMaas) && !mevzuat) throw new BadRequestException("Brüt ücretli personel için döneme uygun etkin mevzuat seti bulunamadı");

      for (const p of aktifPersoneller) {
        const mevcut = await tx.personelBordro.findUnique({
          where: {
            tenantId_personelId_donemYil_donemAy: {
              tenantId,
              personelId: p.id,
              donemYil,
              donemAy
            }
          }
        });

        if (!mevcut) {
          const calisma = calismaHaritasi.get(p.id); const primGunu = calisma?.primGunu ?? 30;
          const onceki = p.brutMaas ? await tx.personelBordro.findFirst({ where: { tenantId, personelId: p.id, donemYil, donemAy: { lt: donemAy } }, orderBy: { donemAy: "desc" }, select: { kumulatifMatrah: true, asgariKumulatifMatrah: true, hesapOzeti:true } }) : null;
          const oncekiDevirBordrosu = p.brutMaas ? await tx.personelBordro.findFirst({ where: { tenantId, personelId: p.id, OR: [{ donemYil: { lt: donemYil } }, { donemYil, donemAy: { lt: donemAy } }] }, orderBy: [{ donemYil: "desc" }, { donemAy: "desc" }], select: { donemYil: true, donemAy: true, hesapOzeti: true } }) : null;
          const temelBrut = p.brutMaas ? new Prisma.Decimal(p.brutMaas).mul(primGunu).div(30).toDecimalPlaces(2) : null;
          const fazlaMesaiBrut = calisma?.fazlaMesaiBrut ?? new Prisma.Decimal(0);
          const primIkramiyeBrut = calisma?.primIkramiyeBrut ?? new Prisma.Decimal(0);
          const ucretDisiOdeme = fazlaMesaiBrut.add(primIkramiyeBrut);
          const sgkMatrahDevirleri = oncekiDevirBordrosu ? hesapOzetindenSgkDevirleri(oncekiDevirBordrosu.hesapOzeti, oncekiDevirBordrosu.donemYil, oncekiDevirBordrosu.donemAy, donemYil, donemAy) : [];
          const hesap = temelBrut && mevzuat ? bordroHesapla(mevzuat.parametreler as any, { brutUcret: temelBrut.toNumber(), ucretDisiOdeme:ucretDisiOdeme.toNumber(), sgkMatrahDevirleri, primGunu, nakitYemekYardimi:calisma?.nakitYemekYardimi.toNumber()??0, fiiliCalismaGunu:calisma?.fiiliCalismaGunu??0, engellilikDerecesi: p.engellilikDerecesi ?? undefined, sgkTesvikOrani: calisma?.sgkTesvikOrani?.toNumber() ?? p.sgkTesvikOrani.toNumber(), sahisSigortaPrimi:calisma?.sahisSigortaPrimi.toNumber()??0, hayatSigortaPrimi:calisma?.hayatSigortaPrimi.toNumber()??0, sendikaAidati:calisma?.sendikaAidati.toNumber()??0, oncekiKumulatifSigortaIndirimi:hesapOzetiTutari(onceki?.hesapOzeti??null,"yeniKumulatifSigortaIndirimi").toNumber(), oncekiKumulatifMatrah: onceki?.kumulatifMatrah?.toNumber() ?? 0, oncekiAsgariKumulatifMatrah: onceki?.asgariKumulatifMatrah?.toNumber() ?? 0 }) : null;
          const operasyonelNet = new Prisma.Decimal(p.netMaas).mul(primGunu).div(30).toDecimalPlaces(2);
          const brut = hesap?.brutUcret ?? operasyonelNet;
          const net = hesap?.netUcret ?? operasyonelNet;
          await tx.personelBordro.create({
            data: {
              tenantId,
              personelId: p.id,
              donemYil,
              donemAy,
              brutMaas: brut,
              netMaas: net,
              prim: 0,
              kesinti: 0,
              odenecekTutar: net,
              kalanTutar: net,
              mevzuatSetiId: hesap ? mevzuat!.id : null,
              hesapOzeti: hesap ? hesap as Prisma.InputJsonValue : undefined,
              kumulatifMatrah: hesap?.yeniKumulatifMatrah,
              asgariKumulatifMatrah: hesap?.yeniAsgariKumulatifMatrah,
              primGunu,
              eksikGunNedeni: calisma?.eksikGunNedeni ?? null,
              odendi: false,
              durum: "hesaplandi",
              olusturanUserId: userId,
              kalemler: {
                create: hesap ? [
                  { tenantId, tip: "kazanc", kod: "temel_brut_ucret", aciklama: "Temel brüt ücret", tutar: temelBrut! },
                  ...(fazlaMesaiBrut.gt(0) ? [{ tenantId, tip: "kazanc" as const, kod: "fazla_mesai", aciklama: "Fazla mesai brüt", tutar: fazlaMesaiBrut }] : []),
                  ...(primIkramiyeBrut.gt(0) ? [{ tenantId, tip: "kazanc" as const, kod: "prim_ikramiye", aciklama: "Prim / ikramiye brüt", tutar: primIkramiyeBrut }] : []),
                  ...(Number(hesap.nakitYemekYardimi) > 0 ? [{ tenantId, tip: "kazanc" as const, kod: "nakit_yemek_yardimi", aciklama: "Nakit yemek yardımı", tutar: hesap.nakitYemekYardimi }] : []),
                  { tenantId, tip: "kesinti", kod: "sgk_isci", aciklama: "SGK çalışan payı", tutar: hesap.sgkIsci },
                  { tenantId, tip: "kesinti", kod: "issizlik_isci", aciklama: "İşsizlik çalışan payı", tutar: hesap.issizlikIsci },
                  { tenantId, tip: "kesinti", kod: "gelir_vergisi", aciklama: "Gelir vergisi", tutar: hesap.gelirVergisi },
                  { tenantId, tip: "kesinti", kod: "damga_vergisi", aciklama: "Damga vergisi", tutar: hesap.damgaVergisi },
                  ...(Number(hesap.sahisSigortaPrimi) > 0 ? [{ tenantId, tip: "kesinti" as const, kod: "sahis_sigorta_primi", aciklama: "Şahıs sigortası primi", tutar: hesap.sahisSigortaPrimi }] : []),
                  ...(Number(hesap.hayatSigortaPrimi) > 0 ? [{ tenantId, tip: "kesinti" as const, kod: "hayat_sigorta_primi", aciklama: "Hayat sigortası primi", tutar: hesap.hayatSigortaPrimi }] : []),
                  ...(Number(hesap.sendikaAidati) > 0 ? [{ tenantId, tip: "kesinti" as const, kod: "sendika_aidati", aciklama: "Sendika aidatı", tutar: hesap.sendikaAidati }] : []),
                ] : {
                  tenantId,
                  tip: "kazanc",
                  kod: "temel_ucret",
                  aciklama: "Temel ücret",
                  tutar: p.netMaas,
                },
              },
            }
          });
          olusturulanSayi++;
        }
      }

      return { olusturulanSayi, toplamAktifPersonel: aktifPersoneller.length };
    });
  }

  async bordroOnayaGonder(tenantId: string, id: string) {
    return this.bordroDurumGecisi(tenantId, id, "hesaplandi", "onay_bekliyor");
  }

  async bordroOnayla(tenantId: string, id: string, userId: string) {
    const bordro = await this.bordroGetir(tenantId, id);
    if (bordro.olusturanUserId === userId) {
      throw new BadRequestException("Bordroyu hazırlayan kullanıcı aynı bordroyu onaylayamaz");
    }
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const onayTarihi = new Date();
      const sonuc = await tx.personelBordro.updateMany({
        where: { id, tenantId, durum: "onay_bekliyor" },
        data: { durum: "onaylandi", onaylayanUserId: userId, onayTarihi, retNedeni: null },
      });
      if (sonuc.count !== 1) throw new BadRequestException("Yalnızca onay bekleyen bordro onaylanabilir");

      if (bordro.personel.cariId) {
        await tx.cariHareket.create({ data: {
          tenantId,
          cariId: bordro.personel.cariId,
          tip: "alacak",
          tutar: bordro.odenecekTutar,
          tutarTry: bordro.odenecekTutar,
          tarih: onayTarihi,
          aciklama: `${bordro.donemYil}/${bordro.donemAy} Maaş Tahakkuku`,
          kaynakTur: "bordro_tahakkuk",
          kaynakRef: bordro.id,
        }});
      }
    });
    return this.bordroGetir(tenantId, id);
  }

  async bordroReddet(tenantId: string, id: string, userId: string, neden: string) {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.updateMany({
      where: { id, tenantId, durum: "onay_bekliyor" },
      data: { durum: "reddedildi", onaylayanUserId: userId, onayTarihi: new Date(), retNedeni: neden },
    }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnızca onay bekleyen bordro reddedilebilir");
    return this.bordroGetir(tenantId, id);
  }

  async bordroKalemEkle(tenantId: string, bordroId: string, girdi: z.infer<typeof bordroKalemOlusturSemasi>) {
    const veri = bordroKalemOlusturSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({
        where: { id: bordroId, tenantId, durum: { in: ["hesaplandi", "reddedildi"] } }, select: { id: true, mevzuatSetiId: true },
      });
      if (!bordro) throw new BadRequestException("Yalnızca hesaplanmış veya reddedilmiş bordronun kalemleri değiştirilebilir");
      if (bordro.mevzuatSetiId) throw new BadRequestException("Mevzuatla hesaplanan bordroya manuel kalem eklenemez; brüt ücret girdisini düzelterek yeniden tahakkuk oluşturun");
      await tx.personelBordroKalemi.create({
        data: { tenantId, bordroId, tip: veri.tip, kod: veri.kod, aciklama: veri.aciklama, tutar: new Prisma.Decimal(veri.tutar), manuel: true },
      });
      await this.bordroToplamlariniGuncelle(tx, tenantId, bordroId);
      await tx.personelBordro.update({ where: { id: bordroId }, data: { durum: "hesaplandi", retNedeni: null, onaylayanUserId: null, onayTarihi: null } });
      return tx.personelBordro.findUnique({ where: { id: bordroId }, include: { kalemler: { orderBy: { createdAt: "asc" } }, personel: { select: PERSONEL_GUVENLI_SECIM } } });
    });
  }

  async bordroKalemSil(tenantId: string, bordroId: string, kalemId: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({
        where: { id: bordroId, tenantId, durum: { in: ["hesaplandi", "reddedildi"] } }, select: { id: true },
      });
      if (!bordro) throw new BadRequestException("Bu bordronun kalemleri artık değiştirilemez");
      const kalem = await tx.personelBordroKalemi.findFirst({ where: { id: kalemId, bordroId, tenantId, manuel: true } });
      if (!kalem) throw new BadRequestException("Temel veya bulunamayan bordro kalemi silinemez");
      if (kalem.avansId) {
        await tx.personelAvans.update({ where: { id: kalem.avansId }, data: { mahsupEdilenTutar: { decrement: kalem.tutar }, kalanTutar: { increment: kalem.tutar } } });
        const avans = await tx.personelAvans.findUniqueOrThrow({ where: { id: kalem.avansId }, select: { mahsupEdilenTutar: true } });
        await tx.personelAvans.update({ where: { id: kalem.avansId }, data: { durum: avans.mahsupEdilenTutar.isZero() ? "odendi" : "kismen_mahsup" } });
      }
      const silinen = await tx.personelBordroKalemi.deleteMany({ where: { id: kalemId, bordroId, tenantId, manuel: true } });
      if (silinen.count !== 1) throw new BadRequestException("Temel veya bulunamayan bordro kalemi silinemez");
      await this.bordroToplamlariniGuncelle(tx, tenantId, bordroId);
      return tx.personelBordro.findUnique({ where: { id: bordroId }, include: { kalemler: { orderBy: { createdAt: "asc" } }, personel: { select: PERSONEL_GUVENLI_SECIM } } });
    });
  }

  async bordroAvansMahsup(tenantId: string, bordroId: string, girdi: z.infer<typeof avansMahsupSemasi>) {
    const veri = avansMahsupSemasi.parse(girdi);
    const tutar = new Prisma.Decimal(veri.tutar);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({ where: { id: bordroId, tenantId, durum: { in: ["hesaplandi", "reddedildi"] } }, select: { id: true, personelId: true } });
      if (!bordro) throw new BadRequestException("Bu bordroya avans mahsubu eklenemez");
      const guncellenen = await tx.personelAvans.updateMany({
        where: { id: veri.avansId, tenantId, personelId: bordro.personelId, durum: { in: ["odendi", "kismen_mahsup"] }, kalanTutar: { gte: tutar } },
        data: { mahsupEdilenTutar: { increment: tutar }, kalanTutar: { decrement: tutar } },
      });
      if (guncellenen.count !== 1) throw new BadRequestException("Avans bulunamadı veya mahsup tutarı kalan bakiyeyi aşıyor");
      const kalem = await tx.personelBordroKalemi.create({ data: { tenantId, bordroId, tip: "kesinti", kod: "avans_mahsup", aciklama: "Avans mahsubu", tutar, manuel: true, avansId: veri.avansId } });
      const avans = await tx.personelAvans.findUniqueOrThrow({ where: { id: veri.avansId }, select: { kalanTutar: true } });
      await tx.personelAvans.update({ where: { id: veri.avansId }, data: { durum: avans.kalanTutar.isZero() ? "mahsup_edildi" : "kismen_mahsup" } });
      await this.bordroToplamlariniGuncelle(tx, tenantId, bordroId);
      return kalem;
    });
  }

  private async bordroToplamlariniGuncelle(tx: Prisma.TransactionClient, tenantId: string, bordroId: string) {
    const kalemler = await tx.personelBordroKalemi.findMany({ where: { tenantId, bordroId }, select: { tip: true, kod: true, tutar: true } });
    const kazanc = kalemler.filter((k) => k.tip === "kazanc").reduce((t, k) => t.add(k.tutar), new Prisma.Decimal(0));
    const kesinti = kalemler.filter((k) => k.tip === "kesinti").reduce((t, k) => t.add(k.tutar), new Prisma.Decimal(0));
    const temelUcret = kalemler.find((k) => k.tip === "kazanc" && k.kod === "temel_ucret")?.tutar ?? new Prisma.Decimal(0);
    const odenecek = kazanc.sub(kesinti);
    if (odenecek.isNegative()) throw new BadRequestException("Kesintiler toplam kazancı aşamaz");
    await tx.personelBordro.update({
      where: { id: bordroId },
      data: { prim: kazanc.sub(temelUcret), kesinti, odenecekTutar: odenecek, kalanTutar: odenecek },
    });
  }

  private async bordroDurumGecisi(tenantId: string, id: string, kaynak: "hesaplandi", hedef: "onay_bekliyor") {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelBordro.updateMany({
      where: { id, tenantId, durum: kaynak }, data: { durum: hedef },
    }));
    if (sonuc.count !== 1) throw new BadRequestException("Bordro mevcut durumundan bu işleme geçirilemez");
    return this.bordroGetir(tenantId, id);
  }

  async bordroOde(tenantId: string, bordroId: string, girdi: z.infer<typeof bordroOdeSemasi>) {
    const veri = bordroOdeSemasi.parse(girdi);
    const tutar = new Prisma.Decimal(veri.tutar);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const bordro = await tx.personelBordro.findFirst({
        where: { id: bordroId, tenantId },
        include: { personel: { select: PERSONEL_GUVENLI_SECIM } }
      });

      if (!bordro) throw new NotFoundException("Bordro bulunamadı");
      if (!['onaylandi', 'kismen_odendi'].includes(bordro.durum)) throw new BadRequestException("Yalnızca onaylanmış bordroya ödeme yapılabilir");
      if (!bordro.personel.cariId) {
        throw new BadRequestException("Maaş ödemesi için personele bağlı bir cari hesap gereklidir");
      }

      if (veri.kasaId) {
        const kasa = await tx.kasa.findFirst({
          where: { id: veri.kasaId, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!kasa) throw new BadRequestException("Aktif bir TRY kasası seçilmelidir");
      } else {
        const banka = await tx.bankaHesap.findFirst({
          where: { id: veri.bankaHesapId!, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!banka) throw new BadRequestException("Aktif bir TRY banka hesabı seçilmelidir");
      }

      const bakiyeGuncelleme = await tx.personelBordro.updateMany({
        where: { id: bordroId, tenantId, durum: { in: ["onaylandi", "kismen_odendi"] }, kalanTutar: { gte: tutar } },
        data: { odenenTutar: { increment: tutar }, kalanTutar: { decrement: tutar } },
      });
      if (bakiyeGuncelleme.count !== 1) throw new BadRequestException("Ödeme tutarı bordronun kalan bakiyesini aşamaz");

      const odeme = await tx.personelBordroOdeme.create({
        data: { tenantId, bordroId, tutar, tarih: veri.odemeTarihi, kasaId: veri.kasaId || null, bankaHesapId: veri.bankaHesapId || null, aciklama: veri.aciklama || null },
      });
      const fis = await tx.kasaBankaHareket.create({
          data: {
            tenantId,
            kasaId: veri.kasaId || null,
            bankaHesapId: veri.bankaHesapId || null,
            cariId: bordro.personel.cariId,
            tip: "tediye",
            tutar,
            tutarTry: tutar,
            tarih: veri.odemeTarihi,
            aciklama: veri.aciklama || `${bordro.donemYil}/${bordro.donemAy} Maaş Ödemesi - ${bordro.personel.ad} ${bordro.personel.soyad}`,
            kaynakTur: "personel_maas",
            kaynakRef: odeme.id,
          }
      });
      const cariHareket = await tx.cariHareket.create({
          data: {
            tenantId,
            cariId: bordro.personel.cariId,
            tip: "borc",
            tutar,
            tutarTry: tutar,
            tarih: veri.odemeTarihi,
            aciklama: veri.aciklama || `${bordro.donemYil}/${bordro.donemAy} Maaş Ödemesi`,
            kaynakTur: "bordro_odeme",
            kaynakRef: odeme.id,
          }
      });
      await tx.personelBordroOdeme.update({ where: { id: odeme.id }, data: { kasaBankaHareketId: fis.id, cariHareketId: cariHareket.id } });
      const guncel = await tx.personelBordro.findUniqueOrThrow({ where: { id: bordroId }, select: { kalanTutar: true } });
      const tamamenOdendi = guncel.kalanTutar.isZero();
      return tx.personelBordro.update({
        where: { id: bordroId },
        data: {
          odendi: tamamenOdendi,
          durum: tamamenOdendi ? "odendi" : "kismen_odendi",
          odemeTarihi: veri.odemeTarihi,
          kasaBankaFiId: fis.id,
        },
        include: { odemeler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] }, kalemler: true, personel: { select: PERSONEL_GUVENLI_SECIM } },
      });
    });
  }

  async bordroOdemeIptal(tenantId: string, bordroId: string, odemeId: string, neden: string) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const odeme = await tx.personelBordroOdeme.findFirst({ where: { id: odemeId, bordroId, tenantId, durum: "aktif" } });
      if (!odeme) throw new NotFoundException("Aktif bordro ödemesi bulunamadı");
      const bordro = await tx.personelBordro.findFirst({ where: { id: bordroId, tenantId }, include: { personel: true } });
      if (!bordro?.personel.cariId) throw new BadRequestException("Bordro veya personel cari hesabı bulunamadı");
      const sahiplen = await tx.personelBordroOdeme.updateMany({ where: { id: odemeId, tenantId, durum: "aktif" }, data: { durum: "iptal", iptalTarihi: new Date(), iptalNedeni: neden } });
      if (sahiplen.count !== 1) throw new BadRequestException("Ödeme daha önce iptal edilmiştir");
      const tersFis = await tx.kasaBankaHareket.create({ data: {
        tenantId, kasaId: odeme.kasaId, bankaHesapId: odeme.bankaHesapId, cariId: bordro.personel.cariId,
        tip: "tahsilat", tutar: odeme.tutar, tutarTry: odeme.tutar, tarih: new Date(),
        aciklama: `Bordro ödeme iptali: ${neden}`, kaynakTur: "personel_maas_iptal", kaynakRef: odeme.id,
        karsiHareketId: odeme.kasaBankaHareketId,
      }});
      const tersCari = await tx.cariHareket.create({ data: {
        tenantId, cariId: bordro.personel.cariId, tip: "alacak", tutar: odeme.tutar, tutarTry: odeme.tutar,
        tarih: new Date(), aciklama: `Bordro ödeme iptali: ${neden}`, kaynakTur: "bordro_odeme_iptal", kaynakRef: odeme.id,
      }});
      await tx.personelBordroOdeme.update({ where: { id: odemeId }, data: { tersKasaBankaHareketId: tersFis.id, tersCariHareketId: tersCari.id } });
      await tx.personelBordro.update({ where: { id: bordroId }, data: { odenenTutar: { decrement: odeme.tutar }, kalanTutar: { increment: odeme.tutar }, odendi: false } });
      const guncel = await tx.personelBordro.findUniqueOrThrow({ where: { id: bordroId }, select: { odenenTutar: true } });
      return tx.personelBordro.update({ where: { id: bordroId }, data: { durum: guncel.odenenTutar.isZero() ? "onaylandi" : "kismen_odendi" }, include: { odemeler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }] }, kalemler: true, personel: { select: PERSONEL_GUVENLI_SECIM } } });
    });
  }

  async avansListele(tenantId: string, personelId?: string) {
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findMany({
      where: { tenantId, ...(personelId ? { personelId } : {}) }, include: { personel: { select: { id: true, personelNo: true, ad: true, soyad: true } } }, orderBy: [{ tarih: "desc" }, { id: "desc" }],
    }));
  }

  async avansVer(tenantId: string, userId: string, girdi: z.infer<typeof avansOlusturSemasi>) {
    const veri = avansOlusturSemasi.parse(girdi);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const personel = await tx.personel.findFirst({
        where: { id: veri.personelId, tenantId }
      });
      if (!personel) throw new NotFoundException("Personel bulunamadı");

      return tx.personelAvans.create({ data: {
        tenantId, personelId: veri.personelId, tutar: veri.tutar, tarih: veri.tarih,
        aciklama: veri.aciklama || null, durum: "talep", olusturanUserId: userId, kalanTutar: 0,
      }});
    });
  }

  async avansOnayla(tenantId: string, id: string, userId: string) {
    const avans = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findFirst({ where: { id, tenantId } }));
    if (!avans) throw new NotFoundException("Avans talebi bulunamadı");
    if (avans.olusturanUserId === userId) throw new BadRequestException("Avans talebini oluşturan kullanıcı aynı talebi onaylayamaz");
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.updateMany({ where: { id, tenantId, durum: "talep" }, data: { durum: "onaylandi", onaylayanUserId: userId, onayTarihi: new Date(), retNedeni: null } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnızca bekleyen avans talebi onaylanabilir");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findUnique({ where: { id } }));
  }

  async avansReddet(tenantId: string, id: string, userId: string, neden: string) {
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.updateMany({ where: { id, tenantId, durum: "talep" }, data: { durum: "reddedildi", onaylayanUserId: userId, onayTarihi: new Date(), retNedeni: neden } }));
    if (sonuc.count !== 1) throw new BadRequestException("Yalnızca bekleyen avans talebi reddedilebilir");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.personelAvans.findUnique({ where: { id } }));
  }

  async avansOde(tenantId: string, id: string, girdi: z.infer<typeof avansOdeSemasi>) {
    const veri = avansOdeSemasi.parse(girdi);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const avans = await tx.personelAvans.findFirst({ where: { id, tenantId, durum: "onaylandi" }, include: { personel: true } });
      if (!avans) throw new BadRequestException("Yalnızca onaylanmış avans ödenebilir");
      if (!avans.personel.cariId) throw new BadRequestException("Avans ödemesi için personel cari hesabı gereklidir");
      if (veri.kasaId) {
        const kasa = await tx.kasa.findFirst({
          where: { id: veri.kasaId, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!kasa) throw new BadRequestException("Aktif bir TRY kasası seçilmelidir");
      } else {
        const banka = await tx.bankaHesap.findFirst({
          where: { id: veri.bankaHesapId!, tenantId, aktif: true, dovizCinsi: "TRY" },
          select: { id: true },
        });
        if (!banka) throw new BadRequestException("Aktif bir TRY banka hesabı seçilmelidir");
      }

      const fis = await tx.kasaBankaHareket.create({
          data: {
            tenantId,
            kasaId: veri.kasaId || null,
            bankaHesapId: veri.bankaHesapId || null,
            cariId: avans.personel.cariId,
            tip: "tediye",
            tutar: avans.tutar,
            tutarTry: avans.tutar,
            tarih: veri.tarih,
            aciklama: avans.aciklama || `Avans Ödemesi - ${avans.personel.ad} ${avans.personel.soyad}`,
            kaynakTur: "personel_avans",
          }
      });
      await tx.cariHareket.create({ data: { tenantId, cariId: avans.personel.cariId, tip: "borc", tutar: avans.tutar, tutarTry: avans.tutar, tarih: veri.tarih, aciklama: "Personel avans alacağı", kaynakTur: "personel_avans", kaynakRef: avans.id } });
      return tx.personelAvans.update({ where: { id }, data: { durum: "odendi", odendi: true, odenenTutar: avans.tutar, kalanTutar: avans.tutar, kasaBankaFiId: fis.id, tarih: veri.tarih } });
    });
  }

  /**
   * Dönemin ödenmemiş (onaylı ya da kısmen ödenmiş) bordrolarından toplu maaş
   * havalesi CSV'si. TCKN/IBAN çözülerek yazılır; IBAN'ı olmayan personel varsa
   * dosya üretilmez (bankada reddedilecek satır göndermek yerine eksik listelenir).
   * Toplu hassas veri dökümü denetim kaydına yazılır.
   */
  async bankaMaasDosyasiOlustur(tenantId: string, userId: string, yil: number, ay: number) {
    const bordrolar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.personelBordro.findMany({
        where: { tenantId, donemYil: yil, donemAy: ay, durum: { in: ["onaylandi", "kismen_odendi"] }, kalanTutar: { gt: 0 } },
        include: { personel: { select: { personelNo: true, ad: true, soyad: true, tckn: true, iban: true } } },
        orderBy: { personel: { ad: "asc" } },
      })
    );
    if (bordrolar.length === 0) {
      throw new BadRequestException("Belirtilen dönemde ödenmemiş onaylı maaş bordrosu bulunamadı");
    }
    const satirlar = bordrolar.map((b) => ({ ...b, tckn: hassasCoz(b.personel.tckn), iban: hassasCoz(b.personel.iban) }));
    const ibansiz = satirlar.filter((b) => !b.iban);
    if (ibansiz.length) {
      throw new BadRequestException(`IBAN'ı olmayan personel var: ${ibansiz.map((b) => `${b.personel.personelNo} ${b.personel.ad} ${b.personel.soyad}`).join(", ")}. Personel kartına IBAN girip yeniden deneyin`);
    }

    const donem = `${yil}/${String(ay).padStart(2, "0")}`;
    const alan = (deger: string) => `"${deger.replaceAll('"', '""')}"`;
    const toplam = satirlar.reduce((t, b) => t.add(b.kalanTutar), new Prisma.Decimal(0));
    // Excel Türkçe karakterleri doğru açsın diye UTF-8 BOM.
    const dosyaIcerigi = "\uFEFF" + ["Ad Soyad;TCKN;IBAN;Tutar;Açıklama", ...satirlar.map((b) =>
      [alan(`${b.personel.ad} ${b.personel.soyad}`), alan(b.tckn ?? ""), alan(b.iban!), b.kalanTutar.toFixed(2), alan(`${donem} Maaş Ödemesi`)].join(";"),
    )].join("\r\n") + "\r\n";

    await this.prisma.tenantIslem(tenantId, (tx) => tx.auditLog.create({
      data: { tenantId, userId, islem: "HASSAS_VERI_TOPLU_DISA_AKTAR", varlik: "personel_bordro", detay: { amac: "banka_maas_dosyasi", donem, personelSayisi: satirlar.length, toplam: toplam.toFixed(2) } },
    }));
    return {
      donemYil: yil,
      donemAy: ay,
      toplamPersonel: satirlar.length,
      toplamTutar: toplam.toFixed(2),
      dosyaAdi: `Maas_Transfer_${yil}_${String(ay).padStart(2, "0")}.csv`,
      dosyaIcerigi,
    };
  }
}
